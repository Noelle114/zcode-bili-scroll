#!/usr/bin/env node
/**
 * ZCode PostToolUse：把“实际上没发出去”的额度退回去。
 * - bili_reply 被语感闸门拦下（blocked_by: style）：退评论名额。
 * - bili_send_message 返回 success:false（风控/网络/超长）：退私信批次名额。
 * 不输出 decision，只回一个空对象，避免影响工具结果。
 */
import { createPaths } from '../src/paths.mjs'
import { loadConfig } from '../src/config.mjs'
import { shortToolName } from '../src/allowlist.mjs'
import { releaseCommentSlot, styleBlocked } from '../src/comment-gate.mjs'
import { dmSendFailed, releaseDmSend } from '../src/dm-batch.mjs'

let raw = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) raw += chunk

let input = {}
try { input = JSON.parse(raw || '{}') } catch { process.exit(0) }
const name = shortToolName(input.tool_name)
if (name !== 'bili_reply' && name !== 'bili_send_message') process.exit(0)

const toolInput = input.tool_input || input.toolInput || {}
const response = input.tool_response ?? input.toolResponse

try {
  if (name === 'bili_reply') {
    if (!styleBlocked(response)) process.exit(0)
    const paths = createPaths()
    const config = loadConfig(paths)
    releaseCommentSlot(paths, {
      runId: process.env.BILI_DUTY_RUN_ID || '',
      isReply: Number(toolInput.rpid) > 0,
      now: new Date(),
      timeZone: config.timeZone,
    })
  } else {
    if (!dmSendFailed(response)) process.exit(0)
    const paths = createPaths()
    const config = loadConfig(paths)
    releaseDmSend(paths, {
      runId: process.env.BILI_DUTY_RUN_ID || '',
      now: new Date(),
      timeZone: config.timeZone,
    })
  }
} catch { /* 退名额失败不影响工具结果 */ }

process.stdout.write('{}')
