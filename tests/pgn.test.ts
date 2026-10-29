import { describe, expect, it } from 'vitest'
import { isFen, parsePgn, parsedFromFen, PgnParseError, splitPgnGames, tokenizeMovetext } from '@renderer/analysis/pgn'
import { displaySan, normalizeMoveToken } from '@renderer/analysis/notation'
import { APPENDIX_B_PGN } from './fixtures/appendix-b-pgn'

describe('разбор PGN', () => {
  it('понимает русскую нотацию фигур и рокировку нулями', () => {
    const game = parsePgn('1. e4 e5 2. Кf3 Кc6 3. Сc4 Сc5 4. 0-0 Кf6 5. Лe1 0-0 6. Фe2 Крh8')
    expect(game.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'Re1', 'O-O', 'Qe2', 'Kh8'])
  })

  it('понимает кириллическую «х» как взятие и двоеточие', () => {
    const game = parsePgn('1. e4 d5 2. eхd5 Фxd5 3. Кc3 Фa5 4. d4 c6 5. Кf3 Сg4 6. h3 С:f3')
    expect(game.moves[2].san).toBe('exd5')
    expect(game.moves[11].san).toBe('Bxf3')
  })

  it('вырезает комментарии, варианты, NAG, номера ходов и результат', () => {
    const text = '1. e4 {лучший ход} e5 (1... c5 2. Nf3 (2. c3)) 2. Nf3 $1 Nc6 3... ; комментарий до конца строки\n 3. Bb5 a6!? 1-0'
    const game = parsePgn(text)
    expect(game.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'])
  })

  it('читает время на часах [%clk]', () => {
    const game = parsePgn('1. e4 {[%clk 0:09:58.4]} e5 {[%clk 0:09:57]} 2. Nf3 {[%clk 1:00:01]}')
    expect(game.moves.map((move) => move.clockSeconds)).toEqual([598.4, 597, 3601])
  })

  it('учитывает заголовок FEN', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7 2. e5')
    expect(game.startFen).toBe('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')
    expect(game.moves).toHaveLength(3)
  })

  it('ошибочный ход даёт понятную ошибку с номером хода', () => {
    try {
      parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Qxf7')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(PgnParseError)
      const parsed = error as PgnParseError
      expect(parsed.moveNumber).toBe(4)
      expect(parsed.color).toBe('w')
      expect(parsed.message).toContain('Qxf7')
      expect(parsed.message).toContain('ход 4')
    }
  })

  it('разбирает эталонную партию из Приложения B', () => {
    const game = parsePgn(APPENDIX_B_PGN)
    expect(game.moves).toHaveLength(50)
    expect(game.moves[21].san).toBe('b6')
    expect(game.moves[43].san).toBe('Rad8')
  })

  it('разделяет файл с несколькими партиями', () => {
    const games = splitPgnGames('[White "a"]\n\n1. e4 e5 1-0\n\n[White "b"]\n\n1. d4 d5 0-1')
    expect(games).toHaveLength(2)
    expect(parsePgn(games[1]).moves[0].san).toBe('d4')
  })

  it('распознаёт FEN', () => {
    expect(isFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(true)
    expect(isFen('8/8/8/8/8/8/8/K6k w')).toBe(true)
    expect(isFen('1. e4 e5')).toBe(false)
    expect(parsedFromFen('8/8/8/8/8/8/8/K6k w').fens).toHaveLength(1)
  })

  it('нормализует ходы и показывает русскую нотацию', () => {
    expect(normalizeMoveToken('Крe2')).toBe('Ke2')
    expect(normalizeMoveToken('e8Ф')).toBe('e8=Q')
    expect(normalizeMoveToken('е2-е4')).toBe('e2e4')
    expect(displaySan('Nbd7', 'ru')).toBe('Кbd7')
    expect(displaySan('Kxf7', 'ru')).toBe('Крxf7')
    expect(displaySan('e8=Q+', 'ru')).toBe('e8=Ф+')
    expect(displaySan('Bb5', 'icons')).toBe('♗b5')
    expect(tokenizeMovetext('12... Nf6 13.Bd3').filter((token) => token.kind === 'move').map((token) => token.text)).toEqual(['Nf6', 'Bd3'])
  })
})
