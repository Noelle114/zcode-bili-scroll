import { rmSync } from 'node:fs'
import { readJson, writeJson } from './util.mjs'
import { dayKey } from './time.mjs'
import { responseText } from './comment-gate.mjs'

/** 一轮私信的批次状态：先 1 条总结，再最多 dmBatchMax 条视频消息。 */
const BATCH_TTL_MS = 60 * 60_000
export const DM_MESSAGE_DELAY_MS = 3000

export function dmBatchLimit(config) {
  return 1 + Math.max(0, Number(config?.dmBatchMax) || 0)
}

export function readDmBatch(paths, { now = new Date(), timeZone } = {}) {
  const st = readJson(paths?.dmBatch, null)
  if (!st || typeof st !== 'object' || (!st.runId && !st.batchId)) return null
  if (st.day !== dayKey(now, timeZone)) return null
  const approvedAt = Number(st.approvedAt) || 0
  if (!approvedAt || now.getTime() - approvedAt > BATCH_TTL_MS) return null
  return {
    runId: String(st.runId),
    batchId: String(st.batchId || st.runId || ''),
    day: String(st.day),
    approvedAt,
    sent: Math.max(0, Number(st.sent) || 0),
    lastAt: Math.max(0, Number(st.lastAt) || 0),
  }
}

export function beginDmBatch(paths, { runId, now = new Date(), timeZone } = {}) {
  const id = String(runId || '')
  const state = {
    runId: id,
    // runId 为空时也要有一个非空 batch，Python 账本才能把同一轮的多条消息归一
    batchId: id || `batch-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    day: dayKey(now, timeZone),
    approvedAt: now.getTime(),
    sent: 1,
    lastAt: now.getTime(),
  }
  writeJson(paths.dmBatch, state)
  return state
}

export function recordDmSend(paths, { runId, now = new Date(), timeZone } = {}) {
  const state = readDmBatch(paths, { now, timeZone })
  if (!state || state.runId !== String(runId || '')) return beginDmBatch(paths, { runId, now, timeZone })
  state.sent += 1
  state.lastAt = now.getTime()
  writeJson(paths.dmBatch, state)
  return state
}

export function releaseDmSend(paths, { runId, now = new Date(), timeZone } = {}) {
  const state = readDmBatch(paths, { now, timeZone })
  if (!state || state.runId !== String(runId || '')) return false
  state.sent = Math.max(0, state.sent - 1)
  if (state.sent <= 0) {
    try { rmSync(paths.dmBatch, { force: true }) } catch { /* 删不掉也没关系 */ }
    return true
  }
  writeJson(paths.dmBatch, state)
  return true
}

/** 相邻两条私信之间还差多少毫秒；钩子会 sleep 这段，别让 B 站觉得在刷屏 */
export function dmBatchDelayMs(state, now = new Date()) {
  if (!state?.lastAt) return 0
  return Math.max(0, DM_MESSAGE_DELAY_MS - (now.getTime() - state.lastAt))
}

/** bili_send_message 返回 success:false（网络/风控/超长）时不算发出去 */
export function dmSendFailed(response) {
  if (response && typeof response === 'object' && response.success === false) return true
  const text = responseText(response).trim()
  if (!text) return false
  try {
    const value = JSON.parse(text)
    return value?.success === false
  } catch {
    return false
  }
}
