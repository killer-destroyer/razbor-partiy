import { create } from 'zustand'
import type { Color, GameAnalysisProgress, ParsedGame, PositionAnalysis, StoredGame } from '@shared/types'
import { compactReview } from '../analysis/compact'
import { storedFromPgn } from '../analysis/games'
import { isFen, parsedFromFen, parsePgn } from '../analysis/pgn'
import { buildReview, detectUserColor, type GameReview } from '../analysis/review'
import { SERIOUS_CLASSES } from '../analysis/classify'
import type { OpeningDetection } from '../openings/book'
import { useOpenings } from '../openings/store'
import { mistakeCards } from '../trainer/mistakeCards'
import { useSettings } from './settings'
import { REVIEW_MULTIPV } from '@shared/settings'

export type ReviewMode = 'overview' | 'all'

export interface RetryState {
  index: number
  attemptsLeft: number
  message: string | null
  solved: boolean
  hint: boolean
}

interface ReviewState {
  game: StoredGame | null
  parsed: ParsedGame | null
  positions: Array<PositionAnalysis | null>
  review: GameReview | null
  opening: OpeningDetection | null
  userColor: Color | null
  cursor: number
  orientation: 'white' | 'black'
  jobId: string | null
  progress: { done: number; total: number } | null
  status: string | null
  error: string | null
  mode: ReviewMode
  showBest: boolean
  autoplay: boolean
  retry: RetryState | null
  analysisDepth: number | null
  openStored: (game: StoredGame) => Promise<void>
  openText: (text: string) => Promise<'game' | 'fen' | 'error'>
  setUserColor: (color: Color | null) => void
  go: (cursor: number) => void
  step: (delta: number) => void
  flip: () => void
  setMode: (mode: ReviewMode) => void
  toggleBest: () => void
  setAutoplay: (on: boolean) => void
  startAnalysis: (force?: boolean) => Promise<void>
  stopAnalysis: () => Promise<void>
  nextMistake: () => void
  startRetry: (index?: number) => void
  attemptRetry: (uci: string) => void
  endRetry: () => void
  close: () => void
}

let recomputeTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribers: Array<() => void> = []

function newJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function analysisOptions() {
  const settings = useSettings.getState().settings
  return {
    depth: settings.analysisDepth,
    movetimeMs: settings.analysisLimit === 'time' ? settings.analysisMovetimeMs : null,
    multiPv: REVIEW_MULTIPV
  }
}

