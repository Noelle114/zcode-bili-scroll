import { readJson, writeJson } from './util.mjs'
import { dayKey } from './time.mjs'

export function readState(paths) {
  return readJson(paths.state, {})
}

export function bumpState(paths, patch = {}, { now = new Date(), tz } = {}) {
  const st = readState(paths)
  const today = dayKey(now, tz)
  if (st.day !== today) {
    st.day = today
    st.count = 0
    st.picked = 0
    st.manualExtra = 0
  }
  // windows/failures 保留昨天：跨午夜补跑要看到昨天 23:xx 的窗口是否已跑过。
  // 只保留昨天和今天，避免状态文件无限长。
  const cutoff = dayKey(new Date(now.getTime() - 24 * 3600_000), tz)
  const prune = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {}
    return Object.fromEntries(Object.entries(map).filter(([key]) => String(key).slice(0, 10) >= cutoff))
  }
  st.windows = prune(st.windows)
  st.failures = prune(st.failures)
  Object.assign(st, patch)
  st.windows = prune(st.windows)
  st.failures = prune(st.failures)
  writeJson(paths.state, st)
  return st
}

export function roundsToday(paths, { now = new Date(), tz } = {}) {
  const st = readState(paths)
  return st.day === dayKey(now, tz) ? Number(st.count || 0) : 0
}

export function manualExtraToday(paths, { now = new Date(), tz } = {}) {
  const st = readState(paths)
  return st.day === dayKey(now, tz) ? Math.max(0, Number(st.manualExtra || 0)) : 0
}
