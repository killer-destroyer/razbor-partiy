import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await window.api.settings.get()
    set({ settings, loaded: true })
    window.api.settings.onChange((next) => set({ settings: next }))
  },
  update: async (patch) => {
    set({ settings: { ...get().settings, ...patch } })
    const saved = await window.api.settings.set(patch)
    set({ settings: saved })
  }
}))
