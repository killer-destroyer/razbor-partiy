import type { Color, GameMove, PositionAnalysis } from '@shared/types'
import type { ClassificationProfile } from '@shared/settings'
import { materialBalance } from './material'
import { applyUciLine } from './pgn'
import { moveLoss, positionWinPercent, winPercent, winPercentFor } from './winprob'

export type MoveClass =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

export interface ClassThresholds {
  excellentBelow: number
  goodBelow: number
  inaccuracyBelow: number
  mistakeBelow: number
  missMinLoss: number
  greatGap: number
  brilliantMaxLoss: number
  alreadyWonPercent: number
  sacrificePawns: number
  sacrificePlies: number
  bestTolerance: number
  missOverridesBlunder: boolean
}

export const CHESSCOM_THRESHOLDS: ClassThresholds = {
  excellentBelow: 2,
  goodBelow: 5,
  inaccuracyBelow: 10,
  mistakeBelow: 20,
  missMinLoss: 10,
  greatGap: 10,
  brilliantMaxLoss: 2,
  alreadyWonPercent: 97,
  sacrificePawns: 2,
  sacrificePlies: 3,
  bestTolerance: 0.5,
  missOverridesBlunder: true
}

export const STRICT_THRESHOLDS: ClassThresholds = {
  ...CHESSCOM_THRESHOLDS,
  excellentBelow: 3,
  goodBelow: 7,
  inaccuracyBelow: 12,
  mistakeBelow: 18,
  missMinLoss: 7,
  missOverridesBlunder: false
}

export function thresholdsFor(profile: ClassificationProfile): ClassThresholds {
  return profile === 'strict' ? STRICT_THRESHOLDS : CHESSCOM_THRESHOLDS
}

export const BAD_CLASSES: MoveClass[] = ['inaccuracy', 'mistake', 'miss', 'blunder']
export const SERIOUS_CLASSES: MoveClass[] = ['mistake', 'miss', 'blunder']
export const GOOD_CLASSES: MoveClass[] = ['brilliant', 'great', 'best', 'excellent', 'book']

export interface ClassifiedMove {
  index: number
  color: Color
  moveClass: MoveClass
  loss: number
  wpBefore: number
  wpAfter: number
  bestUci: string | null
  isBest: boolean
  sacrifice: boolean
  onlyMove: boolean
}

export function classifyByLoss(loss: number, thresholds: ClassThresholds): MoveClass {
  if (loss < thresholds.excellentBelow) return 'excellent'
  if (loss < thresholds.goodBelow) return 'good'
  if (loss < thresholds.inaccuracyBelow) return 'inaccuracy'
  if (loss < thresholds.mistakeBelow) return 'mistake'
  return 'blunder'
}

export function isSacrifice(move: GameMove, after: PositionAnalysis | null, thresholds: ClassThresholds): boolean {
  if (!after || !after.lines.length) return false
  const before = materialBalance(move.fenBefore, move.color)
  const continuation = after.lines[0].pv.slice(0, thresholds.sacrificePlies - 1)
  const { fens } = applyUciLine(move.fenAfter, continuation)
  const checkpoints = [move.fenAfter, ...fens]
  const worst = Math.min(...checkpoints.map((fen) => materialBalance(fen, move.color)))
  const final = materialBalance(checkpoints[checkpoints.length - 1], move.color)
  return before - final >= thresholds.sacrificePawns && before - worst >= thresholds.sacrificePawns
}

function playedMatchesBest(move: GameMove, before: PositionAnalysis, thresholds: ClassThresholds): boolean {
  const top = before.lines[0]
  if (!top) return false
  if (top.pv[0] === move.uci) return true
  const alternative = before.lines.find((line) => line.pv[0] === move.uci)
  if (!alternative) return false
  return Math.abs(winPercentFor(top.score, move.color) - winPercentFor(alternative.score, move.color)) < thresholds.bestTolerance
}

function isRecapture(move: GameMove, previous: GameMove | undefined): boolean {
  return Boolean(previous && previous.captured && move.captured && previous.to === move.to)
}

export interface ClassifyContext {
  moves: GameMove[]
  positions: Array<PositionAnalysis | null>
  bookPlies: number
  thresholds: ClassThresholds
}

export function classifyMoves(context: ClassifyContext): Array<ClassifiedMove | null> {
  const { moves, positions, bookPlies, thresholds } = context
  const result: Array<ClassifiedMove | null> = []
  moves.forEach((move, index) => {
    const before = positions[index]
    const after = positions[index + 1]
    if (!before || !after) {
      result.push(null)
      return
    }
    const wpBefore = positionWinPercent(before)
    const wpAfter = positionWinPercent(after)
    const loss = moveLoss(wpBefore, wpAfter, move.color)
    const isBest = playedMatchesBest(move, before, thresholds)
    const bestUci = before.lines[0]?.pv[0] ?? null
    const moverBefore = move.color === 'w' ? wpBefore : 100 - wpBefore
    const moverAfter = move.color === 'w' ? wpAfter : 100 - wpAfter
    const second = before.lines[1]
    const onlyMove =
      isBest &&
      Boolean(second) &&
      winPercentFor(before.lines[0].score, move.color) - winPercentFor(second.score, move.color) >= thresholds.greatGap
    const sacrifice = (isBest || loss < thresholds.brilliantMaxLoss) && isSacrifice(move, after, thresholds)
    let moveClass: MoveClass
    if (index < bookPlies) {
      moveClass = 'book'
    } else if (sacrifice && moverBefore < thresholds.alreadyWonPercent && moverAfter > 50 - thresholds.greatGap) {
      moveClass = 'brilliant'
    } else if (onlyMove && moverBefore < thresholds.alreadyWonPercent && !isRecapture(move, moves[index - 1])) {
      moveClass = 'great'
    } else if (isBest) {
      moveClass = 'best'
    } else {
      moveClass = classifyByLoss(loss, thresholds)
      const previousClass = result[index - 1]?.moveClass
      const beforeOpponentError = positions[index - 1]
      if (
        previousClass &&
        SERIOUS_CLASSES.includes(previousClass) &&
        previousClass !== 'miss' &&
        beforeOpponentError &&
        (thresholds.missOverridesBlunder || moveClass !== 'blunder') &&
        loss >= thresholds.missMinLoss
      ) {
        const baseline = winPercentFor(beforeOpponentError.lines[0]?.score, move.color)
        const gift = moverBefore - baseline
        const kept = moverAfter - baseline
        if (gift >= thresholds.missMinLoss && kept < gift / 2 && moverAfter >= baseline - thresholds.inaccuracyBelow) {
          moveClass = 'miss'
        }
      }
    }
    result.push({ index, color: move.color, moveClass, loss, wpBefore, wpAfter, bestUci, isBest, sacrifice, onlyMove })
  })
  return result
}

export function lossFromPositions(before: PositionAnalysis, after: PositionAnalysis, color: Color): number {
  return moveLoss(winPercent(before.lines[0]?.score), winPercent(after.lines[0]?.score), color)
}
