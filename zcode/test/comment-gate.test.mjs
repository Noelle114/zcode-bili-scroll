import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { DEFAULTS, normalize } from '../src/config.mjs'
import { commentQuota, releaseCommentSlot, styleBlocked } from '../src/comment-gate.mjs'

function setup(patch = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-comment-'))
  const paths = createPaths({ home })
  ensureHome(paths)
  const config = normalize({
    ...DEFAULTS,
    commentPerRound: 2,
    replyPerRound: 1,
    timeZone: 'Asia/Shanghai',
    ...patch,
  }, paths)
  return { home, paths, config }
}

test('new comments are capped per run', () => {
  const { home, paths, config } = setup()
  try {
    assert.equal(commentQuota(paths, config, { runId: 'r1' }).allow, true)
    assert.equal(commentQuota(paths, config, { runId: 'r1' }).allow, true)
    const third = commentQuota(paths, config, { runId: 'r1' })
    assert.equal(third.allow, false)
    assert.match(third.reason, /2\/2/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('replies have their own per-run cap', () => {
  const { home, paths, config } = setup()
  try {
    assert.equal(commentQuota(paths, config, { runId: 'r1', isReply: true }).allow, true)
    const second = commentQuota(paths, config, { runId: 'r1', isReply: true })
    assert.equal(second.allow, false)
    assert.match(second.reason, /1\/1/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a new run and a new day reset the counter', () => {
  const { home, paths, config } = setup({ commentPerRound: 1 })
  try {
    assert.equal(commentQuota(paths, config, { runId: 'r1', now: new Date('2026-11-01T12:00:00+08:00') }).allow, true)
    assert.equal(commentQuota(paths, config, { runId: 'r1', now: new Date('2026-11-01T12:01:00+08:00') }).allow, false)
    assert.equal(commentQuota(paths, config, { runId: 'r2', now: new Date('2026-11-01T12:02:00+08:00') }).allow, true)
    assert.equal(commentQuota(paths, config, { runId: 'r2', now: new Date('2026-11-02T12:02:00+08:00') }).allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('zero limit denies', () => {
  const { home, paths, config } = setup({ commentPerRound: 0 })
  try {
    assert.equal(commentQuota(paths, config, { runId: 'r1' }).allow, false)
    assert.equal(commentQuota(paths, { ...config, replyPerRound: 0 }, { runId: 'r1', isReply: true }).allow, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a style-blocked attempt can release its slot', () => {
  const { home, paths, config } = setup({ commentPerRound: 1 })
  try {
    assert.equal(commentQuota(paths, config, { runId: 'r1' }).allow, true)
    assert.equal(commentQuota(paths, config, { runId: 'r1' }).allow, false)
    assert.equal(releaseCommentSlot(paths, { runId: 'r1', timeZone: config.timeZone }), true)
    assert.equal(commentQuota(paths, config, { runId: 'r1' }).allow, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('styleBlocked recognizes the normal MCP text result', () => {
  assert.equal(styleBlocked({ content: [{ type: 'text', text: '{"ok":false,"blocked_by":"style","error":"x"}' }] }), true)
  assert.equal(styleBlocked('{"ok":false,"blocked_by":"style"}'), true)
  assert.equal(styleBlocked({ content: [{ type: 'text', text: '{"ok":true,"rpid":123}' }] }), false)
  assert.equal(styleBlocked({ content: [{ type: 'text', text: 'not json' }] }), false)
})
