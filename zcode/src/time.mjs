/**
 * 时区/日期/谷时窗口。
 *
 * 云服务器通常是 UTC；不能依赖本机时区。所有按用户日历翻页的判断
 * （dayKey、谷时窗口、seen 日期）都走 BILI_DUTY_TZ，默认 Asia/Shanghai。
 */

export const WINDOWS = {
  noon: { label: '中午谷时', start: '12:00', end: '14:00' },
  night: { label: '晚上/夜间谷时', start: '18:00', end: '09:00' },
}

export function timeZone(override) {
  return String(override || process.env.BILI_DUTY_TZ || 'Asia/Shanghai')
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** 把一个时刻换算成目标时区的 { 年/月/日/分钟数/星期 } */
export function clockIn(now = new Date(), tz = timeZone()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = {}
  for (const part of fmt.formatToParts(now)) parts[part.type] = part.value
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minutes: hour * 60 + Number(parts.minute),
    weekday: WEEKDAY[parts.weekday] ?? 0,
  }
}

const pad = (n) => String(n).padStart(2, '0')

/** 目标时区的 YYYY-MM-DD */
export function dayKey(now = new Date(), tz = timeZone()) {
  const c = clockIn(now, tz)
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`
}

function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * 现在在不在这个窗口里（支持跨零点）。
 * 官方口径：工作日 9–12 / 14–18 是高峰，其余（含整个周末）都是谷时。
 */
export function inWindow(now, win, tz = timeZone()) {
  const start = minutesOf(win?.start)
  const end = minutesOf(win?.end)
  if (start === null || end === null) return false
  const { minutes, weekday } = clockIn(now, tz)
  if (weekday === 0 || weekday === 6) return true
  return start <= end ? (minutes >= start && minutes < end) : (minutes >= start || minutes < end)
}

/**
 * 判重表里的日期格 → YYYY-MM-DD；认不出来返回 null。
 * 宽容：允许没写年份、带时间、用 / 或 . 分隔；没写年份时按今天补，
 * 补出来比今天晚（例如一月读到 12-31）就算去年。
 */
export function seenDay(raw, now = new Date(), tz = timeZone()) {
  const m = /^(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(String(raw ?? '').trim())
  if (!m) return null
  const mo = Number(m[2])
  const d = Number(m[3])
  let y = m[1] ? Number(m[1]) : clockIn(now, tz).year
  const valid = (yy) => {
    const t = new Date(Date.UTC(yy, mo - 1, d))
    return t.getUTCFullYear() === yy && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
  }
  if (!valid(y)) return null
  const key = `${y}-${pad(mo)}-${pad(d)}`
  if (!m[1] && key > dayKey(now, tz)) {
    y -= 1
    if (!valid(y)) return null // 02-29 遇上去年不是闰年
  }
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** 距下一个窗口开始还有多少分钟（用于状态展示，简单实现） */
export function minutesUntilWindow(now, win, tz = timeZone()) {
  const start = minutesOf(win?.start)
  if (start === null) return null
  const { minutes } = clockIn(now, tz)
  return start >= minutes ? start - minutes : 24 * 60 - minutes + start
}
