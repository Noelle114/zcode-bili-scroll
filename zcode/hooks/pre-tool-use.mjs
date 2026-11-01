#!/usr/bin/env node
/**
 * ZCode PreToolUse hook：值班轮允许列表 + 评论/私信闸门。
 * 输入：ZCode 往 stdin 写一行 JSON；输出：hookSpecificOutput JSON。
 * 失败策略：非值班轮放行；值班轮配置读不出来时拒绝（宁可不跑，也别放开）。
 */
import { rmSync } from 'node:fs'
import { createPaths } from '../src/paths.mjs'
import { loadConfig } from '../src/config.mjs'
import { decideTool, dmTargetAllowed, isDutyRun, shortToolName } from '../src/allowlist.mjs'
import { beginDmSend, shouldAllowDm } from '../src/notify.mjs'
import { commentQuota } from '../src/comment-gate.mjs'
import { beginDmBatch, dmBatchDelayMs, dmBatchLimit, readDmBatch, recordDmSend } from '../src/dm-batch.mjs'
import { sleep } from '../src/util.mjs'

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }))
}

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk

let input = {}
try {
  input = JSON.parse(raw || '{}')
} catch {
  // 解析不了就别放行值班轮：--disallowed-tools 只挡内置工具，MCP 写工具全靠这里
  const duty = String(process.env.BILI_DUTY_RUN || '') === '1'
  emit(duty ? 'deny' : 'allow', duty ? 'hook 输入不是 JSON，值班轮拒绝' : 'hook 输入不是 JSON，已放行')
  process.exit(0)
}

const paths = createPaths()
const duty = isDutyRun({ cwd: input.cwd, workspace: paths.workspace })
const name = shortToolName(input.tool_name)
const toolInput = input.tool_input || input.toolInput || {}

try {
  const config = loadConfig(paths)
  const { allow, reason } = decideTool({ toolName: name, isDuty: duty, config, toolInput })
  if (!allow) {
    emit('deny', reason)
    process.exit(0)
  }
  let allowReason = reason
  if (name === 'bili_reply') {
    // 提示词里的条数只是建议；这里按 runId 真正计数，模型不能靠重试多刷
    const gate = commentQuota(paths, config, {
      runId: process.env.BILI_DUTY_RUN_ID || '',
      isReply: Number(toolInput.rpid) > 0,
      now: new Date(),
    })
    if (!gate.allow) {
      emit('deny', `评论条数：${gate.reason}`)
      process.exit(0)
    }
    allowReason = `评论条数：${gate.reason}`
  }
  if (name === 'bili_send_message') {
    const receiverUid = Number(toolInput.receiver_uid ?? toolInput.receiverUid)
    if (!dmTargetAllowed(config, receiverUid)) {
      emit('deny', `私信收件人 ${receiverUid || '(未填)'} 不是设置里的 dmUid ${config.dmUid || '(未填)'}`)
      process.exit(0)
    }
    // 私信还要过通知窗口：一批 = 1 条总结 + 最多 dmBatchMax 条视频消息；
    // 同一批后续消息跳过 4h/每日上限，但仍检查静默时段和 only-new。
    if (duty) {
      const runId = process.env.BILI_DUTY_RUN_ID || ''
      const now = new Date()
      const existing = readDmBatch(paths, { now, timeZone: config.timeZone })
      const continued = Boolean(existing && existing.runId === runId)
      const limit = dmBatchLimit(config)
      if (continued && existing.sent >= limit) {
        emit('deny', `本轮私信已发 ${existing.sent}/${limit} 条（1 条总结 + 最多 ${config.dmBatchMax} 条视频）`)
        process.exit(0)
      }
      const gate = shouldAllowDm(paths, config, {
        now,
        text: toolInput.text || '',
        receiverUid,
        continued,
        allowNoBv: !continued,
      })
      if (!gate.allow) {
        emit('deny', `通知窗口：${gate.reason}`)
        process.exit(0)
      }
      if (continued) {
        const wait = dmBatchDelayMs(existing, now)
        if (wait > 0) await sleep(wait)
      }
      const mark = beginDmSend(paths, { now: Date.now() })
      if (!mark.allow) {
        emit('deny', `通知窗口：${mark.reason}`)
        process.exit(0)
      }
      try {
        if (continued) recordDmSend(paths, { runId, now: new Date(), timeZone: config.timeZone })
        else beginDmBatch(paths, { runId, now: new Date(), timeZone: config.timeZone })
      } catch (error) {
        try { rmSync(paths.dmGate, { force: true }) } catch { /* 清不掉就等 15 秒过期 */ }
        emit('deny', `私信批次记账失败：${String(error?.message ?? error)}`)
        process.exit(0)
      }
      allowReason = continued
        ? `同批私信继续发送（${existing.sent + 1}/${limit}）`
        : `本轮私信开始（1/${limit}）`
    }
  }
  emit('allow', allowReason)
} catch (error) {
  if (duty) emit('deny', `值班轮读取配置失败，拒绝工具调用：${String(error?.message ?? error)}`)
  else emit('allow', `配置读取失败，非值班轮放行：${String(error?.message ?? error)}`)
}
