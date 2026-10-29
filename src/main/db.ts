import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { StatsRow } from '../shared/api'
import type { OpeningIndexPayload, PositionAnalysis, RepertoireEntry, StoredGame, TrainerCard } from '../shared/types'
import type { PositionCache } from './analyzer'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  end_time INTEGER,
  imported_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_order ON games (COALESCE(end_time, imported_at) DESC);
CREATE TABLE IF NOT EXISTS analyses (
  game_id TEXT PRIMARY KEY,
  depth INTEGER NOT NULL,
  positions TEXT NOT NULL,
  review TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS position_cache (
  key TEXT PRIMARY KEY,
  depth INTEGER NOT NULL,
  multipv INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS openings (
  id INTEGER PRIMARY KEY,
  eco TEXT NOT NULL,
  name TEXT NOT NULL,
  pgn TEXT NOT NULL,
  uci TEXT NOT NULL,
  epd TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS opening_positions (
  epd TEXT NOT NULL,
  opening_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS opening_positions_epd ON opening_positions (epd);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  theme TEXT,
  easiness REAL NOT NULL,
  interval_days REAL NOT NULL,
  repetitions INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS puzzle_progress (
  id TEXT PRIMARY KEY,
  solved INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS repertoire (
  opening_id INTEGER PRIMARY KEY,
  color TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
`

export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 5).join(' ')
}

export function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

interface CardRow {
  id: string
  kind: TrainerCard['kind']
  payload: string
  theme: string | null
  easiness: number
  interval_days: number
  repetitions: number
  due_at: number
  lapses: number
  created_at: number
}

export class AppDatabase implements PositionCache {
  private readonly db: Database.Database

  constructor(file: string) {
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  getValue<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value) as T
    } catch {
      return null
    }
  }

  setValue(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
  }

  recordPuzzle(id: string, solved: boolean): void {
    this.db
      .prepare(
        'INSERT INTO puzzle_progress (id, solved, attempts, last_at) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET solved = MAX(solved, excluded.solved), attempts = attempts + 1, last_at = excluded.last_at'
      )
      .run(id, solved ? 1 : 0, Date.now())
  }

  puzzleProgress(): Array<{ id: string; solved: boolean }> {
    const rows = this.db.prepare('SELECT id, solved FROM puzzle_progress').all() as Array<{ id: string; solved: number }>
    return rows.map((row) => ({ id: row.id, solved: row.solved === 1 }))
  }

  deleteValue(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key)
  }

  listGames(limit: number): StoredGame[] {
    const rows = this.db
      .prepare('SELECT data FROM games ORDER BY COALESCE(end_time, imported_at) DESC LIMIT ?')
      .all(limit) as Array<{ data: string }>
    return rows.map((row) => JSON.parse(row.data) as StoredGame)
  }

  getGame(id: string): StoredGame | null {
    const row = this.db.prepare('SELECT data FROM games WHERE id = ?').get(id) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as StoredGame) : null
  }

  hasGame(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM games WHERE id = ?').get(id))
  }

  saveGame(game: StoredGame): void {
    this.db
      .prepare(
        'INSERT INTO games (id, data, end_time, imported_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, end_time = excluded.end_time'
      )
      .run(game.id, JSON.stringify(game), game.endTime, game.importedAt)
  }

  deleteGame(id: string): void {
    this.db.prepare('DELETE FROM games WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM analyses WHERE game_id = ?').run(id)
  }

  getAnalysis(gameId: string): { depth: number; positions: PositionAnalysis[]; reviewJson: string | null } | null {
    const row = this.db.prepare('SELECT depth, positions, review FROM analyses WHERE game_id = ?').get(gameId) as
      | { depth: number; positions: string; review: string | null }
      | undefined
    if (!row) return null
    return { depth: row.depth, positions: JSON.parse(row.positions) as PositionAnalysis[], reviewJson: row.review }
  }

  saveAnalysis(gameId: string, depth: number, positions: PositionAnalysis[], reviewJson: string | null): void {
    this.db
      .prepare(
        'INSERT INTO analyses (game_id, depth, positions, review, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET depth = excluded.depth, positions = excluded.positions, review = excluded.review, updated_at = excluded.updated_at'
      )
      .run(gameId, depth, JSON.stringify(positions), reviewJson, Date.now())
  }

  lookup(fens: string[], minDepth: number, multiPv: number): Array<PositionAnalysis | null> {
    const statement = this.db.prepare('SELECT depth, multipv, data FROM position_cache WHERE key = ?')
    return fens.map((fen) => {
      const row = statement.get(positionKey(fen)) as { depth: number; multipv: number; data: string } | undefined
      if (!row || row.depth < minDepth || row.multipv < multiPv) return null
      const analysis = JSON.parse(row.data) as PositionAnalysis
      return { ...analysis, fen }
    })
  }

  store(analysis: PositionAnalysis, multiPv: number): void {
    const key = positionKey(analysis.fen)
    const existing = this.db.prepare('SELECT depth, multipv FROM position_cache WHERE key = ?').get(key) as
      | { depth: number; multipv: number }
      | undefined
    if (existing && existing.depth >= analysis.depth && existing.multipv >= multiPv) return
    this.db
      .prepare(
        'INSERT INTO position_cache (key, depth, multipv, data) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET depth = excluded.depth, multipv = excluded.multipv, data = excluded.data'
      )
      .run(key, analysis.depth, multiPv, JSON.stringify(analysis))
  }

  openingsVersion(): string | null {
    return this.getValue<string>('openings.version')
  }

  replaceOpenings(payload: OpeningIndexPayload, version: string): void {
    const insertOpening = this.db.prepare('INSERT INTO openings (id, eco, name, pgn, uci, epd) VALUES (?, ?, ?, ?, ?, ?)')
    const insertPosition = this.db.prepare('INSERT INTO opening_positions (epd, opening_id) VALUES (?, ?)')
    this.db.transaction(() => {
      this.db.exec('DELETE FROM openings; DELETE FROM opening_positions;')
      for (const opening of payload.openings) {
        insertOpening.run(opening.id, opening.eco, opening.name, opening.pgn, opening.uci.join(' '), opening.epd)
      }
      for (const [epd, ids] of payload.positions) {
        for (const id of ids) insertPosition.run(epd, id)
      }
    })()
    this.setValue('openings.version', version)
  }

  openingIndex(): OpeningIndexPayload {
    const openings = (
      this.db.prepare('SELECT id, eco, name, pgn, uci, epd FROM openings ORDER BY id').all() as Array<{
        id: number
        eco: string
        name: string
        pgn: string
        uci: string
        epd: string
      }>
    ).map((row) => ({ ...row, uci: row.uci ? row.uci.split(' ') : [] }))
    const grouped = new Map<string, number[]>()
    for (const row of this.db.prepare('SELECT epd, opening_id FROM opening_positions').all() as Array<{ epd: string; opening_id: number }>) {
      const list = grouped.get(row.epd) ?? []
      list.push(row.opening_id)
      grouped.set(row.epd, list)
    }
    return { openings, positions: [...grouped.entries()] }
  }

  listCards(kind: TrainerCard['kind'] | null): TrainerCard[] {
    const rows = (
      kind
        ? this.db.prepare('SELECT * FROM cards WHERE kind = ? ORDER BY due_at').all(kind)
        : this.db.prepare('SELECT * FROM cards ORDER BY due_at').all()
    ) as CardRow[]
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: row.payload,
      theme: row.theme,
      easiness: row.easiness,
      intervalDays: row.interval_days,
      repetitions: row.repetitions,
      dueAt: row.due_at,
      lapses: row.lapses,
      createdAt: row.created_at
    }))
  }

  upsertCard(card: TrainerCard): void {
    this.db
      .prepare(
        `INSERT INTO cards (id, kind, payload, theme, easiness, interval_days, repetitions, due_at, lapses, created_at)
         VALUES (@id, @kind, @payload, @theme, @easiness, @intervalDays, @repetitions, @dueAt, @lapses, @createdAt)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, theme = excluded.theme, easiness = excluded.easiness,
           interval_days = excluded.interval_days, repetitions = excluded.repetitions, due_at = excluded.due_at, lapses = excluded.lapses`
      )
      .run(card)
  }

  hasCard(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(id))
  }

  deleteCard(id: string): void {
    this.db.prepare('DELETE FROM cards WHERE id = ?').run(id)
  }

  listRepertoire(): RepertoireEntry[] {
    return (this.db.prepare('SELECT opening_id, color, added_at FROM repertoire').all() as Array<{ opening_id: number; color: 'w' | 'b'; added_at: number }>).map(
      (row) => ({ openingId: row.opening_id, color: row.color, addedAt: row.added_at })
    )
  }

  setRepertoire(openingId: number, color: 'w' | 'b' | null): void {
    if (!color) {
      this.db.prepare('DELETE FROM repertoire WHERE opening_id = ?').run(openingId)
      return
    }
    this.db
      .prepare('INSERT INTO repertoire (opening_id, color, added_at) VALUES (?, ?, ?) ON CONFLICT(opening_id) DO UPDATE SET color = excluded.color')
      .run(openingId, color, Date.now())
  }

  statsRows(): StatsRow[] {
    const rows = this.db
      .prepare('SELECT g.data AS data, a.review AS review FROM games g LEFT JOIN analyses a ON a.game_id = g.id ORDER BY COALESCE(g.end_time, g.imported_at)')
      .all() as Array<{ data: string; review: string | null }>
    return rows.map((row) => {
      const game = JSON.parse(row.data) as StoredGame
      const review = row.review ? (JSON.parse(row.review) as { firstSeriousMistakeMove?: number | null; moves?: unknown }) : null
      const accuracy = game.userColor === 'w' ? game.accuracyWhite : game.userColor === 'b' ? game.accuracyBlack : null
      return {
        id: game.id,
        endTime: game.endTime,
        importedAt: game.importedAt,
        timeClass: game.timeClass,
        userColor: game.userColor,
        result: game.result,
        white: game.white,
        black: game.black,
        openingName: game.openingName,
        accuracy,
        firstSeriousMistakeMove: review?.firstSeriousMistakeMove ?? null,
        movesJson: review?.moves ? JSON.stringify(review.moves) : null
      }
    })
  }
}
