/**
 * dsh-web-ding settings — the "提示音" (ding) surface, split into TWO blocks:
 *
 * Block 1 — 弹出用户选择 (question popup ding): plays when the harness pops a
 *   user-question chooser in the browser (detected client-side on the DOM
 *   `[data-question-key]` anchor — the host half sees no question frame).
 *   `questionEnabled` (boolean, default `true`) is its master switch; when
 *   `false` the browser skips the question-popup ding.
 *   `questionVolume` / `questionFreq` / `questionDecayMs` tune its tone.
 *
 * Block 2 — 回合结束 (turn-end ding): the classic agent/status idle-transition
 *   tone. `turnEndEnabled` (boolean, default `true`) is its master switch;
 *   when `false` the Host half still observes `agent/status` but skips
 *   publishing the signal, so the browser never hears a turn-end ding.
 *   `turnEndVolume` / `turnEndFreq` / `turnEndDecayMs` tune its tone.
 *
 * Per-block fields are mirrored (the same `volume` 0..1 / `freq` 80..4000 /
 * `decayMs` 100..4000 meanings as the original single block), so the two
 * dings can carry distinct pitches and loudness.
 *
 * The `signal` field is the PLUGIN-PRIVATE host→browser messenger (the same
 * pattern dsh-force-compact uses for its `liveUi` field): the Host half is
 * its only writer, the browser client never writes it, and it deliberately
 * persists to settings.yaml like every other field (harmless cosmetic residue
 * — the client's own last-at latch ignores anything it saw before load).
 *
 * @module @falling-ts/dsh-web-ding/settings
 */

/** The settings namespace key (settings.get / settings.register address). */
export const NS = 'falling-ts-web-ding'

/** The settings field carrying the host→browser turn-end signal. */
export const SIGNAL_FIELD = 'signal'

/** Defaults — also the base passed to settings.register. Two blocks, each with its own switch and tone. */
export const DEFAULTS = Object.freeze({
  // Block 1 — 弹出用户选择 (question popup ding), detected client-side on the DOM.
  questionEnabled: true,
  questionVolume: 0.7,
  questionFreq: 880,
  questionDecayMs: 900,
  // Block 2 — 回合结束 (turn-end ding), Host agent/status idle transition.
  turnEndEnabled: true,
  turnEndVolume: 0.7,
  turnEndFreq: 880,
  turnEndDecayMs: 900,
})

/**
 * Read ONE raw field of the namespace without a full parse. Never throws.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} field
 * @returns {Promise<unknown>} the raw stored value, or `undefined` when the
 *   settings service is not mounted or the field is unset.
 */
export async function readRawSetting(ctx, field) {
  try {
    const settings = ctx.get('settings')
    if (settings === undefined || typeof settings.get !== 'function') return undefined
    const value = settings.get(NS)
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'object') return undefined
    return value[field]
  } catch {
    return undefined
  }
}

/**
 * Resolve the schemastery `z` constructor, tolerating BOTH layouts:
 *  - a monorepo/dev layout where `@deepseek-ai/schemastery` resolves as a
 *    bare specifier;
 *  - this plugin as a STANDALONE repo whose node_modules lacks schemastery
 *    (it lives in the sibling `deepseek-harness/vendor/` copy). Then walk up
 *    from this file looking for the vendored build and import it via a
 *    file:// URL (required on Windows).
 * @returns {Promise<object|undefined>} resolved `z`, or undefined.
 */
async function resolveZ() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    const z = mod.default ?? mod
    if (typeof z.object === 'function') return z
  } catch { /* fall through to candidate 2 */ }
  try {
    const { fileURLToPath, pathToFileURL } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const { existsSync } = await import('node:fs')
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let hop = 0; hop < 8; hop += 1) {
      const cand = join(dir, 'deepseek-harness/vendor/schemastery/lib/index.mjs')
      if (existsSync(cand)) {
        const mod = await import(pathToFileURL(cand).href)
        const z = mod.default ?? mod
        if (typeof z.object === 'function') return z
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* candidate 2 unavailable */ }
  return undefined
}

/**
 * Build the `falling-ts-web-ding` schema through @deepseek-ai/schemastery.
 * @returns {Promise<((section: unknown) => unknown) & { toJSON: () => unknown } | null>}
 */
export async function buildSchema() {
  try {
    const z = await resolveZ()
    if (z === undefined) return null
    return z.object({
      // Block 1 — 弹出用户选择 (question popup ding), client-side DOM detection.
      questionEnabled: z.boolean().default(DEFAULTS.questionEnabled),
      questionVolume: z.number().default(DEFAULTS.questionVolume),
      questionFreq: z.number().default(DEFAULTS.questionFreq),
      questionDecayMs: z.number().default(DEFAULTS.questionDecayMs),
      // Block 2 — 回合结束 (turn-end ding), Host agent/status idle transition.
      turnEndEnabled: z.boolean().default(DEFAULTS.turnEndEnabled),
      turnEndVolume: z.number().default(DEFAULTS.turnEndVolume),
      turnEndFreq: z.number().default(DEFAULTS.turnEndFreq),
      turnEndDecayMs: z.number().default(DEFAULTS.turnEndDecayMs),
      // TRANSIENT host→browser messenger (src/core/signal.js): host-written
      // { phase:'done', at, sessionId }. z.any() because the vendored
      // schemastery exposes only object/any/string/number/boolean/array.
      signal: z.any(),
    })
  } catch {
    return null
  }
}

/**
 * Register the namespace when a `settings` service is mounted. Idempotent.
 * Falls back to a callable placeholder schema so the panel still loads when
 * schemastery is unresolvable.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<boolean>}
 */
export async function registerNamespace(ctx) {
  const settings = ctx.get('settings')
  if (settings === undefined || typeof settings.register !== 'function') return false
  const schema = await buildSchema()
  const thirdArg = { base: { ...DEFAULTS } }
  const placeholderSchema = (section) => section
  placeholderSchema.toJSON = () => ({})
  try {
    settings.register(NS, schema !== null ? schema : placeholderSchema, thirdArg)
    return true
  } catch {
    return false
  }
}
