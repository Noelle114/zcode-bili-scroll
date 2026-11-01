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
      commentLength: 'short',
      replyToComments: true,
      replyPerRound: 2,
      commentPerRound: 2,
    }), { why: 'schedule' })
    assert.match(text, /本地转写/)
    assert.match(text, /评论长度：短/)
    assert.match(text, /回复评论：开着/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
