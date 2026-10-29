import type { Color, PositionAnalysis, Score } from '@shared/types'

export const WIN_PERCENT_COEFFICIENT = 0.00368208
export const CP_CLAMP = 1000

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function winPercentFromCp(cp: number): number {
  const bounded = clamp(cp, -CP_CLAMP, CP_CLAMP)
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_PERCENT_COEFFICIENT * bounded)) - 1)
}

export function winPercent(score: Score | null | undefined): number {
  if (!score) return 50
  if (score.type === 'mate') return score.winner === 'w' ? 100 : 0
  return winPercentFromCp(score.cp)
}

export function winPercentFor(score: Score | null | undefined, color: Color): number {
  const white = winPercent(score)
  return color === 'w' ? white : 100 - white
}

export function topScore(position: PositionAnalysis | null | undefined): Score | null {
  return position?.lines[0]?.score ?? null
}

export function positionWinPercent(position: PositionAnalysis | null | undefined): number {
  return winPercent(topScore(position))
}

export function scoreToCp(score: Score | null | undefined): number {
  if (!score) return 0
  if (score.type === 'mate') return score.winner === 'w' ? 10000 - score.moves : -10000 + score.moves
  return score.cp
}

export function moveLoss(before: number, after: number, color: Color): number {
  return Math.max(0, color === 'w' ? before - after : after - before)
}

export function scoreFromUci(kind: 'cp' | 'mate', value: number, sideToMove: Color): Score {
  const sign = sideToMove === 'w' ? 1 : -1
  if (kind === 'cp') return { type: 'cp', cp: value * sign }
  const opponent: Color = sideToMove === 'w' ? 'b' : 'w'
  return { type: 'mate', moves: Math.abs(value), winner: value > 0 ? sideToMove : opponent }
}
