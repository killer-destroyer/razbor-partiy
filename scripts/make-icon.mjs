import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const source = 'build/icon.png'
const iconset = 'build/icon.iconset'
if (!existsSync(source)) {
  console.error('Нет build/icon.png (1024×1024).')
  process.exit(1)
}
if (process.platform !== 'darwin') {
  console.error('Сборка .icns возможна только на macOS (sips и iconutil).')
  process.exit(1)
}
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })
for (const size of [16, 32, 128, 256, 512]) {
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), source, '--out', join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'build/icon.icns'], { stdio: 'inherit' })
rmSync(iconset, { recursive: true, force: true })
console.log('Готово: build/icon.icns')
