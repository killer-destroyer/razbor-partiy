import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import type { PositionAnalysis } from '@shared/types'
import { Board, type BoardMove } from '../board/Board'
import { playSound, soundForSan } from '../board/sounds'
import { EvalBar } from '../components/EvalBar'
import { applyUciLine, completeFen, isFen } from '../analysis/pgn'
import { displaySan, formatLine, formatScore } from '../analysis/notation'
import { useOpenings } from '../openings/store'
import { translateOpeningName } from '../openings/translate'
import { ru } from '../i18n/ru'
import { useApp } from '../store/app'
import { useSettings } from '../store/settings'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

interface TreeNode {
  id: number
  parent: number | null
  uci: string | null
  san: string | null
  fen: string
  children: number[]
}

interface AnalysisTab {
  id: number
  title: string
  nodes: Map<number, TreeNode>
  current: number
}

let nextNodeId = 1
let nextTabId = 1

function createTab(fen: string, title: string): AnalysisTab {
  const root: TreeNode = { id: nextNodeId++, parent: null, uci: null, san: null, fen, children: [] }
  return { id: nextTabId++, title, nodes: new Map([[root.id, root]]), current: root.id }
}

function rootOf(tab: AnalysisTab): TreeNode {
  return [...tab.nodes.values()].find((node) => node.parent === null)!
}

function pathTo(tab: AnalysisTab, id: number): TreeNode[] {
  const path: TreeNode[] = []
  let node = tab.nodes.get(id)
  while (node) {
    path.unshift(node)
    node = node.parent === null ? undefined : tab.nodes.get(node.parent)
  }
  return path
}

function isMainLine(tab: AnalysisTab, id: number): boolean {
  return pathTo(tab, id).every((node, index, path) => index === 0 || tab.nodes.get(path[index - 1].id)!.children[0] === node.id)
}

function moveNumberText(fen: string, forceBlack: boolean): string {
  const [, turn, , , , number] = fen.split(' ')
  if (turn === 'w') return `${number}.`
  return forceBlack ? `${number}...` : ''
}

