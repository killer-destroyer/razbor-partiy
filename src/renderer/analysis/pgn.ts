import { Chess, validateFen, DEFAULT_POSITION } from 'chess.js'
import type { Color, GameMove, ParsedGame } from '@shared/types'
import { normalizeMoveToken } from './notation'

export class PgnParseError extends Error {
  readonly moveNumber: number | null
  readonly color: Color | null
  readonly token: string | null

  constructor(message: string, moveNumber: number | null = null, color: Color | null = null, token: string | null = null) {
    super(message)
    this.name = 'PgnParseError'
    this.moveNumber = moveNumber
    this.color = color
    this.token = token
  }
}

type MovetextToken = { kind: 'move'; text: string } | { kind: 'comment'; text: string }

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '½-½', '*', '0.5-0.5'])
const HEADER_PATTERN = /\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g

export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const match of text.matchAll(HEADER_PATTERN)) {
    headers[match[1]] = match[2].replace(/\\(.)/g, '$1')
  }
  return headers
}

function stripHeaders(text: string): string {
  return text.replace(HEADER_PATTERN, ' ')
}

export function tokenizeMovetext(text: string): MovetextToken[] {
  const tokens: MovetextToken[] = []
  let index = 0
  const length = text.length
  while (index < length) {
    const char = text[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '{') {
      const end = text.indexOf('}', index + 1)
      const stop = end === -1 ? length : end
      tokens.push({ kind: 'comment', text: text.slice(index + 1, stop) })
      index = stop + 1
      continue
    }
    if (char === ';') {
      const end = text.indexOf('\n', index + 1)
      const stop = end === -1 ? length : end
      tokens.push({ kind: 'comment', text: text.slice(index + 1, stop) })
      index = stop + 1
      continue
    }
    if (char === '(') {
      let depth = 1
      index += 1
      while (index < length && depth > 0) {
        const inner = text[index]
        if (inner === '{') {
          const end = text.indexOf('}', index + 1)
          index = end === -1 ? length : end + 1
          continue
        }
        if (inner === '(') depth += 1
        if (inner === ')') depth -= 1
        index += 1
      }
      continue
    }
    if (char === ')') {
      index += 1
      continue
    }
    let end = index
    while (end < length && !/[\s{}();]/.test(text[end])) end += 1
    const word = text.slice(index, end)
    index = end
    const cleaned = word.replace(/^\d+\s*\.+/, '').replace(/^\.+/, '')
    if (!cleaned) continue
    if (/^\$\d+$/.test(cleaned)) continue
    if (/^[!?]+$/.test(cleaned)) continue
    if (RESULT_TOKENS.has(cleaned)) continue
    if (/^\d+$/.test(cleaned)) continue
    tokens.push({ kind: 'move', text: cleaned })
  }
  return tokens
}

