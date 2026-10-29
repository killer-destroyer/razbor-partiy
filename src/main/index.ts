import { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, session, type MenuItemConstructorOptions } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type MenuMessage } from '../shared/api'
import { mergeSettings, type Settings } from '../shared/settings'
import type { AnalysisOptions, CoachRequest, GameAnalysisRequest, StoredGame, TrainerCard } from '../shared/types'
import { buildOpeningIndex, OpeningBook, parseOpeningsTsv } from '../renderer/openings/book'
import { analyzeFens } from './analyzer'
import { BackgroundAnalyzer } from './background'
import { ALLOWED_HOSTS, ChesscomClient, type FetchLike } from './chesscom'
import { requestCoachReview } from './coach'
import { AppDatabase, hashText } from './db'
import { CancelledError, defaultThreads, EngineService, locateEngine, poolSizeFor } from './engine'
import { notify } from './notify'
import type { PuzzleDifficulty } from '../renderer/puzzles/catalog'
import { GameWatcher } from './watcher'
import { PuzzleService } from './puzzles'
import { BotService } from './bot'

const APP_TITLE = 'Разбор партий'
app.setName(APP_TITLE)
if (process.platform === 'win32') app.setAppUserModelId('local.arsen.razbor')

let mainWindow: BrowserWindow | null = null
let database: AppDatabase
let settings: Settings
let openingBook: OpeningBook | null = null
let openingsReady: Promise<void> = Promise.resolve()
const engine = new EngineService()
const bot = new BotService(() => locateEngine(settings.enginePath || null, resourcesDir()))
const puzzles = new PuzzleService(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'puzzles'), () => database)

const fetchViaNet: FetchLike = async (url, init) => {
  const response = await net.fetch(url, { headers: init.headers })
  return { status: response.status, headers: response.headers, json: () => response.json() }
}
const chesscom = new ChesscomClient(fetchViaNet)

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function sendMenu(message: MenuMessage): void {
  send(IPC.appMenu, message)
}

function engineConfig() {
  const threads = settings.engineThreads > 0 ? settings.engineThreads : defaultThreads()
  return {
    path: locateEngine(settings.enginePath || null, resourcesDir()),
    threads,
    hashMb: settings.engineHashMb,
    poolSize: poolSizeFor(threads)
  }
}

function ensureOpeningIndex(): void {
  const dir = join(resourcesDir(), 'openings')
  const files = ['a', 'b', 'c', 'd', 'e'].map((letter) => join(dir, `${letter}.tsv`)).filter((file) => existsSync(file))
  if (!files.length) return
  const texts = files.map((file) => readFileSync(file, 'utf8'))
  const version = hashText(texts.join('\n'))
  if (database.openingsVersion() !== version) {
    const payload = buildOpeningIndex(texts.flatMap(parseOpeningsTsv))
    database.replaceOpenings(payload, version)
  }
  openingBook = new OpeningBook(database.openingIndex())
}

const background = {
  instance: null as BackgroundAnalyzer | null
}

let watcher: GameWatcher | null = null
const watchedGameIds = new Set<string>()

function configureWatcher(): void {
  if (!watcher) return
  if (settings.watchNewGames && settings.chesscomUsername.trim()) void watcher.start(settings.chesscomUsername)
  else watcher.stop()
}

