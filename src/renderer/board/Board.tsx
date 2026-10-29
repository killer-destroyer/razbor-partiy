import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { Chess, type Square } from 'chess.js'
import { ANIMATION_DURATIONS } from '@shared/settings'
import { useSettings } from '../store/settings'
import { hangingPieces } from '../analysis/features'
import { boardBackground, themeById } from './themes'
import { injectPieceStyles } from './pieces'

export type Orientation = 'white' | 'black'

export interface BoardMove {
  from: string
  to: string
  promotion?: string
}

export interface BoardProps {
  fen: string
  orientation: Orientation
  lastMove?: [string, string] | null
  lastMoveTint?: string | null
  interactive?: boolean
  movableColor?: 'white' | 'black' | 'both'
  onMove?: (move: BoardMove) => void
  autoShapes?: DrawShape[]
  highlights?: Map<string, string>
  maxSize?: number
  className?: string
  onReady?: (api: Api) => void
  freeShapesKey?: string
  autoQueen?: boolean
}

function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>()
  let board: Chess
  try {
    board = new Chess(fen)
  } catch {
    return dests
  }
  for (const move of board.moves({ verbose: true })) {
    const list = dests.get(move.from as Key) ?? []
    if (!list.includes(move.to as Key)) list.push(move.to as Key)
    dests.set(move.from as Key, list)
  }
  return dests
}

