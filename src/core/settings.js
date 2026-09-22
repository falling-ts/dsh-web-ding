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

/** The settings form namespace key. It MUST equal this plugin's LOADER ENTRY ID
 *  (`falling-ts-web-ding`, see cordis.patch.yml): harness 0.1.7 derives the form
 *  namespace from `entry.options.id`, and the client half addresses it by that id. */
export const NS = 'falling-ts-web-ding'

/** The settings field carrying the host→browser turn-end signal. */
export const SIGNAL_FIELD = 'signal'

/** Defaults — the schema `.default()` values in {@link buildConfigSchema} (harness
 *  0.1.7 has no `{ base }` layer; defaults come from the schema). Two blocks, each
 *  with its own switch and tone. */
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
 * Live Config refs handed to `apply`. Every Host tunable is read through this
 * holder, so a settings-form edit is picked up on the next read (the ConfigForm
 * volatile-commit contract). Set once by the plugin entry.
 */
let liveConfig

/**
 * Bind the resolved plugin Config.
 * @param {object|undefined} config schemastery-resolved Config (volatile refs).
 */
export function bindConfig(config) {
  liveConfig = config
}

/**
 * Read ONE live config field. Never throws.
 * @param {string} field
 * @returns {unknown} the current value, or `undefined` when unset/unavailable.
 */
export function readConfigField(field) {
  try {
    const ref = liveConfig === null || liveConfig === undefined ? undefined : liveConfig[field]
    if (ref === undefined || ref === null || typeof ref.get !== 'function') return undefined
    return ref.get()
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
 * Build the plugin's schemastery `Config` schema — the settings form namespace
 * the Loader auto-derives for this entry.
 *
 * Harness 0.1.7 replaced the old `settings.register(ns, schema, { base })` API
 * with a Config-driven model: a plugin exports `Config`, the form namespace is
 * the LOADER ENTRY ID (`falling-ts-web-ding`), defaults come from `.default()`,
 * and every field the form may write must be marked `.volatile()` (volatile-only
 * edits commit in place; `settings.update` refuses non-volatile paths).
 *
 * Returns `undefined` when schemastery is unresolvable — the entry then simply
 * has no settings form, and the Host hooks fall back to `DEFAULTS`.
 * @returns {Promise<object|undefined>}
 */
export async function buildConfigSchema() {
  try {
    const z = await resolveZ()
    if (z === undefined) return undefined
    return z.object({
      // Block 1 — 弹出用户选择 (question popup ding), client-side DOM detection.
      questionEnabled: z.boolean().default(DEFAULTS.questionEnabled).volatile(),
      questionVolume: z.number().default(DEFAULTS.questionVolume).volatile(),
      questionFreq: z.number().default(DEFAULTS.questionFreq).volatile(),
      questionDecayMs: z.number().default(DEFAULTS.questionDecayMs).volatile(),
      // Block 2 — 回合结束 (turn-end ding), Host agent/status idle transition.
      turnEndEnabled: z.boolean().default(DEFAULTS.turnEndEnabled).volatile(),
      turnEndVolume: z.number().default(DEFAULTS.turnEndVolume).volatile(),
      turnEndFreq: z.number().default(DEFAULTS.turnEndFreq).volatile(),
      turnEndDecayMs: z.number().default(DEFAULTS.turnEndDecayMs).volatile(),
      // TRANSIENT host→browser messenger (src/core/signal.js): host-written
      // { phase:'done', at, sessionId }. z.any() because the vendored
      // schemastery exposes only object/any/string/number/boolean/array.
      signal: z.any().volatile(),
    })
  } catch {
    return undefined
  }
}
