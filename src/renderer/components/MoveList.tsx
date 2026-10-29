import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameMove } from '@shared/types'
import type { MoveReview } from '../analysis/review'
import { displaySan } from '../analysis/notation'
import { useSettings } from '../store/settings'
import { ClassIcon } from './ClassBadge'

interface MoveListProps {
  moves: GameMove[]
  reviews: Array<MoveReview | null>
  cursor: number
  onSelect: (ply: number) => void
}

const ROW_HEIGHT = 28
const VIRTUALIZE_AFTER = 200
const SHOWN_CLASSES = ['brilliant', 'great', 'best', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']

interface Row {
  number: number
  white: number | null
  black: number | null
}

export function MoveList({ moves, reviews, cursor, onSelect }: MoveListProps): React.JSX.Element {
  const notation = useSettings((state) => state.settings.notation)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)

  const rows = useMemo(() => {
    const list: Row[] = []
    moves.forEach((move, index) => {
      const number = Number(move.fenBefore.split(' ')[5]) || 1
      if (move.color === 'w' || !list.length || list[list.length - 1].number !== number) {
        if (move.color === 'w') list.push({ number, white: index, black: null })
        else list.push({ number, white: null, black: index })
      } else {
        list[list.length - 1].black = index
      }
    })
    return list
  }, [moves])

  const virtual = moves.length > VIRTUALIZE_AFTER

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || cursor === 0) return
    const rowIndex = rows.findIndex((row) => row.white === cursor - 1 || row.black === cursor - 1)
    if (rowIndex < 0) return
    const top = rowIndex * ROW_HEIGHT
    if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - ROW_HEIGHT * 2) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2)
    }
  }, [cursor, rows])

  const first = virtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10) : 0
  const last = virtual ? Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + 10) : rows.length

  const cell = (index: number | null): React.JSX.Element => {
    if (index === null) return <span className="move-cell empty">…</span>
    const review = reviews[index]
    const active = cursor === index + 1
    return (
      <button className={`move-cell ${active ? 'active' : ''}`} onClick={() => onSelect(index + 1)}>
        {review && SHOWN_CLASSES.includes(review.moveClass) && <ClassIcon moveClass={review.moveClass} size={16} />}
        <span className="mono">{displaySan(moves[index].san, notation)}</span>
      </button>
    )
  }

  return (
    <div ref={scrollRef} className="move-list" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: virtual ? rows.length * ROW_HEIGHT : undefined, position: 'relative' }}>
        {rows.slice(first, last).map((row, offset) => (
          <div
            key={first + offset}
            className="move-row"
            style={virtual ? { position: 'absolute', top: (first + offset) * ROW_HEIGHT, left: 0, right: 0 } : undefined}
          >
            <span className="move-number mono">{row.number}.</span>
            {cell(row.white)}
            {cell(row.black)}
          </div>
        ))}
      </div>
    </div>
  )
}
