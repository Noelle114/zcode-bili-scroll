import test from 'node:test'
import assert from 'node:assert/strict'
import { isAuthError, isQuotaError } from '../src/credentials.mjs'

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
