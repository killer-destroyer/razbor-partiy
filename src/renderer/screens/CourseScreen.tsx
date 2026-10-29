import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { Board, type BoardMove } from '../board/Board'
import { playSound, soundForSan } from '../board/sounds'
import { displaySan } from '../analysis/notation'
import {
  COURSE,
  examPercent,
  learnerPlies,
  PASS_PERCENT,
  updateProgress,
  type CourseChapter,
  type CourseLine,
  type CourseProgress
} from '../course/course'
import { useSettings } from '../store/settings'

type Tab = 'theory' | 'lines' | 'practice' | 'exam'
const PROGRESS_KEY = 'course.progress'

interface DrillResult {
  correct: number
  total: number
  mistakes: Array<{ ply: number; expected: string; played: string }>
}

function moveLabel(ply: number): string {
  return `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}`
}

function LineViewer({ chapter }: { chapter: CourseChapter }): React.JSX.Element {
  const settings = useSettings((state) => state.settings)
  const [lineIndex, setLineIndex] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [autoplay, setAutoplay] = useState(false)
  const line = chapter.lines[lineIndex]

  useEffect(() => {
    setCursor(0)
    setAutoplay(false)
  }, [lineIndex, chapter.id])

  useEffect(() => {
    if (!autoplay) return
    const timer = setInterval(() => {
      setCursor((value) => {
        if (value >= line.sans.length) {
          setAutoplay(false)
          return value
        }
        return value + 1
      })
    }, 1300)
    return () => clearInterval(timer)
  }, [autoplay, line])

  useEffect(() => {
    if (cursor > 0) playSound(soundForSan(line.sans[cursor - 1], false), settings)
  }, [cursor])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') setCursor((value) => Math.max(0, value - 1))
      else if (event.key === 'ArrowRight') setCursor((value) => Math.min(line.sans.length, value + 1))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [line])

  const lastMove = cursor > 0 ? ([line.ucis[cursor - 1].slice(0, 2), line.ucis[cursor - 1].slice(2, 4)] as [string, string]) : null
  const note = cursor > 0 ? line.notes[cursor] : null

  return (
    <div className="course-drill">
      <Board fen={line.fens[cursor]} orientation={chapter.side === 'w' ? 'white' : 'black'} lastMove={lastMove} maxSize={560} />
      <div className="course-side">
        <div className="segmented wrap">
          {chapter.lines.map((entry, index) => (
            <button key={entry.name} className={index === lineIndex ? 'active' : ''} onClick={() => setLineIndex(index)}>
              {entry.name}
            </button>
          ))}
        </div>
        <div className="course-moves">
          {line.sans.map((san, index) => (
            <button key={index} className={`course-move ${index + 1 === cursor ? 'active' : ''} ${line.notes[index + 1] ? 'noted' : ''}`} onClick={() => setCursor(index + 1)}>
              {index % 2 === 0 && <span className="muted">{moveLabel(index)}</span>}
              {displaySan(san, settings.notation)}
            </button>
          ))}
        </div>
        <div className="course-note">{note ?? (cursor === 0 ? 'Нажимайте → или кнопку ▶︎, чтобы смотреть вариант по ходам. Ходы с пояснениями подчёркнуты.' : '')}</div>
        <div className="row">
          <button className="icon-button" onClick={() => setCursor(0)}>⏮</button>
          <button className="icon-button" onClick={() => setCursor((value) => Math.max(0, value - 1))}>‹</button>
          <button className={`icon-button ${autoplay ? 'active' : ''}`} onClick={() => setAutoplay((value) => !value)}>
            {autoplay ? '⏸' : '▶︎'}
          </button>
          <button className="icon-button" onClick={() => setCursor((value) => Math.min(line.sans.length, value + 1))}>›</button>
          <button className="icon-button" onClick={() => setCursor(line.sans.length)}>⏭</button>
        </div>
      </div>
    </div>
  )
}

