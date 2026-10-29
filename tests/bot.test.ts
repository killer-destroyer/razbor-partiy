import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { BOT_LEVELS, botLevel, formatClock, randomLegalMove } from '../src/renderer/play/levels'

describe('уровни ботов', () => {
  it('20 уровней с растущей силой', () => {
    expect(BOT_LEVELS).toHaveLength(20)
    for (let index = 1; index < BOT_LEVELS.length; index += 1) {
      expect(BOT_LEVELS[index].elo).toBeGreaterThan(BOT_LEVELS[index - 1].elo)
      expect(BOT_LEVELS[index].skill).toBeGreaterThanOrEqual(BOT_LEVELS[index - 1].skill)
      expect(BOT_LEVELS[index].randomChance).toBeLessThanOrEqual(BOT_LEVELS[index - 1].randomChance)
    }
    expect(BOT_LEVELS[19].skill).toBe(20)
    expect(botLevel(99).level).toBe(20)
    expect(botLevel(0).level).toBe(1)
  })

  it('случайный ход всегда легален', () => {
    const board = new Chess()
    for (let ply = 0; ply < 60 && !board.isGameOver(); ply += 1) {
      const uci = randomLegalMove(board.fen())!
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    }
    expect(randomLegalMove('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBeNull()
  })

  it('часы показывают минуты и секунды', () => {
    expect(formatClock(300000)).toBe('5:00')
    expect(formatClock(61500)).toBe('1:02')
    expect(formatClock(-5)).toBe('0:00')
  })
})
