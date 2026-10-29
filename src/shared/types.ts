export type Color = 'w' | 'b'

export type Score = { type: 'cp'; cp: number } | { type: 'mate'; moves: number; winner: Color }

export interface EngineLine {
  multipv: number
  depth: number
  score: Score
  pv: string[]
}

export interface PositionAnalysis {
  fen: string
  depth: number
  lines: EngineLine[]
  terminal?: 'checkmate' | 'stalemate' | 'draw'
  bestMove?: string
}

export interface AnalysisOptions {
  depth: number
  movetimeMs: number | null
  multiPv: number
}

export interface GameMove {
  ply: number
  san: string
  uci: string
  from: string
  to: string
  color: Color
  piece: string
  captured: string | null
  promotion: string | null
  fenBefore: string
  fenAfter: string
  clockSeconds: number | null
}

export interface ParsedGame {
  headers: Record<string, string>
  startFen: string
  fens: string[]
  moves: GameMove[]
}

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily' | 'classical' | 'unknown'

export interface StoredGame {
  id: string
  source: 'chesscom' | 'pgn' | 'fen' | 'bot'
  url: string | null
  pgn: string
  white: string
  black: string
  whiteElo: number | null
  blackElo: number | null
  result: string
  endTime: number | null
  timeClass: TimeClass
  timeControl: string | null
  userColor: Color | null
  ecoUrl: string | null
  openingName: string | null
  accuracyWhite: number | null
  accuracyBlack: number | null
  ratingWhite: number | null
  ratingBlack: number | null
  analyzedDepth: number | null
  importedAt: number
}

export interface ChesscomGameSummary {
  url: string
  pgn: string
  timeControl: string
  timeClass: TimeClass
  endTime: number
  rated: boolean
  rules: string
  white: { username: string; rating: number; result: string }
  black: { username: string; rating: number; result: string }
  accuracies: { white: number; black: number } | null
  ecoUrl: string | null
}

export interface EngineStatus {
  ready: boolean
  path: string | null
  name: string | null
  threads: number
  hashMb: number
  workers: number
  error: string | null
}

export interface GameAnalysisRequest {
  jobId: string
  gameId: string | null
  fens: string[]
  options: AnalysisOptions
  priority: 'foreground' | 'background'
}

export interface GameAnalysisProgress {
  jobId: string
  index: number
  total: number
  analysis: PositionAnalysis
}

export interface GameAnalysisDone {
  jobId: string
  cancelled: boolean
  error: string | null
}

export interface LiveAnalysisUpdate {
  sessionId: string
  fen: string
  analysis: PositionAnalysis
}

export interface OpeningRecord {
  id: number
  eco: string
  name: string
  pgn: string
  uci: string[]
  epd: string
}

export interface OpeningIndexPayload {
  openings: OpeningRecord[]
  positions: Array<[string, number[]]>
}

export interface TrainerCard {
  id: string
  kind: 'opening' | 'mistake'
  payload: string
  theme: string | null
  easiness: number
  intervalDays: number
  repetitions: number
  dueAt: number
  lapses: number
  createdAt: number
}

export interface RepertoireEntry {
  openingId: number
  color: Color
  addedAt: number
}

export interface CoachRequest {
  model: string
  payload: string
}

export interface CoachResponse {
  text: string
  inputTokens: number
  outputTokens: number
  error: string | null
}

export interface NewGameNotice {
  gameId: string
  opponent: string
  accuracy: number | null
}
