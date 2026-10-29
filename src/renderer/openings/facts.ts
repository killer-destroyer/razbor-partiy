import type { Color } from '@shared/types'
import { kingSquare, pawnStructure } from '../analysis/features'
import { boardFromFen, materialBalance } from '../analysis/material'

export interface PositionFacts {
  structure: string[]
  castling: string[]
  material: string
}

const SIDE_GENITIVE: Record<Color, string> = { w: 'белых', b: 'чёрных' }

function hangingPawns(fen: string, color: Color): string | null {
  const files = new Set(boardFromFen(fen).filter((piece) => piece.type === 'p' && piece.color === color).map((piece) => 'abcdefgh'.indexOf(piece.square[0])))
  for (const file of [2, 3, 4]) {
    if (files.has(file) && files.has(file + 1) && !files.has(file - 1) && !files.has(file + 2)) {
      const enemyFiles = new Set(boardFromFen(fen).filter((piece) => piece.type === 'p' && piece.color !== color).map((piece) => 'abcdefgh'.indexOf(piece.square[0])))
      if (!enemyFiles.has(file) && !enemyFiles.has(file + 1)) return `${'abcdefgh'[file]}${'abcdefgh'[file + 1]}`
    }
  }
  return null
}

function castlingState(fen: string, color: Color): string {
  const king = kingSquare(fen, color)
  const rights = fen.split(' ')[2] ?? '-'
  const side = SIDE_GENITIVE[color]
  if (king && ['g1', 'h1', 'g8', 'h8'].includes(king)) return `Король ${side} в короткой рокировке`
  if (king && ['c1', 'b1', 'c8', 'b8'].includes(king)) return `Король ${side} в длинной рокировке`
  const hasRights = color === 'w' ? /[KQ]/.test(rights) : /[kq]/.test(rights)
  return hasRights ? `Король ${side} ещё в центре, рокировка возможна` : `Король ${side} в центре без права рокировки`
}

export function positionFacts(fen: string): PositionFacts {
  const structure: string[] = []
  for (const color of ['w', 'b'] as Color[]) {
    const pawns = pawnStructure(fen, color)
    const side = SIDE_GENITIVE[color]
    if (pawns.isolated.length) structure.push(`Изолированные пешки ${side}: ${pawns.isolated.join(', ')}`)
    if (pawns.doubled.length) structure.push(`Сдвоенные пешки ${side}: ${pawns.doubled.join(', ')}`)
    const hanging = hangingPawns(fen, color)
    if (hanging) structure.push(`Висячие пешки ${side} (${hanging})`)
    if (pawns.passed.length) structure.push(`Проходные пешки ${side}: ${pawns.passed.join(', ')}`)
  }
  if (!structure.length) structure.push('Пешечная структура без явных слабостей')
  const balance = materialBalance(fen, 'w')
  const material = balance === 0 ? 'Материал равный' : `Перевес в материале у ${balance > 0 ? 'белых' : 'чёрных'}: ${Math.abs(balance)} ${Math.abs(balance) === 1 ? 'пешка' : 'пешечных единиц'}`
  return { structure, castling: [castlingState(fen, 'w'), castlingState(fen, 'b')], material }
}
