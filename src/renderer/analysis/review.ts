import type { Color, ParsedGame, PositionAnalysis } from '@shared/types'
import type { ClassificationProfile } from '@shared/settings'
import type { OpeningDetection } from '../openings/book'
import { combinedAccuracy, moveAccuracy, volatilityWeights, type AccuracyMove } from './accuracy'
import { classifyMoves, thresholdsFor, type ClassifiedMove, type MoveClass } from './classify'
import { commentMove, type MoveComment, type Paragraph } from './commentary'
import { isEndgamePosition } from './material'
import { estimateGameRating } from './rating'
import { buildSummary, type GameTheme } from './summary'
import { positionWinPercent } from './winprob'

export type GamePhase = 'opening' | 'middlegame' | 'endgame'

export const ALL_CLASSES: MoveClass[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder'
]

export interface MoveReview extends ClassifiedMove {
  ply: number
  san: string
  uci: string
  accuracy: number
  phase: GamePhase
  secondsSpent: number | null
  clockLeft: number | null
  comment: MoveComment | null
}

export interface PhaseAccuracy {
  opening: number | null
  middlegame: number | null
  endgame: number | null
}

export interface SideReport {
  color: Color
  accuracy: number | null
  rating: number | null
  counts: Record<MoveClass, number>
  phases: PhaseAccuracy
  analyzedMoves: number
}

export interface GameReview {
  complete: boolean
  moves: Array<MoveReview | null>
  winPercents: Array<number | null>
  white: SideReport
  black: SideReport
  opening: OpeningDetection | null
  keyMoments: number[]
  turningPoint: number | null
  bestMoveIndex: number | null
  themes: GameTheme[]
  summary: Paragraph[]
  userColor: Color | null
}

export interface ReviewInput {
  game: ParsedGame
  positions: Array<PositionAnalysis | null>
  opening: OpeningDetection | null
  userColor: Color | null
  profile: ClassificationProfile
}

export function emptyCounts(): Record<MoveClass, number> {
  return Object.fromEntries(ALL_CLASSES.map((key) => [key, 0])) as Record<MoveClass, number>
}

export function parseIncrement(timeControl: string | undefined): number {
  if (!timeControl) return 0
  const match = timeControl.match(/\+(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

export function phasesForGame(game: ParsedGame, bookPlies: number): GamePhase[] {
  let reachedEndgame = false
  return game.moves.map((current, index) => {
    if (!reachedEndgame && isEndgamePosition(current.fenBefore)) reachedEndgame = true
    if (reachedEndgame) return 'endgame'
    const fullmove = Number(current.fenBefore.split(' ')[5]) || 1
    if (index < bookPlies || fullmove <= 12) return 'opening'
    return 'middlegame'
  })
}

export function clockUsage(game: ParsedGame): Array<{ spent: number | null; left: number | null }> {
  const increment = parseIncrement(game.headers.TimeControl)
  const baseMatch = game.headers.TimeControl?.match(/^(\d+)/)
  const base = baseMatch ? Number(baseMatch[1]) : null
  const lastClock: Record<Color, number | null> = { w: base, b: base }
  return game.moves.map((current) => {
    const left = current.clockSeconds
    if (left === null) return { spent: null, left: null }
    const previous = lastClock[current.color]
    lastClock[current.color] = left
    if (previous === null) return { spent: null, left }
    return { spent: Math.max(0, previous - left + increment), left }
  })
}

function sideReport(color: Color, moves: Array<MoveReview | null>, weights: number[]): SideReport {
  const own = moves.filter((entry): entry is MoveReview => entry !== null && entry.color === color)
  const counts = emptyCounts()
  for (const entry of own) counts[entry.moveClass] += 1
  const asAccuracy = (list: MoveReview[]): AccuracyMove[] => list.map((entry) => ({ index: entry.index, color, accuracy: entry.accuracy }))
  const accuracy = combinedAccuracy(asAccuracy(own), weights)
  const phaseAccuracy = (phase: GamePhase): number | null => combinedAccuracy(asAccuracy(own.filter((entry) => entry.phase === phase)), weights)
  return {
    color,
    accuracy,
    rating: estimateGameRating(accuracy, counts.blunder),
    counts,
    phases: { opening: phaseAccuracy('opening'), middlegame: phaseAccuracy('middlegame'), endgame: phaseAccuracy('endgame') },
    analyzedMoves: own.length
  }
}

export function buildReview(input: ReviewInput): GameReview {
  const { game, positions, opening, userColor, profile } = input
  const bookPlies = opening?.bookPlies ?? 0
  const thresholds = thresholdsFor(profile)
  const classified = classifyMoves({ moves: game.moves, positions, bookPlies, thresholds })
  const phases = phasesForGame(game, bookPlies)
  const clocks = clockUsage(game)
  const openingName = opening?.nameRu ?? null
  const moves: Array<MoveReview | null> = game.moves.map((current, index) => {
    const verdict = classified[index]
    if (!verdict) return null
    return {
      ...verdict,
      ply: current.ply,
      san: current.san,
      uci: current.uci,
      accuracy: moveAccuracy(verdict.loss),
      phase: phases[index],
      secondsSpent: clocks[index].spent,
      clockLeft: clocks[index].left,
      comment: null
    }
  })
  moves.forEach((entry, index) => {
    if (!entry) return
    entry.comment = commentMove({ moves: game.moves, positions, classified, index, userColor, openingName, bookPlies })
  })
  const winPercents = positions.map((position) => (position ? positionWinPercent(position) : null))
  const complete = positions.length === game.fens.length && positions.every(Boolean)
  const filled = winPercents.map((value) => value ?? 50)
  const weights = volatilityWeights(filled)
  const white = sideReport('w', moves, weights)
  const black = sideReport('b', moves, weights)
  const keyMoments = moves
    .filter((entry): entry is MoveReview => entry !== null)
    .filter((entry) => ['brilliant', 'great', 'mistake', 'miss', 'blunder'].includes(entry.moveClass))
    .map((entry) => entry.index)
  let turningPoint: number | null = null
  let biggestSwing = 0
  moves.forEach((entry) => {
    if (entry && entry.loss > biggestSwing && entry.moveClass !== 'book') {
      biggestSwing = entry.loss
      turningPoint = entry.index
    }
  })
  if (turningPoint !== null && !keyMoments.includes(turningPoint)) {
    keyMoments.push(turningPoint)
    keyMoments.sort((a, b) => a - b)
  }
  const { summary, themes, bestMoveIndex } = buildSummary({
    game,
    positions,
    moves,
    opening,
    white,
    black,
    userColor,
    turningPoint,
    complete
  })
  return {
    complete,
    moves,
    winPercents,
    white,
    black,
    opening,
    keyMoments,
    turningPoint,
    bestMoveIndex,
    themes,
    summary,
    userColor
  }
}

export function detectUserColor(headers: Record<string, string>, username: string | null | undefined): Color | null {
  const nick = username?.trim().toLowerCase()
  if (!nick) return null
  if ((headers.White ?? '').toLowerCase() === nick) return 'w'
  if ((headers.Black ?? '').toLowerCase() === nick) return 'b'
  return null
}
