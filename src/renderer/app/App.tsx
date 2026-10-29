import { useEffect, useState } from 'react'
import type { EngineStatus } from '@shared/types'
import type { BackgroundState } from '@shared/api'
import { ru } from '../i18n/ru'
import { useApp, type Screen } from '../store/app'
import { useReview } from '../store/review'
import { useSettings } from '../store/settings'
import { useOpenings } from '../openings/store'
import { openAnyText } from '../components/PasteBox'
import { ReviewScreen } from '../screens/ReviewScreen'
import { ImportScreen } from '../screens/ImportScreen'
import { OpeningsScreen } from '../screens/OpeningsScreen'
import { TrainerScreen } from '../screens/TrainerScreen'
import { StatsScreen } from '../screens/StatsScreen'
import { FreeAnalysisScreen } from '../screens/FreeAnalysisScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { PuzzlesScreen } from '../screens/PuzzlesScreen'
import { PlayScreen } from '../screens/PlayScreen'
import { CourseScreen } from '../screens/CourseScreen'
import { AboutDialog, ShortcutsDialog } from './Dialogs'

const NAV: Array<{ screen: Screen; icon: string }> = [
  { screen: 'review', icon: '♞' },
  { screen: 'import', icon: '⇩' },
  { screen: 'puzzles', icon: '🧩' },
  { screen: 'play', icon: '🤖' },
  { screen: 'course', icon: '🎓' },
  { screen: 'openings', icon: '📖' },
  { screen: 'trainer', icon: '🎯' },
  { screen: 'stats', icon: '📈' },
  { screen: 'free', icon: '♟' },
  { screen: 'settings', icon: '⚙' }
]

function applyTheme(mode: string): void {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

export function App(): React.JSX.Element {
  const { screen, setScreen, toasts, dismiss, toast, aboutOpen, shortcutsOpen, setAbout, setShortcuts } = useApp()
  const { loaded, load, settings } = useSettings()
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [background, setBackground] = useState<BackgroundState | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void load()
    void useOpenings.getState().load()
    const refreshEngine = (): void => void window.api.engine.status().then(setEngine)
    refreshEngine()
    const timer = setInterval(refreshEngine, 3000)
    const offs = [
      window.api.engine.onBackground(setBackground),
      window.api.app.onOpenGame(async (gameId) => {
        const game = await window.api.db.getGame(gameId)
        if (!game) return
        setScreen('review')
        await useReview.getState().openStored(game)
      }),
      window.api.chesscom.onNewGame((notice) => {
        const accuracy = notice.accuracy === null ? '' : `: точность ${Math.round(notice.accuracy)}%`
        toast(`Партия против ${notice.opponent} разобрана${accuracy}`, 'success', {
          label: ru.common.open,
          run: async () => {
            const game = await window.api.db.getGame(notice.gameId)
            if (game) {
              setScreen('review')
              await useReview.getState().openStored(game)
            }
          }
        })
      }),
      window.api.app.onMenu(async (message) => {
        if (message.command === 'navigate' && message.payload) setScreen(message.payload as Screen)
        if (message.command === 'about') setAbout(true)
        if (message.command === 'shortcuts') setShortcuts(true)
        if (message.command === 'open-pgn' && message.payload) {
          const problem = await openAnyText(message.payload)
          if (problem) toast(problem, 'error')
        }
      })
    ]
    return () => {
      clearInterval(timer)
      offs.forEach((off) => off())
    }
  }, [])

  useEffect(() => {
    applyTheme(settings.themeMode)
  }, [settings.themeMode])

  useEffect(() => {
    const over = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setDragging(true)
    }
    const leave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragging(false)
    }
    const drop = async (event: DragEvent): Promise<void> => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      const problem = await openAnyText(await file.text())
      if (problem) toast(problem, 'error')
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  if (!loaded) return <div className="splash">{ru.common.loading}</div>

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-icon">♞</span>
          <span>{ru.appTitle}</span>
        </div>
        {NAV.map((item) => (
          <button key={item.screen} className={`nav-item ${screen === item.screen ? 'active' : ''}`} onClick={() => setScreen(item.screen)}>
            <span className="nav-icon">{item.icon}</span>
            <span>{ru.nav[item.screen]}</span>
          </button>
        ))}
        <span className="spacer" />
        <div className="engine-status">
          <span className={`status-dot ${engine?.ready ? 'ok' : 'bad'}`} />
          <span title={engine?.path ?? ''}>{engine?.ready ? engine.name ?? ru.engine.ready : engine?.error ? ru.engine.missing : ru.engine.starting}</span>
          {background && (background.queued > 0 || background.current) && (
            <div className="muted small">
              {ru.engine.background(background.queued + (background.current ? 1 : 0))}
              {background.current && ` · ${Math.round(background.currentProgress * 100)}%`}
            </div>
          )}
        </div>
      </nav>
      <main className="content">
        {screen === 'review' && <ReviewScreen />}
        {screen === 'import' && <ImportScreen />}
        {screen === 'openings' && <OpeningsScreen />}
        {screen === 'trainer' && <TrainerScreen />}
        {screen === 'stats' && <StatsScreen />}
        {screen === 'free' && <FreeAnalysisScreen />}
        {screen === 'puzzles' && <PuzzlesScreen />}
        {screen === 'play' && <PlayScreen />}
        {screen === 'course' && <CourseScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
      {dragging && <div className="drop-overlay">Отпустите файл .pgn, чтобы открыть партию</div>}
      <div className="toasts">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.kind}`}>
            <span>{item.text}</span>
            {item.action && (
              <button
                className="text-button"
                onClick={() => {
                  item.action!.run()
                  dismiss(item.id)
                }}
              >
                {item.action.label}
              </button>
            )}
            <button className="toast-close" onClick={() => dismiss(item.id)}>×</button>
          </div>
        ))}
      </div>
      {aboutOpen && <AboutDialog onClose={() => setAbout(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  )
}
