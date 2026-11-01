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
