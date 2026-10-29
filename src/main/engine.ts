import { accessSync, constants, existsSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { AnalysisOptions, EngineStatus, PositionAnalysis } from '../shared/types'
import { UciEngine, type InfoUpdate } from './uci'

export interface EngineConfig {
  path: string | null
  threads: number
  hashMb: number
  poolSize: number
}

export class CancelledError extends Error {
  constructor() {
    super('Анализ отменён')
    this.name = 'CancelledError'
  }
}

interface Task {
  fen: string
  options: AnalysisOptions
  priority: number
  jobId: string
  resolve: (analysis: PositionAnalysis) => void
  reject: (error: Error) => void
}

interface Worker {
  engine: UciEngine
  task: Task | null
}

export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const probed = new Map<string, boolean>()

export function probeEngine(path: string): boolean {
  const cached = probed.get(path)
  if (cached !== undefined) return cached
  let ok = false
  try {
    ok = execFileSync(path, [], { input: 'uci\nquit\n', encoding: 'utf8', timeout: 10000, windowsHide: true }).includes('uciok')
  } catch {
    ok = false
  }
  probed.set(path, ok)
  return ok
}

export function bundledEngines(resourcesDir: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string[] {
  const dirs = [join(resourcesDir, 'bin'), join(resourcesDir, 'engines', `${platform}-${arch}`)]
  const names = platform === 'win32' ? ['stockfish-avx2.exe', 'stockfish-sse41.exe', 'stockfish.exe'] : ['stockfish']
  return dirs.flatMap((dir) => names.map((name) => join(dir, name)))
}

export function locateEngine(preferred: string | null, resourcesDir: string): string | null {
  for (const candidate of [preferred, process.env.STOCKFISH_PATH]) {
    if (candidate && existsSync(candidate) && isExecutable(candidate)) return candidate
  }
  const bundled = bundledEngines(resourcesDir).filter((candidate) => existsSync(candidate))
  for (const candidate of bundled) {
    if (process.platform !== 'win32' && !isExecutable(candidate)) continue
    if (bundled.length === 1 || probeEngine(candidate)) return candidate
  }
  const system = ['/opt/homebrew/bin/stockfish', '/usr/local/bin/stockfish', '/usr/games/stockfish', '/usr/bin/stockfish']
  for (const candidate of system) {
    if (existsSync(candidate) && isExecutable(candidate)) return candidate
  }
  if (process.platform === 'win32') return null
  try {
    const found = execFileSync('/usr/bin/which', ['stockfish'], { encoding: 'utf8' }).trim()
    if (found && isExecutable(found)) return found
  } catch {
    return null
  }
  return null
}

export function defaultThreads(): number {
  return Math.max(1, cpus().length - 1)
}

export function poolSizeFor(threads: number): number {
  return Math.max(1, Math.min(6, threads))
}

export class EngineService {
  private workers: Worker[] = []
  private queue: Task[] = []
  private liveEngine: UciEngine | null = null
  private liveSession: string | null = null
  private config: EngineConfig | null = null
  private statusValue: EngineStatus = { ready: false, path: null, name: null, threads: 0, hashMb: 0, workers: 0, error: null }
  private starting: Promise<EngineStatus> | null = null
  private cancelledJobs = new Set<string>()

  status(): EngineStatus {
    return this.statusValue
  }

  async start(config: EngineConfig): Promise<EngineStatus> {
    if (this.starting) await this.starting.catch(() => undefined)
    this.starting = this.boot(config)
    return this.starting
  }

  private async boot(config: EngineConfig): Promise<EngineStatus> {
    await this.shutdown()
    this.config = config
    if (!config.path) {
      this.statusValue = {
        ready: false,
        path: null,
        name: null,
        threads: 0,
        hashMb: 0,
        workers: 0,
        error: 'Stockfish не найден. Он должен лежать в папке resources/engines; можно также указать путь к движку в настройках.'
      }
      return this.statusValue
    }
    const poolSize = Math.max(1, config.poolSize)
    const threadsEach = Math.max(1, Math.floor(config.threads / poolSize))
    const hashEach = Math.max(16, Math.floor(config.hashMb / poolSize))
    try {
      for (let index = 0; index < poolSize; index += 1) {
        const engine = new UciEngine(config.path)
        await engine.start({ threads: threadsEach, hashMb: hashEach })
        const worker: Worker = { engine, task: null }
        engine.onExit(() => this.handleCrash(worker))
        this.workers.push(worker)
      }
      this.statusValue = {
        ready: true,
        path: config.path,
        name: this.workers[0]?.engine.name ?? 'Stockfish',
        threads: config.threads,
        hashMb: config.hashMb,
        workers: this.workers.length,
        error: null
      }
    } catch (error) {
      await this.shutdown()
      this.statusValue = {
        ready: false,
        path: config.path,
        name: null,
        threads: 0,
        hashMb: 0,
        workers: 0,
        error: `Не удалось запустить движок: ${(error as Error).message}`
      }
    }
    this.pump()
    return this.statusValue
  }

  private handleCrash(worker: Worker): void {
    const task = worker.task
    worker.task = null
    this.workers = this.workers.filter((candidate) => candidate !== worker)
    if (task) task.reject(new Error('Процесс движка неожиданно завершился'))
    if (!this.workers.length) {
      this.statusValue = { ...this.statusValue, ready: false, error: 'Движок завершился. Перезапустите его в настройках анализа.' }
      for (const queued of this.queue.splice(0)) queued.reject(new Error(this.statusValue.error ?? 'Движок недоступен'))
    }
  }

  analyze(fen: string, options: AnalysisOptions, jobId: string, priority: 'foreground' | 'background'): Promise<PositionAnalysis> {
    if (!this.statusValue.ready) return Promise.reject(new Error(this.statusValue.error ?? 'Движок не запущен'))
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, options, jobId, priority: priority === 'foreground' ? 0 : 1, resolve, reject })
      this.queue.sort((a, b) => a.priority - b.priority)
      this.pump()
    })
  }

  cancelJob(jobId: string): void {
    this.cancelledJobs.add(jobId)
    const cancelled = this.queue.filter((task) => task.jobId === jobId)
    this.queue = this.queue.filter((task) => task.jobId !== jobId)
    for (const task of cancelled) task.reject(new CancelledError())
    for (const worker of this.workers) {
      if (worker.task?.jobId === jobId) worker.engine.stop()
    }
  }

  private pump(): void {
    for (const worker of this.workers) {
      if (worker.task || !this.queue.length) continue
      const task = this.queue.shift()!
      worker.task = task
      const limits = task.options.movetimeMs ? { movetimeMs: task.options.movetimeMs } : { depth: task.options.depth }
      worker.engine
        .search(task.fen, limits, Math.max(1, task.options.multiPv))
        .then((analysis) => {
          if (worker.task !== task) return
          worker.task = null
          if (this.cancelledJobs.has(task.jobId)) task.reject(new CancelledError())
          else task.resolve(analysis)
        })
        .catch((error: Error) => {
          if (worker.task === task) worker.task = null
          task.reject(error)
        })
        .finally(() => this.pump())
    }
  }

  async startLive(sessionId: string, fen: string, multiPv: number, onUpdate: (analysis: PositionAnalysis) => void): Promise<void> {
    if (!this.config?.path || !this.statusValue.ready) throw new Error(this.statusValue.error ?? 'Движок не запущен')
    if (!this.liveEngine || !this.liveEngine.running) {
      this.liveEngine = new UciEngine(this.config.path)
      await this.liveEngine.start({ threads: this.config.threads, hashMb: this.config.hashMb })
    }
    this.liveSession = sessionId
    const engine = this.liveEngine
    let lastSent = 0
    let pending: InfoUpdate | null = null
    let timer: NodeJS.Timeout | null = null
    const flush = (): void => {
      timer = null
      if (!pending || this.liveSession !== sessionId) return
      lastSent = Date.now()
      onUpdate({ fen, depth: pending.depth, lines: pending.lines })
      pending = null
    }
    engine
      .search(fen, { infinite: true }, Math.max(1, multiPv), (update) => {
        if (this.liveSession !== sessionId) return
        pending = update
        const wait = 100 - (Date.now() - lastSent)
        if (wait <= 0) flush()
        else if (!timer) timer = setTimeout(flush, wait)
      })
      .catch(() => undefined)
  }

  stopLive(sessionId: string): void {
    if (this.liveSession !== sessionId) return
    this.liveSession = null
    this.liveEngine?.stop()
  }

  async shutdown(): Promise<void> {
    for (const task of this.queue.splice(0)) task.reject(new CancelledError())
    const workers = this.workers
    this.workers = []
    await Promise.all(workers.map((worker) => worker.engine.quit()))
    if (this.liveEngine) {
      await this.liveEngine.quit()
      this.liveEngine = null
    }
    this.statusValue = { ...this.statusValue, ready: false }
  }
}
