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
    st.windows = {}
    st.manualExtra = 0
  }
  Object.assign(st, patch)
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
