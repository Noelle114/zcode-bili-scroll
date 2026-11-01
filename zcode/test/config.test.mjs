import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('maxPerRound clamps to 1..10', () => {
  const { paths, cleanup } = sandbox()
  try {
    assert.equal(loadConfig(paths, {}).maxPerRound, 1)
    assert.equal(loadConfig(paths, {}).roundTarget, 0)
    assert.equal(loadConfig(paths, {}).dmBatchMax, 5)
    assert.equal(setConfigValue(paths, 'maxPerRound', '5').maxPerRound, 5)
    assert.equal(setConfigValue(paths, 'roundTarget', '3').roundTarget, 3)
    assert.equal(setConfigValue(paths, 'dmBatchMax', '5').dmBatchMax, 5)
    assert.equal(setConfigValue(paths, 'maxPerRound', '0').maxPerRound, 1)
    assert.equal(setConfigValue(paths, 'maxPerRound', '99').maxPerRound, 10)
  } finally { cleanup() }
})

test('collectTimes does not silently drop entries after eight', () => {
  const { paths, cleanup } = sandbox()
  try {
    const times = ['08:30', '10:00', '12:30', '14:00', '16:00', '18:30', '20:00', '22:30', '23:00', '23:15', '23:30', '23:45']
    assert.equal(setConfigValue(paths, 'collectTimes', times.join(',')).collectTimes.length, times.length)
  } finally { cleanup() }
})

test('malformed config throws instead of silently using defaults', () => {
  const { paths, cleanup } = sandbox()
  try {
    writeFileSync(paths.config, '{bad json', 'utf8')
    assert.throws(() => loadConfig(paths), /解析/)
    assert.throws(() => saveConfig(paths, { perDay: 7 }), /解析/)
    assert.equal(readFileSync(paths.config, 'utf8'), '{bad json')
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
