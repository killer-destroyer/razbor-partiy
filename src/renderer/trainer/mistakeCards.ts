import type { TrainerCard } from '@shared/types'
import { SERIOUS_CLASSES } from '../analysis/classify'
import type { CommentTag } from '../analysis/commentary'
import type { GameReview } from '../analysis/review'
import { winPercentFor } from '../analysis/winprob'
import type { ParsedGame, PositionAnalysis } from '@shared/types'
import { newCard } from './srs'

export interface MistakePayload {
  fen: string
  bestUci: string
  bestSan: string
  playedSan: string
  acceptable: string[]
  gameId: string
  ply: number
  loss: number
  title: string
}

export const THEME_LABELS: Record<string, string> = {
  fork: 'Вилки',
  pin: 'Связки',
  hanging: 'Висящие фигуры',
  mate: 'Мат',
  'missed-capture': 'Взятия',
  material: 'Материал',
  other: 'Прочее'
}

export function themeForTags(tags: CommentTag[]): string {
  if (tags.includes('mate') || tags.includes('missed-mate')) return 'mate'
  if (tags.includes('fork')) return 'fork'
  if (tags.includes('pin')) return 'pin'
  if (tags.includes('hanging')) return 'hanging'
  if (tags.includes('missed-capture') || tags.includes('missed-punish')) return 'missed-capture'
  if (tags.includes('material-loss')) return 'material'
  return 'other'
}

export function acceptableMoves(position: PositionAnalysis, toleranceWinPercent = 3): string[] {
  const top = position.lines[0]
  if (!top) return []
  const color = position.fen.split(' ')[1] === 'b' ? 'b' : 'w'
  const best = winPercentFor(top.score, color)
  return position.lines
    .filter((line) => line.pv[0] && best - winPercentFor(line.score, color) <= toleranceWinPercent)
    .map((line) => line.pv[0])
}

export function mistakeCards(gameId: string, title: string, game: ParsedGame, positions: Array<PositionAnalysis | null>, review: GameReview): TrainerCard[] {
  const cards: TrainerCard[] = []
  for (const entry of review.moves) {
    if (!entry || !SERIOUS_CLASSES.includes(entry.moveClass)) continue
    if (review.userColor && entry.color !== review.userColor) continue
    if (!review.userColor) continue
    const before = positions[entry.index]
    const bestSan = entry.comment?.bestSan
    if (!before || !entry.bestUci || !bestSan) continue
    const payload: MistakePayload = {
      fen: game.moves[entry.index].fenBefore,
      bestUci: entry.bestUci,
      bestSan,
      playedSan: entry.san,
      acceptable: acceptableMoves(before),
      gameId,
      ply: entry.ply,
      loss: Math.round(entry.loss),
      title
    }
    cards.push(newCard(`mistake:${gameId}:${entry.ply}`, 'mistake', payload, themeForTags(entry.comment?.tags ?? [])))
  }
  return cards
}
