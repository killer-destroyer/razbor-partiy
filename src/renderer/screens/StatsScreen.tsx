import { useEffect, useMemo, useState } from 'react'
import type { StatsRow } from '@shared/api'
import type { CompactMove } from '../analysis/compact'
import { SERIOUS_CLASSES } from '../analysis/classify'
import { LineChart, type ChartPoint } from '../components/LineChart'
import { ru } from '../i18n/ru'
import { useApp } from '../store/app'
import { useReview } from '../store/review'

const TIME_CLASS_LABELS: Record<string, string> = { bullet: 'Пуля', blitz: 'Блиц', rapid: 'Рапид', daily: 'Дейли', classical: 'Классика', unknown: 'Без контроля' }

function userScore(row: StatsRow): 'win' | 'loss' | 'draw' | null {
  if (!row.userColor) return null
  if (row.result === '1/2-1/2') return 'draw'
  if (row.result === '1-0') return row.userColor === 'w' ? 'win' : 'loss'
  if (row.result === '0-1') return row.userColor === 'b' ? 'win' : 'loss'
  return null
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function Bars({ rows, format = (value: number) => `${value.toFixed(0)}%`, danger = false }: { rows: Array<{ label: string; value: number; note?: string }>; format?: (value: number) => string; danger?: boolean }): React.JSX.Element {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <>
      {rows.map((row) => (
        <div key={row.label} className="bar-row">
          <span>{row.label}</span>
          <div className="bar-track">
            <div className={`bar ${danger ? 'danger' : ''}`} style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <span className="mono small">
            {format(row.value)}
            {row.note ? ` ${row.note}` : ''}
          </span>
        </div>
      ))}
    </>
  )
}

