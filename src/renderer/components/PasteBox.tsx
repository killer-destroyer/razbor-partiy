import { useRef, useState } from 'react'
import { isFen, completeFen } from '../analysis/pgn'
import { storedFromChesscom } from '../analysis/games'
import { ru } from '../i18n/ru'
import { useApp } from '../store/app'
import { useReview } from '../store/review'
import { useSettings } from '../store/settings'

export async function openAnyText(text: string): Promise<string | null> {
  const trimmed = text.trim()
  if (!trimmed) return null
  const app = useApp.getState()
  if (/^https?:\/\/(www\.)?chess\.com\//i.test(trimmed)) {
    const summary = await window.api.chesscom.findGameByUrl(trimmed)
    if (!summary) return ru.import.notFound
    const stored = storedFromChesscom(summary, useSettings.getState().settings.chesscomUsername)
    const existing = await window.api.db.getGame(stored.id)
    if (!existing) await window.api.db.saveGame(stored)
    app.setScreen('review')
    await useReview.getState().openStored(existing ?? stored)
    return null
  }
  if (isFen(trimmed)) {
    app.openFreeAnalysis(completeFen(trimmed))
    return null
  }
  const result = await useReview.getState().openText(trimmed)
  if (result === 'error') return useReview.getState().error
  app.setScreen('review')
  return null
}

export function PasteBox({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const loadSample = async (): Promise<void> => {
    const { APPENDIX_SAMPLE } = await import('../analysis/sample')
    setText(APPENDIX_SAMPLE)
  }
  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const problem = await openAnyText(text)
      if (problem) setError(problem)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`paste-box ${compact ? 'compact' : ''}`}>
      <textarea
        value={text}
        spellCheck={false}
        placeholder={ru.review.pastePlaceholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
        }}
      />
      <div className="row">
        <button className="primary-button" disabled={busy || !text.trim()} onClick={() => void submit()}>
          {busy ? ru.common.loading : ru.review.analyze}
        </button>
        <button className="text-button" onClick={() => fileRef.current?.click()}>Файл .pgn…</button>
        <button className="text-button" onClick={() => void loadSample()}>{ru.review.sample}</button>
        <input
          ref={fileRef}
          type="file"
          accept=".pgn,.txt"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (file) setText(await file.text())
            event.target.value = ''
          }}
        />
        <span className="muted small">{ru.import.dropHint}</span>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
