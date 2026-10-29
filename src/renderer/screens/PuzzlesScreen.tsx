import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import type { PuzzleCatalog, PuzzleCategoryInfo } from '@shared/api'
import { Board, type BoardMove } from '../board/Board'
import { playSound, soundForSan } from '../board/sounds'
import { pluralRu } from '../analysis/notation'
import {
  checkPuzzleMove,
  PUZZLE_GROUP_LABELS,
  puzzleStartFen,
  solutionMoves,
  solverColor,
  THEME_NAMES,
  type PuzzleDifficulty,
  type PuzzleGroup,
  type PuzzleRecord
} from '../puzzles/catalog'
import { useApp } from '../store/app'
import { useSettings } from '../store/settings'

type Status = 'loading' | 'play' | 'wrong' | 'solved' | 'shown' | 'empty'

const DIFFICULTY_LABELS: Record<PuzzleDifficulty, string> = {
  any: 'Любые',
  easier: 'Легче',
  normal: 'Мой уровень',
  harder: 'Сложнее'
}

const CATEGORY_STORAGE = 'puzzles.category'
const DIFFICULTY_STORAGE = 'puzzles.difficulty'

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

function applyUci(fen: string, uci: string): { fen: string; san: string } | null {
  try {
    const board = new Chess(fen)
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return { fen: board.fen(), san: move.san }
  } catch {
    return null
  }
}

function taskTitle(puzzle: PuzzleRecord): string {
  const side = solverColor(puzzle) === 'w' ? 'белых' : 'чёрных'
  if (puzzle.goal) return puzzle.goal
  const mate = puzzle.themes.find((theme) => /^mateIn\d$/.test(theme))
  if (mate) {
    const moves = Number(mate.slice(6))
    return `Ход ${side}. Мат в ${moves}${moves >= 5 ? '+' : ''} ${pluralRu(moves, 'ход', 'хода', 'ходов')}`
  }
  if (puzzle.themes.includes('equality')) return `Ход ${side}. Найдите путь к уравнению`
  if (puzzle.themes.includes('defensiveMove')) return `Ход ${side}. Найдите защиту`
  return `Ход ${side}. Найдите лучшее продолжение`
}

