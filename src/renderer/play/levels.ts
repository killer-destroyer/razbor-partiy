import { Chess } from 'chess.js'

export interface BotLevel {
  level: number
  name: string
  elo: number
  skill: number
  depth: number
  movetimeMs: number
  randomChance: number
}

const NAMES = [
  'Новичок',
  'Ученик',
  'Любитель',
  'Шахматист',
  'Клубный игрок',
  'Третий разряд',
  'Второй разряд',
  'Первый разряд',
  'Кандидат в мастера',
  'Мастер',
  'Гроссмейстер',
  'Stockfish'
]

const TABLE: Array<[number, number, number, number, number]> = [
  [400, 0, 1, 50, 0.35],
  [550, 0, 1, 50, 0.22],
  [700, 1, 2, 80, 0.12],
  [850, 2, 3, 100, 0.06],
  [1000, 3, 4, 150, 0],
  [1100, 4, 5, 150, 0],
  [1200, 5, 5, 200, 0],
  [1300, 6, 6, 200, 0],
  [1400, 7, 7, 250, 0],
  [1500, 8, 8, 300, 0],
  [1600, 9, 9, 300, 0],
  [1700, 10, 10, 400, 0],
  [1800, 11, 11, 400, 0],
  [1900, 12, 12, 500, 0],
  [2000, 14, 13, 600, 0],
  [2150, 15, 14, 700, 0],
  [2300, 16, 16, 800, 0],
  [2500, 18, 18, 1000, 0],
  [2700, 19, 22, 1500, 0],
  [3100, 20, 30, 2500, 0]
]

function nameFor(elo: number): string {
  if (elo < 600) return NAMES[0]
  if (elo < 800) return NAMES[1]
  if (elo < 1000) return NAMES[2]
  if (elo < 1200) return NAMES[3]
  if (elo < 1400) return NAMES[4]
  if (elo < 1500) return NAMES[5]
  if (elo < 1700) return NAMES[6]
  if (elo < 1900) return NAMES[7]
  if (elo < 2200) return NAMES[8]
  if (elo < 2500) return NAMES[9]
  if (elo < 3000) return NAMES[10]
  return NAMES[11]
}

export const BOT_LEVELS: BotLevel[] = TABLE.map(([elo, skill, depth, movetimeMs, randomChance], index) => ({
  level: index + 1,
  name: nameFor(elo),
  elo,
  skill,
  depth,
  movetimeMs,
  randomChance
}))

export function botLevel(level: number): BotLevel {
  return BOT_LEVELS[Math.max(1, Math.min(BOT_LEVELS.length, Math.round(level))) - 1]
}

export function randomLegalMove(fen: string, random: () => number = Math.random): string | null {
  const board = new Chess(fen)
  const moves = board.moves({ verbose: true })
  if (!moves.length) return null
  const captures = moves.filter((move) => move.captured)
  const pool = captures.length && random() < 0.5 ? captures : moves
  const move = pool[Math.floor(random() * pool.length)]
  return move.from + move.to + (move.promotion ?? '')
}

export interface TimeControl {
  id: string
  label: string
  baseSeconds: number
  incrementSeconds: number
}

export const TIME_CONTROLS: TimeControl[] = [
  { id: 'none', label: 'Без часов', baseSeconds: 0, incrementSeconds: 0 },
  { id: '3+2', label: '3 + 2', baseSeconds: 180, incrementSeconds: 2 },
  { id: '5+3', label: '5 + 3', baseSeconds: 300, incrementSeconds: 3 },
  { id: '10+5', label: '10 + 5', baseSeconds: 600, incrementSeconds: 5 },
  { id: '15+10', label: '15 + 10', baseSeconds: 900, incrementSeconds: 10 },
  { id: '30+0', label: '30 минут', baseSeconds: 1800, incrementSeconds: 0 }
]

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
