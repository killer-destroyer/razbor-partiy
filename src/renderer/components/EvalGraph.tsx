import { useEffect, useRef, useState } from 'react'
import type { Color } from '@shared/types'
import type { MoveReview } from '../analysis/review'
import { CLASS_INFO } from '../i18n/ru'

interface EvalGraphProps {
  winPercents: Array<number | null>
  moves: Array<MoveReview | null>
  cursor: number
  userColor: Color | null
  onSelect: (ply: number) => void
  height?: number
}

const DOT_CLASSES = ['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']

export function EvalGraph({ winPercents, moves, cursor, userColor, onSelect, height = 120 }: EvalGraphProps): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  const plies = Math.max(1, winPercents.length - 1)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const observer = new ResizeObserver(() => setWidth(Math.max(200, Math.floor(wrapper.clientWidth))))
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = width * ratio
    canvas.height = height * ratio
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = '#2b2926'
    context.fillRect(0, 0, width, height)
    const x = (ply: number): number => (ply / plies) * width
    const y = (value: number): number => height - (value / 100) * height
    const points = winPercents.map((value, ply) => (value === null ? null : [x(ply), y(value)] as const))
    const known = points.filter((point): point is readonly [number, number] => point !== null)
    if (known.length) {
      context.beginPath()
      context.moveTo(known[0][0], height)
      for (const [px, py] of known) context.lineTo(px, py)
      context.lineTo(known[known.length - 1][0], height)
      context.closePath()
      context.fillStyle = '#f0f0f0'
      context.fill()
    }
    context.strokeStyle = 'rgba(130,130,130,0.7)'
    context.setLineDash([4, 4])
    context.beginPath()
    context.moveTo(0, height / 2)
    context.lineTo(width, height / 2)
    context.stroke()
    context.setLineDash([])
    const marker = (ply: number, color: string, lineWidth: number): void => {
      context.strokeStyle = color
      context.lineWidth = lineWidth
      context.beginPath()
      context.moveTo(x(ply), 0)
      context.lineTo(x(ply), height)
      context.stroke()
      context.lineWidth = 1
    }
    if (hover !== null) marker(hover, 'rgba(255,255,255,0.35)', 1)
    marker(cursor, '#5b8bb0', 2)
    for (const entry of moves) {
      if (!entry || !DOT_CLASSES.includes(entry.moveClass)) continue
      const value = winPercents[entry.index + 1]
      if (value === null || value === undefined) continue
      const mine = userColor === null || entry.color === userColor
      if (!mine && entry.moveClass === 'inaccuracy') continue
      const radius = mine ? 4.5 : 3.2
      context.beginPath()
      context.arc(x(entry.index + 1), y(value), radius, 0, Math.PI * 2)
      context.fillStyle = CLASS_INFO[entry.moveClass].color
      context.fill()
      context.strokeStyle = '#2b2926'
      context.lineWidth = 1.5
      context.stroke()
      context.lineWidth = 1
    }
  }, [winPercents, moves, cursor, hover, width, height, plies, userColor])

  const plyAt = (clientX: number): number => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(plies, Math.round(((clientX - rect.left) / rect.width) * plies)))
  }

  return (
    <div ref={wrapperRef} className="eval-graph">
      <canvas
        ref={canvasRef}
        onClick={(event) => onSelect(plyAt(event.clientX))}
        onMouseMove={(event) => setHover(plyAt(event.clientX))}
        onMouseLeave={() => setHover(null)}
      />
    </div>
  )
}
