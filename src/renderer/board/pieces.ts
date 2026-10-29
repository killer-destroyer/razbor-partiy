const pieceFiles = import.meta.glob('../../../resources/pieces/*/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

export interface PieceSet {
  id: string
  name: string
}

export const PIECE_SETS: PieceSet[] = [
  { id: 'cburnett', name: 'Классические плоские' },
  { id: 'merida', name: 'Мерида' },
  { id: 'chessnut', name: 'Chessnut' },
  { id: 'fantasy', name: 'Фэнтези' },
  { id: 'spatial', name: 'Объёмные' },
  { id: 'celtic', name: 'Кельтские' },
  { id: 'mpchess', name: 'MPChess' },
  { id: 'shapes', name: 'Геометрия' },
  { id: 'kiwen-suwi', name: 'Kiwen Suwi' },
  { id: 'firi', name: 'Firi' },
  { id: 'papercut', name: 'Аппликация' },
  { id: 'rhosgfx', name: 'RhosGFX' }
]

const ROLES: Record<string, string> = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }

export function pieceUrl(set: string, color: 'w' | 'b', role: string): string | null {
  const entry = Object.entries(pieceFiles).find(([path]) => path.endsWith(`/pieces/${set}/${color}${role.toUpperCase()}.svg`))
  return entry ? entry[1] : null
}

let injected = false

export function injectPieceStyles(): void {
  if (injected) return
  injected = true
  const rules: string[] = []
  for (const [path, url] of Object.entries(pieceFiles)) {
    const match = path.match(/\/pieces\/([^/]+)\/([wb])([PNBRQK])\.svg$/)
    if (!match) continue
    const [, set, color, role] = match
    const colorName = color === 'w' ? 'white' : 'black'
    rules.push(`[data-pieces="${set}"] piece.${ROLES[role]}.${colorName}{background-image:url("${url}")}`)
    rules.push(`[data-pieces="${set}"] .piece-icon.${ROLES[role]}.${colorName}{background-image:url("${url}")}`)
  }
  const style = document.createElement('style')
  style.dataset.role = 'piece-sets'
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
}
