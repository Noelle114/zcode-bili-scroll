import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPaths } from './paths.mjs'
import { loadConfig } from './config.mjs'
import { createLogger } from './log.mjs'
import { acquireLock, releaseLock } from './lock.mjs'
import { buildPrompt } from './prompt.mjs'
import { loadProvider } from './provider.mjs'
import { checkCredentials, isAuthError } from './credentials.mjs'
import { dayKey } from './time.mjs'
import { countPickedToday } from './quota.mjs'
import { bumpState, readState } from './state.mjs'
import { writeJson } from './util.mjs'

const DISALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Agent', 'Task', 'Skill',
  'TodoWrite', 'NotebookEdit', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
].join(',')

let activeRound = false
let currentChild = null

/** 给 daemon 的 SIGTERM 用：把正在跑的子进程一起收掉，别留孤儿 */
export function stopRound() {
  const child = currentChild
  if (!child) return false
  try { child.kill('SIGTERM') } catch { /* 已经没了 */ }
  return true
}

export function resolveZcode(config, env = process.env) {
  const explicit = String(config?.zcodeBin || env.BILI_DUTY_ZCODE_BIN || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  return 'zcode'
}

/** 从 stream 事件里找 provider 汇总的 usage（每轮一条，含 modelRequestCount） */
function findProviderUsage(value) {
  if (!value || typeof value !== 'object') return null
  if (value.usage && typeof value.usage === 'object' && value.usage.source === 'provider') return value.usage
  for (const child of Object.values(value)) {
    const hit = findProviderUsage(child)
    if (hit) return hit
  }
  return null
}

/** stderr 里的鉴权错误要带 zcode/provider 上下文，避免把 B站工具自己的 Unauthorized 当成 ZCode 凭据失效 */
function isZcodeAuthStderr(text) {
  const s = String(text || '')
  return /1113|Insufficient balance|no resource package/i.test(s) ||
    /(zcode|provider|credential|model)[^\n]{0,100}(HTTP\s+401|Unauthorized|invalid[\s_-]?token|token (?:has )?expired)/i.test(s)
}

/**
 * 同一进程内只允许一轮（daemon 的 tick 可能重叠；跨进程仍由 run-lock 管）。
 */
export async function runRound(paths = createPaths(), opts = {}) {
  if (activeRound) return { ok: false, error: '本进程已有一轮在跑', busy: true }
  activeRound = true
  try {
    return await runRoundInner(paths, opts)
  } finally {
    activeRound = false
  }
}

/**
 * 跑一轮：spawn `zcode --prompt`，解析 stream-json，按退出码/超时收尾。
 * 收尾的「数条数 / 补齐报告 / 复核 / 收藏」在 postrun 里，本函数只负责运行。
 */
async function runRoundInner(paths = createPaths(), { why = 'manual', dryRun = false, log } = {}) {
  const config = loadConfig(paths)
  // scheduler 传的是「日志函数」，CLI 传的是 logger 对象；两种都接住，避免再出 logger.error 不是函数
  const logger = typeof log === 'function'
    ? { info: (msg) => log(msg), warn: (msg) => log(msg), error: (msg) => log(msg), rotate: () => {} }
    : (log || createLogger(paths, { alsoConsole: true }))
  const lock = acquireLock(paths.runLock, {
    why,
    ttlMs: Math.max(30 * 60_000, (Number(config.runTimeoutMinutes) || 30) * 60_000 + 5 * 60_000),
  })
  if (!lock.ok) {
    logger.warn(`这一轮没跑（${why}）：另一个进程正在跑（pid=${lock.lock?.pid}）`)
    return { ok: false, error: '上一轮还在跑', busy: true, lock: lock.lock }
  }

  const manual = why === 'manual'
  const beforePicks = manual && !dryRun ? countPickedToday(paths, config, new Date()) : 0

  try {
    const cred = checkCredentials(config.credentialsFile)
    if (!cred.ok) {
      const error = `ZCode 凭据不可用（${cred.reason}）：先同步桌面端 ~/.zcode/v2/credentials.json`
      logger.error(error)
      return { ok: false, error, authError: true }
    }
    const provider = loadProvider(config.providerConfigFile)
    if (!provider.ok) {
      const error = `provider 配置不可用：${provider.errors.join('；')}`
      logger.error(error)
      return { ok: false, error, providerError: true, provider }
    }
    for (const warning of provider.warnings) logger.warn(`provider：${warning}`)

    const prompt = dryRun ? '只输出 ok，不要调用任何工具。' : buildPrompt(paths, config, { why })
    const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`
    const runDir = join(paths.runsDir, runId)
    mkdirSync(runDir, { recursive: true, mode: 0o700 })
    const streamFile = join(runDir, 'stream.jsonl')
    const stream = createWriteStream(streamFile, { flags: 'a', mode: 0o600 })
    let streamEnded = false
    let streamError = null
    stream.on('error', (error) => {
      streamError = error
      logger.error(`stream.jsonl 写入失败（这一轮继续跑）：${String(error?.message ?? error)}`)
    })

    const bin = resolveZcode(config)
    const args = [
      '--prompt', prompt,
      '--cwd', paths.workspace,
      '--mode', 'yolo',
      '--disallowed-tools', DISALLOWED_TOOLS,
      '--output-format', 'stream-json',
    ]
    const env = {
      ...process.env,
      BILI_DUTY_HOME: paths.home,
      BILI_DUTY_RUN: '1',
      BILI_DUTY_RUN_ID: runId,
      BILI_DUTY_DM_UID: String(config.dmUid || ''),
      BILI_DUTY_DM_BATCH: runId,
      BILI_DUTY_TZ: config.timeZone,
      // Python MCP 只有看到这个日期才会把私信里的 BV 记进 dm-deliveries.jsonl
      BILI_DUTY_RUN_DAY: dayKey(new Date(), config.timeZone),
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: config.providerConfigFile,
    }

    logger.info(`刷B站开跑（${why}${dryRun ? ', dry-run' : ''}）：${bin} … cwd=${paths.workspace} provider=${provider.providerId}/${provider.modelId}`)
    const startedAt = Date.now()
    const child = spawn(bin, args, {
      cwd: paths.workspace,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    currentChild = child
    child.on('error', () => { if (currentChild === child) currentChild = null })
    child.on('close', () => { if (currentChild === child) currentChild = null })

    let sessionId = ''
    let outputTail = ''
    let stderrTail = ''
    let authError = false
    let usage = null
    let lineBuf = ''

    const handleLine = (line) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line)
        const sid = event?.sessionId || event?.session_id || event?.result?.sessionId
        if (sid && !sessionId) sessionId = String(sid)
        // 只在结构化错误里认鉴权失败；不要扫全部输出（`seq`/UUID 里的 1113 会误报）
        const err = event?.payload?.error || event?.error
        const isToolError = event?.type === 'tool.updated' || event?.payload?.toolCallId || event?.payload?.toolName
        if (err && !isToolError && isAuthError(JSON.stringify(err))) authError = true
        const u = findProviderUsage(event)
        if (u) {
          usage = {
            inputTokens: Number(u.inputTokens) || 0,
            outputTokens: Number(u.outputTokens) || 0,
            totalTokens: Number(u.totalTokens) || 0,
            cacheReadTokens: Number(u.cacheReadTokens) || 0,
            modelRequestCount: Number(u.modelRequestCount) || 0,
          }
        }
      } catch { /* 非 JSON 行保留在 stream.jsonl 里 */ }
    }

    const consume = (chunk, isErr = false) => {
      const text = String(chunk)
      if (!streamEnded) {
        try { stream.write(text) } catch (error) {
          streamError = streamError || error
          logger.warn(`stream.jsonl 写入失败（这一轮继续跑）：${String(error?.message ?? error)}`)
        }
      }
      outputTail = (outputTail + text).slice(-8000)
      if (isErr) {
        stderrTail = (stderrTail + text).slice(-8000)
        return
      }
      // stream-json 一行一条；必须跨 chunk 保留半行，否则被管道切开的 JSON 会被静默丢掉。
      // 只解析 stdout：stderr 是 zcode/工具的日志，混进同一个行缓冲会把 stdout 的半行弄坏。
      lineBuf += text
      const lines = lineBuf.split(/\r?\n/)
      lineBuf = lines.pop() || ''
      for (const line of lines) handleLine(line)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => consume(chunk, false))
    child.stderr?.on('data', (chunk) => consume(chunk, true))

    const timeoutMs = Math.max(5, Number(config.runTimeoutMinutes) || 30) * 60_000
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      logger.warn(`这一轮超过 ${Math.round(timeoutMs / 60_000)} 分钟，先 SIGTERM`)
      try { child.kill('SIGTERM') } catch { /* 已经没了 */ }
      const hard = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已经没了 */ } }, 5000)
      hard.unref?.()
    }, timeoutMs)
    timer.unref?.()

    // 用 close 而不是 exit：close 保证 stdout/stderr 已经排空，最后一个 usage 事件不会丢
    const code = await new Promise((resolve) => {
      child.on('close', (exitCode) => resolve(exitCode))
      child.on('error', (error) => {
        logger.error(`刷B站起不来：${String(error?.message ?? error)}`)
        resolve(-1)
      })
    })
    clearTimeout(timer)
    if (lineBuf.trim()) { handleLine(lineBuf); lineBuf = '' }
    streamEnded = true
    try { stream.end() } catch { /* 已结束 */ }
    // stderr 里出现真正的鉴权错误时也算；B站工具的 Unauthorized 不带 zcode/provider 上下文，不误判
    if (!authError && isZcodeAuthStderr(stderrTail)) authError = true

    const durationMs = Date.now() - startedAt
    const result = {
      ok: code === 0 && !timedOut && !authError,
      runId,
      why,
      code,
      timedOut,
      authError,
      sessionId,
      provider: `${provider.providerId}/${provider.modelId}`,
      durationMs,
      stream: streamFile,
      usage,
      ...(streamError ? { streamError: String(streamError?.message ?? streamError) } : {}),
    }
    if (authError) {
      logger.error('这一轮疑似凭据问题（1113/鉴权失败）：请重新同步桌面端 credentials.json')
      result.error = 'ZCode 凭据疑似失效（1113/401）'
    } else if (timedOut) {
      result.error = `超过 ${Math.round(timeoutMs / 60_000)} 分钟被中止`
    } else if (code !== 0) {
      result.error = `zcode 退出码 ${code}`
    }
    try { writeJson(join(runDir, 'result.json'), result) } catch (error) {
      logger.error(`写 result.json 失败（这一轮继续）：${String(error?.message ?? error)}`)
    }
    logger.info(`刷B站结束（${why}，code=${code}${timedOut ? '，超时' : ''}，${Math.round(durationMs / 1000)}s${usage ? `，tokens=${usage.totalTokens}` : ''}）`)
    if (logger.rotate) logger.rotate()
    return result
  } catch (error) {
    logger.error(`刷B站开跑失败（${why}）：${String(error?.stack ?? error)}`)
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    // 手动轮是额外的一次：把这一轮新挑的条数记进 manualExtra，自动额度不被吃掉
    try {
      if (manual && !dryRun) {
        const afterPicks = countPickedToday(paths, config, new Date())
        const delta = Math.max(0, afterPicks - beforePicks)
        if (delta > 0) {
          const st = readState(paths)
          const sameDay = st.day === dayKey(new Date(), config.timeZone)
          const extra = Math.max(0, Number(sameDay ? st.manualExtra : 0) || 0)
          bumpState(paths, { manualExtra: extra + delta }, { tz: config.timeZone })
          logger.info(`手动轮额外挑了 ${delta} 条 ⇒ 不占自动额度`)
        }
      }
    } catch (error) {
      logger.warn(`记手动额度失败（不影响这一轮）：${String(error?.message ?? error)}`)
    }
    releaseLock(paths.runLock)
  }
}
