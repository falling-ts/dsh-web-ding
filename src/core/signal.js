/**
 * Turn-end signal messenger — the plugin-private bridge between the HOST half
 * ("this agent just finished") and the CLIENT half ("play the ding").
 *
 * Why settings at all
 * ------------------
 * The browser client half mirrors the `falling-ts-web-ding` namespace through
 * `configForms.get` → `createSnapshotStore`, so ANY field the Host writes
 * here is reflected in the browser live (the ConfigForm revision-fencing
 * contract, the same `settings/document-updated` broadcast dsh-force-compact
 * rides for its liveUi badge). That is the ONLY sanctioned host→browser
 * live-data channel an independent plugin bundle can use.
 *
 * The `signal` payload is deliberately minimal:
 *   { phase: 'done', at: <monotonic epoch ms>, sessionId?: string, title?: string }
 * `at` doubles as the sequence number — the client ignores any signal older
 * than the one it last played, so restarts and stale residue never re-ding.
 *
 * The session display title rides THIS payload instead of being fetched by the
 * browser (2026-09-30). The host is the only party that may read the
 * `sessionProjections` `title` unit, and the client half must not reach the
 * session API itself: transport belongs to the client Connection (the initiator
 * of a request mints `rpcId`, and that minting stays in Connection), while a
 * status-line decoration has no business holding the current wire method
 * spelling. Carrying the title here keeps the client a pure mirror of this
 * namespace — one writer, one shape, no RPC.
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
 * @param {string|undefined} title the session display title at that moment
 *   (already resolved by the caller — see `hooks/idle.js`; omitted when unknown,
 *   and the browser then renders the record without a title)
 * @returns {Promise<void>}
 */
let warnedOnce = false
export async function publishDingSignal(ctx, sessionId, title) {
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
      ...(typeof title === 'string' && title !== '' ? { title } : {}),
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
