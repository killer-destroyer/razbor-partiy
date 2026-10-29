import type { Color, GameMove, PositionAnalysis, Score } from '@shared/types'
import type { NotationMode } from '@shared/settings'
import type { ClassifiedMove, MoveClass } from './classify'
import { BAD_CLASSES, SERIOUS_CLASSES } from './classify'
import {
  attackersOf,
  castlingRights,
  detectFork,
  detectPins,
  hangingPieces,
  hasCastled,
  kingCentralization,
  kingSquare,
  opposite,
  pawnStructure,
  staticExchange,
  undevelopedMinors
} from './features'
import { isEndgamePosition, materialBalance } from './material'
import {
  displaySan,
  formatLine,
  formatScore,
  PIECE_NAMES_GENITIVE,
  PIECE_NAMES_GENITIVE_CASE,
  PIECE_NAMES_INSTRUMENTAL,
  PIECE_NAMES_NOMINATIVE,
  agree,
  pluralRu
} from './notation'
import { applyUciLine } from './pgn'
import { winPercentFor } from './winprob'

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'move'; san: string }
  | { kind: 'line'; fen: string; sans: string[] }
  | { kind: 'score'; score: Score | null }

export type Paragraph = Span[]

export type CommentTag =
  | 'hanging'
  | 'fork'
  | 'pin'
  | 'mate'
  | 'missed-mate'
  | 'missed-capture'
  | 'early-queen'
  | 'repeated-move'
  | 'no-castling'
  | 'flank-pawn'
  | 'doubled-pawns'
  | 'isolated-pawn'
  | 'passive-king'
  | 'missed-passer'
  | 'material-loss'
  | 'sacrifice'
  | 'only-move'
  | 'punished'
  | 'missed-punish'

export interface RefutationInfo {
  uci: string
  san: string
  captureSquare: string | null
  capturedType: string | null
  materialSwing: number
  mateIn: number | null
}

export interface MoveComment {
  paragraphs: Paragraph[]
  tags: CommentTag[]
  short: Paragraph
  refutation: RefutationInfo | null
  bestSan: string | null
  bestLine: string[]
  refutationLine: string[]
}

export interface CommentContext {
  moves: GameMove[]
  positions: Array<PositionAnalysis | null>
  classified: Array<ClassifiedMove | null>
  index: number
  userColor: Color | null
  openingName: string | null
  bookPlies: number
}

const text = (value: string): Span => ({ kind: 'text', text: value })
const move = (san: string): Span => ({ kind: 'move', san })
const line = (fen: string, sans: string[]): Span => ({ kind: 'line', fen, sans })
const score = (value: Score | null | undefined): Span => ({ kind: 'score', score: value ?? null })

function pick<T>(options: T[], seed: number): T {
  return options[Math.abs(seed) % options.length]
}

interface Voice {
  subject: string
  played: string
  other: string
  otherCould: string
  otherFound: string
  otherMissed: string
  selfMissed: string
  possessive: string
}

function voiceFor(color: Color, userColor: Color | null): Voice {
  if (userColor === null) {
    const self = color === 'w' ? 'Белые' : 'Чёрные'
    const other = color === 'w' ? 'чёрные' : 'белые'
    return {
      subject: self,
      played: 'сыграли',
      other,
      otherCould: 'могли',
      otherFound: `${other.charAt(0).toUpperCase()}${other.slice(1)} так и сыграли.`,
      otherMissed: `${other.charAt(0).toUpperCase()}${other.slice(1)} этот ход не нашли.`,
      selfMissed: 'Этот шанс упущен.',
      possessive: color === 'w' ? 'белых' : 'чёрных'
    }
  }
  if (color === userColor) {
    return {
      subject: 'Вы',
      played: 'сыграли',
      other: 'соперник',
      otherCould: 'мог',
      otherFound: 'Соперник так и сыграл.',
      otherMissed: 'Соперник этот ход не нашёл.',
      selfMissed: 'Этот шанс вы упустили.',
      possessive: 'ваш'
    }
  }
  return {
    subject: 'Соперник',
    played: 'сыграл',
    other: 'вы',
    otherCould: 'могли',
    otherFound: 'Вы нашли этот ход.',
    otherMissed: 'Этот ход вы упустили.',
    selfMissed: 'Соперник упустил этот шанс.',
    possessive: 'его'
  }
}

