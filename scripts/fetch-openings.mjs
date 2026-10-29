import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const url = `https://raw.githubusercontent.com/lichess-org/chess-openings/master/${letter}.tsv`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  const text = await response.text()
  writeFileSync(join('resources', 'openings', `${letter}.tsv`), text)
  console.log(`${letter}.tsv: ${text.split('\n').length - 2} вариантов`)
}
