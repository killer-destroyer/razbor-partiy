const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
const { existsSync, chmodSync } = require('node:fs')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const engine = join(appPath, 'Contents', 'Resources', 'bin', 'stockfish')
  if (existsSync(engine)) {
    chmodSync(engine, 0o755)
    execFileSync('codesign', ['--force', '-s', '-', engine], { stdio: 'inherit' })
  } else {
    console.warn('Внимание: resources/bin/stockfish не найден — приложение будет искать движок в системе (brew install stockfish).')
  }
  execFileSync('codesign', ['--force', '--deep', '-s', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--verbose=1', appPath], { stdio: 'inherit' })
}
