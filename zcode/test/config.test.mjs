import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { loadConfig, saveConfig, setConfigValue } from '../src/config.mjs'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'bili-duty-test-'))
  const paths = createPaths({ home, pluginRoot })
  ensureHome(paths)
  return { home, paths, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('env values apply when config.json is absent', () => {
  const { paths, cleanup } = sandbox()
  try {
    const cfg = loadConfig(paths, {
      BILI_DUTY_USER_PER_DAY: '7',
      BILI_DUTY_USER_KEYWORDS_TEXT: 'a\nb',
    })
    assert.equal(cfg.perDay, 7)
    assert.deepEqual(cfg.keywords, ['a', 'b'])
    assert.equal(cfg.dmMode, 'only')
  } finally { cleanup() }
})

test('config.json wins over env and is clamped', () => {
  const { paths, cleanup } = sandbox()
  try {
    saveConfig(paths, { perDay: 99, keywords: ['saved'] })
    const cfg = loadConfig(paths, {
      BILI_DUTY_USER_PER_DAY: '7',
      BILI_DUTY_USER_KEYWORDS_TEXT: 'env',
    })
    assert.equal(cfg.perDay, 50)
    assert.deepEqual(cfg.keywords, ['saved'])
  } finally { cleanup() }
})

test('setConfigValue parses booleans/numbers/arrays', () => {
  const { paths, cleanup } = sandbox()
  try {
    assert.equal(setConfigValue(paths, 'peakValley', 'true').peakValley, true)
    assert.equal(setConfigValue(paths, 'perDay', '3').perDay, 3)
    assert.deepEqual(setConfigValue(paths, 'collectTimes', '09:00,21:00').collectTimes, ['09:00', '21:00'])
    assert.throws(() => setConfigValue(paths, 'nope', '1'))
  } finally { cleanup() }
})

test('provider/credentials defaults point at the data dir and ~/.zcode', () => {
  const { paths, cleanup } = sandbox()
  try {
    const cfg = loadConfig(paths, {})
    assert.equal(cfg.providerConfigFile, paths.defaultProviderFile)
    assert.equal(cfg.credentialsFile, paths.defaultCredentialsFile)
  } finally { cleanup() }
})
