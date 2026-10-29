import { useEffect, useState, type CSSProperties } from 'react'
import type { EngineStatus } from '@shared/types'
import { DEPTH_PRESETS, type Settings } from '@shared/settings'
import { COACH_MODELS } from '@shared/coach'
import { BOARD_THEMES, boardBackground, themeById } from '../board/themes'
import { PIECE_SETS, pieceUrl, injectPieceStyles } from '../board/pieces'
import { playSound, type SoundKind } from '../board/sounds'
import { Board } from '../board/Board'
import { AboutContent } from '../app/Dialogs'
import { ru } from '../i18n/ru'
import { useSettings } from '../store/settings'

type Tab = keyof typeof ru.settings.tabs

const PREVIEW_PIECES: Array<[('w' | 'b') | null, string | null]> = [
  ['b', 'r'],
  ['b', 'n'],
  ['b', 'b'],
  [null, null],
  ['b', 'p'],
  ['w', 'n'],
  ['w', 'q'],
  ['w', 'k'],
  ['w', 'p']
]

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="setting-row">
      <div>{label}</div>
      <div className="row">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }): React.JSX.Element {
  return <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange: (value: T) => void }): React.JSX.Element {
  return (
    <div className="segmented">
      {(Object.keys(options) as T[]).map((key) => (
        <button key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>
          {options[key]}
        </button>
      ))}
    </div>
  )
}

function MiniBoard({ themeId, pieceSet }: { themeId: string; pieceSet: string }): React.JSX.Element {
  const theme = themeById(themeId)
  const background = boardBackground(theme)
  return (
    <div className="mini-board">
      {PREVIEW_PIECES.map(([color, role], index) => {
        const column = index % 3
        const row = Math.floor(index / 3)
        const url = color && role ? pieceUrl(pieceSet, color, role) : null
        const style: CSSProperties = {
          backgroundImage: `${url ? `url("${url}"), ` : ''}url("${background}")`,
          backgroundSize: url ? `88%, 800% 800%` : '800% 800%',
          backgroundPosition: url ? `center, ${(column / 7) * 100}% ${(row / 7) * 100}%` : `${(column / 7) * 100}% ${(row / 7) * 100}%`
        }
        return <span key={index} style={style} />
      })}
    </div>
  )
}