function turnColor(fen: string): Orientation {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

function inCheck(fen: string): boolean {
  try {
    return new Chess(fen).inCheck()
  } catch {
    return false
  }
}

function isPromotion(fen: string, from: string, to: string): boolean {
  try {
    const piece = new Chess(fen).get(from as Square)
    return piece?.type === 'p' && (to[1] === '8' || to[1] === '1')
  } catch {
    return false
  }
}

export function Board(props: BoardProps): React.JSX.Element {
  const settings = useSettings((state) => state.settings)
  const containerRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<Api | null>(null)
  const ctrlDrawRef = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props
  const [size, setSize] = useState(480)
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null)

  useEffect(() => {
    injectPieceStyles()
  }, [])

  const theme = themeById(settings.boardTheme)
  const background = useMemo(() => boardBackground(theme), [theme])
  const dests = useMemo(() => (props.interactive ? legalDests(props.fen) : new Map<Key, Key[]>()), [props.fen, props.interactive])

  const customHighlights = useMemo(() => {
    const map = new Map<Key, string>()
    if (settings.showThreats) {
      const side = props.fen.split(' ')[1] === 'b' ? 'b' : 'w'
      try {
        for (const piece of hangingPieces(props.fen, side)) map.set(piece.square as Key, 'threat')
      } catch {
        map.clear()
      }
    }
    props.highlights?.forEach((value, key) => map.set(key as Key, value))
    return map
  }, [props.fen, props.highlights, settings.showThreats])

  const config = (): Config => {
    const current = propsRef.current
    const movable = current.interactive
      ? {
          free: false,
          color: current.movableColor ?? turnColor(current.fen),
          dests,
          showDests: settings.showLegalMoves,
          events: {
            after: (orig: Key, dest: Key) => {
              const latest = propsRef.current
              if (isPromotion(latest.fen, orig, dest)) {
                if (latest.autoQueen ?? settings.autoQueen) latest.onMove?.({ from: orig, to: dest, promotion: 'q' })
                else setPromotion({ from: orig, to: dest })
                return
              }
              latest.onMove?.({ from: orig, to: dest })
              requestAnimationFrame(() => apiRef.current?.set(config()))
            }
          }
        }
      : { free: false, color: undefined, dests: new Map<Key, Key[]>() }
    return {
      fen: current.fen,
      orientation: current.orientation,
      turnColor: turnColor(current.fen),
      check: inCheck(current.fen),
      lastMove: current.lastMove ? (current.lastMove as Key[]) : undefined,
      coordinates: settings.coordinates !== 'none',
      viewOnly: false,
      highlight: { lastMove: settings.highlightLastMove, check: true, custom: customHighlights },
      animation: { enabled: settings.animation !== 'none', duration: ANIMATION_DURATIONS[settings.animation] },
      movable,
      premovable: { enabled: false },
      draggable: { enabled: current.interactive === true && settings.moveInput !== 'click', showGhost: true },
      selectable: { enabled: current.interactive === true && settings.moveInput !== 'drag' },
      drawable: {
        enabled: true,
        visible: true,
        defaultSnapToValidMove: true,
        eraseOnClick: true,
        autoShapes: current.autoShapes ?? [],
        brushes: {
          green: { key: 'g', color: settings.arrowColors.plain, opacity: 0.85, lineWidth: 10 },
          red: { key: 'r', color: settings.arrowColors.shift, opacity: 0.85, lineWidth: 10 },
          blue: { key: 'b', color: settings.arrowColors.alt, opacity: 0.85, lineWidth: 10 },
          yellow: { key: 'y', color: settings.arrowColors.alt, opacity: 0.85, lineWidth: 10 },
          ctrl: { key: 'c', color: settings.arrowColors.ctrl, opacity: 0.85, lineWidth: 10 },
          best: { key: 'best', color: '#81b64c', opacity: 0.9, lineWidth: 12 },
          alt2: { key: 'alt2', color: '#5b8bb0', opacity: 0.6, lineWidth: 9 },
          alt3: { key: 'alt3', color: '#5b8bb0', opacity: 0.4, lineWidth: 7 },
          danger: { key: 'danger', color: '#fa412d', opacity: 0.85, lineWidth: 11 },
          hint: { key: 'hint', color: '#26c2a3', opacity: 0.9, lineWidth: 12 }
        },
        onChange: (shapes: DrawShape[]) => {
          if (!ctrlDrawRef.current || !shapes.length) return
          ctrlDrawRef.current = false
          const last = shapes[shapes.length - 1]
          if (last.brush === 'red') {
            last.brush = 'ctrl'
            apiRef.current?.setShapes([...shapes])
          }
        }
      }
    }
  }

  useEffect(() => {
    if (!boardRef.current) return
    const api = Chessground(boardRef.current, config())
    apiRef.current = api
    propsRef.current.onReady?.(api)
    const element = boardRef.current
    const markCtrl = (event: MouseEvent): void => {
      if (event.button === 2) ctrlDrawRef.current = event.ctrlKey && !event.shiftKey
    }
    element.addEventListener('mousedown', markCtrl, true)
    return () => {
      element.removeEventListener('mousedown', markCtrl, true)
      api.destroy()
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    apiRef.current?.set(config())
  })

  useEffect(() => {
    apiRef.current?.setShapes([])
  }, [props.freeShapesKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      const outside = settings.coordinates === 'outside' ? 22 : 0
      const limit = Math.min(rect.width - outside, (props.maxSize ?? settings.boardSize) - outside)
      const next = Math.max(160, Math.floor(limit / 8) * 8)
      setSize((current) => (current === next ? current : next))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [settings.coordinates, settings.boardSize, props.maxSize])

  useEffect(() => {
    apiRef.current?.redrawAll()
  }, [size, settings.coordinates])

  const style = {
    '--board-size': `${size}px`,
    '--board-bg': `url("${background}")`,
    '--last-move': props.lastMoveTint ?? theme.lastMove,
    '--coord-light': theme.coordLight,
    '--coord-dark': theme.coordDark
  } as CSSProperties

  return (
    <div ref={containerRef} className={`board-container ${props.className ?? ''}`}>
      <div className={`board-frame coords-${settings.coordinates}`} style={style} data-pieces={settings.pieceSet}>
        <div ref={boardRef} className="board-surface" />
        {promotion && (
          <div className="promotion-overlay" onClick={() => setPromotion(null)}>
            <div className="promotion-picker" onClick={(event) => event.stopPropagation()}>
              {['q', 'r', 'b', 'n'].map((role) => (
                <button
                  key={role}
                  className={`piece-icon ${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[role]} ${turnColor(props.fen)}`}
                  onClick={() => {
                    const pending = promotion
                    setPromotion(null)
                    propsRef.current.onMove?.({ from: pending.from, to: pending.to, promotion: role })
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
