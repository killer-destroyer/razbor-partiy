export const RATING_TABLE: Array<[number, number]> = [
  [50, 600],
  [60, 900],
  [70, 1200],
  [75, 1400],
  [80, 1600],
  [85, 1850],
  [90, 2100],
  [93, 2300],
  [95, 2500],
  [98, 2800]
]

export const MIN_GAME_RATING = 400
export const MAX_GAME_RATING = 3000
export const PENALTY_PER_EXTRA_BLUNDER = 50

export function ratingFromAccuracy(accuracy: number): number {
  const table = RATING_TABLE
  if (accuracy <= table[0][0]) {
    const [[x0, y0], [x1, y1]] = table
    return y0 + ((accuracy - x0) * (y1 - y0)) / (x1 - x0)
  }
  for (let index = 1; index < table.length; index += 1) {
    const [x1, y1] = table[index]
    if (accuracy <= x1) {
      const [x0, y0] = table[index - 1]
      return y0 + ((accuracy - x0) * (y1 - y0)) / (x1 - x0)
    }
  }
  const [x0, y0] = table[table.length - 2]
  const [x1, y1] = table[table.length - 1]
  return y1 + ((accuracy - x1) * (y1 - y0)) / (x1 - x0)
}

export function estimateGameRating(accuracy: number | null, blunders: number): number | null {
  if (accuracy === null || Number.isNaN(accuracy)) return null
  const base = ratingFromAccuracy(accuracy)
  const penalty = Math.max(0, blunders - 1) * PENALTY_PER_EXTRA_BLUNDER
  const rating = Math.min(MAX_GAME_RATING, Math.max(MIN_GAME_RATING, base - penalty))
  return Math.round(rating / 25) * 25
}