export const useReview = create<ReviewState>((set, get) => {
  const recompute = (immediate = false): void => {
    const run = (): void => {
      recomputeTimer = null
      const { parsed, positions, opening, userColor } = get()
      if (!parsed) return
      const review = buildReview({
        game: parsed,
        positions,
        opening,
        userColor,
        profile: useSettings.getState().settings.classificationProfile
      })
      set({ review })
    }
    if (immediate) {
      if (recomputeTimer) clearTimeout(recomputeTimer)
      run()
      return
    }
    if (!recomputeTimer) recomputeTimer = setTimeout(run, 250)
  }

  const finishAnalysis = async (): Promise<void> => {
    recompute(true)
    const { game, parsed, positions, review, opening } = get()
    if (!game || !parsed || !review || !review.complete) return
    const depth = analysisOptions().depth
    const compact = compactReview(review)
    const updated: StoredGame = {
      ...game,
      openingName: opening?.nameRu ?? game.openingName,
      accuracyWhite: review.white.accuracy,
      accuracyBlack: review.black.accuracy,
      ratingWhite: review.white.rating,
      ratingBlack: review.black.rating,
      analyzedDepth: depth,
      userColor: get().userColor
    }
    set({ game: updated, analysisDepth: depth })
    await window.api.db.saveGame(updated)
    await window.api.db.saveAnalysis(game.id, depth, positions as PositionAnalysis[], JSON.stringify(compact))
    const title = `${updated.white} — ${updated.black}`
    for (const card of mistakeCards(game.id, title, parsed, positions, review)) {
      const existing = await window.api.db.listCards('mistake')
      if (!existing.some((candidate) => candidate.id === card.id)) await window.api.db.upsertCard(card)
    }
  }

  const ensureSubscriptions = (): void => {
    if (unsubscribers.length) return
    unsubscribers = [
      window.api.engine.onProgress((progress: GameAnalysisProgress) => {
        if (progress.jobId !== get().jobId) return
        const positions = [...get().positions]
        positions[progress.index] = progress.analysis
        const done = positions.filter(Boolean).length
        set({ positions, progress: { done, total: progress.total } })
        recompute()
      }),
      window.api.engine.onDone((done) => {
        if (done.jobId !== get().jobId) return
        const total = get().positions.length
        set({
          jobId: null,
          progress: null,
          error: done.error,
          status: done.cancelled ? 'stopped' : done.error ? null : `done:${total - 1}`
        })
        if (!done.cancelled && !done.error) void finishAnalysis()
        else recompute(true)
      })
    ]
  }

  const loadParsed = async (game: StoredGame, parsed: ParsedGame): Promise<void> => {
    ensureSubscriptions()
    const previousJob = get().jobId
    if (previousJob) await window.api.engine.cancelGame(previousJob)
    const book = await useOpenings.getState().load()
    const opening = book ? book.detect(parsed.fens, parsed.moves.map((move) => move.uci)) : null
    const settings = useSettings.getState().settings
    const userColor = game.userColor ?? detectUserColor(parsed.headers, settings.chesscomUsername)
    set({
      game: { ...game, userColor },
      parsed,
      opening,
      userColor,
      positions: new Array(parsed.fens.length).fill(null),
      review: null,
      cursor: 0,
      orientation: userColor === 'b' ? 'black' : 'white',
      jobId: null,
      progress: null,
      status: null,
      error: null,
      retry: null,
      autoplay: false,
      analysisDepth: null,
      mode: 'all'
    })
    const stored = await window.api.db.getAnalysis(game.id)
    const options = analysisOptions()
    if (stored && stored.positions.length === parsed.fens.length && stored.depth >= options.depth) {
      set({ positions: stored.positions, analysisDepth: stored.depth })
      recompute(true)
      if (get().review?.complete) set({ mode: 'overview' })
      return
    }
    recompute(true)
    await get().startAnalysis()
  }

  return {
    game: null,
    parsed: null,
    positions: [],
    review: null,
    opening: null,
    userColor: null,
    cursor: 0,
    orientation: 'white',
    jobId: null,
    progress: null,
    status: null,
    error: null,
    mode: 'all',
    showBest: true,
    autoplay: false,
    retry: null,
    analysisDepth: null,

    openStored: async (game) => {
      try {
        const parsed = parsePgn(game.pgn)
        await loadParsed(game, parsed)
      } catch (error) {
        set({ error: (error as Error).message })
      }
    },

    openText: async (text) => {
      const trimmed = text.trim()
      if (!trimmed) return 'error'
      if (isFen(trimmed)) {
        try {
          parsedFromFen(trimmed)
          return 'fen'
        } catch (error) {
          set({ error: (error as Error).message })
          return 'error'
        }
      }
      try {
        const parsed = parsePgn(trimmed)
        const settings = useSettings.getState().settings
        const stored = storedFromPgn(trimmed, settings.chesscomUsername)
        const existing = await window.api.db.getGame(stored.id)
        const game = existing ?? stored
        if (!existing) await window.api.db.saveGame(game)
        await loadParsed(game, parsed)
        return 'game'
      } catch (error) {
        set({ error: (error as Error).message })
        return 'error'
      }
    },

    setUserColor: (color) => {
      const game = get().game
      set({ userColor: color, orientation: color === 'b' ? 'black' : 'white', game: game ? { ...game, userColor: color } : game })
      if (game) void window.api.db.saveGame({ ...game, userColor: color })
      recompute(true)
    },

    go: (cursor) => {
      const parsed = get().parsed
      if (!parsed) return
      set({ cursor: Math.max(0, Math.min(parsed.moves.length, cursor)), retry: null })
    },

    step: (delta) => get().go(get().cursor + delta),

    flip: () => set({ orientation: get().orientation === 'white' ? 'black' : 'white' }),

    setMode: (mode) => set({ mode }),

    toggleBest: () => set({ showBest: !get().showBest }),

    setAutoplay: (autoplay) => set({ autoplay }),

    startAnalysis: async (force = false) => {
      const { parsed, game } = get()
      if (!parsed || !game) return
      ensureSubscriptions()
      const status = await window.api.engine.status()
      if (!status.ready) {
        set({ error: status.error ?? 'Движок не запущен' })
        return
      }
      const jobId = newJobId()
      const positions = force ? new Array(parsed.fens.length).fill(null) : get().positions
      set({ jobId, positions, progress: { done: positions.filter(Boolean).length, total: parsed.fens.length }, error: null, status: null })
      void window.api.engine.analyzeGame({ jobId, gameId: game.id, fens: parsed.fens, options: analysisOptions(), priority: 'foreground' })
    },

    stopAnalysis: async () => {
      const jobId = get().jobId
      if (jobId) await window.api.engine.cancelGame(jobId)
    },

    nextMistake: () => {
      const { review, cursor, userColor } = get()
      if (!review) return
      const candidates = review.moves
        .filter((entry) => entry && SERIOUS_CLASSES.concat(['inaccuracy']).includes(entry.moveClass))
        .filter((entry) => !userColor || entry!.color === userColor)
        .map((entry) => entry!.index + 1)
      const next = candidates.find((ply) => ply > cursor) ?? candidates[0]
      if (next !== undefined) get().go(next)
    },

    startRetry: (index) => {
      const { review, cursor, userColor } = get()
      if (!review) return
      let target = index
      if (target === undefined) {
        const current = cursor > 0 ? review.moves[cursor - 1] : null
        if (current && SERIOUS_CLASSES.concat(['inaccuracy']).includes(current.moveClass)) target = current.index
        else {
          const candidates = review.moves.filter(
            (entry) => entry && SERIOUS_CLASSES.includes(entry.moveClass) && (!userColor || entry.color === userColor)
          )
          target = (candidates.find((entry) => entry!.index >= cursor) ?? candidates[0])?.index
        }
      }
      if (target === undefined) return
      set({ cursor: target, retry: { index: target, attemptsLeft: 3, message: null, solved: false, hint: false }, autoplay: false })
    },

    attemptRetry: (uci) => {
      const { retry, positions } = get()
      if (!retry || retry.solved) return
      const before = positions[retry.index]
      const top = before?.lines[0]
      if (!before || !top) return
      if (top.pv[0] === uci) {
        set({ retry: { ...retry, solved: true, message: 'solved' } })
        return
      }
      const color = before.fen.split(' ')[1] === 'b' ? 'b' : 'w'
      const sign = color === 'w' ? 1 : -1
      const topCp = top.score.type === 'cp' ? top.score.cp * sign : top.score.winner === color ? 10000 : -10000
      const alternative = before.lines.find((line) => line.pv[0] === uci)
      if (alternative) {
        const altCp = alternative.score.type === 'cp' ? alternative.score.cp * sign : alternative.score.winner === color ? 10000 : -10000
        if (topCp - altCp <= 30) {
          set({ retry: { ...retry, solved: true, message: 'good' } })
          return
        }
      }
      const attemptsLeft = retry.attemptsLeft - 1
      set({ retry: { ...retry, attemptsLeft, message: 'wrong', hint: attemptsLeft <= 0 } })
    },

    endRetry: () => set({ retry: null }),

    close: () => set({ game: null, parsed: null, review: null, positions: [], cursor: 0 })
  }
})
