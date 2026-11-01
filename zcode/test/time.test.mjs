import test from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, inWindow, seenDay, WINDOWS } from '../src/time.mjs'

test('dayKey follows BILI_DUTY_TZ, not server local time', () => {
  const d = new Date('2026-10-31T16:30:00Z') // 2026-11-01 00:30 +08
  assert.equal(dayKey(d, 'Asia/Shanghai'), '2026-11-01')
  assert.equal(dayKey(d, 'UTC'), '2026-10-31')
})

test('night window spans midnight in Asia/Shanghai', () => {
  const d = new Date('2026-11-01T16:30:00Z') // 2026-11-02 00:30 +08
  assert.equal(inWindow(d, WINDOWS.night, 'Asia/Shanghai'), true)
  assert.equal(inWindow(d, WINDOWS.noon, 'Asia/Shanghai'), false)
})

test('weekend is all valley', () => {
  const d = new Date('2026-11-01T04:00:00Z') // 2026-11-01 12:00 +08, Sunday
  assert.equal(inWindow(d, WINDOWS.noon, 'Asia/Shanghai'), true)
})

test('seenDay tolerates short dates and timestamps', () => {
  const now = new Date('2026-11-01T04:00:00Z')
  assert.equal(seenDay('10-23', now, 'Asia/Shanghai'), '2026-10-23')
  assert.equal(seenDay('2026-10-22 18:51', now, 'Asia/Shanghai'), '2026-10-22')
  assert.equal(seenDay('2026/10/21', now, 'Asia/Shanghai'), '2026-10-21')
  assert.equal(seenDay('not-a-date', now, 'Asia/Shanghai'), null)
})
