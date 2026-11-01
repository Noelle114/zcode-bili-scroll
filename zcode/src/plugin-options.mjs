import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 读取 ZCode 存储在 `~/.zcode/cli/config.json` 里的插件选项（`plugins.options`）。
 * daemon / PreToolUse hook 不经过 MCP，拿不到 userConfig 注入的 env；这里把它们接回来。
 * 只认**显式保存过**的选项，不读 manifest 默认值 —— 否则默认值会反过来覆盖 config.json。
 */
export function zcodeConfigPath(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir()
  return join(home, '.zcode', 'cli', 'config.json')
}

export function readPluginOptions(pluginRoot, { env = process.env } = {}) {
  if (!pluginRoot) return {}
  try {
    const config = JSON.parse(readFileSync(zcodeConfigPath(env), 'utf8'))
    const manifest = JSON.parse(readFileSync(join(pluginRoot, '.zcode-plugin', 'plugin.json'), 'utf8'))
    const name = String(manifest?.name || '').trim()
    const options = config?.plugins?.options
    if (!name || !options || typeof options !== 'object' || Array.isArray(options)) return {}
    const keys = Object.keys(options).filter((key) => key === name || key.startsWith(`${name}@`))
    for (const key of keys) {
      const value = options[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    }
    return {}
  } catch {
    // ZCode 配置不存在/损坏不是插件的错误；daemon 还是要能启动
    return {}
  }
}
