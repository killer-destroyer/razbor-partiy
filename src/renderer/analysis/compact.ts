import type { Color } from '@shared/types'
import { SERIOUS_CLASSES, type MoveClass } from './classify'
import type { GameReview } from './review'

export interface CompactMove {
  ply: number
  color: Color
  moveClass: MoveClass
  loss: number
  spent: number | null
  clock: number | null
  tags: string[]
}

export interface CompactReview {
  version: 1
  firstSeriousMistakeMove: number | null
  accuracyWhite: number | null
  accuracyBlack: number | null
  ratingWhite: number | null
  ratingBlack: number | null
  openingEco: string | null
  openingName: string | null
  moves: CompactMove[]
}

export function compactReview(review: GameReview): CompactReview {
  const moves: CompactMove[] = review.moves
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .map((entry) => ({
      ply: entry.ply,
      color: entry.color,
      moveClass: entry.moveClass,
      loss: Math.round(entry.loss * 10) / 10,
      spent: entry.secondsSpent,
      clock: entry.clockLeft,
      tags: entry.comment?.tags ?? []
    }))
  const focus = review.userColor
  const firstSerious = moves.find((entry) => (focus === null || entry.color === focus) && SERIOUS_CLASSES.includes(entry.moveClass))
  return {
    version: 1,
    firstSeriousMistakeMove: firstSerious ? Math.ceil(firstSerious.ply / 2) : null,
    accuracyWhite: review.white.accuracy,
    accuracyBlack: review.black.accuracy,
    ratingWhite: review.white.rating,
    ratingBlack: review.black.rating,
    openingEco: review.opening?.opening?.eco ?? null,
    openingName: review.opening?.nameRu ?? null,
    moves
  }
}
