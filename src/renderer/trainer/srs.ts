import type { TrainerCard } from '@shared/types'

export const DAY_MS = 24 * 60 * 60 * 1000
export const RELEARN_DELAY_MS = 10 * 60 * 1000

export function newCard(id: string, kind: TrainerCard['kind'], payload: unknown, theme: string | null, now = Date.now()): TrainerCard {
  return {
    id,
    kind,
    payload: JSON.stringify(payload),
    theme,
    easiness: 2.5,
    intervalDays: 0,
    repetitions: 0,
    dueAt: now,
    lapses: 0,
    createdAt: now
  }
}

export function reviewCard(card: TrainerCard, quality: number, now = Date.now()): TrainerCard {
  const q = Math.max(0, Math.min(5, Math.round(quality)))
  const easiness = Math.max(1.3, card.easiness + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  if (q < 3) {
    return { ...card, easiness, repetitions: 0, intervalDays: 0, lapses: card.lapses + 1, dueAt: now + RELEARN_DELAY_MS }
  }
  const repetitions = card.repetitions + 1
  const intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(card.intervalDays * easiness * 10) / 10
  return { ...card, easiness, repetitions, intervalDays, dueAt: now + intervalDays * DAY_MS }
}

export function qualityFromAttempts(mistakes: number, usedHint: boolean): number {
  if (usedHint) return 1
  if (mistakes === 0) return 5
  if (mistakes === 1) return 3
  return 2
}

export function dueCards(cards: TrainerCard[], now = Date.now()): TrainerCard[] {
  return cards.filter((card) => card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)
}
