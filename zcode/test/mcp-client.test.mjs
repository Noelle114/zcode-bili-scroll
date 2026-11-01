import test from 'node:test'
import assert from 'node:assert/strict'
import { McpClient } from '../src/mcp-client.mjs'

test('spawn failure clears running so it can be retried', async () => {
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

test('a child that exits before initialize is also retriable', async () => {
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
