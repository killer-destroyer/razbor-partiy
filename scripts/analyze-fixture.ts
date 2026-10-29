import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EngineService, defaultThreads, locateEngine } from '../src/main/engine'
import { analyzeFens } from '../src/main/analyzer'
import { parsePgn } from '../src/renderer/analysis/pgn'
import { APPENDIX_B_PGN } from '../tests/fixtures/appendix-b-pgn'

const depth = Number(process.argv[2] ?? 20)
const output = resolve(process.argv[3] ?? 'tests/fixtures/appendix-b-analysis.json')

const enginePath = locateEngine(null, resolve('resources'))
const service = new EngineService()
const status = await service.start({ path: enginePath, threads: defaultThreads(), hashMb: 256, poolSize: 1 })
if (!status.ready) {
  console.error(status.error)
  process.exit(1)
}
const game = parsePgn(APPENDIX_B_PGN)
const started = Date.now()
const positions = await analyzeFens(service, null, game.fens, { depth, movetimeMs: null, multiPv: 3 }, 'fixture', 'foreground', (index) => {
  process.stdout.write(`\r${index + 1}/${game.fens.length}`)
})
await service.shutdown()
writeFileSync(output, JSON.stringify({ engine: status.name, depth, positions }, null, 0))
console.log(`\n${status.name}: ${positions.length} позиций за ${Math.round((Date.now() - started) / 1000)} с → ${output}`)
