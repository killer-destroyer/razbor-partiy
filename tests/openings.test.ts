import { describe, expect, it } from 'vitest'
import { parsePgn } from '@renderer/analysis/pgn'
import { translateOpeningName } from '@renderer/openings/translate'
import { searchOpenings, buildOpeningTree, looksLikeMoves } from '@renderer/openings/tree'
import { guideFor, parseGuides } from '@renderer/openings/guides'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadBook } from './helpers'

function detect(moves: string) {
  const game = parsePgn(moves)
  return loadBook().detect(game.fens, game.moves.map((move) => move.uci))
}

describe('определение дебюта', () => {
  it.each([
    ['1. e4 e5 2. Nf3 Nc6 3. Bb5', 'C60', 'Ruy Lopez'],
    ['1. e4 c5', 'B20', 'Sicilian Defense'],
    ['1. d4 d5 2. c4 e6', 'D30', "Queen's Gambit Declined"],
    ['1. e4 e6', 'C00', 'French Defense'],
    ['1. e4 c6', 'B10', 'Caro-Kann Defense'],
    ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5', 'C50', 'Italian Game'],
    ['1. d4 Nf6 2. c4 e6 3. Nc3 Bb4', 'E20', 'Nimzo-Indian Defense'],
    ['1. c4 e5', 'A20', 'English Opening'],
    ['1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6', 'E70', "King's Indian Defense"]
  ])('%s → %s %s', (moves, eco, name) => {
    const result = detect(moves)
    expect(result.opening?.eco).toBe(eco)
    expect(result.opening?.name.startsWith(name)).toBe(true)
  })

  it('транспозиция 1.Nf3 d5 2.d4 даёт ферзевые начала', () => {
    const result = detect('1. Nf3 d5 2. d4')
    expect(result.opening?.name.startsWith("Queen's Pawn Game")).toBe(true)
    expect(result.bookPlies).toBe(3)
  })

  it('транспозиция в защиту Нимцовича через 1.Nf3', () => {
    const result = detect('1. Nf3 Nf6 2. c4 e6 3. Nc3 Bb4 4. d4')
    expect(result.opening?.name.startsWith('Nimzo-Indian Defense')).toBe(true)
  })

  it('выход из теории отмечается первым ходом без совпадения', () => {
    const result = detect('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Qe2 h5 7. a3 a5')
    expect(result.exitPly).not.toBeNull()
    expect(result.exitPly!).toBeGreaterThan(10)
  })

  it('переводит названия на русский, оставляя непереведённые хвосты', () => {
    expect(translateOpeningName('Slav Defense: Three Knights Variation')).toBe('Славянская защита: Вариант трёх коней')
    expect(translateOpeningName('Sicilian Defense: Najdorf Variation')).toBe('Сицилианская защита: Вариант Найдорфа')
    expect(translateOpeningName("Queen's Gambit Declined")).toBe('Отказанный ферзевый гамбит')
    expect(translateOpeningName('Ruy Lopez: Zukertort Gambit')).toBe('Испанская партия: Гамбит Zukertort')
  })

  it('ищет по ходам, ECO и названию на двух языках', () => {
    const openings = loadBook().openings
    expect(looksLikeMoves('e4 c5 Nf3')).toBe(true)
    expect(searchOpenings(openings, 'e4 c5 Nf3').every((opening) => opening.pgn.startsWith('1. e4 c5 2. Nf3'))).toBe(true)
    expect(searchOpenings(openings, 'e4 c5 Кf3').length).toBeGreaterThan(0)
    expect(searchOpenings(openings, 'D15').every((opening) => opening.eco === 'D15')).toBe(true)
    expect(searchOpenings(openings, 'Najdorf').length).toBeGreaterThan(10)
    expect(searchOpenings(openings, 'найдорф').length).toBeGreaterThan(10)
  })

  it('строит дерево семейств', () => {
    const tree = buildOpeningTree(loadBook().openings)
    const slav = tree.find((node) => node.englishName === 'Slav Defense')
    expect(slav?.label).toBe('Славянская защита')
    expect(slav?.children.length).toBeGreaterThan(5)
  })
})

describe('гайды дебютов', () => {
  const guides = parseGuides(readFileSync(resolve(__dirname, '../resources/openings/guides.json'), 'utf8'))

  it('не меньше 80 семейств с заполненными полями', () => {
    expect(guides.length).toBeGreaterThanOrEqual(80)
    for (const guide of guides) {
      expect(guide.idea.length).toBeGreaterThan(40)
      expect(guide.pros.length).toBeGreaterThan(0)
      expect(guide.cons.length).toBeGreaterThan(0)
      expect(guide.plansWhite.length).toBeGreaterThan(0)
      expect(guide.plansBlack.length).toBeGreaterThan(0)
      expect(Array.isArray(guide.traps)).toBe(true)
    }
  })

  it('более конкретный гайд выигрывает у гайда семейства', () => {
    expect(guideFor(guides, { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' })?.family).toContain('Найдорф')
    expect(guideFor(guides, { eco: 'B50', name: 'Sicilian Defense' })?.family).toBe('Сицилианская защита')
    expect(guideFor(guides, { eco: 'D15', name: 'Slav Defense: Three Knights Variation' })?.family).toBe('Славянская защита')
  })
})
