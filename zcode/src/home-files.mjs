import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Python MCP 的凭证路径是 `Path(__file__).parent / bili_credential.json`，
 * 所以运行时把脚本铺到数据目录再跑 —— 凭证就落在家里，不会写进插件包。
 * 覆盖前留一份 .bak-时间戳；这几个是运行时代码，用户改过也不该拦升级。
 */
export function ensureHomeFiles(paths, log = () => {}) {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 })
  const pairs = [
    [paths.pythonMcp, join(paths.home, 'mcp_server.py')],
    [paths.asrScript, join(paths.home, 'asr.py')],
    [paths.favopsScript, join(paths.home, 'favops.py')],
  ]
  for (const [from, to] of pairs) {
    try {
      if (!existsSync(from)) {
        log(`缺文件：${from}`)
        continue
      }
      const incoming = readFileSync(from, 'utf8')
      let current = null
      try { current = readFileSync(to, 'utf8') } catch { /* 还没铺过 */ }
      if (current === incoming) continue
      if (current !== null) {
        const bak = `${to}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
        try { copyFileSync(to, bak) } catch { /* 备份不了也继续 */ }
        log(`覆盖 ${to}（旧份备份 ${bak}）`)
      }
      copyFileSync(from, to)
      log(`已铺好 ${to}`)
    } catch (error) {
      log(`铺 ${to} 失败：${String(error?.message ?? error)}`)
    }
  }
}
