import { describe, expect, it } from 'vitest'
import { moveLoss, scoreFromUci, winPercent, winPercentFromCp } from '@renderer/analysis/winprob'
import { combinedAccuracy, harmonicMean, moveAccuracy, volatilityWeights } from '@renderer/analysis/accuracy'
import { estimateGameRating, ratingFromAccuracy } from '@renderer/analysis/rating'

describe('шанс на победу', () => {
  it('равная позиция — 50%', () => {
    expect(winPercentFromCp(0)).toBeCloseTo(50, 6)
  })

  it('симметричен для белых и чёрных', () => {
    expect(winPercentFromCp(300) + winPercentFromCp(-300)).toBeCloseTo(100, 6)
  })

  it('обрезает оценку до ±1000', () => {
    expect(winPercentFromCp(5000)).toBeCloseTo(winPercentFromCp(1000), 6)
    expect(winPercentFromCp(1000)).toBeCloseTo(50 + 50 * (2 / (1 + Math.exp(-3.68208)) - 1), 6)
  })

  it('мат даёт 100 или 0', () => {
    expect(winPercent({ type: 'mate', moves: 3, winner: 'w' })).toBe(100)
    expect(winPercent({ type: 'mate', moves: 1, winner: 'b' })).toBe(0)
  })

  it('переводит оценку UCI на сторону белых', () => {
    expect(scoreFromUci('cp', 120, 'b')).toEqual({ type: 'cp', cp: -120 })
    expect(scoreFromUci('mate', 2, 'b')).toEqual({ type: 'mate', moves: 2, winner: 'b' })
    expect(scoreFromUci('mate', -2, 'b')).toEqual({ type: 'mate', moves: 2, winner: 'w' })
  })

  it('потеря хода считается со стороны ходившего', () => {
    expect(moveLoss(60, 40, 'w')).toBe(20)
    expect(moveLoss(60, 40, 'b')).toBe(0)
    expect(moveLoss(40, 60, 'b')).toBe(20)
  })
})

describe('точность', () => {
  it('ход без потерь — около 100%', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0)
  })

  it('убывает с ростом потерь и не уходит ниже нуля', () => {
    expect(moveAccuracy(10)).toBeLessThan(moveAccuracy(5))
    expect(moveAccuracy(100)).toBe(0)
  })

  it('гармоническое среднее наказывает за редкие провалы', () => {
    expect(harmonicMean([100, 100, 10])!).toBeLessThan((100 + 100 + 10) / 3)
  })

  it('веса волатильности ограничены 0.5…12', () => {
    const weights = volatilityWeights([50, 50, 50, 90, 10, 90, 10, 50, 50, 50, 50])
    expect(weights).toHaveLength(10)
    for (const weight of weights) {
      expect(weight).toBeGreaterThanOrEqual(0.5)
      expect(weight).toBeLessThanOrEqual(12)
    }
  })

  it('точность партии — среднее взвешенного и гармонического', () => {
    const moves = [0, 1, 2].map((index) => ({ index, color: 'w' as const, accuracy: 80 }))
    expect(combinedAccuracy(moves, [1, 1, 1])).toBeCloseTo(80, 6)
  })
})

describe('рейтинг игры', () => {
  it('интерполирует по таблице', () => {
    expect(ratingFromAccuracy(80)).toBe(1600)
    expect(ratingFromAccuracy(87.5)).toBeCloseTo(1975, 6)
    expect(ratingFromAccuracy(98)).toBe(2800)
  })

  it('снимает 50 за каждый зевок сверх первого и не опускается ниже 400', () => {
    expect(estimateGameRating(80, 1)).toBe(1600)
    expect(estimateGameRating(80, 3)).toBe(1500)
    expect(estimateGameRating(20, 10)).toBe(400)
  })
})