function OpeningTable({ rows, onOpen }: { rows: StatsRow[]; onOpen: (name: string) => void }): React.JSX.Element {
  const grouped = new Map<string, StatsRow[]>()
  for (const row of rows) {
    const key = row.openingName ?? 'Без названия'
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const entries = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15)
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Дебют</th>
          <th>{ru.stats.games}</th>
          <th>+ / = / −</th>
          <th>Очки</th>
          <th>Точность</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([name, list]) => {
          const scores = list.map(userScore)
          const wins = scores.filter((score) => score === 'win').length
          const draws = scores.filter((score) => score === 'draw').length
          const losses = scores.filter((score) => score === 'loss').length
          const accuracy = average(list.map((row) => row.accuracy).filter((value): value is number => value !== null))
          return (
            <tr key={name} onClick={() => onOpen(name)} style={{ cursor: 'pointer' }}>
              <td>{name}</td>
              <td className="mono">{list.length}</td>
              <td className="mono">
                <span className="result-win">{wins}</span> / <span className="result-draw">{draws}</span> / <span className="result-loss">{losses}</span>
              </td>
              <td className="mono">{list.length ? `${Math.round(((wins + draws / 2) / list.length) * 100)}%` : '—'}</td>
              <td className="mono">{accuracy === null ? '—' : `${accuracy.toFixed(1)}%`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function StatsScreen(): React.JSX.Element {
  const [rows, setRows] = useState<StatsRow[]>([])
  const setScreen = useApp((state) => state.setScreen)
  const openStored = useReview((state) => state.openStored)

  useEffect(() => {
    void window.api.db.statsRows().then(setRows)
  }, [])

  const analyzed = rows.filter((row) => row.accuracy !== null && row.userColor)

  const timeline = useMemo(() => {
    const points: ChartPoint[] = analyzed.map((row) => ({ x: row.endTime ?? row.importedAt, y: row.accuracy! }))
    points.sort((a, b) => a.x - b.x)
    const window = Math.max(3, Math.round(points.length / 8))
    const smooth = points.map((point, index) => {
      const slice = points.slice(Math.max(0, index - window + 1), index + 1)
      return { x: point.x, y: slice.reduce((sum, entry) => sum + entry.y, 0) / slice.length }
    })
    return { points, smooth }
  }, [analyzed])

  const firstMistake = useMemo(() => {
    const buckets = [
      { label: 'Ходы 1–10', from: 1, to: 10 },
      { label: 'Ходы 11–20', from: 11, to: 20 },
      { label: 'Ходы 21–30', from: 21, to: 30 },
      { label: 'Ходы 31–40', from: 31, to: 40 },
      { label: 'После 40-го', from: 41, to: 999 }
    ]
    const values = analyzed.map((row) => row.firstSeriousMistakeMove).filter((value): value is number => value !== null)
    const clean = analyzed.length - values.length
    return {
      rows: [
        ...buckets.map((bucket) => ({ label: bucket.label, value: values.filter((value) => value >= bucket.from && value <= bucket.to).length })),
        { label: 'Без серьёзных ошибок', value: clean }
      ],
      median: values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null
    }
  }, [analyzed])

  const byTimeClass = useMemo(() => {
    const groups = new Map<string, number[]>()
    for (const row of analyzed) groups.set(row.timeClass, [...(groups.get(row.timeClass) ?? []), row.accuracy!])
    return [...groups.entries()].map(([key, values]) => ({ label: TIME_CLASS_LABELS[key] ?? key, value: average(values) ?? 0, note: `(${values.length})` }))
  }, [analyzed])

  const timeUsage = useMemo(() => {
    const moves: CompactMove[] = []
    for (const row of analyzed) {
      if (!row.movesJson) continue
      const parsed = JSON.parse(row.movesJson) as CompactMove[]
      moves.push(...parsed.filter((move) => move.color === row.userColor && move.spent !== null))
    }
    const buckets = [
      { label: 'До 2 с', from: 0, to: 2 },
      { label: '2–5 с', from: 2, to: 5 },
      { label: '5–15 с', from: 5, to: 15 },
      { label: '15–60 с', from: 15, to: 60 },
      { label: 'Больше минуты', from: 60, to: Infinity }
    ]
    const rate = (list: CompactMove[]): number => (list.length ? (list.filter((move) => SERIOUS_CLASSES.includes(move.moveClass)).length / list.length) * 100 : 0)
    const lowClock = moves.filter((move) => move.clock !== null && move.clock < 30)
    const normalClock = moves.filter((move) => move.clock !== null && move.clock >= 30)
    return {
      total: moves.length,
      rows: buckets.map((bucket) => {
        const list = moves.filter((move) => move.spent! >= bucket.from && move.spent! < bucket.to)
        return { label: bucket.label, value: rate(list), note: `(${list.length})` }
      }),
      lowClock: rate(lowClock),
      normalClock: rate(normalClock),
      lowCount: lowClock.length
    }
  }, [analyzed])

  const openFirstWithOpening = async (name: string): Promise<void> => {
    const row = analyzed.find((entry) => (entry.openingName ?? 'Без названия') === name)
    if (!row) return
    const game = await window.api.db.getGame(row.id)
    if (!game) return
    setScreen('review')
    await openStored(game)
  }

  if (!analyzed.length) {
    return (
      <div className="screen stats-screen">
        <h1>{ru.stats.title}</h1>
        <p className="muted">{ru.stats.empty}</p>
      </div>
    )
  }

  const overall = average(analyzed.map((row) => row.accuracy!))

  return (
    <div className="screen stats-screen">
      <div className="row">
        <h1>{ru.stats.title}</h1>
        <span className="muted">
          Разобрано партий: {analyzed.length}. Средняя точность: {overall?.toFixed(1)}%.
        </span>
      </div>
      <div className="stats-grid">
        <section className="panel">
          <h2>{ru.stats.accuracyOverTime}</h2>
          <LineChart points={timeline.points} smooth={timeline.smooth} formatX={(value) => new Date(value).toLocaleDateString('ru-RU')} />
        </section>
        <section className="panel">
          <h2>{ru.stats.firstMistake}</h2>
          <Bars rows={firstMistake.rows} format={(value) => String(value)} danger />
          {firstMistake.median !== null && <p className="muted small">Чаще всего первая серьёзная ошибка случается около {firstMistake.median}-го хода.</p>}
        </section>
        <section className="panel">
          <h2>{ru.stats.asWhite}</h2>
          <OpeningTable rows={analyzed.filter((row) => row.userColor === 'w')} onOpen={(name) => void openFirstWithOpening(name)} />
        </section>
        <section className="panel">
          <h2>{ru.stats.asBlack}</h2>
          <OpeningTable rows={analyzed.filter((row) => row.userColor === 'b')} onOpen={(name) => void openFirstWithOpening(name)} />
        </section>
        <section className="panel">
          <h2>{ru.stats.byTimeClass}</h2>
          <Bars rows={byTimeClass} />
        </section>
        <section className="panel">
          <h2>{ru.stats.timeUsage}</h2>
          {timeUsage.total ? (
            <>
              <p className="muted small">Доля ошибок, пропусков и зевков среди ходов, сыгранных за указанное время:</p>
              <Bars rows={timeUsage.rows} format={(value) => `${value.toFixed(1)}%`} danger />
              {timeUsage.lowCount > 0 && (
                <p>
                  В цейтноте (меньше 30 секунд на часах) серьёзные ошибки случаются в {timeUsage.lowClock.toFixed(1)}% ходов, а в остальное время — в{' '}
                  {timeUsage.normalClock.toFixed(1)}%.{' '}
                  {timeUsage.lowClock > timeUsage.normalClock * 1.3 ? 'Зевки заметно чаще в цейтноте — экономьте время в дебюте.' : ''}
                </p>
              )}
            </>
          ) : (
            <p className="muted">В разобранных партиях нет данных о времени ([%clk] в PGN).</p>
          )}
        </section>
      </div>
    </div>
  )
}
