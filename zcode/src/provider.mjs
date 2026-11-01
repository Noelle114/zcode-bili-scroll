import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from './util.mjs'

export function listProviderFiles(paths) {
  try {
    return readdirSync(paths.providersDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(paths.providersDir, name))
  } catch {
    return []
  }
}

/**
 * 实测（2026-11-01）：defaultModelSelection 会被忽略，
 * 实际 provider 由 providerOrder 第一位决定。
 */
export function validateProvider(cfg) {
  const errors = []
  const warnings = []
  // ZCode 个人模型配置文件是 { schemaVersion, config: { providerOrder, providerConfigRules } }；
  // 也兼容直接给 config 本体的写法。
  const root = (cfg && typeof cfg === 'object' && cfg.config && typeof cfg.config === 'object'
    && (cfg.config.providerOrder || cfg.config.providerConfigRules))
    ? cfg.config
    : cfg
  const order = Array.isArray(root?.providerOrder) ? root.providerOrder.map(String) : []
  if (!order.length) errors.push('providerOrder 为空')
  const providerId = order[0] || ''
  const rules = root?.providerConfigRules?.providerRules
  const rule = (Array.isArray(rules) ? rules : []).find((r) => String(r?.providerId) === providerId)
  if (!rule) errors.push(`providerOrder 第一位的 "${providerId}" 在 providerRules 里找不到`)

  const conf = rule?.config || {}
  const apiType = String(conf?.api?.type || '')
  const models = Array.isArray(conf?.personalModelIds) ? conf.personalModelIds.map(String) : []
  const modelOrder = Array.isArray(conf?.modelOrder) ? conf.modelOrder.map(String) : []
  const modelId = modelOrder[0] || models[0] || ''

  if (!modelId) warnings.push('personalModelIds / modelOrder 为空')
  if (apiType !== 'openai-chat-completions') {
    warnings.push('api.type 不是 openai-chat-completions：GLM 视觉可能不可用（实测 anthropic-messages 不传图片像素）')
  }
  if (!conf?.access?.type) warnings.push('access.type 缺失')

  return {
    ok: errors.length === 0,
    providerId,
    modelId,
    apiType,
    models,
    warnings,
    errors,
  }
}

export function loadProvider(file) {
  const cfg = readJson(file, null)
  if (!cfg || typeof cfg !== 'object') {
    return { ok: false, file, providerId: '', modelId: '', apiType: '', models: [], warnings: [], errors: ['文件不存在或不是合法 JSON'] }
  }
  return { file, ...validateProvider(cfg) }
}
