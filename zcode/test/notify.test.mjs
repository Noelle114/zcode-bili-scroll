import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths } from '../src/paths.mjs'
import { DEFAULTS, normalize } from '../src/config.mjs'
import { dayKey } from '../src/time.mjs'
import { parseQuietHours, inQuietHours, shouldAllowDm, beginDmSend } from '../src/notify.mjs'

const NOW = new Date('2026-11-01T12:00:00+08:00')
const NEW_BV = 'BV1aaaaaaaaa'
const OLD_BV = 'BV1bbbbbbbbb'

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-notify-'))
  const paths = createPaths({ home })
  const config = normalize({
    ...DEFAULTS,
    dmMode: 'only',
    dmUid: 123456,
    notifyEveryHours: 4,
    notifyMaxPerDay: 4,
    notifyOnlyWhenNew: true,
    quietHours: '23:00-08:00',
    timeZone: 'Asia/Shanghai',
  }, paths)
  return { home, paths, config }
}

function writeDeliveries(paths, entries, mtime) {
  writeFileSync(paths.dmDeliveries, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  if (mtime) utimesSync(paths.dmDeliveries, mtime, mtime)
}

test('parseQuietHours handles cross-midnight windows', () => {
  const q = parseQuietHours('23:00-08:00')
  assert.deepEqual(q, { start: 23 * 60, end: 8 * 60 })
  assert.equal(inQuietHours(23 * 60 + 30, q), true)
  assert.equal(inQuietHours(7 * 60 + 59, q), true)
  assert.equal(inQuietHours(8 * 60, q), false)
  assert.equal(inQuietHours(12 * 60, q), false)
})

test('allows a new BV in an empty notification ledger', () => {
  const { home, paths, config } = setup()
  try {
    const r = shouldAllowDm(paths, config, { now: NOW, text: `https://www.bilibili.com/video/${NEW_BV}` })
    assert.equal(r.allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('denies a BV that was already delivered', () => {
  const { home, paths, config } = setup()
  try {
    writeDeliveries(paths, [{ day: dayKey(NOW, config.timeZone), bvids: [OLD_BV] }], new Date(NOW.getTime() - 5 * 3600_000))
    const r = shouldAllowDm(paths, config, { now: NOW, text: `https://www.bilibili.com/video/${OLD_BV}` })
    assert.equal(r.allow, false)
    assert.match(r.reason, /已经通知过/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('denies inside quiet hours', () => {
  const { home, paths, config } = setup()
  try {
    const night = new Date('2026-11-01T23:30:00+08:00')
    const r = shouldAllowDm(paths, config, { now: night, text: NEW_BV })
    assert.equal(r.allow, false)
    assert.match(r.reason, /静默时段/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('denies within the 4h notification window', () => {
  const { home, paths, config } = setup()
  try {
    writeDeliveries(paths, [{ day: dayKey(NOW, config.timeZone), bvids: [OLD_BV] }], new Date(NOW.getTime() - 3600_000))
    const r = shouldAllowDm(paths, config, { now: NOW, text: NEW_BV })
    assert.equal(r.allow, false)
    assert.match(r.reason, /未到 4 小时窗口/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('allows after the 4h window', () => {
  const { home, paths, config } = setup()
  try {
    writeDeliveries(paths, [{ day: dayKey(NOW, config.timeZone), bvids: [OLD_BV] }], new Date(NOW.getTime() - 5 * 3600_000))
    const r = shouldAllowDm(paths, config, { now: NOW, text: NEW_BV })
    assert.equal(r.allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('denies after the daily notification cap', () => {
  const { home, paths, config } = setup()
  try {
    const day = dayKey(NOW, config.timeZone)
    writeDeliveries(paths, Array.from({ length: 4 }, (_, i) => ({ day, bvids: [`BV1old00000${i}`] })), new Date(NOW.getTime() - 5 * 3600_000))
    const r = shouldAllowDm(paths, config, { now: NOW, text: NEW_BV })
    assert.equal(r.allow, false)
    assert.match(r.reason, /上限 4/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('notifyOnlyWhenNew denies a message without a BV', () => {
  const { home, paths, config } = setup()
  try {
    const r = shouldAllowDm(paths, config, { now: NOW, text: '今天没什么新的' })
    assert.equal(r.allow, false)
    assert.match(r.reason, /没有 BV/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('dmMode=off is never allowed to send', () => {
  const { home, paths, config } = setup()
  try {
    const r = shouldAllowDm(paths, { ...config, dmMode: 'off' }, { now: NOW, text: 'reply' })
    assert.equal(r.allow, false)
    assert.match(r.reason, /dmMode=off/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('rejects a receiver other than dmUid', () => {
  const { home, paths, config } = setup()
  try {
    const r = shouldAllowDm(paths, config, { now: NOW, text: NEW_BV, receiverUid: 999 })
    assert.equal(r.allow, false)
    assert.match(r.reason, /收件人/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('allows a 4h-spaced round with the 5-minute grace', () => {
  const { home, paths, config } = setup()
  try {
    writeDeliveries(paths, [{ day: dayKey(NOW, config.timeZone), bvids: [OLD_BV] }], new Date(NOW.getTime() - (3 * 3600_000 + 56 * 60_000)))
    const r = shouldAllowDm(paths, config, { now: NOW, text: NEW_BV })
    assert.equal(r.allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('beginDmSend serializes concurrent sends', () => {
  const { home, paths } = setup()
  try {
    assert.equal(beginDmSend(paths, { now: NOW.getTime() }).allow, true)
    assert.equal(beginDmSend(paths, { now: NOW.getTime() + 1000 }).allow, false)
    assert.equal(beginDmSend(paths, { now: NOW.getTime() + 16_000 }).allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('daily cap counts a batch once, not once per message', () => {
  const { home, paths, config } = setup()
  try {
    const day = dayKey(NOW, config.timeZone)
    writeDeliveries(paths, [
      { day, batch: 'run-x', bvids: [NEW_BV] },
      { day, batch: 'run-x', bvids: [] },
      { day, batch: 'run-x', bvids: [] },
      { day, batch: 'run-x', bvids: [] },
    ], new Date(NOW.getTime() - 5 * 3600_000))
    const r = shouldAllowDm(paths, config, { now: NOW, text: 'BV1ddddddddd' })
    assert.equal(r.allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a continued batch skips the 4h window', () => {
  const { home, paths, config } = setup()
  try {
    writeDeliveries(paths, [{ day: dayKey(NOW, config.timeZone), batch: 'run-x', bvids: [OLD_BV] }], new Date(NOW.getTime() - 3600_000))
    const r = shouldAllowDm(paths, config, { now: NOW, text: `https://www.bilibili.com/video/${NEW_BV}`, continued: true })
    assert.equal(r.allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a continued batch still rejects an already delivered BV', () => {
  const { home, paths, config } = setup()
  try {
    writeDeliveries(paths, [{ day: dayKey(NOW, config.timeZone), batch: 'run-x', bvids: [OLD_BV] }], new Date(NOW.getTime() - 3600_000))
    const r = shouldAllowDm(paths, config, { now: NOW, text: OLD_BV, continued: true })
    assert.equal(r.allow, false)
    assert.match(r.reason, /已经通知过/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a batch summary without a BV is allowed', () => {
  const { home, paths, config } = setup()
  try {
    const r = shouldAllowDm(paths, config, { now: NOW, text: '这一轮挑了 3 条，都是 AI 相关。', allowNoBv: true })
    assert.equal(r.allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
