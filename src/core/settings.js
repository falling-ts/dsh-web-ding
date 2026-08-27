/**
 * dsh-web-ding settings — the "回合结束提示音" (turn-end ding) surface.
 *
 * User-tunable parameters are registered under the `falling-ts-web-ding`
 * settings namespace (the `falling-ts-` prefix prevents collisions with
 * other plugins' keys):
 *
 * - `enabled`  (boolean, default `true`): master switch. When `false` the
 *   Host half still observes `agent/status` but skips publishing the signal,
 *   so the browser never hears a ding.
 * - `volume`   (number 0..1, default `0.7`): playback gain applied by the
 *   browser client's Web Audio synth (a per-oscillator peak, not the master).
 * - `freq`     (number 80..4000, default `880`): fundamental frequency of
 *   the synthesized "ding" in Hz. The client stacks a soft higher-octave and
 *   a faint bell partial on top automatically.
 * - `decayMs`  (number 100..4000, default `900`): exponential-decay length
 *   of the tone in milliseconds.
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

/** Defaults — also the base passed to settings.register. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  volume: 0.7,
  freq: 880,
  decayMs: 900,
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
      enabled: z.boolean().default(DEFAULTS.enabled),
      volume: z.number().default(DEFAULTS.volume),
      freq: z.number().default(DEFAULTS.freq),
      decayMs: z.number().default(DEFAULTS.decayMs),
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
