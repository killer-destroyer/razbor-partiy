import { useMemo, useState } from 'react'
import { COACH_MODELS, estimateCost, estimateTokens } from '@shared/coach'
import { paragraphToText } from '../analysis/commentary'
import { formatScore, moveLabel } from '../analysis/notation'
import { ru } from '../i18n/ru'
import { useReview } from '../store/review'
import { useSettings } from '../store/settings'

const SYSTEM_PROMPT_TOKENS = 450
const EXPECTED_OUTPUT_TOKENS = 1800

export function buildCoachPayload(): string | null {
  const { parsed, review, positions, game, userColor } = useReview.getState()
  if (!parsed || !review || !game) return null
  const payload = {
    player: userColor === 'w' ? game.white : userColor === 'b' ? game.black : null,
    playerColor: userColor === 'w' ? 'белые' : userColor === 'b' ? 'чёрные' : 'не указан',
    white: { name: game.white, elo: game.whiteElo, accuracy: review.white.accuracy, gameRating: review.white.rating },
    black: { name: game.black, elo: game.blackElo, accuracy: review.black.accuracy, gameRating: review.black.rating },
    result: game.result,
    timeControl: game.timeControl,
    opening: review.opening?.opening
      ? { eco: review.opening.opening.eco, name: review.opening.nameRu, leftBookAtPly: review.opening.exitPly }
      : null,
    moves: parsed.moves.map((move, index) => {
      const entry = review.moves[index]
      const important = entry && !['best', 'excellent', 'good', 'book'].includes(entry.moveClass)
      return {
        move: moveLabel(move.fenBefore, move.san, 'ru'),
        class: entry?.moveClass ?? null,
        evalAfter: formatScore(positions[index + 1]?.lines[0]?.score),
        winPercentLoss: entry ? Math.round(entry.loss) : null,
        best: important ? entry?.comment?.bestSan ?? null : undefined,
        comment: important && entry?.comment ? entry.comment.paragraphs.slice(1).map((paragraph) => paragraphToText(paragraph, 'ru')).join(' ') : undefined,
        secondsSpent: move.clockSeconds !== null ? entry?.secondsSpent ?? null : undefined
      }
    }),
    themes: review.themes.map((theme) => paragraphToText(theme.paragraph, 'ru')),
    summary: review.summary.map((paragraph) => paragraphToText(paragraph, 'ru'))
  }
  return JSON.stringify(payload)
}

export function CoachPanel(): React.JSX.Element {
  const model = useSettings((state) => state.settings.coachModel)
  const review = useReview((state) => state.review)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null)
  const payload = useMemo(() => buildCoachPayload(), [review])
  const estimate = payload ? estimateCost(model, estimateTokens(payload) + SYSTEM_PROMPT_TOKENS, EXPECTED_OUTPUT_TOKENS) : 0
  const modelLabel = COACH_MODELS.find((entry) => entry.id === model)?.label ?? model

  const run = async (): Promise<void> => {
    if (!payload) return
    setBusy(true)
    setError(null)
    const response = await window.api.coach.review({ model, payload })
    setBusy(false)
    if (response.error && !response.text) setError(response.error)
    else {
      setText(response.text)
      if (response.error) setError(response.error)
    }
    setUsage({ input: response.inputTokens, output: response.outputTokens })
  }

  return (
    <section className="panel coach-panel">
      <div className="panel-title-row">
        <h2>{ru.review.coach}</h2>
        <span className="spacer" />
        <button className="primary-button small" disabled={busy || !payload} onClick={() => void run()}>
          {busy ? ru.review.coachWorking : ru.review.coach}
        </button>
      </div>
      <p className="muted small">
        {modelLabel}. {ru.review.coachCost(`≈ $${estimate.toFixed(3)}`)}
      </p>
      {error && <p className="error-text">{error}</p>}
      {text && (
        <div className="coach-text">
          {text.split(/\n{2,}/).map((block, index) => (
            <p key={index}>{block}</p>
          ))}
        </div>
      )}
      {usage && usage.input > 0 && (
        <p className="muted small">
          Фактически: {usage.input} + {usage.output} токенов ≈ ${estimateCost(model, usage.input, usage.output).toFixed(3)}
        </p>
      )}
    </section>
  )
}
