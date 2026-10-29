import { Chess } from 'chess.js'
import type { AnalysisOptions, Color, PositionAnalysis } from '../shared/types'
import type { EngineService } from './engine'

export interface PositionCache {
  lookup(fens: string[], minDepth: number, multiPv: number): Array<PositionAnalysis | null>
  store(analysis: PositionAnalysis, multiPv: number): void
}

export function terminalAnalysis(fen: string): PositionAnalysis | null {
  let board: Chess
  try {
    board = new Chess(fen)
  } catch {
    return null
  }
  if (board.isCheckmate()) {
    const winner: Color = board.turn() === 'w' ? 'b' : 'w'
    return { fen, depth: 0, terminal: 'checkmate', lines: [{ multipv: 1, depth: 0, score: { type: 'mate', moves: 0, winner }, pv: [] }] }
  }
  if (board.isStalemate()) {
    return { fen, depth: 0, terminal: 'stalemate', lines: [{ multipv: 1, depth: 0, score: { type: 'cp', cp: 0 }, pv: [] }] }
  }
  if (board.isInsufficientMaterial()) {
    return { fen, depth: 0, terminal: 'draw', lines: [{ multipv: 1, depth: 0, score: { type: 'cp', cp: 0 }, pv: [] }] }
  }
  return null
}

export async function analyzeFens(
  engine: EngineService,
  cache: PositionCache | null,
  fens: string[],
  options: AnalysisOptions,
  jobId: string,
  priority: 'foreground' | 'background',
  onPosition: (index: number, analysis: PositionAnalysis) => void
): Promise<PositionAnalysis[]> {
  const results: PositionAnalysis[] = new Array(fens.length)
  const minDepth = options.movetimeMs ? 1 : options.depth
  const cached = cache ? cache.lookup(fens, minDepth, options.multiPv) : fens.map(() => null)
  const pending: Array<Promise<void>> = []
  fens.forEach((fen, index) => {
    const terminal = terminalAnalysis(fen)
    if (terminal) {
      results[index] = terminal
      onPosition(index, terminal)
      return
    }
    const hit = cached[index]
    if (hit) {
      results[index] = hit
      onPosition(index, hit)
      return
    }
    pending.push(
      engine.analyze(fen, options, jobId, priority).then((analysis) => {
        results[index] = analysis
        cache?.store(analysis, options.multiPv)
        onPosition(index, analysis)
      })
    )
  })
  await Promise.all(pending)
  return results
}
