import type { Color } from '@shared/types'

export const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export interface BoardSquare {
  square: string
  type: string
  color: Color
}

export function boardFromFen(fen: string): BoardSquare[] {
  const placement = fen.split(' ')[0]
  const squares: BoardSquare[] = []
  const ranks = placement.split('/')
  ranks.forEach((rankText, rankIndex) => {
    let file = 0
    for (const char of rankText) {
      if (/\d/.test(char)) {
        file += Number(char)
        continue
      }
      const color: Color = char === char.toUpperCase() ? 'w' : 'b'
      squares.push({ square: 'abcdefgh'[file] + String(8 - rankIndex), type: char.toLowerCase(), color })
      file += 1
    }
  })
  return squares
}

export function materialOf(fen: string, color: Color): number {
  return boardFromFen(fen)
    .filter((piece) => piece.color === color)
    .reduce((sum, piece) => sum + PIECE_VALUES[piece.type], 0)
}

export function materialBalance(fen: string, color: Color): number {
  const opponent: Color = color === 'w' ? 'b' : 'w'
  return materialOf(fen, color) - materialOf(fen, opponent)
}

export interface PieceCounts {
  pieces: number
  pawns: number
  queens: number
  total: number
}

export function pieceCounts(fen: string): PieceCounts {
  const board = boardFromFen(fen)
  const pieces = board.filter((piece) => piece.type !== 'p' && piece.type !== 'k').length
  const pawns = board.filter((piece) => piece.type === 'p').length
  const queens = board.filter((piece) => piece.type === 'q').length
  return { pieces, pawns, queens, total: pieces + pawns }
}

export function isEndgamePosition(fen: string): boolean {
  const counts = pieceCounts(fen)
  if (counts.pieces <= 6) return true
  return counts.queens === 0 && counts.total <= 10
}
