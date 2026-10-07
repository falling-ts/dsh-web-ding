/**
 * Subagent classification tests — the gate that decides whether a turn end
 * belongs to a delegated child or to the root session the human watches.
 *
 * Cases are drawn from the durable SessionHeader contract (packages/core/session
 * in deepseek-harness):
 *   - childSessionMeta stamps origin:'subagent' + parentSession + delegationDepth
 *   - a plain root session stamps none of them
 *   - a FORK stamps parentSession + isSeeded but NOT origin/delegationDepth,
 *     and forking is not delegation — it must NOT be classified as a child
 * Run: node tests/subagent.test.mjs
 */

import assert from 'node:assert/strict'
import { classifyAgent } from '../src/core/subagent.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  ' + name)
  } catch (error) {
    console.log('  FAIL ' + name)
    console.log('       ' + (error && error.message ? error.message : String(error)))
    process.exitCode = 1
  }
}

const session = (header) => ({ id: 's1', header })

console.log('classifyAgent')

test('root session: no markers -> top-level', () => {
  const r = classifyAgent(session({ id: 's1', createdAt: 1, isSeeded: false }))
  assert.equal(r.subagent, false)
  assert.equal(r.depth, 0)
})

test('subagent via origin only -> child (depth 0)', () => {
  // childSessionMeta always stamps both, but a backend stamping only origin
  // must still classify as a child.
  const r = classifyAgent(session({ id: 's1', createdAt: 1, isSeeded: false, origin: 'subagent' }))
  assert.equal(r.subagent, true)
  assert.equal(r.depth, 0)
})

test('subagent via delegationDepth only -> child', () => {
  const r = classifyAgent(session({ id: 's1', createdAt: 1, isSeeded: false, delegationDepth: 1 }))
  assert.equal(r.subagent, true)
  assert.equal(r.depth, 1)
})

test('full child header -> child with depth', () => {
  const r = classifyAgent(session({
    id: 'c1', createdAt: 1, isSeeded: false,
    parentSession: 'root', origin: 'subagent', delegationDepth: 2,
  }))
  assert.equal(r.subagent, true)
  assert.equal(r.depth, 2)
})

test('session FORK: parentSession + isSeeded, no origin/depth -> NOT a child', () => {
  // Forking is not delegation. A fork is a new independent root that happens
  // to carry parentSession; dinging on it as a subagent would be wrong.
  const r = classifyAgent(session({
    id: 'f1', createdAt: 1, isSeeded: true, parentSession: 'root',
  }))
  assert.equal(r.subagent, false)
  assert.equal(r.depth, 0)
})

test('missing session -> top-level (fail-open)', () => {
  const r = classifyAgent(undefined)
  assert.equal(r.subagent, false)
})

test('null session -> top-level (fail-open)', () => {
  const r = classifyAgent(null)
  assert.equal(r.subagent, false)
})

test('session without header -> top-level (fail-open)', () => {
  const r = classifyAgent({ id: 's1' })
  assert.equal(r.subagent, false)
})

test('garbage delegationDepth is ignored, not trusted', () => {
  const r = classifyAgent(session({ id: 's1', isSeeded: false, delegationDepth: 'two' }))
  assert.equal(r.subagent, false)
  assert.equal(r.depth, 0)
})

test('negative delegationDepth clamps to 0', () => {
  const r = classifyAgent(session({ id: 's1', isSeeded: false, delegationDepth: -3 }))
  assert.equal(r.depth, 0)
})

console.log('\n' + passed + ' passed')
