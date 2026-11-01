import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaths } from '../src/paths.mjs'
import { loadConfig, saveConfig } from '../src/config.mjs'
import { readPluginOptions } from '../src/plugin-options.mjs'

function sandbox(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bili-duty-plugin-'))
  const pluginRoot = join(root, 'zcode')
  const homeDir = join(root, 'home')
  const dataDir = join(root, 'data')
  mkdirSync(join(pluginRoot, '.zcode-plugin'), { recursive: true })
  mkdirSync(join(homeDir, '.zcode', 'cli'), { recursive: true })
  writeFileSync(join(pluginRoot, '.zcode-plugin', 'plugin.json'), JSON.stringify({ name: 'bili-duty' }))
  writeFileSync(join(homeDir, '.zcode', 'cli', 'config.json'), JSON.stringify({
    plugins: { options: { 'bili-duty@inline': options } },
  }))
  return {
    root, pluginRoot, homeDir, dataDir,
    env: { HOME: homeDir },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('explicit ZCode plugin options are read for the matching plugin id', () => {
  const s = sandbox({ perDay: 2, peakValley: true })
  try {
    assert.deepEqual(readPluginOptions(s.pluginRoot, { env: s.env }), { perDay: 2, peakValley: true })
    assert.deepEqual(readPluginOptions(join(s.root, 'missing'), { env: s.env }), {})
  } finally { s.cleanup() }
})

test('plugin dataDir feeds daemon/hook paths without overriding runner env', () => {
  const s = sandbox({ dataDir: '/tmp/bili-duty-data' })
  try {
    const paths = createPaths({ pluginRoot: s.pluginRoot, env: s.env })
    assert.equal(paths.home, '/tmp/bili-duty-data')
    const runner = createPaths({ pluginRoot: s.pluginRoot, env: { ...s.env, BILI_DUTY_HOME: '/tmp/runner' } })
    assert.equal(runner.home, '/tmp/runner')
  } finally { s.cleanup() }
})

test('explicit plugin options win over config.json for daemon and hook', () => {
  const s = sandbox({ perDay: 2, peakValley: true, keywordsText: 'a\nb', autoComment: true })
  try {
    const paths = createPaths({ home: s.dataDir, pluginRoot: s.pluginRoot, env: s.env })
    saveConfig(paths, { perDay: 7, keywords: ['saved'] })
    const cfg = loadConfig(paths, s.env)
    assert.equal(cfg.perDay, 2)
    assert.equal(cfg.peakValley, true)
    assert.equal(cfg.autoComment, true)
    assert.deepEqual(cfg.keywords, ['a', 'b'])
  } finally { s.cleanup() }
})
