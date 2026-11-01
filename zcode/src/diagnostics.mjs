import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { checkCredentials } from './credentials.mjs'
import { loadProvider } from './provider.mjs'
import { resolveZcode } from './runner.mjs'

export function runDoctor(paths, config) {
  const items = []
  const put = (name, ok, detail, fix = '') => items.push({ name, ok, detail, fix: ok ? '' : fix })

  const nodeMajor = Number(process.versions.node.split('.')[0])
  put('Node >= 22', nodeMajor >= 22, process.version, '安装 Node 22 LTS')

  const writable = (() => {
    try {
      const f = `${paths.home}/.write-test`
      writeFileSync(f, 'x')
      rmSync(f)
      return true
    } catch { return false }
  })()
  put('数据目录可写', writable, paths.home, `检查 ${paths.home} 权限`)

  put('Python venv', existsSync(paths.venvPython), paths.venvPython, '运行 bili-duty setup')

  const cred = checkCredentials(config.credentialsFile)
  put('ZCode 凭据', cred.ok, cred.ok ? `${cred.path}（${cred.mode}）` : `${cred.path}：${cred.reason}`, '同步桌面端 ~/.zcode/v2/credentials.json')

  const provider = loadProvider(config.providerConfigFile)
  put('provider 配置', provider.ok, provider.ok ? `${provider.providerId}/${provider.modelId}` : provider.errors.join('；'), '按 docs 配置 providerOrder 第一位')
  if (provider.warnings?.length) put('provider 警告', false, provider.warnings.join('；'), '视觉需要 openai-chat-completions + 自定义 provider ID')

  const zcode = resolveZcode(config)
  const probe = spawnSync(zcode, ['--version'], { encoding: 'utf8', timeout: 15000 })
  put('zcode CLI', probe.status === 0, (probe.stdout || probe.stderr || '').trim().split('\n')[0] || `exit ${probe.status}`, '安装 @clid/zcode 或设置 zcodeBin')

  put('B 站凭证', existsSync(`${paths.home}/bili_credential.json`), `${paths.home}/bili_credential.json`, '运行 bili-duty login')

  return { ok: items.every((x) => x.ok), items }
}
