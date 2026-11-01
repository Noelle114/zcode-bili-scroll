import { readJson, writeJson } from './util.mjs'

/**
 * 配置只在 config.mjs 里读写。
 * 优先级：config.json > 环境变量（ZCode userConfig 注入 / BILI_DUTY_*）> 默认值。
 * 这与 DSH 版不同：ZCode 没有原生设置对账，CLI/Web 保存的 config.json 是最终事实。
 */

export const DEFAULTS = {
  // 每天/每轮
  perDay: 5,
  maxPerRound: 1,
  peakValley: false,
  noon: true,
  night: true,
  manualMax: 3,
  manualCooldownMin: 10,
  runTimeoutMinutes: 30,

  // 搜索与判断
  keywords: [],
  excludeWords: [],
  searchSort: 'pubdate',
  searchPages: 2,
  fetchPerRound: 8,
  transcribe: false,
  asrModel: 'small',

  // 投递
  autoComment: false,
  dmMode: 'only',
  dmUid: 0,
  mentionName: '',
  commentPerRound: 1,
  commentLength: 'medium',
  replyToComments: false,
  replyPerRound: 1,
  reportLevel: 'full',
  personaPrompt: '',
  favFolderId: 0,

  // 私信双向（默认关闭：只发不收）
  dmWatch: false,
  dmWatchMinutes: 30,
  dmReplyPerDay: 0,
  dmOwnerUid: 0,

  // 通知节奏（低频优先）
  collectTimes: ['12:30', '20:30'],
  notifyEveryHours: 4,
  notifyOnlyWhenNew: true,
  notifyMaxPerDay: 4,
  quietHours: '23:00-08:00',

  // 运行环境
  zcodeBin: '',
  timeZone: 'Asia/Shanghai',
  providerConfigFile: '',
  credentialsFile: '',
  webPort: 8787,
  webToken: '',
  keepRunLogs: false,
}

const ENV_MAP = {
  perDay: 'BILI_DUTY_USER_PER_DAY',
  peakValley: 'BILI_DUTY_USER_PEAK_VALLEY',
  mentionName: 'BILI_DUTY_USER_MENTION_NAME',
  dmMode: 'BILI_DUTY_USER_DM_MODE',
  keywordsText: 'BILI_DUTY_USER_KEYWORDS_TEXT',
  personaPrompt: 'BILI_DUTY_USER_PERSONA',
  reportLevel: 'BILI_DUTY_USER_REPORT_LEVEL',
  autoComment: 'BILI_DUTY_USER_AUTO_COMMENT',
  transcribe: 'BILI_DUTY_USER_TRANSCRIBE',
}

const num = (value, def, min, max, int = false) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return def
  const clamped = Math.max(min, Math.min(max, n))
  return int ? Math.trunc(clamped) : clamped
}

const str = (value, def, max = 1000) => (typeof value === 'string' ? value.slice(0, max) : def)

const bool = (value, def) => {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return def
}

const list = (value, def = []) => {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
  return def
}

const oneOf = (value, allowed, def) => (allowed.includes(String(value)) ? String(value) : def)

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/

function times(value, def) {
  const arr = list(value, def).filter((x) => HHMM.test(x))
  return arr.length ? arr.slice(0, 8) : def
}

