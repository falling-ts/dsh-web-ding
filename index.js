/**
 * dsh-web-ding — a DSH Cordis function plugin.
 *
 * Announces the moment an agent finishes: the Host half listens for the
 * agent/status 'idle' TRANSITION (all turns done, including sub-agents, before
 * the next human turn) and publishes a tiny 'done' signal into the
 * `falling-ts-web-ding` settings namespace. The browser client half
 * (web/client.js) mirrors that namespace live and answers the signal by
 * synthesizing a short "ding" with the Web Audio API — ENTIRELY front-end JS.
 *
 * The Node/Host side deliberately never plays audio and never raises a
 * Windows/system notification: the sound lives in the browser tab.
 *
 * Layout:
 * - index.js              — this file; the Cordis plugin entry (listener registrations).
 * - core/settings.js      — the `falling-ts-web-ding` settings namespace (parameters + schema).
 * - core/signal.js        — the host→browser signal publisher (settings field write).
 * - hooks/idle.js         — the `agent/status` idle-transition observer.
 * - web/client.js         — the browser half: mirrors the namespace, plays the ding, registers a settings.section.
 *
 * @module @falling-ts/dsh-web-ding
 */

import { buildConfigSchema, bindConfig } from './src/core/settings.js'
import { handleAgentStatus } from './src/hooks/idle.js'

/** @type {string} the function plugin's display name. */
export const name = 'web-ding'

/**
 * The plugin's schemastery `Config` — the settings form namespace the Loader
 * auto-derives for this entry (harness 0.1.7's Config-driven settings model,
 * which replaced the removed `settings.register(ns, schema, { base })` API).
 *
 * `apply` receives the resolved values; the Host hooks read them through
 * `bindConfig`. Top-level await because schemastery is resolved lazily: the bare
 * specifier first, then the vendored copy when this plugin runs from a standalone
 * checkout. `undefined` (schemastery unresolvable) simply leaves the entry with
 * no settings form — the hooks then fall back to `DEFAULTS`.
 */
export const Config = await buildConfigSchema()

/**
 * Register the `agent/status` listener and declare the plugin's own settings
 * form for the "回合结束提示音" surface.
 *
 * No boot-time `inject` is declared: the `settings` service mounts later than
 * this plugin's boot effect (the same late-mount ordering documented by
 * dsh-force-compact), so the form declaration rides a lazy `ctx.inject`.
 * `configure({ auto: false })` tells the harness this plugin ships its OWN page
 * (web/client.js registers a `settings.section`), so none must be generated.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object|undefined} config resolved plugin Config (schemastery volatile refs).
 */
const __applyInner = (ctx, config) => {
  bindConfig(config)
  ctx.logger.info('[web-ding] apply START; settings=' + (ctx.get('settings') !== undefined ? 'present' : 'ABSENT'))

  try {
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`[web-ding] settings.configure declaration failed (cosmetic only) — ${message}`)
  }

  // ── Turn-end ding: agent/status idle transition → publish 'done' signal ──
  // agent/status is a SYNC event; the heavy work (settings write) is handed off
  // to an async IIFE with its own catch so nothing escapes the dispatch.
  ctx.on('agent/status', (payload) => {
    void (async () => {
      await handleAgentStatus(ctx, payload)
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`[web-ding] agent/status handler degraded (swallowed) — ${message}`)
    })
  })

  ctx.logger.info('[web-ding] apply END (listener registered; settings form declared)')
}

/**
 * Plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object|undefined} config resolved plugin Config (schemastery volatile refs).
 */
export const apply = (ctx, config) => {
  try {
    return __applyInner(ctx, config)
  } catch (error) {
    const message = error instanceof Error ? (error.stack || error.message) : String(error)
    try {
      ctx.logger.error(`[web-ding] apply FAILED — ${message}`)
    } catch { /* never */ }
    throw error
  }
}
