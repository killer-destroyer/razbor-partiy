import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Color, EngineLine, PositionAnalysis } from '../shared/types'
import { Chess } from 'chess.js'
import { scoreFromUci } from '../renderer/analysis/winprob'

export interface SearchLimits {
  depth?: number
  movetimeMs?: number
  infinite?: boolean
}

export interface InfoUpdate {
  depth: number
  lines: EngineLine[]
}

export function parseInfoLine(line: string, sideToMove: Color): EngineLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null
  if (/\b(lowerbound|upperbound)\b/.test(line)) return null
  const depthMatch = line.match(/\bdepth (\d+)/)
  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/)
  const pvMatch = line.match(/\bpv (.+)$/)
  if (!depthMatch || !scoreMatch || !pvMatch) return null
  const multipvMatch = line.match(/\bmultipv (\d+)/)
  return {
    multipv: multipvMatch ? Number(multipvMatch[1]) : 1,
    depth: Number(depthMatch[1]),
    score: scoreFromUci(scoreMatch[1] as 'cp' | 'mate', Number(scoreMatch[2]), sideToMove),
    pv: pvMatch[1].trim().split(/\s+/)
  }
}

type LineListener = (line: string) => void

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length
  } catch {
    return 1
  }
}

export class UciEngine {
  private process: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private listeners = new Set<LineListener>()
  private searching: Promise<PositionAnalysis> | null = null
  private exitHandlers = new Set<(code: number | null) => void>()
  name: string | null = null
  multiPv = 1

  constructor(private readonly binaryPath: string) {}

  get running(): boolean {
    return this.process !== null
  }

  async start(options: { threads: number; hashMb: number }): Promise<void> {
    const child = spawn(this.binaryPath, [], { stdio: 'pipe', windowsHide: true })
    this.process = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    child.stderr.on('data', () => undefined)
    child.on('exit', (code) => {
      this.process = null
      for (const handler of this.exitHandlers) handler(code)
    })
    const failed = new Promise<never>((_, reject) => {
      child.once('error', (error) => reject(error))
    })
    failed.catch(() => undefined)
    this.send('uci')
    const idLine = Promise.race([this.waitFor((line) => line.startsWith('id name ')), failed])
    await Promise.race([this.waitFor((line) => line === 'uciok', 15000), failed])
    this.name = (await Promise.race([idLine, Promise.resolve('')])).replace('id name ', '') || null
    this.setOption('Threads', options.threads)
    this.setOption('Hash', options.hashMb)
    this.setOption('UCI_ShowWDL', 'false')
    await this.ready()
  }

  onExit(handler: (code: number | null) => void): () => void {
    this.exitHandlers.add(handler)
    return () => this.exitHandlers.delete(handler)
  }

  setOption(name: string, value: string | number): void {
    this.send(`setoption name ${name} value ${value}`)
  }

  async ready(): Promise<void> {
    this.send('isready')
    await this.waitFor((line) => line === 'readyok', 15000)
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame')
    await this.ready()
  }

  send(command: string): void {
    this.process?.stdin.write(`${command}\n`)
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) for (const listener of [...this.listeners]) listener(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null
      const listener: LineListener = (line) => {
        if (!predicate(line)) return
        this.listeners.delete(listener)
        if (timer) clearTimeout(timer)
        resolve(line)
      }
      this.listeners.add(listener)
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.listeners.delete(listener)
          reject(new Error('Движок не ответил вовремя'))
        }, timeoutMs)
      }
    })
  }

  async search(fen: string, limits: SearchLimits, multiPv: number, onInfo?: (update: InfoUpdate) => void): Promise<PositionAnalysis> {
    if (this.searching) {
      this.stop()
      await this.searching.catch(() => undefined)
    }
    const run = this.runSearch(fen, limits, multiPv, onInfo)
    this.searching = run
    try {
      return await run
    } finally {
      if (this.searching === run) this.searching = null
    }
  }

  private async runSearch(fen: string, limits: SearchLimits, multiPv: number, onInfo?: (update: InfoUpdate) => void): Promise<PositionAnalysis> {
    if (multiPv !== this.multiPv) {
      this.setOption('MultiPV', multiPv)
      this.multiPv = multiPv
      await this.ready()
    }
    const sideToMove: Color = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    const expectedLines = Math.max(1, Math.min(multiPv, legalMoveCount(fen)))
    const lines = new Map<number, EngineLine>()
    let completedDepth = 0
    const snapshot = (): EngineLine[] => [...lines.values()].sort((a, b) => a.multipv - b.multipv)
    const listener: LineListener = (line) => {
      const parsed = parseInfoLine(line, sideToMove)
      if (!parsed) return
      lines.set(parsed.multipv, parsed)
      if (parsed.multipv === expectedLines && parsed.depth > completedDepth) {
        completedDepth = parsed.depth
        onInfo?.({ depth: completedDepth, lines: snapshot() })
      }
    }
    this.listeners.add(listener)
    this.send(`position fen ${fen}`)
    if (limits.infinite) this.send('go infinite')
    else if (limits.movetimeMs && limits.depth) this.send(`go depth ${limits.depth} movetime ${limits.movetimeMs}`)
    else if (limits.movetimeMs) this.send(`go movetime ${limits.movetimeMs}`)
    else this.send(`go depth ${limits.depth ?? 18}`)
    let detachExit: () => void = () => undefined
    const exited = new Promise<never>((_, reject) => {
      detachExit = this.onExit(() => reject(new Error('Процесс движка завершился')))
    })
    exited.catch(() => undefined)
    try {
      const bestLine = await Promise.race([this.waitFor((line) => line.startsWith('bestmove')), exited])
      const result = snapshot()
      if (!result.length) {
        const best = bestLine.split(' ')[1]
        if (best && best !== '(none)') result.push({ multipv: 1, depth: 0, score: { type: 'cp', cp: 0 }, pv: [best] })
      }
      const reported = bestLine.split(' ')[1]
      return { fen, depth: Math.max(completedDepth, result[0]?.depth ?? 0), lines: result, bestMove: reported && reported !== '(none)' ? reported : undefined }
    } finally {
      detachExit()
      this.listeners.delete(listener)
    }
  }

  stop(): void {
    this.send('stop')
  }

  async quit(): Promise<void> {
    if (!this.process) return
    const child = this.process
    this.send('quit')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 1500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