export function normalize(raw = {}, paths = null) {
  const d = DEFAULTS
  const out = {
    perDay: num(raw.perDay, d.perDay, 0, 50, true),
    maxPerRound: num(raw.maxPerRound, d.maxPerRound, 1, 10, true),
    peakValley: bool(raw.peakValley, d.peakValley),
    noon: bool(raw.noon, d.noon),
    night: bool(raw.night, d.night),
    manualMax: num(raw.manualMax, d.manualMax, 1, 20, true),
    manualCooldownMin: num(raw.manualCooldownMin, d.manualCooldownMin, 0, 120, true),
    runTimeoutMinutes: num(raw.runTimeoutMinutes, d.runTimeoutMinutes, 5, 120, true),

    keywords: list(raw.keywords, d.keywords),
    excludeWords: list(raw.excludeWords, d.excludeWords),
    searchSort: oneOf(raw.searchSort, ['pubdate', 'click', 'dm', 'totalrank'], d.searchSort),
    searchPages: num(raw.searchPages, d.searchPages, 1, 10, true),
    fetchPerRound: num(raw.fetchPerRound, d.fetchPerRound, 1, 30, true),
    transcribe: bool(raw.transcribe, d.transcribe),
    asrModel: oneOf(raw.asrModel, ['tiny', 'base', 'small', 'medium'], d.asrModel),

    autoComment: bool(raw.autoComment, d.autoComment),
    dmMode: oneOf(raw.dmMode, ['off', 'only', 'both'], d.dmMode),
    dmUid: num(raw.dmUid, d.dmUid, 0, Number.MAX_SAFE_INTEGER, true),
    mentionName: str(raw.mentionName, d.mentionName, 120),
    commentPerRound: num(raw.commentPerRound, d.commentPerRound, 0, 20, true),
    commentLength: oneOf(raw.commentLength, ['short', 'medium', 'long'], d.commentLength),
    replyToComments: bool(raw.replyToComments, d.replyToComments),
    replyPerRound: num(raw.replyPerRound, d.replyPerRound, 1, 10, true),
    reportLevel: oneOf(raw.reportLevel, ['full', 'brief', 'off'], d.reportLevel),
    personaPrompt: str(raw.personaPrompt, d.personaPrompt, 60000),
    favFolderId: num(raw.favFolderId, d.favFolderId, 0, Number.MAX_SAFE_INTEGER, true),

    dmWatch: bool(raw.dmWatch, d.dmWatch),
    dmWatchMinutes: num(raw.dmWatchMinutes, d.dmWatchMinutes, 5, 1440, true),
    dmReplyPerDay: num(raw.dmReplyPerDay, d.dmReplyPerDay, 0, 20, true),
    dmOwnerUid: num(raw.dmOwnerUid, d.dmOwnerUid, 0, Number.MAX_SAFE_INTEGER, true),

    collectTimes: times(raw.collectTimes, d.collectTimes),
    notifyEveryHours: num(raw.notifyEveryHours, d.notifyEveryHours, 1, 24, true),
    notifyOnlyWhenNew: bool(raw.notifyOnlyWhenNew, d.notifyOnlyWhenNew),
    notifyMaxPerDay: num(raw.notifyMaxPerDay, d.notifyMaxPerDay, 1, 24, true),
    quietHours: str(raw.quietHours, d.quietHours, 32),

    zcodeBin: str(raw.zcodeBin, d.zcodeBin, 500),
    timeZone: str(raw.timeZone, d.timeZone, 64),
    providerConfigFile: str(raw.providerConfigFile, d.providerConfigFile, 1000),
    credentialsFile: str(raw.credentialsFile, d.credentialsFile, 1000),
    webPort: num(raw.webPort, d.webPort, 1, 65535, true),
    webToken: str(raw.webToken, d.webToken, 200),
    keepRunLogs: bool(raw.keepRunLogs, d.keepRunLogs),
  }

  if (paths) {
    if (!out.providerConfigFile) out.providerConfigFile = paths.defaultProviderFile
    if (!out.credentialsFile) out.credentialsFile = paths.defaultCredentialsFile
  }
  return out
}

function envPatch(env) {
  const patch = {}
  for (const [key, name] of Object.entries(ENV_MAP)) {
    if (env[name] === undefined) continue
    patch[key] = env[name]
  }
  // keywordsText 是 userConfig 的输入别名；config.json 里的 keywords 仍然优先
  if (patch.keywordsText !== undefined) {
    const kws = list(patch.keywordsText, [])
    delete patch.keywordsText
    if (kws.length) patch.keywords = kws
  }
  return patch
}

export function loadConfig(paths, env = process.env) {
  const saved = readJson(paths.config, {})
  const merged = { ...DEFAULTS, ...envPatch(env), ...(saved && typeof saved === 'object' ? saved : {}) }
  return normalize(merged, paths)
}

export function saveConfig(paths, patch) {
  const next = normalize({ ...loadConfig(paths), ...(patch || {}) }, paths)
  writeJson(paths.config, next)
  return next
}

/** CLI 用：把 `key=value` 按默认值的类型转一下 */
export function parseConfigValue(key, raw) {
  if (!(key in DEFAULTS)) throw new Error(`不认识的配置项：${key}`)
  const def = DEFAULTS[key]
  if (Array.isArray(def)) return list(raw, def)
  if (typeof def === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new Error(`${key} 需要数字`)
    return n
  }
  if (typeof def === 'boolean') {
    if (raw === 'true' || raw === '1') return true
    if (raw === 'false' || raw === '0') return false
    throw new Error(`${key} 需要 true/false`)
  }
  return String(raw)
}

export function setConfigValue(paths, key, raw) {
  const value = parseConfigValue(key, raw)
  return saveConfig(paths, { [key]: value })
}
