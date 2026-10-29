import { describe, expect, it, vi } from 'vitest'
import { detectFork, hangingPieces, pawnStructure, staticExchange } from '@renderer/analysis/features'
import { isEndgamePosition } from '@renderer/analysis/material'
import { newCard, reviewCard, dueCards, DAY_MS } from '@renderer/trainer/srs'
import { ChesscomClient, parseGameUrl, toSummary } from '../src/main/chesscom'
import { GameWatcher } from '../src/main/watcher'
import { parseInfoLine } from '../src/main/uci'
import { formatTimeControl, openingFromEcoUrl, storedFromPgn, timeClassFromControl } from '@renderer/analysis/games'
import type { AppDatabase } from '../src/main/db'

describe('тактические признаки', () => {
  it('размен на защищённом поле не выигрывает материал', () => {
    expect(staticExchange('4k3/8/8/3p4/2P5/8/8/4K3 w - - 0 1', 'd5', 'w')).toBe(1)
    expect(staticExchange('4k3/8/2p5/3p4/2P5/8/8/4K3 w - - 0 1', 'd5', 'w')).toBe(0)
    expect(staticExchange('4k3/8/2p5/3n4/8/8/3Q4/4K3 w - - 0 1', 'd5', 'w')).toBeLessThan(0)
  })

  it('находит висящие фигуры', () => {
    const hanging = hangingPieces('4k3/8/8/3n4/8/8/3R4/4K3 b - - 0 1', 'b')
    expect(hanging.map((piece) => piece.square)).toEqual(['d5'])
  })

  it('находит вилку конём', () => {
    const fork = detectFork('r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1', 'c7')
    expect(fork?.targets.map((target) => target.type).sort()).toEqual(['k', 'r'])
  })

  it('видит сдвоенные, изолированные и проходные пешки', () => {
    const structure = pawnStructure('4k3/8/8/8/8/2P5/P1P3P1/4K3 w - - 0 1', 'w')
    expect(structure.doubled).toEqual(['c'])
    expect(structure.isolated.sort()).toEqual(['a', 'c', 'g'])
    expect(structure.passed.length).toBe(4)
  })

  it('определяет эндшпиль', () => {
    expect(isEndgamePosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(false)
    expect(isEndgamePosition('4k3/pp3ppp/8/8/8/8/PP3PPP/R3K2R w - - 0 1')).toBe(true)
  })
})

describe('интервальные повторения SM-2', () => {
  it('верный ответ увеличивает интервал', () => {
    const card = newCard('x', 'opening', {}, null, 0)
    const first = reviewCard(card, 5, 0)
    expect(first.intervalDays).toBe(1)
    const second = reviewCard(first, 5, 0)
    expect(second.intervalDays).toBe(6)
    const third = reviewCard(second, 4, 0)
    expect(third.intervalDays).toBeGreaterThan(6)
    expect(third.dueAt).toBe(third.intervalDays * DAY_MS)
  })

  it('ошибка возвращает карточку через 10 минут и снижает лёгкость', () => {
    const card = reviewCard(reviewCard(newCard('x', 'mistake', {}, null, 0), 5, 0), 1, 1000)
    expect(card.repetitions).toBe(0)
    expect(card.lapses).toBe(1)
    expect(card.dueAt).toBe(1000 + 10 * 60 * 1000)
    expect(card.easiness).toBeLessThan(2.6)
  })

  it('трудные карточки возвращаются раньше', () => {
    const easy = reviewCard(reviewCard(reviewCard(newCard('a', 'opening', {}, null, 0), 5, 0), 5, 0), 5, 0)
    const hard = reviewCard(reviewCard(reviewCard(newCard('b', 'opening', {}, null, 0), 3, 0), 3, 0), 3, 0)
    expect(hard.intervalDays).toBeLessThan(easy.intervalDays)
    expect(dueCards([easy, hard], Number.MAX_SAFE_INTEGER).map((card) => card.id)).toEqual(['b', 'a'])
  })
})

const rawGame = (id: number, endTime: number) => ({
  url: `https://www.chess.com/game/live/${id}`,
  pgn: `[White "Arsenkryt"]\n[Black "Opp${id}"]\n[ECOUrl "https://www.chess.com/openings/Slav-Defense-Modern-Three-Knights-Variation"]\n\n1. d4 d5 1-0`,
  time_control: '600',
  time_class: 'rapid',
  end_time: endTime,
  rated: true,
  rules: 'chess',
  white: { username: 'Arsenkryt', rating: 1024, result: 'win' },
  black: { username: `Opp${id}`, rating: 1000, result: 'resigned' }
})

describe('клиент chess.com', () => {
  it('ходит только на api.chess.com с нужным User-Agent и ником в нижнем регистре', async () => {
    const fetcher = vi.fn(async (url: string, _init: { headers: Record<string, string> }) => ({
      status: 200,
      headers: { get: () => null },
      json: async () => (url.endsWith('/archives') ? { archives: ['https://api.chess.com/pub/player/arsenkryt/games/2026/10'] } : { games: [rawGame(1, 100), rawGame(2, 200)] })
    }))
    const client = new ChesscomClient(fetcher)
    const games = await client.recentGames('Arsenkryt', 50)
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.chess.com/pub/player/arsenkryt/games/archives')
    const userAgent = fetcher.mock.calls[0]![1].headers['User-Agent']
    expect(userAgent).toMatch(/^RazborPartiy\/1\.0/)
    expect(/^[\x20-\x7e]+$/.test(userAgent)).toBe(true)
    expect(games.map((game) => game.endTime)).toEqual([200, 100])
  })

  it('повторяет запрос после 429', async () => {
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls += 1
      if (calls === 1) return { status: 429, headers: { get: () => '0.01' }, json: async () => ({}) }
      return { status: 200, headers: { get: () => null }, json: async () => ({ archives: [] }) }
    })
    const client = new ChesscomClient(fetcher)
    expect(await client.archives('Arsenkryt')).toEqual([])
    expect(calls).toBe(2)
  })

  it('не ходит на чужие хосты', async () => {
    const client = new ChesscomClient(vi.fn())
    await expect(client.month('https://example.com/x')).rejects.toThrow('не разрешён')
  })

  it('разбирает ссылку на партию', () => {
    expect(parseGameUrl('https://www.chess.com/game/live/186132323386')).toEqual({ kind: 'live', id: '186132323386', username: null })
    expect(parseGameUrl('https://www.chess.com/game/daily/123?username=Arsenkryt')?.username).toBe('Arsenkryt')
    expect(parseGameUrl('https://lichess.org/abc')).toBeNull()
  })

  it('преобразует партию API', () => {
    const summary = toSummary(rawGame(5, 300))!
    expect(summary.ecoUrl).toContain('Slav-Defense')
    expect(openingFromEcoUrl(summary.ecoUrl)).toBe('Slav Defense Modern Three Knights Variation')
  })
})

