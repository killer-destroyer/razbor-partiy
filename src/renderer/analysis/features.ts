import { Chess, type Square } from 'chess.js'
import type { Color } from '@shared/types'
import { boardFromFen, PIECE_VALUES } from './material'

const SEE_VALUES: Record<string, number> = { ...PIECE_VALUES, k: 100 }
const FILES = 'abcdefgh'

export function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function loadBoard(fen: string): Chess {
  const board = new Chess()
  board.load(fen, { skipValidation: true })
  return board
}

export function attackersOf(fen: string, square: string, color: Color): string[] {
  return loadBoard(fen).attackers(square as Square, color)
}

export function staticExchange(fen: string, square: string, attackerColor: Color): number {
  const board = loadBoard(fen)
  const target = board.get(square as Square)
  if (!target || target.color === attackerColor) return 0
  const cheapestAttacker = (side: Color): { from: Square; type: string } | null => {
    const attackers = board.attackers(square as Square, side)
    if (!attackers.length) return null
    return attackers
      .map((from) => ({ from, type: board.get(from)!.type as string }))
      .sort((a, b) => SEE_VALUES[a.type] - SEE_VALUES[b.type])[0]
  }
  const capture = (from: Square, type: string, color: Color): void => {
    board.remove(from)
    board.remove(square as Square)
    board.put({ type: type as never, color }, square as Square)
  }
  let attacker = cheapestAttacker(attackerColor)
  if (!attacker) return 0
  const gains: number[] = [SEE_VALUES[target.type]]
  let side: Color = attackerColor
  let valueOnSquare = SEE_VALUES[attacker.type]
  capture(attacker.from, attacker.type, side)
  let depth = 0
  while (depth < 32) {
    side = opposite(side)
    attacker = cheapestAttacker(side)
    if (!attacker) break
    depth += 1
    gains[depth] = valueOnSquare - gains[depth - 1]
    valueOnSquare = SEE_VALUES[attacker.type]
    capture(attacker.from, attacker.type, side)
  }
  while (depth > 0) {
    gains[depth - 1] = -Math.max(-gains[depth - 1], gains[depth])
    depth -= 1
  }
  return gains[0] === 0 ? 0 : gains[0]
}

export interface HangingPiece {
  square: string
  type: string
  color: Color
  gain: number
}

export function hangingPieces(fen: string, color: Color): HangingPiece[] {
  return boardFromFen(fen)
    .filter((piece) => piece.color === color && piece.type !== 'k')
    .map((piece) => ({ ...piece, gain: staticExchange(fen, piece.square, opposite(color)) }))
    .filter((piece) => piece.gain > 0)
    .sort((a, b) => b.gain - a.gain)
}

export function attackedTargets(fen: string, fromSquare: string): Array<{ square: string; type: string; color: Color }> {
  const board = loadBoard(fen)
  const piece = board.get(fromSquare as Square)
  if (!piece) return []
  return boardFromFen(fen).filter(
    (target) => target.color !== piece.color && board.attackers(target.square as Square, piece.color).includes(fromSquare as Square)
  )
}

export interface ForkInfo {
  square: string
  pieceType: string
  targets: Array<{ square: string; type: string }>
}

export function detectFork(fenAfterMove: string, movedTo: string): ForkInfo | null {
  const board = loadBoard(fenAfterMove)
  const piece = board.get(movedTo as Square)
  if (!piece) return null
  const ownValue = SEE_VALUES[piece.type]
  const targets = attackedTargets(fenAfterMove, movedTo).filter((target) => {
    if (target.type === 'k') return true
    if (SEE_VALUES[target.type] > ownValue) return true
    return staticExchange(fenAfterMove, target.square, piece.color) > 0
  })
  if (targets.length < 2) return null
  return { square: movedTo, pieceType: piece.type, targets: targets.map(({ square, type }) => ({ square, type })) }
}

export interface PinInfo {
  pinner: string
  pinned: string
  pinnedType: string
  behind: string
  behindType: string
}

const DIRECTIONS: Record<string, Array<[number, number]>> = {
  b: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ],
  r: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]
}

function squareAt(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null
  return FILES[file] + String(rank + 1)
}

