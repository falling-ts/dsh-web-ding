/**
 * Turn-end signal messenger — the plugin-private bridge between the HOST half
 * ("this agent just finished") and the CLIENT half ("play the ding").
 *
 * Why settings at all
 * ------------------
 * The browser client half mirrors the `falling-ts-web-ding` namespace through
 * `settingsScope.bind` → `createSnapshotStore`, so ANY field the Host writes
 * here is reflected in the browser live (the SettingsScope revision-fencing
 * contract, the same `settings/document-updated` broadcast dsh-force-compact
 * rides for its liveUi badge). That is the ONLY sanctioned host→browser
 * live-data channel an independent plugin bundle can use.
 *
 * The `signal` payload is deliberately minimal:
 *   { phase: 'done', at: <monotonic epoch ms>, sessionId?: string }
 * `at` doubles as the sequence number — the client ignores any signal older
 * than the one it last played, so restarts and stale residue never re-ding.
 *
 * Guarantees:
 *   • NEVER throws — a settings-service absence or a rejected write is caught
 *     and logged at most once per lifetime (cosmetic only; the agent/status
 *     dispatch proceeds untouched).
 *   • Fire-and-forget from the caller's perspective.
 *
 * @module @falling-ts/dsh-web-ding/signal
 */

import { NS, SIGNAL_FIELD } from './settings.js'

/** Process-local monotonic high-water mark so two same-millisecond idles can never collide. */
let lastAt = 0

/**
 * Publish one "agent finished" signal onto the `signal` field of the
 * `falling-ts-web-ding` namespace. THE host→browser delivery point.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string|undefined} sessionId the agent session id that just went idle
 * @returns {Promise<void>}
 */
let warnedOnce = false
export async function publishDingSignal(ctx, sessionId) {
  try {
    const settings = ctx.get('settings')
    if (settings === undefined || typeof settings.update !== 'function') return
    let at = Date.now()
    if (at <= lastAt) at = lastAt + 1
    lastAt = at
    const signal = {
      phase: 'done',
      at,
      ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
    }
    await settings.update(NS, { [SIGNAL_FIELD]: signal })
    if (!warnedOnce) {
      warnedOnce = true
      try {
        ctx.logger.debug(`[web-ding] signal published via ${NS}.${SIGNAL_FIELD} (at=${at})`)
      } catch { /* logging must never propagate */ }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      ctx.logger.warn(`[web-ding] signal publish failed (ignored, cosmetic only) — ${message}`)
    } catch { /* never */ }
  }
}
