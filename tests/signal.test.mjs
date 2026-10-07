/**
 * Signal-payload completeness tests — the regression gate for the `[子agent]`
 * residue bug (2026-10-07).
 *
 * The Host publishes with `settings.update(ns, { signal })`, and that write is
 * a RECURSIVE MERGE, not a replace: `mergeLayers` in deepseek-harness
 * `packages/settings/settings/src/index.ts` copies the previously stored
 * section, then assigns only the keys the patch itself carries. A key the patch
 * omits therefore INHERITS the previous publish's value instead of being
 * cleared, so a signal that spread `subagent` in only for children latched
 * `subagent: true` onto the namespace after the first child turn end, and every
 * later ROOT turn end replayed it (toast badged `[子agent]`, and — with
 * subagentDistinctTone — the child tone for the root ding).
 *
 * `mergeLayers` below is a verbatim port of that function, so "a root publish
 * clears the child flag" is asserted against the real store semantics rather
 * than a strawman. The control test pins the port's fidelity: the hazard only
 * exists because an omitted key survives.
 * Run: node tests/signal.test.mjs
 */

import assert from 'node:assert/strict'
import { buildDingSignal, publishDingSignal } from '../src/core/signal.js'

let passed = 0
function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') throw new Error('use testAsync for promise-returning cases')
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    console.log('  FAIL ' + name)
    console.log('       ' + (error && error.message ? error.message : String(error)))
    process.exitCode = 1
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    console.log('  FAIL ' + name)
    console.log('       ' + (error && error.message ? error.message : String(error)))
    process.exitCode = 1
  }
}

/**
 * Port of `mergeLayers(under, over)` — plain objects merge recursively, every
 * other value replaces the lower layer wholesale, and an existing key keeps its
 * position while a new one is appended. (deepseek-harness
 * packages/settings/settings/src/index.ts:287.)
 */
function mergeLayers(under, over) {
  if (over === undefined) return under
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isPlain(under) || !isPlain(over)) return over
  const merged = { ...under }
  for (const [key, value] of Object.entries(over)) {
    merged[key] = key in merged ? mergeLayers(merged[key], value) : value
  }
  return merged
}

/** A settings service stub that stores the namespace section through mergeLayers. */
function makeSettings() {
  const store = { value: {} }
  const patches = []
  return {
    store,
    patches,
    service: {
      update: async (ns, patch) => {
        patches.push({ ns, patch })
        store.value = mergeLayers(store.value, patch)
      },
    },
  }
}

/** Minimal ctx: publishDingSignal only needs ctx.get('settings') + ctx.logger. */
const makeCtx = (settings) => ({
  get: (service) => (service === 'settings' ? settings : undefined),
  logger: { debug() {}, info() {}, warn() {} },
})

const KEY_SET = ['phase', 'at', 'sessionId', 'title', 'subagent', 'depth']
const ownKeys = (signal) => Object.keys(signal).sort()

console.log('buildDingSignal — completeness')

test('root publish carries every key with its OWN subagent boolean', () => {
  const s = buildDingSignal('root-1', 'test', { subagent: false, depth: 0 }, 100)
  assert.deepEqual(ownKeys(s), [...KEY_SET].sort())
  assert.equal(s.subagent, false)
  assert.equal(s.depth, 0)
  assert.equal(s.title, 'test')
})

test('child publish carries every key too', () => {
  const s = buildDingSignal('child-1', 'kid', { subagent: true, depth: 2 }, 200)
  assert.deepEqual(ownKeys(s), [...KEY_SET].sort())
  assert.equal(s.subagent, true)
  assert.equal(s.depth, 2)
})

test('unclassified turn end (no meta) still writes subagent:false + depth:0', () => {
  const s = buildDingSignal('s1', undefined, undefined, 300)
  assert.equal(s.subagent, false)
  assert.equal(s.depth, 0)
  assert.equal(s.title, null)
  assert.equal(s.sessionId, 's1')
})

test('absent sessionId/title are null, not omitted', () => {
  const s = buildDingSignal(undefined, '   ', undefined, 400)
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'sessionId'))
  assert.equal(s.sessionId, null)
  assert.ok(Object.prototype.hasOwnProperty.call(s, 'title'))
  assert.equal(s.title, null)
})

test('garbage depth is clamped to a finite non-negative integer', () => {
  assert.equal(buildDingSignal('s', 't', { subagent: true, depth: 'two' }, 1).depth, 0)
  assert.equal(buildDingSignal('s', 't', { subagent: true, depth: -3 }, 1).depth, 0)
  assert.equal(buildDingSignal('s', 't', { subagent: true, depth: 1.7 }, 1).depth, 1)
  assert.equal(buildDingSignal('s', 't', { subagent: true, depth: Infinity }, 1).depth, 0)
})

