import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayKey, seenDay } from './time.mjs'
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

/** reportLevel=off 时没有日报，用判重表的「挑了」行兜底；与报告同源、去重后计数 */
function countSeenPicksToday(paths, config, now = new Date()) {
  const today = dayKey(now, config?.timeZone)
  let text = ''
  try { text = readFileSync(paths.seen, 'utf8') } catch { return 0 }
  const picked = new Set()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((s) => s.trim()).slice(1, -1)
    if (cells.length < 3) continue
    const bvIdx = cells.findIndex((x) => /^BV[0-9A-Za-z]{10}$/.test(x))
    if (bvIdx < 0) continue
    const day = seenDay(bvIdx > 0 ? cells[bvIdx - 1] : cells[0], now, config?.timeZone)
    if (!day || day !== today) continue
    const status = cells[cells.length - 1] || ''
    if (/跳过|跳了|没挑/.test(status)) continue
    if (/挑|收|选|值得看|可以看/.test(status)) picked.add(cells[bvIdx])
  }
  return picked.size
}

export function countPickedToday(paths, config, now = new Date()) {
  const tz = config?.timeZone
  const fromReport = countPicks(reportFileOf(paths, now, tz))
  const st = readState(paths)
  const fromState = st.day === dayKey(now, tz) ? Number(st.picked || 0) : 0
  const fromSeen = countSeenPicksToday(paths, config, now)
  return Math.max(fromState, fromReport, fromSeen)
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
