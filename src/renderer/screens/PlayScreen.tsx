import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import type { Color } from '@shared/types'
import { Board, type BoardMove } from '../board/Board'
import { playSound, soundForSan } from '../board/sounds'
import { displaySan } from '../analysis/notation'
import { storedFromPgn } from '../analysis/games'
import { BOT_LEVELS, botLevel, formatClock, TIME_CONTROLS, type TimeControl } from '../play/levels'
import { useApp } from '../store/app'
import { useReview } from '../store/review'
import { useSettings } from '../store/settings'

type ColorChoice = 'w' | 'b' | 'random'
type Phase = 'setup' | 'playing' | 'over'

interface GameState {
  id: number
  board: Chess
  userColor: Color
  level: number
  control: TimeControl
  startedAt: number
}

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

function outcome(board: Chess): { result: string; reason: string } | null {
  if (board.isCheckmate()) return { result: board.turn() === 'w' ? '0-1' : '1-0', reason: 'мат' }
  if (board.isStalemate()) return { result: '1/2-1/2', reason: 'пат' }
  if (board.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'недостаточно материала' }
  if (board.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'троекратное повторение' }
  if (board.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'правило 50 ходов' }
  return null
}

export function PlayScreen(): React.JSX.Element {
  const settings = useSettings((state) => state.settings)
  const setScreen = useApp((state) => state.setScreen)
  const toast = useApp((state) => state.toast)
  const [level, setLevel] = useState(() => Number(load('play.level', '5')))
  const [colorChoice, setColorChoice] = useState<ColorChoice>(() => load('play.color', 'w') as ColorChoice)
  const [controlId, setControlId] = useState(() => load('play.control', 'none'))
  const [phase, setPhase] = useState<Phase>('setup')
  const [game, setGame] = useState<GameState | null>(null)
  const [fen, setFen] = useState(new Chess().fen())
  const [sans, setSans] = useState<string[]>([])
  const [lastMove, setLastMove] = useState<[string, string] | null>(null)
  const [thinking, setThinking] = useState(false)
  const [result, setResult] = useState<{ result: string; reason: string } | null>(null)
  const [hintShape, setHintShape] = useState<DrawShape | null>(null)
  const [hints, setHints] = useState(0)
  const [takebacks, setTakebacks] = useState(0)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  const [clocks, setClocks] = useState<Record<Color, number>>({ w: 0, b: 0 })
  const clockRef = useRef<{ running: Color | null; since: number; left: Record<Color, number> }>({ running: null, since: 0, left: { w: 0, b: 0 } })
  const gameRef = useRef<GameState | null>(null)
  gameRef.current = game

  useEffect(() => {
    save('play.level', String(level))
    save('play.color', colorChoice)
    save('play.control', controlId)
  }, [level, colorChoice, controlId])

  const finish = (value: { result: string; reason: string }): void => {
    clockRef.current.running = null
    setResult(value)
    setPhase('over')
    setThinking(false)
    playSound('gameEnd', settings)
  }

  const syncBoard = (board: Chess): void => {
    setFen(board.fen())
    const history = board.history({ verbose: true })
    setSans(history.map((move) => move.san))
    const last = history[history.length - 1]
    setLastMove(last ? [last.from, last.to] : null)
  }

  const switchClock = (state: GameState, mover: Color): void => {
    if (!state.control.baseSeconds) return
    const clock = clockRef.current
    const now = Date.now()
    if (clock.running) clock.left[clock.running] -= now - clock.since
    clock.left[mover] += state.control.incrementSeconds * 1000
    clock.running = mover === 'w' ? 'b' : 'w'
    clock.since = now
    setClocks({ ...clock.left })
  }

  const afterMove = (state: GameState, san: string, mover: Color): boolean => {
    syncBoard(state.board)
    playSound(soundForSan(san, false), settings)
    switchClock(state, mover)
    const over = outcome(state.board)
    if (over) {
      finish(over)
      return true
    }
    return false
  }

  const botTurn = async (state: GameState): Promise<void> => {
    setThinking(true)
    const started = Date.now()
    const uci = await window.api.bot.move(state.board.fen(), state.level).catch((error: Error) => {
      toast(error.message, 'error')
      return null
    })
    const wait = Math.max(0, 350 - (Date.now() - started))
    await new Promise((resolve) => setTimeout(resolve, wait))
    if (gameRef.current?.id !== state.id || !uci) {
      setThinking(false)
      return
    }
    const move = state.board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    setThinking(false)
    afterMove(state, move.san, move.color)
  }

  const startGame = async (): Promise<void> => {
    const userColor: Color = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice
    const control = TIME_CONTROLS.find((entry) => entry.id === controlId) ?? TIME_CONTROLS[0]
    const state: GameState = { id: Date.now(), board: new Chess(), userColor, level, control, startedAt: Date.now() }
    clockRef.current = { running: control.baseSeconds ? 'w' : null, since: Date.now(), left: { w: control.baseSeconds * 1000, b: control.baseSeconds * 1000 } }
    setClocks({ ...clockRef.current.left })
    setGame(state)
    gameRef.current = state
    setResult(null)
    setHints(0)
    setTakebacks(0)
    setHintShape(null)
    setOrientation(userColor === 'w' ? 'white' : 'black')
    syncBoard(state.board)
    setPhase('playing')
    await window.api.bot.newGame().catch(() => undefined)
    if (userColor === 'b') void botTurn(state)
  }

  useEffect(() => {
    if (phase !== 'playing' || !game?.control.baseSeconds) return
    const timer = setInterval(() => {
      const clock = clockRef.current
      if (!clock.running) return
      const left = { ...clock.left }
      left[clock.running] -= Date.now() - clock.since
      setClocks(left)
      if (left[clock.running] <= 0) {
        const loser = clock.running
        const board = gameRef.current?.board
        const winnerCanMate = board ? !new Chess(board.fen()).isInsufficientMaterial() : true
        finish({ result: winnerCanMate ? (loser === 'w' ? '0-1' : '1-0') : '1/2-1/2', reason: 'время' })
      }
    }, 200)
    return () => clearInterval(timer)
  }, [phase, game?.id])

  const onMove = (move: BoardMove): void => {
    const state = gameRef.current
    if (!state || phase !== 'playing' || thinking || state.board.turn() !== state.userColor) return
    let played
    try {
      played = state.board.move({ from: move.from, to: move.to, promotion: move.promotion })
    } catch {
      return
    }
    setHintShape(null)
    if (afterMove(state, played.san, played.color)) return
    void botTurn(state)
  }

  const takeback = (): void => {
    const state = gameRef.current
    if (!state || phase !== 'playing' || thinking) return
    const history = state.board.history()
    if (!history.length) return
    state.board.undo()
    if (state.board.turn() !== state.userColor && state.board.history().length) state.board.undo()
    if (state.board.turn() !== state.userColor) {
      syncBoard(state.board)
      void botTurn(state)
      return
    }
    setTakebacks((value) => value + 1)
    setHintShape(null)
    syncBoard(state.board)
  }

  const hint = async (): Promise<void> => {
    const state = gameRef.current
    if (!state || phase !== 'playing' || thinking) return
    const analysis = await window.api.engine.analyzePosition(state.board.fen(), { depth: 14, movetimeMs: null, multiPv: 1 })
    const best = analysis.lines[0]?.pv[0]
    if (!best) return
    setHints((value) => value + 1)
    setHintShape({ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'hint' })
  }

  const offerDraw = async (): Promise<void> => {
    const state = gameRef.current
    if (!state || phase !== 'playing' || thinking) return
    const analysis = await window.api.engine.analyzePosition(state.board.fen(), { depth: 12, movetimeMs: null, multiPv: 1 })
    const score = analysis.lines[0]?.score
    const botColor: Color = state.userColor === 'w' ? 'b' : 'w'
    const botCp = !score ? 0 : score.type === 'mate' ? (score.winner === botColor ? 10000 : -10000) : botColor === 'w' ? score.cp : -score.cp
    if (state.board.history().length >= 20 && botCp <= 30) finish({ result: '1/2-1/2', reason: 'ничья по соглашению' })
    else toast('Бот отклонил ничью', 'info')
  }

  const resign = (): void => {
    const state = gameRef.current
    if (!state || phase !== 'playing') return
    finish({ result: state.userColor === 'w' ? '0-1' : '1-0', reason: 'вы сдались' })
  }

  const analyzeGame = async (): Promise<void> => {
    const state = gameRef.current
    if (!state || !result) return
    const bot = botLevel(state.level)
    const you = settings.chesscomUsername || 'Вы'
    const botName = `Stockfish, уровень ${bot.level}`
    const date = new Date(state.startedAt)
    const pgnBoard = new Chess()
    for (const san of state.board.history()) pgnBoard.move(san)
    pgnBoard.setHeader('Event', 'Игра с ботом')
    pgnBoard.setHeader('Site', 'Разбор партий')
    pgnBoard.setHeader('Date', `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`)
    pgnBoard.setHeader('White', state.userColor === 'w' ? you : botName)
    pgnBoard.setHeader('Black', state.userColor === 'b' ? you : botName)
    pgnBoard.setHeader('WhiteElo', state.userColor === 'w' ? '?' : String(bot.elo))
    pgnBoard.setHeader('BlackElo', state.userColor === 'b' ? '?' : String(bot.elo))
    pgnBoard.setHeader('Result', result.result)
    pgnBoard.setHeader('Termination', result.reason)
    if (state.control.baseSeconds) pgnBoard.setHeader('TimeControl', `${state.control.baseSeconds}+${state.control.incrementSeconds}`)
    const pgn = pgnBoard.pgn()
    const stored = { ...storedFromPgn(pgn, settings.chesscomUsername, state.userColor), source: 'bot' as const, endTime: Date.now() }
    await window.api.db.saveGame(stored)
    setScreen('review')
    await useReview.getState().openStored(stored)
    void useReview.getState().startAnalysis()
  }

  const movePairs = useMemo(() => {
    const pairs: Array<[number, string, string | undefined]> = []
    for (let index = 0; index < sans.length; index += 2) pairs.push([index / 2 + 1, sans[index], sans[index + 1]])
    return pairs
  }, [sans])

  const current = botLevel(level)
  const botClockColor: Color = game?.userColor === 'w' ? 'b' : 'w'
  const userClockColor: Color = game?.userColor ?? 'w'
  const resultText = result
    ? `${result.result === '1/2-1/2' ? 'Ничья' : (result.result === '1-0') === (game?.userColor === 'w') ? 'Вы победили' : 'Победил бот'} — ${result.reason}`
    : null

  return (
    <div className="screen play-screen">
      <div className="play-board">
        {game?.control.baseSeconds ? <div className={`clock ${clockRef.current.running === botClockColor ? 'running' : ''}`}>{formatClock(clocks[botClockColor])}</div> : null}
        <Board
          fen={fen}
          orientation={orientation}
          lastMove={lastMove}
          interactive={phase === 'playing' && !thinking}
          movableColor={game?.userColor === 'b' ? 'black' : 'white'}
          onMove={onMove}
          autoShapes={hintShape ? [hintShape] : []}
          maxSize={640}
        />
        {game?.control.baseSeconds ? <div className={`clock ${clockRef.current.running === userClockColor ? 'running' : ''}`}>{formatClock(clocks[userClockColor])}</div> : null}
      </div>

      <section className="panel play-panel">
        {phase === 'setup' ? (
          <>
            <h1>Игра с ботом</h1>
            <p className="muted">Stockfish с 20 уровнями силы. Рейтинг уровней примерный.</p>
            <div className="level-grid">
              {BOT_LEVELS.map((entry) => (
                <button key={entry.level} className={`level-button ${entry.level === level ? 'active' : ''}`} onClick={() => setLevel(entry.level)} title={`${entry.name}, примерно ${entry.elo}`}>
                  <b>{entry.level}</b>
                  <span className="small muted">~{entry.elo}</span>
                </button>
              ))}
            </div>
            <p>
              Уровень {current.level}: <b>{current.name}</b>, примерно {current.elo} Эло.
            </p>
            <div className="row wrap">
              <span className="muted small">Цвет</span>
              <div className="segmented">
                {(['w', 'random', 'b'] as ColorChoice[]).map((choice) => (
                  <button key={choice} className={colorChoice === choice ? 'active' : ''} onClick={() => setColorChoice(choice)}>
                    {choice === 'w' ? 'Белые' : choice === 'b' ? 'Чёрные' : 'Случайно'}
                  </button>
                ))}
              </div>
            </div>
            <div className="row wrap">
              <span className="muted small">Контроль</span>
              <div className="segmented wrap">
                {TIME_CONTROLS.map((entry) => (
                  <button key={entry.id} className={controlId === entry.id ? 'active' : ''} onClick={() => setControlId(entry.id)}>
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <button className="primary-button" onClick={() => void startGame()}>
              Начать партию
            </button>
          </>
        ) : (
          <>
            <h2>
              Уровень {game?.level} · {botLevel(game?.level ?? 1).name}
            </h2>
            <p className="muted small">
              Вы играете {game?.userColor === 'w' ? 'белыми' : 'чёрными'}
              {hints ? ` · подсказок: ${hints}` : ''}
              {takebacks ? ` · ходов назад: ${takebacks}` : ''}
            </p>
            {thinking && <p className="muted">Бот думает…</p>}
            {resultText && <p className={result?.result === '1/2-1/2' ? '' : resultText.startsWith('Вы') ? 'success-text' : 'error-text'}>{resultText}</p>}
            {movePairs.length > 0 && (
            <div className="move-list play-moves">
              {movePairs.map(([number, white, black]) => (
                <div key={number} className="move-pair">
                  <span className="muted mono">{number}.</span>
                  <span className="mono">{displaySan(white, settings.notation)}</span>
                  <span className="mono">{black ? displaySan(black, settings.notation) : ''}</span>
                </div>
              ))}
            </div>
            )}
            {phase === 'playing' ? (
              <div className="row wrap">
                <button className="text-button" onClick={() => void hint()} disabled={thinking}>
                  Подсказка
                </button>
                <button className="text-button" onClick={takeback} disabled={thinking || !sans.length}>
                  Ход назад
                </button>
                <button className="text-button" onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}>
                  Перевернуть
                </button>
                <button className="text-button" onClick={() => void offerDraw()} disabled={thinking}>
                  Предложить ничью
                </button>
                <button className="text-button danger" onClick={resign}>
                  Сдаться
                </button>
              </div>
            ) : (
              <div className="row wrap">
                <button className="primary-button" onClick={() => void analyzeGame()}>
                  Разобрать партию
                </button>
                <button className="text-button" onClick={() => void startGame()}>
                  Реванш
                </button>
                <button className="text-button" onClick={() => setPhase('setup')}>
                  Другие настройки
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
