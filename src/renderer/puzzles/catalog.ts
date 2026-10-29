import { Chess } from 'chess.js'

export interface PuzzleRecord {
  id: string
  fen: string
  moves: string[]
  rating: number
  themes: string[]
  setupMove: boolean
  title?: string
  source?: string
  goal?: string
}

export interface CompositionRecord {
  id: string
  title: string
  source: string
  kind: 'combination' | 'trap' | 'study'
  goal: string
  fen: string
  moves: string[]
  rating: number
  themes: string[]
}

export type PuzzleGroup = 'mine' | 'level' | 'mate' | 'phase' | 'tactic' | 'length' | 'composition'
export type PuzzleDifficulty = 'any' | 'easier' | 'normal' | 'harder'

export interface PuzzleCategory {
  id: string
  group: PuzzleGroup
  label: string
  hint?: string
  theme?: string
  minRating?: number
  maxRating?: number
}

export const PUZZLE_GROUP_LABELS: Record<PuzzleGroup, string> = {
  mine: 'Для вас',
  level: 'По уровню',
  mate: 'Маты',
  phase: 'Стадия партии',
  tactic: 'Тактические приёмы',
  length: 'Длина решения',
  composition: 'Композиции и классика'
}

const themeCategory = (group: PuzzleGroup, theme: string, label: string, hint?: string): PuzzleCategory => ({ id: theme, group, theme, label, hint })

export const PUZZLE_CATEGORIES: PuzzleCategory[] = [
  { id: 'mine', group: 'mine', label: 'Мой уровень', hint: 'Задачи около вашего рейтинга решения' },
  { id: 'level-1', group: 'level', label: 'Новичок', hint: 'Рейтинг задач до 800', maxRating: 799 },
  { id: 'level-2', group: 'level', label: 'Начинающий', hint: '800–1199', minRating: 800, maxRating: 1199 },
  { id: 'level-3', group: 'level', label: 'Любитель', hint: '1200–1599', minRating: 1200, maxRating: 1599 },
  { id: 'level-4', group: 'level', label: 'Опытный', hint: '1600–1999', minRating: 1600, maxRating: 1999 },
  { id: 'level-5', group: 'level', label: 'Сильный', hint: '2000–2399', minRating: 2000, maxRating: 2399 },
  { id: 'level-6', group: 'level', label: 'Мастер', hint: '2400 и выше', minRating: 2400 },
  themeCategory('mate', 'mateIn1', 'Мат в 1 ход'),
  themeCategory('mate', 'mateIn2', 'Мат в 2 хода'),
  themeCategory('mate', 'mateIn3', 'Мат в 3 хода'),
  themeCategory('mate', 'mateIn4', 'Мат в 4 хода'),
  themeCategory('mate', 'mateIn5', 'Мат в 5 и более ходов'),
  themeCategory('mate', 'backRankMate', 'Мат по последней горизонтали'),
  themeCategory('mate', 'smotheredMate', 'Спёртый мат'),
  themeCategory('mate', 'anastasiaMate', 'Мат Анастасии'),
  themeCategory('mate', 'arabianMate', 'Арабский мат'),
  themeCategory('mate', 'bodenMate', 'Мат Бодена'),
  themeCategory('mate', 'doubleBishopMate', 'Мат двумя слонами'),
  themeCategory('mate', 'dovetailMate', 'Мат «ласточкин хвост»'),
  themeCategory('mate', 'hookMate', 'Мат «крючком»'),
  themeCategory('phase', 'opening', 'Дебют'),
  themeCategory('phase', 'middlegame', 'Миттельшпиль'),
  themeCategory('phase', 'endgame', 'Эндшпиль'),
  themeCategory('phase', 'pawnEndgame', 'Пешечный эндшпиль'),
  themeCategory('phase', 'rookEndgame', 'Ладейный эндшпиль'),
  themeCategory('phase', 'queenEndgame', 'Ферзевый эндшпиль'),
  themeCategory('phase', 'bishopEndgame', 'Слоновый эндшпиль'),
  themeCategory('phase', 'knightEndgame', 'Коневой эндшпиль'),
  themeCategory('phase', 'queenRookEndgame', 'Ферзь и ладья'),
  themeCategory('tactic', 'fork', 'Вилка', 'Одна фигура нападает сразу на две'),
  themeCategory('tactic', 'pin', 'Связка', 'Фигура не может уйти, не открыв более ценную'),
  themeCategory('tactic', 'skewer', 'Линейный удар', 'Нападение на ценную фигуру, за которой стоит другая'),
  themeCategory('tactic', 'discoveredAttack', 'Вскрытое нападение'),
  themeCategory('tactic', 'doubleCheck', 'Двойной шах'),
  themeCategory('tactic', 'sacrifice', 'Жертва'),
  themeCategory('tactic', 'deflection', 'Отвлечение'),
  themeCategory('tactic', 'attraction', 'Завлечение'),
  themeCategory('tactic', 'capturingDefender', 'Уничтожение защитника'),
  themeCategory('tactic', 'interference', 'Перекрытие'),
  themeCategory('tactic', 'clearance', 'Освобождение линии'),
  themeCategory('tactic', 'xRayAttack', 'Рентген'),
  themeCategory('tactic', 'intermezzo', 'Промежуточный ход'),
  themeCategory('tactic', 'quietMove', 'Тихий ход'),
  themeCategory('tactic', 'defensiveMove', 'Защитный ход'),
  themeCategory('tactic', 'zugzwang', 'Цугцванг'),
  themeCategory('tactic', 'hangingPiece', 'Незащищённая фигура'),
  themeCategory('tactic', 'trappedPiece', 'Ловля фигуры'),
  themeCategory('tactic', 'exposedKing', 'Открытый король'),
  themeCategory('tactic', 'kingsideAttack', 'Атака на королевском фланге'),
  themeCategory('tactic', 'queensideAttack', 'Атака на ферзевом фланге'),
  themeCategory('tactic', 'attackingF2F7', 'Атака на f2/f7'),
  themeCategory('tactic', 'advancedPawn', 'Проходная пешка'),
  themeCategory('tactic', 'promotion', 'Превращение пешки'),
  themeCategory('tactic', 'underPromotion', 'Слабое превращение'),
  themeCategory('tactic', 'enPassant', 'Взятие на проходе'),
  themeCategory('tactic', 'castling', 'Рокировка'),
  themeCategory('tactic', 'master', 'Из партий мастеров'),
  themeCategory('length', 'oneMove', 'В один ход'),
  themeCategory('length', 'short', 'Короткие (2 хода)'),
  themeCategory('length', 'long', 'Длинные (3 хода)'),
  themeCategory('length', 'veryLong', 'Очень длинные (4 хода и больше)'),
  { id: 'composition', group: 'composition', label: 'Этюды, ловушки и знаменитые комбинации', theme: 'composition', hint: 'Каждая позиция проверена Stockfish' }
]

