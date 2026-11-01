#!/usr/bin/env node
/**
 * ZCode PreToolUse hook：值班轮允许列表 + 评论/私信闸门。
 * 输入：ZCode 往 stdin 写一行 JSON；输出：hookSpecificOutput JSON。
 * 失败策略：非值班轮放行；值班轮配置读不出来时拒绝（宁可不跑，也别放开）。
 */
import { createPaths } from '../src/paths.mjs'
import { loadConfig } from '../src/config.mjs'
import { decideTool, isDutyRun, shortToolName } from '../src/allowlist.mjs'

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
  // 解析不了就放行：hook 自身的问题不该把用户卡死
  emit('allow', 'hook 输入不是 JSON，已放行')
  process.exit(0)
}

const paths = createPaths()
const duty = isDutyRun({ cwd: input.cwd, workspace: paths.workspace })
const name = shortToolName(input.tool_name)

try {
  const config = loadConfig(paths)
  const { allow, reason } = decideTool({ toolName: name, isDuty: duty, config })
  emit(allow ? 'allow' : 'deny', reason)
} catch (error) {
  if (duty) emit('deny', `值班轮读取配置失败，拒绝工具调用：${String(error?.message ?? error)}`)
  else emit('allow', `配置读取失败，非值班轮放行：${String(error?.message ?? error)}`)
}
