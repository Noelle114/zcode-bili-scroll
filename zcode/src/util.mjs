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

/**
 * 严格读配置：文件不存在返回 {exists:false}；存在但读不了/不是 JSON 对象则抛错。
 * 配置和 state 不同 —— 静默回退 DEFAULTS 会让 daemon 按错误配置跑，甚至覆盖原配置。
 */
export function readJsonStrict(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: null }
    throw new Error(`读取 ${file} 失败：${error?.message ?? error}`)
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`解析 ${file} 失败：${error?.message ?? error}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`解析 ${file} 失败：顶层必须是 JSON 对象`)
  }
  return { exists: true, value }
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
