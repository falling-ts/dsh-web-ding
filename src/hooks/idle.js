/**
 * The turn-end ding trigger — observes `agent/status` and publishes the
 * "agent finished" signal exactly once per idle TRANSITION.
 *
 * Why the transition bookkeeping:
 * - The agent starts idle for a fresh session (before any turn) — nobody
 *   asked for a ding then, and a "new session created" ding would be noise.
 * - The agent/status idle tick can repeat while a session stays idle (the
 *   same recurrence dsh-force-compact documents for its idle compaction), so
 *   the raw `status === 'idle'` guard alone would re-ding every tick.
 *
 * Two process-local latches (pure listener state, no timer, no persistence):
 *   prevStatus: sessionId → last observed status (Map)
 *   everBusy:   sessionIds that were observed in a non-idle status (Set)
 * A signal is published only when BOTH hold: the previous status was NOT
 * 'idle' (this is a genuine running→idle transition) AND the session was
 * observed busy at least once (so the very first idle after session creation
 * stays silent).
 *
 * @module @falling-ts/dsh-web-ding/turn-end
 */

import { readRawSetting } from '../core/settings.js'
import { publishDingSignal } from '../core/signal.js'

/** @type {Map<string,string>} sessionId → last observed agent/status. */
const prevStatus = new Map()
/** @type {Set<string>} sessionIds that have been observed busy (non-idle). */
const everBusy = new Set()

/**
 * Handle one `agent/status` emission. Never throws out of the listener (any
 * anomaly logs and settles).
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{agent: import('@deepseek-ai/dsh-agent').Agent, status: string}} payload
 * @returns {Promise<void>}
 */
export async function handleAgentStatus(ctx, payload) {
  try {
    if (payload === null || typeof payload !== 'object') return
    const agent = payload.agent
    const status = payload.status
    if (typeof status !== 'string') return
    const session = (agent && typeof agent === 'object') ? agent.session : undefined
    const sid = (session && typeof session.id === 'string') ? session.id : '?'

    if (status !== 'idle') {
      if (status === 'running') everBusy.add(sid)
      prevStatus.set(sid, status)
      return
    }

    const prev = prevStatus.get(sid)
    prevStatus.set(sid, 'idle')
    if (prev === 'idle') return // repeated idle tick — already handled
    if (!everBusy.has(sid)) return // fresh session that never ran — no ding

    const enabled = await readRawSetting(ctx, 'enabled')
    if (enabled === false) {
      ctx.logger.debug(`[web-ding] ${sid}: idle transition ignored — enabled=false`)
      return
    }
    await publishDingSignal(ctx, sid)
  } catch (error) {
    const message = error instanceof Error ? (error.stack || error.message) : String(error)
    try {
      ctx.logger.warn(`[web-ding] handleAgentStatus degraded (swallowed) — ${message}`)
    } catch { /* never */ }
  }
}
