#!/usr/bin/env node
/**
 * ZCode 插件的 MCP 服务：对外暴露 B 站工具（Python MCP 代理）+ 管理工具。
 * 协议：initialize → notifications/initialized → tools/list / tools/call。
 */
import readline from 'node:readline'
import { createPaths, ensureHome } from '../src/paths.mjs'
import { loadConfig } from '../src/config.mjs'
import { createLogger } from '../src/log.mjs'
import { PythonMcp } from '../src/python-mcp.mjs'
import { buildStatus } from '../src/status.mjs'
import { adminToolSpecs, handleAdminTool } from '../src/tools/admin.mjs'

const paths = createPaths()
ensureHome(paths)
const log = createLogger(paths)
const py = new PythonMcp(paths, { log: (msg) => log.warn(msg) })

let pythonTools = []
let pythonError = ''
try {
  pythonTools = await py.listTools()
  log.info(`Python MCP 工具 ${pythonTools.length} 个`)
} catch (error) {
  pythonError = String(error?.message ?? error)
  log.error(`Python MCP 起不来：${pythonError}`)
}

const localTools = [
  {
    name: 'bili_status',
    description: '看刷B站当前状态：登录、配额、provider、下次窗口。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  ...adminToolSpecs,
]
const allTools = [...pythonTools, ...localTools]

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    isError,
  }
}

async function callTool(name, args = {}) {
  const config = loadConfig(paths)
  if (name === 'bili_status') return textResult(buildStatus(paths, config))
  if (name === 'bili_run' || name.startsWith('admin_')) {
    try {
      return textResult(await handleAdminTool(name, args, { paths, config, log }))
    } catch (error) {
      return textResult({ ok: false, error: String(error?.message ?? error) }, true)
    }
  }
  const known = pythonTools.find((tool) => tool.name === name)
  if (!known) return textResult({ ok: false, error: `不认识的工具：${name}` }, true)
  try {
    const { json, images } = await py.callRaw(name, args, { timeoutMs: 180000 })
    const content = [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }]
    for (const image of images) {
      content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
    }
    return { content, isError: false }
  } catch (error) {
    return textResult({ ok: false, tool: name, error: String(error?.message ?? error) }, true)
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

let pending = 0
let closing = false
const maybeExit = () => {
  if (closing && pending === 0) {
    py.stop()
    process.exit(0)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async (line) => {
  pending += 1
  try {
    let message
    try { message = JSON.parse(line) } catch { return }
    const { id, method, params } = message
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'bili-duty', version: '0.1.0' },
        },
      })
      return
    }
    if (method === 'notifications/initialized') return
    if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return }
    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: allTools } })
      return
    }
    if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments || {})
      send({ jsonrpc: '2.0', id, result })
      return
    }
    if (id !== undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  } finally {
    pending -= 1
    maybeExit()
  }
})
rl.on('close', () => { closing = true; maybeExit() })

process.on('SIGTERM', () => { py.stop(); process.exit(0) })
process.on('SIGINT', () => { py.stop(); process.exit(0) })
