import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { apply, evaluate, normaliseConfig } from '../lib/index.js'

/** A context that records listeners and effects instead of running a fiber. */
function fakeContext() {
  const listeners = []
  const effects = []
  return {
    listeners,
    effects,
    on(event, listener, options) {
      const record = { event, listener, options, live: true }
      listeners.push(record)
      return () => {
        record.live = false
        return undefined
      }
    },
    effect(fn) {
      effects.push(fn)
      return () => {}
    },
  }
}

/** The listener apply() registered, once it has been mounted. */
function mounted(ctx) {
  assert.equal(ctx.listeners.length, 1)
  return ctx.listeners[0]
}

/** A pending execution carrying one shell command. */
function exec(name, command) {
  return { name, arguments: { command } }
}

describe('normaliseConfig', () => {
  it('defaults to denying over the two shell tools', () => {
    assert.deepEqual(normaliseConfig(undefined), { mode: 'deny', tools: ['bash', 'pwsh'] })
    assert.deepEqual(normaliseConfig({}), { mode: 'deny', tools: ['bash', 'pwsh'] })
  })

  it('accepts an explicit posture and tool list', () => {
    assert.deepEqual(normaliseConfig({ mode: 'off', tools: ['bash'] }), { mode: 'off', tools: ['bash'] })
  })

  it('refuses an unknown mode instead of defaulting', () => {
    assert.throws(() => normaliseConfig({ mode: 'warn' }), /mode must be one of deny, off/u)
  })

  it('refuses a malformed tool list', () => {
    assert.throws(() => normaliseConfig({ tools: 'bash' }), /tools must be an array/u)
    assert.throws(() => normaliseConfig({ tools: [1] }), /tools must be an array/u)
  })

  it('refuses a non-object config', () => {
    assert.throws(() => normaliseConfig([]), /config must be an object/u)
    assert.throws(() => normaliseConfig('x'), /config must be an object/u)
  })
})

describe('evaluate', () => {
  const settings = { mode: 'deny', tools: ['bash', 'pwsh'] }

  it('judges a shell call', () => {
    assert.deepEqual(evaluate(exec('bash', 'rm -rf /'), settings), {
      program: 'rm',
      target: '/',
      category: 'root',
    })
  })

  it('ignores tools outside the configured list', () => {
    assert.equal(evaluate(exec('read', 'rm -rf /'), settings), null)
    assert.equal(evaluate(exec('bash', 'rm -rf /'), { tools: ['pwsh'] }), null)
  })

  it('survives malformed executions', () => {
    assert.equal(evaluate({}, settings), null)
    assert.equal(evaluate({ name: 'bash' }, settings), null)
    assert.equal(evaluate({ name: 'bash', arguments: null }, settings), null)
    assert.equal(evaluate({ name: 'bash', arguments: { command: 7 } }, settings), null)
  })
})

describe('apply', () => {
  it('registers one prepended pre-execute listener and an effect', () => {
    const ctx = fakeContext()
    apply(ctx, undefined)
    const listener = mounted(ctx)
    assert.equal(listener.event, 'tools/pre-execute')
    assert.deepEqual(listener.options, { prepend: true })
    assert.equal(ctx.effects.length, 1)
  })

  it('mounts nothing when the posture is off', () => {
    const ctx = fakeContext()
    apply(ctx, { mode: 'off' })
    assert.equal(ctx.listeners.length, 0)
    assert.equal(ctx.effects.length, 0)
  })

  it('denies a root delete and leaves the chain alone otherwise', async () => {
    const ctx = fakeContext()
    apply(ctx, undefined)
    const { listener } = mounted(ctx)
    let passed = 0
    const next = async () => {
      passed += 1
      return { kind: 'allow' }
    }

    const denied = await listener(exec('bash', 'rm -rf /'), next)
    assert.equal(denied.kind, 'deny')
    assert.match(denied.reason, /filesystem root/u)
    assert.equal(passed, 0)

    const allowed = await listener(exec('bash', 'rm -rf ./dist'), next)
    assert.deepEqual(allowed, { kind: 'allow' })
    assert.equal(passed, 1)
  })

  it('stops judging once its listener is disposed', async () => {
    const ctx = fakeContext()
    const dispose = apply(ctx, undefined)
    const record = ctx.listeners[0]
    dispose()
    assert.equal(record.live, false)
  })

  it('returns the disposer so a plugin return value also unmounts it', () => {
    const ctx = fakeContext()
    const returned = apply(ctx, undefined)
    assert.equal(typeof returned, 'function')
  })
})
