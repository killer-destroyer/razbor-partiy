import { create } from 'zustand'
import type { Color, OpeningRecord, TrainerCard } from '@shared/types'
import { newCard } from '../trainer/srs'

export interface OpeningPayload {
  openingId: number
  color: Color
  uci: string[]
  name: string
  eco: string
}

interface TrainerState {
  activeCard: TrainerCard | null
  tab: 'openings' | 'mistakes'
  startOpening: (opening: OpeningRecord, color: Color) => Promise<void>
  startCard: (card: TrainerCard) => void
  setTab: (tab: 'openings' | 'mistakes') => void
  clear: () => void
}

export function openingCardId(openingId: number, color: Color): string {
  return `opening:${openingId}:${color}`
}

export async function ensureOpeningCard(opening: OpeningRecord, color: Color): Promise<TrainerCard> {
  const id = openingCardId(opening.id, color)
  const existing = (await window.api.db.listCards('opening')).find((card) => card.id === id)
  if (existing) return existing
  const payload: OpeningPayload = { openingId: opening.id, color, uci: opening.uci, name: opening.name, eco: opening.eco }
  const card = newCard(id, 'opening', payload, opening.eco)
  await window.api.db.upsertCard(card)
  return card
}

export const useTrainer = create<TrainerState>((set) => ({
  activeCard: null,
  tab: 'openings',
  startOpening: async (opening, color) => {
    const card = await ensureOpeningCard(opening, color)
    set({ activeCard: card, tab: 'openings' })
  },
  startCard: (card) => set({ activeCard: card, tab: card.kind === 'opening' ? 'openings' : 'mistakes' }),
  setTab: (tab) => set({ tab, activeCard: null }),
  clear: () => set({ activeCard: null })
}))
