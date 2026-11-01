import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

/** 读 JSON；坏文件/不存在都返回 fallback，不让配置问题把进程带崩 */
export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写：先写临时文件再 rename，避免半截 JSON */
export function writeFileAtomic(file, data, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, data, { encoding: 'utf8', mode })
  try { chmodSync(tmp, mode) } catch { /* Windows/某些文件系统不支持 */ }
  renameSync(tmp, file)
}

export function writeJson(file, value, mode = 0o600) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode)
}

export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 工具/日志返回值一律转成无损 JSON 可表示的东西 */
export function safeJson(value) {
  if (value === undefined || value === null) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
}
