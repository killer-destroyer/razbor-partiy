import { Chess } from 'chess.js'
import { EngineService, defaultThreads, locateEngine } from '../src/main/engine'
const lines = process.argv.slice(2)
const engine = new EngineService()
await engine.start({ path: locateEngine(process.env.STOCKFISH_PATH ?? null, 'resources'), threads: defaultThreads(), hashMb: 256, poolSize: 1 })
for (const line of lines) {
  const board = new Chess()
  let ok = true
  for (const t of line.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)) { try { board.move(t) } catch { console.log('ILLEGAL', t, 'in', line); ok = false; break } }
  if (!ok) continue
  if (board.isCheckmate()) { console.log('MATE ON BOARD |', line); continue }
  const a = await engine.analyze(board.fen(), { depth: 20, movetimeMs: null, multiPv: 1 }, 'x', 'foreground')
  const s = a.lines[0].score
  console.log(s.type === 'cp' ? (s.cp/100).toFixed(2) : `${s.winner}M${s.moves}`, '|', line, '| pv', a.lines[0].pv.slice(0,6).join(' '))
}
await engine.shutdown()
