import type { Color, Score } from '@shared/types'
import type { NotationMode } from '@shared/settings'

const CYRILLIC_PIECES: Array<[RegExp, string]> = [
  [/Кр/g, 'K'],
  [/К/g, 'N'],
  [/Ф/g, 'Q'],
  [/Л/g, 'R'],
  [/С/g, 'B'],
  [/П/g, '']
]

const CYRILLIC_FILES: Record<string, string> = { а: 'a', в: 'b', с: 'c', е: 'e', һ: 'h' }

export function normalizeMoveToken(raw: string): string {
  let token = raw.trim()
  for (const [pattern, replacement] of CYRILLIC_PIECES) token = token.replace(pattern, replacement)
  token = token.replace(/[хХ×]/g, 'x')
  token = token.replace(/[авсеһ]/g, (letter) => CYRILLIC_FILES[letter] ?? letter)
  token = token.replace(/^[0OО]-[0OО]-[0OО]/, 'O-O-O').replace(/^[0OО]-[0OО]/, 'O-O')
  token = token.replace(/[!?⁉‼]+/g, '').replace(/e\.p\.?/g, '')
  token = token.replace(/^([KQRBN]?)([a-h][1-8]):([a-h][1-8])/, '$1$2x$3')
  token = token.replace(/^([KQRBN]?[a-h]?[1-8]?):/, '$1x')
  token = token.replace(/^([KQRBN]?)([a-h][1-8])[-–—]([a-h][1-8])/, '$1$2$3')
  token = token.replace(/([a-h][18])([QRBN])$/, '$1=$2')
  token = token.replace(/[+#]+$/, '')
  return token
}

const RUSSIAN_LETTERS: Record<string, string> = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К' }
const FIGURINES: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' }

export function displaySan(san: string | null | undefined, mode: NotationMode): string {
  if (!san) return ''
  if (mode === 'en') return san
  const table = mode === 'ru' ? RUSSIAN_LETTERS : FIGURINES
  return san.replace(/[KQRBN]/g, (letter) => table[letter] ?? letter)
}

export function formatScore(score: Score | null | undefined): string {
  if (!score) return '…'
  if (score.type === 'mate') {
    if (score.moves === 0) return 'мат'
    return `${score.winner === 'w' ? '+' : '−'}M${score.moves}`
  }
  const pawns = score.cp / 100
  const sign = pawns > 0.049 ? '+' : pawns < -0.049 ? '−' : ''
  return `${sign}${Math.abs(pawns).toFixed(1)}`
}

export function moveNumberLabel(fenBefore: string): { number: number; color: Color } {
  const parts = fenBefore.split(' ')
  return { number: Number(parts[5]) || 1, color: parts[1] === 'b' ? 'b' : 'w' }
}

export function moveLabel(fenBefore: string, san: string, mode: NotationMode): string {
  const { number, color } = moveNumberLabel(fenBefore)
  return `${number}${color === 'w' ? '. ' : '... '}${displaySan(san, mode)}`
}

export function formatLine(fenBefore: string, sans: string[], mode: NotationMode, maxPlies = 8): string {
  if (!sans.length) return ''
  let { number, color } = moveNumberLabel(fenBefore)
  const parts: string[] = []
  sans.slice(0, maxPlies).forEach((san, index) => {
    if (color === 'w') parts.push(`${number}. ${displaySan(san, mode)}`)
    else parts.push(`${index === 0 ? `${number}... ` : ''}${displaySan(san, mode)}`)
    if (color === 'b') number += 1
    color = color === 'w' ? 'b' : 'w'
  })
  return parts.join(' ')
}

export const PIECE_NAMES_GENITIVE: Record<string, string> = {
  p: 'пешку',
  n: 'коня',
  b: 'слона',
  r: 'ладью',
  q: 'ферзя',
  k: 'короля'
}

export const PIECE_NAMES_NOMINATIVE: Record<string, string> = {
  p: 'пешка',
  n: 'конь',
  b: 'слон',
  r: 'ладья',
  q: 'ферзь',
  k: 'король'
}

export const PIECE_NAMES_INSTRUMENTAL: Record<string, string> = {
  p: 'пешкой',
  n: 'конём',
  b: 'слоном',
  r: 'ладьёй',
  q: 'ферзём',
  k: 'королём'
}

export const PIECE_NAMES_GENITIVE_CASE: Record<string, string> = {
  p: 'пешки',
  n: 'коня',
  b: 'слона',
  r: 'ладьи',
  q: 'ферзя',
  k: 'короля'
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function isFeminine(type: string): boolean {
  return type === 'p' || type === 'r'
}

export function agree(type: string, masculine: string, feminine: string): string {
  return isFeminine(type) ? feminine : masculine
}
