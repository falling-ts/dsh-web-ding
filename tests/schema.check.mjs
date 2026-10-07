/**
 * Config-schema defaults check — the settings form's contract.
 *
 * schemastery is an OPTIONAL peer: in a dev tree it resolves as a bare
 * specifier, and as a standalone repo it comes from a sibling
 * `deepseek-harness/vendor/` copy that `resolveZ()` walks up to find. When
 * NEITHER is present, `buildConfigSchema()` returns `undefined` BY DESIGN
 * (the entry then simply has no settings form and the Host hooks fall back to
 * DEFAULTS). That is an environment fact, not a failure of this contract, so it
 * reports SKIP and exits 0 — a clean clone with no vendor tree must not go red.
 *
 * Every field the form may write is asserted against DEFAULTS, which is the
 * single source of truth for both `.default()` and the Host's fallback read;
 * a field missing from the schema, or drifting from DEFAULTS, fails.
 * Run: node tests/schema.check.mjs
 */

import { buildConfigSchema, DEFAULTS } from '../src/core/settings.js'

const C = await buildConfigSchema()

if (C === undefined) {
  console.log('SKIP: schemastery is unresolvable here (optional peer).')
  console.log('      buildConfigSchema() returns undefined by design; no settings form is derived.')
  console.log('      Install the peer or provide a sibling deepseek-harness/vendor copy to run this check.')
  process.exit(0)
}

const shape = C.__shape
// The schema is the form contract, so every non-transient DEFAULTS field must
// appear with the DEFAULTS value as its default. `signal` is the transient
// host->browser messenger, asserted separately just for presence.
const want = Object.fromEntries(
  Object.entries(DEFAULTS).filter(([k]) => k !== 'signal'),
)

let bad = 0
for (const [k, v] of Object.entries(want)) {
  const node = shape[k]
  const got = node === undefined ? 'MISSING' : node.__def
  const ok = got === v
  if (!ok) bad += 1
  console.log((ok ? '  ok   ' : '  BAD  ') + k.padEnd(22) + 'default=' + String(got) + ' (want ' + String(v) + ')')
}

// Guard the field list itself: a DEFAULTS entry with no schema field would
// otherwise be silently unaudited by the loop above.
const extra = Object.keys(shape).filter((k) => k !== 'signal' && !(k in want))
if (extra.length > 0) {
  bad += extra.length
  console.log('  BAD  schema fields absent from DEFAULTS: ' + extra.join(', '))
}

const signalOk = shape.signal !== undefined
if (!signalOk) bad += 1
console.log('  ' + (signalOk ? 'ok   ' : 'BAD  ') + 'signal field present: ' + signalOk)

console.log(bad === 0 ? '\nAll schema defaults correct' : '\n' + bad + ' WRONG')
if (bad !== 0) process.exitCode = 1
