import type { ChesscomClient } from './chesscom'
import type { AppDatabase } from './db'
import { storedFromChesscom } from '../renderer/analysis/games'

export const WATCH_INTERVAL_MS = 60_000

export class GameWatcher {
  private timer: NodeJS.Timeout | null = null
  private username = ''
  private checking = false

  constructor(
    private readonly client: ChesscomClient,
    private readonly db: AppDatabase,
    private readonly onNewGames: (gameIds: string[]) => void,
    private readonly onStatus: (status: string) => void
  ) {}

  get active(): boolean {
    return this.timer !== null
  }

  async start(username: string): Promise<void> {
    this.stop()
    this.username = username.trim()
    if (!this.username) {
      this.onStatus('Укажите ник chess.com, чтобы следить за партиями')
      return
    }
    const key = this.lastSeenKey()
    if (this.db.getValue<number>(key) === null) await this.establishBaseline()
    this.timer = setInterval(() => void this.check(), WATCH_INTERVAL_MS)
    this.onStatus(`Слежу за новыми партиями ${this.username}`)
    await this.check()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private lastSeenKey(): string {
    return `watch.lastSeen.${this.username.toLowerCase()}`
  }

  private monthUrls(): string[] {
    const now = new Date()
    const urls = [this.client.monthUrl(this.username, now)]
    if (now.getUTCDate() <= 1) {
      const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))
      urls.unshift(this.client.monthUrl(this.username, previous))
    }
    return urls
  }

  private async establishBaseline(): Promise<void> {
    try {
      const games = (await Promise.all(this.monthUrls().map((url) => this.client.month(url).catch(() => [])))).flat()
      const latest = games.reduce((max, game) => Math.max(max, game.endTime), 0)
      this.db.setValue(this.lastSeenKey(), latest || Math.floor(Date.now() / 1000))
    } catch {
      this.db.setValue(this.lastSeenKey(), Math.floor(Date.now() / 1000))
    }
  }

  async check(): Promise<void> {
    if (this.checking || !this.username) return
    this.checking = true
    try {
      const lastSeen = this.db.getValue<number>(this.lastSeenKey()) ?? 0
      const games = []
      for (const url of this.monthUrls()) games.push(...(await this.client.month(url).catch(() => [])))
      const fresh = games.filter((game) => game.endTime > lastSeen && game.rules === 'chess').sort((a, b) => a.endTime - b.endTime)
      const newIds: string[] = []
      for (const summary of fresh) {
        const stored = storedFromChesscom(summary, this.username)
        if (!this.db.hasGame(stored.id)) {
          this.db.saveGame(stored)
          newIds.push(stored.id)
        }
      }
      if (fresh.length) this.db.setValue(this.lastSeenKey(), fresh[fresh.length - 1].endTime)
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      this.onStatus(newIds.length ? `Найдено новых партий: ${newIds.length} (${time})` : `Проверено в ${time}, новых партий нет`)
      if (newIds.length) this.onNewGames(newIds)
    } catch (error) {
      this.onStatus(`Ошибка проверки: ${(error as Error).message}`)
    } finally {
      this.checking = false
    }
  }
}
