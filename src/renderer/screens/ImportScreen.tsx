import { useEffect, useMemo, useState } from 'react'
import type { ChesscomGameSummary, StoredGame } from '@shared/types'
import type { BackgroundState } from '@shared/api'
import { chesscomGameId, formatTimeControl, openingFromEcoUrl, storedFromChesscom } from '../analysis/games'
import { FAMILY_NAMES_RU } from '../openings/translate'
import { PasteBox } from '../components/PasteBox'
import { ru } from '../i18n/ru'
import { useApp } from '../store/app'
import { useReview } from '../store/review'
import { useSettings } from '../store/settings'

type TimeFilter = 'all' | 'bullet' | 'blitz' | 'rapid' | 'daily'
type ResultFilter = 'all' | 'wins' | 'losses' | 'draws'

function translateEcoName(name: string | null): string {
  if (!name) return '—'
  const plain = name.replace(/'/g, '')
  const families = Object.keys(FAMILY_NAMES_RU).sort((a, b) => b.length - a.length)
  for (const family of families) {
    const normalized = family.replace(/'/g, '')
    if (plain === normalized || plain.startsWith(`${normalized} `)) {
      const rest = plain.slice(normalized.length).trim()
      return rest ? `${FAMILY_NAMES_RU[family]}: ${rest}` : FAMILY_NAMES_RU[family]
    }
  }
  return name
}

function outcome(game: ChesscomGameSummary, username: string): 'win' | 'loss' | 'draw' {
  const nick = username.toLowerCase()
  const mine = game.white.username.toLowerCase() === nick ? game.white : game.black
  if (mine.result === 'win') return 'win'
  const other = mine === game.white ? game.black : game.white
  if (other.result === 'win') return 'loss'
  return 'draw'
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ImportScreen(): React.JSX.Element {
  const { settings, update } = useSettings()
  const setScreen = useApp((state) => state.setScreen)
  const toast = useApp((state) => state.toast)
  const openStored = useReview((state) => state.openStored)
  const [username, setUsername] = useState(settings.chesscomUsername)
  const [games, setGames] = useState<ChesscomGameSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [stored, setStored] = useState<Map<string, StoredGame>>(new Map())
  const [library, setLibrary] = useState<StoredGame[]>([])
  const [watchStatus, setWatchStatus] = useState<string | null>(null)
  const [background, setBackground] = useState<BackgroundState | null>(null)

  const refreshStored = async (): Promise<void> => {
    const list = await window.api.db.listGames(500)
    setLibrary(list)
    setStored(new Map(list.map((game) => [game.id, game])))
  }

  useEffect(() => {
    void refreshStored()
    void window.api.engine.backgroundState().then((state) => state && setBackground(state))
    const offs = [
      window.api.chesscom.onWatchStatus(setWatchStatus),
      window.api.engine.onBackground((state) => {
        setBackground(state)
        if (state.lastFinished) void refreshStored()
      })
    ]
    if (settings.chesscomUsername) void load(settings.chesscomUsername)
    return () => offs.forEach((off) => off())
  }, [])

  const load = async (nick = username): Promise<void> => {
    const trimmed = nick.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      if (trimmed !== settings.chesscomUsername) await update({ chesscomUsername: trimmed })
      const recent = await window.api.chesscom.recentGames(trimmed, 50)
      setGames(recent)
      if (useSettings.getState().settings.autoAnalyzeOnImport) {
        const ids: string[] = []
        for (const game of recent) {
          const record = storedFromChesscom(game, trimmed)
          const existing = await window.api.db.getGame(record.id)
          if (!existing) await window.api.db.saveGame(record)
          if (!existing?.analyzedDepth) ids.push(record.id)
        }
        if (ids.length) await window.api.engine.queueBackground(ids)
        await refreshStored()
      }
    } catch (caught) {
      setError((caught as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(
    () =>
      games.filter((game) => {
        if (timeFilter !== 'all' && game.timeClass !== timeFilter) return false
        if (resultFilter === 'all') return true
        const result = outcome(game, username)
        return (resultFilter === 'wins' && result === 'win') || (resultFilter === 'losses' && result === 'loss') || (resultFilter === 'draws' && result === 'draw')
      }),
    [games, timeFilter, resultFilter, username]
  )

  const ensureStored = async (game: ChesscomGameSummary): Promise<StoredGame> => {
    const record = storedFromChesscom(game, username)
    const existing = await window.api.db.getGame(record.id)
    if (existing) return existing
    await window.api.db.saveGame(record)
    return record
  }

  const analyze = async (game: ChesscomGameSummary): Promise<void> => {
    const record = await ensureStored(game)
    setScreen('review')
    await openStored(record)
  }

  const analyzeAll = async (): Promise<void> => {
    const ids: string[] = []
    for (const game of filtered) {
      const record = await ensureStored(game)
      if (!record.analyzedDepth) ids.push(record.id)
    }
    await window.api.engine.queueBackground(ids)
    toast(ids.length ? `В очередь на разбор: ${ids.length}` : 'Все партии уже разобраны', 'info')
    await refreshStored()
  }

  const statusFor = (game: ChesscomGameSummary): string => {
    const id = chesscomGameId(game.url)
    if (background?.current === id) return `${Math.round(background.currentProgress * 100)}%…`
    const record = stored.get(id)
    if (!record?.analyzedDepth) return '—'
    const accuracy = record.userColor === 'b' ? record.accuracyBlack : record.accuracyWhite
    return accuracy === null ? '✓' : `${accuracy.toFixed(1)}%`
  }

  return (
    <div className="screen import-screen">
      <h1>{ru.import.title}</h1>
      <div className="import-top">
        <section className="panel">
          <div className="row">
            <label className="label" htmlFor="nick">
              {ru.import.username}
            </label>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input id="nick" type="text" value={username} onChange={(event) => setUsername(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void load()} />
            <button className="primary-button" disabled={loading || !username.trim()} onClick={() => void load()}>
              {loading ? ru.import.loading : ru.import.load}
            </button>
            <button className="text-button" disabled={!filtered.length} onClick={() => void analyzeAll()}>
              {ru.import.analyzeAll}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="watch-box">
            <label className="toggle" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={settings.watchNewGames}
                onChange={(event) => void window.api.chesscom.setWatching(event.target.checked, username.trim())}
              />
              {ru.import.watch}
            </label>
            <span className="muted small">{ru.import.watchHint}</span>
            {settings.watchNewGames && watchStatus && <span className="small">{watchStatus}</span>}
            {background && (background.queued > 0 || background.current) && (
              <span className="small">{ru.engine.background(background.queued + (background.current ? 1 : 0))}</span>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>{ru.import.pasteTitle}</h2>
          <PasteBox compact />
        </section>
      </div>

      <section className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          {(['all', 'bullet', 'blitz', 'rapid', 'daily'] as TimeFilter[]).map((key) => (
            <button key={key} className={`chip ${timeFilter === key ? 'active' : ''}`} onClick={() => setTimeFilter(key)}>
              {ru.import.filters[key]}
            </button>
          ))}
          <span style={{ width: 14 }} />
          {(['all', 'wins', 'losses', 'draws'] as ResultFilter[]).map((key) => (
            <button key={key} className={`chip ${resultFilter === key ? 'active' : ''}`} onClick={() => setResultFilter(key)}>
              {ru.import.filters[key]}
            </button>
          ))}
          <span className="spacer" />
          <span className="muted small">
            {filtered.length} из {games.length}
          </span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{ru.import.columns.date}</th>
                <th>{ru.import.columns.control}</th>
                <th>{ru.import.columns.opponent}</th>
                <th>{ru.import.columns.color}</th>
                <th>{ru.import.columns.result}</th>
                <th>{ru.import.columns.opening}</th>
                <th>{ru.import.columns.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((game) => {
                const nick = username.toLowerCase()
                const isWhite = game.white.username.toLowerCase() === nick
                const opponent = isWhite ? game.black : game.white
                const result = outcome(game, username)
                return (
                  <tr key={game.url}>
                    <td className="mono small">{formatDate(game.endTime)}</td>
                    <td>{formatTimeControl(game.timeControl)}</td>
                    <td>
                      {opponent.username} <span className="muted">({opponent.rating})</span>
                    </td>
                    <td>
                      <span className={`player-dot ${isWhite ? 'w' : 'b'}`} style={{ display: 'inline-block' }} />
                    </td>
                    <td className={`result-${result}`}>{result === 'win' ? ru.import.win : result === 'loss' ? ru.import.loss : ru.import.draw}</td>
                    <td className="small">{translateEcoName(openingFromEcoUrl(game.ecoUrl))}</td>
                    <td className="mono small">{statusFor(game)}</td>
                    <td>
                      <button className="text-button" onClick={() => void analyze(game)}>
                        {ru.import.analyze}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    {loading ? ru.import.loading : 'Введите ник и нажмите «Показать партии».'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>{ru.import.library}</h2>
        <div className="table-scroll" style={{ maxHeight: 320 }}>
          <table className="data">
            <tbody>
              {library.map((game) => {
                const accuracy = game.userColor === 'b' ? game.accuracyBlack : game.userColor === 'w' ? game.accuracyWhite : null
                return (
                  <tr key={game.id}>
                    <td className="mono small">{game.endTime ? new Date(game.endTime).toLocaleDateString('ru-RU') : '—'}</td>
                    <td>
                      {game.white} — {game.black}
                    </td>
                    <td>{game.result}</td>
                    <td className="small">{game.openingName ?? translateEcoName(openingFromEcoUrl(game.ecoUrl))}</td>
                    <td className="mono small">{accuracy !== null ? `${accuracy.toFixed(1)}%` : game.analyzedDepth ? '✓' : '—'}</td>
                    <td>
                      <div className="row">
                        <button
                          className="text-button"
                          onClick={async () => {
                            setScreen('review')
                            await openStored(game)
                          }}
                        >
                          {ru.common.open}
                        </button>
                        <button
                          className="text-button"
                          onClick={async () => {
                            await window.api.db.deleteGame(game.id)
                            await refreshStored()
                          }}
                        >
                          {ru.common.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
