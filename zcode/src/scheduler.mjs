import { clockIn, dayKey } from './time.mjs'
import { bumpState, readState, roundsToday } from './state.mjs'
import { picksLeftToday } from './quota.mjs'
import { lockInfo, pidAlive } from './lock.mjs'
import { runRound } from './runner.mjs'

const GRACE_MINUTES = 60
const RETRY_MS = 2 * 60_000
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

function runTtlMs(config) {
  return Math.max(30 * 60_000, (Number(config?.runTimeoutMinutes) || 30) * 60_000 + 5 * 60_000)
}

/**
 * 窗口标记有三种状态：
 *   true / 'done'        已经成功跑过
 *   { pid, at }          正在跑（进程还活着且没超过 runTimeout+5min）
 *   其他 / 不存在         没跑过（死进程留下的 running 标记也按没跑过处理）
 * 这样 daemon 在跑一轮途中被 SIGKILL/重启，重启后不会把时点当成“已跑过”。
 */
function windowBlocked(mark, now, config) {
  if (mark === true || mark === 'done') return true
  if (mark && typeof mark === 'object' && Number(mark.pid) > 0) {
    const age = now.getTime() - Number(mark.at || 0)
    if (pidAlive(Number(mark.pid)) && age >= 0 && age < runTtlMs(config)) return true
  }
  return false
}

/**
 * 到点判断（不执行）：
 * - `peakValley` 是自动采集总开关（服务器上设为 true）；
 * - `collectTimes` 是每天的采集时点；
 * - 错过时点 60 分钟内补跑一次（daemon 重启也能补）；
 * - 今日配额用完就不跑；
 * - 同一时点用 `state.windows[day@HH:MM]` 去重；
 * - 正在跑（锁的 pid 还活着）不标记；
 * - 刚失败的时点 2 分钟内不重试，避免刷屏。
 */
export function dueCollect(paths, config, now = new Date()) {
  if (!config?.peakValley) return { due: false, reason: 'auto off（peakValley=false）' }
  const times = parseCollectTimes(config)
  if (!times.length) return { due: false, reason: 'collectTimes 为空' }

  const tz = config.timeZone
  const today = dayKey(now, tz)
  const st = readState(paths)
  const windows = st.windows && typeof st.windows === 'object' ? st.windows : {}
  const failures = st.failures && typeof st.failures === 'object' ? st.failures : {}
  const lock = lockInfo(paths.runLock)
  if (lock && Number(lock.pid) > 0 && pidAlive(Number(lock.pid))) {
    return { due: false, reason: '上一轮还在跑', today }
  }
  const cur = clockIn(now, tz).minutes

  for (const t of times) {
    const key = `${today}@${t.hhmm}`
    if (windowBlocked(windows[key], now, config)) continue
    const delta = cur - t.minutes
    if (delta < 0 || delta > GRACE_MINUTES) continue
    const fail = failures[key]
    if (fail && now.getTime() - Number(fail.at || 0) < RETRY_MS) {
      return { due: false, reason: '上一轮刚失败，稍后重试', key, time: t.hhmm, today }
    }
    if (picksLeftToday(paths, config, now) <= 0) {
      return { due: false, reason: '今日配额已满', key, time: t.hhmm, today }
    }
    return { due: true, key, time: t.hhmm, today }
  }

  // 跨午夜补跑：00:xx 时，昨天 23:xx 的窗口可能还在 60 分钟宽限内。
  // windows/failures 由 state.mjs 保留一天，所以已成功跑过的窗口不会重复。
  const prev = dayKey(new Date(now.getTime() - 24 * 3600_000), tz)
  if (prev !== today) {
    for (const t of times) {
      const key = `${prev}@${t.hhmm}`
      if (windowBlocked(windows[key], now, config)) continue
      const delta = cur + 24 * 60 - t.minutes
      if (delta < 0 || delta > GRACE_MINUTES) continue
      const fail = failures[key]
      if (fail && now.getTime() - Number(fail.at || 0) < RETRY_MS) {
        return { due: false, reason: '上一轮刚失败，稍后重试', key, time: t.hhmm, today, windowDay: prev }
      }
      if (picksLeftToday(paths, config, now) <= 0) {
        return { due: false, reason: '今日配额已满', key, time: t.hhmm, today, windowDay: prev }
      }
      return { due: true, key, time: t.hhmm, today, windowDay: prev }
    }
  }

  const next = times.find((t) => t.minutes > cur)
  return {
    due: false,
    reason: next ? `未到 ${next.hhmm}` : '今日时点都过了',
    today,
  }
}

function rollbackWindow(paths, d, now, config, log) {
  try {
    const st = readState(paths)
    const sameDay = st.day === d.today
    const windows = st.windows && typeof st.windows === 'object' ? { ...st.windows } : {}
    delete windows[d.key]
    const failures = st.failures && typeof st.failures === 'object' ? { ...st.failures } : {}
    failures[d.key] = {
      at: now.getTime(),
      retries: (Number(failures[d.key]?.retries) || 0) + 1,
    }
    const count = sameDay ? Math.max(0, Number(st.count || 0) - 1) : 0
    bumpState(paths, { windows, failures, count }, { now, tz: config.timeZone })
  } catch (error) {
    log?.(`scheduler: 回滚窗口失败：${error?.message ?? error}`)
  }
}

function clearFailure(paths, d, now, config) {
  try {
    const st = readState(paths)
    if (!st.failures?.[d.key]) return
    const failures = { ...st.failures }
    delete failures[d.key]
    bumpState(paths, { failures }, { now, tz: config.timeZone })
  } catch { /* 失败记录清不掉不影响 */ }
}

function markWindowDone(paths, d, now, config) {
  try {
    const st = readState(paths)
    const windows = st.windows && typeof st.windows === 'object' ? { ...st.windows } : {}
    windows[d.key] = true
    bumpState(paths, { windows }, { now, tz: config.timeZone })
  } catch { /* 成功但标记不了时，下一轮可能重试，不能把这次成功说成失败 */ }
}

/**
 * daemon 每 60s 调一次。到点就标记窗口并启动一轮；`dryRun` 只判断不跑。
 * 失败会回滚窗口并记录 2 分钟重试冷却，不再烧掉当天时点。
 */
export async function tick(paths, config, { now = new Date(), log = () => {}, dryRun = false, runRoundFn = runRound } = {}) {
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
  const windows = st.windows && typeof st.windows === 'object' ? { ...st.windows } : {}
  const rounds = roundsToday(paths, { now, tz: config.timeZone })
  bumpState(paths, {
    windows: { ...windows, [d.key]: { pid: process.pid, at: now.getTime() } },
    count: rounds + 1,
    lastRunAt: now.toISOString(),
    lastWhy: `schedule:${d.time}`,
  }, { now, tz: config.timeZone })

  log(`scheduler: 到点 ${d.time}，开跑`)
  try {
    const result = await runRoundFn(paths, { why: `schedule:${d.time}` })
    if (!result || result.ok !== true) {
      rollbackWindow(paths, d, now, config, log)
      log(`scheduler: ${d.time} 这轮没跑成（${result?.error || '未知原因'}），窗口已回滚，2 分钟后可重试`)
      return { ran: false, due: true, failed: true, ...d, result }
    }
    clearFailure(paths, d, now, config)
    markWindowDone(paths, d, now, config)
    return { ran: true, ...d, result }
  } catch (error) {
    rollbackWindow(paths, d, now, config, log)
    log(`scheduler: ${d.time} 开跑异常：${error?.message ?? error}（窗口已回滚）`)
    throw error
  }
}
