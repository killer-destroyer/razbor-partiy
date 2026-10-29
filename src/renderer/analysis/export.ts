import type { ParsedGame, PositionAnalysis, Score } from '@shared/types'
import type { MoveClass } from './classify'
import { paragraphToText } from './commentary'
import type { GameReview } from './review'

const NAGS: Partial<Record<MoveClass, string>> = {
  brilliant: '$3',
  great: '$1',
  inaccuracy: '$6',
  mistake: '$2',
  miss: '$2',
  blunder: '$4'
}

const CLASS_NAMES: Record<MoveClass, string> = {
  brilliant: 'Блестящий',
  great: 'Отличная находка',
  best: 'Лучший',
  excellent: 'Отличный',
  good: 'Хороший',
  book: 'Книжный',
  inaccuracy: 'Неточность',
  mistake: 'Ошибка',
  miss: 'Пропуск',
  blunder: 'Зевок'
}

export function evalTag(score: Score | null | undefined): string | null {
  if (!score) return null
  if (score.type === 'mate') return score.moves === 0 ? null : `#${score.winner === 'w' ? '' : '-'}${score.moves}`
  return (score.cp / 100).toFixed(2)
}

function escapeComment(text: string): string {
  return text.replace(/[{}]/g, '')
}

function moveNumberPrefix(fen: string, force: boolean): string {
  const [, turn, , , , number] = fen.split(' ')
  if (turn === 'w') return `${number}. `
  return force ? `${number}... ` : ''
}

export function annotatedPgn(game: ParsedGame, positions: Array<PositionAnalysis | null>, review: GameReview | null): string {
  const headers = { ...game.headers }
  headers.Annotator = 'Разбор партий (Stockfish)'
  const headerText = Object.entries(headers)
    .map(([key, value]) => `[${key} "${value.replace(/"/g, '\\"')}"]`)
    .join('\n')
  const tokens: string[] = []
  let forceNumber = true
  game.moves.forEach((move, index) => {
    const entry = review?.moves[index] ?? null
    tokens.push(`${moveNumberPrefix(move.fenBefore, forceNumber)}${move.san}`)
    forceNumber = false
    const nag = entry ? NAGS[entry.moveClass] : undefined
    if (nag) tokens.push(nag)
    const commentParts: string[] = []
    const tag = evalTag(positions[index + 1]?.lines[0]?.score)
    if (tag) commentParts.push(`[%eval ${tag}]`)
    if (move.clockSeconds !== null) {
      const total = Math.max(0, move.clockSeconds)
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = (total % 60).toFixed(1)
      commentParts.push(`[%clk ${hours}:${String(minutes).padStart(2, '0')}:${seconds.padStart(4, '0')}]`)
    }
    if (entry && entry.moveClass !== 'book' && entry.moveClass !== 'good' && entry.moveClass !== 'excellent') {
      const text = entry.comment?.paragraphs
        .filter((paragraph) => !(paragraph.length === 1 && paragraph[0].kind === 'line'))
        .slice(1, 3)
        .map((paragraph) => paragraphToText(paragraph, 'en'))
        .join(' ')
      commentParts.push(`${CLASS_NAMES[entry.moveClass]}. ${escapeComment(text ?? '')}`.trim())
    }
    if (commentParts.length) {
      tokens.push(`{ ${commentParts.join(' ')} }`)
      forceNumber = true
    }
    if (entry && nag && entry.comment?.bestLine.length && entry.bestUci !== move.uci) {
      const line = entry.comment.bestLine.slice(0, 6)
      const variation: string[] = []
      let fenTurn = move.fenBefore.split(' ')[1]
      let number = Number(move.fenBefore.split(' ')[5])
      line.forEach((san, lineIndex) => {
        if (fenTurn === 'w') variation.push(`${number}. ${san}`)
        else variation.push(lineIndex === 0 ? `${number}... ${san}` : san)
        if (fenTurn === 'b') number += 1
        fenTurn = fenTurn === 'w' ? 'b' : 'w'
      })
      tokens.push(`( ${variation.join(' ')} )`)
      forceNumber = true
    }
  })
  tokens.push(headers.Result ?? '*')
  const lines: string[] = []
  let current = ''
  for (const token of tokens) {
    if ((current + ' ' + token).length > 90 && current) {
      lines.push(current)
      current = token
    } else current = current ? `${current} ${token}` : token
  }
  if (current) lines.push(current)
  return `${headerText}\n\n${lines.join('\n')}\n`
}
