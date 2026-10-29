export interface BoardTheme {
  id: string
  name: string
  light: string
  dark: string
  texture: 'flat' | 'wood' | 'marble'
  lastMove: string
  coordLight: string
  coordDark: string
}

export const BOARD_THEMES: BoardTheme[] = [
  { id: 'gray', name: 'Серая', light: '#D8D9D8', dark: '#A8A9A8', texture: 'flat', lastMove: 'rgba(255, 255, 51, 0.45)', coordLight: '#A8A9A8', coordDark: '#D8D9D8' },
  { id: 'green', name: 'Зелёная (классика)', light: '#EBECD0', dark: '#779556', texture: 'flat', lastMove: 'rgba(255, 255, 51, 0.5)', coordLight: '#779556', coordDark: '#EBECD0' },
  { id: 'brown', name: 'Коричневая', light: '#F0D9B5', dark: '#B58863', texture: 'flat', lastMove: 'rgba(205, 210, 106, 0.75)', coordLight: '#B58863', coordDark: '#F0D9B5' },
  { id: 'blue', name: 'Синяя', light: '#DEE3E6', dark: '#8CA2AD', texture: 'flat', lastMove: 'rgba(155, 199, 0, 0.45)', coordLight: '#8CA2AD', coordDark: '#DEE3E6' },
  { id: 'ice', name: 'Ледяная', light: '#E9F3F9', dark: '#9FC1DA', texture: 'flat', lastMove: 'rgba(120, 210, 255, 0.45)', coordLight: '#7EA6C4', coordDark: '#E9F3F9' },
  { id: 'marble', name: 'Мрамор', light: '#E8E6E1', dark: '#9A958C', texture: 'marble', lastMove: 'rgba(255, 233, 92, 0.45)', coordLight: '#8A857C', coordDark: '#E8E6E1' },
  { id: 'wood', name: 'Дерево', light: '#E6C08E', dark: '#A8703F', texture: 'wood', lastMove: 'rgba(230, 230, 80, 0.5)', coordLight: '#8A5A31', coordDark: '#E6C08E' },
  { id: 'purple', name: 'Фиолетовая', light: '#EAE3F2', dark: '#8E79B5', texture: 'flat', lastMove: 'rgba(255, 220, 100, 0.5)', coordLight: '#8E79B5', coordDark: '#EAE3F2' },
  { id: 'dark', name: 'Тёмная', light: '#6E7179', dark: '#45484F', texture: 'flat', lastMove: 'rgba(210, 190, 70, 0.45)', coordLight: '#45484F', coordDark: '#9EA1A8' },
  { id: 'red', name: 'Красная', light: '#F3DCD4', dark: '#B8574D', texture: 'flat', lastMove: 'rgba(255, 220, 90, 0.55)', coordLight: '#B8574D', coordDark: '#F3DCD4' },
  { id: 'sand', name: 'Песочная', light: '#F4E7C8', dark: '#C9A66B', texture: 'flat', lastMove: 'rgba(160, 200, 80, 0.5)', coordLight: '#A9864B', coordDark: '#F4E7C8' },
  { id: 'night', name: 'Ночная', light: '#9DACB8', dark: '#4F6272', texture: 'flat', lastMove: 'rgba(110, 200, 255, 0.4)', coordLight: '#4F6272', coordDark: '#C6D1DA' }
]

export function themeById(id: string): BoardTheme {
  return BOARD_THEMES.find((theme) => theme.id === id) ?? BOARD_THEMES[0]
}

const cache = new Map<string, string>()

function checkerSvg(light: string, dark: string): string {
  const squares: string[] = []
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      if ((rank + file) % 2 === 1) squares.push(`M${file} ${rank}h1v1h-1z`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="${light}"/><path fill="${dark}" d="${squares.join('')}"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function makeNoise(seed: number): (x: number, y: number) => number {
  const random = seededRandom(seed)
  const size = 256
  const values = Array.from({ length: size * size }, () => random())
  const at = (x: number, y: number): number => values[((y & (size - 1)) * size + (x & (size - 1))) >>> 0]
  const smooth = (t: number): number => t * t * (3 - 2 * t)
  return (x, y) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = smooth(x - x0)
    const fy = smooth(y - y0)
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
    return top * (1 - fy) + bottom * fy
  }
}

function fractal(noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let total = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise(x * frequency, y * frequency) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return total / norm
}

function texturedBoard(theme: BoardTheme): string {
  const size = 640
  const square = size / 8
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return checkerSvg(theme.light, theme.dark)
  const image = context.createImageData(size, size)
  const light = hexToRgb(theme.light)
  const dark = hexToRgb(theme.dark)
  const noise = makeNoise(theme.texture === 'wood' ? 7 : 11)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const file = Math.floor(x / square)
      const rank = Math.floor(y / square)
      const isDark = (file + rank) % 2 === 1
      const base = isDark ? dark : light
      let shade: number
      if (theme.texture === 'wood') {
        const horizontal = (file + rank) % 2 === 0
        const u = horizontal ? x : y
        const v = horizontal ? y : x
        const offset = (file * 37 + rank * 91) % 200
        const grain = Math.sin((v + offset) * 0.09 + fractal(noise, u * 0.012 + offset, v * 0.05, 4) * 9)
        shade = 0.9 + grain * 0.06 + fractal(noise, u * 0.08, v * 0.4 + offset, 2) * 0.08
      } else {
        const turbulence = fractal(noise, x * 0.01, y * 0.01, 5)
        const vein = Math.abs(Math.sin((x * 0.6 + y * 0.9) * 0.02 + turbulence * 10))
        shade = 0.92 + Math.pow(vein, 0.35) * 0.1 - (vein < 0.08 ? 0.12 : 0)
      }
      const index = (y * size + x) * 4
      image.data[index] = Math.min(255, base[0] * shade)
      image.data[index + 1] = Math.min(255, base[1] * shade)
      image.data[index + 2] = Math.min(255, base[2] * shade)
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

export function boardBackground(theme: BoardTheme): string {
  const key = `${theme.id}:${theme.light}:${theme.dark}`
  const cached = cache.get(key)
  if (cached) return cached
  const url = theme.texture === 'flat' ? checkerSvg(theme.light, theme.dark) : texturedBoard(theme)
  cache.set(key, url)
  return url
}
