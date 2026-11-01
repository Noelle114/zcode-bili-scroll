import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCredentials, isAuthError, isQuotaError } from '../src/credentials.mjs'

test('isAuthError catches real 1113/auth errors', () => {
  assert.equal(isAuthError('1113 Insufficient balance or no resource package'), true)
  assert.equal(isAuthError('HTTP 401 Unauthorized'), true)
  assert.equal(isAuthError('{"code":401,"message":"bad token"}'), true)
})

test('isAuthError does not match bare 401 inside UUID/event ids', () => {
  const line = '{"eventId":"ae30581b-8d7a-4f53-8c8d-a9445ca0a14e","payload":{"delta":"ok"}}'
  assert.equal(isAuthError(line), false)
})

test('isAuthError does not match 1113 in stream seq / event ids', () => {
  assert.equal(isAuthError('{"seq":1113,"payload":{"delta":"ok"}}'), false)
  assert.equal(isAuthError('{"eventId":"40685790-1113-44e3-834d-faccefbdd7b5"}'), false)
  assert.equal(isAuthError('{"seq":1949,"payload":{"delta":"1113"}}'), false)
})

test('isAuthError still catches structured 1113', () => {
  assert.equal(isAuthError('{"code":1113,"message":"Insufficient balance"}'), true)
  assert.equal(isAuthError('{"error":{"code":1113,"message":"no resource package"}}'), true)
})

test('isQuotaError is also conservative', () => {
  assert.equal(isQuotaError('rate limit exceeded'), true)
  assert.equal(isQuotaError('{"status":429}'), true)
  assert.equal(isQuotaError('event 4291f0c2-aaaa'), false)
})

test('checkCredentials rejects non-JSON, empty, and directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bili-duty-cred-'))
  try {
    const good = join(dir, 'good.json')
    writeFileSync(good, '{"token":"x"}', 'utf8')
    assert.equal(checkCredentials(good).ok, true)

    const bad = join(dir, 'bad.json')
    writeFileSync(bad, 'not json', 'utf8')
    assert.equal(checkCredentials(bad).ok, false)
    assert.equal(checkCredentials(bad).reason, 'not-json')

    const empty = join(dir, 'empty.json')
    writeFileSync(empty, '', 'utf8')
    assert.equal(checkCredentials(empty).ok, false)
    assert.equal(checkCredentials(empty).reason, 'empty')

    assert.equal(checkCredentials(dir).ok, false)
    assert.equal(checkCredentials(dir).reason, 'not-a-file')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('checkCredentials rejects expired JWTs without exposing the token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bili-duty-cred-jwt-'))
  const jwt = (exp) => {
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
    return `header.${payload}.signature`
  }
  try {
    const expired = join(dir, 'expired.json')
    writeFileSync(expired, JSON.stringify({ zcodejwttoken: jwt(Math.floor(Date.now() / 1000) - 60) }), 'utf8')
    const expiredResult = checkCredentials(expired)
    assert.equal(expiredResult.ok, false)
    assert.equal(expiredResult.reason, 'expired')
    assert.equal(JSON.stringify(expiredResult).includes('signature'), false)

    const valid = join(dir, 'valid.json')
    writeFileSync(valid, JSON.stringify({ zcodejwttoken: jwt(Math.floor(Date.now() / 1000) + 3600) }), 'utf8')
    assert.equal(checkCredentials(valid).ok, true)

    const nestedExpired = join(dir, 'nested-expired.json')
    writeFileSync(nestedExpired, JSON.stringify({
      'oauth:bigmodel:user_info': JSON.stringify({ expiresAt: Date.now() - 60_000 }),
    }), 'utf8')
    assert.equal(checkCredentials(nestedExpired).ok, false)
    assert.equal(checkCredentials(nestedExpired).reason, 'expired')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
