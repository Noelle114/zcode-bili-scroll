import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { summarizeUsage } from '../src/usage.mjs'

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-usage-'))
  const paths = createPaths({ home })
  ensureHome(paths)
  return { home, paths }
}

function putRun(paths, id, result, at = new Date()) {
  const dir = join(paths.runsDir, id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'result.json')
  writeFileSync(file, JSON.stringify({ runId: id, ...result }))
  utimesSync(file, at, at)
}

test('summarizes token usage across runs', () => {
  const { home, paths } = setup()
  try {
    putRun(paths, 'run-1', {
      why: 'schedule:12:30',
      ok: true,
      code: 0,
      durationMs: 1000,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 80, modelRequestCount: 2 },
    })
    putRun(paths, 'run-2', {
      why: 'manual',
      ok: false,
      code: 1,
      durationMs: 500,
      usage: { inputTokens: 200, outputTokens: 30, totalTokens: 230, cacheReadTokens: 150, modelRequestCount: 3 },
    })
    const r = summarizeUsage(paths, { days: 3 })
    assert.equal(r.totals.runs, 2)
    assert.equal(r.totals.ok, 1)
    assert.equal(r.totals.withUsage, 2)
    assert.equal(r.totals.inputTokens, 300)
    assert.equal(r.totals.outputTokens, 50)
    assert.equal(r.totals.totalTokens, 350)
    assert.equal(r.totals.cacheReadTokens, 230)
    assert.equal(r.totals.modelRequestCount, 5)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('filters runs older than the window', () => {
  const { home, paths } = setup()
  try {
    putRun(paths, 'run-old', { ok: true, usage: { totalTokens: 999 } }, new Date(Date.now() - 5 * 86400_000))
    putRun(paths, 'run-new', { ok: true, usage: { totalTokens: 100 } })
    const r = summarizeUsage(paths, { days: 3 })
    assert.equal(r.totals.runs, 1)
    assert.equal(r.totals.totalTokens, 100)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
