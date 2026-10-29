import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { PuzzleCatalog, PuzzleResult, PuzzleStats } from '../shared/api'
import {
  compositionToPuzzle,
  difficultyWindow,
  matchesCategory,
  parsePuzzlesTsv,
  PUZZLE_CATEGORIES,
  updatePuzzleRating,
  type CompositionRecord,
  type PuzzleCategory,
  type PuzzleDifficulty,
  type PuzzleRecord
} from '../renderer/puzzles/catalog'
import type { AppDatabase } from './db'

const STATS_KEY = 'puzzles.stats'
const DEFAULT_STATS: PuzzleStats = { rating: 1000, games: 0, solved: 0, failed: 0, streak: 0, bestStreak: 0 }

export class PuzzleService {
  private puzzles: PuzzleRecord[] | null = null
  private byId = new Map<string, PuzzleRecord>()
  private indexById = new Map<string, number>()
  private members = new Map<string, number[]>()

  constructor(
    private readonly dir: string,
    private readonly database: () => AppDatabase
  ) {}

  private load(): PuzzleRecord[] {
    if (this.puzzles) return this.puzzles
    const list: PuzzleRecord[] = []
    const archive = join(this.dir, 'puzzles.tsv.gz')
    if (existsSync(archive)) list.push(...parsePuzzlesTsv(gunzipSync(readFileSync(archive)).toString('utf8')))
    const compositions = join(this.dir, 'compositions.json')
    if (existsSync(compositions)) list.push(...(JSON.parse(readFileSync(compositions, 'utf8')) as CompositionRecord[]).map(compositionToPuzzle))
    this.puzzles = list
    list.forEach((puzzle, index) => {
      this.byId.set(puzzle.id, puzzle)
      this.indexById.set(puzzle.id, index)
    })
    for (const category of PUZZLE_CATEGORIES) {
      if (category.group === 'mine') continue
      const indices: number[] = []
      list.forEach((puzzle, index) => {
        if (matchesCategory(puzzle, category)) indices.push(index)
      })
      this.members.set(category.id, indices)
    }
    return list
  }

  stats(): PuzzleStats {
    return { ...DEFAULT_STATS, ...(this.database().getValue<PuzzleStats>(STATS_KEY) ?? {}) }
  }

  catalog(): PuzzleCatalog {
    const list = this.load()
    const progress = this.database().puzzleProgress()
    const solvedIndices = new Set(progress.filter((entry) => entry.solved).map((entry) => this.indexById.get(entry.id)).filter((index): index is number => index !== undefined))
    return {
      categories: PUZZLE_CATEGORIES.map((category) => {
        const indices = category.group === 'mine' ? null : (this.members.get(category.id) ?? [])
        return {
          ...category,
          total: indices ? indices.length : list.length,
          solved: indices ? indices.filter((index) => solvedIndices.has(index)).length : solvedIndices.size
        }
      }),
      stats: this.stats()
    }
  }

  next(categoryId: string, difficulty: PuzzleDifficulty, excludeId: string | null): PuzzleRecord | null {
    const list = this.load()
    const category: PuzzleCategory | undefined = PUZZLE_CATEGORIES.find((entry) => entry.id === categoryId)
    if (!category) return null
    const stats = this.stats()
    const attempted = new Map(this.database().puzzleProgress().map((entry) => [entry.id, entry.solved]))
    const pool = category.group === 'mine' ? list.map((_, index) => index).filter((index) => list[index].setupMove) : (this.members.get(category.id) ?? [])
    const ordered = category.group === 'composition'
    const window =
      category.group === 'mine'
        ? ([stats.rating - 150, stats.rating + 150] as [number, number])
        : category.group === 'level' || ordered
          ? null
          : difficultyWindow(difficulty, stats.rating)
    const pick = (filter: (puzzle: PuzzleRecord) => boolean): PuzzleRecord | null => {
      const candidates = pool.map((index) => list[index]).filter((puzzle) => puzzle.id !== excludeId && filter(puzzle))
      if (!candidates.length) return null
      if (ordered) return candidates[0]
      return candidates[Math.floor(Math.random() * candidates.length)]
    }
    const inWindow = (puzzle: PuzzleRecord, range: [number, number] | null): boolean => !range || (puzzle.rating >= range[0] && puzzle.rating <= range[1])
    const widened = window ? ([window[0] - 300, window[1] + 300] as [number, number]) : null
    return (
      pick((puzzle) => !attempted.has(puzzle.id) && inWindow(puzzle, window)) ??
      pick((puzzle) => !attempted.has(puzzle.id) && inWindow(puzzle, widened)) ??
      pick((puzzle) => !attempted.has(puzzle.id)) ??
      pick((puzzle) => attempted.get(puzzle.id) === false) ??
      pick(() => true)
    )
  }

  record(id: string, solved: boolean): PuzzleResult {
    this.load()
    const puzzle = this.byId.get(id)
    const before = this.stats()
    const database = this.database()
    const firstTry = !database.puzzleProgress().some((entry) => entry.id === id)
    database.recordPuzzle(id, solved)
    if (!puzzle || !firstTry) return { stats: before, ratingChange: 0 }
    const rating = updatePuzzleRating(before.rating, puzzle.rating, solved, before.games)
    const streak = solved ? before.streak + 1 : 0
    const stats: PuzzleStats = {
      rating,
      games: before.games + 1,
      solved: before.solved + (solved ? 1 : 0),
      failed: before.failed + (solved ? 0 : 1),
      streak,
      bestStreak: Math.max(before.bestStreak, streak)
    }
    database.setValue(STATS_KEY, stats)
    return { stats, ratingChange: rating - before.rating }
  }
}
