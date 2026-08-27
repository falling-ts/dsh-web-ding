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
| Host (`index.js` + `src/`) | Listens for the `agent/status` **idle transition** (all turns done, including sub-agents, before the next human turn; a fresh idle session that never ran, and repeated idle ticks, stay silent). Publishes `{ phase:'done', at, sessionId }` into the `falling-ts-web-ding` settings namespace. Never emits audio, never calls the OS. |
| Browser (`web/client.js`) | Mirrors the namespace live via `settingsScope`. On a strictly-newer `done` signal it synthesizes a short `ding` (three sine oscillators + exponential decay envelopes) with the Web Audio API and plays it through the tab — and, at the same moment, pops a Win11-style toast in the bottom-right corner. Clicking the toast slides in a notification drawer listing every turn-end message (kept in browser `localStorage`, capped at 100, deduped by signal `at`), with per-message delete and a clear-all button. Everything stays front-end: no backend audio, no OS notification. |

## Install

```bash
dsh plugin --profile web add github:falling-ts/dsh-web-ding
```

Requires the web app to ship the client bundle (the `dsh.client` declaration in
`package.json` does that automatically).

## Configuration (`falling-ts-web-ding` namespace, $DSH_HOME/settings.yaml)

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `enabled` | boolean | `true` | Master switch (Host skips publishing when off). |
| `volume` | number 0..1 | `0.7` | Web Audio playback gain. |
| `freq` | number 80..4000 | `880` | Fundamental frequency of the ding (Hz). |
| `decayMs` | number 100..4000 | `900` | Tone decay length (ms). |

Every session's agent turn end (transition to idle) rings; repeated idle ticks of an already-idle session and brand-new sessions that never ran stay silent.

Besides the ring, each turn end drops a bottom-right toast (Win11-style,
auto-dismisses after 6 s). Click it to open the right-side notification
drawer: the last 100 turn-end messages are kept in the browser's
`localStorage` (key `falling-ts-web-ding.notify.v1`), each row can be
deleted individually, and a "全部删除" button clears them all. The message
log is front-end only — the Host never reads or writes it.

You can also adjust these from the **设置 → 回合结束提示音** panel, which
includes a "试听" (preview) button.

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

![Settings page: the **ding** (回合结束提示音) section, live-editable controls](assets/setting-ding.png)

*Settings page: the **回合结束提示音** section. Master switch, volume,
frequency and decay length are all live-editable without a restart, with a
**试听** (preview) button to warm the browser AudioContext.*

---

## License

MIT