export function parseClock(comment: string): number | null {
  const match = comment.match(/\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

export function isFen(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.includes('\n')) return false
  const fields = trimmed.split(/\s+/)
  if (fields.length < 2 || fields[0].split('/').length !== 8) return false
  return validateFen(completeFen(trimmed)).ok
}

export function completeFen(fen: string): string {
  const fields = fen.trim().split(/\s+/)
  const defaults = ['', 'w', '-', '-', '0', '1']
  for (let index = fields.length; index < 6; index += 1) fields.push(defaults[index])
  return fields.slice(0, 6).join(' ')
}

export function splitPgnGames(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const games: string[] = []
  let current: string[] = []
  let seenMovetext = false
  for (const line of lines) {
    const trimmed = line.trim()
    const isHeader = trimmed.startsWith('[') && /^\[\s*\w+\s+"/.test(trimmed)
    if (isHeader && seenMovetext) {
      games.push(current.join('\n'))
      current = []
      seenMovetext = false
    }
    if (!isHeader && trimmed) seenMovetext = true
    current.push(line)
  }
  if (current.some((line) => line.trim())) games.push(current.join('\n'))
  return games
}

function describeSide(color: Color): string {
  return color === 'w' ? 'белые' : 'чёрные'
}

export function parsePgn(text: string): ParsedGame {
  const source = text.replace(/\r\n?/g, '\n')
  const headers = parseHeaders(source)
  const declaredFen = headers.FEN ? completeFen(headers.FEN) : null
  if (declaredFen && !validateFen(declaredFen).ok) {
    throw new PgnParseError(`В заголовке FEN неверная позиция: «${headers.FEN}».`)
  }
  const startFen = declaredFen ?? DEFAULT_POSITION
  const board = new Chess(startFen)
  const fens = [board.fen()]
  const moves: GameMove[] = []
  const tokens = tokenizeMovetext(stripHeaders(source))
  for (const token of tokens) {
    if (token.kind === 'comment') {
      const clock = parseClock(token.text)
      if (clock !== null && moves.length) moves[moves.length - 1].clockSeconds = clock
      continue
    }
    const fenBefore = board.fen()
    const turn = board.turn() as Color
    const moveNumber = board.moveNumber()
    let played
    try {
      played = board.move(normalizeMoveToken(token.text), { strict: false })
    } catch {
      played = null
    }
    if (!played) {
      throw new PgnParseError(
        `Не получилось прочитать ход «${token.text}» (ход ${moveNumber}, ${describeSide(turn)}). Проверьте, что вставлена вся партия целиком.`,
        moveNumber,
        turn,
        token.text
      )
    }
    moves.push({
      ply: moves.length + 1,
      san: played.san,
      uci: played.from + played.to + (played.promotion ?? ''),
      from: played.from,
      to: played.to,
      color: played.color as Color,
      piece: played.piece,
      captured: played.captured ?? null,
      promotion: played.promotion ?? null,
      fenBefore,
      fenAfter: board.fen(),
      clockSeconds: null
    })
    fens.push(board.fen())
  }
  if (!moves.length && !declaredFen) {
    throw new PgnParseError('В тексте не нашлось ходов. Вставьте PGN или список ходов.')
  }
  return { headers, startFen, fens, moves }
}

export function parsedFromFen(fen: string): ParsedGame {
  const full = completeFen(fen)
  const check = validateFen(full)
  if (!check.ok) throw new PgnParseError(`Неверный FEN: ${check.error ?? ''}`.trim())
  return { headers: { FEN: full, SetUp: '1' }, startFen: full, fens: [new Chess(full).fen()], moves: [] }
}

export function applyUciLine(fen: string, ucis: string[], limit = ucis.length): { sans: string[]; fens: string[] } {
  const board = new Chess(fen)
  const sans: string[] = []
  const fens: string[] = []
  for (const uci of ucis.slice(0, limit)) {
    let move
    try {
      move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    } catch {
      move = null
    }
    if (!move) break
    sans.push(move.san)
    fens.push(board.fen())
  }
  return { sans, fens }
}

export function uciToSan(fen: string, uci: string | null | undefined): string | null {
  if (!uci) return null
  return applyUciLine(fen, [uci], 1).sans[0] ?? null
}

export function sanToUci(fen: string, san: string): string | null {
  const board = new Chess(fen)
  try {
    const move = board.move(normalizeMoveToken(san), { strict: false })
    return move ? move.from + move.to + (move.promotion ?? '') : null
  } catch {
    return null
  }
}

export function fenToEpd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

export function pgnFromParsed(game: ParsedGame): string {
  const headerLines = Object.entries(game.headers).map(([key, value]) => `[${key} "${value.replace(/"/g, '\\"')}"]`)
  const body = game.moves
    .map((move) => {
      const [, turn, , , , number] = move.fenBefore.split(' ')
      if (turn === 'w') return `${number}. ${move.san}`
      return move.ply === 1 ? `${number}... ${move.san}` : move.san
    })
    .join(' ')
  return `${headerLines.join('\n')}${headerLines.length ? '\n\n' : ''}${body} ${game.headers.Result ?? '*'}`.trim()
}
