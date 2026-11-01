import { clockIn, dayKey } from './time.mjs'
import { bumpState, readState, roundsToday } from './state.mjs'
import { picksLeftToday } from './quota.mjs'
import { runRound } from './runner.mjs'

const GRACE_MINUTES = 60
let lastReason = ''

export function parseCollectTimes(config) {
  const arr = Array.isArray(config?.collectTimes) ? config.collectTimes : []
  return arr
    .map((raw) => {
      const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(raw || '').trim())
      if (!m) return null
      return {
        hhmm: `${String(m[1]).padStart(2, '0')}:${m[2]}`,
        minutes: Number(m[1]) * 60 + Number(m[2]),
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.minutes - b.minutes)
}

/**
 * 到点判断（不执行）：
 * - `peakValley` 是自动采集总开关（服务器上设为 true）；
 * - `collectTimes` 是每天的采集时点；
 * - 错过时点 60 分钟内补跑一次（daemon 重启也能补）；
 * - 今日配额用完就不跑；
 * - 同一时点用 `state.windows[day@HH:MM]` 去重。
 */
export function dueCollect(paths, config, now = new Date()) {
  if (!config?.peakValley) return { due: false, reason: 'auto off（peakValley=false）' }
  const times = parseCollectTimes(config)
  if (!times.length) return { due: false, reason: 'collectTimes 为空' }

  const tz = config.timeZone
  const today = dayKey(now, tz)
  const cur = clockIn(now, tz).minutes
  const st = readState(paths)
  const windows = st.day === today && st.windows ? st.windows : {}

  for (const t of times) {
    const key = `${today}@${t.hhmm}`
    if (windows[key]) continue
    const delta = cur - t.minutes
    if (delta < 0 || delta > GRACE_MINUTES) continue
    if (picksLeftToday(paths, config, now) <= 0) {
      return { due: false, reason: '今日配额已满', key, time: t.hhmm, today }
    }
    return { due: true, key, time: t.hhmm, today }
  }

  const next = times.find((t) => t.minutes > cur)
  return {
    due: false,
    reason: next ? `未到 ${next.hhmm}` : '今日时点都过了',
    today,
  }
}

/**
 * daemon 每 60s 调一次。到点就标记窗口并启动一轮；`dryRun` 只判断不跑。
 */
export async function tick(paths, config, { now = new Date(), log = () => {}, dryRun = false } = {}) {
  const d = dueCollect(paths, config, now)
  if (!d.due) {
    if (d.reason !== lastReason) {
      lastReason = d.reason
      log(`scheduler: 不跑（${d.reason}）`)
    }
    return { ran: false, ...d }
  }
  lastReason = ''

  if (dryRun) {
    log(`scheduler: dry-run 到点 ${d.time}（未标记、未运行）`)
    return { ran: false, due: true, dryRun: true, ...d }
  }

  const st = readState(paths)
  const sameDay = st.day === d.today
  const windows = sameDay && st.windows ? { ...st.windows } : {}
  const rounds = roundsToday(paths, { now, tz: config.timeZone })
  bumpState(paths, {
    windows: { ...windows, [d.key]: true },
    count: rounds + 1,
    lastRunAt: now.toISOString(),
    lastWhy: `schedule:${d.time}`,
  }, { now, tz: config.timeZone })

  log(`scheduler: 到点 ${d.time}，开跑`)
  const result = await runRound(paths, { why: `schedule:${d.time}` })
  return { ran: true, ...d, result }
}
