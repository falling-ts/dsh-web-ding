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
 * The signal carries the session display title, read HERE from the
 * `sessionProjections` `title` unit (see {@link readSessionTitle}) rather than
 * fetched by the browser: this half owns the live session handle, and the
 * client half stays a pure mirror of the settings namespace (no RPC, no wire
 * method spelling in a cosmetic path).
 *
 * @module @falling-ts/dsh-web-ding/turn-end
 */

import { readConfigField } from '../core/settings.js'
import { publishDingSignal } from '../core/signal.js'
import { classifyAgent } from '../core/subagent.js'

/** @type {Map<string,string>} sessionId → last observed agent/status. */
const prevStatus = new Map()
/** @type {Set<string>} sessionIds that have been observed busy (non-idle). */
const everBusy = new Set()

/**
 * Best-effort read of the session display title at the idle transition — the
 * `sessionProjections` `title` unit, the same projection the session list rows
 * read.
 *
 * Fail-open by design: an absent registry, an unfolded unit, a session with no
 * title yet, or an unexpected throw all resolve to `undefined`, and the browser
 * then records the turn end without a title. The ding itself never depends on
 * this value.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object|undefined} session live session handle of the agent that went idle
 * @returns {string|undefined} the title, or undefined when unavailable
 */
function readSessionTitle(ctx, session) {
  try {
    if (typeof ctx?.get !== 'function') return undefined
    if (session === undefined || session === null) return undefined
    const registry = ctx.get('sessionProjections')
    if (registry === undefined || registry === null) return undefined
    if (typeof registry.snapshot !== 'function') return undefined
    const snapshot = registry.snapshot(session)
    const title = snapshot === undefined || snapshot === null ? undefined : snapshot.values?.title
    return typeof title === 'string' && title.trim() !== '' ? title : undefined
  } catch {
    return undefined
  }
}

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

    const enabled = readConfigField('turnEndEnabled')
    if (enabled === false) {
      ctx.logger.debug(`[web-ding] ${sid}: idle transition ignored — turnEndEnabled=false`)
      return
    }

    // Subagent gate: every delegated child's idle transition reaches this
    // listener (root listeners are admitted for every dispatch key), so a
    // parent fan-out would otherwise ding once per child plus once for the
    // parent. Children stay silent unless explicitly opted in.
    const { subagent, depth } = classifyAgent(session)
    if (subagent && readConfigField('subagentEnabled') !== true) {
      ctx.logger.debug(`[web-ding] ${sid}: subagent idle ignored — subagentEnabled=false (depth=${depth})`)
      return
    }

    await publishDingSignal(ctx, sid, readSessionTitle(ctx, session), { subagent, depth })
  } catch (error) {
    const message = error instanceof Error ? (error.stack || error.message) : String(error)
    try {
      ctx.logger.warn(`[web-ding] handleAgentStatus degraded (swallowed) — ${message}`)
    } catch { /* never */ }
  }
}
