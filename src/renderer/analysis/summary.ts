import type { Color, ParsedGame, PositionAnalysis } from '@shared/types'
import type { OpeningDetection } from '../openings/book'
import { BAD_CLASSES, SERIOUS_CLASSES } from './classify'
import type { CommentTag, Paragraph, Span } from './commentary'
import { hangingPieces, opposite } from './features'
import { pluralRu } from './notation'
import { applyUciLine } from './pgn'
import type { MoveReview, SideReport } from './review'
import { winPercentFor } from './winprob'

export interface GameTheme {
  kind: 'weak-point' | 'pattern'
  color: Color
  title: string
  moveIndexes: number[]
  paragraph: Paragraph
}

export interface SummaryInput {
  game: ParsedGame
  positions: Array<PositionAnalysis | null>
  moves: Array<MoveReview | null>
  opening: OpeningDetection | null
  white: SideReport
  black: SideReport
  userColor: Color | null
  turningPoint: number | null
  complete: boolean
}

const text = (value: string): Span => ({ kind: 'text', text: value })
const move = (san: string): Span => ({ kind: 'move', san })

const FEMININE = new Set(['p', 'r'])

const PIECE_SUBJECT: Record<string, string> = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' }

function fullmoveOf(fen: string): number {
  return Number(fen.split(' ')[5]) || 1
}

function moveRef(game: ParsedGame, index: number): Span[] {
  const current = game.moves[index]
  const number = fullmoveOf(current.fenBefore)
  return [text(`${number}${current.color === 'w' ? '.' : '...'}`), move(current.san)]
}

function sideLabel(color: Color, userColor: Color | null): { who: string; could: string; genitive: string } {
  if (userColor === null) {
    return color === 'w'
      ? { who: 'белые', could: 'могли', genitive: 'белых' }
      : { who: 'чёрные', could: 'могли', genitive: 'чёрных' }
  }
  return color === userColor
    ? { who: 'вы', could: 'могли', genitive: 'ваших' }
    : { who: 'соперник', could: 'мог', genitive: 'соперника' }
}

interface Opportunity {
  index: number
  square: string
  type: string
  san: string | null
}

function enPriseByMove(input: SummaryInput, color: Color): Map<number, Opportunity[]> {
  const result = new Map<number, Opportunity[]>()
  const bookPlies = input.opening?.bookPlies ?? 0
  input.game.moves.forEach((current, index) => {
    if (current.color !== color || index < bookPlies) return
    const after = input.positions[index + 1]
    const topUci = after?.lines[0]?.pv[0] ?? null
    const opportunities = hangingPieces(current.fenAfter, color).map((piece) => {
      const confirmed = topUci !== null && topUci.slice(2, 4) === piece.square
      return {
        index,
        square: piece.square,
        type: piece.type,
        san: confirmed ? (applyUciLine(current.fenAfter, [topUci!], 1).sans[0] ?? null) : null
      }
    })
    result.set(index, opportunities)
  })
  return result
}

function weakPointThemes(input: SummaryInput, color: Color): GameTheme[] {
  const byMove = enPriseByMove(input, color)
  const ownIndexes = [...byMove.keys()].sort((a, b) => a - b)
  const themes: GameTheme[] = []
  const labels = sideLabel(opposite(color), input.userColor)
  const active = new Map<string, Opportunity[]>()
  const flush = (run: Opportunity[]): void => {
    const confirmed = run.filter((entry) => entry.san)
    if (run.length < 3 || !confirmed.length) return
    const first = run[0]
    const last = run[run.length - 1]
    const feminine = FEMININE.has(first.type)
    const fromMove = fullmoveOf(input.game.moves[first.index].fenBefore)
    const toMove = fullmoveOf(input.game.moves[last.index].fenBefore)
    const sans = [...new Set(confirmed.map((entry) => entry.san))]
    const paragraph: Paragraph = [
      text(
        `С ${fromMove}-го по ${toMove}-й ход ${PIECE_SUBJECT[first.type]} ${first.square} ${feminine ? 'была' : 'был'} недостаточно ${feminine ? 'защищена' : 'защищён'}: ${labels.who} ${run.length} ${pluralRu(run.length, 'раз', 'раза', 'раз')} подряд ${labels.could} выиграть ${feminine ? 'её' : 'его'}`
      )
    ]
    if (sans.length === 1) paragraph.push(text(' ходом '), move(sans[0]!))
    paragraph.push(text('.'))
    themes.push({ kind: 'weak-point', color, title: `Слабость ${first.square}`, moveIndexes: run.map((entry) => entry.index), paragraph })
  }
  for (const index of ownIndexes) {
    const current = byMove.get(index) ?? []
    const keys = new Set(current.map((entry) => `${entry.square}:${entry.type}`))
    for (const [key, run] of [...active.entries()]) {
      if (!keys.has(key)) {
        flush(run)
        active.delete(key)
      }
    }
    for (const entry of current) {
      const key = `${entry.square}:${entry.type}`
      active.set(key, [...(active.get(key) ?? []), entry])
    }
  }
  for (const run of active.values()) flush(run)

  const covered = new Set(themes.map((theme) => theme.title))
  const grouped = new Map<string, number[]>()
  input.moves.forEach((entry, index) => {
    if (!entry || entry.color !== color || !BAD_CLASSES.includes(entry.moveClass)) return
    const refutation = entry.comment?.refutation
    if (!refutation?.captureSquare || !refutation.capturedType || refutation.capturedType === 'k') return
    const key = `${refutation.captureSquare}:${refutation.capturedType}`
    grouped.set(key, [...(grouped.get(key) ?? []), index])
  })
  for (const [key, indexes] of grouped) {
    const [square, type] = key.split(':')
    if (indexes.length < 2 || covered.has(`Слабость ${square}`)) continue
    const subject = sideLabel(color, input.userColor)
    const accusative = { p: 'пешку', n: 'коня', b: 'слона', r: 'ладью', q: 'ферзя' }[type] ?? PIECE_SUBJECT[type]
    themes.push({
      kind: 'weak-point',
      color,
      title: `Слабость ${square}`,
      moveIndexes: indexes,
      paragraph: [
        text(
          `${capitalize(subject.who)} ${indexes.length} ${pluralRu(indexes.length, 'раз', 'раза', 'раз')} ${input.userColor === color ? 'оставляли' : input.userColor === null ? 'оставляли' : 'оставлял'} ${accusative} ${square} без защиты.`
        )
      ]
    })
  }
  return themes
}

