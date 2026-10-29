import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import type { TrainerCard } from '@shared/types'
import { Board, type BoardMove } from '../board/Board'
import { playSound, soundForSan } from '../board/sounds'
import { applyUciLine } from '../analysis/pgn'
import { displaySan, pluralRu } from '../analysis/notation'
import { guideFor } from '../openings/guides'
import { useOpenings } from '../openings/store'
import { translateOpeningName } from '../openings/translate'
import { dueCards, qualityFromAttempts, reviewCard } from '../trainer/srs'
import { THEME_LABELS, type MistakePayload } from '../trainer/mistakeCards'
import { ensureOpeningCard, useTrainer, type OpeningPayload } from '../store/trainer'
import { ru } from '../i18n/ru'
import { useApp } from '../store/app'
import { useReview } from '../store/review'
import { useSettings } from '../store/settings'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function formatDue(dueAt: number): string {
  const diff = dueAt - Date.now()
  if (diff <= 0) return 'сейчас'
  const minutes = Math.ceil(diff / 60_000)
  if (minutes < 60) return `через ${minutes} ${pluralRu(minutes, 'минуту', 'минуты', 'минут')}`
  const due = new Date(dueAt)
  const today = new Date()
  const dayDiff = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
  if (dayDiff <= 0) return `сегодня в ${due.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
  if (dayDiff === 1) return 'завтра'
  if (dayDiff === 2) return 'послезавтра'
  return `через ${dayDiff} ${pluralRu(dayDiff, 'день', 'дня', 'дней')}`
}

function dueLabel(dueAt: number): string {
  return dueAt <= Date.now() ? 'Пора повторить' : `Повторить ${formatDue(dueAt)}`
}

function OpeningDrill({ card, onDone }: { card: TrainerCard; onDone: (updated: TrainerCard) => void }): React.JSX.Element {
  const payload = JSON.parse(card.payload) as OpeningPayload
  const settings = useSettings((state) => state.settings)
  const guides = useOpenings((state) => state.guides)
  const book = useOpenings((state) => state.book)
  const { fens, sans } = useMemo(() => {
    const result = applyUciLine(START_FEN, payload.uci)
    return { fens: [START_FEN, ...result.fens], sans: result.sans }
  }, [card.id])
  const userIsWhite = payload.color === 'w'
  const [ply, setPly] = useState(0)
  const [mistakes, setMistakes] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const guide = useMemo(() => guideFor(guides, { eco: payload.eco, name: payload.name }), [guides, payload.eco, payload.name])
  const userTurn = (index: number): boolean => (index % 2 === 0) === userIsWhite

  useEffect(() => {
    if (finished) return
    if (ply >= payload.uci.length) {
      setFinished(true)
      const updated = reviewCard(card, qualityFromAttempts(mistakes, false))
      void window.api.db.upsertCard(updated).then(() => onDone(updated))
      playSound('gameEnd', settings)
      return
    }
    if (!userTurn(ply) && !hint) {
      const timer = setTimeout(() => {
        playSound(soundForSan(sans[ply], false), settings)
        setPly((value) => value + 1)
      }, 550)
      return () => clearTimeout(timer)
    }
  }, [ply, hint, finished])

  const onMove = (move: BoardMove): void => {
    if (finished || !userTurn(ply) || hint) return
    const uci = move.from + move.to + (move.promotion ?? '')
    const expected = payload.uci[ply]
    if (uci === expected) {
      playSound(soundForSan(sans[ply], false), settings)
      setMessage(ru.trainer.correct)
      setPly((value) => value + 1)
      return
    }
    const resulting = applyUciLine(fens[ply], [uci]).fens[0]
    if (resulting && book?.isBookPosition(resulting)) {
      setMessage('Это тоже теория, но в этом варианте играют другой ход. Попробуйте ещё раз.')
      return
    }
    setMistakes((value) => value + 1)
    setHint(expected)
    const explanation = guide?.nuances[ply % Math.max(1, guide.nuances.length)] ?? guide?.idea ?? null
    setMessage(`${ru.trainer.wrong}${explanation ? ` ${explanation}` : ''}`)
  }

  const shapes: DrawShape[] = hint ? [{ orig: hint.slice(0, 2) as Key, dest: hint.slice(2, 4) as Key, brush: 'hint' }] : []
  const lastMove = ply > 0 ? ([payload.uci[ply - 1].slice(0, 2), payload.uci[ply - 1].slice(2, 4)] as [string, string]) : null

  return (
    <div className="trainer-layout">
      <Board fen={fens[ply]} orientation={userIsWhite ? 'white' : 'black'} lastMove={lastMove} interactive={!finished && userTurn(ply) && !hint} movableColor={userIsWhite ? 'white' : 'black'} onMove={onMove} autoShapes={shapes} maxSize={600} />
      <section className="panel">
        <div className="row">
          <span className="eco mono">{payload.eco}</span>
          <b>{translateOpeningName(payload.name)}</b>
        </div>
        <p className="muted">
          Вы играете {userIsWhite ? 'белыми' : 'чёрными'}. {finished ? ru.trainer.finished : userTurn(ply) ? ru.trainer.findBook : 'Ход соперника…'}
        </p>
        <p className="mono small">
          {sans.slice(0, ply).map((san, index) => `${index % 2 === 0 ? `${index / 2 + 1}. ` : ''}${displaySan(san, settings.notation)}`).join(' ')}
        </p>
        {message && <p className={hint ? 'error-text' : 'success-text'}>{message}</p>}
        {hint && (
          <button
            className="primary-button small"
            onClick={() => {
              setHint(null)
              setMessage(null)
              setPly((value) => value + 1)
            }}
          >
            {ru.trainer.next}
          </button>
        )}
        {finished && (
          <p>
            Ошибок: {mistakes}. Следующее повторение — {formatDue(reviewCard(card, qualityFromAttempts(mistakes, false)).dueAt)}.
          </p>
        )}
      </section>
    </div>
  )
}

function MistakeDrill({ card, onDone }: { card: TrainerCard; onDone: (updated: TrainerCard) => void }): React.JSX.Element {
  const payload = JSON.parse(card.payload) as MistakePayload
  const settings = useSettings((state) => state.settings)
  const setScreen = useApp((state) => state.setScreen)
  const openStored = useReview((state) => state.openStored)
  const [attempts, setAttempts] = useState(3)
  const [solved, setSolved] = useState(false)
  const [hint, setHint] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fen, setFen] = useState(payload.fen)
  const color = payload.fen.split(' ')[1] === 'b' ? 'black' : 'white'

  const finish = useCallback(
    (quality: number) => {
      const updated = reviewCard(card, quality)
      void window.api.db.upsertCard(updated).then(() => onDone(updated))
    },
    [card, onDone]
  )

  const onMove = (move: BoardMove): void => {
    if (solved) return
    const uci = move.from + move.to + (move.promotion ?? '')
    const result = applyUciLine(payload.fen, [uci])
    if (uci === payload.bestUci || payload.acceptable.includes(uci)) {
      setFen(result.fens[0] ?? payload.fen)
      setSolved(true)
      playSound(soundForSan(result.sans[0] ?? '', false), settings)
      setMessage(uci === payload.bestUci ? ru.review.retrySolved : ru.review.retryGood)
      finish(qualityFromAttempts(3 - attempts, hint))
      return
    }
    const left = attempts - 1
    setAttempts(left)
    if (left <= 0) {
      setHint(true)
      setMessage(ru.review.retryHint)
    } else setMessage(`${ru.review.retryWrong} ${ru.review.retryAttempts(left)}`)
  }

  const shapes: DrawShape[] = hint || solved ? [{ orig: payload.bestUci.slice(0, 2) as Key, dest: payload.bestUci.slice(2, 4) as Key, brush: 'hint' }] : []

  return (
    <div className="trainer-layout">
      <Board fen={fen} orientation={color} interactive={!solved} onMove={onMove} autoShapes={shapes} maxSize={600} />
      <section className="panel">
        <h2>{ru.trainer.findBest}</h2>
        <p className="muted">
          {payload.title}, ход {Math.ceil(payload.ply / 2)}. Ходят {color === 'white' ? 'белые' : 'чёрные'}.
        </p>
        {card.theme && <p className="small">Тема: {THEME_LABELS[card.theme] ?? card.theme}</p>}
        {message && <p className={solved ? 'success-text' : hint ? '' : 'error-text'}>{message}</p>}
        {(solved || hint) && (
          <p>
            В партии было сыграно <b className="mono">{displaySan(payload.playedSan, settings.notation)}</b> (−{payload.loss}%), лучше{' '}
            <b className="mono">{displaySan(payload.bestSan, settings.notation)}</b>.
          </p>
        )}
        <div className="row">
          {hint && !solved && (
            <button className="primary-button small" onClick={() => finish(1)}>
              {ru.trainer.next}
            </button>
          )}
          <button
            className="text-button"
            onClick={async () => {
              const game = await window.api.db.getGame(payload.gameId)
              if (!game) return
              setScreen('review')
              await openStored(game)
              useReview.getState().go(payload.ply)
            }}
          >
            Открыть партию
          </button>
        </div>
      </section>
    </div>
  )
}

export function TrainerScreen(): React.JSX.Element {
  const { activeCard, tab, setTab, startCard, clear } = useTrainer()
  const book = useOpenings((state) => state.book)
  const load = useOpenings((state) => state.load)
  const [cards, setCards] = useState<TrainerCard[]>([])
  const [lastResult, setLastResult] = useState<string | null>(null)

  const refresh = async (): Promise<void> => setCards(await window.api.db.listCards(null))

  useEffect(() => {
    void load()
    void refresh()
  }, [activeCard])

  const kind = tab === 'openings' ? 'opening' : 'mistake'
  const ofKind = cards.filter((card) => card.kind === kind)
  const due = dueCards(ofKind)

  const themeStats = useMemo(() => {
    const stats = new Map<string, { total: number; reviewed: number; lapses: number }>()
    for (const card of cards.filter((entry) => entry.kind === 'mistake')) {
      const key = card.theme ?? 'other'
      const entry = stats.get(key) ?? { total: 0, reviewed: 0, lapses: 0 }
      entry.total += 1
      entry.reviewed += card.repetitions + card.lapses > 0 ? 1 : 0
      entry.lapses += card.lapses
      stats.set(key, entry)
    }
    return [...stats.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [cards])

  const addRepertoire = async (): Promise<void> => {
    if (!book) return
    const entries = await window.api.db.listRepertoire()
    for (const entry of entries) {
      const opening = book.byId.get(entry.openingId)
      if (opening) await ensureOpeningCard(opening, entry.color)
    }
    await refresh()
  }

  const onDone = (updated: TrainerCard): void => {
    setLastResult(`Готово. Эта карточка вернётся ${formatDue(updated.dueAt)}.`)
    void refresh()
  }

  return (
    <div className="screen trainer-screen">
      <div className="row">
        <h1>{ru.nav.trainer}</h1>
        <span className="spacer" />
        <div className="segmented">
          <button className={tab === 'openings' ? 'active' : ''} onClick={() => setTab('openings')}>
            {ru.trainer.openings}
          </button>
          <button className={tab === 'mistakes' ? 'active' : ''} onClick={() => setTab('mistakes')}>
            {ru.trainer.mistakes}
          </button>
        </div>
      </div>
      {activeCard ? (
        <>
          <div className="row">
            <button
              className="text-button"
              onClick={() => {
                clear()
                setLastResult(null)
              }}
            >
              ← К списку
            </button>
            {due.filter((card) => card.id !== activeCard.id).length > 0 && (
              <button className="primary-button small" onClick={() => startCard(due.filter((card) => card.id !== activeCard.id)[0])}>
                Следующая карточка
              </button>
            )}
            {lastResult && <span className="muted small">{lastResult}</span>}
          </div>
          {activeCard.kind === 'opening' ? <OpeningDrill key={activeCard.id} card={activeCard} onDone={onDone} /> : <MistakeDrill key={activeCard.id} card={activeCard} onDone={onDone} />}
        </>
      ) : (
        <>
          <section className="panel">
            <div className="row">
              <b>{ru.trainer.due(due.length)}</b>
              <span className="muted small">Всего карточек: {ofKind.length}</span>
              <span className="spacer" />
              {tab === 'openings' && (
                <button className="text-button" onClick={() => void addRepertoire()}>
                  Добавить весь репертуар
                </button>
              )}
              <button className="primary-button" disabled={!due.length} onClick={() => startCard(due[0])}>
                {ru.trainer.start}
              </button>
            </div>
            <p className="muted small">
              Решённая карточка на время прячется и возвращается для повторения: сначала на следующий день, потом через 6 дней, потом всё реже. Если ошиблись — вернётся раньше. Справа у каждой карточки написано, когда её повторить; решить можно и раньше кнопкой «{ru.trainer.start}».
            </p>
          </section>
          {tab === 'mistakes' && themeStats.length > 0 && (
            <section className="panel">
              <h2>{ru.trainer.themes}</h2>
              {themeStats.map(([theme, stat]) => (
                <div key={theme} className="bar-row">
                  <span>{THEME_LABELS[theme] ?? theme}</span>
                  <div className="bar-track">
                    <div className="bar" style={{ width: `${(stat.total / themeStats[0][1].total) * 100}%` }} />
                  </div>
                  <span className="mono small">
                    {stat.total} · ✕{stat.lapses}
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="panel">
            <div className="card-list">
              {ofKind.length === 0 && <p className="muted">{tab === 'openings' ? ru.trainer.pickVariation : ru.trainer.emptyMistakes}</p>}
              {ofKind.map((card) => {
                const title =
                  card.kind === 'opening'
                    ? (() => {
                        const payload = JSON.parse(card.payload) as OpeningPayload
                        return `${payload.eco} ${translateOpeningName(payload.name)} · ${payload.color === 'w' ? 'белыми' : 'чёрными'}`
                      })()
                    : (() => {
                        const payload = JSON.parse(card.payload) as MistakePayload
                        return `${payload.title}, ход ${Math.ceil(payload.ply / 2)} · ${THEME_LABELS[card.theme ?? 'other'] ?? ''}`
                      })()
                return (
                  <div key={card.id} className="mistake-item" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto auto' }}>
                    <span className="mistake-text">{title}</span>
                    <span className="muted small" title="Когда карточку пора повторить. Решить её можно и раньше.">{dueLabel(card.dueAt)}</span>
                    <button className="text-button" onClick={() => startCard(card)}>
                      {ru.trainer.start}
                    </button>
                    <button
                      className="text-button"
                      onClick={async () => {
                        await window.api.db.deleteCard(card.id)
                        await refresh()
                      }}
                    >
                      {ru.common.delete}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