function BoardAndPieces({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [themeId, setThemeId] = useState(settings.boardTheme)
  const [pieceSet, setPieceSet] = useState(settings.pieceSet)
  const dirty = themeId !== settings.boardTheme || pieceSet !== settings.pieceSet
  useEffect(() => injectPieceStyles(), [])
  return (
    <>
      <div className="picker-layout">
        <div>
          <h3>{ru.settings.boardTheme}</h3>
          <div className="theme-grid" style={{ margin: '8px 0 18px' }}>
            {BOARD_THEMES.map((theme) => (
              <button key={theme.id} className={`theme-tile ${themeId === theme.id ? 'active' : ''}`} onClick={() => setThemeId(theme.id)}>
                <span className="theme-swatch" style={{ backgroundImage: `url("${boardBackground(theme)}")` }} />
                {theme.name}
              </button>
            ))}
          </div>
          <h3>{ru.settings.pieceSet}</h3>
          <div className="theme-grid" style={{ marginTop: 8 }}>
            {PIECE_SETS.map((set) => (
              <button key={set.id} className={`theme-tile ${pieceSet === set.id ? 'active' : ''}`} onClick={() => setPieceSet(set.id)}>
                <span className="piece-swatch">
                  <span style={{ backgroundImage: `url("${pieceUrl(set.id, 'w', 'n')}")` }} />
                  <span style={{ backgroundImage: `url("${pieceUrl(set.id, 'b', 'q')}")` }} />
                </span>
                {set.name}
              </button>
            ))}
          </div>
        </div>
        <div className="preview-box">
          <div className="label">{ru.settings.preview}</div>
          <MiniBoard themeId={themeId} pieceSet={pieceSet} />
          <div className="row">
            <button className="primary-button" disabled={!dirty} onClick={() => update({ boardTheme: themeId, pieceSet })}>
              {ru.common.save}
            </button>
            <button
              className="text-button"
              disabled={!dirty}
              onClick={() => {
                setThemeId(settings.boardTheme)
                setPieceSet(settings.pieceSet)
              }}
            >
              {ru.common.cancel}
            </button>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <Row label={ru.settings.coordinates}>
          <Choice value={settings.coordinates} options={ru.settings.coordinatesOptions} onChange={(coordinates) => update({ coordinates })} />
        </Row>
        <Row label={ru.settings.highlightLastMove}>
          <Toggle value={settings.highlightLastMove} onChange={(highlightLastMove) => update({ highlightLastMove })} />
        </Row>
        <Row label={ru.settings.showLegalMoves}>
          <Toggle value={settings.showLegalMoves} onChange={(showLegalMoves) => update({ showLegalMoves })} />
        </Row>
        <Row label={ru.settings.showThreats}>
          <Toggle value={settings.showThreats} onChange={(showThreats) => update({ showThreats })} />
        </Row>
        <Row label={ru.settings.boardSize}>
          <input type="range" min={320} max={960} step={8} value={settings.boardSize} onChange={(event) => update({ boardSize: Number(event.target.value) })} />
          <span className="mono">{settings.boardSize} px</span>
        </Row>
      </div>
    </>
  )
}

function Gameplay({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const color = (key: keyof Settings['arrowColors'], label: string): React.JSX.Element => (
    <label className="toggle" key={key}>
      <input
        className="color-input"
        type="color"
        value={settings.arrowColors[key]}
        onChange={(event) => update({ arrowColors: { ...settings.arrowColors, [key]: event.target.value } })}
      />
      {label}
    </label>
  )
  return (
    <div className="picker-layout">
      <div>
        <Row label={ru.settings.animation}>
          <Choice value={settings.animation} options={ru.settings.animationOptions} onChange={(animation) => update({ animation })} />
        </Row>
        <Row label={ru.settings.moveInput}>
          <Choice value={settings.moveInput} options={ru.settings.moveInputOptions} onChange={(moveInput) => update({ moveInput })} />
        </Row>
        <Row label={ru.settings.autoQueen}>
          <Toggle value={settings.autoQueen} onChange={(autoQueen) => update({ autoQueen })} />
        </Row>
        <Row label={ru.settings.arrows}>
          {color('plain', ru.settings.arrowPlain)}
          {color('shift', ru.settings.arrowShift)}
          {color('alt', ru.settings.arrowAlt)}
          {color('ctrl', ru.settings.arrowCtrl)}
        </Row>
        <Row label={ru.settings.showBestMoveArrow}>
          <Toggle value={settings.showBestMoveArrow} onChange={(showBestMoveArrow) => update({ showBestMoveArrow })} />
        </Row>
        <Row label={ru.settings.showEvalBar}>
          <Toggle value={settings.showEvalBar} onChange={(showEvalBar) => update({ showEvalBar })} />
        </Row>
      </div>
      <div className="preview-box">
        <div className="label">Попробуйте: ходы мышью, стрелки правой кнопкой</div>
        <Board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" orientation="white" interactive maxSize={260} />
      </div>
    </div>
  )
}

function Sound({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const items: Array<[keyof Settings, string, SoundKind]> = [
    ['soundMove', ru.settings.soundMove, 'move'],
    ['soundCapture', ru.settings.soundCapture, 'capture'],
    ['soundCheck', ru.settings.soundCheck, 'check'],
    ['soundCastle', ru.settings.soundCastle, 'castle'],
    ['soundPromote', ru.settings.soundPromote, 'promote'],
    ['soundGameEnd', ru.settings.soundGameEnd, 'gameEnd']
  ]
  return (
    <>
      <Row label={ru.settings.soundEnabled}>
        <Toggle value={settings.soundEnabled} onChange={(soundEnabled) => update({ soundEnabled })} />
      </Row>
      <Row label={ru.settings.soundVolume}>
        <input type="range" min={0} max={1} step={0.05} value={settings.soundVolume} onChange={(event) => update({ soundVolume: Number(event.target.value) })} />
        <span className="mono">{Math.round(settings.soundVolume * 100)}%</span>
      </Row>
      {items.map(([key, label, kind]) => (
        <Row key={key} label={label}>
          <Toggle value={Boolean(settings[key])} onChange={(value) => update({ [key]: value } as Partial<Settings>)} />
          <button className="text-button" onClick={() => playSound(kind, { ...settings, soundEnabled: true, [key]: true })}>
            {ru.settings.test}
          </button>
        </Row>
      ))}
    </>
  )
}

function Analysis({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [path, setPath] = useState(settings.enginePath)
  useEffect(() => {
    void window.api.engine.status().then(setStatus)
  }, [settings.engineThreads, settings.engineHashMb, settings.enginePath])
  return (
    <>
      <Row label={ru.settings.engineStatus}>
        <span className={`status-dot ${status?.ready ? 'ok' : 'bad'}`} />
        <span>{status?.ready ? `${status.name} · ${status.workers} ${status.workers === 1 ? 'процесс' : status.workers < 5 ? 'процесса' : 'процессов'} · ${status.threads} потоков · ${status.hashMb} МБ · ${status.path}` : status?.error ?? ru.engine.starting}</span>
        <button className="text-button" onClick={() => void window.api.engine.restart().then(setStatus)}>
          {ru.engine.restart}
        </button>
      </Row>
      <Row label={ru.settings.analysisLimit}>
        <Choice value={settings.analysisLimit} options={ru.settings.analysisLimitOptions} onChange={(analysisLimit) => update({ analysisLimit })} />
      </Row>
      {settings.analysisLimit === 'depth' ? (
        <Row label={ru.settings.depth}>
          <div className="segmented">
            {DEPTH_PRESETS.map((preset) => (
              <button key={preset.depth} className={settings.analysisDepth === preset.depth ? 'active' : ''} onClick={() => update({ analysisDepth: preset.depth })}>
                {preset.label} · {preset.depth}
              </button>
            ))}
          </div>
          <input type="range" min={8} max={30} value={settings.analysisDepth} onChange={(event) => update({ analysisDepth: Number(event.target.value) })} />
          <span className="mono">{settings.analysisDepth}</span>
        </Row>
      ) : (
        <Row label={ru.settings.movetime}>
          <input
            type="number"
            min={100}
            max={30000}
            step={100}
            value={settings.analysisMovetimeMs}
            onChange={(event) => update({ analysisMovetimeMs: Math.max(100, Number(event.target.value)) })}
          />
        </Row>
      )}
      <Row label={ru.settings.multiPv}>
        <Choice
          value={String(settings.multiPv) as '1'}
          options={{ '1': '1', '2': '2', '3': '3', '4': '4', '5': '5' } as Record<'1', string>}
          onChange={(value) => update({ multiPv: Number(value) })}
        />
      </Row>
      <Row label={ru.settings.threads}>
        <input type="number" min={0} max={128} value={settings.engineThreads} onChange={(event) => update({ engineThreads: Math.max(0, Number(event.target.value)) })} />
      </Row>
      <Row label={ru.settings.hash}>
        <select value={settings.engineHashMb} onChange={(event) => update({ engineHashMb: Number(event.target.value) })}>
          {[64, 128, 256, 512, 1024, 2048].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </Row>
      <Row label={ru.settings.enginePath}>
        <input type="text" style={{ width: 360 }} value={path} placeholder="/opt/homebrew/bin/stockfish" onChange={(event) => setPath(event.target.value)} />
        <button className="text-button" disabled={path === settings.enginePath} onClick={() => update({ enginePath: path.trim() })}>
          {ru.common.save}
        </button>
      </Row>
      <Row label={ru.settings.profile}>
        <Choice value={settings.classificationProfile} options={ru.settings.profileOptions} onChange={(classificationProfile) => update({ classificationProfile })} />
      </Row>
      <Row label={ru.settings.autoAnalyze}>
        <Toggle value={settings.autoAnalyzeOnImport} onChange={(autoAnalyzeOnImport) => update({ autoAnalyzeOnImport })} />
      </Row>
    </>
  )
}

function Interface({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [username, setUsername] = useState(settings.chesscomUsername)
  return (
    <>
      <Row label={ru.settings.themeMode}>
        <Choice value={settings.themeMode} options={ru.settings.themeOptions} onChange={(themeMode) => update({ themeMode })} />
      </Row>
      <Row label={ru.settings.notation}>
        <Choice value={settings.notation} options={ru.settings.notationOptions} onChange={(notation) => update({ notation })} />
      </Row>
      <Row label={ru.settings.username}>
        <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} />
        <button className="text-button" disabled={username === settings.chesscomUsername} onClick={() => update({ chesscomUsername: username.trim() })}>
          {ru.common.save}
        </button>
      </Row>
    </>
  )
}

function Coach({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    void window.api.coach.hasKey().then(setHasKey)
  }, [])
  return (
    <>
      <p className="muted">{ru.settings.coachHint}</p>
      <Row label={ru.settings.coachEnabled}>
        <Toggle value={settings.coachEnabled} onChange={(coachEnabled) => update({ coachEnabled })} />
      </Row>
      <Row label={ru.settings.coachKey}>
        <input type="password" style={{ width: 320 }} placeholder={hasKey ? '••••••••••••' : 'sk-ant-…'} value={key} onChange={(event) => setKey(event.target.value)} />
        <button
          className="text-button"
          disabled={!key.trim()}
          onClick={async () => {
            const saved = await window.api.coach.setKey(key)
            setKey('')
            setHasKey(saved || hasKey)
            setMessage(saved ? ru.settings.coachKeySaved : 'Системное шифрование недоступно, ключ не сохранён.')
          }}
        >
          {ru.common.save}
        </button>
        {hasKey && (
          <button
            className="text-button"
            onClick={async () => {
              await window.api.coach.clearKey()
              setHasKey(false)
              setMessage(null)
            }}
          >
            {ru.common.delete}
          </button>
        )}
        <span className="muted small">{message ?? (hasKey ? ru.settings.coachKeySaved : ru.settings.coachKeyMissing)}</span>
      </Row>
      <Row label={ru.settings.coachModel}>
        <select value={settings.coachModel} onChange={(event) => update({ coachModel: event.target.value })}>
          {COACH_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} — ${model.inputPerMillion}/${model.outputPerMillion} за 1M токенов
            </option>
          ))}
        </select>
      </Row>
    </>
  )
}

export function SettingsScreen(): React.JSX.Element {
  const { settings, update } = useSettings()
  const [tab, setTab] = useState<Tab>('board')
  const apply = (patch: Partial<Settings>): void => void update(patch)
  return (
    <div className="screen settings-screen">
      <div className="settings-tabs">
        <h1 style={{ marginBottom: 12 }}>{ru.nav.settings}</h1>
        {(Object.keys(ru.settings.tabs) as Tab[]).map((key) => (
          <button key={key} className={`nav-item ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {ru.settings.tabs[key]}
          </button>
        ))}
      </div>
      <div className="settings-body">
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>{ru.settings.tabs[tab]}</h2>
        {tab === 'board' && <BoardAndPieces settings={settings} update={apply} />}
        {tab === 'gameplay' && <Gameplay settings={settings} update={apply} />}
        {tab === 'sound' && <Sound settings={settings} update={apply} />}
        {tab === 'analysis' && <Analysis settings={settings} update={apply} />}
        {tab === 'interface' && <Interface settings={settings} update={apply} />}
        {tab === 'coach' && <Coach settings={settings} update={apply} />}
        {tab === 'about' && <AboutContent />}
      </div>
    </div>
  )
}
