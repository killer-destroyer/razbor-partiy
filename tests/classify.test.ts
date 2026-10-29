import { describe, expect, it } from 'vitest'
import { classifyMoves, CHESSCOM_THRESHOLDS, STRICT_THRESHOLDS, classifyByLoss } from '@renderer/analysis/classify'
import { parsePgn } from '@renderer/analysis/pgn'
import { cp, cpForWinPercent, position } from './helpers'

function singleMove(lossPercent: number, played = 'e2e4', best = 'd2d4') {
  const game = parsePgn(played === 'e2e4' ? '1. e4' : '1. d4')
  const before = position(game.fens[0], cp(0), [best, 'g8f6'])
  const after = position(game.fens[1], cp(cpForWinPercent(50 - lossPercent)), ['g8f6'])
  return classifyMoves({ moves: game.moves, positions: [before, after], bookPlies: 0, thresholds: CHESSCOM_THRESHOLDS })[0]!
}

describe('классификация по потере шанса (профиль chess.com)', () => {
  it('совпадение с первым ходом движка — «Лучший»', () => {
    expect(singleMove(0, 'e2e4', 'e2e4').moveClass).toBe('best')
  })

  it.each([
    [1, 'excellent'],
    [3, 'good'],
    [7, 'inaccuracy'],
    [15, 'mistake'],
    [30, 'blunder']
  ])('потеря %d%% — %s', (loss, expected) => {
    const result = singleMove(loss)
    expect(result.moveClass).toBe(expected)
    expect(result.loss).toBeCloseTo(loss, 0)
  })

  it('пороги строгого профиля: 7 / 12 / 18', () => {
    expect(classifyByLoss(6.9, STRICT_THRESHOLDS)).toBe('good')
    expect(classifyByLoss(7, STRICT_THRESHOLDS)).toBe('inaccuracy')
    expect(classifyByLoss(12, STRICT_THRESHOLDS)).toBe('mistake')
    expect(classifyByLoss(18, STRICT_THRESHOLDS)).toBe('blunder')
  })

  it('книжные ходы помечаются до выхода из теории', () => {
    const game = parsePgn('1. e4 e5')
    const positions = game.fens.map((fen) => position(fen, cp(20), ['g1f3']))
    const result = classifyMoves({ moves: game.moves, positions, bookPlies: 2, thresholds: CHESSCOM_THRESHOLDS })
    expect(result.map((entry) => entry?.moveClass)).toEqual(['book', 'book'])
  })

  it('единственный хороший ход — «Отличная находка»', () => {
    const game = parsePgn('1. e4')
    const before = position(game.fens[0], cp(0), ['e2e4'], { score: cp(cpForWinPercent(35)), pv: ['d2d4'] })
    const after = position(game.fens[1], cp(0), ['e7e5'])
    expect(classifyMoves({ moves: game.moves, positions: [before, after], bookPlies: 0, thresholds: CHESSCOM_THRESHOLDS })[0]?.moveClass).toBe('great')
  })

  it('жертва материала при сохранении оценки — «Блестящий»', () => {
    const game = parsePgn('[SetUp "1"]\n[FEN "k7/8/8/8/8/8/1r6/R3K3 w - - 0 1"]\n\n1. Ra2')
    const before = position(game.fens[0], cp(100), ['a1a2'])
    const after = position(game.fens[1], cp(100), ['b2a2', 'e1d1'])
    const result = classifyMoves({ moves: game.moves, positions: [before, after], bookPlies: 0, thresholds: CHESSCOM_THRESHOLDS })[0]
    expect(result?.sacrifice).toBe(true)
    expect(result?.moveClass).toBe('brilliant')
  })

  it('неиспользованная ошибка соперника — «Пропуск», в строгом профиле — «Зевок»', () => {
    const game = parsePgn('1. e4 e5 2. Nf3')
    const positions = [
      position(game.fens[0], cp(0), ['e2e4']),
      position(game.fens[1], cp(0), ['c7c5']),
      position(game.fens[2], cp(500), ['d1h5']),
      position(game.fens[3], cp(0), ['b8c6'])
    ]
    const chesscom = classifyMoves({ moves: game.moves, positions, bookPlies: 0, thresholds: CHESSCOM_THRESHOLDS })
    expect(chesscom[1]?.moveClass).toBe('blunder')
    expect(chesscom[2]?.moveClass).toBe('miss')
    const strict = classifyMoves({ moves: game.moves, positions, bookPlies: 0, thresholds: STRICT_THRESHOLDS })
    expect(strict[2]?.moveClass).toBe('blunder')
  })

  it('без анализа позиции ход не классифицируется', () => {
    const game = parsePgn('1. e4')
    expect(classifyMoves({ moves: game.moves, positions: [null, null], bookPlies: 0, thresholds: CHESSCOM_THRESHOLDS })[0]).toBeNull()
  })
})
