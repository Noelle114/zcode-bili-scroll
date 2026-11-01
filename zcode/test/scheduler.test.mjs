import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { DEFAULTS, normalize } from '../src/config.mjs'
import { bumpState, readState } from '../src/state.mjs'
import { dueCollect, parseCollectTimes, tick } from '../src/scheduler.mjs'

function setup(patch = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-scheduler-'))
  const paths = createPaths({ home })
  ensureHome(paths)
  const config = normalize({
    ...DEFAULTS,
    peakValley: true,
    collectTimes: ['12:30', '20:30'],
    perDay: 2,
    timeZone: 'Asia/Shanghai',
    ...patch,
  }, paths)
  return { home, paths, config }
}

const at = (hhmm) => new Date(`2026-11-01T${hhmm}:00+08:00`)

test('parseCollectTimes normalizes and sorts', () => {
  assert.deepEqual(parseCollectTimes({ collectTimes: ['20:30', '9:05', 'bad'] }), [
    { hhmm: '09:05', minutes: 9 * 60 + 5 },
    { hhmm: '20:30', minutes: 20 * 60 + 30 },
  ])
})

test('due at collect time', () => {
  const { home, paths, config } = setup()
  try {
    const r = dueCollect(paths, config, at('12:31'))
    assert.equal(r.due, true)
    assert.equal(r.time, '12:30')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('not due before the first collect time', () => {
  const { home, paths, config } = setup()
  try {
    const r = dueCollect(paths, config, at('12:00'))
    assert.equal(r.due, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('catch-up within 60 minutes, not after', () => {
  const { home, paths, config } = setup()
  try {
    assert.equal(dueCollect(paths, config, at('13:29')).due, true)
    assert.equal(dueCollect(paths, config, at('13:31')).due, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('window key deduplicates a collect time', () => {
  const { home, paths, config } = setup()
  try {
    bumpState(paths, { windows: { '2026-11-01@12:30': true } }, { now: at('12:31'), tz: config.timeZone })
    const r = dueCollect(paths, config, at('12:31'))
    assert.equal(r.due, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a stale running mark is retried after the daemon restarts', () => {
  const { home, paths, config } = setup()
  try {
    bumpState(paths, {
      windows: { '2026-11-01@12:30': { pid: 999999999, at: at('12:30').getTime() } },
    }, { now: at('12:31'), tz: config.timeZone })
    assert.equal(dueCollect(paths, config, at('12:31')).due, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a live running mark still blocks the same window', () => {
  const { home, paths, config } = setup()
  try {
    bumpState(paths, {
      windows: { '2026-11-01@12:30': { pid: process.pid, at: at('12:31').getTime() } },
    }, { now: at('12:31'), tz: config.timeZone })
    assert.equal(dueCollect(paths, config, at('12:31')).due, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('quota full blocks the collect', () => {
  const { home, paths, config } = setup({ perDay: 2 })
  try {
    writeFileSync(join(paths.outDir, '2026-11-01.md'), '### BV1aaaaaaaaa\n### BV1bbbbbbbbb\n', 'utf8')
    const r = dueCollect(paths, config, at('12:31'))
    assert.equal(r.due, false)
    assert.match(r.reason, /配额/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('peakValley=false disables auto collect', () => {
  const { home, paths, config } = setup({ peakValley: false })
  try {
    assert.equal(dueCollect(paths, config, at('12:31')).due, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('dry-run does not mark the window', async () => {
  const { home, paths, config } = setup()
  try {
    const r = await tick(paths, config, { now: at('12:31'), dryRun: true, log: () => {} })
    assert.equal(r.due, true)
    assert.equal(r.dryRun, true)
    assert.equal(readState(paths).windows?.['2026-11-01@12:30'], undefined)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('an active run-lock blocks dueCollect', () => {
  const { home, paths, config } = setup()
  try {
    writeFileSync(paths.runLock, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8')
    const r = dueCollect(paths, config, at('12:31'))
    assert.equal(r.due, false)
    assert.match(r.reason, /上一轮/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('failed round rolls back the window and retries after 2 minutes', async () => {
  const { home, paths, config } = setup()
  try {
    const r = await tick(paths, config, {
      now: at('12:31'),
      log: () => {},
      runRoundFn: async () => ({ ok: false, error: 'boom' }),
    })
    assert.equal(r.failed, true)
    const st = readState(paths)
    assert.equal(st.windows?.['2026-11-01@12:30'], undefined)
    assert.ok(st.failures?.['2026-11-01@12:30'])
    assert.equal(dueCollect(paths, config, at('12:32')).due, false)
    assert.equal(dueCollect(paths, config, at('12:34')).due, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('cross-midnight catch-up skips a previous window that already succeeded', () => {
  const { home, paths, config } = setup({ collectTimes: ['23:30'], perDay: 2 })
  try {
    bumpState(paths, { windows: { '2026-11-01@23:30': true } }, {
      now: new Date('2026-11-01T23:31:00+08:00'),
      tz: config.timeZone,
    })
    const r = dueCollect(paths, config, new Date('2026-11-02T00:05:00+08:00'))
    assert.equal(r.due, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('cross-midnight catch-up runs an unmarked previous window once', async () => {
  const { home, paths, config } = setup({ collectTimes: ['23:30'], perDay: 2 })
  try {
    const now = new Date('2026-11-02T00:05:00+08:00')
    const due = dueCollect(paths, config, now)
    assert.equal(due.due, true)
    assert.equal(due.key, '2026-11-01@23:30')
    assert.equal(due.windowDay, '2026-11-01')
    const r = await tick(paths, config, { now, log: () => {}, runRoundFn: async () => ({ ok: true }) })
    assert.equal(r.ran, true)
    assert.equal(readState(paths).windows?.['2026-11-01@23:30'], true)
    assert.equal(dueCollect(paths, config, new Date('2026-11-02T00:06:00+08:00')).due, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('cross-midnight catch-up retries a failed previous window after 2 minutes', () => {
  const { home, paths, config } = setup({ collectTimes: ['23:30'], perDay: 2 })
  try {
    const failedAt = new Date('2026-11-02T00:04:00+08:00')
    bumpState(paths, { failures: { '2026-11-01@23:30': { at: failedAt.getTime(), retries: 1 } } }, {
      now: failedAt,
      tz: config.timeZone,
    })
    assert.equal(dueCollect(paths, config, new Date('2026-11-02T00:05:00+08:00')).due, false)
    assert.equal(dueCollect(paths, config, new Date('2026-11-02T00:07:00+08:00')).due, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
