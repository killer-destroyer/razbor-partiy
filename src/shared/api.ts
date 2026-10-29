import type {
  AnalysisOptions,
  ChesscomGameSummary,
  CoachRequest,
  CoachResponse,
  EngineStatus,
  GameAnalysisDone,
  GameAnalysisProgress,
  GameAnalysisRequest,
  LiveAnalysisUpdate,
  NewGameNotice,
  OpeningIndexPayload,
  PositionAnalysis,
  RepertoireEntry,
  StoredGame,
  TrainerCard
} from './types'
import type { Settings } from './settings'
import type { PuzzleCategory, PuzzleDifficulty, PuzzleRecord } from '../renderer/puzzles/catalog'

export type Unsubscribe = () => void

export interface EngineApi {
  status(): Promise<EngineStatus>
  restart(): Promise<EngineStatus>
  analyzeGame(request: GameAnalysisRequest): Promise<void>
  cancelGame(jobId: string): Promise<void>
  analyzePosition(fen: string, options: AnalysisOptions): Promise<PositionAnalysis>
  startLive(sessionId: string, fen: string, multiPv: number): Promise<void>
  stopLive(sessionId: string): Promise<void>
  onProgress(listener: (progress: GameAnalysisProgress) => void): Unsubscribe
  onDone(listener: (done: GameAnalysisDone) => void): Unsubscribe
  onLive(listener: (update: LiveAnalysisUpdate) => void): Unsubscribe
  queueBackground(gameIds: string[]): Promise<void>
  backgroundState(): Promise<BackgroundState>
  onBackground(listener: (state: BackgroundState) => void): Unsubscribe
}

export interface BackgroundState {
  queued: number
  current: string | null
  currentProgress: number
  lastFinished: { gameId: string; accuracy: number | null; error: string | null } | null
}

export interface ChesscomApi {
  recentGames(username: string, limit: number): Promise<ChesscomGameSummary[]>
  findGameByUrl(url: string): Promise<ChesscomGameSummary | null>
  setWatching(enabled: boolean, username: string): Promise<void>
  onNewGame(listener: (notice: NewGameNotice) => void): Unsubscribe
  onWatchStatus(listener: (status: string) => void): Unsubscribe
}

export interface StatsRow {
  id: string
  endTime: number | null
  importedAt: number
  timeClass: string
  userColor: 'w' | 'b' | null
  result: string
  white: string
  black: string
  openingName: string | null
  accuracy: number | null
  firstSeriousMistakeMove: number | null
  movesJson: string | null
}

export interface DbApi {
  listGames(limit: number): Promise<StoredGame[]>
  getGame(id: string): Promise<StoredGame | null>
  saveGame(game: StoredGame): Promise<void>
  deleteGame(id: string): Promise<void>
  getAnalysis(gameId: string): Promise<{ depth: number; positions: PositionAnalysis[]; reviewJson: string | null } | null>
  saveAnalysis(gameId: string, depth: number, positions: PositionAnalysis[], reviewJson: string | null): Promise<void>
  cachedPositions(fens: string[], minDepth: number, multiPv: number): Promise<Array<PositionAnalysis | null>>
  openingIndex(): Promise<OpeningIndexPayload>
  listCards(kind: TrainerCard['kind'] | null): Promise<TrainerCard[]>
  upsertCard(card: TrainerCard): Promise<void>
  deleteCard(id: string): Promise<void>
  listRepertoire(): Promise<RepertoireEntry[]>
  setRepertoire(openingId: number, color: 'w' | 'b' | null): Promise<void>
  statsRows(): Promise<StatsRow[]>
}

export interface SettingsApi {
  get(): Promise<Settings>
  set(patch: Partial<Settings>): Promise<Settings>
  onChange(listener: (settings: Settings) => void): Unsubscribe
}

export interface CoachApi {
  hasKey(): Promise<boolean>
  setKey(key: string): Promise<boolean>
  clearKey(): Promise<void>
  review(request: CoachRequest): Promise<CoachResponse>
}

