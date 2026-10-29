import { Chess } from 'chess.js'
import type { Color } from '@shared/types'
import raw from './course.json'

interface RawLine {
  name: string
  moves: string
  notes?: Record<string, string>
  dubious?: number[]
}

interface RawChapter {
  id: string
  title: string
  side: Color
  summary: string
  intro: string
  ideas: string[]
  lines: RawLine[]
  quiz: QuizQuestion[]
}

export interface QuizQuestion {
  q: string
  options: string[]
  answer: number
  why: string
}

export interface CourseLine {
  name: string
  sans: string[]
  ucis: string[]
  fens: string[]
  notes: Record<number, string>
  dubious: number[]
}

export interface CourseChapter {
  id: string
  title: string
  side: Color
  summary: string
  intro: string
  ideas: string[]
  lines: CourseLine[]
  quiz: QuizQuestion[]
}

export const PASS_PERCENT = 80

export function parseLine(line: RawLine): CourseLine {
  const board = new Chess()
  const sans: string[] = []
  const ucis: string[] = []
  const fens: string[] = [board.fen()]
  for (const token of line.moves.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)) {
    const move = board.move(token)
    sans.push(move.san)
    ucis.push(move.from + move.to + (move.promotion ?? ''))
    fens.push(board.fen())
  }
  const notes: Record<number, string> = {}
  for (const [ply, text] of Object.entries(line.notes ?? {})) notes[Number(ply)] = text
  return { name: line.name, sans, ucis, fens, notes, dubious: line.dubious ?? [] }
}

export const COURSE: CourseChapter[] = (raw as RawChapter[]).map((chapter) => ({ ...chapter, lines: chapter.lines.map(parseLine) }))

export function learnerPlies(line: CourseLine, side: Color): number[] {
  return line.sans.map((_, index) => index).filter((index) => (index % 2 === 0 ? 'w' : 'b') === side)
}

export interface ChapterProgress {
  best: number
  passed: boolean
  attempts: number
  lastAt: number
}

export type CourseProgress = Record<string, ChapterProgress>

export function examPercent(recallCorrect: number, recallTotal: number, quizCorrect: number, quizTotal: number): number {
  const total = recallTotal + quizTotal
  return total ? Math.round(((recallCorrect + quizCorrect) / total) * 100) : 0
}

export function updateProgress(progress: CourseProgress, chapterId: string, percent: number, now = Date.now()): CourseProgress {
  const previous = progress[chapterId]
  return {
    ...progress,
    [chapterId]: {
      best: Math.max(previous?.best ?? 0, percent),
      passed: (previous?.passed ?? false) || percent >= PASS_PERCENT,
      attempts: (previous?.attempts ?? 0) + 1,
      lastAt: now
    }
  }
}
