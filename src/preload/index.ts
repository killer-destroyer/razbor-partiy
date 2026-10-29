import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type WindowApi } from '@shared/api'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: WindowApi = {
  bot: {
    move: (fen, level) => ipcRenderer.invoke(IPC.botMove, fen, level),
    newGame: () => ipcRenderer.invoke(IPC.botNewGame)
  },
  puzzles: {
    catalog: () => ipcRenderer.invoke(IPC.puzzlesCatalog),
    next: (categoryId, difficulty, excludeId) => ipcRenderer.invoke(IPC.puzzlesNext, categoryId, difficulty, excludeId),
    record: (id, solved) => ipcRenderer.invoke(IPC.puzzlesRecord, id, solved)
  },
  engine: {
    status: () => ipcRenderer.invoke(IPC.engineStatus),
    restart: () => ipcRenderer.invoke(IPC.engineRestart),
    analyzeGame: (request) => ipcRenderer.invoke(IPC.engineAnalyzeGame, request),
    cancelGame: (jobId) => ipcRenderer.invoke(IPC.engineCancelGame, jobId),
    analyzePosition: (fen, options) => ipcRenderer.invoke(IPC.engineAnalyzePosition, fen, options),
    startLive: (sessionId, fen, multiPv) => ipcRenderer.invoke(IPC.engineStartLive, sessionId, fen, multiPv),
    stopLive: (sessionId) => ipcRenderer.invoke(IPC.engineStopLive, sessionId),
    onProgress: (listener) => subscribe(IPC.engineProgress, listener),
    onDone: (listener) => subscribe(IPC.engineDone, listener),
    onLive: (listener) => subscribe(IPC.engineLive, listener),
    queueBackground: (gameIds) => ipcRenderer.invoke(IPC.engineQueueBackground, gameIds),
    backgroundState: () => ipcRenderer.invoke(IPC.engineBackgroundState),
    onBackground: (listener) => subscribe(IPC.engineBackground, listener)
  },
  chesscom: {
    recentGames: (username, limit) => ipcRenderer.invoke(IPC.chesscomRecent, username, limit),
    findGameByUrl: (url) => ipcRenderer.invoke(IPC.chesscomFind, url),
    setWatching: (enabled, username) => ipcRenderer.invoke(IPC.chesscomWatch, enabled, username),
    onNewGame: (listener) => subscribe(IPC.chesscomNewGame, listener),
    onWatchStatus: (listener) => subscribe(IPC.chesscomWatchStatus, listener)
  },
  db: {
    listGames: (limit) => ipcRenderer.invoke(IPC.dbListGames, limit),
    getGame: (id) => ipcRenderer.invoke(IPC.dbGetGame, id),
    saveGame: (game) => ipcRenderer.invoke(IPC.dbSaveGame, game),
    deleteGame: (id) => ipcRenderer.invoke(IPC.dbDeleteGame, id),
    getAnalysis: (gameId) => ipcRenderer.invoke(IPC.dbGetAnalysis, gameId),
    saveAnalysis: (gameId, depth, positions, reviewJson) =>
      ipcRenderer.invoke(IPC.dbSaveAnalysis, gameId, depth, positions, reviewJson),
    cachedPositions: (fens, minDepth, multiPv) => ipcRenderer.invoke(IPC.dbCachedPositions, fens, minDepth, multiPv),
    openingIndex: () => ipcRenderer.invoke(IPC.dbOpeningIndex),
    listCards: (kind) => ipcRenderer.invoke(IPC.dbListCards, kind),
    upsertCard: (card) => ipcRenderer.invoke(IPC.dbUpsertCard, card),
    deleteCard: (id) => ipcRenderer.invoke(IPC.dbDeleteCard, id),
    listRepertoire: () => ipcRenderer.invoke(IPC.dbListRepertoire),
    setRepertoire: (openingId, color) => ipcRenderer.invoke(IPC.dbSetRepertoire, openingId, color),
    statsRows: () => ipcRenderer.invoke(IPC.dbStatsRows)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    onChange: (listener) => subscribe(IPC.settingsChanged, listener)
  },
  coach: {
    hasKey: () => ipcRenderer.invoke(IPC.coachHasKey),
    setKey: (key) => ipcRenderer.invoke(IPC.coachSetKey, key),
    clearKey: () => ipcRenderer.invoke(IPC.coachClearKey),
    review: (request) => ipcRenderer.invoke(IPC.coachReview, request)
  },
  app: {
    version: () => ipcRenderer.invoke(IPC.appVersion),
    saveFile: (defaultName, content, kind) => ipcRenderer.invoke(IPC.appSaveFile, defaultName, content, kind),
    readGuides: () => ipcRenderer.invoke(IPC.appReadGuides),
    getValue: (key) => ipcRenderer.invoke(IPC.appGetValue, key),
    setValue: (key, value) => ipcRenderer.invoke(IPC.appSetValue, key, value),
    onOpenGame: (listener) => subscribe(IPC.appOpenGame, listener),
    onMenu: (listener) => subscribe(IPC.appMenu, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
