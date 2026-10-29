export type CoordinatesMode = 'none' | 'inside' | 'outside'
export type AnimationSpeed = 'none' | 'slow' | 'normal' | 'fast'
export type MoveInput = 'drag' | 'click' | 'both'
export type ClassificationProfile = 'chesscom' | 'strict'
export type ThemeMode = 'system' | 'light' | 'dark'
export type NotationMode = 'ru' | 'en' | 'icons'
export type AnalysisLimit = 'depth' | 'time'

export interface ArrowColors {
  plain: string
  shift: string
  alt: string
  ctrl: string
}

export interface Settings {
  boardTheme: string
  pieceSet: string
  coordinates: CoordinatesMode
  highlightLastMove: boolean
  showLegalMoves: boolean
  showThreats: boolean
  boardSize: number
  animation: AnimationSpeed
  moveInput: MoveInput
  autoQueen: boolean
  arrowColors: ArrowColors
  showBestMoveArrow: boolean
  showEvalBar: boolean
  soundEnabled: boolean
  soundVolume: number
  soundMove: boolean
  soundCapture: boolean
  soundCheck: boolean
  soundCastle: boolean
  soundPromote: boolean
  soundGameEnd: boolean
  analysisLimit: AnalysisLimit
  analysisDepth: number
  analysisMovetimeMs: number
  multiPv: number
  engineThreads: number
  engineHashMb: number
  enginePath: string
  classificationProfile: ClassificationProfile
  autoAnalyzeOnImport: boolean
  themeMode: ThemeMode
  notation: NotationMode
  chesscomUsername: string
  watchNewGames: boolean
  coachEnabled: boolean
  coachModel: string
  settingsVersion: number
}

export const ANIMATION_DURATIONS: Record<AnimationSpeed, number> = {
  none: 0,
  slow: 300,
  normal: 200,
  fast: 120
}

export const DEFAULT_SETTINGS: Settings = {
  boardTheme: 'gray',
  pieceSet: 'cburnett',
  coordinates: 'outside',
  highlightLastMove: true,
  showLegalMoves: true,
  showThreats: false,
  boardSize: 640,
  animation: 'normal',
  moveInput: 'both',
  autoQueen: false,
  arrowColors: { plain: '#f0a33a', shift: '#76b84a', alt: '#4a90d9', ctrl: '#e0503a' },
  showBestMoveArrow: true,
  showEvalBar: true,
  soundEnabled: true,
  soundVolume: 0.6,
  soundMove: true,
  soundCapture: true,
  soundCheck: true,
  soundCastle: true,
  soundPromote: true,
  soundGameEnd: true,
  analysisLimit: 'depth',
  analysisDepth: 16,
  analysisMovetimeMs: 1000,
  multiPv: 3,
  engineThreads: 0,
  engineHashMb: 512,
  enginePath: '',
  classificationProfile: 'chesscom',
  autoAnalyzeOnImport: false,
  themeMode: 'dark',
  notation: 'ru',
  chesscomUsername: 'Arsenkryt',
  watchNewGames: false,
  coachEnabled: false,
  coachModel: 'claude-sonnet-5-5',
  settingsVersion: 2
}

export const REVIEW_MULTIPV = 2

export const DEPTH_PRESETS = [
  { depth: 14, label: 'Быстро' },
  { depth: 16, label: 'Обычно' },
  { depth: 20, label: 'Точно' }
] as const

export function mergeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  merged.arrowColors = { ...DEFAULT_SETTINGS.arrowColors, ...(stored?.arrowColors ?? {}) }
  if (!stored?.settingsVersion || stored.settingsVersion < 2) {
    if (merged.analysisDepth === 18) merged.analysisDepth = DEFAULT_SETTINGS.analysisDepth
    if (merged.engineHashMb === 256) merged.engineHashMb = DEFAULT_SETTINGS.engineHashMb
    merged.settingsVersion = DEFAULT_SETTINGS.settingsVersion
  }
  return merged
}
