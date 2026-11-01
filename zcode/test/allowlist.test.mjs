import test from 'node:test'
import assert from 'node:assert/strict'
import { decideTool, isDutyRun, shortToolName } from '../src/allowlist.mjs'

const base = {
  autoComment: false,
  mentionName: '',
  dmMode: 'only',
  dmWatch: false,
  transcribe: false,
}

test('shortToolName handles common namespaces', () => {
  assert.equal(shortToolName('bili_search'), 'bili_search')
  assert.equal(shortToolName('mcp__bili-duty__bili_search'), 'bili_search')
  assert.equal(shortToolName('plugin:bili-duty:bili_search'), 'bili_search')
})

test('duty run blocks shell/file tools and allows B站 reads', () => {
  const duty = isDutyRun({ cwd: '/home/bili/bili-duty/workspace', workspace: '/home/bili/bili-duty/workspace' })
  assert.equal(duty, true)
  assert.equal(decideTool({ toolName: 'Bash', isDuty: true, config: base }).allow, false)
  assert.equal(decideTool({ toolName: 'Read', isDuty: true, config: base }).allow, false)
  assert.equal(decideTool({ toolName: 'bili_search', isDuty: true, config: base }).allow, true)
  assert.equal(decideTool({ toolName: 'duty_report_append', isDuty: true, config: base }).allow, true)
  assert.equal(decideTool({ toolName: 'bili_transcribe', isDuty: true, config: base }).allow, false)
  assert.equal(decideTool({ toolName: 'bili_transcribe', isDuty: true, config: { ...base, transcribe: true } }).allow, true)
})

test('comment and DM gates are enforced in both modes', () => {
  assert.equal(decideTool({ toolName: 'bili_reply', isDuty: false, config: base }).allow, false)
  const commentOn = { ...base, autoComment: true, mentionName: 'me', dmMode: 'both' }
  assert.equal(decideTool({ toolName: 'bili_reply', isDuty: true, config: commentOn }).allow, true)
  assert.equal(decideTool({ toolName: 'bili_send_message', isDuty: true, config: base }).allow, true) // dmMode=only
  const dmOff = { ...base, dmMode: 'off', dmWatch: false }
  assert.equal(decideTool({ toolName: 'bili_send_message', isDuty: true, config: dmOff }).allow, false)
})

test('non-duty sessions are not restricted except writes', () => {
  assert.equal(decideTool({ toolName: 'Bash', isDuty: false, config: base }).allow, true)
  assert.equal(decideTool({ toolName: 'bili_reply', isDuty: false, config: base }).allow, false)
})
