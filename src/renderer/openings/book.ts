import { Chess } from 'chess.js'
import type { OpeningIndexPayload, OpeningRecord } from '@shared/types'
import { fenToEpd } from '../analysis/pgn'
import { translateOpeningName } from './translate'

export interface OpeningRow {
  eco: string
  name: string
  pgn: string
}

export function parseOpeningsTsv(text: string): OpeningRow[] {
  const rows: OpeningRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [eco, name, pgn] = line.split('\t')
    if (!eco || !name || !pgn || eco === 'eco') continue
    rows.push({ eco: eco.trim(), name: name.trim(), pgn: pgn.trim() })
  }
  return rows
}

export function sansFromOpeningPgn(pgn: string): string[] {
  return pgn
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function buildOpeningIndex(rows: OpeningRow[]): OpeningIndexPayload {
  const openings: OpeningRecord[] = []
  const positions = new Map<string, Set<number>>()
  rows.forEach((row, index) => {
    const board = new Chess()
    const uci: string[] = []
    const id = index + 1
    for (const san of sansFromOpeningPgn(row.pgn)) {
      const move = board.move(san)
      uci.push(move.from + move.to + (move.promotion ?? ''))
      const epd = fenToEpd(board.fen())
      const holders = positions.get(epd) ?? new Set<number>()
      holders.add(id)
      positions.set(epd, holders)
    }
    openings.push({ id, eco: row.eco, name: row.name, pgn: row.pgn, uci, epd: fenToEpd(board.fen()) })
  })
  return {
    openings,
    positions: [...positions.entries()].map(([epd, ids]) => [epd, [...ids]])
  }
}

export interface OpeningDetection {
  opening: OpeningRecord | null
  nameRu: string | null
  bookPlies: number
  exitPly: number | null
  matchedPlies: number[]
}

export class OpeningBook {
  readonly openings: OpeningRecord[]
  readonly byId: Map<number, OpeningRecord>
  readonly passing: Map<string, number[]>
  readonly finals: Map<string, OpeningRecord[]>

  constructor(payload: OpeningIndexPayload) {
    this.openings = payload.openings
    this.byId = new Map(payload.openings.map((opening) => [opening.id, opening]))
    this.passing = new Map(payload.positions)
    this.finals = new Map()
    for (const opening of payload.openings) {
      const list = this.finals.get(opening.epd) ?? []
      list.push(opening)
      this.finals.set(opening.epd, list)
    }
  }

  isBookPosition(fen: string): boolean {
    return this.passing.has(fenToEpd(fen))
  }

  namedAt(fen: string, playedUci: string[] = []): OpeningRecord | null {
    const candidates = this.finals.get(fenToEpd(fen))
    if (!candidates?.length) return null
    const exact = candidates.find(
      (candidate) => candidate.uci.length === playedUci.length && candidate.uci.every((move, index) => move === playedUci[index])
    )
    return exact ?? [...candidates].sort((a, b) => a.uci.length - b.uci.length)[0]
  }

  detect(fens: string[], playedUci: string[] = []): OpeningDetection {
    let opening: OpeningRecord | null = null
    let bookPlies = 0
    let misses = 0
    const matchedPlies: number[] = []
    for (let ply = 1; ply < fens.length; ply += 1) {
      if (this.isBookPosition(fens[ply])) {
        misses = 0
        bookPlies = ply
        matchedPlies.push(ply)
        const named = this.namedAt(fens[ply], playedUci.slice(0, ply))
        if (named) opening = named
        continue
      }
      misses += 1
      if (misses >= 2) break
    }
    const exitPly = bookPlies + 1 < fens.length ? bookPlies + 1 : null
    return { opening, nameRu: opening ? translateOpeningName(opening.name) : null, bookPlies, exitPly, matchedPlies }
  }

  continuations(fen: string): OpeningRecord[] {
    const ids = this.passing.get(fenToEpd(fen)) ?? []
    return ids.map((id) => this.byId.get(id)).filter((opening): opening is OpeningRecord => Boolean(opening))
  }
}
