import { spawn } from 'node:child_process'
import { join, resolve, sep } from 'node:path'
import { saveConfig } from '../config.mjs'
import { syncCredentials } from '../credentials.mjs'
import { loadProvider } from '../provider.mjs'
import { buildStatus } from '../status.mjs'
import { runDoctor } from '../diagnostics.mjs'

const objectSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})

export const adminToolSpecs = [
  {
    name: 'bili_run',
    description: '手动跑一轮：起一个 zcode 值班轮，立刻返回；报告写到 out/<日期>.md。可传 dryRun 只验证链路。',
    inputSchema: objectSchema({ dryRun: { type: 'boolean', description: '只跑最小 prompt，不调工具、不写报告' } }),
  },
  {
    name: 'admin_status',
    description: '看刷B站状态：登录、配额、provider、运行中、下次窗口。只读。',
    inputSchema: objectSchema({}),
  },
  {
    name: 'admin_config_get',
    description: '读配置；传 key 只读一项。',
    inputSchema: objectSchema({ key: { type: 'string' } }),
  },
  {
    name: 'admin_config_set',
    description: '改配置（只接受已知字段，宿主会做范围钳制）。',
    inputSchema: objectSchema({ patch: { type: 'object', additionalProperties: true } }, ['patch']),
  },
  {
    name: 'admin_sync_credentials',
    description: '把桌面端 ZCode 的 credentials.json 同步到服务器；源路径必填。只复制，不打印内容。',
    inputSchema: objectSchema({ source: { type: 'string', description: '桌面端 ~/.zcode/v2/credentials.json 的本地路径' } }, ['source']),
  },
  {
    name: 'admin_provider_check',
    description: '校验 provider 配置：providerOrder 第一位、OpenAI 兼容端点、模型列表。',
    inputSchema: objectSchema({ file: { type: 'string', description: '默认使用 config.providerConfigFile' } }),
  },
  {
    name: 'admin_doctor',
    description: '环境自检：Node、venv、ZCode 凭据、provider、zcode CLI、B 站凭证。',
    inputSchema: objectSchema({}),
  },
  {
    name: 'admin_setup',
    description: '安装主依赖（MVP 阶段还在迁移，暂返回提示）。',
    inputSchema: objectSchema({}),
  },
  {
    name: 'admin_login',
    description: '扫码登录（MVP 阶段还在迁移，暂返回提示）。',
    inputSchema: objectSchema({}),
  },
]

function startRun(ctx, args) {
  const bin = join(ctx.paths.pluginRoot, 'bin', 'bili-duty.mjs')
  const argv = [bin, 'run', '--manual', ...(args?.dryRun ? ['--dry-run'] : [])]
  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      BILI_DUTY_HOME: ctx.paths.home,
      BILI_DUTY_PLUGIN_ROOT: ctx.paths.pluginRoot,
    },
  })
  child.unref()
  ctx.log?.info?.(`bili_run 已启动：pid=${child.pid} dryRun=${Boolean(args?.dryRun)}`)
  return {
    ok: true,
    started: true,
    pid: child.pid,
    dryRun: Boolean(args?.dryRun),
    hint: args?.dryRun ? 'dry-run 只验证链路，不写报告' : `报告会写到 ${ctx.paths.outDir}/<日期>.md`,
  }
}

export async function handleAdminTool(name, args = {}, ctx) {
  switch (name) {
    case 'bili_run':
      return startRun(ctx, args)
    case 'admin_status':
      return buildStatus(ctx.paths, ctx.config)
    case 'admin_config_get': {
      if (args?.key) return { ok: true, [args.key]: ctx.config[args.key] }
      return { ok: true, config: ctx.config }
    }
    case 'admin_config_set': {
      if (!args?.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) {
        throw new Error('patch 必须是对象')
      }
      return { ok: true, config: saveConfig(ctx.paths, args.patch) }
    }
    case 'admin_sync_credentials': {
      const source = String(args?.source || '').trim()
      if (!source) throw new Error('source 必填')
      return { ok: true, ...syncCredentials(source, ctx.config.credentialsFile) }
    }
    case 'admin_provider_check': {
      let file = String(args?.file || '').trim() || ctx.config.providerConfigFile
      file = resolve(file)
      const root = resolve(ctx.paths.providersDir)
      if (!file.startsWith(root + sep)) throw new Error(`只允许检查 ${root} 下的 provider 文件`)
      return loadProvider(file)
    }
    case 'admin_doctor':
      return runDoctor(ctx.paths, ctx.config)
    case 'admin_setup':
      return { ok: false, error: '安装脚本还在迁移：先复用 spike 的 venv，或等 T8 接完' }
    case 'admin_login':
      return { ok: false, error: '登录脚本还在迁移：先用 /home/bili/spike-notes/login_qr.py' }
    default:
      throw new Error(`不认识的 admin 工具：${name}`)
  }
}