console.log('\nmerge port — control')

test('control: mergeLayers DOES inherit a key the patch omits (the hazard)', () => {
  // Pins the port faithfully: this is exactly why every field must be written.
  const merged = mergeLayers({ signal: { at: 1, subagent: true } }, { signal: { at: 2 } })
  assert.equal(merged.signal.at, 2)
  assert.equal(merged.signal.subagent, true)
})

test('control: mergeLayers keeps the old position and appends new keys', () => {
  // The observed residue's key order (depth, then subagent) can only come from
  // a ROOT publish layered over an older CHILD publish.
  const merged = mergeLayers(
    { signal: { phase: 'done', at: 1, sessionId: 'root', title: 't', depth: 0 } },
    { signal: { phase: 'done', at: 2, sessionId: 'child', title: 'k', subagent: true, depth: 1 } },
  )
  assert.deepEqual(Object.keys(merged.signal), ['phase', 'at', 'sessionId', 'title', 'depth', 'subagent'])
})

console.log('\npublishDingSignal — end-to-end through a merging store')

await testAsync('child turn end then ROOT turn end: root is NOT left badged subagent', async () => {
  const { store, service } = makeSettings()
  const ctx = makeCtx(service)
  await publishDingSignal(ctx, 'child-1', 'kid', { subagent: true, depth: 1 })
  assert.equal(store.value.signal.subagent, true)
  await publishDingSignal(ctx, 'root-1', 'test', { subagent: false, depth: 0 })
  // The regression: the old partial patch omitted `subagent` here, and the
  // recursive merge kept the child's `true` — the toast then read
  // "[子agent] test 已完成" for the main agent's own turn end.
  assert.equal(store.value.signal.subagent, false)
  assert.equal(store.value.signal.depth, 0)
  assert.equal(store.value.signal.sessionId, 'root-1')
  assert.equal(store.value.signal.title, 'test')
})

await testAsync('root turn end then CHILD turn end: child is still flagged', async () => {
  const { store, service } = makeSettings()
  const ctx = makeCtx(service)
  await publishDingSignal(ctx, 'root-1', 'test', { subagent: false, depth: 0 })
  await publishDingSignal(ctx, 'child-1', 'kid', { subagent: true, depth: 1 })
  assert.equal(store.value.signal.subagent, true)
  assert.equal(store.value.signal.depth, 1)
  assert.equal(store.value.signal.sessionId, 'child-1')
})

await testAsync('a title-less publish CLEARS the previous title (no stale attribution)', async () => {
  const { store, service } = makeSettings()
  const ctx = makeCtx(service)
  await publishDingSignal(ctx, 'root-1', 'first title', { subagent: false, depth: 0 })
  await publishDingSignal(ctx, 'root-2', undefined, { subagent: false, depth: 0 })
  assert.equal(store.value.signal.title, null)
  assert.equal(store.value.signal.sessionId, 'root-2')
})

await testAsync('every published patch is self-sufficient (no inherited keys)', async () => {
  const { patches, service } = makeSettings()
  const ctx = makeCtx(service)
  await publishDingSignal(ctx, 'root-1', 't', { subagent: false, depth: 0 })
  await publishDingSignal(ctx, 'child-1', 'k', { subagent: true, depth: 1 })
  for (const { patch } of patches) {
    assert.deepEqual(ownKeys(patch.signal), [...KEY_SET].sort())
  }
})

await testAsync('at is strictly monotonic across same-millisecond publishes', async () => {
  const { patches, service } = makeSettings()
  const ctx = makeCtx(service)
  await publishDingSignal(ctx, 's', 't', { subagent: false, depth: 0 })
  await publishDingSignal(ctx, 's', 't', { subagent: false, depth: 0 })
  assert.ok(patches[1].patch.signal.at > patches[0].patch.signal.at)
})

await testAsync('absent settings service: resolves silently, never throws', async () => {
  await publishDingSignal({ get: () => undefined }, 's', 't', { subagent: false, depth: 0 })
})

await testAsync('rejecting settings write: swallowed (cosmetic path)', async () => {
  const ctx = makeCtx({ update: async () => { throw new Error('disk full') } })
  await publishDingSignal(ctx, 's', 't', { subagent: false, depth: 0 })
})

console.log('\n' + passed + ' passed')
