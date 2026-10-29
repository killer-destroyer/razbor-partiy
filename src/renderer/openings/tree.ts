import type { OpeningRecord } from '@shared/types'
import { normalizeMoveToken } from '../analysis/notation'
import { sansFromOpeningPgn } from './book'
import { splitOpeningName, translateFamily, translateOpeningName } from './translate'

export interface TreeNode {
  key: string
  label: string
  englishName: string
  ecoRange: string
  openings: OpeningRecord[]
  children: TreeNode[]
}

export type OpeningCategory = 'main' | 'starts' | 'rare'

export const OPENING_CATEGORY_LABELS: Record<OpeningCategory, string> = {
  main: 'Дебюты',
  starts: 'Начала',
  rare: 'Редкие'
}

export const OPENING_CATEGORY_HINTS: Record<OpeningCategory, string> = {
  main: 'Полноценные дебюты с теорией: у каждого есть основная линия из нескольких ходов.',
  starts: 'Начала — системы, которые определяются первым ходом белых (1.c4, 1.f4, 1.b3, 1.e4/1.d4 без продолжения и т. п.).',
  rare: 'Редкие и шуточные ответы, у которых в базе одна-две линии.'
}

function familyKey(name: string): string {
  return splitOpeningName(name).family.split(',')[0].trim()
}

export function categorizeFamilies(openings: OpeningRecord[]): Map<string, OpeningCategory> {
  const keys = new Set(openings.map((opening) => familyKey(opening.name)))
  const sorted = [...keys].sort((a, b) => a.length - b.length)
  const rootOf = new Map<string, string>()
  for (const key of sorted) rootOf.set(key, sorted.find((candidate) => candidate !== key && key.startsWith(`${candidate} `)) ?? key)
  const stats = new Map<string, { minPlies: number; count: number }>()
  for (const opening of openings) {
    const root = rootOf.get(familyKey(opening.name))!
    const entry = stats.get(root) ?? { minPlies: Infinity, count: 0 }
    entry.minPlies = Math.min(entry.minPlies, opening.uci.length)
    entry.count += 1
    stats.set(root, entry)
  }
  const result = new Map<string, OpeningCategory>()
  for (const key of keys) {
    const entry = stats.get(rootOf.get(key)!)!
    result.set(key, entry.minPlies <= 1 ? 'starts' : entry.count <= 2 ? 'rare' : 'main')
  }
  return result
}

export function openingCategory(categories: Map<string, OpeningCategory>, opening: OpeningRecord): OpeningCategory {
  return categories.get(familyKey(opening.name)) ?? 'main'
}

function ecoRange(openings: OpeningRecord[]): string {
  const codes = openings.map((opening) => opening.eco).sort()
  if (!codes.length) return ''
  return codes[0] === codes[codes.length - 1] ? codes[0] : `${codes[0]}–${codes[codes.length - 1]}`
}

function allOpenings(node: TreeNode): OpeningRecord[] {
  return [...node.openings, ...node.children.flatMap(allOpenings)]
}

export function buildOpeningTree(openings: OpeningRecord[]): TreeNode[] {
  const families = new Map<string, TreeNode>()
  for (const opening of openings) {
    const split = splitOpeningName(opening.name)
    const comma = split.family.indexOf(',')
    const family = comma === -1 ? split.family : split.family.slice(0, comma).trim()
    const variations = comma === -1 ? split.variations : [split.family.slice(comma + 1).trim(), ...split.variations]
    let familyNode = families.get(family)
    if (!familyNode) {
      familyNode = { key: family, label: translateFamily(family), englishName: family, ecoRange: '', openings: [], children: [] }
      families.set(family, familyNode)
    }
    if (!variations.length) {
      familyNode.openings.push(opening)
      continue
    }
    const variationName = `${family}: ${variations[0]}`
    let variationNode = familyNode.children.find((child) => child.key === variationName)
    if (!variationNode) {
      variationNode = { key: variationName, label: translateOpeningName(variationName).split(': ').slice(1).join(': '), englishName: variations[0], ecoRange: '', openings: [], children: [] }
      familyNode.children.push(variationNode)
    }
    if (variations.length === 1) {
      variationNode.openings.push(opening)
      continue
    }
    let subNode = variationNode.children.find((child) => child.key === opening.name)
    if (!subNode) {
      const translated = translateOpeningName(opening.name)
      subNode = {
        key: opening.name,
        label: translated.split(', ').slice(1).join(', ') || translated,
        englishName: variations.slice(1).join(', '),
        ecoRange: '',
        openings: [],
        children: []
      }
      variationNode.children.push(subNode)
    }
    subNode.openings.push(opening)
  }
  const finalize = (node: TreeNode): TreeNode => {
    node.children.forEach(finalize)
    node.children.sort((a, b) => (allOpenings(a)[0]?.uci.length ?? 0) - (allOpenings(b)[0]?.uci.length ?? 0) || a.label.localeCompare(b.label, 'ru'))
    node.openings.sort((a, b) => a.uci.length - b.uci.length)
    node.ecoRange = ecoRange(allOpenings(node))
    return node
  }
  return [...families.values()].map(finalize).sort((a, b) => a.ecoRange.localeCompare(b.ecoRange) || a.label.localeCompare(b.label, 'ru'))
}

const MOVE_TOKEN = /^([KQRBNКФЛСКр]?[a-hа-е]?[1-8]?[xх:]?[a-h][1-8](=?[QRBNФЛСК])?|[O0О]-[O0О](-[O0О])?)[+#]?$/

export function looksLikeMoves(query: string): boolean {
  const tokens = query
    .replace(/\d+\.+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => MOVE_TOKEN.test(token))
}

export function searchOpenings(openings: OpeningRecord[], query: string, limit = 200): OpeningRecord[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  if (/^[A-Ea-e]\d{0,2}$/.test(trimmed)) {
    const prefix = trimmed.toUpperCase()
    return openings.filter((opening) => opening.eco.startsWith(prefix)).slice(0, limit)
  }
  if (looksLikeMoves(trimmed)) {
    const wanted = trimmed
      .replace(/\d+\.+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => normalizeMoveToken(token).replace(/[+#]/g, ''))
    return openings
      .filter((opening) => {
        const sans = sansFromOpeningPgn(opening.pgn).map((san) => san.replace(/[+#]/g, ''))
        return wanted.every((token, index) => sans[index] === token)
      })
      .sort((a, b) => a.uci.length - b.uci.length)
      .slice(0, limit)
  }
  const needle = trimmed.toLowerCase()
  return openings
    .filter((opening) => opening.name.toLowerCase().includes(needle) || translateOpeningName(opening.name).toLowerCase().includes(needle))
    .sort((a, b) => a.uci.length - b.uci.length)
    .slice(0, limit)
}
