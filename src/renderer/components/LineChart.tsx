import { useEffect, useRef, useState } from 'react'

export interface ChartPoint {
  x: number
  y: number
  label?: string
}

interface LineChartProps {
  points: ChartPoint[]
  smooth?: ChartPoint[]
  height?: number
  yMin?: number
  yMax?: number
  formatX?: (value: number) => string
}

export function LineChart({ points, smooth, height = 200, yMin = 0, yMax = 100, formatX }: LineChartProps): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(500)

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(Math.max(200, element.clientWidth)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = width * ratio
    canvas.height = height * ratio
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    const styles = getComputedStyle(document.documentElement)
    const muted = styles.getPropertyValue('--muted').trim() || '#999'
    const line = styles.getPropertyValue('--line').trim() || '#444'
    const accent = styles.getPropertyValue('--accent').trim() || '#81b64c'
    const info = styles.getPropertyValue('--info').trim() || '#5b8bb0'
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    const left = 34
    const bottom = 22
    const plotWidth = width - left - 8
    const plotHeight = height - bottom - 8
    const xs = points.map((point) => point.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const sx = (value: number): number => left + (maxX === minX ? plotWidth / 2 : ((value - minX) / (maxX - minX)) * plotWidth)
    const sy = (value: number): number => 8 + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight
    context.font = '11px "IBM Plex Sans", sans-serif'
    context.fillStyle = muted
    context.strokeStyle = line
    for (let tick = yMin; tick <= yMax; tick += (yMax - yMin) / 4) {
      context.beginPath()
      context.moveTo(left, sy(tick))
      context.lineTo(width - 8, sy(tick))
      context.stroke()
      context.fillText(String(Math.round(tick)), 4, sy(tick) + 4)
    }
    if (points.length && formatX) {
      context.fillText(formatX(minX), left, height - 6)
      const label = formatX(maxX)
      context.fillText(label, width - 8 - context.measureText(label).width, height - 6)
    }
    context.fillStyle = info
    for (const point of points) {
      context.beginPath()
      context.arc(sx(point.x), sy(point.y), 3, 0, Math.PI * 2)
      context.fill()
    }
    if (smooth && smooth.length > 1) {
      context.strokeStyle = accent
      context.lineWidth = 2.5
      context.beginPath()
      smooth.forEach((point, index) => (index ? context.lineTo(sx(point.x), sy(point.y)) : context.moveTo(sx(point.x), sy(point.y))))
      context.stroke()
      context.lineWidth = 1
    }
  }, [points, smooth, width, height, yMin, yMax, formatX])

  return (
    <div ref={wrapperRef} className="chart">
      <canvas ref={canvasRef} />
    </div>
  )
}
