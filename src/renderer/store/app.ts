import { create } from 'zustand'

export type Screen = 'review' | 'import' | 'puzzles' | 'play' | 'course' | 'openings' | 'trainer' | 'stats' | 'free' | 'settings'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
  action?: { label: string; run: () => void }
}

interface AppState {
  screen: Screen
  toasts: Toast[]
  aboutOpen: boolean
  shortcutsOpen: boolean
  freeAnalysisFen: string | null
  setScreen: (screen: Screen) => void
  toast: (text: string, kind?: Toast['kind'], action?: Toast['action']) => void
  dismiss: (id: number) => void
  setAbout: (open: boolean) => void
  setShortcuts: (open: boolean) => void
  openFreeAnalysis: (fen: string | null) => void
}

let nextToastId = 1

export const useApp = create<AppState>((set, get) => ({
  screen: 'review',
  toasts: [],
  aboutOpen: false,
  shortcutsOpen: false,
  freeAnalysisFen: null,
  setScreen: (screen) => set({ screen }),
  toast: (text, kind = 'info', action) => {
    const id = nextToastId++
    set({ toasts: [...get().toasts, { id, text, kind, action }] })
    setTimeout(() => get().dismiss(id), action ? 9000 : 5000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  setAbout: (aboutOpen) => set({ aboutOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  openFreeAnalysis: (fen) => set({ freeAnalysisFen: fen, screen: 'free' })
}))
