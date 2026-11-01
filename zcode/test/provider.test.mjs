import test from 'node:test'
import assert from 'node:assert/strict'
import { validateProvider } from '../src/provider.mjs'

test('providerOrder first entry wins and validates OpenAI endpoint', () => {
  const cfg = {
    providerOrder: ['bigmodel-flash-openai'],
    providerConfigRules: {
      providerRules: [{
        providerId: 'bigmodel-flash-openai',
        config: {
          personalModelIds: ['GLM-5.3-Flash'],
          modelOrder: ['GLM-5.3-Flash'],
          access: { type: 'api-key' },
          api: { type: 'openai-chat-completions' },
        },
      }],
    },
  }
  const v = validateProvider(cfg)
  assert.equal(v.ok, true)
  assert.equal(v.providerId, 'bigmodel-flash-openai')
  assert.equal(v.modelId, 'GLM-5.3-Flash')
  assert.equal(v.apiType, 'openai-chat-completions')
  assert.equal(v.warnings.length, 0)
})

test('anthropic-messages warns that vision may not work', () => {
  const cfg = {
    providerOrder: ['bigmodel-api'],
    providerConfigRules: {
      providerRules: [{
        providerId: 'bigmodel-api',
        config: {
          personalModelIds: ['GLM-5.3'],
          access: { type: 'api-key' },
          api: { type: 'anthropic-messages' },
        },
      }],
    },
  }
  const v = validateProvider(cfg)
  assert.equal(v.ok, true)
  assert.ok(v.warnings.some((w) => w.includes('openai-chat-completions')))
})

test('missing providerOrder is an error', () => {
  const v = validateProvider({ providerConfigRules: { providerRules: [] } })
  assert.equal(v.ok, false)
  assert.ok(v.errors.length > 0)
})
