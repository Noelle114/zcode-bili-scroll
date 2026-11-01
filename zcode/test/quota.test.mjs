import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { DEFAULTS, normalize } from '../src/config.mjs'
import { countPicks, countPicksInText, countPickedToday } from '../src/quota.mjs'

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

test('falls back to seen.md when the report is off/absent', () => {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-quota-seen-'))
  try {
    const paths = createPaths({ home })
    ensureHome(paths)
    const config = normalize({ ...DEFAULTS, reportLevel: 'off', timeZone: 'Asia/Shanghai' }, paths)
    const now = new Date('2026-11-01T12:00:00+08:00')
    writeFileSync(paths.seen, [
      '| 日期 | BV | 标题 | UP | 状态 |',
      '| --- | --- | --- | --- | --- |',
      '| 2026-11-01 | BV1aaaaaaaaa | A | up | 挑了 |',
      '| 2026-11-01 | BV1bbbbbbbbb | B | up | 跳过 |',
      '| 2026-11-01 | BV1aaaaaaaaa | A | up | 挑了 |',
    ].join('\n'), 'utf8')
    assert.equal(countPickedToday(paths, config, now), 1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
