import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PLUGIN_ROOT = resolve(HERE, '..')

/**
 * 路径解析：只在这里拼数据目录/插件目录，其他模块一律用它。
 * 数据目录优先级：opts.home > BILI_DUTY_HOME > ZCODE_PLUGIN_DATA > ~/.bili-duty
 */
export function createPaths(opts = {}) {
  const pluginRoot = opts.pluginRoot || process.env.BILI_DUTY_PLUGIN_ROOT || DEFAULT_PLUGIN_ROOT
  const home = opts.home
    || process.env.BILI_DUTY_HOME
    || process.env.ZCODE_PLUGIN_DATA
    || join(homedir(), '.bili-duty')

  const p = {
    pluginRoot,
    home,
    config: join(home, 'config.json'),
    state: join(home, 'state.json'),
    log: join(home, 'duty.log'),
    seen: join(home, 'seen.md'),
    comments: join(home, 'comments.md'),
    outDir: join(home, 'out'),
    digestDir: join(home, 'digest'),
    reportsDir: join(home, 'reports'),
    seenDir: join(home, 'seen'),
    workspace: join(home, 'workspace'),
    providersDir: join(home, 'providers'),
    runsDir: join(home, 'runs'),
    tmpAsr: join(home, 'tmp', 'asr'),
    runLock: join(home, 'run-lock.json'),
    dmLock: join(home, 'dm-lock.json'),
    venv: join(home, '.venv'),
    venvAsr: join(home, '.venv-asr'),
    uvCache: join(home, 'uv-cache'),
    uvPython: join(home, 'uv-python'),
    hfCache: join(home, '.hf-cache'),
    bin: join(home, 'bin'),
    qrPng: join(home, 'qrcode_login.png'),
  }

  const isWin = process.platform === 'win32'
  p.venvPython = isWin ? join(p.venv, 'Scripts', 'python.exe') : join(p.venv, 'bin', 'python')
  p.asrPython = isWin ? join(p.venvAsr, 'Scripts', 'python.exe') : join(p.venvAsr, 'bin', 'python')

  // 共享资产：发布态在插件根下；开发态在仓库根（zcode/ 的上一级）
  const asset = (rel) => {
    const atRoot = join(pluginRoot, rel)
    return existsSync(atRoot) ? atRoot : join(pluginRoot, '..', rel)
  }
  p.vendorDir = asset('vendor/bilibili-mcp')
  p.promptsDir = asset('prompts')
  p.libDir = asset('lib')
  p.dutyCharter = join(p.promptsDir, 'duty.md')
  p.pythonMcp = join(p.vendorDir, 'mcp_server.py')
  p.asrScript = join(p.libDir, 'asr.py')
  p.favopsScript = join(p.libDir, 'favops.py')

  p.defaultProviderFile = join(p.providersDir, 'provider.recommended.json')
  p.defaultCredentialsFile = join(process.env.HOME || homedir(), '.zcode', 'v2', 'credentials.json')

  return p
}

export function ensureHome(paths) {
  const dirs = [
    paths.home,
    paths.outDir,
    paths.digestDir,
    paths.reportsDir,
    paths.seenDir,
    paths.workspace,
    paths.providersDir,
    paths.runsDir,
    paths.tmpAsr,
    paths.bin,
  ]
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  try { chmodSync(paths.home, 0o700) } catch { /* Windows 上可能不支持 */ }
  // 判重表由宿主预建：那一轮只追加；没有它模型会以为"从没看过"
  try {
    if (!existsSync(paths.seen)) {
      writeFileSync(paths.seen, [
        '# 刷B站 · 判重表（宿主预建，那一轮只往后面追加）',
        '',
        '## 评论记录（BV | rpid | root（楼中楼才填） | 时间 | 正文前 20 字）',
        '',
        '| BV | rpid | root（楼中楼才填） | 时间 | 正文前 20 字 |',
        '| --- | --- | --- | --- | --- |',
        '',
        '## 看过的视频',
        '',
      ].join('\n'), { encoding: 'utf8', mode: 0o600 })
    }
  } catch { /* 建不了也别拦着插件加载 */ }
}
