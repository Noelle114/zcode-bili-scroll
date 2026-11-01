import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const num = (value) => Number(value) || 0

/**
 * 汇总最近 N 天的值班轮：token、请求数、成功/失败。
 * 数据来自 `runs/` 下每个 run 目录里的 `result.json`；usage 是 runner 从 stream 的 provider 汇总事件里取的。
 */
export function summarizeUsage(paths, { days = 3, now = Date.now() } = {}) {
  const cutoff = now - days * 86400_000
  const rows = []
  try {
    for (const name of readdirSync(paths.runsDir)) {
      if (!name.startsWith('run-')) continue
      const dir = join(paths.runsDir, name)
      let st
      try { st = statSync(join(dir, 'result.json')) } catch { continue }
      if (st.mtimeMs < cutoff) continue
      let result
      try { result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) } catch { continue }
      const u = result.usage
      rows.push({
        runId: result.runId || name,
        at: new Date(st.mtimeMs).toISOString(),
        why: result.why || '',
        ok: Boolean(result.ok),
        code: result.code,
        durationMs: num(result.durationMs),
        usage: u ? {
          inputTokens: num(u.inputTokens),
          outputTokens: num(u.outputTokens),
          totalTokens: num(u.totalTokens),
          cacheReadTokens: num(u.cacheReadTokens),
          modelRequestCount: num(u.modelRequestCount),
        } : null,
      })
    }
  } catch { /* runs 目录不存在 */ }

  rows.sort((a, b) => (a.at < b.at ? 1 : -1))
  const totals = rows.reduce((acc, row) => {
    acc.runs += 1
    if (row.ok) acc.ok += 1
    if (row.usage) {
      acc.withUsage += 1
      acc.inputTokens += row.usage.inputTokens
      acc.outputTokens += row.usage.outputTokens
      acc.totalTokens += row.usage.totalTokens
      acc.cacheReadTokens += row.usage.cacheReadTokens
      acc.modelRequestCount += row.usage.modelRequestCount
    }
    return acc
  }, {
    runs: 0,
    ok: 0,
    withUsage: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    modelRequestCount: 0,
  })

  return { ok: true, days, since: new Date(cutoff).toISOString(), totals, rows }
}
