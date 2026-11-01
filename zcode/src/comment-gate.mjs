import { mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayKey } from './time.mjs'

const SAFE_RUN = /[^0-9A-Za-z._-]/g

/**
 * 评论/回复的每轮硬闸门。
 *
 * 提示词里写了「每轮最多 N 条」，但模型并不保证遵守；评论会直接发到使用者账号上，
 * 所以宿主在 PreToolUse 里按 runId 预留名额。用 `wx` 建槽位是原子的：
 * 并发调用同一轮也只能抢到 limit 个；发送失败也消耗名额，宁可少一条也不让模型重试刷屏。
 */
export function commentQuota(paths, config, { runId = '', isReply = false, now = new Date() } = {}) {
  const limit = Math.max(0, Number(isReply ? config?.replyPerRound : config?.commentPerRound) || 0)
  if (limit <= 0) {
    return { allow: false, reason: isReply ? '回复评论关闭（replyPerRound=0）' : '新评论关闭（commentPerRound=0）' }
  }
  const root = paths?.commentSlots
  if (!root) return { allow: true, reason: '无评论槽位路径' }

  const day = dayKey(now, config?.timeZone)
  const run = String(runId || 'interactive').replace(SAFE_RUN, '_').slice(0, 80)
  const dir = join(root, day, run)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (error) {
    return { allow: false, reason: `评论槽位建不了，拒绝发送：${String(error?.message ?? error)}` }
  }

  // 只清两天前的目录；跨午夜的同一轮还要能续用昨天的名额
  pruneOldSlots(root, day, now, config?.timeZone)

  const field = isReply ? 'reply' : 'comment'
  for (let n = 1; n <= limit; n++) {
    try {
      writeFileSync(join(dir, `${field}-${n}`), '', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      return { allow: true, reason: `本轮${isReply ? '回复' : '评论'}第 ${n}/${limit} 条` }
    } catch (error) {
      if (error?.code === 'EEXIST') continue
      return { allow: false, reason: `评论槽位写不了，拒绝发送：${String(error?.message ?? error)}` }
    }
  }
  return { allow: false, reason: `本轮${isReply ? '回复' : '评论'}已发 ${limit}/${limit} 条` }
}

/**
 * 释放最近一个评论槽位：给 PostToolUse 用 —— 语感闸门 `blocked_by: style` 时
 * 实际上一条评论都没发出去，不能把名额吃掉，否则章程要求的“改写一次再发”会被拒。
 */
export function releaseCommentSlot(paths, { runId = '', isReply = false, now = new Date(), timeZone } = {}) {
  const root = paths?.commentSlots
  if (!root) return false
  const day = dayKey(now, timeZone)
  const run = String(runId || 'interactive').replace(SAFE_RUN, '_').slice(0, 80)
  const dir = join(root, day, run)
  const field = isReply ? 'reply' : 'comment'
  let names = []
  try { names = readdirSync(dir) } catch { return false }
  let best = ''
  let bestN = 0
  for (const name of names) {
    const match = new RegExp(`^${field}-(\\d+)$`).exec(name)
    if (!match) continue
    const n = Number(match[1])
    if (n > bestN) { bestN = n; best = name }
  }
  if (!best) return false
  try { unlinkSync(join(dir, best)); return true } catch { return false }
}

export function responseText(response) {
  if (typeof response === 'string') return response
  const blocks = response?.content ?? response?.result?.content ?? []
  if (Array.isArray(blocks)) {
    const text = blocks.map((b) => (typeof b === 'string' ? b : b?.text || '')).filter(Boolean).join('\n')
    if (text) return text
  }
  return typeof response?.text === 'string' ? response.text : ''
}

/** 判断 bili_reply 的返回是不是“语感闸门拦下”（没有真的发出去） */
export function styleBlocked(response) {
  const text = responseText(response).trim()
  if (!text) return false
  try {
    const value = JSON.parse(text)
    return value?.blocked_by === 'style' || value?.blockedBy === 'style'
  } catch {
    return false
  }
}

function pruneOldSlots(root, today, now, tz) {
  try {
    const yesterday = dayKey(new Date(now.getTime() - 24 * 3600_000), tz)
    for (const name of readdirSync(root)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue
      if (name === today || name === yesterday) continue
      rmSync(join(root, name), { recursive: true, force: true })
    }
  } catch { /* 清理失败不影响发送 */ }
}