export interface MenuMessage {
  command: string
  payload?: string
}

export interface AppApi {
  version(): Promise<{ app: string; electron: string; chrome: string; node: string }>
  saveFile(defaultName: string, content: string, kind: 'pgn' | 'png'): Promise<string | null>
  readGuides(): Promise<string>
  getValue<T>(key: string): Promise<T | null>
  setValue(key: string, value: unknown): Promise<void>
  onOpenGame(listener: (gameId: string) => void): Unsubscribe
  onMenu(listener: (message: MenuMessage) => void): Unsubscribe
}

export interface PuzzleCategoryInfo extends PuzzleCategory {
  total: number
  solved: number
}

export interface PuzzleStats {
  rating: number
  games: number
  solved: number
  failed: number
  streak: number
  bestStreak: number
}

export interface PuzzleCatalog {
  categories: PuzzleCategoryInfo[]
  stats: PuzzleStats
}

export interface PuzzleResult {
  stats: PuzzleStats
  ratingChange: number
}

export interface PuzzlesApi {
  catalog(): Promise<PuzzleCatalog>
  next(categoryId: string, difficulty: PuzzleDifficulty, excludeId: string | null): Promise<PuzzleRecord | null>
  record(id: string, solved: boolean): Promise<PuzzleResult>
}

export interface BotApi {
  move(fen: string, level: number): Promise<string | null>
  newGame(): Promise<void>
}

export interface WindowApi {
  engine: EngineApi
  chesscom: ChesscomApi
  db: DbApi
  settings: SettingsApi
  coach: CoachApi
  app: AppApi
  puzzles: PuzzlesApi
  bot: BotApi
}

export const IPC = {
  engineStatus: 'engine:status',
  engineRestart: 'engine:restart',
  engineAnalyzeGame: 'engine:analyze-game',
  engineCancelGame: 'engine:cancel-game',
  engineAnalyzePosition: 'engine:analyze-position',
  engineStartLive: 'engine:start-live',
  engineStopLive: 'engine:stop-live',
  engineProgress: 'engine:progress',
  engineDone: 'engine:done',
  engineLive: 'engine:live',
  engineQueueBackground: 'engine:queue-background',
  engineBackgroundState: 'engine:background-state',
  engineBackground: 'engine:background',
  chesscomRecent: 'chesscom:recent',
  chesscomFind: 'chesscom:find',
  chesscomWatch: 'chesscom:watch',
  chesscomNewGame: 'chesscom:new-game',
  chesscomWatchStatus: 'chesscom:watch-status',
  dbListGames: 'db:list-games',
  dbGetGame: 'db:get-game',
  dbSaveGame: 'db:save-game',
  dbDeleteGame: 'db:delete-game',
  dbGetAnalysis: 'db:get-analysis',
  dbSaveAnalysis: 'db:save-analysis',
  dbCachedPositions: 'db:cached-positions',
  dbOpeningIndex: 'db:opening-index',
  dbListCards: 'db:list-cards',
  dbUpsertCard: 'db:upsert-card',
  dbDeleteCard: 'db:delete-card',
  dbListRepertoire: 'db:list-repertoire',
  dbSetRepertoire: 'db:set-repertoire',
  dbStatsRows: 'db:stats-rows',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  coachHasKey: 'coach:has-key',
  coachSetKey: 'coach:set-key',
  coachClearKey: 'coach:clear-key',
  coachReview: 'coach:review',
  appVersion: 'app:version',
  appSaveFile: 'app:save-file',
  appReadGuides: 'app:read-guides',
  appGetValue: 'app:get-value',
  appSetValue: 'app:set-value',
  appOpenGame: 'app:open-game',
  appMenu: 'app:menu',
  puzzlesCatalog: 'puzzles:catalog',
  puzzlesNext: 'puzzles:next',
  puzzlesRecord: 'puzzles:record',
  botMove: 'bot:move',
  botNewGame: 'bot:new-game'
} as const