export function FreeAnalysisScreen(): React.JSX.Element {
  const initialFen = useApp((state) => state.freeAnalysisFen)
  const settings = useSettings((state) => state.settings)
  const book = useOpenings((state) => state.book)
  const [tabs, setTabs] = useState<AnalysisTab[]>(() => [createTab(initialFen ?? START_FEN, 'Анализ 1')])
  const [activeTab, setActiveTab] = useState(tabs[0].id)
  const [engineOn, setEngineOn] = useState(true)
  const [multiPv, setMultiPv] = useState(Math.max(1, settings.multiPv))
  const [analysis, setAnalysis] = useState<PositionAnalysis | null>(null)
  const [orientation, setOrientation] = useState<'white' | 'black'>(() => ((initialFen ?? START_FEN).split(' ')[1] === 'b' ? 'black' : 'white'))
  const [fenInput, setFenInput] = useState('')
  const [fenError, setFenError] = useState<string | null>(null)
  const sessionRef = useRef(`free-${Date.now()}`)
  const lastInitial = useRef(initialFen)

  useEffect(() => {
    if (initialFen && initialFen !== lastInitial.current) {
      lastInitial.current = initialFen
      const tab = createTab(initialFen, `Анализ ${nextTabId}`)
      setTabs((current) => [...current, tab])
      setActiveTab(tab.id)
      setOrientation(initialFen.split(' ')[1] === 'b' ? 'black' : 'white')
    }
  }, [initialFen])

  const tab = tabs.find((entry) => entry.id === activeTab) ?? tabs[0]
  const node = tab.nodes.get(tab.current)!
  const fen = node.fen

  const update = (next: AnalysisTab): void => setTabs((current) => current.map((entry) => (entry.id === next.id ? next : entry)))

  const goTo = (id: number): void => update({ ...tab, current: id })

  const playUci = (fromId: number, ucis: string[]): void => {
    const nodes = new Map(tab.nodes)
    let currentId = fromId
    for (const uci of ucis) {
      const parent = nodes.get(currentId)!
      const existing = parent.children.map((childId) => nodes.get(childId)!).find((child) => child.uci === uci)
      if (existing) {
        currentId = existing.id
        continue
      }
      const result = applyUciLine(parent.fen, [uci])
      if (!result.fens[0]) break
      const child: TreeNode = { id: nextNodeId++, parent: parent.id, uci, san: result.sans[0], fen: result.fens[0], children: [] }
      nodes.set(child.id, child)
      nodes.set(parent.id, { ...parent, children: [...parent.children, child.id] })
      currentId = child.id
    }
    update({ ...tab, nodes, current: currentId })
  }

  const onMove = (move: BoardMove): void => {
    const uci = move.from + move.to + (move.promotion ?? '')
    const san = applyUciLine(fen, [uci]).sans[0]
    if (!san) return
    playSound(soundForSan(san, false), settings)
    playUci(node.id, [uci])
  }

  useEffect(() => {
    if (!engineOn) {
      void window.api.engine.stopLive(sessionRef.current)
      return
    }
    setAnalysis(null)
    const sessionId = sessionRef.current
    const off = window.api.engine.onLive((update) => {
      if (update.sessionId === sessionId && update.fen === fen) setAnalysis(update.analysis)
    })
    void window.api.engine.startLive(sessionId, fen, multiPv).catch(() => undefined)
    return () => {
      off()
    }
  }, [fen, engineOn, multiPv])

  useEffect(() => () => void window.api.engine.stopLive(sessionRef.current), [])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return
      if (event.key === 'ArrowLeft' && node.parent !== null) goTo(node.parent)
      else if (event.key === 'ArrowRight' && node.children[0]) goTo(node.children[0])
      else if (event.key === 'Home') goTo(rootOf(tab).id)
      else if (event.key === 'f' || event.key === 'а') setOrientation((value) => (value === 'white' ? 'black' : 'white'))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const shapes = useMemo(() => {
    const list: DrawShape[] = []
    if (!analysis || !settings.showBestMoveArrow) return list
    const brushes = ['best', 'alt2', 'alt3']
    analysis.lines.slice(0, 3).forEach((line, index) => {
      const uci = line.pv[0]
      if (uci) list.push({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: brushes[index] })
    })
    return list
  }, [analysis, settings.showBestMoveArrow])

  const backToMain = (): void => {
    const path = pathTo(tab, node.id)
    let target = path[0].id
    for (const step of path) {
      if (isMainLine(tab, step.id)) target = step.id
      else break
    }
    goTo(target)
  }

  const moveButton = (child: TreeNode, force: boolean): React.ReactNode => {
    const parent = tab.nodes.get(child.parent!)!
    const number = moveNumberText(parent.fen, force)
    return (
      <button key={child.id} className={child.id === tab.current ? 'active' : ''} onClick={() => goTo(child.id)}>
        {number ? `${number} ` : ''}
        {displaySan(child.san, settings.notation)}
      </button>
    )
  }

  const renderLine = (startId: number, initialForce = true): React.ReactNode[] => {
    const parts: React.ReactNode[] = []
    let parent = tab.nodes.get(startId)!
    let force = initialForce
    while (parent.children.length) {
      const [mainId, ...variationIds] = parent.children
      const main = tab.nodes.get(mainId)!
      parts.push(moveButton(main, force))
      force = false
      for (const variationId of variationIds) {
        const variation = tab.nodes.get(variationId)!
        parts.push(
          <span key={`v${variationId}`} className="variation">
            ({moveButton(variation, true)}
            {renderLine(variationId, false)})
          </span>
        )
        force = true
      }
      parent = main
    }
    return parts
  }

  const named = book ? pathTo(tab, node.id).reverse().map((step) => book.namedAt(step.fen)).find(Boolean) : null
  const lastMove = node.uci ? ([node.uci.slice(0, 2), node.uci.slice(2, 4)] as [string, string]) : null

  return (
    <div className="screen free-screen">
      <div className="review-board-column">
        <div className="tabs">
          {tabs.map((entry) => (
            <button key={entry.id} className={`tab ${entry.id === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(entry.id)}>
              {entry.title}
              {tabs.length > 1 && (
                <span
                  style={{ marginLeft: 8, opacity: 0.6 }}
                  onClick={(event) => {
                    event.stopPropagation()
                    const rest = tabs.filter((candidate) => candidate.id !== entry.id)
                    setTabs(rest)
                    if (entry.id === activeTab) setActiveTab(rest[0].id)
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            className="tab"
            onClick={() => {
              const created = createTab(fen, `Анализ ${nextTabId}`)
              setTabs((current) => [...current, created])
              setActiveTab(created.id)
            }}
          >
            + Вкладка из позиции
          </button>
        </div>
        <div className="opening-title">
          {named ? (
            <>
              <span className="eco mono">{named.eco}</span> {translateOpeningName(named.name)}
            </>
          ) : (
            <span className="muted">{ru.nav.free}</span>
          )}
        </div>
        <div className="board-row">
          {settings.showEvalBar && <EvalBar score={analysis?.lines[0]?.score ?? null} orientation={orientation} height={Math.min(settings.boardSize, 600)} />}
          <Board fen={fen} orientation={orientation} lastMove={lastMove} interactive onMove={onMove} autoShapes={shapes} maxSize={600} />
        </div>
        <div className="nav-bar">
          <button className="icon-button" onClick={() => goTo(rootOf(tab).id)}>⏮</button>
          <button className="icon-button" onClick={() => node.parent !== null && goTo(node.parent)}>◀</button>
          <button className="icon-button" onClick={() => node.children[0] && goTo(node.children[0])}>▶</button>
          <button className="text-button" onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}>
            {ru.review.flip}
          </button>
          <button className="text-button" disabled={isMainLine(tab, node.id)} onClick={backToMain}>
            Вернуться к основной линии
          </button>
        </div>
      </div>
      <div className="review-side">
        <section className="panel">
          <div className="panel-title-row">
            <h2>Движок</h2>
            <span className="spacer" />
            <label className="toggle">
              <input type="checkbox" checked={engineOn} onChange={(event) => setEngineOn(event.target.checked)} /> вкл.
            </label>
            <select value={multiPv} onChange={(event) => setMultiPv(Number(event.target.value))}>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? 'линия' : value < 5 ? 'линии' : 'линий'}
                </option>
              ))}
            </select>
          </div>
          {engineOn && !analysis && <p className="muted">Считаю…</p>}
          {analysis && (
            <>
              <div className="engine-lines">
                {analysis.lines.map((line) => {
                  const sans = applyUciLine(fen, line.pv, 12).sans
                  return (
                    <button key={line.multipv} className="engine-line" onClick={() => playUci(node.id, line.pv.slice(0, sans.length))}>
                      <span className="line-score">{formatScore(line.score)}</span>
                      <span className="line-moves">{formatLine(fen, sans, settings.notation, 12)}</span>
                    </button>
                  )
                })}
              </div>
              <p className="muted small">Глубина {analysis.depth}. Нажмите на линию, чтобы добавить её в дерево.</p>
            </>
          )}
        </section>
        <section className="panel move-path">{rootOf(tab).children.length ? renderLine(rootOf(tab).id) : <span className="muted">Делайте ходы мышью — варианты появятся здесь деревом.</span>}</section>
        <section className="panel">
          <h2>Позиция из FEN</h2>
          <div className="row">
            <input type="text" style={{ flex: 1 }} placeholder="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" value={fenInput} onChange={(event) => setFenInput(event.target.value)} />
            <button
              className="text-button"
              onClick={() => {
                if (!isFen(fenInput)) {
                  setFenError('Неверный FEN')
                  return
                }
                setFenError(null)
                const created = createTab(completeFen(fenInput), `Анализ ${nextTabId}`)
                setTabs((current) => [...current, created])
                setActiveTab(created.id)
              }}
            >
              {ru.common.open}
            </button>
            <button className="text-button" onClick={() => void navigator.clipboard.writeText(fen)}>
              Копировать FEN
            </button>
          </div>
          {fenError && <p className="error-text">{fenError}</p>}
          <p className="mono small muted">{fen}</p>
        </section>
      </div>
    </div>
  )
}
