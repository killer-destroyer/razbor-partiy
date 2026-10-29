import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { locateEngine } from '../src/main/engine'
import { UciEngine } from '../src/main/uci'
import { pluralRu } from '../src/renderer/analysis/notation'
import type { Color, EngineLine, Score } from '../src/shared/types'
import type { CompositionRecord } from '../src/renderer/puzzles/catalog'

interface SourceItem {
  id: string
  title: string
  source: string
  kind: 'combination' | 'trap' | 'study'
  goal: 'mate' | 'win' | 'draw'
  pgn?: string
  fen?: string
  key: string
  line?: string[]
  solverMoves?: number
}

const depth = Number(process.argv.find((arg) => arg.startsWith('--depth='))?.split('=')[1] ?? 24)
const items = JSON.parse(readFileSync(resolve('resources/puzzles/compositions.source.json'), 'utf8')) as SourceItem[]
const enginePath = locateEngine(null, resolve('resources'))
if (!enginePath) throw new Error('Stockfish не найден')
const engine = new UciEngine(enginePath)
await engine.start({ threads: 1, hashMb: 256 })

function cpFor(score: Score, side: Color): number {
  if (score.type === 'mate') return score.winner === side ? 100000 - score.moves : -100000 + score.moves
  return side === 'w' ? score.cp : -score.cp
}

function mateFor(line: EngineLine | undefined, side: Color): number | null {
  if (!line || line.score.type !== 'mate' || line.score.winner !== side) return null
  return line.score.moves
}

function sanToUci(board: Chess, san: string): string {
  const move = board.move(san, { strict: false })
  board.undo()
  return move.from + move.to + (move.promotion ?? '')
}

const report: string[] = [`Проверка композиций: ${engine.name ?? 'Stockfish'}, глубина ${depth}`, '']
const output: CompositionRecord[] = []

for (const item of items) {
  const board = new Chess(item.fen)
  if (item.pgn) {
    board.reset()
    for (const san of item.pgn.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)) board.move(san, { strict: false })
  }
  const startFen = board.fen()
  const solver = board.turn() as Color
  const moves: string[] = []
  const problems: string[] = []
  let solverMoves = 0
  let mateIn: number | null = null
  for (let ply = 0; ply < 40; ply += 1) {
    const fen = board.fen()
    const toMove = board.turn() as Color
    const analysis = await engine.search(fen, { depth }, toMove === solver ? 3 : 1)
    const [best, second] = analysis.lines
    if (!best) {
      problems.push(`нет ходов в позиции ${fen}`)
      break
    }
    if (toMove === solver) {
      const expectedSan = item.line?.[solverMoves] ?? (solverMoves === 0 ? item.key : null)
      let expected = best.pv[0]
      if (expectedSan) {
        try {
          expected = sanToUci(board, expectedSan)
        } catch {
          problems.push(`ход ${solverMoves + 1}: ${expectedSan} невозможен после ответа соперника`)
          break
        }
      }
      if (best.pv[0] !== expected) {
        problems.push(`ход ${solverMoves + 1}: движок предпочитает ${best.pv[0]}, а не ${expected}`)
        break
      }
      if (item.goal === 'mate') {
        const mate = mateFor(best, solver)
        if (mate === null) {
          problems.push(`ход ${solverMoves + 1}: форсированного мата нет`)
          break
        }
        if (mateIn === null) mateIn = mate
        const alt = mateFor(second, solver)
        if (mate > 1 && alt !== null && alt <= mate) {
          problems.push(`ход ${solverMoves + 1}: второе решение ${second.pv[0]} (мат в ${alt})`)
          break
        }
      } else {
        const bestCp = cpFor(best.score, solver)
        const secondCp = second ? cpFor(second.score, solver) : -100000
        if (item.goal === 'win' && (bestCp < 250 || (secondCp > bestCp - 150 && secondCp >= 150))) {
          problems.push(`ход ${solverMoves + 1}: выигрыш не единственный или недостаточный (${bestCp} / ${secondCp})`)
          break
        }
        if (item.goal === 'draw' && (bestCp < -80 || secondCp > -250)) {
          problems.push(`ход ${solverMoves + 1}: ничья не единственным ходом (${bestCp} / ${secondCp})`)
          break
        }
      }
      board.move({ from: expected.slice(0, 2), to: expected.slice(2, 4), promotion: expected[4] })
      moves.push(expected)
      solverMoves += 1
      if (board.isCheckmate()) break
      if (item.goal !== 'mate' && solverMoves >= (item.solverMoves ?? item.line?.length ?? 1)) break
    } else {
      const reply = best.pv[0]
      board.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] })
      moves.push(reply)
    }
    if (board.isGameOver() && !board.isCheckmate()) break
  }
  if (item.goal === 'mate' && !board.isCheckmate()) problems.push('линия не закончилась матом')
  const solverName = solver === 'w' ? 'Белые' : 'Чёрные'
  const goalText =
    item.goal === 'mate'
      ? `${solverName} дают мат в ${mateIn} ${pluralRu(mateIn ?? 0, 'ход', 'хода', 'ходов')}`
      : item.goal === 'win'
        ? `${solverName} начинают и выигрывают`
        : `${solverName} начинают и делают ничью`
  if (problems.length) {
    report.push(`✗ ${item.title} (${item.id}): ${problems.join('; ')}`)
    continue
  }
  const lineSans = (() => {
    const replay = new Chess(startFen)
    return moves.map((uci) => replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san)
  })()
  report.push(`✓ ${item.title} (${item.id}): ${goalText}. ${lineSans.join(' ')}`)
  const rating = item.kind === 'study' ? 2000 : item.goal === 'mate' ? Math.min(2200, 900 + (mateIn ?? 1) * 250) : 1300
  output.push({
    id: `c-${item.id}`,
    title: item.title,
    source: item.source,
    kind: item.kind,
    goal: goalText,
    fen: startFen,
    moves,
    rating,
    themes: ['composition', item.kind, ...(item.goal === 'mate' ? [`mateIn${Math.min(5, mateIn ?? 1)}`] : [])]
  })
}

await engine.quit()
writeFileSync(resolve('resources/puzzles/compositions.json'), JSON.stringify(output, null, 1))
writeFileSync(resolve('docs/compositions-verification.txt'), `${report.join('\n')}\n`)
console.log(report.join('\n'))
console.log(`\nПрошли проверку: ${output.length} из ${items.length}`)
