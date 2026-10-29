import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { locateEngine } from '../src/main/engine'
import { UciEngine } from '../src/main/uci'
import { COURSE, learnerPlies } from '../src/renderer/course/course'
import type { Color, Score } from '../src/shared/types'

const depth = Math.max(18, Number(process.argv.find((arg) => arg.startsWith('--depth='))?.split('=')[1] ?? 20))
const maxDrop = 100
const enginePath = locateEngine(null, resolve('resources'))
if (!enginePath) throw new Error('Stockfish не найден')
const engine = new UciEngine(enginePath)
await engine.start({ threads: 1, hashMb: 256 })

function cpFor(score: Score | undefined, side: Color): number {
  if (!score) return 0
  if (score.type === 'mate') return score.winner === side ? 10000 - score.moves : -10000 + score.moves
  return side === 'w' ? score.cp : -score.cp
}

const report: string[] = [`Проверка курса дебютов: ${engine.name ?? 'Stockfish'}, глубина ${depth}, допустимая потеря ${maxDrop} сантипешек`, '']
let failures = 0
for (const chapter of COURSE) {
  report.push(`${chapter.title} (${chapter.side === 'w' ? 'белые' : 'чёрные'})`)
  for (const line of chapter.lines) {
    const problems: string[] = []
    for (const ply of learnerPlies(line, chapter.side)) {
      if (line.dubious.includes(ply + 1) || new Chess(line.fens[ply + 1]).isCheckmate()) continue
      const before = await engine.search(line.fens[ply], { depth }, 1)
      const after = await engine.search(line.fens[ply + 1], { depth }, 1)
      const drop = cpFor(before.lines[0]?.score, chapter.side) - cpFor(after.lines[0]?.score, chapter.side)
      if (drop > maxDrop) problems.push(`${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}${line.sans[ply]} теряет ${drop} (лучше ${before.lines[0]?.pv[0]})`)
    }
    const finalFen = line.fens[line.fens.length - 1]
    const mated = new Chess(finalFen).isCheckmate()
    const final = mated ? null : await engine.search(finalFen, { depth }, 1)
    const finalCp = mated ? (new Chess(finalFen).turn() === chapter.side ? -10000 : 10000) : cpFor(final?.lines[0]?.score, chapter.side)
    failures += problems.length
    report.push(`  ${problems.length ? '✗' : '✓'} ${line.name}: итоговая оценка для учащегося ${Math.abs(finalCp) >= 10000 ? (finalCp > 0 ? 'мат в пользу учащегося' : 'мат учащемуся') : (finalCp / 100).toFixed(2)}${problems.length ? ` — ${problems.join('; ')}` : ''}`)
  }
  report.push('')
}
await engine.quit()
writeFileSync(resolve('docs/course-verification.txt'), `${report.join('\n')}\n`)
console.log(report.join('\n'))
if (failures) process.exit(1)
