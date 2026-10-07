/**
 * Subagent classification — decide whether an agent's turn end belongs to a
 * DELEGATED CHILD rather than to the top-level session the human is watching.
 *
 * Why this exists
 * --------------
 * `agent/status` is scope-filtered, but the filter only narrows DOWNWARD: a
 * listener registered on an untagged (root) context carries no scope tag, and
 * `scopeTarget` admits untagged listeners for every dispatch key — events flow
 * up the scope chain, never down. So a plugin registered at the root observes
 * the idle transition of EVERY child a parent delegates to. A parent that fans
 * out to N children therefore produces N+1 turn-end signals: one per child,
 * then the parent's own. Without this module all N+1 ding identically.
 *
 * What identifies a child
 * -----------------------
 * All three markers live on the persisted session header, so they survive
 * restart and resume (a runtime-only marker would reset a resumed child to
 * top-level):
 *   - `origin === 'subagent'` — the product's own classification, written by
 *     `childSessionMeta` and read the same way by the host's own session
 *     routing (`hasApiSessionSubagentOwner` in session-controller).
 *   - `delegationDepth` — 0 for a top-level session, parent + 1 for a child.
 *     `delegationDepthOf` treats the persisted header as the monotone floor.
 *   - `parentSession` — the delegating parent's session id.
 *
 * The first two are accepted independently (OR), deliberately: `origin` is the
 * canonical marker but is stamped by `childSessionMeta`, and not every child
 * creation path is guaranteed to route through it — a backend that stamps only
 * `delegationDepth` would otherwise be misclassified as top-level. The reverse
 * gap (depth present but origin absent) is exactly the case the OR covers.
 * `parentSession` is NOT used as a positive test on its own: a session FORK is
 * a new independent root that also carries `parentSession`, and forking is not
 * delegation — dinging on a fork's completion would be wrong.
 *
 * Fail-open by design: an absent session, a header without the markers, or an
 * unexpected shape all classify as TOP-LEVEL. A missing classification must
 * never silence the main turn-end ding, which is the plugin's whole purpose.
 *
 * @module @falling-ts/dsh-web-ding/subagent
 */

/**
 * Classify one agent as a delegated child or a top-level root.
 *
 * Strictly a header read — no service lookups, no awaits, safe to call from a
 * synchronous `agent/status` listener.
 * @param {object|undefined} session the agent's live session (`agent.session`).
 * @returns {{subagent: boolean, depth: number}} `subagent` true for a delegated
 *   child; `depth` its delegation depth (0 when unknown).
 */
export function classifyAgent(session) {
  const header = session === null || session === undefined ? undefined : session.header
  if (header === null || header === undefined || typeof header !== 'object') {
    return { subagent: false, depth: 0 }
  }
  const depth = typeof header.delegationDepth === 'number' && Number.isFinite(header.delegationDepth)
    ? Math.max(0, Math.trunc(header.delegationDepth))
    : 0
  const subagent = header.origin === 'subagent' || depth > 0
  return { subagent, depth }
}