function LineDrill({
  chapter,
  line,
  exam,
  onFinish
}: {
  chapter: CourseChapter
  line: CourseLine
  exam: boolean
  onFinish: (result: DrillResult) => void
}): React.JSX.Element {
  const settings = useSettings((state) => state.settings)
  const [ply, setPly] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [busy, setBusy] = useState(false)
  const result = useRef<DrillResult>({ correct: 0, total: 0, mistakes: [] })
  const failedHere = useRef(false)
  const plies = useMemo(() => learnerPlies(line, chapter.side), [line, chapter.side])
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const later = (fn: () => void, ms: number): void => {
    timers.current.push(setTimeout(fn, ms))
  }

  const advance = (from: number): void => {
    let next = from
    while (next < line.sans.length && !plies.includes(next)) {
      const index = next
      later(() => {
        setPly(index + 1)
        playSound(soundForSan(line.sans[index], false), settings)
      }, 450 * (index - from + 1))
      next += 1
    }
    const done = next >= line.sans.length
    later(() => {
      setBusy(false)
      if (done) {
        result.current.total = plies.length
        onFinish({ ...result.current })
      }
    }, 450 * (next - from) + 50)
  }

  useEffect(() => {
    result.current = { correct: 0, total: plies.length, mistakes: [] }
    failedHere.current = false
    setPly(0)
    setMessage(null)
    setShowHint(false)
    setBusy(true)
    advance(0)
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
  }, [line])

  const onMove = (move: BoardMove): void => {
    if (busy || !plies.includes(ply)) return
    const uci = move.from + move.to + (move.promotion ?? '')
    const expected = line.ucis[ply]
    if (uci === expected) {
      if (!failedHere.current) result.current.correct += 1
      failedHere.current = false
      setShowHint(false)
      setMessage(line.notes[ply + 1] ?? 'Верно!')
      setPly(ply + 1)
      playSound(soundForSan(line.sans[ply], false), settings)
      setBusy(true)
      advance(ply + 1)
      return
    }
    if (!failedHere.current) result.current.mistakes.push({ ply, expected: line.sans[ply], played: `${move.from}-${move.to}` })
    failedHere.current = true
    if (exam) {
      setMessage(`Неверно. Правильный ход: ${displaySan(line.sans[ply], settings.notation)}.`)
      setShowHint(true)
      setBusy(true)
      later(() => {
        failedHere.current = false
        setShowHint(false)
        setPly(ply + 1)
        playSound(soundForSan(line.sans[ply], false), settings)
        advance(ply + 1)
      }, 1400)
    } else {
      setMessage('Не тот ход. Попробуйте ещё раз — стрелка подскажет.')
      setShowHint(true)
    }
  }

  const expected = line.ucis[ply]
  const shapes: DrawShape[] = showHint && expected ? [{ orig: expected.slice(0, 2) as Key, dest: expected.slice(2, 4) as Key, brush: 'hint' }] : []
  const lastMove = ply > 0 ? ([line.ucis[ply - 1].slice(0, 2), line.ucis[ply - 1].slice(2, 4)] as [string, string]) : null

  return (
    <div className="course-drill">
      <Board
        fen={line.fens[ply]}
        orientation={chapter.side === 'w' ? 'white' : 'black'}
        lastMove={lastMove}
        interactive={!busy && plies.includes(ply)}
        movableColor={chapter.side === 'w' ? 'white' : 'black'}
        onMove={onMove}
        autoShapes={shapes}
        maxSize={560}
      />
      <div className="course-side">
        <h3>{line.name}</h3>
        <p className="muted small">
          {exam ? 'Экзамен: играйте ходы варианта по памяти, подсказок нет.' : 'Тренировка: сыграйте ходы варианта. Ошиблись — появится стрелка.'} Вы играете{' '}
          {chapter.side === 'w' ? 'белыми' : 'чёрными'}.
        </p>
        <p className="mono">
          {line.sans.slice(0, ply).map((san, index) => `${index % 2 === 0 ? moveLabel(index) : ''}${displaySan(san, settings.notation)} `)}
        </p>
        {message && <div className="course-note">{message}</div>}
        {!exam && !busy && plies.includes(ply) && !showHint && (
          <button className="text-button" onClick={() => setShowHint(true)}>
            Подсказка
          </button>
        )}
      </div>
    </div>
  )
}

