import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ASSET = process.env.STOCKFISH_ASSET ?? 'stockfish-macos-m1-apple-silicon'
const target = join('resources', 'bin', 'stockfish')

const release = await fetch('https://api.github.com/repos/official-stockfish/Stockfish/releases/latest', {
  headers: { 'User-Agent': 'RazborPartiy/1.0', Accept: 'application/vnd.github+json' }
}).then((response) => {
  if (!response.ok) throw new Error(`GitHub ответил ${response.status}`)
  return response.json()
})
const asset = release.assets.find((entry) => entry.name.startsWith(ASSET))
if (!asset) {
  console.error(`В релизе ${release.tag_name} нет ассета ${ASSET}. Доступно: ${release.assets.map((entry) => entry.name).join(', ')}`)
  process.exit(1)
}
console.log(`Скачиваю ${asset.name} из релиза ${release.tag_name}…`)
const work = mkdtempSync(join(tmpdir(), 'stockfish-'))
const archive = join(work, asset.name)
const data = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer())
writeFileSync(archive, data)
if (/\.(tar|tar\.gz|tgz)$/.test(asset.name)) execFileSync('tar', ['-xf', archive, '-C', work])
else if (asset.name.endsWith('.zip')) execFileSync('unzip', ['-q', archive, '-d', work])

function findBinary(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) {
      const found = findBinary(full)
      if (found) return found
    } else if (entry.startsWith('stockfish') && !entry.includes('.') && info.size > 1_000_000) return full
  }
  return null
}

const binary = /\.(tar|tar\.gz|tgz|zip)$/.test(asset.name) ? findBinary(work) : archive
if (!binary) {
  console.error('Не нашёл исполняемый файл в архиве.')
  process.exit(1)
}
mkdirSync(join('resources', 'bin'), { recursive: true })
copyFileSync(binary, target)
chmodSync(target, 0o755)
rmSync(work, { recursive: true, force: true })
console.log(`Готово: ${target} (${release.tag_name})`)
console.log(execFileSync(target, [], { input: 'uci\nquit\n', encoding: 'utf8' }).split('\n')[0])
