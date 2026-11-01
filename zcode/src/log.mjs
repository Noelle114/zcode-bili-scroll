import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export function rotateLog(file, limit = 2 * 1024 * 1024) {
  try {
    if (!existsSync(file) || statSync(file).size < limit) return false
    const bak = `${file}.1`
    try { rmSync(bak, { force: true }) } catch { /* 删不掉就算了 */ }
    renameSync(file, bak)
    appendFileSync(file, `${new Date().toISOString()} [INFO] 日志超过 ${Math.round(limit / 1024)}KB，旧的滚到 ${bak}\n`, { encoding: 'utf8', mode: 0o600 })
    return true
  } catch {
    return false
  }
}

export function createLogger(paths, { alsoConsole = false } = {}) {
  const write = (level, msg) => {
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`
    try {
      mkdirSync(dirname(paths.log), { recursive: true, mode: 0o700 })
      appendFileSync(paths.log, line, { encoding: 'utf8', mode: 0o600 })
      try { chmodSync(paths.log, 0o600) } catch { /* Windows */ }
    } catch { /* 日志写不进去也不能抛 */ }
    if (alsoConsole) process.stderr.write(line)
  }
  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
    rotate: () => rotateLog(paths.log),
    file: paths.log,
  }
}

export function tailLog(paths, bytes = 4000) {
  try {
    if (!existsSync(paths.log)) return ''
    const text = readFileSync(paths.log, 'utf8')
    return text.slice(-Math.max(200, bytes))
  } catch {
    return ''
  }
}
