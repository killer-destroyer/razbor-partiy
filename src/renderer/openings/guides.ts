import type { OpeningRecord } from '@shared/types'

export interface GuideTrap {
  name: string
  forSide: 'w' | 'b'
  line: string
  explanation: string
}

export interface OpeningGuide {
  family: string
  match: { eco?: string[]; namePrefix?: string[] }
  idea: string
  pros: string[]
  cons: string[]
  plansWhite: string[]
  plansBlack: string[]
  pawnStructure: string
  traps: GuideTrap[]
  nuances: string[]
  typicalMistakes: string[]
}

export function parseGuides(json: string): OpeningGuide[] {
  try {
    const data = JSON.parse(json) as OpeningGuide[] | { guides: OpeningGuide[] }
    return Array.isArray(data) ? data : data.guides ?? []
  } catch {
    return []
  }
}

function ecoInRange(eco: string, range: string): boolean {
  const [start, end] = range.split('-')
  if (!end) return eco === start
  return eco >= start && eco <= end
}

export function guideScore(guide: OpeningGuide, opening: Pick<OpeningRecord, 'eco' | 'name'>): number {
  const prefixes = guide.match.namePrefix ?? []
  const prefixHit = prefixes
    .filter((prefix) => opening.name === prefix || opening.name.startsWith(`${prefix}:`) || opening.name.startsWith(`${prefix},`) || opening.name.startsWith(prefix))
    .reduce((best, prefix) => Math.max(best, prefix.length), 0)
  if (prefixes.length && !prefixHit) return 0
  const ecoRanges = guide.match.eco ?? []
  const ecoHit = ecoRanges.some((range) => ecoInRange(opening.eco, range))
  if (!prefixes.length && !ecoHit) return 0
  return prefixHit * 10 + (ecoHit ? 5 : 0)
}

export function guideFor(guides: OpeningGuide[], opening: Pick<OpeningRecord, 'eco' | 'name'>): OpeningGuide | null {
  let best: OpeningGuide | null = null
  let bestScore = 0
  for (const guide of guides) {
    const score = guideScore(guide, opening)
    if (score > bestScore) {
      best = guide
      bestScore = score
    }
  }
  return best
}
