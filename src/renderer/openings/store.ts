import { create } from 'zustand'
import { OpeningBook } from './book'
import { parseGuides, type OpeningGuide } from './guides'

interface OpeningsState {
  book: OpeningBook | null
  guides: OpeningGuide[]
  loading: boolean
  load: () => Promise<OpeningBook | null>
}

let pending: Promise<OpeningBook | null> | null = null

export const useOpenings = create<OpeningsState>((set, get) => ({
  book: null,
  guides: [],
  loading: false,
  load: () => {
    if (get().book) return Promise.resolve(get().book)
    if (pending) return pending
    set({ loading: true })
    pending = Promise.all([window.api.db.openingIndex(), window.api.app.readGuides()])
      .then(([payload, guidesJson]) => {
        const book = new OpeningBook(payload)
        set({ book, guides: parseGuides(guidesJson), loading: false })
        return book
      })
      .catch(() => {
        set({ loading: false })
        pending = null
        return null
      })
    return pending
  }
}))
