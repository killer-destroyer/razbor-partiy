import type { ChesscomGameSummary, Color, StoredGame, TimeClass } from '@shared/types'
import { parseHeaders } from './pgn'

export function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  let second = 0x9e3779b9
  for (let index = value.length - 1; index >= 0; index -= 1) {
    second ^= value.charCodeAt(index)
    second = Math.imul(second, 0x85ebca6b) >>> 0
  }
  return hash.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0')
}

export function chesscomGameId(url: string): string {
  return `cc:${url.split('/').filter(Boolean).slice(-2).join('/')}`
}

export function resultFromPlayers(summary: ChesscomGameSummary): string {
  if (summary.white.result === 'win') return '1-0'
  if (summary.black.result === 'win') return '0-1'
  return '1/2-1/2'
}

export function timeClassFromControl(timeControl: string | undefined): TimeClass {
  if (!timeControl) return 'unknown'
  if (timeControl.includes('/')) return 'daily'
  const match = timeControl.match(/^(\d+)(?:\+(\d+))?/)
  if (!match) return 'unknown'
  const total = Number(match[1]) + 40 * Number(match[2] ?? 0)
  if (total < 180) return 'bullet'
  if (total < 600) return 'blitz'
  if (total < 1800) return 'rapid'
  return 'classical'
}

export function storedFromChesscom(summary: ChesscomGameSummary, username: string): StoredGame {
  const nick = username.trim().toLowerCase()
  const userColor: Color | null =
    summary.white.username.toLowerCase() === nick ? 'w' : summary.black.username.toLowerCase() === nick ? 'b' : null
  return {
    id: chesscomGameId(summary.url),
    source: 'chesscom',
    url: summary.url,
    pgn: summary.pgn,
    white: summary.white.username,
    black: summary.black.username,
    whiteElo: summary.white.rating,
    blackElo: summary.black.rating,
    result: resultFromPlayers(summary),
    endTime: summary.endTime * 1000,
    timeClass: summary.timeClass,
    timeControl: summary.timeControl,
    userColor,
    ecoUrl: summary.ecoUrl,
    openingName: null,
    accuracyWhite: null,
    accuracyBlack: null,
    ratingWhite: null,
    ratingBlack: null,
    analyzedDepth: null,
    importedAt: Date.now()
  }
}

function parseDate(headers: Record<string, string>): number | null {
  const date = headers.UTCDate ?? headers.Date
  if (!date || date.includes('?')) return null
  const time = headers.UTCTime ?? headers.EndTime ?? '00:00:00'
  const parsed = Date.parse(`${date.replace(/\./g, '-')}T${time.split(' ')[0]}Z`)
  return Number.isFinite(parsed) ? parsed : null
}

export function storedFromPgn(pgn: string, username: string, forcedColor: Color | null = null): StoredGame {
  const headers = parseHeaders(pgn)
  const nick = username.trim().toLowerCase()
  const detected: Color | null =
    nick && (headers.White ?? '').toLowerCase() === nick ? 'w' : nick && (headers.Black ?? '').toLowerCase() === nick ? 'b' : null
  const link = headers.Link ?? (headers.Site?.startsWith('http') ? headers.Site : null)
  return {
    id: link && /chess\.com\/game/.test(link) ? chesscomGameId(link) : `pgn:${stableHash(pgn.trim())}`,
    source: 'pgn',
    url: link ?? null,
    pgn,
    white: headers.White ?? 'Белые',
    black: headers.Black ?? 'Чёрные',
    whiteElo: headers.WhiteElo ? Number(headers.WhiteElo) || null : null,
    blackElo: headers.BlackElo ? Number(headers.BlackElo) || null : null,
    result: headers.Result ?? '*',
    endTime: parseDate(headers),
    timeClass: timeClassFromControl(headers.TimeControl),
    timeControl: headers.TimeControl ?? null,
    userColor: forcedColor ?? detected,
    ecoUrl: headers.ECOUrl ?? null,
    openingName: null,
    accuracyWhite: null,
    accuracyBlack: null,
    ratingWhite: null,
    ratingBlack: null,
    analyzedDepth: null,
    importedAt: Date.now()
  }
}

export function openingFromEcoUrl(ecoUrl: string | null | undefined): string | null {
  if (!ecoUrl) return null
  const slug = ecoUrl.split('/openings/')[1]
  if (!slug) return null
  return decodeURIComponent(slug)
    .replace(/-\d+\..*$/, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatTimeControl(timeControl: string | null | undefined): string {
  if (!timeControl) return '—'
  if (timeControl.includes('/')) {
    const seconds = Number(timeControl.split('/')[1])
    const days = Math.round(seconds / 86400)
    return `${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`
  }
  const [base, increment] = timeControl.split('+').map(Number)
  const minutes = base / 60
  const baseText = minutes >= 1 ? `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}` : `${base} с`
  return increment ? `${baseText}+${increment}` : `${baseText} мин`
}
