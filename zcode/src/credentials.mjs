import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export function defaultCredentialsFile() {
  return join(process.env.HOME || homedir(), '.zcode', 'v2', 'credentials.json')
}

/** 从 JWT 的 payload 里取 exp（秒）；不是 JWT 或没有 exp 返回 null。绝不返回 token 本体。 */
function jwtExpiry(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    const exp = Number(payload?.exp)
    if (!Number.isFinite(exp) || exp <= 0) return null
    return exp > 1e12 ? exp : exp * 1000
  } catch {
    return null
  }
}

const EXPIRY_KEY = /^(?:exp|expire|expires|expiry|expiration|expiresAt|expireAt|expireTime|expiryTime|expires_at|expire_at|expire_time|expiry_time)$/i

function absoluteTime(value) {
  let n = Number(value)
  if (!Number.isFinite(n) && typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
    return null
  }
  if (!Number.isFinite(n) || n <= 0) return null
  if (n > 1e12) return n
  if (n > 1e9) return n * 1000
  return null
}

/** 递归找 JWT 的 exp、以及 user_info 等 JSON 里的 expiresAt/expireTime；不返回任何原文。 */
function collectExpiries(value, out = [], depth = 0) {
  if (depth > 5 || value == null) return out
  if (typeof value === 'string') {
    const exp = jwtExpiry(value)
    if (exp) out.push(exp)
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { collectExpiries(JSON.parse(trimmed), out, depth + 1) } catch { /* 普通文本 */ }
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExpiries(item, out, depth + 1)
    return out
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (EXPIRY_KEY.test(key)) {
        const exp = absoluteTime(item)
        if (exp) out.push(exp)
      } else {
        collectExpiries(item, out, depth + 1)
      }
    }
  }
  return out
}

export function checkCredentials(file = defaultCredentialsFile()) {
  try {
    if (!existsSync(file)) return { ok: false, path: file, reason: 'missing' }
    const st = statSync(file)
    if (!st.isFile()) return { ok: false, path: file, reason: 'not-a-file' }
    if (!st.size) return { ok: false, path: file, reason: 'empty' }
    let data
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return { ok: false, path: file, reason: 'not-json' }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, path: file, reason: 'not-json-object' }
    }
    const exps = collectExpiries(data)
    if (exps.length && Math.max(...exps) <= Date.now() + 60_000) {
      return { ok: false, path: file, reason: 'expired' }
    }
    return {
      ok: true,
      path: file,
      size: st.size,
      mode: (st.mode & 0o777).toString(8).padStart(3, '0'),
      ...(exps.length ? { expiresAt: new Date(Math.max(...exps)).toISOString() } : {}),
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
