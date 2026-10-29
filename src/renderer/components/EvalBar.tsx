import { useEffect, useRef } from 'react'
import type { Score } from '@shared/types'
import { formatScore } from '../analysis/notation'
import { winPercent } from '../analysis/winprob'

interface EvalBarProps {
  score: Score | null
  orientation: 'white' | 'black'
  height: number
}

export function EvalBar({ score, orientation, height }: EvalBarProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shownRef = useRef(50)
  const frameRef = useRef<number | null>(null)
  const target = score ? winPercent(score) : 50
  const label = score ? formatScore(score).replace('+', '') : ''

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const width = 26
    canvas.width = width * ratio
    canvas.height = height * ratio
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    const draw = (value: number): void => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#403d39'
      context.fillRect(0, 0, width, height)
      const whiteHeight = (value / 100) * height
      context.fillStyle = '#f5f5f5'
      if (orientation === 'white') context.fillRect(0, height - whiteHeight, width, whiteHeight)
      else context.fillRect(0, 0, width, whiteHeight)
      context.fillStyle = 'rgba(128,128,128,0.5)'
      context.fillRect(0, height / 2 - 0.5, width, 1)
      const whiteAhead = target >= 50
      const atBottom = (orientation === 'white') === whiteAhead
      context.font = '600 10px "IBM Plex Mono", monospace'
      context.textAlign = 'center'
      context.fillStyle = whiteAhead ? '#403d39' : '#f5f5f5'
      context.fillText(label, width / 2, atBottom ? height - 7 : 14)
    }
    const animate = (): void => {
      const delta = target - shownRef.current
      if (Math.abs(delta) < 0.2) {
        shownRef.current = target
        draw(target)
        frameRef.current = null
        return
      }
      shownRef.current += delta * 0.22
      draw(shownRef.current)
      frameRef.current = requestAnimationFrame(animate)
    }
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(animate)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [target, orientation, height, label])

  return <canvas ref={canvasRef} className="eval-bar" aria-label={`Оценка ${label}`} />
}