const PATTERN_TEXT: Partial<Record<CommentTag, { title: string; phrase: (count: number) => string }>> = {
  hanging: { title: 'Незащищённые фигуры', phrase: (count) => `${count} ${pluralRu(count, 'раз', 'раза', 'раз')} фигура оставалась без защиты` },
  fork: { title: 'Вилки', phrase: (count) => `${count} ${pluralRu(count, 'раз', 'раза', 'раз')} пропущена вилка` },
  pin: { title: 'Связки', phrase: (count) => `${count} ${pluralRu(count, 'раз', 'раза', 'раз')} позиция страдала от связки` },
  'missed-capture': { title: 'Упущенные взятия', phrase: (count) => `${count} ${pluralRu(count, 'раз', 'раза', 'раз')} не забрали незащищённый материал` },
  mate: { title: 'Матовые угрозы', phrase: (count) => `${count} ${pluralRu(count, 'раз', 'раза', 'раз')} допущен форсированный мат` },
  'missed-mate': { title: 'Упущенный мат', phrase: (count) => `${count} ${pluralRu(count, 'раз', 'раза', 'раз')} упущен форсированный мат` },
  'missed-punish': { title: 'Ненаказанные ошибки', phrase: (count) => `${count} ${pluralRu(count, 'раз', 'раза', 'раз')} не наказали ошибку соперника` }
}