function opponentOf(game: StoredGame): string {
  if (game.userColor === 'w') return game.black
  if (game.userColor === 'b') return game.white
  return `${game.white} — ${game.black}`
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_TITLE,
      submenu: [
        { label: 'О программе', click: () => sendMenu({ command: 'about' }) },
        { type: 'separator' },
        { label: 'Настройки…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu({ command: 'navigate', payload: 'settings' }) },
        { type: 'separator' },
        ...(process.platform === 'darwin'
          ? ([
              { role: 'hide', label: `Скрыть «${APP_TITLE}»` },
              { role: 'hideOthers', label: 'Скрыть остальные' },
              { role: 'unhide', label: 'Показать все' },
              { type: 'separator' }
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'quit', label: process.platform === 'darwin' ? `Завершить «${APP_TITLE}»` : 'Выход', accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4' }
      ]
    },
    {
      label: 'Файл',
      submenu: [
        { label: 'Открыть PGN…', accelerator: 'CmdOrCtrl+O', click: () => void openPgnDialog() },
        { label: 'Импорт с chess.com', accelerator: 'CmdOrCtrl+I', click: () => sendMenu({ command: 'navigate', payload: 'import' }) },
        { type: 'separator' },
        { label: 'Экспорт аннотированного PGN…', accelerator: 'CmdOrCtrl+E', click: () => sendMenu({ command: 'export-pgn' }) },
        { label: 'Сохранить позицию как PNG…', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenu({ command: 'export-png' }) },
        { type: 'separator' },
        { role: 'close', label: 'Закрыть окно' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выбрать всё' }
      ]
    },
    {
      label: 'Партия',
      submenu: [
        { label: 'Перевернуть доску', accelerator: 'F', registerAccelerator: false, click: () => sendMenu({ command: 'flip' }) },
        { label: 'Следующая ошибка', accelerator: 'N', registerAccelerator: false, click: () => sendMenu({ command: 'next-mistake' }) },
        { label: 'Повторить ошибку', click: () => sendMenu({ command: 'retry-mistake' }) },
        { label: 'Свободный анализ позиции', accelerator: 'CmdOrCtrl+Shift+A', click: () => sendMenu({ command: 'free-analysis' }) }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Разбор', accelerator: 'CmdOrCtrl+1', click: () => sendMenu({ command: 'navigate', payload: 'review' }) },
        { label: 'Импорт', accelerator: 'CmdOrCtrl+2', click: () => sendMenu({ command: 'navigate', payload: 'import' }) },
        { label: 'Дебюты', accelerator: 'CmdOrCtrl+3', click: () => sendMenu({ command: 'navigate', payload: 'openings' }) },
        { label: 'Тренажёр', accelerator: 'CmdOrCtrl+4', click: () => sendMenu({ command: 'navigate', payload: 'trainer' }) },
        { label: 'Статистика', accelerator: 'CmdOrCtrl+5', click: () => sendMenu({ command: 'navigate', payload: 'stats' }) },
        { label: 'Свободный анализ', accelerator: 'CmdOrCtrl+6', click: () => sendMenu({ command: 'navigate', payload: 'free' }) },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Обычный размер' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полноэкранный режим' },
        ...(app.isPackaged ? [] : ([{ role: 'reload', label: 'Перезагрузить' }, { role: 'toggleDevTools', label: 'Инструменты разработчика' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Окно',
      submenu: [
        { role: 'minimize', label: 'Свернуть' },
        { role: 'zoom', label: 'Изменить масштаб' },
        { type: 'separator' },
        { role: 'front', label: 'Все окна на передний план' }
      ]
    },
    {
      role: 'help',
      label: 'Справка',
      submenu: [{ label: 'Горячие клавиши', click: () => sendMenu({ command: 'shortcuts' }) }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function openPgnDialog(): Promise<void> {
  if (!mainWindow) return
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Открыть PGN',
    properties: ['openFile'],
    filters: [{ name: 'PGN', extensions: ['pgn', 'txt'] }]
  })
  if (result.canceled || !result.filePaths[0]) return
  sendMenu({ command: 'open-pgn', payload: readFileSync(result.filePaths[0], 'utf8') })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: APP_TITLE,
    backgroundColor: '#1f2023',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!(devUrl && url.startsWith(devUrl))) event.preventDefault()
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function restrictRendererNetwork(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const allowed =
      url.startsWith('file:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('devtools:') ||
      url.startsWith('chrome-extension:') ||
      (details.webContentsId === undefined && ALLOWED_HOSTS.has(hostOf(url))) ||
      (devUrl !== undefined && (url.startsWith(devUrl) || url.startsWith(devUrl.replace(/^http/, 'ws'))))
    callback({ cancel: !allowed })
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
}

function registerIpc(): void {
  ipcMain.handle(IPC.engineStatus, () => engine.status())
  ipcMain.handle(IPC.engineRestart, () => engine.start(engineConfig()))
  ipcMain.handle(IPC.engineAnalyzeGame, async (_event, request: GameAnalysisRequest) => {
    try {
      await analyzeFens(engine, database, request.fens, request.options, request.jobId, request.priority, (index, analysis) => {
        send(IPC.engineProgress, { jobId: request.jobId, index, total: request.fens.length, analysis })
      })
      send(IPC.engineDone, { jobId: request.jobId, cancelled: false, error: null })
    } catch (error) {
      const cancelled = error instanceof CancelledError
      send(IPC.engineDone, { jobId: request.jobId, cancelled, error: cancelled ? null : (error as Error).message })
    }
  })
  ipcMain.handle(IPC.engineCancelGame, (_event, jobId: string) => engine.cancelJob(jobId))
  ipcMain.handle(IPC.engineAnalyzePosition, async (_event, fen: string, options: AnalysisOptions) => {
    const cached = database.lookup([fen], options.movetimeMs ? 1 : options.depth, options.multiPv)[0]
    if (cached) return cached
    const analysis = await engine.analyze(fen, options, `position:${fen}`, 'foreground')
    database.store(analysis, options.multiPv)
    return analysis
  })
  ipcMain.handle(IPC.engineStartLive, (_event, sessionId: string, fen: string, multiPv: number) =>
    engine.startLive(sessionId, fen, multiPv, (analysis) => send(IPC.engineLive, { sessionId, fen, analysis }))
  )
  ipcMain.handle(IPC.engineStopLive, (_event, sessionId: string) => engine.stopLive(sessionId))
  ipcMain.handle(IPC.engineQueueBackground, (_event, gameIds: string[]) => background.instance?.enqueue(gameIds))
  ipcMain.handle(IPC.engineBackgroundState, () => background.instance?.snapshot())

  ipcMain.handle(IPC.chesscomRecent, (_event, username: string, limit: number) => chesscom.recentGames(username, limit))
  ipcMain.handle(IPC.chesscomFind, (_event, url: string) => chesscom.findGame(url, settings.chesscomUsername))
  ipcMain.handle(IPC.chesscomWatch, async (_event, enabled: boolean, username: string) => {
    settings = mergeSettings({ ...settings, watchNewGames: enabled, chesscomUsername: username })
    database.setValue('settings', settings)
    send(IPC.settingsChanged, settings)
    configureWatcher()
  })

  ipcMain.handle(IPC.dbListGames, (_event, limit: number) => database.listGames(limit))
  ipcMain.handle(IPC.dbGetGame, (_event, id: string) => database.getGame(id))
  ipcMain.handle(IPC.dbSaveGame, (_event, game: StoredGame) => database.saveGame(game))
  ipcMain.handle(IPC.dbDeleteGame, (_event, id: string) => database.deleteGame(id))
  ipcMain.handle(IPC.dbGetAnalysis, (_event, id: string) => database.getAnalysis(id))
  ipcMain.handle(IPC.dbSaveAnalysis, (_event, id: string, depth: number, positions, reviewJson: string | null) =>
    database.saveAnalysis(id, depth, positions, reviewJson)
  )
  ipcMain.handle(IPC.dbCachedPositions, (_event, fens: string[], minDepth: number, multiPv: number) => database.lookup(fens, minDepth, multiPv))
  ipcMain.handle(IPC.dbOpeningIndex, async () => {
    await openingsReady
    return database.openingIndex()
  })
  ipcMain.handle(IPC.dbListCards, (_event, kind: TrainerCard['kind'] | null) => database.listCards(kind))
  ipcMain.handle(IPC.dbUpsertCard, (_event, card: TrainerCard) => database.upsertCard(card))
  ipcMain.handle(IPC.dbDeleteCard, (_event, id: string) => database.deleteCard(id))
  ipcMain.handle(IPC.dbListRepertoire, () => database.listRepertoire())
  ipcMain.handle(IPC.dbSetRepertoire, (_event, openingId: number, color: 'w' | 'b' | null) => database.setRepertoire(openingId, color))
  ipcMain.handle(IPC.dbStatsRows, () => database.statsRows())

  ipcMain.handle(IPC.settingsGet, () => settings)
  ipcMain.handle(IPC.settingsSet, async (_event, patch: Partial<Settings>) => {
    const previous = settings
    settings = mergeSettings({ ...settings, ...patch })
    database.setValue('settings', settings)
    send(IPC.settingsChanged, settings)
    const engineChanged =
      previous.engineThreads !== settings.engineThreads ||
      previous.engineHashMb !== settings.engineHashMb ||
      previous.enginePath !== settings.enginePath
    if (engineChanged) await engine.start(engineConfig())
    if (previous.watchNewGames !== settings.watchNewGames || previous.chesscomUsername !== settings.chesscomUsername) configureWatcher()
    return settings
  })

  ipcMain.handle(IPC.coachHasKey, () => database.getValue<string>('coach.key') !== null)
  ipcMain.handle(IPC.coachSetKey, (_event, key: string) => {
    if (!safeStorage.isEncryptionAvailable()) return false
    database.setValue('coach.key', safeStorage.encryptString(key.trim()).toString('base64'))
    return true
  })
  ipcMain.handle(IPC.coachClearKey, () => database.deleteValue('coach.key'))
  ipcMain.handle(IPC.coachReview, async (_event, request: CoachRequest) => {
    const stored = database.getValue<string>('coach.key')
    if (!stored || !settings.coachEnabled) return { text: '', inputTokens: 0, outputTokens: 0, error: 'AI-тренер выключен или ключ не задан.' }
    const key = safeStorage.decryptString(Buffer.from(stored, 'base64'))
    return requestCoachReview(key, request)
  })

  ipcMain.handle(IPC.appVersion, () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))
  ipcMain.handle(IPC.appSaveFile, async (_event, defaultName: string, content: string, kind: 'pgn' | 'png') => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: kind === 'pgn' ? [{ name: 'PGN', extensions: ['pgn'] }] : [{ name: 'PNG', extensions: ['png'] }]
    })
    if (result.canceled || !result.filePath) return null
    if (kind === 'png') writeFileSync(result.filePath, Buffer.from(content.replace(/^data:image\/png;base64,/, ''), 'base64'))
    else writeFileSync(result.filePath, content, 'utf8')
    return result.filePath
  })
  const userKey = (key: string): string => {
    if (!/^(course|ui)\.[\w.-]+$/.test(key)) throw new Error('Недопустимый ключ')
    return key
  }
  ipcMain.handle(IPC.appGetValue, (_event, key: string) => database.getValue(userKey(key)))
  ipcMain.handle(IPC.appSetValue, (_event, key: string, value: unknown) => database.setValue(userKey(key), value))
  ipcMain.handle(IPC.botMove, (_event, fen: string, level: number) => bot.move(fen, level))
  ipcMain.handle(IPC.botNewGame, () => bot.newGame())
  ipcMain.handle(IPC.puzzlesCatalog, () => puzzles.catalog())
  ipcMain.handle(IPC.puzzlesNext, (_event, categoryId: string, difficulty: PuzzleDifficulty, excludeId: string | null) => puzzles.next(categoryId, difficulty, excludeId))
  ipcMain.handle(IPC.puzzlesRecord, (_event, id: string, solved: boolean) => puzzles.record(id, solved))
  ipcMain.handle(IPC.appReadGuides, () => {
    const file = join(resourcesDir(), 'openings', 'guides.json')
    return existsSync(file) ? readFileSync(file, 'utf8') : '[]'
  })
}

app.whenReady().then(async () => {
  database = new AppDatabase(join(app.getPath('userData'), 'razbor.sqlite'))
  settings = mergeSettings(database.getValue<Partial<Settings>>('settings'))
  background.instance = new BackgroundAnalyzer(
    database,
    engine,
    () => openingBook,
    () => settings,
    (state) => send(IPC.engineBackground, state)
  )
  watcher = new GameWatcher(
    chesscom,
    database,
    (ids) => {
      for (const id of ids) watchedGameIds.add(id)
      background.instance?.enqueue(ids)
    },
    (status) => send(IPC.chesscomWatchStatus, status)
  )
  background.instance.onFinished((result) => {
    send(IPC.chesscomNewGame, { gameId: result.game.id, opponent: opponentOf(result.game), accuracy: result.accuracy })
    if (result.error || !watchedGameIds.delete(result.game.id)) return
    const accuracy = result.accuracy === null ? '—' : `${Math.round(result.accuracy)}%`
    notify(APP_TITLE, `Партия против ${opponentOf(result.game)} разобрана: точность ${accuracy}`, () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
      send(IPC.appOpenGame, result.game.id)
    })
  })
  restrictRendererNetwork()
  registerIpc()
  buildMenu()
  createWindow()
  openingsReady = new Promise((resolve) => {
    setTimeout(() => {
      try {
        ensureOpeningIndex()
      } finally {
        resolve()
      }
    }, 50)
  })
  await engine.start(engineConfig())
  configureWatcher()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  watcher?.stop()
  void engine.shutdown()
  void bot.shutdown()
})
