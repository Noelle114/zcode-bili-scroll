/**
 * 值班轮工具面。
 * 这是策略闸门，不是 OS 沙箱：ZCode 没有 DSH 的 profile 系统，
 * 我们靠 `--disallowed-tools` + 这里的 PreToolUse 白名单双层收口。
 */

export const DUTY_READ_TOOLS = new Set([
  'bili_search',
  'bili_subtitle',
  'bili_comments',
  'bili_video_info',
  'bili_danmaku',
  'bili_cover',
  'bili_frames',
  'bili_recommend',
])

export const DUTY_WRITE_TOOLS = new Set([
  'duty_paths',
  'duty_report_append',
  'duty_seen_append',
  'duty_comment_append',
  'duty_seen_recent',
  'duty_digest_append',
])

export const TRANSCRIBE_TOOLS = new Set([
  'bili_transcribe',
  'bili_transcribe_start',
  'bili_transcribe_result',
])

/** `mcp__bili-duty__bili_search` / `plugin:bili-duty:bili_search` → `bili_search` */
export function shortToolName(name) {
  let s = String(name || '').trim()
  if (s.includes('__')) s = s.split('__').pop()
  if (s.includes(':')) s = s.split(':').pop()
  if (s.includes('/')) s = s.split('/').pop()
  return s
}

function normPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

export function isDutyRun({ cwd, workspace, env = process.env } = {}) {
  if (String(env.BILI_DUTY_RUN || '') === '1') return true
  if (!cwd || !workspace) return false
  return normPath(cwd) === normPath(workspace)
}

export function commentAllowed(config, toolInput = {}) {
  const mention = String(config?.mentionName || '').trim()
  if (!mention || String(config?.dmMode || '') === 'only') return false
  const rpid = Number(toolInput?.rpid) || 0
  if (rpid > 0) {
    return Boolean(config?.replyToComments && (Number(config?.replyPerRound) || 1) > 0)
  }
  return Boolean(config?.autoComment && (Number(config?.commentPerRound) || 0) > 0)
}

export function dmAllowed(config) {
  return Boolean(String(config?.dmMode || 'off') !== 'off' && Number(config?.dmUid) > 0)
}

/** 私信只能发给设置里的 dmUid；receiver_uid 缺失/不匹配/未配置都拒绝 */
export function dmTargetAllowed(config, receiverUid) {
  const want = Number(config?.dmUid) || 0
  const got = Number(receiverUid) || 0
  return want > 0 && got === want
}

/**
 * @returns {{allow: boolean, reason: string}}
 */
export function decideTool({ toolName, isDuty, config, toolInput = {} }) {
  const name = shortToolName(toolName)

  if (name === 'bili_reply') {
    return commentAllowed(config, toolInput)
      ? { allow: true, reason: '评论/回复已开启且填了 @ 谁' }
      : { allow: false, reason: '评论/回复未开启（检查 autoComment / replyToComments / mentionName / dmMode）' }
  }
  if (name === 'bili_send_message') {
    return dmAllowed(config)
      ? { allow: true, reason: '私信投递已开启' }
      : { allow: false, reason: '私信未开启（需要 dmMode 不是 off 且填了 dmUid）' }
  }

  // 非值班轮：不干扰用户自己的 ZCode 使用，只拦评论/私信两条写操作
  if (!isDuty) return { allow: true, reason: '非值班轮' }

  if (DUTY_READ_TOOLS.has(name) || DUTY_WRITE_TOOLS.has(name)) {
    return { allow: true, reason: '值班轮允许的 B 站/固定路径工具' }
  }
  if (TRANSCRIBE_TOOLS.has(name)) {
    return config?.transcribe
      ? { allow: true, reason: '本地转写已开启' }
      : { allow: false, reason: '本地转写未开启' }
  }
  return { allow: false, reason: `值班轮不允许使用 ${name || '(未知工具)'}` }
}
