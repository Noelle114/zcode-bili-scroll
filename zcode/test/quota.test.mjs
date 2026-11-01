import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countPicks, countPicksInText } from '../src/quota.mjs'

test('counts only ###/## BV headings, excluding code fences', () => {
  const text = [
    '# 刷B站日报',
    '## BV1234567890',
    '正文',
    '```',
    '### BV1111111111',
    '```',
    '#### BV2222222222', // 4 个 # 不算（章程只认 2–3）
    '### BV0987654321',
    '## BV1234567890', // duplicate
  ].join('\n')
  assert.equal(countPicksInText(text), 2)
})

test('countPicks reads a file and returns 0 on missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bili-duty-quota-'))
  try {
    const file = join(dir, '2026-11-01.md')
    writeFileSync(file, '### BV1234567890\n### BV0987654321\n')
    assert.equal(countPicks(file), 2)
    assert.equal(countPicks(join(dir, 'missing.md')), 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