describe('автоотслеживание', () => {
  function fakeDb() {
    const values = new Map<string, unknown>()
    const games = new Map<string, unknown>()
    return {
      getValue: (key: string) => (values.has(key) ? values.get(key) : null),
      setValue: (key: string, value: unknown) => values.set(key, value),
      hasGame: (id: string) => games.has(id),
      saveGame: (game: { id: string }) => games.set(game.id, game),
      games
    }
  }

  it('при первом включении не трогает старые партии, а потом ловит новую завершённую', async () => {
    let served = [rawGame(1, 100)]
    const client = new ChesscomClient(async () => ({ status: 200, headers: { get: () => null }, json: async () => ({ games: served }) }))
    const db = fakeDb()
    const found: string[][] = []
    const watcher = new GameWatcher(client, db as unknown as AppDatabase, (ids) => found.push(ids), () => undefined)
    await watcher.start('Arsenkryt')
    await watcher.check()
    expect(found).toEqual([])
    served = [rawGame(1, 100), rawGame(2, 200)]
    await watcher.check()
    watcher.stop()
    expect(found).toEqual([['cc:live/2']])
    expect(db.games.has('cc:live/2')).toBe(true)
  })
})

describe('прочее', () => {
  it('разбирает строки info от Stockfish', () => {
    const line = parseInfoLine('info depth 20 seldepth 28 multipv 2 score cp -35 nodes 1 nps 1 time 1 pv e7e5 g1f3', 'b')
    expect(line).toEqual({ multipv: 2, depth: 20, score: { type: 'cp', cp: 35 }, pv: ['e7e5', 'g1f3'] })
    expect(parseInfoLine('info depth 20 score cp 10 lowerbound pv e2e4', 'w')).toBeNull()
    expect(parseInfoLine('info depth 5 score mate 3 pv h5f7', 'w')?.score).toEqual({ type: 'mate', moves: 3, winner: 'w' })
  })

  it('определяет контроль времени и цвет пользователя', () => {
    expect(timeClassFromControl('180+2')).toBe('blitz')
    expect(timeClassFromControl('600')).toBe('rapid')
    expect(timeClassFromControl('60')).toBe('bullet')
    expect(timeClassFromControl('1/86400')).toBe('daily')
    expect(formatTimeControl('180+2')).toBe('3+2')
    expect(formatTimeControl('600')).toBe('10 мин')
    expect(storedFromPgn('[White "arsenkryt"]\n[Black "x"]\n\n1. e4', 'Arsenkryt').userColor).toBe('w')
  })
})
