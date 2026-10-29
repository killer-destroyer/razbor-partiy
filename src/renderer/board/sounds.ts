import type { Settings } from '@shared/settings'

export type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'gameEnd'

let context: AudioContext | null = null

function audio(): AudioContext {
  if (!context) context = new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

function envelope(gain: GainNode, start: number, attack: number, decay: number, peak: number): void {
  gain.gain.cancelScheduledValues(start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay)
}

function knock(ctx: AudioContext, destination: AudioNode, start: number, pitch: number, level: number, length = 0.09): void {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < data.length; index += 1) {
    const t = index / data.length
    data[index] = (Math.random() * 2 - 1) * Math.pow(1 - t, 6)
  }
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = pitch * 6
  band.Q.value = 1.4
  const noiseGain = ctx.createGain()
  envelope(noiseGain, start, 0.002, length, level * 0.9)
  noise.connect(band).connect(noiseGain).connect(destination)
  noise.start(start)
  noise.stop(start + length + 0.02)

  const body = ctx.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(pitch * 1.6, start)
  body.frequency.exponentialRampToValueAtTime(pitch, start + 0.05)
  const bodyGain = ctx.createGain()
  envelope(bodyGain, start, 0.003, 0.11, level * 0.7)
  body.connect(bodyGain).connect(destination)
  body.start(start)
  body.stop(start + 0.16)
}

function tone(ctx: AudioContext, destination: AudioNode, start: number, frequency: number, duration: number, level: number, type: OscillatorType = 'sine'): void {
  const oscillator = ctx.createOscillator()
  oscillator.type = type
  oscillator.frequency.value = frequency
  const gain = ctx.createGain()
  envelope(gain, start, 0.01, duration, level)
  oscillator.connect(gain).connect(destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.05)
}

const ENABLED_KEY: Record<SoundKind, keyof Settings> = {
  move: 'soundMove',
  capture: 'soundCapture',
  check: 'soundCheck',
  castle: 'soundCastle',
  promote: 'soundPromote',
  gameEnd: 'soundGameEnd'
}

export function playSound(kind: SoundKind, settings: Settings): void {
  if (!settings.soundEnabled || !settings[ENABLED_KEY[kind]]) return
  let ctx: AudioContext
  try {
    ctx = audio()
  } catch {
    return
  }
  const master = ctx.createGain()
  master.gain.value = Math.max(0, Math.min(1, settings.soundVolume))
  master.connect(ctx.destination)
  const now = ctx.currentTime + 0.005
  switch (kind) {
    case 'move':
      knock(ctx, master, now, 180, 0.55)
      break
    case 'capture':
      knock(ctx, master, now, 140, 0.8, 0.12)
      knock(ctx, master, now + 0.035, 230, 0.45)
      break
    case 'check':
      knock(ctx, master, now, 180, 0.5)
      tone(ctx, master, now + 0.02, 880, 0.18, 0.18, 'triangle')
      tone(ctx, master, now + 0.1, 1175, 0.2, 0.14, 'triangle')
      break
    case 'castle':
      knock(ctx, master, now, 170, 0.55)
      knock(ctx, master, now + 0.09, 200, 0.5)
      break
    case 'promote':
      knock(ctx, master, now, 180, 0.5)
      ;[660, 880, 1320].forEach((frequency, index) => tone(ctx, master, now + 0.05 + index * 0.07, frequency, 0.22, 0.14, 'sine'))
      break
    case 'gameEnd':
      ;[523, 659, 784].forEach((frequency) => tone(ctx, master, now, frequency, 0.9, 0.12, 'sine'))
      tone(ctx, master, now + 0.25, 1047, 0.8, 0.08, 'sine')
      break
  }
}

export function soundForSan(san: string, gameOver: boolean): SoundKind {
  if (gameOver || san.includes('#')) return 'gameEnd'
  if (san.includes('=')) return 'promote'
  if (san.includes('+')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}
