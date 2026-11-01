import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { DEFAULTS, normalize } from '../src/config.mjs'
import {
  beginDmBatch, dmBatchDelayMs, dmBatchLimit, dmSendFailed, readDmBatch, recordDmSend, releaseDmSend,
} from '../src/dm-batch.mjs'

const NOW = new Date('2026-11-01T12:00:00+08:00')

function setup(patch = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-dm-batch-'))
  const paths = createPaths({ home })
  ensureHome(paths)
  const config = normalize({ ...DEFAULTS, dmBatchMax: 5, timeZone: 'Asia/Shanghai', ...patch }, paths)
  return { home, paths, config }
}

test('a batch gets a non-empty id even without a runner id', () => {
  const { home, paths, config } = setup()
  try {
    const state = beginDmBatch(paths, { runId: '', now: NOW, timeZone: config.timeZone })
    assert.match(state.batchId, /^batch-/)
    assert.equal(readDmBatch(paths, { now: NOW, timeZone: config.timeZone }).batchId, state.batchId)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a batch counts the summary then video messages up to the limit', () => {
  const { home, paths, config } = setup()
  try {
    assert.equal(dmBatchLimit(config), 6)
    beginDmBatch(paths, { runId: 'r1', now: NOW, timeZone: config.timeZone })
    assert.equal(readDmBatch(paths, { now: NOW, timeZone: config.timeZone }).sent, 1)
    recordDmSend(paths, { runId: 'r1', now: NOW, timeZone: config.timeZone })
    assert.equal(readDmBatch(paths, { now: NOW, timeZone: config.timeZone }).sent, 2)
    releaseDmSend(paths, { runId: 'r1', now: NOW, timeZone: config.timeZone })
    assert.equal(readDmBatch(paths, { now: NOW, timeZone: config.timeZone }).sent, 1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('releasing the last message removes the batch', () => {
  const { home, paths, config } = setup()
  try {
    beginDmBatch(paths, { runId: 'r1', now: NOW, timeZone: config.timeZone })
    releaseDmSend(paths, { runId: 'r1', now: NOW, timeZone: config.timeZone })
    assert.equal(readDmBatch(paths, { now: NOW, timeZone: config.timeZone }), null)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('the inter-message delay is enforced', () => {
  const { home, paths, config } = setup()
  try {
    const state = beginDmBatch(paths, { runId: 'r1', now: NOW, timeZone: config.timeZone })
    assert.equal(dmBatchDelayMs(state, new Date(NOW.getTime() + 1000)), 2000)
    assert.equal(dmBatchDelayMs(state, new Date(NOW.getTime() + 4000)), 0)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('an old batch expires', () => {
  const { home, paths, config } = setup()
  try {
    beginDmBatch(paths, { runId: 'r1', now: NOW, timeZone: config.timeZone })
    const later = new Date(NOW.getTime() + 61 * 60_000)
    assert.equal(readDmBatch(paths, { now: later, timeZone: config.timeZone }), null)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('dmSendFailed only matches success:false', () => {
  assert.equal(dmSendFailed({ content: [{ type: 'text', text: '{"success":false,"error":"x"}' }] }), true)
  assert.equal(dmSendFailed('{"success":true}'), false)
  assert.equal(dmSendFailed('not json'), false)
})
