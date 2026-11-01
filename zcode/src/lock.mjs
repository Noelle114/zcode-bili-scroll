import { readJson, writeJson } from './util.mjs'

export function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 服务器上只有本服务，锁主要防「定时 tick / 手动 run / TUI 工具」重叠。
 * 写不了锁时 fail-open：宁可偶尔重复一次，也不能因为锁坏了不干活。
 */
export function acquireLock(file, { why = '', ttlMs = 10 * 60_000, now = Date.now() } = {}) {
  try {
    const lock = readJson(file, null)
    if (lock && Number(lock.pid) !== process.pid) {
      const fresh = Number(lock.ts) > now - ttlMs
      if (fresh && pidAlive(Number(lock.pid))) return { ok: false, lock }
    }
    writeJson(file, { pid: process.pid, ts: now, why })
    return { ok: true }
  } catch {
    return { ok: true, failOpen: true }
  }
}

export function releaseLock(file) {
  try {
    const lock = readJson(file, null)
    if (lock && Number(lock.pid) === process.pid) {
      writeJson(file, { pid: 0, ts: 0 })
      return true
    }
  } catch { /* 没有锁也正常 */ }
  return false
}

export function lockInfo(file) {
  return readJson(file, null)
}
