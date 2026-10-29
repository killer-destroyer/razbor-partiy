import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import type { Color, OpeningRecord, PositionAnalysis, RepertoireEntry } from '@shared/types'
import { Board, type BoardMove } from '../board/Board'
import { playSound, soundForSan } from '../board/sounds'
import { applyUciLine, fenToEpd, sanToUci } from '../analysis/pgn'
import { displaySan, formatLine, formatScore } from '../analysis/notation'
import { sansFromOpeningPgn } from '../openings/book'
import { guideFor, type GuideTrap } from '../openings/guides'
import { positionFacts } from '../openings/facts'
import { buildOpeningTree, categorizeFamilies, OPENING_CATEGORY_HINTS, OPENING_CATEGORY_LABELS, openingCategory, searchOpenings, type OpeningCategory, type TreeNode } from '../openings/tree'
import { translateOpeningName } from '../openings/translate'
import { useOpenings } from '../openings/store'
import { useTrainer } from '../store/trainer'
import { ru } from '../i18n/ru'
import { useApp } from '../store/app'
import { useSettings } from '../store/settings'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function TreeView({
  nodes,
  selectedId,
  currentIds,
  expanded,
  toggle,
  select
}: {
  nodes: TreeNode[]
  selectedId: number | null
  currentIds: Set<number>
  expanded: Set<string>
  toggle: (key: string) => void
  select: (opening: OpeningRecord) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const open = expanded.has(node.key)
        const primary = node.openings[0]
        const hasChildren = node.children.length > 0 || node.openings.length > 1
        const containsCurrent = node.openings.some((opening) => currentIds.has(opening.id))
        return (
          <div key={node.key}>
            <button
              className={`tree-node ${primary && primary.id === selectedId ? 'active' : ''} ${containsCurrent ? 'current' : ''}`}
              onClick={() => {
                if (hasChildren) toggle(node.key)
                if (primary) select(primary)
              }}
            >
              <span className="tree-caret">{hasChildren ? (open ? '▾' : '▸') : ''}</span>
              <span className="tree-label" title={node.englishName}>
                {node.label}
              </span>
              <span className="spacer" />
              <span className="tree-eco">{node.ecoRange}</span>
            </button>
            {open && (
              <div className="tree-children">
                {node.openings.slice(1).map((opening) => (
                  <button
                    key={opening.id}
                    className={`tree-node ${opening.id === selectedId ? 'active' : ''} ${currentIds.has(opening.id) ? 'current' : ''}`}
                    onClick={() => select(opening)}
                  >
                    <span className="tree-caret" />
                    <span className="tree-label mono small">{opening.pgn}</span>
                  </button>
                ))}
                <TreeView nodes={node.children} selectedId={selectedId} currentIds={currentIds} expanded={expanded} toggle={toggle} select={select} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export function OpeningsScreen(): React.JSX.Element {
  const { book, guides, load } = useOpenings()
  const settings = useSettings((state) => state.settings)
  const setScreen = useApp((state) => state.setScreen)
  const toast = useApp((state) => state.toast)
  const startOpeningTraining = useTrainer((state) => state.startOpening)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<OpeningRecord | null>(null)
  const [path, setPath] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
  const [autoplay, setAutoplay] = useState(false)
  const [speed, setSpeed] = useState(1.2)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  const [analysis, setAnalysis] = useState<PositionAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [repertoire, setRepertoire] = useState<RepertoireEntry[]>([])
  const [trainColor, setTrainColor] = useState<Color>('w')
  const [category, setCategory] = useState<OpeningCategory>('main')

  useEffect(() => {
    void load()
    void window.api.db.listRepertoire().then(setRepertoire)
  }, [])

  const categories = useMemo(() => (book ? categorizeFamilies(book.openings) : new Map<string, OpeningCategory>()), [book])
  const trees = useMemo(() => {
    const result: Record<OpeningCategory, TreeNode[]> = { main: [], starts: [], rare: [] }
    if (!book) return result
    for (const key of Object.keys(result) as OpeningCategory[]) {
      result[key] = buildOpeningTree(book.openings.filter((opening) => openingCategory(categories, opening) === key))
    }
    return result
  }, [book, categories])
  const tree = trees[category]
  const results = useMemo(() => (book && query.trim() ? searchOpenings(book.openings, query) : []), [book, query])

  const fens = useMemo(() => [START_FEN, ...applyUciLine(START_FEN, path).fens], [path])
  const sans = useMemo(() => applyUciLine(START_FEN, path).sans, [path])
  const fen = fens[Math.min(cursor, fens.length - 1)]

  const currentIds = useMemo(() => {
    if (!book) return new Set<number>()
    return new Set((book.finals.get(fenToEpd(fen)) ?? []).map((opening) => opening.id))
  }, [book, fen])

  const namedHere = useMemo(() => {
    if (!book) return null
    for (let index = Math.min(cursor, fens.length - 1); index >= 1; index -= 1) {
      const named = book.namedAt(fens[index], path.slice(0, index))
      if (named) return { opening: named, exact: index === cursor }
    }
    return null
  }, [book, fens, cursor, path])

  useEffect(() => {
    if (!namedHere || query.trim()) return
    const name = namedHere.opening.name
    const colon = name.indexOf(':')
    const family = colon === -1 ? name : name.slice(0, colon)
    const keys = [family]
    if (colon !== -1) keys.push(`${family}: ${name.slice(colon + 1).split(',')[0].trim()}`, name)
    setExpanded((current) => (keys.every((key) => current.has(key)) ? current : new Set([...current, ...keys])))
  }, [namedHere?.opening.id])

  const inBook = book ? cursor === 0 || book.isBookPosition(fen) : true
  const guideTarget = selected ?? namedHere?.opening ?? null
  const guide = guideTarget ? guideFor(guides, guideTarget) : null
  const specificGuide = guide && guideTarget ? (guide.match.namePrefix ?? []).some((prefix) => guideTarget.name.startsWith(prefix) && prefix.includes(':')) : false

  const select = (opening: OpeningRecord): void => {
    setSelected(opening)
    setPath(opening.uci)
    setCursor(0)
    setAutoplay(true)
    setAnalysis(null)
  }

  useEffect(() => {
    if (!autoplay) return
    const timer = setInterval(() => {
      setCursor((value) => {
        if (value >= path.length) {
          setAutoplay(false)
          return value
        }
        return value + 1
      })
    }, speed * 1000)
    return () => clearInterval(timer)
  }, [autoplay, speed, path.length])

  useEffect(() => {
    if (cursor > 0 && sans[cursor - 1]) playSound(soundForSan(sans[cursor - 1], false), settings)
  }, [cursor])

  useEffect(() => {
    if (!selected) return
    const finalFen = [START_FEN, ...applyUciLine(START_FEN, selected.uci).fens].pop()!
    setAnalyzing(true)
    let cancelled = false
    void window.api.engine
      .analyzePosition(finalFen, { depth: Math.min(settings.analysisDepth, 20), movetimeMs: null, multiPv: 3 })
      .then((result) => {
        if (!cancelled) setAnalysis(result)
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setAnalyzing(false))
    return () => {
      cancelled = true
    }
  }, [selected])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return
      if (event.key === 'ArrowLeft') setCursor((value) => Math.max(0, value - 1))
      else if (event.key === 'ArrowRight') setCursor((value) => Math.min(path.length, value + 1))
      else if (event.key === 'Home') setCursor(0)
      else if (event.key === 'End') setCursor(path.length)
      else if (event.key === 'f' || event.key === 'а') setOrientation((value) => (value === 'white' ? 'black' : 'white'))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [path.length])

  const onMove = (move: BoardMove): void => {
    const uci = move.from + move.to + (move.promotion ?? '')
    const next = [...path.slice(0, cursor), uci]
    const valid = applyUciLine(START_FEN, next).sans.length === next.length
    if (!valid) return
    setAutoplay(false)
    setPath(next)
    setCursor(next.length)
    if (path[cursor] !== uci) setSelected(null)
  }

  const playTrap = (trap: GuideTrap): void => {
    const board = new Chess()
    const ucis: string[] = []
    for (const san of sansFromOpeningPgn(trap.line)) {
      const uci = sanToUci(board.fen(), san)
      if (!uci) break
      ucis.push(uci)
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    }
    setSelected(null)
    setPath(ucis)
    setCursor(0)
    setOrientation(trap.forSide === 'b' ? 'black' : 'white')
    setAutoplay(true)
  }

  const repertoireEntry = selected ? repertoire.find((entry) => entry.openingId === selected.id) : undefined
  const setRepertoireColor = async (color: Color | null): Promise<void> => {
    if (!selected) return
    await window.api.db.setRepertoire(selected.id, color)
    setRepertoire(await window.api.db.listRepertoire())
  }

  const shapes: DrawShape[] = useMemo(() => {
    if (cursor < path.length && !autoplay) {
      const next = path[cursor]
      return [{ orig: next.slice(0, 2) as Key, dest: next.slice(2, 4) as Key, brush: 'alt2' }]
    }
    return []
  }, [cursor, path, autoplay])

  const facts = positionFacts(fens[fens.length - 1])
  const lastMove = cursor > 0 ? ([path[cursor - 1].slice(0, 2), path[cursor - 1].slice(2, 4)] as [string, string]) : null

  return (
    <div className="screen openings-screen">
      <div className="opening-tree">
        <h1>{ru.nav.openings}</h1>
        <input type="text" placeholder={ru.openings.search} value={query} onChange={(event) => setQuery(event.target.value)} />
        {!query.trim() && (
          <>
            <div className="segmented">
              {(Object.keys(OPENING_CATEGORY_LABELS) as OpeningCategory[]).map((key) => (
                <button key={key} className={category === key ? 'active' : ''} onClick={() => setCategory(key)} title={OPENING_CATEGORY_HINTS[key]}>
                  {OPENING_CATEGORY_LABELS[key]} · {trees[key].length}
                </button>
              ))}
            </div>
            <p className="muted small">{OPENING_CATEGORY_HINTS[category]}</p>
          </>
        )}
        <div className="tree-scroll">
          {!book && <p className="muted">{ru.common.loading}</p>}
          {query.trim() ? (
            results.map((opening) => (
              <button key={opening.id} className={`tree-node ${selected?.id === opening.id ? 'active' : ''}`} onClick={() => select(opening)}>
                <span className="tree-eco">{opening.eco}</span>
                <span className="tree-label" title={`${opening.name}\n${opening.pgn}`}>
                  {translateOpeningName(opening.name)}
                </span>
                {openingCategory(categories, opening) !== 'main' && <span className="muted small">{OPENING_CATEGORY_LABELS[openingCategory(categories, opening)].toLowerCase()}</span>}
              </button>
            ))
          ) : (
            <TreeView
              nodes={tree}
              selectedId={selected?.id ?? null}
              currentIds={currentIds}
              expanded={expanded}
              toggle={(key) =>
                setExpanded((current) => {
                  const next = new Set(current)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
              select={select}
            />
          )}
        </div>
      </div>

      <div className="opening-center">
        <div className="opening-title">
          {namedHere ? (
            <>
              <span className="eco mono">{namedHere.opening.eco}</span>
              <span>{translateOpeningName(namedHere.opening.name)}</span>
            </>
          ) : (
            <span className="muted">Начальная позиция</span>
          )}
          {!inBook && <span className="muted">· {ru.openings.offBook}</span>}
        </div>
        <Board fen={fen} orientation={orientation} lastMove={lastMove} interactive onMove={onMove} autoShapes={shapes} maxSize={600} />
        <div className="nav-bar" style={{ paddingLeft: 0 }}>
          <button className="icon-button" onClick={() => setCursor(0)}>⏮</button>
          <button className="icon-button" onClick={() => setCursor((value) => Math.max(0, value - 1))}>‹</button>
          <button className={`icon-button ${autoplay ? 'active' : ''}`} onClick={() => setAutoplay((value) => !value)} title={ru.openings.autoplay}>
            {autoplay ? '⏸' : '▶︎'}
          </button>
          <button className="icon-button" onClick={() => setCursor((value) => Math.min(path.length, value + 1))}>›</button>
          <button className="icon-button" onClick={() => setCursor(path.length)}>⏭</button>
          <button className="text-button" onClick={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}>
            {ru.review.flip}
          </button>
          <label className="toggle">
            {ru.openings.speed}
            <input type="range" min={0.3} max={3} step={0.1} value={3.3 - speed} onChange={(event) => setSpeed(3.3 - Number(event.target.value))} />
          </label>
        </div>
        <div className="panel move-path">
          {sans.length ? (
            formatLine(START_FEN, sans, settings.notation, 200)
              .split(' ')
              .reduce<Array<{ text: string; ply: number | null }>>((list, token) => {
                const isNumber = /^\d+\.+$/.test(token)
                const ply = isNumber ? null : list.filter((entry) => entry.ply !== null).length + 1
                list.push({ text: token, ply })
                return list
              }, [])
              .map((entry, index) =>
                entry.ply === null ? (
                  <span key={index} className="muted">
                    {entry.text}{' '}
                  </span>
                ) : (
                  <button key={index} className={entry.ply === cursor ? 'active' : ''} onClick={() => setCursor(entry.ply!)}>
                    {entry.text}
                  </button>
                )
              )
          ) : (
            <span className="muted">Выберите вариант слева или сделайте ход на доске.</span>
          )}
        </div>
        {selected && (
          <div className="panel">
            <div className="row">
              <span className="eco mono">{selected.eco}</span>
              <b>{translateOpeningName(selected.name)}</b>
            </div>
            <p className="muted small mono">{selected.pgn}</p>
            <div className="row">
              <select value={trainColor} onChange={(event) => setTrainColor(event.target.value as Color)}>
                <option value="w">{ru.openings.addWhite}</option>
                <option value="b">{ru.openings.addBlack}</option>
              </select>
              <button
                className="primary-button small"
                onClick={async () => {
                  await startOpeningTraining(selected, trainColor)
                  setScreen('trainer')
                }}
              >
                {ru.openings.train}
              </button>
              <span className="spacer" />
              <span className="muted small">{ru.openings.repertoire}:</span>
              <button className={`text-button ${repertoireEntry?.color === 'w' ? 'active' : ''}`} onClick={() => void setRepertoireColor('w').then(() => toast('Добавлено в репертуар за белых', 'success'))}>
                {ru.openings.addWhite}
              </button>
              <button className={`text-button ${repertoireEntry?.color === 'b' ? 'active' : ''}`} onClick={() => void setRepertoireColor('b').then(() => toast('Добавлено в репертуар за чёрных', 'success'))}>
                {ru.openings.addBlack}
              </button>
              {repertoireEntry && (
                <button className="text-button" onClick={() => void setRepertoireColor(null)}>
                  {ru.openings.remove}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="opening-side">
        {selected && (
          <section className="panel">
            <h2>{ru.openings.engine}</h2>
            {analyzing && <p className="muted">{ru.common.loading}</p>}
            <div className="engine-lines">
              {analysis?.lines.map((line) => {
                const finalFen = [START_FEN, ...applyUciLine(START_FEN, selected.uci).fens].pop()!
                const lineSans = applyUciLine(finalFen, line.pv, 8).sans
                return (
                  <button
                    key={line.multipv}
                    className="engine-line"
                    onClick={() => {
                      const extended = [...selected.uci, ...line.pv.slice(0, lineSans.length)]
                      setSelected(null)
                      setPath(extended)
                      setCursor(selected.uci.length + 1)
                      setAutoplay(false)
                    }}
                  >
                    <span className="line-score">{formatScore(line.score)}</span>
                    <span className="line-moves">{formatLine(finalFen, lineSans, settings.notation)}</span>
                  </button>
                )
              })}
            </div>
            {analysis && <p className="muted small">Глубина {analysis.depth}</p>}
          </section>
        )}
        {guide ? (
          <section className="panel guide-section">
            <h2>
              {ru.openings.guide}: {guide.family}
            </h2>
            {guideTarget && !specificGuide && guide.match.namePrefix?.every((prefix) => !prefix.includes(':')) && guideTarget.name.includes(':') && (
              <p className="muted small">{ru.openings.noGuide}</p>
            )}
            <h3>{ru.openings.idea}</h3>
            <p>{guide.idea}</p>
            <GuideList title={ru.openings.pros} items={guide.pros} />
            <GuideList title={ru.openings.cons} items={guide.cons} />
            <GuideList title={ru.openings.plansWhite} items={guide.plansWhite} />
            <GuideList title={ru.openings.plansBlack} items={guide.plansBlack} />
            <h3>{ru.openings.structure}</h3>
            <p>{guide.pawnStructure}</p>
            {guide.traps.length > 0 && (
              <>
                <h3>{ru.openings.traps}</h3>
                {guide.traps.map((trap) => (
                  <div key={trap.name} className="trap">
                    <div className="row">
                      <b>{trap.name}</b>
                      <span className="muted small">для {trap.forSide === 'w' ? 'белых' : 'чёрных'}</span>
                      <span className="spacer" />
                      <button className="text-button" onClick={() => playTrap(trap)}>
                        {ru.openings.playTrap}
                      </button>
                    </div>
                    <p className="mono small">{trap.line.replace(/[KQRBN]/g, (letter) => displaySan(letter, settings.notation))}</p>
                    <p>{trap.explanation}</p>
                  </div>
                ))}
              </>
            )}
            <GuideList title={ru.openings.nuances} items={guide.nuances} />
            <GuideList title={ru.openings.mistakes} items={guide.typicalMistakes} />
          </section>
        ) : (
          <section className="panel">
            <p className="muted">{guideTarget ? 'Для этого дебюта гайда пока нет.' : 'Выберите дебют, чтобы увидеть гайд.'}</p>
          </section>
        )}
        <section className="panel guide-section">
          <h2>{ru.openings.facts}</h2>
          <ul>
            {facts.structure.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
            {facts.castling.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
            <li>{facts.material}</li>
            {analysis?.lines[0] && <li>Оценка движка конечной позиции: {formatScore(analysis.lines[0].score)}</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}

function GuideList({ title, items }: { title: string; items: string[] }): React.JSX.Element | null {
  if (!items.length) return null
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  )
}
