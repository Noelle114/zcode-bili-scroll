import { existsSync, readFileSync, statSync } from 'node:fs'
import { clockIn, dayKey } from './time.mjs'

/**
 * 通知窗口：每轮最多一条私信，按 config 里的 notify* / quietHours 收口。
 *
 * ⚠️ 这里只做「允不允许发」，不负责发；发送仍由值班轮调 `bili_send_message`。
 * 成功投递会由 Python MCP 写进 `dm-deliveries.jsonl`，本模块用它的 mtime 当
 * 「上次通知时间」、用当天行数当「今天已通知几次」。
 */

export function parseQuietHours(spec) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(spec || '').trim())
  if (!m) return null
  return {
    start: Number(m[1]) * 60 + Number(m[2]),
    end: Number(m[3]) * 60 + Number(m[4]),
  }
}

export function inQuietHours(minutes, quiet) {
  if (!quiet) return false
  return quiet.start <= quiet.end
    ? minutes >= quiet.start && minutes < quiet.end
    : minutes >= quiet.start || minutes < quiet.end
}

export function readDeliveries(paths) {
  const file = paths?.dmDeliveries
  if (!file || !existsSync(file)) return { entries: [], lastAt: 0 }
  const entries = []
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const j = JSON.parse(line)
        if (j && /^\d{4}-\d{2}-\d{2}$/.test(j.day) && Array.isArray(j.bvids)) {
          entries.push({ day: String(j.day), bvids: j.bvids.map(String) })
        }
      } catch { /* 坏行跳过 */ }
    }
  } catch {
    return { entries: [], lastAt: 0 }
  }
  let lastAt = 0
  try { lastAt = statSync(file).mtimeMs } catch { /* 没有就算了 */ }
  return { entries, lastAt }
}

export function deliveredBvs(entries) {
  const out = new Set()
  for (const e of entries) for (const bv of e.bvids) out.add(bv)
  return out
}

export function bvsInText(text) {
  return [...new Set(String(text || '').match(/BV[0-9A-Za-z]{10}/g) || [])]
}

/**
 * @returns {{allow: boolean, reason: string}}
 */
export function shouldAllowDm(paths, config, { now = new Date(), text = '' } = {}) {
  // dmMode=off 的私信不是「一轮通知」（可能是私信双向的回复），不套通知窗口
  if (String(config?.dmMode || 'off') === 'off') return { allow: true, reason: 'dmMode=off（非通知轮）' }

  const tz = config?.timeZone
  const minutes = clockIn(now, tz).minutes
  const quiet = parseQuietHours(config?.quietHours)
  if (inQuietHours(minutes, quiet)) {
    return { allow: false, reason: `静默时段 ${config.quietHours}，不发私信` }
  }

  const { entries, lastAt } = readDeliveries(paths)
  const today = dayKey(now, tz)
  const todayCount = entries.filter((e) => e.day === today).length
  const maxPerDay = Number(config?.notifyMaxPerDay) || 0
  if (maxPerDay > 0 && todayCount >= maxPerDay) {
    return { allow: false, reason: `今天已通知 ${todayCount} 次，达到上限 ${maxPerDay}` }
  }

  const everyHours = Number(config?.notifyEveryHours) || 0
  if (everyHours > 0 && lastAt > 0 && now.getTime() - lastAt < everyHours * 3600_000) {
    const mins = Math.max(0, Math.round((now.getTime() - lastAt) / 60_000))
    return { allow: false, reason: `距上次通知 ${mins} 分钟，未到 ${everyHours} 小时窗口` }
  }

  if (config?.notifyOnlyWhenNew) {
    const bvs = bvsInText(text)
    if (!bvs.length) return { allow: false, reason: '通知里没有 BV 号（notifyOnlyWhenNew）' }
    const delivered = deliveredBvs(entries)
    const fresh = bvs.filter((bv) => !delivered.has(bv))
    if (!fresh.length) return { allow: false, reason: '这批 BV 之前已经通知过（没有新内容）' }
  }

  return { allow: true, reason: '通知窗口允许' }
}
