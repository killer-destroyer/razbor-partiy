import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import type { Color, StoredGame } from '@shared/types'
import { Board, type BoardMove } from '../board/Board'
import { playSound, soundForSan } from '../board/sounds'
import { renderPositionPng } from '../board/png'
import { themeById } from '../board/themes'
import { EvalBar } from '../components/EvalBar'
import { EvalGraph } from '../components/EvalGraph'
import { MoveList } from '../components/MoveList'
import { ClassBadge, ClassIcon } from '../components/ClassBadge'
import { InlineParagraph, ParagraphView } from '../components/CommentView'
import { CoachPanel } from '../components/CoachPanel'
import { BAD_CLASSES, SERIOUS_CLASSES, type MoveClass } from '../analysis/classify'
import { annotatedPgn } from '../analysis/export'
import { displaySan, moveLabel } from '../analysis/notation'
import type { MoveReview, SideReport } from '../analysis/review'
import { CLASS_INFO, ru } from '../i18n/ru'
import { useApp } from '../store/app'
import { useReview } from '../store/review'
import { useSettings } from '../store/settings'
import { PasteBox } from '../components/PasteBox'

const CARD_CLASSES: MoveClass[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']

function classMarker(moveClass: MoveClass): string {
  const info = CLASS_INFO[moveClass]
  const symbol = moveClass === 'book' ? '' : info.symbol.replace('&', '&amp;').replace('<', '&lt;')
  const fontSize = symbol.length > 1 ? 46 : 58
  return `<g transform="translate(66 -14) scale(0.44)"><circle cx="50" cy="50" r="48" fill="${info.color}" stroke="#fff" stroke-width="6"/><text x="50" y="${symbol === '★' ? 66 : 69}" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-weight="700" font-size="${fontSize}" fill="#fff">${symbol}</text></g>`
}

function tint(color: string, alpha: number): string {
  const value = Number.parseInt(color.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return ''
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  return `${minutes}:${String(rest).padStart(2, '0')}${seconds < 20 ? `.${Math.floor((seconds % 1) * 10)}` : ''}`
}

function PlayerStrip({ color, game, clock, isUser }: { color: Color; game: StoredGame; clock: number | null; isUser: boolean }): React.JSX.Element {
  const name = color === 'w' ? game.white : game.black
  const elo = color === 'w' ? game.whiteElo : game.blackElo
  return (
    <div className="player-strip">
      <span className={`player-dot ${color}`} />
      <span className="player-name">{name}</span>
      {elo && <span className="player-elo">({elo})</span>}
      {isUser && <span className="you-tag">{ru.common.you}</span>}
      <span className="spacer" />
      {clock !== null && <span className={`clock mono ${clock < 30 ? 'low' : ''}`}>{formatClock(clock)}</span>}
    </div>
  )
}

function PlayerCard({ report, name, isUser, compare }: { report: SideReport; name: string; isUser: boolean; compare: string | null }): React.JSX.Element {
  return (
    <div className={`player-card ${isUser ? 'mine' : ''}`}>
      <div className="player-card-head">
        <span className={`player-dot ${report.color}`} />
        <span className="player-name">{name}</span>
        {isUser && <span className="you-tag">{ru.common.you}</span>}
      </div>
      <div className="player-card-numbers">
        <div>
          <div className="label">{ru.review.accuracy}</div>
          <div className="big-number">{report.accuracy === null ? '…' : report.accuracy.toFixed(1)}</div>
        </div>
        <div>
          <div className="label">
            {ru.review.gameRating} <span className="hint">({ru.common.approximate})</span>
          </div>
          <div className="big-number">{report.rating ?? '…'}</div>
        </div>
      </div>
      <div className="class-counts">
        {CARD_CLASSES.map((moveClass) => (
          <div key={moveClass} className={`class-count ${report.counts[moveClass] ? '' : 'zero'}`}>
            <ClassIcon moveClass={moveClass} size={18} />
            <span>{CLASS_INFO[moveClass].name}</span>
            <b className="mono">{report.counts[moveClass]}</b>
          </div>
        ))}
      </div>
      <div className="phase-row">
        {(['opening', 'middlegame', 'endgame'] as const).map((phase) => (
          <span key={phase} className="phase-chip">
            {ru.review.phases[phase]}: <b>{report.phases[phase] === null ? '—' : `${report.phases[phase]!.toFixed(0)}%`}</b>
          </span>
        ))}
      </div>
      {compare && <div className="compare-line">{compare}</div>}
    </div>
  )
}

function MistakeItem({ entry, label, extra, onClick }: { entry: MoveReview; label: string; extra: React.ReactNode; onClick: () => void }): React.JSX.Element {
  return (
    <button className="mistake-item" onClick={onClick}>
      <ClassIcon moveClass={entry.moveClass} size={22} />
      <span className="mistake-text">
        <span className="mono">{label}</span> <span className="muted">{extra}</span>
      </span>
      <span className="mono muted">−{entry.loss.toFixed(0)}%</span>
    </button>
  )
}

export function ReviewScreen(): React.JSX.Element {
  const state = useReview()
  const settings = useSettings((store) => store.settings)
  const toast = useApp((store) => store.toast)
  const openFreeAnalysis = useApp((store) => store.openFreeAnalysis)
  const { game, parsed, review, positions, cursor, orientation, userColor, retry } = state
  const previousCursor = useRef(cursor)
  const [compare, setCompare] = useState<string | null>(null)
  const boardColumnRef = useRef<HTMLDivElement>(null)
  const [boardHeight, setBoardHeight] = useState(480)

  useEffect(() => {
    const delta = cursor - previousCursor.current
    previousCursor.current = cursor
    if (!parsed || delta !== 1 || cursor === 0) return
    const move = parsed.moves[cursor - 1]
    playSound(soundForSan(move.san, cursor === parsed.moves.length && /#|1-0|0-1/.test(move.san)), settings)
  }, [cursor, parsed, settings])

  useEffect(() => {
    if (!state.autoplay || !parsed) return
    const timer = setInterval(() => {
      const current = useReview.getState()
      if (current.cursor >= (current.parsed?.moves.length ?? 0)) current.setAutoplay(false)
      else current.step(1)
    }, 1000)
    return () => clearInterval(timer)
  }, [state.autoplay, parsed])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (/INPUT|TEXTAREA|SELECT/.test(target.tagName)) return
      const store = useReview.getState()
      if (!store.parsed) return
      if (event.key === 'ArrowLeft') store.step(-1)
      else if (event.key === 'ArrowRight') store.step(1)
      else if (event.key === 'Home') store.go(0)
      else if (event.key === 'End') store.go(Infinity)
      else if (event.key === 'f' || event.key === 'F' || event.key === 'а' || event.key === 'А') store.flip()
      else if (event.key === ' ') store.setAutoplay(!store.autoplay)
      else if (event.key === 'b' || event.key === 'B' || event.key === 'и' || event.key === 'И') store.toggleBest()
      else if (event.key === 'n' || event.key === 'N' || event.key === 'т' || event.key === 'Т') store.nextMistake()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!game || !review?.complete || !userColor) {
      setCompare(null)
      return
    }
    const accuracy = userColor === 'w' ? review.white.accuracy : review.black.accuracy
    if (accuracy === null) return
    void window.api.db.statsRows().then((rows) => {
      const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
      const others = rows.filter((row) => row.id !== game.id && row.accuracy !== null && (row.endTime ?? row.importedAt) >= monthAgo)
      if (others.length < 2) {
        setCompare(null)
        return
      }
      const average = others.reduce((sum, row) => sum + (row.accuracy ?? 0), 0) / others.length
      const diff = accuracy - average
      const diffText = Math.abs(diff) < 0.5 ? 'на уровне' : diff > 0 ? `выше на ${diff.toFixed(0)}%` : `ниже на ${Math.abs(diff).toFixed(0)}%`
      setCompare(ru.review.selfCompare(accuracy.toFixed(0), diffText, 'за месяц'))
    })
  }, [game, review?.complete, userColor, review])

  useEffect(() => {
    const element = boardColumnRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setBoardHeight(element.querySelector('.board-frame')?.clientHeight ?? 480))
    observer.observe(element)
    return () => observer.disconnect()
  }, [parsed])

  useEffect(() => {
    return window.api.app.onMenu(async (message) => {
      const store = useReview.getState()
      if (message.command === 'flip') store.flip()
      if (message.command === 'next-mistake') store.nextMistake()
      if (message.command === 'retry-mistake') store.startRetry()
      if (message.command === 'export-pgn') await exportPgn()
      if (message.command === 'export-png') await exportPng()
      if (message.command === 'free-analysis' && store.parsed) openFreeAnalysis(store.parsed.fens[store.cursor])
    })
  }, [])

  const exportPgn = async (): Promise<void> => {
    const store = useReview.getState()
    if (!store.parsed) return
    const text = annotatedPgn(store.parsed, store.positions, store.review)
    const name = `${store.game?.white ?? 'white'}-${store.game?.black ?? 'black'}.pgn`.replace(/[^\p{L}\p{N}._-]+/gu, '_')
    const saved = await window.api.app.saveFile(name, text, 'pgn')
    if (saved) toast(`PGN сохранён: ${saved}`, 'success')
  }

  const exportPng = async (): Promise<void> => {
    const store = useReview.getState()
    if (!store.parsed) return
    const current = useSettings.getState().settings
    const data = await renderPositionPng(store.parsed.fens[store.cursor], store.orientation, themeById(current.boardTheme), current.pieceSet)
    const saved = await window.api.app.saveFile(`позиция-${store.cursor}.png`, data, 'png')
    if (saved) toast(`PNG сохранён: ${saved}`, 'success')
  }

  const currentEntry = cursor > 0 ? review?.moves[cursor - 1] ?? null : null
  const displayFen = parsed ? parsed.fens[retry ? retry.index : cursor] : ''

  const shapes = useMemo(() => {
    const list: DrawShape[] = []
    if (!parsed) return list
    if (retry) {
      const best = positions[retry.index]?.lines[0]?.pv[0]
      if (best && (retry.hint || retry.solved)) list.push({ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'hint' })
      return list
    }
    if (currentEntry) {
      const move = parsed.moves[cursor - 1]
      list.push({ orig: move.to as Key, customSvg: { html: classMarker(currentEntry.moveClass) } })
      const bestUci = currentEntry.bestUci
      if (state.showBest && settings.showBestMoveArrow && bestUci && !currentEntry.isBest && currentEntry.moveClass !== 'book' && bestUci !== move.uci) {
        list.push({ orig: bestUci.slice(0, 2) as Key, dest: bestUci.slice(2, 4) as Key, brush: 'best' })
      }
    }
    return list
  }, [parsed, cursor, currentEntry, positions, retry, state.showBest, settings.showBestMoveArrow])

  if (!game || !parsed) {
    return (
      <div className="screen empty-review">
        <div className="empty-card">
          <h1>{ru.appTitle}</h1>
          <p className="muted">{ru.review.empty}</p>
          <PasteBox />
          {state.error && <p className="error-text">{state.error}</p>}
          <RecentGames />
        </div>
      </div>
    )
  }

  const lastMove = cursor > 0 && !retry ? ([parsed.moves[cursor - 1].from, parsed.moves[cursor - 1].to] as [string, string]) : null
  const lastTint = currentEntry && !retry ? tint(CLASS_INFO[currentEntry.moveClass].color, 0.42) : null
  const scoreAtCursor = positions[retry ? retry.index : cursor]?.lines[0]?.score ?? null
  const topColor: Color = orientation === 'white' ? 'b' : 'w'
  const bottomColor: Color = orientation === 'white' ? 'w' : 'b'
  const clockFor = (color: Color): number | null => {
    for (let index = Math.min(cursor, parsed.moves.length) - 1; index >= 0; index -= 1) {
      if (parsed.moves[index].color === color) return parsed.moves[index].clockSeconds
    }
    return null
  }
  const progress = state.progress
  const statusText = progress
    ? ru.engine.analyzing(progress.done, progress.total)
    : state.status === 'stopped'
      ? ru.engine.stopped
      : state.status?.startsWith('done:')
        ? ru.engine.done(parsed.moves.length, useSettings.getState().settings.analysisDepth)
        : null

  const onBoardMove = (move: BoardMove): void => {
    if (retry) {
      state.attemptRetry(move.from + move.to + (move.promotion ?? ''))
    }
  }

  const userMistakes = review?.moves.filter((entry): entry is MoveReview => !!entry && (userColor ? entry.color === userColor : true) && BAD_CLASSES.includes(entry.moveClass)) ?? []
  const opponentMistakes = review?.moves.filter((entry): entry is MoveReview => !!entry && userColor !== null && entry.color !== userColor && SERIOUS_CLASSES.includes(entry.moveClass)) ?? []
  const label = (index: number): string => moveLabel(parsed.moves[index].fenBefore, parsed.moves[index].san, settings.notation)

  return (
    <div className="screen review-screen">
      <div className="review-board-column" ref={boardColumnRef}>
        <div className="opening-title">
          {state.opening?.opening ? (
            <>
              <span className="eco mono">{state.opening.opening.eco}</span>
              <span>{state.opening.nameRu}</span>
              {state.opening.exitPly !== null && parsed.moves[state.opening.exitPly - 1] && (
                <span className="muted">· {ru.review.outOfBook(label(state.opening.exitPly - 1))}</span>
              )}
            </>
          ) : (
            <span className="muted">{game.white} — {game.black}</span>
          )}
        </div>
        <PlayerStrip color={topColor} game={game} clock={clockFor(topColor)} isUser={userColor === topColor} />
        <div className="board-row">
          {settings.showEvalBar && <EvalBar score={scoreAtCursor} orientation={orientation} height={boardHeight} />}
          <Board
            fen={displayFen}
            orientation={orientation}
            lastMove={lastMove}
            lastMoveTint={lastTint}
            interactive={Boolean(retry && !retry.solved)}
            onMove={onBoardMove}
            autoShapes={shapes}
            freeShapesKey={`${cursor}`}
          />
        </div>
        <PlayerStrip color={bottomColor} game={game} clock={clockFor(bottomColor)} isUser={userColor === bottomColor} />
        <div className="nav-bar">
          <button className="icon-button" onClick={() => state.go(0)} title="В начало (Home)">⏮</button>
          <button className="icon-button" onClick={() => state.step(-1)} title="Назад (←)">◀</button>
          <button className={`icon-button ${state.autoplay ? 'active' : ''}`} onClick={() => state.setAutoplay(!state.autoplay)} title={`${ru.review.autoplay} (Space)`}>
            {state.autoplay ? '⏸' : '▶︎'}
          </button>
          <button className="icon-button" onClick={() => state.step(1)} title="Вперёд (→)">▶</button>
          <button className="icon-button" onClick={() => state.go(Infinity)} title="В конец (End)">⏭</button>
          <span className="spacer" />
          <button className="text-button" onClick={state.flip} title="F">{ru.review.flip}</button>
          <label className="toggle">
            <input type="checkbox" checked={state.showBest} onChange={state.toggleBest} /> {ru.review.bestArrow}
          </label>
        </div>
        <div className="graph-block">
          <div className="label">{ru.review.graphLabel}</div>
          <EvalGraph winPercents={review?.winPercents ?? positions.map(() => null)} moves={review?.moves ?? []} cursor={cursor} userColor={userColor} onSelect={state.go} />
        </div>
      </div>

      <div className="review-side">
        <div className="side-header">
          <div className="segmented">
            <button className={state.mode === 'overview' ? 'active' : ''} onClick={() => state.setMode('overview')}>{ru.review.overview}</button>
            <button className={state.mode === 'all' ? 'active' : ''} onClick={() => state.setMode('all')}>{ru.review.allMoves}</button>
          </div>
          <span className="spacer" />
          {state.jobId ? (
            <button className="text-button" onClick={() => void state.stopAnalysis()}>{ru.engine.stop}</button>
          ) : (
            <button className="text-button" onClick={() => void state.startAnalysis(true)} title="Проанализировать заново с текущими настройками">↻</button>
          )}
          <button className="text-button" onClick={() => openFreeAnalysis(parsed.fens[cursor])}>{ru.review.freeAnalysis}</button>
          <button className="text-button" onClick={() => void exportPgn()}>{ru.review.exportPgn}</button>
          <button className="text-button" onClick={() => void exportPng()}>{ru.review.exportPng}</button>
        </div>
        {(statusText || state.error) && (
          <div className={`status-line ${state.error ? 'error' : ''}`}>
            {state.error ?? statusText}
            {progress && (
              <div className="progress">
                <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {!userColor && (
          <div className="color-choice">
            {ru.review.chooseColor}
            <button className="text-button" onClick={() => state.setUserColor('w')}>{ru.common.white}</button>
            <button className="text-button" onClick={() => state.setUserColor('b')}>{ru.common.black}</button>
          </div>
        )}
        {review && (
          <div className="player-cards">
            <PlayerCard report={review.white} name={game.white} isUser={userColor === 'w'} compare={userColor === 'w' ? compare : null} />
            <PlayerCard report={review.black} name={game.black} isUser={userColor === 'b'} compare={userColor === 'b' ? compare : null} />
          </div>
        )}

        {retry ? (
          <RetryPanel />
        ) : state.mode === 'overview' ? (
          <>
            <section className="panel">
              <h2>{ru.review.summary}</h2>
              {review?.summary.map((paragraph, index) => <ParagraphView key={index} paragraph={paragraph} />)}
            </section>
            <section className="panel">
              <div className="panel-title-row">
                <h2>{ru.review.keyMoments}</h2>
                <span className="spacer" />
                <button className="primary-button small" onClick={state.nextMistake}>{ru.review.nextMistake}</button>
                <button className="text-button" onClick={() => state.startRetry()}>{ru.review.retryMistake}</button>
              </div>
              <div className="mistake-list">
                {review?.keyMoments.map((index) => {
                  const entry = review.moves[index]
                  if (!entry) return null
                  return (
                    <MistakeItem
                      key={index}
                      entry={entry}
                      label={label(index)}
                      extra={entry.comment?.short.length ? <InlineParagraph paragraph={entry.comment.short} /> : CLASS_INFO[entry.moveClass].name.toLowerCase()}
                      onClick={() => state.go(index + 1)}
                    />
                  )
                })}
              </div>
            </section>
            <CurrentComment />
          </>
        ) : (
          <>
            <CurrentComment />
            <section className="panel moves-panel">
              <h2>{ru.review.moves}</h2>
              <MoveList moves={parsed.moves} reviews={review?.moves ?? []} cursor={cursor} onSelect={state.go} />
            </section>
            <section className="panel">
              <h2>{userColor ? ru.review.yourMistakes : 'Ошибки'}</h2>
              <div className="mistake-list">
                {userMistakes.length ? (
                  userMistakes.map((entry) => (
                    <MistakeItem
                      key={entry.index}
                      entry={entry}
                      label={label(entry.index)}
                      extra={entry.comment?.short.length ? <InlineParagraph paragraph={entry.comment.short} /> : null}
                      onClick={() => state.go(entry.index + 1)}
                    />
                  ))
                ) : (
                  <p className="muted">{review?.complete ? ru.review.noMistakes : ru.common.loading}</p>
                )}
              </div>
            </section>
            {userColor && (
              <section className="panel">
                <h2>{ru.review.opponentMistakes}</h2>
                <div className="mistake-list">
                  {opponentMistakes.length ? (
                    opponentMistakes.map((entry) => {
                      const reply = review?.moves[entry.index + 1]
                      const bestReply = reply?.comment?.bestSan
                      const extra = !reply
                        ? null
                        : reply.isBest || reply.moveClass === 'excellent'
                          ? 'вы наказали'
                          : BAD_CLASSES.includes(reply.moveClass)
                            ? `упущено: ${displaySan(bestReply, settings.notation)}`
                            : `точнее было ${displaySan(bestReply, settings.notation)}`
                      return <MistakeItem key={entry.index} entry={entry} label={label(entry.index)} extra={extra} onClick={() => state.go(entry.index + 1)} />
                    })
                  ) : (
                    <p className="muted">{review?.complete ? ru.review.opponentClean : ru.common.loading}</p>
                  )}
                </div>
              </section>
            )}
          </>
        )}
        {settings.coachEnabled && review?.complete && <CoachPanel />}
        <div className="legend">
          {CARD_CLASSES.map((moveClass) => (
            <span key={moveClass}>
              <ClassIcon moveClass={moveClass} size={14} /> {CLASS_INFO[moveClass].name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function CurrentComment(): React.JSX.Element {
  const { parsed, review, cursor } = useReview()
  const notation = useSettings((store) => store.settings.notation)
  if (!parsed) return <></>
  if (cursor === 0) {
    return (
      <section className="panel comment-panel">
        <div className="label">{ru.review.startPosition}</div>
        <p>{ru.review.startHint}</p>
      </section>
    )
  }
  const entry = review?.moves[cursor - 1]
  const move = parsed.moves[cursor - 1]
  if (!entry || !entry.comment) {
    return (
      <section className="panel comment-panel">
        <span className="mono">{moveLabel(move.fenBefore, move.san, notation)}</span>
        <p className="muted">{ru.review.analyzingMove}</p>
      </section>
    )
  }
  return (
    <section className="panel comment-panel">
      <div className="comment-head">
        <ClassBadge moveClass={entry.moveClass} />
        <span className="mono">{moveLabel(move.fenBefore, move.san, notation)}</span>
        {entry.secondsSpent !== null && <span className="muted small">{entry.secondsSpent.toFixed(1)} с на ход</span>}
      </div>
      {entry.comment.paragraphs.map((paragraph, index) => (
        <ParagraphView key={index} paragraph={paragraph} />
      ))}
    </section>
  )
}

function RetryPanel(): React.JSX.Element {
  const { retry, parsed, review, userColor, endRetry, startRetry } = useReview()
  const notation = useSettings((store) => store.settings.notation)
  if (!retry || !parsed) return <></>
  const nextTarget = review?.moves.find(
    (entry) => entry && entry.index > retry.index && SERIOUS_CLASSES.includes(entry.moveClass) && (!userColor || entry.color === userColor)
  )
  const move = parsed.moves[retry.index]
  const message =
    retry.message === 'solved'
      ? ru.review.retrySolved
      : retry.message === 'good'
        ? ru.review.retryGood
        : retry.hint
          ? ru.review.retryHint
          : retry.message === 'wrong'
            ? ru.review.retryWrong
            : null
  return (
    <section className="panel retry-panel">
      <h2>{ru.review.retryTitle}</h2>
      <p>
        В партии было сыграно <b className="mono">{moveLabel(move.fenBefore, move.san, notation)}</b>. Найдите ход сильнее.
      </p>
      {!retry.solved && !retry.hint && <p className="muted">{ru.review.retryAttempts(retry.attemptsLeft)}</p>}
      {message && <p className={retry.solved ? 'success-text' : retry.hint ? '' : 'error-text'}>{message}</p>}
      <div className="row">
        <button className="text-button" onClick={endRetry}>{ru.review.retryExit}</button>
        {nextTarget && (
          <button className="text-button" onClick={() => startRetry(nextTarget.index)}>
            Следующая ошибка
          </button>
        )}
      </div>
    </section>
  )
}

function RecentGames(): React.JSX.Element {
  const [games, setGames] = useState<StoredGame[]>([])
  const openStored = useReview((store) => store.openStored)
  useEffect(() => {
    void window.api.db.listGames(12).then(setGames)
  }, [])
  if (!games.length) return <></>
  return (
    <div className="recent-games">
      <div className="label">{ru.import.library}</div>
      {games.map((game) => (
        <button key={game.id} className="recent-game" onClick={() => void openStored(game)}>
          <span>
            {game.white} — {game.black}
          </span>
          <span className="muted small">{game.result}</span>
          <span className="muted small">{game.openingName ?? ''}</span>
        </button>
      ))}
    </div>
  )
}
