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

/**
 * ⚠️ ZCode 对「声明了 outputSchema 的 MCP 工具」要求返回 structuredContent；
 * 而 Python MCP 的工具返回纯文本 ⇒ 在代理层去掉 outputSchema，
 * 同时在结果里补 structuredContent（对象时），否则真实值班轮会被协议错误挡住。
 */
function sanitizePythonTool(tool) {
  if (!tool || typeof tool !== 'object') return tool
  const { outputSchema, output_schema, ...rest } = tool
  return rest
}

let pythonTools = []
let pythonError = ''
let pythonLoading = null

/** 启动失败后下一次 tools/list 或未知工具调用会重新试，而不是把整个会话锁死 */
async function refreshPythonTools() {
  if (pythonLoading) return pythonLoading
  pythonLoading = (async () => {
    try {
      pythonTools = (await py.listTools()).map(sanitizePythonTool)
      pythonError = ''
      log.info(`Python MCP 工具 ${pythonTools.length} 个`)
    } catch (error) {
      pythonTools = []
      pythonError = String(error?.message ?? error)
      log.error(`Python MCP 起不来：${pythonError}`)
    } finally {
      pythonLoading = null
    }
    return pythonTools
  })()
  return pythonLoading
}

await refreshPythonTools()

const localTools = [
  {
    name: 'bili_status',
    description: '看刷B站当前状态：登录、配额、provider、下次窗口。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  ...adminToolSpecs,
]
const toolList = () => [...pythonTools, ...localTools]

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    isError,
  }
}

async function callTool(name, args = {}) {
  const config = loadConfig(paths)
  if (name === 'bili_status') {
    return textResult({
      ...buildStatus(paths, config),
      ...(pythonError ? { pythonMcpError: pythonError } : {}),
    })
  }
  if (name === 'bili_run' || name.startsWith('admin_')) {
    try {
      return textResult(await handleAdminTool(name, args, { paths, config, log }))
    } catch (error) {
      return textResult({ ok: false, error: String(error?.message ?? error) }, true)
    }
  }
  let known = pythonTools.find((tool) => tool.name === name)
  if (!known && (!pythonTools.length || pythonError)) {
    await refreshPythonTools()
    known = pythonTools.find((tool) => tool.name === name)
  }
  if (!known) {
    return textResult({
      ok: false,
      error: pythonError ? `Python MCP 不可用：${pythonError}` : `不认识的工具：${name}`,
    }, true)
  }
  try {
    const { json, images } = await py.callRaw(name, args, { timeoutMs: 180000 })
    const content = [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }]
    for (const image of images) {
      content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
    }
    const result = { content, isError: false }
    if (json && typeof json === 'object' && !Array.isArray(json)) result.structuredContent = json
    return result
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
    // 不要 process.exit(0)：stdout 还可能有最后一条响应没刷完；让事件循环自己排空
    process.exitCode = 0
    const t = setTimeout(() => process.exit(0), 50)
    t.unref?.()
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
      if (!pythonTools.length) await refreshPythonTools()
      send({ jsonrpc: '2.0', id, result: { tools: toolList() } })
      return
    }
    if (method === 'tools/call') {
      try {
        const result = await callTool(params?.name, params?.arguments || {})
        send({ jsonrpc: '2.0', id, result })
      } catch (error) {
        // 严格读配置后会抛错；必须回一条错误结果，不能让 MCP 请求悬空
        send({ jsonrpc: '2.0', id, result: textResult({ ok: false, error: String(error?.message ?? error) }, true) })
      }
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
