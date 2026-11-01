import test from 'node:test'
import assert from 'node:assert/strict'
import { McpClient } from '../lib/mcp.mjs'

test('DSH MCP client clears a failed spawn so it can be retried', async () => {
  const client = new McpClient({
    command: `definitely-not-a-real-command-${Date.now()}`,
    args: [],
    cwd: process.cwd(),
    env: {},
    log: () => {},
  })
  try {
    await assert.rejects(() => client.start())
    assert.equal(client.running, false)
    await assert.rejects(() => client.start())
    assert.equal(client.running, false)
  } finally {
    client.stop()
  }
})

test('DSH MCP client clears a child that exits before initialize', async () => {
  const client = new McpClient({
    command: process.execPath,
    args: ['-e', 'process.exit(1)'],
    cwd: process.cwd(),
    env: {},
    log: () => {},
  })
  try {
    await assert.rejects(() => client.start())
    assert.equal(client.running, false)
    await assert.rejects(() => client.start())
    assert.equal(client.running, false)
  } finally {
    client.stop()
  }
})