export const THEME_NAMES: Record<string, string> = Object.fromEntries(
  PUZZLE_CATEGORIES.filter((category) => category.theme).map((category) => [category.theme!, category.label])
)

export function parsePuzzlesTsv(text: string): PuzzleRecord[] {
  const result: PuzzleRecord[] = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('id\t')) continue
    const [id, fen, moves, rating, themes] = line.split('\t')
    if (!id || !fen || !moves) continue
    result.push({ id, fen, moves: moves.split(' '), rating: Number(rating), themes: (themes ?? '').trim().split(' ').filter(Boolean), setupMove: true })
  }
  return result
}

export function compositionToPuzzle(record: CompositionRecord): PuzzleRecord {
  return {
    id: record.id,
    fen: record.fen,
    moves: record.moves,
    rating: record.rating,
    themes: record.themes,
    setupMove: false,
    title: record.title,
    source: record.source,
    goal: record.goal
  }
}

export function matchesCategory(puzzle: PuzzleRecord, category: PuzzleCategory): boolean {
  if (category.theme && !puzzle.themes.includes(category.theme)) return false
  if (category.minRating !== undefined && puzzle.rating < category.minRating) return false
  if (category.maxRating !== undefined && puzzle.rating > category.maxRating) return false
  return true
}

export function difficultyWindow(difficulty: PuzzleDifficulty, rating: number): [number, number] | null {
  if (difficulty === 'easier') return [rating - 600, rating - 150]
  if (difficulty === 'normal') return [rating - 150, rating + 150]
  if (difficulty === 'harder') return [rating + 150, rating + 600]
  return null
}

export function updatePuzzleRating(rating: number, puzzleRating: number, solved: boolean, games: number): number {
  const expected = 1 / (1 + 10 ** ((puzzleRating - rating) / 400))
  const k = games < 20 ? 48 : games < 100 ? 32 : 20
  return Math.round(Math.max(100, Math.min(3500, rating + k * ((solved ? 1 : 0) - expected))))
}

export function solverColor(puzzle: PuzzleRecord): 'w' | 'b' {
  const turn = puzzle.fen.split(' ')[1] === 'b' ? 'b' : 'w'
  if (!puzzle.setupMove) return turn
  return turn === 'w' ? 'b' : 'w'
}

export function puzzleStartFen(puzzle: PuzzleRecord): string {
  if (!puzzle.setupMove) return puzzle.fen
  const board = new Chess(puzzle.fen)
  const move = puzzle.moves[0]
  board.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] })
  return board.fen()
}

export function solutionMoves(puzzle: PuzzleRecord): string[] {
  return puzzle.setupMove ? puzzle.moves.slice(1) : puzzle.moves
}

export type MoveVerdict = 'correct' | 'solved' | 'wrong'

export function checkPuzzleMove(fen: string, solution: string[], index: number, uci: string): MoveVerdict {
  const expected = solution[index]
  if (!expected) return 'wrong'
  const isLast = index >= solution.length - 1
  if (uci === expected) return isLast ? 'solved' : 'correct'
  if (!isLast) return 'wrong'
  try {
    const board = new Chess(fen)
    board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return board.isCheckmate() ? 'solved' : 'wrong'
  } catch {
    return 'wrong'
  }
}
