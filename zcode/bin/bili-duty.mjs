#!/usr/bin/env node
import { createPaths, ensureHome } from '../src/paths.mjs'
import { DEFAULTS, loadConfig, setConfigValue } from '../src/config.mjs'
import { createLogger } from '../src/log.mjs'
import { syncCredentials } from '../src/credentials.mjs'
import { loadProvider } from '../src/provider.mjs'
import { buildStatus } from '../src/status.mjs'
import { runDoctor } from '../src/diagnostics.mjs'
import { runRound } from '../src/runner.mjs'

const args = process.argv.slice(2)
const cmd = args.shift() || 'status'
const paths = createPaths()
ensureHome(paths)
const config = loadConfig(paths)
const log = createLogger(paths)

function print(value) {
  if (typeof value === 'string') console.log(value)
  else console.log(JSON.stringify(value, null, 2))
}

async function main() {
  switch (cmd) {
    case 'status':
      return print(buildStatus(paths, config))
    case 'config': {
      const sub = args.shift()
      if (sub === 'get') {
        const key = args[0]
        return print(key ? { [key]: config[key] } : config)
      }
      if (sub === 'set') {
        if (!args.length) throw new Error('用法：bili-duty config set key=value [...]')
        let next = config
        for (const pair of args) {
          const idx = pair.indexOf('=')
          if (idx < 0) throw new Error(`参数要写成 key=value：${pair}`)
          next = setConfigValue(paths, pair.slice(0, idx), pair.slice(idx + 1))
        }
        return print({ ok: true, config: next })
      }
      if (sub === 'keys') return print(Object.keys(DEFAULTS))
      throw new Error('用法：bili-duty config get|set|keys')
    }
    case 'sync-credentials': {
      const src = args[0]
      if (!src) throw new Error('用法：bili-duty sync-credentials <桌面端 credentials.json 路径>')
      return print({ ok: true, ...syncCredentials(src, config.credentialsFile) })
    }
    case 'provider': {
      const sub = args.shift() || 'check'
      if (sub !== 'check') throw new Error('用法：bili-duty provider check [file]')
      return print(loadProvider(args[0] || config.providerConfigFile))
    }
    case 'doctor':
      return print(runDoctor(paths, config))
    case 'run': {
      const dryRun = args.includes('--dry-run')
      return print(await runRound(paths, { why: 'manual', dryRun, log }))
    }
    case 'tick': {
      const { tick } = await import('../src/scheduler.mjs')
      const dryRun = args.includes('--dry-run')
      return print(await tick(paths, config, { log: (msg) => log.info(msg), dryRun }))
    }
    case 'usage': {
      const daysArg = args.find((arg) => arg.startsWith('--days='))
      const days = Math.max(1, Math.min(Number(daysArg?.split('=')[1]) || 3, 30))
      const { summarizeUsage } = await import('../src/usage.mjs')
      return print(summarizeUsage(paths, { days }))
    }
    case 'login':
      return print({ ok: false, error: '登录脚本还在迁移：先用 /home/bili/spike-notes/login_qr.py' })
    case 'setup':
      return print({ ok: false, error: '安装脚本还在迁移：先复用 spike 的环境' })
    default:
      throw new Error(`不认识的命令：${cmd}（可用：status/config/sync-credentials/provider/doctor/run/tick/usage）`)
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2))
  process.exit(1)
})
