#!/usr/bin/env node
/**
 * systemd 常驻入口（骨架）：
 * 现在只负责加载配置、写启动日志、保持进程；调度/私信循环在后续任务里接。
 */
import { createPaths, ensureHome } from '../src/paths.mjs'
import { loadConfig } from '../src/config.mjs'
import { createLogger } from '../src/log.mjs'

const paths = createPaths()
ensureHome(paths)
const config = loadConfig(paths)
const log = createLogger(paths, { alsoConsole: true })

log.info(`daemon start home=${paths.home} tz=${config.timeZone} dmWatch=${config.dmWatch} peakValley=${config.peakValley}`)

let stopping = false
function stop(signal) {
  if (stopping) return
  stopping = true
  log.info(`daemon stop（${signal}）`)
  process.exit(0)
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))

// 占位心跳：后续换成 scheduler.tick() + dmWatch
setInterval(() => {}, 60_000)
