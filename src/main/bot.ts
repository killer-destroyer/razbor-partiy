import { botLevel, randomLegalMove } from '../renderer/play/levels'
import { UciEngine } from './uci'

export class BotService {
  private engine: UciEngine | null = null
  private enginePath: string | null = null
  private busy: Promise<unknown> = Promise.resolve()

  constructor(private readonly locate: () => string | null) {}

  private async ensure(): Promise<UciEngine> {
    const path = this.locate()
    if (!path) throw new Error('Stockfish не найден')
    if (this.engine && this.engine.running && this.enginePath === path) return this.engine
    await this.engine?.quit()
    const engine = new UciEngine(path)
    await engine.start({ threads: 1, hashMb: 64 })
    this.engine = engine
    this.enginePath = path
    return engine
  }

  move(fen: string, level: number): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      const settings = botLevel(level)
      if (settings.randomChance > 0 && Math.random() < settings.randomChance) return randomLegalMove(fen)
      const engine = await this.ensure()
      engine.setOption('Skill Level', settings.skill)
      await engine.ready()
      const analysis = await engine.search(fen, { depth: settings.depth, movetimeMs: settings.movetimeMs }, 1)
      return analysis.bestMove ?? analysis.lines[0]?.pv[0] ?? randomLegalMove(fen)
    }
    const next = this.busy.then(run, run)
    this.busy = next.catch(() => undefined)
    return next
  }

  async newGame(): Promise<void> {
    const engine = await this.ensure()
    await engine.newGame()
  }

  async shutdown(): Promise<void> {
    await this.engine?.quit()
    this.engine = null
  }
}