function Quiz({ chapter, onFinish }: { chapter: CourseChapter; onFinish: (correct: number) => void }): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [chosen, setChosen] = useState<number | null>(null)
  const [correct, setCorrect] = useState(0)
  const question = chapter.quiz[index]
  const choose = (option: number): void => {
    if (chosen !== null) return
    setChosen(option)
    if (option === question.answer) setCorrect((value) => value + 1)
  }
  const next = (): void => {
    if (index + 1 >= chapter.quiz.length) {
      onFinish(correct)
      return
    }
    setIndex(index + 1)
    setChosen(null)
  }
  return (
    <section className="panel course-quiz">
      <p className="muted small">
        Вопрос {index + 1} из {chapter.quiz.length}
      </p>
      <h3>{question.q}</h3>
      <div className="quiz-options">
        {question.options.map((option, optionIndex) => (
          <button
            key={option}
            className={`quiz-option ${chosen !== null && optionIndex === question.answer ? 'right' : ''} ${chosen === optionIndex && optionIndex !== question.answer ? 'wrong' : ''}`}
            onClick={() => choose(optionIndex)}
          >
            {option}
          </button>
        ))}
      </div>
      {chosen !== null && (
        <>
          <p className={chosen === question.answer ? 'success-text' : 'error-text'}>{chosen === question.answer ? 'Верно!' : 'Неверно.'}</p>
          <p>{question.why}</p>
          <button className="primary-button" onClick={next}>
            {index + 1 >= chapter.quiz.length ? 'Завершить' : 'Дальше'}
          </button>
        </>
      )}
    </section>
  )
}

