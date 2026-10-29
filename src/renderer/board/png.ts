import { boardFromFen } from '../analysis/material'
import { pieceUrl } from './pieces'
import { boardBackground, type BoardTheme } from './themes'

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

export async function renderPositionPng(fen: string, orientation: 'white' | 'black', theme: BoardTheme, pieceSet: string, size = 800): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const background = await loadImage(boardBackground(theme))
  context.drawImage(background, 0, 0, size, size)
  const square = size / 8
  const pieces = boardFromFen(fen)
  await Promise.all(
    pieces.map(async (piece) => {
      const url = pieceUrl(pieceSet, piece.color, piece.type)
      if (!url) return
      const image = await loadImage(url)
      const file = 'abcdefgh'.indexOf(piece.square[0])
      const rank = Number(piece.square[1]) - 1
      const column = orientation === 'white' ? file : 7 - file
      const row = orientation === 'white' ? 7 - rank : rank
      context.drawImage(image, column * square, row * square, square, square)
    })
  )
  context.font = `600 ${Math.round(square * 0.16)}px "IBM Plex Mono", monospace`
  for (let index = 0; index < 8; index += 1) {
    const fileLabel = orientation === 'white' ? 'abcdefgh'[index] : 'hgfedcba'[index]
    const rankLabel = orientation === 'white' ? String(8 - index) : String(index + 1)
    context.fillStyle = (index + 7) % 2 === 0 ? theme.coordLight : theme.coordDark
    context.fillText(fileLabel, index * square + square - square * 0.16, size - square * 0.06)
    context.fillStyle = index % 2 === 0 ? theme.coordLight : theme.coordDark
    context.fillText(rankLabel, square * 0.05, index * square + square * 0.2)
  }
  return canvas.toDataURL('image/png')
}