export function PuzzlesScreen(): React.JSX.Element {
  const settings = useSettings((state) => state.settings)
  const openFreeAnalysis = useApp((state) => state.openFreeAnalysis)
  const [catalog, setCatalog] = useState<PuzzleCatalog | null>(null)
  const [categoryId, setCategoryId] = useState(() => readStorage(CATEGORY_STORAGE, 'mine'))
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>(() => readStorage(DIFFICULTY_STORAGE, 'normal') as PuzzleDifficulty)
  const [puzzle, setPuzzle] = useState<PuzzleRecord | null>(null)
  const [fen, setFen] = useState('8/8/8/8/8/8/8/8 w - - 0 1')
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<Status>('loading')
  const [lastMove, setLastMove] = useState<[string, string] | null>(null)
  const [hint, setHint] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [recorded, setRecorded] = useState(false)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const clearTimers = (): void => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const later = (fn: () => void, ms: number): void => {
    timers.current.push(setTimeout(fn, ms))
  }

  const refreshCatalog = useCallback(async () => setCatalog(await window.api.puzzles.catalog()), [])

  const category = catalog?.categories.find((entry) => entry.id === categoryId) ?? null
  const solution = useMemo(() => (puzzle ? solutionMoves(puzzle) : []), [puzzle])

  const record = async (solved: boolean): Promise<void> => {
    if (!puzzle || recorded) return
    setRecorded(true)
    const result = await window.api.puzzles.record(puzzle.id, solved)
    if (result.ratingChange !== 0) {
      const sign = result.ratingChange > 0 ? '+' : ''
      setMessage((current) => `${current ?? ''} Рейтинг решения: ${result.stats.rating} (${sign}${result.ratingChange}).`.trim())
    }
    await refreshCatalog()
  }

  const start = (next: PuzzleRecord | null): void => {
    clearTimers()
    setPuzzle(next)
    setHint(0)
    setMessage(null)
    setRecorded(false)
    setStep(0)
    if (!next) {
      setStatus('empty')
      return
    }
    setStatus('play')
    if (next.setupMove) {
      setFen(next.fen)
      setLastMove(null)
      later(() => {
        const setup = next.moves[0]
        const applied = applyUci(next.fen, setup)
        if (!applied) return
        setFen(puzzleStartFen(next))
        setLastMove([setup.slice(0, 2), setup.slice(2, 4)])
        playSound(soundForSan(applied.san, false), settings)
      }, 600)
    } else {
      setFen(next.fen)
      setLastMove(null)
    }
  }

  const loadNext = async (excludeCurrent = true): Promise<void> => {
    setStatus('loading')
    const next = await window.api.puzzles.next(categoryId, difficulty, excludeCurrent ? (puzzle?.id ?? null) : null)
    start(next)
  }

  useEffect(() => {
    void refreshCatalog()
    return clearTimers
  }, [])

  useEffect(() => {
    writeStorage(CATEGORY_STORAGE, categoryId)
    writeStorage(DIFFICULTY_STORAGE, difficulty)
    void loadNext(false)
  }, [categoryId, difficulty])

  const playOpponent = (afterFen: string, index: number): void => {
    const reply = solution[index]
    if (!reply) return
    later(() => {
      const applied = applyUci(afterFen, reply)
      if (!applied) return
      setFen(applied.fen)
      setLastMove([reply.slice(0, 2), reply.slice(2, 4)])
      setStep(index + 1)
      playSound(soundForSan(applied.san, false), settings)
    }, 450)
  }

  const onMove = (move: BoardMove): void => {
    if (!puzzle || (status !== 'play' && status !== 'wrong')) return
    const uci = move.from + move.to + (move.promotion ?? '')
    const verdict = checkPuzzleMove(fen, solution, step, uci)
    const applied = applyUci(fen, uci)
    if (!applied) return
    if (verdict === 'wrong') {
      setStatus('wrong')
      setMessage('Не тот ход. Попробуйте ещё раз, возьмите подсказку или посмотрите решение.')
      void record(false)
      return
    }
    setFen(applied.fen)
    setLastMove([move.from, move.to])
    playSound(soundForSan(applied.san, false), settings)
    setHint(0)
    if (verdict === 'solved') {
      setStatus('solved')
      setStep(solution.length)
      setMessage(hint > 0 || recorded ? 'Решено.' : 'Отлично, задача решена!')
      void record(hint === 0)
      return
    }
    setStatus('play')
    setMessage('Верно! Продолжайте.')
    setStep(step + 1)
    playOpponent(applied.fen, step + 1)
  }

  const showSolution = (): void => {
    if (!puzzle) return
    clearTimers()
    setStatus('shown')
    setMessage('Решение показано.')
    void record(false)
    let current = fen
    solution.slice(step).forEach((uci, offset) => {
      later(() => {
        const applied = applyUci(current, uci)
        if (!applied) return
        current = applied.fen
        setFen(applied.fen)
        setLastMove([uci.slice(0, 2), uci.slice(2, 4)])
        setStep(step + offset + 1)
        playSound(soundForSan(applied.san, false), settings)
      }, 700 * (offset + 1))
    })
  }

  const expected = solution[step]
  const shapes: DrawShape[] = []
  const highlights = new Map<string, string>()
  if ((status === 'play' || status === 'wrong') && expected && hint >= 1) highlights.set(expected.slice(0, 2), 'hint-target')
  if ((status === 'play' || status === 'wrong') && expected && hint >= 2) shapes.push({ orig: expected.slice(0, 2) as Key, dest: expected.slice(2, 4) as Key, brush: 'hint' })

  const groups = useMemo(() => {
    const map = new Map<PuzzleGroup, PuzzleCategoryInfo[]>()
    for (const entry of catalog?.categories ?? []) {
      const list = map.get(entry.group) ?? []
      list.push(entry)
      map.set(entry.group, list)
    }
    return [...map.entries()]
  }, [catalog])

  const orientation = puzzle && solverColor(puzzle) === 'b' ? 'black' : 'white'
  const usesDifficulty = category && !['level', 'composition', 'mine'].includes(category.group)
  const stats = catalog?.stats

  return (
    <div className="screen puzzles-screen">
      <aside className="puzzle-categories">
        <h1>Задачи</h1>
        {stats && (
          <div className="puzzle-stats">
            <div>
              <span className="muted small">Рейтинг решения</span>
              <b className="mono">{stats.rating}</b>
            </div>
            <div>
              <span className="muted small">Решено</span>
              <b className="mono">{stats.solved}</b>
            </div>
            <div>
              <span className="muted small">Серия / лучшая</span>
              <b className="mono">
                {stats.streak} / {stats.bestStreak}
              </b>
            </div>
          </div>
        )}
        <div className="tree-scroll">
          {groups.map(([group, entries]) => (
            <div key={group} className="puzzle-group">
              <div className="puzzle-group-title">{PUZZLE_GROUP_LABELS[group]}</div>
              {entries.map((entry) => (
                <button key={entry.id} className={`tree-node ${entry.id === categoryId ? 'active' : ''}`} onClick={() => setCategoryId(entry.id)} title={entry.hint}>
                  <span className="tree-label">{entry.label}</span>
                  <span className="spacer" />
                  <span className="tree-eco">
                    {entry.solved}/{entry.total.toLocaleString('ru-RU')}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <div className="puzzle-board">
        <Board
          fen={fen}
          orientation={orientation}
          lastMove={lastMove}
          interactive={status === 'play' || status === 'wrong'}
          movableColor={orientation}
          onMove={onMove}
          autoShapes={shapes}
          highlights={highlights}
          maxSize={640}
          autoQueen={false}
        />
      </div>

      <section className="panel puzzle-panel">
        {status === 'empty' && <p className="muted">В этом разделе пока нет задач.</p>}
        {puzzle && (
          <>
            <h2>{taskTitle(puzzle)}</h2>
            {puzzle.title && (
              <p>
                <b>{puzzle.title}</b>
                <br />
                <span className="muted small">{puzzle.source}</span>
              </p>
            )}
            {category && <p className="muted small">Раздел: {category.label}</p>}
            {message && <p className={status === 'wrong' ? 'error-text' : status === 'solved' ? 'success-text' : ''}>{message}</p>}
            <div className="row wrap">
              {(status === 'play' || status === 'wrong') && (
                <>
                  <button className="text-button" onClick={() => setHint((value) => Math.min(2, value + 1))} disabled={hint >= 2}>
                    {hint === 0 ? 'Подсказка' : 'Ещё подсказка'}
                  </button>
                  <button className="text-button" onClick={showSolution}>
                    Показать решение
                  </button>
                </>
              )}
              {(status === 'solved' || status === 'shown') && (
                <>
                  <button className="primary-button" onClick={() => void loadNext()}>
                    Следующая задача
                  </button>
                  <button className="text-button" onClick={() => start(puzzle)}>
                    Решить ещё раз
                  </button>
                </>
              )}
              {(status === 'play' || status === 'wrong') && (
                <button className="text-button" onClick={() => void loadNext()}>
                  Пропустить
                </button>
              )}
              <button className="text-button" onClick={() => openFreeAnalysis(puzzleStartFen(puzzle))}>
                Открыть в анализе
              </button>
            </div>
            {(status === 'solved' || status === 'shown') && (
              <div className="puzzle-meta">
                <p className="small">
                  Рейтинг задачи: <b className="mono">{puzzle.rating}</b>
                </p>
                <div className="row wrap">
                  {puzzle.themes
                    .filter((theme) => THEME_NAMES[theme] && theme !== 'composition')
                    .map((theme) => (
                      <span key={theme} className="chip">
                        {THEME_NAMES[theme]}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
        {usesDifficulty && (
          <div className="puzzle-difficulty">
            <span className="muted small">Сложность</span>
            <div className="segmented">
              {(Object.keys(DIFFICULTY_LABELS) as PuzzleDifficulty[]).map((key) => (
                <button key={key} className={difficulty === key ? 'active' : ''} onClick={() => setDifficulty(key)}>
                  {DIFFICULTY_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="muted small">
          Задачи — из открытой базы lichess (CC0), композиции проверены Stockfish. Подсказка или просмотр решения засчитываются как неудача для рейтинга.
        </p>
      </section>
    </div>
  )
}
