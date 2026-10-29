import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import {
  checkPuzzleMove,
  compositionToPuzzle,
  matchesCategory,
  parsePuzzlesTsv,
  PUZZLE_CATEGORIES,
  puzzleStartFen,
  solutionMoves,
  solverColor,
  updatePuzzleRating,
  type CompositionRecord,
  type PuzzleRecord
} from '../src/renderer/puzzles/catalog'

const puzzles = parsePuzzlesTsv(gunzipSync(readFileSync(resolve('resources/puzzles/puzzles.tsv.gz'))).toString('utf8'))
const compositions = (JSON.parse(readFileSync(resolve('resources/puzzles/compositions.json'), 'utf8')) as CompositionRecord[]).map(compositionToPuzzle)

function play(puzzle: PuzzleRecord): Chess {
  const board = new Chess(puzzle.fen)
  for (const uci of puzzle.moves) board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return board
}

describe('база задач', () => {
  it('содержит много задач всех уровней', () => {
    expect(puzzles.length).toBeGreaterThan(80000)
    expect(puzzles.filter((puzzle) => puzzle.rating < 800).length).toBeGreaterThan(3000)
    expect(puzzles.filter((puzzle) => puzzle.rating >= 2400).length).toBeGreaterThan(3000)
  })

  it('в каждом разделе есть задачи', () => {
    for (const category of PUZZLE_CATEGORIES.filter((entry) => entry.group !== 'mine')) {
      const count = [...puzzles, ...compositions].filter((puzzle) => matchesCategory(puzzle, category)).length
      expect(count, category.label).toBeGreaterThan(10)
    }
  })

  it('ходы легальны, а задачи на мат заканчиваются матом', () => {
    const sample = puzzles.filter((_, index) => index % 25 === 0)
    for (const puzzle of sample) {
      const board = play(puzzle)
      if (puzzle.themes.some((theme) => /^mateIn\d$/.test(theme))) expect(board.isCheckmate(), puzzle.id).toBe(true)
    }
  })

  it('композиции легальны и решаются за сторону, которая ходит первой', () => {
    expect(compositions.length).toBeGreaterThanOrEqual(10)
    for (const puzzle of compositions) {
      const board = play(puzzle)
      if (puzzle.themes.some((theme) => theme.startsWith('mateIn'))) expect(board.isCheckmate(), puzzle.id).toBe(true)
      expect(solverColor(puzzle)).toBe(puzzle.fen.split(' ')[1])
      expect(puzzleStartFen(puzzle)).toBe(puzzle.fen)
    }
  })
})

describe('решение задачи', () => {
  const puzzle: PuzzleRecord = {
    id: 'test',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1',
    moves: ['g8f8', 'a1a8'],
    rating: 600,
    themes: ['mateIn1', 'backRankMate'],
    setupMove: true
  }

  it('первый ход делает соперник, решает другая сторона', () => {
    expect(solverColor(puzzle)).toBe('w')
    expect(solutionMoves(puzzle)).toEqual(['a1a8'])
    expect(puzzleStartFen(puzzle).split(' ')[1]).toBe('w')
  })

  it('принимает верный ход и любой мат последним ходом', () => {
    const start = puzzleStartFen(puzzle)
    expect(checkPuzzleMove(start, ['a1a8'], 0, 'a1a8')).toBe('solved')
    expect(checkPuzzleMove(start, ['a1a8'], 0, 'a1a7')).toBe('wrong')
    expect(checkPuzzleMove(start, ['a1b1', 'f8e8', 'b1b8'], 0, 'a1a8')).toBe('wrong')
    expect(checkPuzzleMove(start, ['a1b1', 'f8e8', 'b1b8'], 0, 'a1b1')).toBe('correct')
  })

  it('рейтинг решения растёт за решённую и падает за нерешённую задачу', () => {
    expect(updatePuzzleRating(1000, 1000, true, 0)).toBeGreaterThan(1000)
    expect(updatePuzzleRating(1000, 1000, false, 0)).toBeLessThan(1000)
    expect(updatePuzzleRating(1000, 1600, true, 200)).toBeGreaterThan(updatePuzzleRating(1000, 600, true, 200))
  })
})

describe('поиск движка', async () => {
  const { bundledEngines } = await import('../src/main/engine')
  it('на Windows сначала пробует AVX2, потом запасную сборку', () => {
    const list = bundledEngines('/r', 'win32', 'x64').map((path) => path.replace(/\\/g, '/'))
    expect(list.slice(0, 2)).toEqual(['/r/bin/stockfish-avx2.exe', '/r/bin/stockfish-sse41.exe'])
    expect(list).toContain('/r/engines/win32-x64/stockfish-avx2.exe')
  })
  it('на Mac берёт встроенный stockfish', () => {
    expect(bundledEngines('/r', 'darwin', 'arm64').map((path) => path.replace(/\\/g, '/'))).toEqual(['/r/bin/stockfish', '/r/engines/darwin-arm64/stockfish'])
  })
})
