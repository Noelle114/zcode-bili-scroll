import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { DEFAULTS, normalize } from '../src/config.mjs'
import { buildPrompt } from '../src/prompt.mjs'

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-prompt-'))
  const paths = createPaths({ home })
  ensureHome(paths)
  return { home, paths }
}

const configOf = (paths, patch = {}) => normalize({ ...DEFAULTS, dmMode: 'off', ...patch }, paths)

test('injects persona text into the prompt', () => {
  const { home, paths } = setup()
  try {
    const text = buildPrompt(paths, configOf(paths, { personaPrompt: '叫我阿鱼，说话短一点。' }), { why: 'schedule' })
    assert.match(text, /使用者的人设/)
    assert.match(text, /叫我阿鱼/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('reads persona from a file path', () => {
  const { home, paths } = setup()
  try {
    const file = join(home, 'persona.md')
    writeFileSync(file, '叫我阿鱼，别用 emoji。', 'utf8')
    const text = buildPrompt(paths, configOf(paths, { personaPrompt: file }), { why: 'schedule' })
    assert.match(text, /读自/)
    assert.match(text, /别用 emoji/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('falls back to workspace/AGENTS.md', () => {
  const { home, paths } = setup()
  try {
    writeFileSync(join(paths.workspace, 'AGENTS.md'), '叫我阿鱼，先说结论。', 'utf8')
    const text = buildPrompt(paths, configOf(paths), { why: 'schedule' })
    assert.match(text, /AGENTS\.md/)
    assert.match(text, /先说结论/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('substitutes {owner} with mentionName or 你', () => {
  const { home, paths } = setup()
  try {
    const named = buildPrompt(paths, configOf(paths, {
      personaPrompt: '把结果发给 {owner}。',
      mentionName: '阿鱼',
    }), { why: 'schedule' })
    assert.match(named, /发给 阿鱼/)
    const unnamed = buildPrompt(paths, configOf(paths, { personaPrompt: '把结果发给 {owner}。' }), { why: 'schedule' })
    assert.match(unnamed, /发给\s*你/)
    assert.doesNotMatch(unnamed, /发给主人/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('prompt mentions transcribe and comment settings', () => {
  const { home, paths } = setup()
  try {
    const text = buildPrompt(paths, configOf(paths, {
      transcribe: true,
      autoComment: true,
      mentionName: '阿鱼',
      commentLength: 'short',
      replyToComments: true,
      replyPerRound: 2,
      commentPerRound: 2,
    }), { why: 'schedule' })
    assert.match(text, /本地转写/)
    assert.match(text, /短（≤15 字）/)
    assert.match(text, /回复评论：开着/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('manual round is not capped by remaining auto quota', () => {
  const { home, paths } = setup()
  try {
    const text = buildPrompt(paths, configOf(paths, { perDay: 0, maxPerRound: 1, dmUid: 123 }), { why: 'manual' })
    assert.match(text, /手动触发：这一轮目标 1 条、最多挑 1 条/)
    assert.doesNotMatch(text, /这一轮最多再挑 0 条/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('prompt asks for a summary plus per-video DMs with a pilot target', () => {
  const { home, paths } = setup()
  try {
    const text = buildPrompt(paths, configOf(paths, {
      dmMode: 'only',
      dmUid: 123,
      perDay: 20,
      maxPerRound: 5,
      roundTarget: 3,
      dmBatchMax: 5,
    }), { why: 'schedule' })
    assert.match(text, /这一轮目标 3 条、最多再挑 5 条/)
    assert.match(text, /先发 1 条总结/)
    assert.match(text, /最多 5 条视频消息/)
    assert.match(text, /不要贴 BV 号或链接/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('reportLevel=off removes the report path instruction', () => {
  const { home, paths } = setup()
  try {
    const text = buildPrompt(paths, configOf(paths, { reportLevel: 'off', dmUid: 123 }), { why: 'schedule' })
    assert.match(text, /不写日报文件/)
    assert.doesNotMatch(text, /日报：.*每挑中一条/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('ZCode host prompt tells the model how to record comment rpid', () => {
  const { home, paths } = setup()
  try {
    const text = buildPrompt(paths, configOf(paths, { dmUid: 123, dmMode: 'off', autoComment: true, mentionName: 'me' }), { why: 'schedule' })
    assert.match(text, /duty_comment_append\(bvid, rpid, root, text\)/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
