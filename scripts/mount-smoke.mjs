/**
 * Mount this plugin on a real Cordis context and drive the real event dispatch.
 *
 * Unit tests call the listener directly, which proves the logic and nothing about
 * the wiring. This script proves the wiring: a genuine `Context`, a genuine
 * `ctx.plugin()`, and the genuine `waterfall` dispatch the tool registry uses.
 *
 * Needs `@deepseek-ai/cordis` resolvable; a checkout without an install can skip
 * this script, and nothing else depends on it.
 *
 * Teardown is asserted, because this plugin's disposal path was observed here: the
 * listener is removed and dispatch allows again. (A sibling plugin that shadows a
 * service instance instead could not observe its teardown on a bare root context,
 * and said so rather than asserting it — the rule is to assert only what runs.)
 */

import assert from 'node:assert/strict'

import { Context } from '@deepseek-ai/cordis'

import * as plugin from '../lib/index.js'

const root = new Context()
root.plugin(plugin, {})
await new Promise((resolve) => setTimeout(resolve, 50))

/** Dispatch one pending call the way the registry does. */
async function dispatch(command, name = 'bash') {
  const exec = { name, callId: 'call-1', token: 'call-1', rootCallId: 'call-1', arguments: { command } }
  return root.waterfall('tools/pre-execute', exec, async () => ({ kind: 'allow' }))
}

const denied = await dispatch('rm -rf /')
assert.equal(denied.kind, 'deny', 'a root delete must be refused through the real dispatch')
assert.match(denied.reason, /filesystem root/u)

const allowed = await dispatch('rm -rf ./dist')
assert.equal(allowed.kind, 'allow', 'an ordinary build cleanup must pass through')

// The reported command is PowerShell, so it goes through the pwsh tool's dialect.
const reported = await dispatch('cmd /c "rd /s /q \\"$d\\""', 'pwsh')
assert.equal(reported.kind, 'deny', 'the reported command must be refused')
assert.equal(reported.reason.includes('\\'), true)

console.log('mount: deny and allow both observed through the real dispatch')

root.registry.delete(plugin)
await new Promise((resolve) => setTimeout(resolve, 50))
const after = await dispatch('rm -rf /')
assert.equal(after.kind, 'allow', 'disposal must remove the listener')
console.log('mount smoke: PASS (teardown observed: listener removed, dispatch allowed again)')