function patternThemes(input: SummaryInput, color: Color): GameTheme[] {
  const counts = new Map<CommentTag, number[]>()
  input.moves.forEach((entry, index) => {
    if (!entry || entry.color !== color || !BAD_CLASSES.includes(entry.moveClass)) return
    for (const tag of entry.comment?.tags ?? []) counts.set(tag, [...(counts.get(tag) ?? []), index])
  })
  const themes: GameTheme[] = []
  for (const [tag, indexes] of counts) {
    const description = PATTERN_TEXT[tag]
    if (!description || indexes.length < 2) continue
    themes.push({
      kind: 'pattern',
      color,
      title: description.title,
      moveIndexes: indexes,
      paragraph: [text(`${capitalize(description.phrase(indexes.length))}.`)]
    })
  }
  return themes
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function lineGap(position: PositionAnalysis | null, color: Color): number {
  if (!position?.lines[0] || !position.lines[1]) return 0
  return winPercentFor(position.lines[0].score, color) - winPercentFor(position.lines[1].score, color)
}

function pickBestMove(input: SummaryInput): number | null {
  const candidates = input.moves.filter(
    (entry): entry is MoveReview =>
      entry !== null &&
      (input.userColor === null || entry.color === input.userColor) &&
      ['brilliant', 'great', 'best'].includes(entry.moveClass)
  )
  if (!candidates.length) return null
  const rank = { brilliant: 2, great: 1, best: 0 } as Record<string, number>
  candidates.sort(
    (a, b) => rank[b.moveClass] - rank[a.moveClass] || lineGap(input.positions[b.index], b.color) - lineGap(input.positions[a.index], a.color)
  )
  return candidates[0].index
}

function adviceFor(input: SummaryInput, themes: GameTheme[], focus: Color): string {
  const report = focus === 'w' ? input.white : input.black
  const tagged = themes.filter((theme) => theme.color === focus)
  if (tagged.some((theme) => theme.kind === 'weak-point')) {
    return 'Совет: перед каждым ходом проверяйте, что остаётся без защиты после него, особенно центральные пешки и фигуры на открытых линиях.'
  }
  if (tagged.some((theme) => theme.title === 'Вилки')) return 'Совет: следите за полями, с которых конь или ферзь соперника может напасть сразу на две ваши фигуры.'
  if (tagged.some((theme) => theme.title === 'Связки')) return 'Совет: не ставьте ценные фигуры на одну линию с королём или ферзём, если на неё может выйти слон или ладья соперника.'
  if (tagged.some((theme) => theme.title === 'Упущенные взятия' || theme.title === 'Ненаказанные ошибки')) {
    return 'Совет: после каждого хода соперника спрашивайте себя, что он оставил без защиты и нельзя ли это забрать.'
  }
  const blunderClocks = input.moves.filter(
    (entry) => entry && entry.color === focus && SERIOUS_CLASSES.includes(entry.moveClass) && entry.clockLeft !== null && entry.clockLeft < 30
  )
  if (blunderClocks.length >= 2) return 'Совет: серьёзные ошибки пришлись на цейтнот — распределяйте время ровнее и не тратьте много в дебюте.'
  const phases = Object.entries(report.phases).filter(([, value]) => value !== null) as Array<[string, number]>
  if (phases.length) {
    phases.sort((a, b) => a[1] - b[1])
    const weakest = phases[0][0]
    if (weakest === 'opening') {
      return input.opening?.nameRu
        ? `Совет: самая низкая точность в дебюте — повторите «${input.opening.nameRu}» в тренажёре дебютов.`
        : 'Совет: самая низкая точность в дебюте — уделите внимание развитию фигур и рокировке.'
    }
    if (weakest === 'endgame') return 'Совет: точность в эндшпиле ниже остальных фаз — потренируйте активного короля и проходные пешки.'
    return 'Совет: в миттельшпиле перед ходом считайте форсированные варианты соперника: шахи, взятия, угрозы.'
  }
  return 'Совет: продолжайте в том же духе и разбирайте свои партии после игры.'
}

export function buildSummary(input: SummaryInput): { summary: Paragraph[]; themes: GameTheme[]; bestMoveIndex: number | null } {
  const { game, opening, white, black, userColor, turningPoint } = input
  const summary: Paragraph[] = []
  if (opening?.opening) {
    const paragraph: Paragraph = [text(`Дебют: ${opening.nameRu} (${opening.opening.eco}).`)]
    if (opening.exitPly !== null && game.moves[opening.exitPly - 1]) {
      paragraph.push(text(' Из теории вышли на ходу '), ...moveRef(game, opening.exitPly - 1), text('.'))
    } else {
      paragraph.push(text(' Вся партия прошла в рамках теории.'))
    }
    summary.push(paragraph)
  }
  if (!input.complete) {
    summary.push([text('Полный итог появится, когда анализ закончится.')])
    return { summary, themes: [], bestMoveIndex: null }
  }
  const describe = (report: SideReport, label: string): string => {
    if (report.accuracy === null) return `${label}: нет данных`
    return `${label} — точность ${report.accuracy.toFixed(1)}%, игра на уровне ~${report.rating ?? '—'}`
  }
  summary.push([text(`${describe(white, 'Белые')}; ${describe(black, 'чёрные')} (рейтинг ориентировочный).`)])
  const finalPosition = input.positions[input.positions.length - 1]
  if (userColor && finalPosition) {
    const mine = winPercentFor(finalPosition.lines[0]?.score ?? (finalPosition.terminal ? { type: 'cp', cp: 0 } : null), userColor)
    const verdict =
      mine > 75
        ? 'В финальной позиции у вас решающий перевес.'
        : mine > 58
          ? 'В финальной позиции вы стоите лучше.'
          : mine >= 42
            ? 'Финальная позиция примерно равная.'
            : mine >= 25
              ? 'В финальной позиции вы стоите хуже.'
              : 'В финальной позиции у соперника решающий перевес.'
    summary.push([text(verdict)])
  }
  if (turningPoint !== null) {
    const entry = input.moves[turningPoint]
    if (entry) {
      summary.push([
        text('Переломный момент: '),
        ...moveRef(game, turningPoint),
        text(` — шанс на победу ${entry.color === 'w' ? 'белых' : 'чёрных'} упал на ${entry.loss.toFixed(0)}%.`)
      ])
    }
  }
  const bestMoveIndex = pickBestMove(input)
  if (bestMoveIndex !== null) {
    const entry = input.moves[bestMoveIndex]!
    const label = entry.moveClass === 'brilliant' ? 'блестящий' : entry.moveClass === 'great' ? 'отличная находка' : 'лучший'
    summary.push([text('Лучший ход партии: '), ...moveRef(game, bestMoveIndex), text(` (${label}).`)])
  }
  const focusColors: Color[] = userColor ? [userColor] : ['w', 'b']
  const themes = focusColors.flatMap((color) => [...weakPointThemes(input, color), ...patternThemes(input, color)])
  if (themes.length) {
    summary.push([text('Повторяющиеся темы:')])
    for (const theme of themes) summary.push(theme.paragraph)
  }
  if (userColor) {
    const opponentWeak = weakPointThemes(input, opposite(userColor))
    for (const theme of opponentWeak) {
      themes.push(theme)
      summary.push([text('У соперника: '), ...theme.paragraph])
    }
  }
  summary.push([text(adviceFor(input, themes, userColor ?? 'w'))])
  return { summary, themes, bestMoveIndex }
}