function Exam({ chapter, onDone }: { chapter: CourseChapter; onDone: (percent: number) => void }): React.JSX.Element {
  const settings = useSettings((state) => state.settings)
  const [stage, setStage] = useState(0)
  const [lineResults, setLineResults] = useState<DrillResult[]>([])
  const [quizCorrect, setQuizCorrect] = useState<number | null>(null)
  const linesDone = stage >= chapter.lines.length

  if (quizCorrect !== null) {
    const recallCorrect = lineResults.reduce((sum, entry) => sum + entry.correct, 0)
    const recallTotal = lineResults.reduce((sum, entry) => sum + entry.total, 0)
    const percent = examPercent(recallCorrect, recallTotal, quizCorrect, chapter.quiz.length)
    const passed = percent >= PASS_PERCENT
    const mistakes = lineResults.flatMap((entry, lineIndex) => entry.mistakes.map((mistake) => ({ ...mistake, line: chapter.lines[lineIndex].name })))
    return (
      <section className="panel course-result">
        <h2 className={passed ? 'success-text' : 'error-text'}>
          {passed ? 'Экзамен сдан!' : 'Пока не сдан'} — {percent}%
        </h2>
        <p>
          Ходы по памяти: {recallCorrect} из {recallTotal}. Вопросы: {quizCorrect} из {chapter.quiz.length}. Для зачёта нужно {PASS_PERCENT}%.
        </p>
        {mistakes.length > 0 && (
          <>
            <h3>Над чем поработать</h3>
            <ul>
              {mistakes.map((mistake, index) => (
                <li key={index}>
                  {mistake.line}: ход {moveLabel(mistake.ply)} — нужно {displaySan(mistake.expected, settings.notation)}
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="primary-button" onClick={() => onDone(percent)}>
          Готово
        </button>
      </section>
    )
  }

  return (
    <div className="course-exam">
      <p className="muted small">
        Часть {linesDone ? 2 : 1} из 2: {linesDone ? 'вопросы по идеям дебюта' : `вариант ${stage + 1} из ${chapter.lines.length}`}
      </p>
      {linesDone ? (
        <Quiz chapter={chapter} onFinish={setQuizCorrect} />
      ) : (
        <LineDrill
          key={stage}
          chapter={chapter}
          line={chapter.lines[stage]}
          exam
          onFinish={(result) => {
            setLineResults((current) => [...current, result])
            setTimeout(() => setStage((value) => value + 1), 900)
          }}
        />
      )}
    </div>
  )
}

export function CourseScreen(): React.JSX.Element {
  const [chapterId, setChapterId] = useState(COURSE[0].id)
  const [tab, setTab] = useState<Tab>('theory')
  const [progress, setProgress] = useState<CourseProgress>({})
  const [practiceLine, setPracticeLine] = useState(0)
  const [practiceRun, setPracticeRun] = useState(0)
  const [practiceDone, setPracticeDone] = useState<DrillResult | null>(null)
  const [examRun, setExamRun] = useState(0)
  const chapter = COURSE.find((entry) => entry.id === chapterId) ?? COURSE[0]

  useEffect(() => {
    void window.api.app.getValue<CourseProgress>(PROGRESS_KEY).then((value) => setProgress(value ?? {}))
  }, [])

  useEffect(() => {
    setTab('theory')
    setPracticeLine(0)
    setPracticeDone(null)
  }, [chapterId])

  const saveResult = async (percent: number): Promise<void> => {
    const updated = updateProgress(progress, chapter.id, percent)
    setProgress(updated)
    await window.api.app.setValue(PROGRESS_KEY, updated)
    setTab('theory')
  }

  const passedCount = COURSE.filter((entry) => progress[entry.id]?.passed).length

  return (
    <div className="screen course-screen">
      <aside className="course-chapters">
        <h1>Курс дебютов</h1>
        <p className="muted small">
          Какие дебюты учить в начале. Пройдено глав: {passedCount} из {COURSE.length}.
        </p>
        {COURSE.map((entry, index) => {
          const state = progress[entry.id]
          return (
            <button key={entry.id} className={`course-chapter ${entry.id === chapter.id ? 'active' : ''}`} onClick={() => setChapterId(entry.id)}>
              <span className="course-chapter-index">{state?.passed ? '✓' : index + 1}</span>
              <span className="course-chapter-text">
                <b>{entry.title}</b>
                <span className="muted small">{entry.summary}</span>
                <span className="small">
                  {entry.side === 'w' ? 'За белых' : 'За чёрных'}
                  {state ? ` · лучший результат ${state.best}%` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </aside>

      <div className="course-main">
        <div className="row">
          <h2>{chapter.title}</h2>
          <span className="spacer" />
          <div className="segmented">
            {(
              [
                ['theory', 'Теория'],
                ['lines', 'Варианты'],
                ['practice', 'Тренировка'],
                ['exam', 'Экзамен']
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? 'active' : ''}
                onClick={() => {
                  setTab(key)
                  if (key === 'exam') setExamRun((value) => value + 1)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'theory' && (
          <section className="panel course-theory">
            <p>{chapter.intro}</p>
            <h3>Главные идеи</h3>
            <ul>
              {chapter.ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
            <h3>Как проходить главу</h3>
            <ol>
              <li>Посмотрите все варианты с пояснениями во вкладке «Варианты».</li>
              <li>Сыграйте их во вкладке «Тренировка» — там есть подсказки.</li>
              <li>Сдайте «Экзамен»: варианты по памяти и вопросы по идеям. Зачёт — от {PASS_PERCENT}%.</li>
            </ol>
            <button className="primary-button" onClick={() => setTab('lines')}>
              Смотреть варианты
            </button>
          </section>
        )}

        {tab === 'lines' && <LineViewer chapter={chapter} />}

        {tab === 'practice' && (
          <>
            <div className="segmented wrap">
              {chapter.lines.map((entry, index) => (
                <button
                  key={entry.name}
                  className={index === practiceLine ? 'active' : ''}
                  onClick={() => {
                    setPracticeLine(index)
                    setPracticeDone(null)
                    setPracticeRun((value) => value + 1)
                  }}
                >
                  {entry.name}
                </button>
              ))}
            </div>
            {practiceDone ? (
              <section className="panel">
                <p className={practiceDone.mistakes.length ? '' : 'success-text'}>
                  Вариант пройден: с первой попытки {practiceDone.correct} из {practiceDone.total} ходов.
                </p>
                <div className="row">
                  <button className="primary-button" onClick={() => {
                    setPracticeDone(null)
                    setPracticeRun((value) => value + 1)
                  }}>
                    Ещё раз
                  </button>
                  {practiceLine + 1 < chapter.lines.length ? (
                    <button className="text-button" onClick={() => {
                      setPracticeLine(practiceLine + 1)
                      setPracticeDone(null)
                      setPracticeRun((value) => value + 1)
                    }}>
                      Следующий вариант
                    </button>
                  ) : (
                    <button className="text-button" onClick={() => {
                      setTab('exam')
                      setExamRun((value) => value + 1)
                    }}>
                      К экзамену
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <LineDrill key={`${chapter.id}-${practiceLine}-${practiceRun}`} chapter={chapter} line={chapter.lines[practiceLine]} exam={false} onFinish={setPracticeDone} />
            )}
          </>
        )}

        {tab === 'exam' && <Exam key={`${chapter.id}-${examRun}`} chapter={chapter} onDone={(percent) => void saveResult(percent)} />}
      </div>
    </div>
  )
}
