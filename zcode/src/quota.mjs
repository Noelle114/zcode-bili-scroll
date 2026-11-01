import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayKey } from './time.mjs'
import { readState } from './state.mjs'

// 报告里每挑中一条，第一行写成 `### BV号`；宿主的配额/判重都以这个为准。
const PICK_RE = /^#{2,3}[ \t]*(BV[0-9A-Za-z]{10})/gm

export function reportFileOf(paths, now = new Date(), tz) {
  return join(paths.outDir, `${dayKey(now, tz)}.md`)
}

/** 代码围栏里的内容不算（stub 报告会贴日志尾巴，里面也有 BV） */
export function countPicksInText(text) {
  const clean = String(text || '').replace(/```[\s\S]*?```/g, '')
  const ids = new Set()
  for (const m of clean.matchAll(PICK_RE)) ids.add(m[1])
  return ids.size
}

export function countPicks(file) {
  try {
    return countPicksInText(readFileSync(file, 'utf8'))
  } catch {
    return 0
  }
}

export function countPickedToday(paths, config, now = new Date()) {
  const tz = config?.timeZone
  const fromReport = countPicks(reportFileOf(paths, now, tz))
  const st = readState(paths)
  const fromState = st.day === dayKey(now, tz) ? Number(st.picked || 0) : 0
  return Math.max(fromState, fromReport)
}

/** 自动额度只扣自动轮挑的；manualExtra 是手动轮多挑的那部分 */
export function autoPickedToday(paths, config, now = new Date()) {
  const extra = (() => {
    const st = readState(paths)
    return st.day === dayKey(now, config?.timeZone) ? Math.max(0, Number(st.manualExtra || 0)) : 0
  })()
  return Math.max(0, countPickedToday(paths, config, now) - extra)
}

export function picksLeftToday(paths, config, now = new Date()) {
  const quota = Math.max(0, Number(config?.perDay) || 0)
  return Math.max(0, quota - autoPickedToday(paths, config, now))
}
