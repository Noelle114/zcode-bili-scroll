import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export function defaultCredentialsFile() {
  return join(process.env.HOME || homedir(), '.zcode', 'v2', 'credentials.json')
}

export function checkCredentials(file = defaultCredentialsFile()) {
  try {
    if (!existsSync(file)) return { ok: false, path: file, reason: 'missing' }
    const st = statSync(file)
    if (!st.size) return { ok: false, path: file, reason: 'empty' }
    return {
      ok: true,
      path: file,
      size: st.size,
      mode: (st.mode & 0o777).toString(8).padStart(3, '0'),
    }
  } catch (error) {
    return { ok: false, path: file, reason: String(error?.message ?? error) }
  }
}

/**
 * 服务器不能独立 OAuth：必须把桌面端 ~/.zcode/v2/credentials.json 同步过来。
 * 只做复制和权限，不解析内容、不打印 token。
 */
export function syncCredentials(src, dest = defaultCredentialsFile()) {
  if (!existsSync(src)) throw new Error(`源文件不存在：${src}`)
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
  copyFileSync(src, dest)
  try { chmodSync(dest, 0o600) } catch { /* Windows */ }
  return checkCredentials(dest)
}

/** 1113 是 BigModel/Z.AI 的「余额/资源包不足」；看到它先怀疑凭据，不要当成模型问题。
 *  ⚠️ 不能匹配裸 1113：流事件里的 `seq` / UUID 也可能含 1113（2026-11-01 真实一轮误报过）。 */
export function isAuthError(text) {
  const s = String(text || '')
  return /(?:code|status|error|message|错误码|错误)["'\s:=]{0,40}?\b1113\b|\b1113\b[^\n]{0,80}?(?:Insufficient|balance|resource package)|Insufficient balance|no resource package|invalid[\s_-]?token|token (?:has )?expired|HTTP\s+401|["']?(?:status|code)["']?\s*[:=]\s*401|Unauthorized/i.test(s)
}

export function isQuotaError(text) {
  const s = String(text || '')
  return /(?:code|status|error|message|错误码|错误)["'\s:=]{0,40}?\b(?:1113|429)\b|\b1113\b[^\n]{0,80}?(?:Insufficient|balance|resource package)|Insufficient balance|no resource package|quota exceeded|rate[\s_-]?limit|HTTP\s+429|["']?(?:status|code)["']?\s*[:=]\s*429/i.test(s)
}
