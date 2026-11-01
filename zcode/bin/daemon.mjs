#!/usr/bin/env node
/**
 * systemd 常驻入口：只负责调度循环。
 * 工具服务由 `bin/mcp-server.mjs` 提供；这一支不在 TUI 的 MCP 进程里跑循环。
 */
import { createPaths, ensureHome } from '../src/paths.mjs'
import { loadConfig } from '../src/config.mjs'
import { createLogger } from '../src/log.mjs'
import { tick } from '../src/scheduler.mjs'
import { stopRound } from '../src/runner.mjs'

const paths = createPaths()
ensureHome(paths)
const log = createLogger(paths, { alsoConsole: true })
let first
try {
  first = loadConfig(paths)
} catch (error) {
  log.error(`配置读取失败，daemon 不启动：${String(error?.message ?? error)}`)
  process.exit(1)
}

log.info(`daemon start home=${paths.home} tz=${first.timeZone} peakValley=${first.peakValley} collectTimes=${(first.collectTimes || []).join(',')} notifyEveryHours=${first.notifyEveryHours}`)
if (first.dmWatch) log.warn('dmWatch=true：本轮 MVP 只做发送，私信监听循环尚未接入')

let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  log.info(`daemon stop（${signal}）`)
  stopRound()
  // 给正跑的一轮一点时间走 finally（释放锁）；systemd 的 control-group 也会兜底
  const t = setTimeout(() => process.exit(0), 1000)
  t.unref?.()
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))

function tickOnce() {
  if (stopping) return
  try {
    // 每跳重读配置：改 collectTimes / peakValley 不用重启 daemon
    const config = loadConfig(paths)
    tick(paths, config, { now: new Date(), log: (msg) => log.info(msg) })
      .catch((error) => log.error(`scheduler tick 出错：${String(error?.stack ?? error)}`))
  } catch (error) {
    log.error(`scheduler 读取配置失败：${String(error?.stack ?? error)}`)
  }
}

tickOnce()
setInterval(tickOnce, 60_000)
