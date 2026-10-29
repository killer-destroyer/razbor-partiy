import type { BackgroundState } from '../shared/api'
import { REVIEW_MULTIPV, type Settings } from '../shared/settings'
import type { StoredGame } from '../shared/types'
import { compactReview } from '../renderer/analysis/compact'
import { parsePgn } from '../renderer/analysis/pgn'
import { buildReview } from '../renderer/analysis/review'
import type { OpeningBook } from '../renderer/openings/book'
import { analyzeFens } from './analyzer'
import type { AppDatabase } from './db'
import type { EngineService } from './engine'

export interface BackgroundResult {
  game: StoredGame
  accuracy: number | null
  error: string | null
}

export class BackgroundAnalyzer {
  private queue: string[] = []
  private running = false
  private state: BackgroundState = { queued: 0, current: null, currentProgress: 0, lastFinished: null }
  private listeners = new Set<(result: BackgroundResult) => void>()

  constructor(
    private readonly db: AppDatabase,
    private readonly engine: EngineService,
    private readonly book: () => OpeningBook | null,
    private readonly settings: () => Settings,
    private readonly publish: (state: BackgroundState) => void
  ) {}

  snapshot(): BackgroundState {
    return { ...this.state, queued: this.queue.length }
  }

  onFinished(listener: (result: BackgroundResult) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(gameIds: string[]): void {
    for (const id of gameIds) if (!this.queue.includes(id) && this.state.current !== id) this.queue.push(id)
    this.emit()
    void this.drain()
  }

  private emit(): void {
    this.publish(this.snapshot())
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!
        this.state = { ...this.state, current: id, currentProgress: 0 }
        this.emit()
        const result = await this.process(id)
        this.state = { ...this.state, current: null, currentProgress: 0, lastFinished: { gameId: id, accuracy: result?.accuracy ?? null, error: result?.error ?? null } }
        this.emit()
        if (result) for (const listener of this.listeners) listener(result)
      }
    } finally {
      this.running = false
    }
  }

  private async process(id: string): Promise<BackgroundResult | null> {
    const game = this.db.getGame(id)
    if (!game) return null
    const settings = this.settings()
    try {
      const parsed = parsePgn(game.pgn)
      const options = {
        depth: settings.analysisDepth,
        movetimeMs: settings.analysisLimit === 'time' ? settings.analysisMovetimeMs : null,
        multiPv: REVIEW_MULTIPV
      }
      let done = 0
      const positions = await analyzeFens(this.engine, this.db, parsed.fens, options, `bg:${id}`, 'background', () => {
        done += 1
        const progress = done / parsed.fens.length
        if (progress - this.state.currentProgress >= 0.05 || done === parsed.fens.length) {
          this.state = { ...this.state, currentProgress: progress }
          this.emit()
        }
      })
      const book = this.book()
      const opening = book ? book.detect(parsed.fens, parsed.moves.map((move) => move.uci)) : null
      const review = buildReview({ game: parsed, positions, opening, userColor: game.userColor, profile: settings.classificationProfile })
      const compact = compactReview(review)
      this.db.saveAnalysis(id, options.depth, positions, JSON.stringify(compact))
      const updated: StoredGame = {
        ...game,
        openingName: opening?.nameRu ?? game.openingName,
        accuracyWhite: review.white.accuracy,
        accuracyBlack: review.black.accuracy,
        ratingWhite: review.white.rating,
        ratingBlack: review.black.rating,
        analyzedDepth: options.depth
      }
      this.db.saveGame(updated)
      const accuracy = game.userColor === 'b' ? review.black.accuracy : review.white.accuracy
      return { game: updated, accuracy, error: null }
    } catch (error) {
      return { game, accuracy: null, error: (error as Error).message }
    }
  }
}
