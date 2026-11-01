import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from './mcp-client.mjs'
import { ensureHomeFiles } from './home-files.mjs'

/**
 * 值班轮能看到的 Python MCP 工具。
 * 名单外的工具在 Python 侧**根本不注册**（BILI_MCP_TOOLS 白名单），
 * 模型连名字都看不到；评论/私信再由 PreToolUse hook 做条件闸门。
 */
export const BILI_MCP_TOOLS = [
  'bili_search',
  'bili_subtitle',
  'bili_comments',
  'bili_video_info',
  'bili_danmaku',
  'bili_cover',
  'bili_frames',
  'bili_recommend',
  'duty_paths',
  'duty_report_append',
  'duty_seen_append',
  'duty_comment_append',
  'duty_seen_recent',
  'duty_digest_append',
  'bili_transcribe',
  'bili_transcribe_start',
  'bili_transcribe_result',
  'bili_reply',
  'bili_send_message',
].join(',')

export class PythonMcp {
  constructor(paths, { log = () => {} } = {}) {
    this.paths = paths
    this.log = log
    this.client = null
    this.key = ''
  }

  command() {
    if (existsSync(this.paths.venvPython)) return this.paths.venvPython
    return process.env.BILI_DUTY_PYTHON || 'python3'
  }

  async ensure() {
    ensureHomeFiles(this.paths, this.log)
    const script = join(this.paths.home, 'mcp_server.py')
    const command = this.command()
    const key = `${command}|${script}`
    if (this.client?.running && this.key === key) return this.client
    if (this.client) this.client.stop()
    this.key = key
    this.client = new McpClient({
      command,
      args: [script],
      cwd: this.paths.home,
      env: {
        ...process.env,
        BILI_DUTY_HOME: this.paths.home,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        BILI_MCP_TOOLS,
      },
      log: (msg) => this.log(`[python-mcp] ${msg}`),
    })
    return this.client
  }

  async listTools() {
    const client = await this.ensure()
    return client.listTools()
  }

  async callRaw(name, args = {}, opts = {}) {
    const client = await this.ensure()
    return client.callRaw(name, args, opts)
  }

  stop() {
    try { this.client?.stop() } catch { /* 已经没了 */ }
    this.client = null
    this.key = ''
  }
}
