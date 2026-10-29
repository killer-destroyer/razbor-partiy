import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { EngineService, defaultThreads, locateEngine } from '../src/main/engine'
import { parseOpeningsTsv } from '../src/renderer/openings/book'
import type { OpeningGuide, GuideTrap } from '../src/renderer/openings/guides'
import { guideScore } from '../src/renderer/openings/guides'
import { winPercentFor } from '../src/renderer/analysis/winprob'
import type { Color, Score } from '../src/shared/types'

interface TrapClaim {
  type: 'checkmate' | 'mate' | 'eval'
  min?: number
}

type VerifiableTrap = GuideTrap & { claim?: TrapClaim }

const depth = Math.max(20, Number(process.argv.find((arg) => arg.startsWith('--depth='))?.split('=')[1] ?? 20))
const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1] ?? null
const guidesPath = resolve('resources/openings/guides.json')
const guides = JSON.parse(readFileSync(guidesPath, 'utf8')) as OpeningGuide[]
const openings = ['a', 'b', 'c', 'd', 'e'].flatMap((letter) => parseOpeningsTsv(readFileSync(resolve(`resources/openings/${letter}.tsv`), 'utf8')))

export function inferClaim(trap: GuideTrap): TrapClaim {
  const text = trap.explanation.toLowerCase()
  if (/\bмат\b|матует|ставит мат|заматует|матом/.test(text)) return { type: 'mate' }
  if (/ферз/.test(text) && /(выигр|теря|забира|ловит|отда)/.test(text)) return { type: 'eval', min: 500 }
  if (/(ладь|качеств)/.test(text) && /(выигр|теря|забира|ловит)/.test(text)) return { type: 'eval', min: 180 }
  if (/(фигур|коня|слона|конь|слон)/.test(text) && /(выигр|теря|забира|ловит|остаётся без)/.test(text)) return { type: 'eval', min: 180 }
  if (/пешк/.test(text) && /(выигр|теря|забира)/.test(text)) return { type: 'eval', min: 60 }
  return { type: 'eval', min: 80 }
}

function scoreText(score: Score | undefined): string {
  if (!score) return '?'
  if (score.type === 'mate') return `${score.winner === 'w' ? '+' : '-'}M${score.moves}`
  return (score.cp / 100).toFixed(2)
}

function cpFor(score: Score, side: Color): number {
  if (score.type === 'mate') return score.winner === side ? 100000 : -100000
  return side === 'w' ? score.cp : -score.cp
}

const errors: string[] = []
const warnings: string[] = []

for (const guide of guides) {
  const required: Array<keyof OpeningGuide> = ['family', 'idea', 'pros', 'cons', 'plansWhite', 'plansBlack', 'pawnStructure', 'traps', 'nuances', 'typicalMistakes']
  for (const field of required) if (guide[field] === undefined) errors.push(`${guide.family}: нет поля ${field}`)
  const matched = openings.filter((opening) => guideScore(guide, opening) > 0)
  if (!matched.length) errors.push(`${guide.family}: не совпадает ни с одним дебютом базы (match ${JSON.stringify(guide.match)})`)
  for (const prefix of guide.match.namePrefix ?? []) {
    if (!openings.some((opening) => opening.name.startsWith(prefix))) errors.push(`${guide.family}: префикс «${prefix}» не найден в базе`)
  }
}

const enginePath = locateEngine(process.env.STOCKFISH_PATH ?? null, resolve('resources'))
const engine = new EngineService()
const status = await engine.start({ path: enginePath, threads: defaultThreads(), hashMb: 256, poolSize: 1 })
if (!status.ready) {
  console.error(status.error)
  process.exit(2)
}
console.log(`${status.name}, глубина ${depth}, гайдов: ${guides.length}`)

let checked = 0
for (const guide of guides) {
  if (only && !guide.family.includes(only)) continue
  for (const trap of guide.traps as VerifiableTrap[]) {
    const board = new Chess()
    const tokens = trap.line.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)
    let legal = true
    for (const token of tokens) {
      try {
        board.move(token)
      } catch {
        errors.push(`${guide.family} / ${trap.name}: нелегальный ход «${token}» в линии ${trap.line}`)
        legal = false
        break
      }
    }
    if (!legal) continue
    const claim = trap.claim ?? inferClaim(trap)
    const label = `${guide.family} / ${trap.name}`
    checked += 1
    if (board.isCheckmate()) {
      const winner: Color = board.turn() === 'w' ? 'b' : 'w'
      if (winner !== trap.forSide) errors.push(`${label}: мат ставит не та сторона`)
      else console.log(`  ✓ ${label}: мат на доске`)
      continue
    }
    if (claim.type === 'checkmate') {
      errors.push(`${label}: заявлен мат на доске, но позиция не матовая`)
      continue
    }
    const analysis = await engine.analyze(board.fen(), { depth, movetimeMs: null, multiPv: 1 }, `verify:${label}`, 'foreground')
    const score = analysis.lines[0]?.score
    if (!score) {
      errors.push(`${label}: движок не дал оценку`)
      continue
    }
    const value = cpFor(score, trap.forSide)
    const ok = claim.type === 'mate' ? score.type === 'mate' && score.winner === trap.forSide : value >= (claim.min ?? 80)
    const line = `${label}: оценка ${scoreText(score)} (глубина ${analysis.depth}), шанс ${winPercentFor(score, trap.forSide).toFixed(0)}% для ${trap.forSide === 'w' ? 'белых' : 'чёрных'}, требование ${claim.type === 'mate' ? 'мат' : `≥ ${claim.min ?? 80}`}`
    if (ok) console.log(`  ✓ ${line}`)
    else errors.push(`${line} — НЕ ПОДТВЕРЖДЕНО`)
  }
}

await engine.shutdown()
for (const warning of warnings) console.warn(`! ${warning}`)
if (errors.length) {
  console.error(`\nОшибки (${errors.length}):`)
  for (const error of errors) console.error(`  ✗ ${error}`)
  process.exit(1)
}
console.log(`\nВсе проверки пройдены: гайдов ${guides.length}, ловушек проверено ${checked}.`)