export const CLASS_TEMPLATES: Record<MoveClass, string[]> = {
  book: [
    'Книжный ход: так играют в теории.',
    'Ход по дебютной теории.',
    'Всё ещё теория: эта позиция есть в базе дебютов.',
    'Известное продолжение из дебютной базы.'
  ],
  brilliant: [
    'Блестящая жертва: материал отдан ради инициативы, и движок это полностью одобряет.',
    'Красивый ход с жертвой, который выдерживает проверку движком.',
    'Смелая и точная жертва: это лучшее продолжение в позиции.'
  ],
  great: [
    'Отличная находка: единственный ход, который сохраняет позицию.',
    'Единственный хороший ход, и он найден.',
    'Точный ход в трудной ситуации: остальные продолжения заметно хуже.'
  ],
  best: [
    'Это лучший ход по мнению движка.',
    'Движок согласен: сильнейшее продолжение.',
    'Точно: именно этот ход выбрал движок.',
    'Лучший ход в позиции.'
  ],
  excellent: [
    'Отличный ход, почти не уступающий лучшему.',
    'Очень хороший ход, разница с лучшим минимальна.',
    'Сильный ход: движок предлагал другой, но разница едва заметна.'
  ],
  good: [
    'Хороший ход, хотя было и чуть точнее.',
    'Нормальный ход: позиция сохраняется, но был вариант сильнее.',
    'Приемлемое продолжение, немного уступающее лучшему.'
  ],
  inaccuracy: [
    'Неточность: преимущество немного уходит.',
    'Не самый точный ход: можно было сыграть сильнее.',
    'Небольшая неточность, которая упрощает игру сопернику.'
  ],
  mistake: [
    'Ошибка: позиция заметно ухудшилась.',
    'Ошибочный ход, который серьёзно меняет оценку.',
    'Это ошибка: соперник получает хорошие шансы.'
  ],
  miss: [
    'Пропуск: соперник только что ошибся, но этот ход не воспользовался шансом.',
    'Упущенная возможность наказать соперника за ошибку.',
    'Шанс был, но он прошёл мимо.'
  ],
  blunder: [
    'Зевок: после этого хода партия может резко поменяться.',
    'Грубая ошибка, которая сильно меняет оценку.',
    'Зевок: этот ход отдаёт значительную часть преимущества.'
  ]
}

const BEST_PREFERRED_TEMPLATES = [
  'Движок предпочитал ',
  'Чуть точнее было ',
  'Немного сильнее было '
]

export function refutationOf(movePlayed: GameMove, after: PositionAnalysis | null): RefutationInfo | null {
  const top = after?.lines[0]
  if (!top || !top.pv.length) return null
  const { sans, fens } = applyUciLine(movePlayed.fenAfter, top.pv, 6)
  if (!sans.length) return null
  const uci = top.pv[0]
  const target = uci.slice(2, 4)
  const capturedPiece = pieceOn(movePlayed.fenAfter, target)
  const startBalance = materialBalance(movePlayed.fenAfter, movePlayed.color)
  const checkpoints = fens.filter((_, index) => index % 2 === 1 || index === fens.length - 1)
  const endBalance = checkpoints.length
    ? Math.min(...checkpoints.map((fen) => materialBalance(fen, movePlayed.color)))
    : startBalance
  const mateIn = top.score.type === 'mate' && top.score.winner !== movePlayed.color ? top.score.moves : null
  return {
    uci,
    san: sans[0],
    captureSquare: capturedPiece ? target : null,
    capturedType: capturedPiece?.type ?? null,
    materialSwing: Math.max(0, startBalance - endBalance),
    mateIn
  }
}

