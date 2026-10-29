import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PositionAnalysis } from '@shared/types'
import { parsePgn } from '@renderer/analysis/pgn'
import { buildReview } from '@renderer/analysis/review'
import { BAD_CLASSES } from '@renderer/analysis/classify'
import { paragraphToText } from '@renderer/analysis/commentary'
import { annotatedPgn } from '@renderer/analysis/export'
import { compactReview } from '@renderer/analysis/compact'
import { APPENDIX_B_PGN } from './fixtures/appendix-b-pgn'
import { loadBook } from './helpers'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/appendix-b-analysis.json'), 'utf8')) as { positions: PositionAnalysis[] }
const game = parsePgn(APPENDIX_B_PGN)
const opening = loadBook().detect(game.fens, game.moves.map((move) => move.uci))
const review = buildReview({ game, positions: fixture.positions, opening, userColor: 'b', profile: 'strict' })
const plyOf = (moveNumber: number, color: 'w' | 'b'): number => (moveNumber - 1) * 2 + (color === 'w' ? 0 : 1)

describe('эталонная партия из Приложения B', () => {
  it('дебют — славянская защита D15, выход из теории на 4...Кbd7', () => {
    expect(opening.opening?.eco).toBe('D15')
    expect(opening.opening?.name.startsWith('Slav Defense')).toBe(true)
    expect(opening.nameRu?.startsWith('Славянская защита')).toBe(true)
    expect(opening.exitPly).toBe(8)
  })

  it('самый дорогой ход чёрных — 11...b6', () => {
    const black = review.moves.filter((entry) => entry && entry.color === 'b')
    const worst = black.reduce((max, entry) => (entry!.loss > max!.loss ? entry : max))
    expect(worst?.san).toBe('b6')
    expect(worst?.index).toBe(plyOf(11, 'b'))
    expect(['mistake', 'blunder', 'miss']).toContain(worst?.moveClass)
  })

  it('ошибки чёрных из эталона найдены (±1 класс)', () => {
    for (const [number, san] of [[7, 'Nh5'], [9, 'Bg7'], [10, 'O-O'], [11, 'b6'], [23, 'Rf7'], [24, 'Qf4']] as const) {
      const entry = review.moves[plyOf(number, 'b')]
      expect(entry?.san).toBe(san)
      expect(BAD_CLASSES).toContain(entry?.moveClass)
    }
  })

  it('ошибки белых из эталона найдены (±1 класс)', () => {
    for (const [number, san] of [[11, 'Bc2'], [17, 'g4'], [18, 'gxf5'], [24, 'Qe3'], [25, 'Ne5']] as const) {
      const entry = review.moves[plyOf(number, 'w')]
      expect(entry?.san).toBe(san)
      expect(BAD_CLASSES).toContain(entry?.moveClass)
    }
  })

  it('чёрные в итоге выигрывают и играли точнее', () => {
    const final = fixture.positions[fixture.positions.length - 1].lines[0].score
    expect(final.type === 'cp' ? final.cp : -10000).toBeLessThan(-300)
    expect(review.black.accuracy!).toBeGreaterThan(review.white.accuracy!)
  })

  it('итог находит слабость пешки d5 с 7-го по 11-й ход', () => {
    const text = review.summary.map((paragraph) => paragraphToText(paragraph, 'ru')).join('\n')
    expect(text).toContain('пешка d5')
    expect(text).toMatch(/С 7-го по 11-й ход/)
    expect(text).toMatch(/5 раз подряд/)
    expect(text).toContain('cxd5')
  })

  it('комментарий к 11...b6 объясняет, что было лучше и чем соперник мог наказать', () => {
    const comment = review.moves[plyOf(11, 'b')]!.comment!
    const text = comment.paragraphs.map((paragraph) => paragraphToText(paragraph, 'ru')).join('\n')
    expect(comment.bestSan).toBe('dxc4')
    expect(text).toContain('Сильнее было dxc4')
    expect(text).toContain('cxd5')
  })

  it('экспорт PGN содержит оценки [%eval] и NAG', () => {
    const pgn = annotatedPgn(game, fixture.positions, review)
    expect(pgn).toContain('[%eval')
    expect(pgn).toMatch(/b6 \$[246]/)
    expect(parsePgn(pgn).moves).toHaveLength(50)
  })

  it('компактная сводка для статистики', () => {
    const compact = compactReview(review)
    expect(compact.moves).toHaveLength(50)
    expect(compact.openingEco).toBe('D15')
    expect(compact.firstSeriousMistakeMove).not.toBeNull()
  })
})
