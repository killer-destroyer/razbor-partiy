import type { Color } from '@shared/types'
import { clamp } from './winprob'

export function moveAccuracy(loss: number): number {
  return clamp(103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669, 0, 100)
}

export function standardDeviation(values: number[]): number {
  if (!values.length) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function harmonicMean(values: number[]): number | null {
  if (!values.length) return null
  const floor = values.map((value) => Math.max(value, 1))
  return floor.length / floor.reduce((sum, value) => sum + 1 / value, 0)
}

export function weightedMean(pairs: Array<[number, number]>): number | null {
  const totalWeight = pairs.reduce((sum, [, weight]) => sum + weight, 0)
  if (!pairs.length || totalWeight <= 0) return null
  return pairs.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight
}

export function volatilityWeights(winPercents: number[]): number[] {
  const moveCount = Math.max(0, winPercents.length - 1)
  const windowSize = clamp(Math.floor(moveCount / 10), 2, 8)
  if (winPercents.length < 2) return []
  const windows: number[][] = []
  const firstWindow = winPercents.slice(0, windowSize)
  const padding = Math.max(0, Math.min(windowSize, winPercents.length) - 2)
  for (let index = 0; index < padding; index += 1) windows.push(firstWindow)
  for (let start = 0; start + windowSize <= winPercents.length; start += 1) {
    windows.push(winPercents.slice(start, start + windowSize))
  }
  if (windowSize > winPercents.length) windows.push(winPercents)
  return windows.slice(0, moveCount).map((window) => clamp(standardDeviation(window), 0.5, 12))
}

export interface AccuracyMove {
  index: number
  color: Color
  accuracy: number
}

export function combinedAccuracy(moves: AccuracyMove[], weights: number[]): number | null {
  if (!moves.length) return null
  const weighted = weightedMean(moves.map((move) => [move.accuracy, weights[move.index] ?? 1]))
  const harmonic = harmonicMean(moves.map((move) => move.accuracy))
  if (weighted === null || harmonic === null) return null
  return (weighted + harmonic) / 2
}

export function gameAccuracy(winPercents: number[], moves: AccuracyMove[], color: Color): number | null {
  const weights = volatilityWeights(winPercents)
  return combinedAccuracy(
    moves.filter((move) => move.color === color),
    weights
  )
}
