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

import { registerNamespace } from './src/core/settings.js'
import { handleAgentStatus } from './src/hooks/idle.js'

/** @type {string} the function plugin's display name. */
export const name = 'web-ding'

/**
 * Register the `agent/status` listener and the `falling-ts-web-ding` settings
 * namespace (the "回合结束提示音" surface).
 *
 * No `inject` is declared: the `settings` service arrives with the preset
 * plane AFTER this plugin's boot-time effect runs, and a boot-time `inject`
 * would fail the boot assertion (the same late-mount ordering documented by
 * dsh-force-compact). The namespace registration is therefore lazy +
 * idempotent: attempted at boot and again atop every `agent/status` emission,
 * with a bounded self-cancelling retry while the service is still absent. The
 * retry is installation bookkeeping (it settles and cancels itself on
 * success) — not a persistent timer or long-lived state.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
const __applyInner = (ctx) => {
  ctx.logger.info('[web-ding] apply START; settings=' + (ctx.get('settings') !== undefined ? 'present' : 'ABSENT'))

  // ── Lazy namespace install (settings service may arrive after boot) ──────
  const settingsState = { settled: false, installed: false }
  const RETRY_DELAY_MS = 1000
  const RETRY_MAX_ATTEMPTS = 30
  const retryTimer = { value: undefined }
  const tryRegisterOnce = async () => {
    if (settingsState.settled) return
    const settings = ctx.get('settings')
    if (settings === undefined || typeof settings.register !== 'function') return // keep retrying
    try {
      const ok = await registerNamespace(ctx)
      settingsState.settled = true
      if (ok) {
        settingsState.installed = true
        ctx.logger.info('[web-ding] registered settings namespace "falling-ts-web-ding"')
      } else {
        ctx.logger.warn('[web-ding] settings present but schema build failed — namespace NOT registered')
      }
    } catch (error) {
      const message = error instanceof Error ? (error.stack || error.message) : String(error)
      ctx.logger.warn(`[web-ding] settings namespace registration threw — ${message}`)
    }
  }
  const maybeRetryRegister = () => {
    if (settingsState.settled || retryTimer.value !== undefined) return
    let attempts = 0
    const attempt = () => {
      retryTimer.value = undefined
      if (settingsState.settled) return
      attempts += 1
      void (async () => {
        await tryRegisterOnce()
        if (settingsState.settled) {
          if (retryTimer.value !== undefined) clearTimeout(retryTimer.value)
          retryTimer.value = undefined
          return
        }
        if (attempts >= RETRY_MAX_ATTEMPTS) {
          settingsState.settled = true // give up; agent/status listeners stay as safety net
          return
        }
        retryTimer.value = setTimeout(attempt, RETRY_DELAY_MS)
      })().catch(() => {})
    }
    attempt()
  }
  const maybeRegisterSettingsNamespace = () => {
    if (settingsState.settled) return
    void (async () => {
      await tryRegisterOnce()
      if (!settingsState.settled) maybeRetryRegister()
    })().catch(() => {})
  }
  // Cancel any pending retry on teardown.
  ctx.effect(() => () => {
    if (retryTimer.value !== undefined) clearTimeout(retryTimer.value)
  }, 'web-ding: settings install retry cleanup')

  // Fire the eager attempt once NOW so a cold start with no agent traffic
  // still lands the namespace (the client panel depends on it).
  maybeRegisterSettingsNamespace()

  // ── Turn-end ding: agent/status idle transition → publish 'done' signal ──
  // agent/status is a SYNC event; the heavy work (settings write) is handed off
  // to an async IIFE with its own catch so nothing escapes the dispatch.
  ctx.on('agent/status', (payload) => {
    maybeRegisterSettingsNamespace() // re-armed; cheap no-op once settled
    void (async () => {
      await handleAgentStatus(ctx, payload)
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`[web-ding] agent/status handler degraded (swallowed) — ${message}`)
    })
  })

  ctx.logger.info('[web-ding] apply END (listeners + namespace attempts done)')
}

/**
 * Plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export const apply = (ctx) => {
  try {
    return __applyInner(ctx)
  } catch (error) {
    const message = error instanceof Error ? (error.stack || error.message) : String(error)
    try {
      ctx.logger.error(`[web-ding] apply FAILED — ${message}`)
    } catch { /* never */ }
    throw error
  }
}
