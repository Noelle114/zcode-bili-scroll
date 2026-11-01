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
import { writeJson } from './util.mjs'

const DISALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Agent', 'Task', 'Skill',
  'TodoWrite', 'NotebookEdit', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
].join(',')

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

/**
 * 跑一轮：spawn `zcode --prompt`，解析 stream-json，按退出码/超时收尾。
 * 收尾的「数条数 / 补齐报告 / 复核 / 收藏」在 postrun 里，本函数只负责运行。
 */
export async function runRound(paths = createPaths(), { why = 'manual', dryRun = false, log } = {}) {
  const config = loadConfig(paths)
  const logger = log || createLogger(paths, { alsoConsole: true })
  const lock = acquireLock(paths.runLock, { why })
  if (!lock.ok) {
    logger.warn(`这一轮没跑（${why}）：另一个进程正在跑（pid=${lock.lock?.pid}）`)
    return { ok: false, error: '上一轮还在跑', busy: true, lock: lock.lock }
  }

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

    let sessionId = ''
    let outputTail = ''
    let stderrTail = ''
    let authError = false
    let usage = null
    const consume = (chunk, isErr = false) => {
      const text = String(chunk)
      stream.write(text)
      outputTail = (outputTail + text).slice(-8000)
      if (isErr) stderrTail = (stderrTail + text).slice(-8000)
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          const sid = event?.sessionId || event?.session_id || event?.result?.sessionId
          if (sid && !sessionId) sessionId = String(sid)
          // 只在结构化错误里认鉴权失败；不要扫全部输出（`seq`/UUID 里的 1113 会误报）
          const err = event?.payload?.error || event?.error
          if (err && isAuthError(JSON.stringify(err))) authError = true
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

    const code = await new Promise((resolve) => {
      child.on('exit', (exitCode) => resolve(exitCode))
      child.on('error', (error) => {
        logger.error(`刷B站起不来：${String(error?.message ?? error)}`)
        resolve(-1)
      })
    })
    clearTimeout(timer)
    stream.end()
    // stderr 里出现真正的鉴权错误时也算（模型输出已排除，不会再把 seq/UUID 当错误）
    if (!authError && isAuthError(stderrTail)) authError = true

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
    }
    if (authError) {
      logger.error('这一轮疑似凭据问题（1113/鉴权失败）：请重新同步桌面端 credentials.json')
      result.error = 'ZCode 凭据疑似失效（1113/401）'
    } else if (timedOut) {
      result.error = `超过 ${Math.round(timeoutMs / 60_000)} 分钟被中止`
    } else if (code !== 0) {
      result.error = `zcode 退出码 ${code}`
    }
    writeJson(join(runDir, 'result.json'), result)
    logger.info(`刷B站结束（${why}，code=${code}${timedOut ? '，超时' : ''}，${Math.round(durationMs / 1000)}s${usage ? `，tokens=${usage.totalTokens}` : ''}）`)
    if (logger.rotate) logger.rotate()
    return result
  } catch (error) {
    logger.error(`刷B站开跑失败（${why}）：${String(error?.stack ?? error)}`)
    return { ok: false, error: String(error?.message ?? error) }
  } finally {
    releaseLock(paths.runLock)
  }
}
