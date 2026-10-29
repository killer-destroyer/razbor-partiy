import type { ChesscomGameSummary, TimeClass } from '../shared/types'

export const ALLOWED_HOSTS = new Set(['api.chess.com'])
export const USER_AGENT = 'RazborPartiy/1.0 (lichnoe prilozhenie; personal use)'

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

interface RawPlayer {
  username: string
  rating: number
  result: string
}

interface RawGame {
  url: string
  pgn?: string
  time_control: string
  time_class: string
  end_time: number
  rated: boolean
  rules: string
  eco?: string
  white: RawPlayer
  black: RawPlayer
  accuracies?: { white: number; black: number }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function normalizeTimeClass(value: string): TimeClass {
  if (value === 'bullet' || value === 'blitz' || value === 'rapid' || value === 'daily') return value
  if (value === 'classical' || value === 'standard') return 'classical'
  return 'unknown'
}

export function toSummary(raw: RawGame): ChesscomGameSummary | null {
  if (!raw.pgn) return null
  const ecoFromPgn = raw.pgn.match(/\[ECOUrl "([^"]+)"\]/)?.[1] ?? null
  return {
    url: raw.url,
    pgn: raw.pgn,
    timeControl: raw.time_control,
    timeClass: normalizeTimeClass(raw.time_class),
    endTime: raw.end_time,
    rated: raw.rated,
    rules: raw.rules,
    white: { username: raw.white.username, rating: raw.white.rating, result: raw.white.result },
    black: { username: raw.black.username, rating: raw.black.rating, result: raw.black.result },
    accuracies: raw.accuracies ? { white: raw.accuracies.white, black: raw.accuracies.black } : null,
    ecoUrl: raw.eco ?? ecoFromPgn
  }
}

export function parseGameUrl(url: string): { id: string; kind: 'live' | 'daily'; username: string | null } | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (!/(^|\.)chess\.com$/.test(parsed.hostname)) return null
  const match = parsed.pathname.match(/\/game\/(live|daily)\/(\d+)/) ?? parsed.pathname.match(/\/(live|daily)\/game\/(\d+)/)
  const plain = parsed.pathname.match(/\/game\/(\d+)/)
  const username = parsed.searchParams.get('username') ?? parsed.searchParams.get('player') ?? null
  if (match) return { kind: match[1] as 'live' | 'daily', id: match[2], username }
  if (plain) return { kind: 'live', id: plain[1], username }
  return null
}

export class ChesscomClient {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly fetcher: FetchLike) {}

  private request<T>(url: string): Promise<T> {
    const run = async (): Promise<T> => {
      const host = new URL(url).hostname
      if (!ALLOWED_HOSTS.has(host)) throw new Error(`Хост ${host} не разрешён`)
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await this.fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after'))
          await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1))
          continue
        }
        if (response.status === 404) throw new Error('Игрок не найден на chess.com')
        if (response.status === 410) throw new Error('Данные больше недоступны на chess.com')
        if (response.status >= 400) throw new Error(`chess.com ответил ошибкой ${response.status}`)
        return (await response.json()) as T
      }
      throw new Error('chess.com ограничил число запросов, попробуйте позже')
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }

  async archives(username: string): Promise<string[]> {
    const nick = encodeURIComponent(username.trim().toLowerCase())
    const data = await this.request<{ archives?: string[] }>(`https://api.chess.com/pub/player/${nick}/games/archives`)
    return data.archives ?? []
  }

  async month(archiveUrl: string): Promise<ChesscomGameSummary[]> {
    const data = await this.request<{ games?: RawGame[] }>(archiveUrl)
    return (data.games ?? []).map(toSummary).filter((game): game is ChesscomGameSummary => game !== null)
  }

  monthUrl(username: string, date: Date): string {
    const nick = encodeURIComponent(username.trim().toLowerCase())
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    return `https://api.chess.com/pub/player/${nick}/games/${date.getUTCFullYear()}/${month}`
  }

  async recentGames(username: string, limit: number): Promise<ChesscomGameSummary[]> {
    const archives = await this.archives(username)
    const collected: ChesscomGameSummary[] = []
    for (const archive of [...archives].reverse()) {
      const games = await this.month(archive)
      collected.push(...games)
      if (collected.length >= limit) break
    }
    return collected
      .filter((game) => game.rules === 'chess')
      .sort((a, b) => b.endTime - a.endTime)
      .slice(0, limit)
  }

  async findGame(url: string, fallbackUsername: string): Promise<ChesscomGameSummary | null> {
    const parsed = parseGameUrl(url)
    if (!parsed) return null
    const username = parsed.username ?? fallbackUsername
    if (!username) return null
    const archives = await this.archives(username)
    for (const archive of [...archives].reverse()) {
      const games = await this.month(archive)
      const found = games.find((game) => game.url.endsWith(`/${parsed.id}`))
      if (found) return found
    }
    return null
  }
}