function pieceOn(fen: string, square: string): { type: string; color: Color } | null {
  const rows = fen.split(' ')[0].split('/')
  const rankIndex = 8 - Number(square[1])
  const fileIndex = 'abcdefgh'.indexOf(square[0])
  let file = 0
  for (const char of rows[rankIndex] ?? '') {
    if (/\d/.test(char)) {
      file += Number(char)
      continue
    }
    if (file === fileIndex) return { type: char.toLowerCase(), color: char === char.toUpperCase() ? 'w' : 'b' }
    file += 1
  }
  return null
}

function materialWord(swing: number): string {
  if (swing >= 8) return 'ферзя'
  if (swing >= 4) return 'ладью'
  if (swing >= 2.5) return 'фигуру'
  if (swing >= 2) return 'качество'
  return pluralRu(Math.round(swing), 'пешку', 'пешки', 'пешек')
}

function featureRemarks(context: CommentContext, current: GameMove, classified: ClassifiedMove, refutation: RefutationInfo | null): {
  paragraphs: Paragraph[]
  tags: CommentTag[]
} {
  const paragraphs: Paragraph[] = []
  const tags: CommentTag[] = []
  const { moves, positions, index } = context
  const before = positions[index]
  const after = positions[index + 1]
  const isBad = BAD_CLASSES.includes(classified.moveClass)
  const seed = current.ply
  const opponent = opposite(current.color)
  const voice = voiceFor(current.color, context.userColor)
  const [, , , , , fullmoveText] = current.fenBefore.split(' ')
  const fullmove = Number(fullmoveText) || 1
  const inBook = index < context.bookPlies

  if (after?.lines[0]?.score.type === 'mate') {
    const mateScore = after.lines[0].score
    if (mateScore.winner === opponent && mateScore.moves > 0) {
      tags.push('mate')
      paragraphs.push([
        text(
          pick(
            [
              `После этого хода у ${voice.other === 'вы' ? 'вас' : 'соперника'} форсированный мат в ${mateScore.moves} ${pluralRu(mateScore.moves, 'ход', 'хода', 'ходов')}.`,
              `Теперь есть мат в ${mateScore.moves} ${pluralRu(mateScore.moves, 'ход', 'хода', 'ходов')} в пользу ${voice.other === 'вы' ? 'вас' : 'соперника'}.`
            ],
            seed
          )
        )
      ])
    } else if (mateScore.winner === current.color && mateScore.moves > 0 && !isBad) {
      paragraphs.push([text(`Ход ведёт к форсированному мату в ${mateScore.moves} ${pluralRu(mateScore.moves, 'ход', 'хода', 'ходов')}.`)])
    }
  }
  const beforeTop = before?.lines[0]
  if (beforeTop?.score.type === 'mate' && beforeTop.score.winner === current.color && isBad) {
    const afterScore = after?.lines[0]?.score
    if (!(afterScore?.type === 'mate' && afterScore.winner === current.color)) {
      tags.push('missed-mate')
      paragraphs.push([
        text(
          pick(
            [`Был форсированный мат в ${beforeTop.score.moves} ${pluralRu(beforeTop.score.moves, 'ход', 'хода', 'ходов')}, но он упущен.`, 'Упущен форсированный мат.'],
            seed
          )
        )
      ])
    }
  }

  if (isBad && before && classified.bestUci && classified.bestUci !== current.uci) {
    const target = classified.bestUci.slice(2, 4)
    const victim = pieceOn(current.fenBefore, target)
    if (victim && victim.color === opponent) {
      const gain = staticExchange(current.fenBefore, target, current.color)
      const playedGain = current.captured ? staticExchange(current.fenBefore, current.to, current.color) : 0
      if (gain >= 1 && gain > playedGain) {
        tags.push('missed-capture')
        paragraphs.push([
          text(
            pick(
              [
                `Можно было забрать ${PIECE_NAMES_GENITIVE[victim.type]} на ${target}.`,
                `${capitalize(PIECE_NAMES_NOMINATIVE[victim.type])} на ${target} ${agree(victim.type, 'стоял', 'стояла')} под боем, ${agree(victim.type, 'его', 'её')} стоило взять.`,
                `Упущено взятие: ${PIECE_NAMES_NOMINATIVE[victim.type]} на ${target} ${agree(victim.type, 'был беззащитен', 'была беззащитна')}.`
              ],
              seed
            )
          )
        ])
      }
    }
  }

  if (isBad) {
    const hangingBefore = new Set(hangingPieces(current.fenBefore, current.color).map((piece) => piece.square))
    const hangingAfter = hangingPieces(current.fenAfter, current.color).filter(
      (piece) => !hangingBefore.has(piece.square) || piece.square === current.to
    )
    const victim = hangingAfter.find((piece) => refutation?.captureSquare === piece.square) ?? hangingAfter[0]
    if (victim && victim.gain >= 1) {
      tags.push('hanging')
      const attackers = attackerTypes(current.fenAfter, victim.square, opponent)
      const cheaper = attackers.find((type) => valueOf(type) < valueOf(victim.type))
      const pieceName = PIECE_NAMES_NOMINATIVE[victim.type]
      if (cheaper) {
        paragraphs.push([
          text(
            pick(
              [
                `${capitalize(pieceName)} на ${victim.square} ${agree(victim.type, 'атакован', 'атакована')} ${PIECE_NAMES_INSTRUMENTAL[cheaper]} — фигурой меньшей ценности.`,
                `${capitalize(pieceName)} на ${victim.square} попадает под удар ${PIECE_NAMES_GENITIVE_CASE[cheaper]}, размен будет невыгоден.`
              ],
              seed
            )
          )
        ])
      } else {
        paragraphs.push([
          text(
            pick(
              [
                `Ход оставил ${PIECE_NAMES_GENITIVE[victim.type]} на ${victim.square} без достаточной защиты.`,
                `${capitalize(pieceName)} на ${victim.square} остаётся под боем и ${agree(victim.type, 'защищён', 'защищена')} недостаточно.`,
                `Висит ${pieceName} на ${victim.square}: защитников меньше, чем нападающих.`
              ],
              seed
            )
          )
        ])
      }
    }
  }

  if (isBad && refutation && after?.lines[0]) {
    const { fens } = applyUciLine(current.fenAfter, [refutation.uci], 1)
    if (fens[0]) {
      const fork = detectFork(fens[0], refutation.uci.slice(2, 4))
      if (fork) {
        tags.push('fork')
        const targets = fork.targets.map((target) => `${PIECE_NAMES_GENITIVE[target.type]} на ${target.square}`).join(' и ')
        paragraphs.push([
          text(pick(['Опровержение — вилка: ', 'Главная угроза — двойной удар: ', 'Тактика: '], seed)),
          move(refutation.san),
          text(` нападает сразу на ${targets}.`)
        ])
      } else {
        const pinsBefore = new Set(detectPins(current.fenAfter, opponent).map((pin) => pin.pinned))
        const newPin = detectPins(fens[0], opponent).find((pin) => !pinsBefore.has(pin.pinned) && pin.pinner === refutation.uci.slice(2, 4))
        if (newPin) {
          tags.push('pin')
          const behind = newPin.behindType === 'k' ? 'король' : PIECE_NAMES_NOMINATIVE[newPin.behindType]
          paragraphs.push([
            text('После '),
            move(refutation.san),
            text(
              pick(
                [
                  ` возникает связка: ${PIECE_NAMES_NOMINATIVE[newPin.pinnedType]} на ${newPin.pinned} не может уйти, за ${agree(newPin.pinnedType, 'ним', 'ней')} ${behind}.`,
                  ` ${PIECE_NAMES_NOMINATIVE[newPin.pinnedType]} на ${newPin.pinned} ${agree(newPin.pinnedType, 'оказывается связан', 'оказывается связана')}: за ${agree(newPin.pinnedType, 'ним', 'ней')} стоит ${behind}.`
                ],
                seed
              )
            )
          ])
        }
      }
    }
  }

  if (!inBook && fullmove <= 10 && classified.moveClass !== 'best' && classified.moveClass !== 'great' && classified.moveClass !== 'brilliant') {
    if (current.piece === 'q' && !current.captured && fullmove <= 6) {
      tags.push('early-queen')
      paragraphs.push([
        text(
          pick(
            [
              'Ранний вывод ферзя: соперник сможет развивать фигуры с темпом, нападая на него.',
              'Ферзь выходит слишком рано — его будут гонять, выигрывая время на развитие.'
            ],
            seed
          )
        )
      ])
    }
    const earlier = moves.slice(0, index).filter((candidate) => candidate.color === current.color)
    const movedAgain = earlier.some((candidate) => candidate.to === current.from && candidate.piece === current.piece)
    if (movedAgain && current.piece !== 'p' && current.piece !== 'k' && !current.captured && undevelopedMinors(current.fenBefore, current.color) >= 2) {
      tags.push('repeated-move')
      paragraphs.push([
        text(
          pick(
            [
              'Повторный ход одной и той же фигурой в дебюте теряет темп, пока другие фигуры не развиты.',
              'В дебюте лучше не ходить одной фигурой дважды: остальные ещё стоят на месте.'
            ],
            seed
          )
        )
      ])
    }
    const file = current.from[0]
    if (current.piece === 'p' && 'abgh'.includes(file) && !current.captured && fullmove <= 8 && undevelopedMinors(current.fenBefore, current.color) >= 2 && isBad) {
      tags.push('flank-pawn')
      paragraphs.push([
        text(
          pick(
            [
              'Ход крайней пешкой вместо развития фигур.',
              'Фланговый пешечный ход в дебюте, когда фигуры ещё не развиты, обычно теряет время.'
            ],
            seed
          )
        )
      ])
    }
  }

  if (fullmove >= 12 && fullmove <= 13) {
    const history = moves.slice(0, index + 1).map((candidate) => candidate.fenAfter)
    const firstAtTwelve = !moves.slice(0, index).some((candidate) => candidate.color === current.color && Number(candidate.fenBefore.split(' ')[5]) >= 12)
    const king = kingSquare(current.fenAfter, current.color)
    if (
      firstAtTwelve &&
      current.piece !== 'k' &&
      !hasCastled(history, current.color) &&
      castlingRights(current.fenAfter, current.color) &&
      king !== null &&
      'de'.includes(king[0]) &&
      !isEndgamePosition(current.fenAfter)
    ) {
      tags.push('no-castling')
      paragraphs.push([
        text(
          pick(
            [
              'Король так и не рокировался к 12-му ходу — в центре он уязвим.',
              'Уже 12-й ход, а король всё ещё в центре: стоит подумать о рокировке.'
            ],
            seed
          )
        )
      ])
    }
  }

  if (!inBook) {
    const structureBefore = pawnStructure(current.fenBefore, current.color)
    const structureAfter = pawnStructure(current.fenAfter, current.color)
    const newDoubled = structureAfter.doubled.filter((file) => !structureBefore.doubled.includes(file))
    const newIsolated = structureAfter.isolated.filter((file) => !structureBefore.isolated.includes(file))
    if (newDoubled.length && isBad) {
      tags.push('doubled-pawns')
      paragraphs.push([text(`Появились сдвоенные пешки по линии ${newDoubled[0]}.`)])
    }
    if (newIsolated.length && isBad) {
      tags.push('isolated-pawn')
      paragraphs.push([text(`Пешка по линии ${newIsolated[0]} стала изолированной: её будет трудно защищать.`)])
    }
    const opponentBefore = pawnStructure(current.fenBefore, opponent)
    const opponentAfter = pawnStructure(current.fenAfter, opponent)
    const spoiled = opponentAfter.doubled.filter((file) => !opponentBefore.doubled.includes(file))
    if (spoiled.length && !isBad) {
      paragraphs.push([text(`У соперника после размена сдвоенные пешки по линии ${spoiled[0]}.`)])
    }
    const newPassers = structureAfter.passed.filter((square) => !structureBefore.passed.some((old) => old[0] === square[0]))
    if (newPassers.length && !isBad && isEndgamePosition(current.fenAfter)) {
      paragraphs.push([text(`Появилась проходная пешка на ${newPassers[0]}.`)])
    }
  }

  if (isEndgamePosition(current.fenBefore) && isBad && classified.bestUci) {
    const bestFrom = classified.bestUci.slice(0, 2)
    const bestPiece = pieceOn(current.fenBefore, bestFrom)
    if (bestPiece?.type === 'k' && current.piece !== 'k') {
      const gain = kingCentralization(classified.bestUci.slice(2, 4)) - kingCentralization(bestFrom)
      if (gain > 0) {
        tags.push('passive-king')
        paragraphs.push([
          text(
            pick(
              [
                'В эндшпиле король должен быть активным: движок предлагал идти королём в центр.',
                'Король остаётся пассивным, хотя в эндшпиле это сильная фигура.'
              ],
              seed
            )
          )
        ])
      }
    }
    if (bestPiece?.type === 'p' && current.piece !== 'p') {
      const passed = pawnStructure(current.fenBefore, current.color).passed
      if (passed.includes(bestFrom)) {
        tags.push('missed-passer')
        paragraphs.push([text(`Упущена возможность продвинуть проходную пешку ${bestFrom}.`)])
      }
    }
  }

  if (classified.moveClass === 'brilliant') tags.push('sacrifice')
  if (classified.moveClass === 'great') tags.push('only-move')

  const previous = context.classified[index - 1]
  if (previous && SERIOUS_CLASSES.includes(previous.moveClass)) {
    if (classified.isBest || classified.moveClass === 'excellent') {
      tags.push('punished')
      paragraphs.push([
        text(
          pick(
            ['Ошибка соперника наказана.', 'Точная реакция на ошибку соперника.', 'Ход использует промах соперника.'],
            seed
          )
        )
      ])
    } else if (isBad) {
      tags.push('missed-punish')
    }
  }

  if (!isBad && current.san.startsWith('O-O') && !inBook) {
    paragraphs.push([text(pick(['Рокировка: король в безопасности, ладья вступает в игру.', 'Своевременная рокировка.'], seed))])
  }
  if (!isBad && current.promotion) {
    paragraphs.push([text(`Пешка превращается в ${current.promotion === 'q' ? 'ферзя' : PIECE_NAMES_GENITIVE[current.promotion]}.`)])
  }
  if (!isBad && current.captured && after && before && !inBook) {
    const moverAfter = winPercentFor(after.lines[0]?.score, current.color)
    if (moverAfter >= 75 && valueOf(current.captured) === valueOf(current.piece) && current.piece !== 'p') {
      paragraphs.push([text('Размены выгодны стороне с перевесом: хорошее упрощение.')])
    }
  }
  return { paragraphs, tags }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function valueOf(type: string): number {
  return ({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 } as Record<string, number>)[type] ?? 0
}

function attackerTypes(fen: string, square: string, color: Color): string[] {
  return attackersOf(fen, square, color)
    .map((from) => pieceOn(fen, from)?.type ?? '')
    .filter(Boolean)
}

export function commentMove(context: CommentContext): MoveComment | null {
  const { moves, positions, classified, index, userColor } = context
  const current = moves[index]
  const verdict = classified[index]
  const before = positions[index]
  const after = positions[index + 1]
  if (!current || !verdict || !before || !after) return null
  const voice = voiceFor(current.color, userColor)
  const seed = current.ply
  const paragraphs: Paragraph[] = []
  const bestUci = verdict.bestUci
  const bestLine = before.lines[0] ? applyUciLine(current.fenBefore, before.lines[0].pv, 10).sans : []
  const bestSan = bestLine[0] ?? null
  const refutation = refutationOf(current, after)
  const refutationLine = after.lines[0] ? applyUciLine(current.fenAfter, after.lines[0].pv, 10).sans : []

  paragraphs.push([
    text(`${voice.subject} ${voice.played} `),
    move(current.san),
    text(': оценка '),
    score(before.lines[0]?.score),
    text(' → '),
    score(after.lines[0]?.score),
    text('.')
  ])

  const classLine = pick(CLASS_TEMPLATES[verdict.moveClass], seed)
  const isBad = BAD_CLASSES.includes(verdict.moveClass)
  if (verdict.moveClass === 'book') {
    paragraphs.push([text(context.openingName ? `${classLine} ${context.openingName}.` : classLine)])
  } else if (verdict.moveClass === 'great' && before.lines[1]) {
    const secondSan = applyUciLine(current.fenBefore, before.lines[1].pv, 1).sans[0]
    paragraphs.push([
      text(`${classLine} Следующий по силе ход `),
      move(secondSan ?? ''),
      text(' даёт только '),
      score(before.lines[1].score),
      text('.')
    ])
  } else if (!isBad) {
    if (verdict.isBest || !bestSan || bestUci === current.uci) {
      paragraphs.push([text(classLine)])
    } else {
      paragraphs.push([text(`${classLine} ${pick(BEST_PREFERRED_TEMPLATES, seed)}`), move(bestSan), text('.')])
    }
  } else {
    paragraphs.push([text(`${classLine} Шанс на победу упал на ${verdict.loss.toFixed(0)}%.`)])
    if (verdict.moveClass === 'miss' && index > 0) {
      paragraphs.push([text('Соперник ошибся ходом '), move(moves[index - 1].san), text(', и наказать его можно было ходом '), move(bestSan ?? ''), text('.')])
    }
    if (bestSan) {
      const bestCapture = bestUci ? pieceOn(current.fenBefore, bestUci.slice(2, 4)) : null
      paragraphs.push([
        text('Сильнее было '),
        move(bestSan),
        text(bestCapture && bestCapture.color !== current.color ? ' (со взятием)' : ''),
        text(' с оценкой '),
        score(before.lines[0]?.score),
        text('.')
      ])
      paragraphs.push([line(current.fenBefore, bestLine.slice(0, 7))])
    }
    if (refutation) {
      const next = moves[index + 1]
      const found = next ? next.uci === refutation.uci : null
      const intro = `Почему плохо: после этого хода ${voice.other} ${voice.otherCould} ответить `
      let tail = '.'
      if (refutation.mateIn) tail = `, и там форсированный мат в ${refutation.mateIn} ${pluralRu(refutation.mateIn, 'ход', 'хода', 'ходов')}.`
      else if (refutation.materialSwing >= 1) tail = ` и выиграть ${materialWord(refutation.materialSwing)}.`
      const paragraph: Paragraph = [text(intro), move(refutation.san), text(tail)]
      if (found !== null) paragraph.push(text(` ${found ? voice.otherFound : voice.otherMissed}`))
      paragraphs.push(paragraph)
      paragraphs.push([line(current.fenAfter, refutationLine.slice(0, 7))])
    }
  }

  const remarks = featureRemarks(context, current, verdict, refutation)
  paragraphs.push(...remarks.paragraphs)
  if (isBad && refutation && refutation.materialSwing >= 1) remarks.tags.push('material-loss')

  const short: Paragraph = isBad && bestSan ? [text('лучше '), move(bestSan)] : []
  return {
    paragraphs,
    tags: [...new Set(remarks.tags)],
    short,
    refutation,
    bestSan,
    bestLine,
    refutationLine
  }
}

export function spanToText(span: Span, notation: NotationMode): string {
  switch (span.kind) {
    case 'text':
      return span.text
    case 'move':
      return displaySan(span.san, notation)
    case 'score':
      return formatScore(span.score)
    case 'line':
      return formatLine(span.fen, span.sans, notation)
  }
}

export function paragraphToText(paragraph: Paragraph, notation: NotationMode): string {
  return paragraph.map((span) => spanToText(span, notation)).join('')
}
