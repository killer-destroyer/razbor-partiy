import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PositionAnalysis, Score } from '@shared/types'
import { buildOpeningIndex, OpeningBook, parseOpeningsTsv } from '@renderer/openings/book'

let cachedBook: OpeningBook | null = null

export function loadBook(): OpeningBook {
  if (cachedBook) return cachedBook
  const rows = ['a', 'b', 'c', 'd', 'e'].flatMap((letter) => parseOpeningsTsv(readFileSync(resolve(__dirname, `../resources/openings/${letter}.tsv`), 'utf8')))
  cachedBook = new OpeningBook(buildOpeningIndex(rows))
  return cachedBook
}

export function cpForWinPercent(whiteWin: number): number {
  const x = (whiteWin - 50) / 50
  return Math.round(Math.log((1 + x) / (1 - x)) / 0.00368208)
}

export function position(fen: string, score: Score, pv: string[], second?: { score: Score; pv: string[] }): PositionAnalysis {
  const lines = [{ multipv: 1, depth: 20, score, pv }]
  if (second) lines.push({ multipv: 2, depth: 20, score: second.score, pv: second.pv })
  return { fen, depth: 20, lines }
}

export const cp = (value: number): Score => ({ type: 'cp', cp: value })
