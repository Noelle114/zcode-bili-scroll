import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { clockIn, dayKey } from './time.mjs'

/**
 * 通知窗口：一轮一批私信（1 条总结 + 最多 dmBatchMax 条视频消息），
 * 按 config 里的 notify* / quietHours 收口。
 *
 * ⚠️ 这里只做「允不允许发」，不负责发；发送仍由值班轮调 `bili_send_message`。
 * 成功投递会由 Python MCP 写进 `dm-deliveries.jsonl`（同一轮带同一个 batch），
 * 本模块用 mtime 当「上次通知时间」、用当天不同 batch 数当「今天已通知几批」。
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
          entries.push({
            day: String(j.day),
            bvids: j.bvids.map(String),
            batch: typeof j.batch === 'string' ? j.batch : '',
          })
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

/** 一天的通知次数按「批」算：同一批的多条消息只计一次；老账本没有 batch 就每条算一批 */
export function countNotifiedToday(entries, today) {
  const seen = new Set()
  let count = 0
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.day !== today) continue
    const key = entry.batch || `line:${i}`
    if (seen.has(key)) continue
    seen.add(key)
    count += 1
  }
  return count
}

export function bvsInText(text) {
  return [...new Set(String(text || '').match(/(?<![0-9A-Za-z])BV[0-9A-Za-z]{10}(?![0-9A-Za-z])/g) || [])]
}

export function beginDmSend(paths, { now = Date.now() } = {}) {
  const file = paths?.dmGate
  if (!file) return { allow: true, reason: '无 dmGate 路径' }
  const ttl = 15_000
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, ts: now }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return { allow: true, reason: '已占发送位' }
  } catch (error) {
    try {
      const old = JSON.parse(readFileSync(file, 'utf8'))
      if (now - Number(old.ts) < ttl) return { allow: false, reason: '另一条私信正在发送' }
    } catch { /* 坏文件当过期 */ }
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, ts: now }), { encoding: 'utf8', mode: 0o600 })
      return { allow: true, reason: '已接管过期发送位' }
    } catch {
      return { allow: true, reason: '发送位写不了，继续' }
    }
  }
}

/**
 * @returns {{allow: boolean, reason: string}}
 */
export function shouldAllowDm(paths, config, { now = new Date(), text = '', receiverUid, continued = false, allowNoBv = false } = {}) {
  if (String(config?.dmMode || 'off') === 'off') {
    return { allow: false, reason: 'dmMode=off，禁止外发私信' }
  }
  const wantUid = Number(config?.dmUid) || 0
  if (wantUid <= 0) return { allow: false, reason: '没有配置 dmUid，禁止外发私信' }
  if (receiverUid !== undefined && Number(receiverUid) !== wantUid) {
    return { allow: false, reason: `收件人 ${receiverUid} 不是设置的 dmUid ${wantUid}` }
  }

  const tz = config?.timeZone
  const minutes = clockIn(now, tz).minutes
  const quiet = parseQuietHours(config?.quietHours)
  if (inQuietHours(minutes, quiet)) {
    return { allow: false, reason: `静默时段 ${config.quietHours}，不发私信` }
  }

  const { entries, lastAt } = readDeliveries(paths)
  const today = dayKey(now, tz)

  if (!continued) {
    const todayCount = countNotifiedToday(entries, today)
    const maxPerDay = Number(config?.notifyMaxPerDay) || 0
    if (maxPerDay > 0 && todayCount >= maxPerDay) {
      return { allow: false, reason: `今天已通知 ${todayCount} 批，达到上限 ${maxPerDay}` }
    }

    const everyHours = Number(config?.notifyEveryHours) || 0
    // 4 小时一轮 + 4 小时通知窗口时，差几秒就会误拒；留 5 分钟宽限
    const graceMs = 5 * 60_000
    if (everyHours > 0 && lastAt > 0 && now.getTime() - lastAt < everyHours * 3600_000 - graceMs) {
      const mins = Math.max(0, Math.round((now.getTime() - lastAt) / 60_000))
      return { allow: false, reason: `距上次通知 ${mins} 分钟，未到 ${everyHours} 小时窗口` }
    }
  }

  if (config?.notifyOnlyWhenNew) {
    const bvs = bvsInText(text)
    if (!bvs.length) {
      if (!continued && !allowNoBv) return { allow: false, reason: '通知里没有 BV 号（notifyOnlyWhenNew）' }
    } else {
      const delivered = deliveredBvs(entries)
      const fresh = bvs.filter((bv) => !delivered.has(bv))
      if (!fresh.length) return { allow: false, reason: '这批 BV 之前已经通知过（没有新内容）' }
    }
  }

  return { allow: true, reason: continued ? '同一批私信继续发送' : '通知窗口允许' }
}