export function detectPins(fen: string, attackerColor: Color): PinInfo[] {
  const pieces = boardFromFen(fen)
  const bySquare = new Map(pieces.map((piece) => [piece.square, piece]))
  const pins: PinInfo[] = []
  for (const slider of pieces.filter((piece) => piece.color === attackerColor && 'brq'.includes(piece.type))) {
    const directions = slider.type === 'q' ? [...DIRECTIONS.b, ...DIRECTIONS.r] : DIRECTIONS[slider.type]
    const file = FILES.indexOf(slider.square[0])
    const rank = Number(slider.square[1]) - 1
    for (const [df, dr] of directions) {
      let step = 1
      let first: { square: string; type: string; color: Color } | null = null
      while (true) {
        const square = squareAt(file + df * step, rank + dr * step)
        if (!square) break
        const occupant = bySquare.get(square)
        step += 1
        if (!occupant) continue
        if (occupant.color === attackerColor) break
        if (!first) {
          first = occupant
          continue
        }
        const behindValue = SEE_VALUES[occupant.type]
        const pinnedValue = SEE_VALUES[first.type]
        if (first.type !== 'k' && behindValue > pinnedValue && behindValue > SEE_VALUES[slider.type] - 1) {
          pins.push({ pinner: slider.square, pinned: first.square, pinnedType: first.type, behind: square, behindType: occupant.type })
        }
        break
      }
    }
  }
  return pins
}

export interface PawnStructure {
  doubled: string[]
  isolated: string[]
  passed: string[]
}

export function pawnStructure(fen: string, color: Color): PawnStructure {
  const pieces = boardFromFen(fen)
  const own = pieces.filter((piece) => piece.type === 'p' && piece.color === color)
  const enemy = pieces.filter((piece) => piece.type === 'p' && piece.color !== color)
  const filesWithPawns = new Map<number, number>()
  for (const pawn of own) {
    const file = FILES.indexOf(pawn.square[0])
    filesWithPawns.set(file, (filesWithPawns.get(file) ?? 0) + 1)
  }
  const doubled = [...filesWithPawns.entries()].filter(([, count]) => count > 1).map(([file]) => FILES[file])
  const isolated = [...filesWithPawns.keys()]
    .filter((file) => !filesWithPawns.has(file - 1) && !filesWithPawns.has(file + 1))
    .map((file) => FILES[file])
  const passed = own
    .filter((pawn) => {
      const file = FILES.indexOf(pawn.square[0])
      const rank = Number(pawn.square[1])
      return !enemy.some((other) => {
        const otherFile = FILES.indexOf(other.square[0])
        const otherRank = Number(other.square[1])
        if (Math.abs(otherFile - file) > 1) return false
        return color === 'w' ? otherRank > rank : otherRank < rank
      })
    })
    .map((pawn) => pawn.square)
  return { doubled, isolated, passed }
}

export function kingSquare(fen: string, color: Color): string | null {
  return boardFromFen(fen).find((piece) => piece.type === 'k' && piece.color === color)?.square ?? null
}

export function kingCentralization(square: string | null): number {
  if (!square) return 0
  const file = FILES.indexOf(square[0])
  const rank = Number(square[1]) - 1
  return 7 - (Math.max(3 - file, file - 4, 0) + Math.max(3 - rank, rank - 4, 0)) * 2
}

export function hasCastled(fenHistory: string[], color: Color): boolean {
  const homeSquares = color === 'w' ? ['g1', 'c1', 'b1', 'h1'] : ['g8', 'c8', 'b8', 'h8']
  return fenHistory.some((fen) => {
    const square = kingSquare(fen, color)
    return square !== null && homeSquares.includes(square)
  })
}

export function castlingRights(fen: string, color: Color): boolean {
  const rights = fen.split(' ')[2] ?? '-'
  return color === 'w' ? /[KQ]/.test(rights) : /[kq]/.test(rights)
}

export function undevelopedMinors(fen: string, color: Color): number {
  const home = color === 'w' ? ['b1', 'g1', 'c1', 'f1'] : ['b8', 'g8', 'c8', 'f8']
  const pieces = boardFromFen(fen)
  return home.filter((square) => {
    const piece = pieces.find((candidate) => candidate.square === square)
    return piece && piece.color === color && (piece.type === 'n' || piece.type === 'b')
  }).length
}

export function givesCheck(fenAfter: string): boolean {
  const board = loadBoard(fenAfter)
  return board.inCheck()
}

export function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length
  } catch {
    return 0
  }
}
