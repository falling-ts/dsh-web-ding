# dsh-web-ding

A DSH Cordis plugin that plays a **"ding"** in the **browser** the moment an
agent finishes (runs to idle). The sound is synthesized **entirely by front-end
JavaScript (Web Audio API)** — the Node/Host side never plays audio and no
Windows/system notification is used.

Built by following the architecture of
[dsh-force-compact](https://github.com/falling-ts/dsh-force-compact):
a pure-listener Host half + a browser client half connected by the official
`settings/document-updated` mirror channel.

## What it does

| Layer | What happens |
|-------|--------------|
| Host (`index.js` + `src/`) | Listens for the `agent/status` **idle transition** (all turns done before the next human turn; a fresh idle session that never ran, and repeated idle ticks, stay silent). Sub-agent (delegated child) turn ends are classified from the persisted session header and suppressed unless you opt in. Publishes a **complete** `{ phase:'done', at, sessionId, title, subagent, depth }` (absent values are `null`/`false`/`0`, never omitted — see below) into the `falling-ts-web-ding` settings namespace — `title` is read here from the official `sessionProjections` `title` unit, so the browser never has to fetch it. Never emits audio, never calls the OS. |
| Browser (`web/client.js`) | Mirrors the namespace live via `configForms`. On a strictly-newer `done` signal it synthesizes a short `ding` (three sine oscillators + exponential decay envelopes) with the Web Audio API and plays it through the tab — using the sub-agent tone when the signal is flagged `subagent` and a distinct tone is enabled — and, at the same moment, pops a Win11-style toast in the bottom-right corner. Clicking the toast slides in a notification drawer listing every turn-end message (kept in browser `localStorage`, capped at 100, deduped by signal `at`), with per-message delete and a clear-all button. Everything stays front-end: no backend audio, no OS notification. |

## Install

```bash
dsh plugin --profile web add github:falling-ts/dsh-web-ding
```

Requires the web app to ship the client bundle (the `dsh.client` declaration in
`package.json` does that automatically).

## Configuration (`falling-ts-web-ding` namespace, stored in the profile's `cordis.patch.yml`)

Two independent blocks, each with its own switch and its own tone:

**Block 1 — 弹出用户选择 (question popup ding)** — plays when the harness pops a
user-question chooser in the browser. Detection is client-side on the DOM
(`[data-question-key]` anchor of the QuestionComposer): the Host half sees no
question frame, so this block is entirely browser-side.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `questionEnabled` | boolean | `true` | Switch for the question-popup ding. |
| `questionVolume` | number 0..1 | `0.7` | Web Audio playback gain. |
| `questionFreq` | number 80..4000 | `880` | Fundamental frequency of the ding (Hz). |
| `questionDecayMs` | number 100..4000 | `900` | Tone decay length (ms). |

**Block 2 — 回合结束 (turn-end ding)** — the classic agent/status idle-transition
tone. The Host observes `agent/status`; on the idle transition (a top-level turn
done before the next human turn; fresh sessions that never ran and repeated idle
ticks stay silent) it publishes the `done` signal.

> **Behaviour change (v0.7.0).** Until now the turn-end ding fired on *every*
> idle transition, including a delegated sub-agent's — so a parent that fanned
> out to N children rang N+1 times. Sub-agent turn ends are now classified and
> suppressed by default (`subagentEnabled: false`), which means **a sub-agent
> finishing on its own no longer dings**; the parent still dings when it wraps
> up. Set `subagentEnabled: true` to restore the old "every turn end rings"
> behaviour (optionally with a distinct sub-agent tone).

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `turnEndEnabled` | boolean | `true` | Switch for the turn-end ding (Host skips publishing when off). |
| `turnEndVolume` | number 0..1 | `0.7` | Web Audio playback gain. |
| `turnEndFreq` | number 80..4000 | `880` | Fundamental frequency of the ding (Hz). |
| `turnEndDecayMs` | number 100..4000 | `900` | Tone decay length (ms). |


**Block 2 gate — sub-agent turn ends.** `agent/status` is scope-filtered, but
the filter only narrows downward: a listener on an untagged root context is
admitted for every dispatch key, so this plugin observes the idle transition
of every child a parent delegates to. A parent that fans out to N children
therefore produces N+1 turn-end signals — one per child, then the parent's own.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `subagentEnabled` | boolean | `false` | Also ding when a delegated sub-agent finishes. Off by default: the extra N dings are noise if you stepped away. When on, the parent still dings again (main tone) when it wraps up. |
| `subagentDistinctTone` | boolean | `false` | Give sub-agents their own tone instead of reusing the main one. |
| `subagentVolume` | number 0..1 | `0.7` | Web Audio gain for the sub-agent ding. |
| `subagentFreq` | number 80..4000 | `440` | Fundamental frequency of the sub-agent ding (Hz) — one octave below the main default, so it reads as in-progress rather than all-done. |
| `subagentDecayMs` | number 100..4000 | `900` | Sub-agent tone decay length (ms). |

A child is identified from its **persisted** session header — either
`origin === 'subagent'` or `delegationDepth > 0` — so the classification
survives restart and resume. The two markers are accepted independently because
not every child creation path stamps both. `parentSession` alone is
deliberately NOT treated as delegation: a session **fork** also carries it, and
a fork is a new independent root, not a child.

**Every publish writes every field (fixed 2026-10-07).** `settings.update` is a
**recursive merge**, not a replace (`mergeLayers` in deepseek-harness
`packages/settings/settings/src/index.ts`): it copies the stored section and
assigns only the keys the patch itself carries, so an omitted key INHERITS the
previous publish instead of being cleared. The old payload spread `subagent` in
only for children, which latched `subagent: true` onto the namespace after the
first child turn end — every later **root** turn end replayed it, badging the
toast `[子agent]` (and, with `subagentDistinctTone`, playing the child tone for
the root ding). `buildDingSignal` now always returns the full payload. Gate:
`node tests/signal.test.mjs`.

Besides the ring, each turn end drops a bottom-right toast (Win11-style,
auto-dismisses after 6 s). Click it to open the right-side notification
drawer: the last 100 turn-end messages are kept in the browser's
`localStorage` (key `falling-ts-web-ding.notify.v1`), each row can be
deleted individually, and a "全部删除" button clears them all. The message
log is front-end only — the Host never reads or writes it.

You can also adjust both blocks from the **设置 → 提示音配置** panel,
each with its own switch and its own "试听" (preview) button.

## Browser autoplay policy

Browsers block audio until a user gesture. The client warms the
`AudioContext` on the first pointer/key interaction (and on the preview
button), so: interact with the page once (or press 试听) and you will hear the
ding at every agent turn end. An audio context in a background tab may be
suspended by the browser itself — keep the tab visible to hear the tone.

## Development

```bash
# mount as a dev overlay (plain JS, no build step)
dsh web --patch $(pwd)/cordis.patch.yml   # if supported by your CLI
# or install from a local path
dsh plugin --profile web add /path/to/dsh-web-ding
```

See `AGENTS.md` for the plugin's own rules (pure Host listener, no backend
audio, no OS notification, only sanctioned settings-mirror channel to the
browser).

## Screenshots

![Settings page: the **提示音配置** section, two blocks each with its own switch and tone](assets/setting-ding.png)

*Settings page: the **提示音配置** section — "弹出用户选择" and "回合结束" blocks,
each with its own switch, volume, frequency and decay length, all live-editable
without a restart, each with a **试听** (preview) button to warm the browser
AudioContext.*

---

## License

MIT
