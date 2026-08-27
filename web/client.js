/**
 * dsh-web-ding 浏览器半部:回合结束提示音(设置分区 + Web Audio 播放器)。
 *
 * 这是一个闭包工厂 artifact:window.__ModuleLoader__.load({ id, factory }),
 * factory(require) 通过注入的 require 解析外部模块(react、client-runtime),
 * 并返回插件面 { name, inject, apply }。宿主半部(根 index.js)与本文件是
 * 同一 package 的两个面:宿主半部由 main 入口加载,本文件由 exports["./client"]
 * 导出,经 dsh.client 声明被 client module 系统自动组成并服务。
 *
 * 职责:
 *   1. settingsScope 镜像 falling-ts-web-ding 命名空间,订阅其快照翻转——这
 *      就是宿主的"事件时钟":宿主在 agent/status idle 转变时写入 signal 字段,
 *      经 settings/document-updated 广播到达这里。
 *   2. 检测新的 'done' 信号(at 严格大于本页面最后播放的 at 才响应,首帧只做
 *      基线不播放,重启残留/重复快照都不会重复响)后,用 Web Audio API 合成
 *      一声"叮"。声音 100% 由浏览器 JS 生成——宿主 Node 端从不发声,也不发
 *      Windows/系统通知。
 *   3. 注册 settings.section "回合结束提示音" 分区:开关、音量、音色频率、
 *      时长与"试听"按钮(点击试听同时完成音频解锁)。
 *
 * 浏览器自动播放策略:AudioContext 需要一次用户手势才能出声。首次
 * pointerdown/keydown 做一次性预热(创建并 resume),"试听"按钮点击本身
 * 也是一次手势,所以点过试听或与本页面交互过后即可正常听到回合结束的叮。
 *
 * @module @falling-ts/dsh-web-ding/client
 */

window.__ModuleLoader__.load({
  id: "@falling-ts/dsh-web-ding",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;
    // 基线外部(web 平台预载):把 settingsScope 镜像成 uSES 安全的 SnapshotStore。
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-runtime/client");

    /** 宿主侧设置命名空间(settings.get 读取的键)。 */
    const NS_SETTINGS = "falling-ts-web-ding";

    /** 必需服务(slots 提供分区注册;settingsScope 由 ui-settings 提供)。 */
    const inject = ["slots", "settingsScope"];

    // ── Web Audio "叮" 播放器 --------------------------------------------------
    // 完全前端合成:无音频资产、无系统通知。三个正弦振荡器叠加:
    // 基频 + 高八度泛音(轻)+ 2.5 倍铃感泛音(更轻),各自带指数衰减包络。
    let audio = null;
    function ensureAudio() {
      if (audio) {
        if (audio.ctx.state === "closed") audio = null;
        else return audio;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      audio = { ctx };
      return audio;
    }
    // 用户手势一次性预热:创建 AudioContext 并 resume,解除自动播放静音。
    function warmup() {
      const a = ensureAudio();
      if (a && a.ctx.state === "suspended") {
        void a.ctx.resume().catch(() => {});
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", warmup, { once: true });
      window.addEventListener("keydown", warmup, { once: true });
    }
    /**
     * 播放一声"叮"。
     * @param {{volume?: number, freq?: number, decayMs?: number}} opts
     * @returns {boolean} 是否成功调度(不支持 Web Audio 时返回 false)
     */
    function playDing(opts) {
      const o = opts || {};
      const a = ensureAudio();
      if (!a) return false;
      const ctx = a.ctx;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const volume = Math.min(1, Math.max(0, Number(o.volume) || 0.7));
      const freq = Math.min(4000, Math.max(80, Number(o.freq) || 880));
      const decay = Math.min(4000, Math.max(100, Number(o.decayMs) || 900)) / 1000;
      const t0 = ctx.currentTime + 0.02;
      const schedule = (f, peak, start, dur) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, start);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.05);
      };
      schedule(freq, volume * 0.55, t0, decay);                    // 基频主体
      schedule(freq * 2.0, volume * 0.2, t0, decay * 0.75);        // 高八度泛音
      schedule(freq * 2.5, volume * 0.07, t0 + 0.004, decay * 0.6); // 铃感泛音
      return true;
    }

        // ── 回合结束消息缓存(浏览器侧,localStorage 持久化) ------------------------
    // 每次回合结束写入一条消息:{ at, timeText, sessionId }。缓存按 at 去重、上限
    // NOTIFY_CAP 条,存 localStorage;右下角弹窗与右侧消息列表通过 subscribeNotify
    // 订阅变更。这是纯前端数据(零后端、零系统通知),与 Web Audio 播放同源。
    const NOTIFY_KEY = "falling-ts-web-ding.notify.v1";
    const NOTIFY_CAP = 100;
    let notifyCache = null; // null = 尚未加载(惰性)
    const notifyListeners = new Set();

    function loadNotifyCache() {
      if (notifyCache !== null) return notifyCache;
      try {
        const raw = window.localStorage.getItem(NOTIFY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        notifyCache = Array.isArray(arr) ? arr.filter((m) => m && typeof m.at === "number") : [];
      } catch {
        notifyCache = [];
      }
      return notifyCache;
    }
    function saveNotifyCache() {
      try {
        window.localStorage.setItem(NOTIFY_KEY, JSON.stringify(notifyCache.slice(0, NOTIFY_CAP)));
      } catch { /* 无存储可用(private 模式等)时仅保留内存副本 */ }
    }
    function emitNotifyChange() {
      notifyCache = loadNotifyCache();
      const list = notifyCache;
      notifyListeners.forEach((fn) => { try { fn(list); } catch {} });
    }
    function subscribeNotify(fn) {
      notifyListeners.add(fn);
      return () => notifyListeners.delete(fn);
    }
    /** 记录一条"回合结束"消息(同一 at 只记一次)。 */
    function recordTurnEnd(at, sessionId) {
      const list = loadNotifyCache();
      if (list.some((m) => m.at === at)) return;
      const d = new Date(at);
      const pad = (n) => String(n).padStart(2, "0");
      const timeText = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      list.unshift({ at, timeText, sessionId: typeof sessionId === "string" ? sessionId : undefined });
      if (list.length > NOTIFY_CAP) list.length = NOTIFY_CAP;
      saveNotifyCache();
      emitNotifyChange();
    }

    // ── 右下角通知弹窗(Win11 风格,纯内联样式/零资产) --------------------------
    // 回合结束 ding 的同时弹出;6 秒自动消失,可手动关闭。点击主体在 C3 起
    // 展开右侧消息列表。所有样式内联,不引入任何图片/CSS 资产。
    const TOAST_TINT = "linear-gradient(135deg, rgba(0,120,212,0.16), rgba(0,120,212,0.05))";
    let toastLayer = null;
    function ensureToastLayer() {
      if (toastLayer && document.body.contains(toastLayer)) return toastLayer;
      toastLayer = document.createElement("div");
      Object.assign(toastLayer.style, {
        position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483000,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px",
        pointerEvents: "none",
      });
      document.body.appendChild(toastLayer);
      return toastLayer;
    }
    function dismissToast(el) {
      el.style.transition = "opacity 0.25s ease, transform 0.25s ease";
      el.style.opacity = "0";
      el.style.transform = "translateX(24px)";
      window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }
    function showTurnEndToast(msg) {
      const layer = ensureToastLayer();
      const d = new Date(msg.at);
      const pad = (n) => String(n).padStart(2, "0");
      const timeText = msg.timeText ||
        (d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
          " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()));
      const el = document.createElement("div");
      Object.assign(el.style, {
        pointerEvents: "auto", position: "relative", width: 340, minHeight: 84,
        background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px) saturate(1.4)",
        WebkitBackdropFilter: "blur(18px) saturate(1.4)",
        border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10,
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)", overflow: "hidden",
        display: "flex", alignItems: "stretch", cursor: "pointer",
        opacity: "0", transform: "translateX(24px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif",
        color: "#1f1f1f", fontSize: 13,
      });
      const accent = document.createElement("div");
      Object.assign(accent.style, {
        width: 4, flexShrink: 0, background: "#0078d4",
      });
      const body = document.createElement("div");
      Object.assign(body.style, { padding: "12px 14px 14px", minWidth: 0 });
      const head = document.createElement("div");
      Object.assign(head.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      });
      const title = document.createElement("span");
      title.textContent = "回合结束";
      Object.assign(title.style, { fontSize: 13.5, fontWeight: 600 });
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      Object.assign(closeBtn.style, {
        border: "none", background: "transparent", cursor: "pointer",
        fontSize: 16, lineHeight: 1, padding: "2px 6px", borderRadius: 6,
        color: "rgba(0,0,0,0.55)",
      });
      closeBtn.addEventListener("mouseenter", () => { closeBtn.style.background = "rgba(0,0,0,0.08)"; });
      closeBtn.addEventListener("mouseleave", () => { closeBtn.style.background = "transparent"; });
      closeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        window.clearTimeout(el._timer);
        dismissToast(el);
      });
      head.appendChild(title);
      head.appendChild(closeBtn);
      const text = document.createElement("div");
      text.textContent = "agent 已完成回合——浏览器播放一声“叮”。";
      Object.assign(text.style, { marginTop: 6, lineHeight: 1.5, color: "rgba(0,0,0,0.62)" });
      const foot = document.createElement("div");
      foot.textContent = timeText + (msg.sessionId ? "  ·  " + String(msg.sessionId).slice(0, 12) + "…" : "");
      Object.assign(foot.style, { marginTop: 8, fontSize: 11.5, color: "rgba(0,0,0,0.42)" });
      body.appendChild(head);
      body.appendChild(text);
      body.appendChild(foot);
      el.appendChild(accent);
      el.appendChild(body);
      layer.appendChild(el);
      void el.offsetHeight; // force reflow → 触发进入动画
      el.style.opacity = "1";
      el.style.transform = "translateX(0)";
      el._timer = window.setTimeout(() => dismissToast(el), 6000);
      // C3 起:点击主体展开右侧消息列表(由 openNotifyDrawer 接线)。
      return el;
    }

// ── 命名空间快照 → 信号检测 → 播放 ------------------------------------------
    // lastAt:本页面最后响应过的 signal.at。首帧(页面加载时已存在的残留)只做
    // 基线、不播放;之后 at 严格增长的新 'done' 信号才叮一声。
    let lastAt = null;
    function maybePlayFromValue(value) {
      if (!value || typeof value !== "object") return;
      const sig = value.signal;
      if (!sig || typeof sig !== "object") return;
      if (sig.phase !== "done") return;
      const at = typeof sig.at === "number" ? sig.at : 0;
      if (lastAt === null) {
        lastAt = at; // 首帧基线:页面打开前已发生的信号不播
        return;
      }
      if (!(at > lastAt)) return;
      lastAt = at;
      if (value.enabled !== false) {
        playDing({ volume: value.volume, freq: value.freq, decayMs: value.decayMs });
        const msg = { at, sessionId: typeof sig.sessionId === "string" ? sig.sessionId : undefined };
        recordTurnEnd(at, msg.sessionId);
        showTurnEndToast(msg);
      }
    }

    // ── 设置分区 UI --------------------------------------------------------------
    const divider = "rgba(0,0,0,0.08)";
    const hintColor = "rgba(0,0,0,0.45)";
    const gridCols = "200px minmax(0,1fr)";
    const wrapStyle = { padding: "4px 0" };
    const titleStyle = { margin: "2px 0 2px", fontSize: 15, lineHeight: 1.4 };
    const introStyle = { margin: "0 0 6px", color: hintColor, lineHeight: 1.65, fontSize: 13, maxWidth: 680 };
    const rowStyle = { display: "grid", gridTemplateColumns: gridCols, columnGap: 16, rowGap: 5, padding: "13px 0", borderBottom: "1px solid " + divider, alignItems: "center" };
    const lastRowStyle = { ...rowStyle, borderBottom: "none" };
    const labelStyle = { fontSize: 13.5, fontWeight: 500, lineHeight: 1.35 };
    const controlStyle = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
    const hintStyle = { gridColumn: "1 / 3", color: hintColor, fontSize: 12, lineHeight: 1.55 };
    const valueStyle = { fontVariantNumeric: "tabular-nums", fontSize: 13, color: hintColor, minWidth: 52, textAlign: "right" };
    const buttonStyle = { padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.22)", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 500 };
    const inputRangeStyle = { flex: 1, minWidth: 140 };

    function DingSection(props) {
      // The renderer binds the injected hooks compartment ('ding' key) into a
      // use<Name> hook; the store is the bare observable, so a selector reads
      // its latest snapshot (the sanctioned client pattern, see force-compact).
      const { update, play } = props;
      const snap = props.useDing((s) => s);
      const value = snap.value;
      const ph = hintStyle;
      if (snap.status === "unavailable") {
        return h("div", { style: wrapStyle },
          h("h2", { style: titleStyle }, "回合结束提示音"),
          h("p", { style: ph }, "设置不可用(宿主端未注册 falling-ts-web-ding 命名空间)。"));
      }
      if (snap.status === "loading" || value === undefined) {
        return h("div", { style: wrapStyle },
          h("h2", { style: titleStyle }, "回合结束提示音"),
          h("p", { style: ph }, "加载中…"));
      }
      const disabled = !snap.writable;
      const v = (value && typeof value === "object") ? value : {};
      const pct = (n) => Math.round((Number(n) || 0) * 100) + "%";
      const sliderRow = (labelText, props2, display) => h("div", { key: labelText, style: rowStyle },
        h("span", { style: labelStyle }, labelText),
        h("span", { style: controlStyle },
          h("input", { type: "range", disabled: disabled, style: inputRangeStyle, ...props2 }),
          h("span", { style: valueStyle }, display)),
      );
      return h("div", { style: wrapStyle },
        h("h2", { style: titleStyle }, "回合结束提示音"),
        h("p", { style: introStyle }, "agent 回合结束时(转入空闲)由浏览器 JS 播放一声合成“叮”——纯前端 Web Audio,宿主不发声、不弹 Windows/系统通知。"),
        h("div", { key: "enabled", style: rowStyle },
          h("span", { style: labelStyle }, "启用"),
          h("span", { style: controlStyle },
            h("input", {
              type: "checkbox",
              checked: v.enabled !== false,
              disabled: disabled,
              onChange: (ev) => update("enabled", ev.target.checked),
            })),
        ),
        sliderRow("音量",
          { min: 0, max: 1, step: 0.05, value: Number(v.volume) || 0.7, disabled: disabled, onChange: (ev) => update("volume", Number(ev.target.value)) },
          pct(v.volume)),
        sliderRow("音色频率(Hz)",
          { min: 120, max: 2000, step: 10, value: Number(v.freq) || 880, disabled: disabled, onChange: (ev) => update("freq", Number(ev.target.value)) },
          Math.round(Number(v.freq) || 880) + " Hz"),
        sliderRow("衰减时长(ms)",
          { min: 100, max: 2000, step: 50, value: Number(v.decayMs) || 900, disabled: disabled, onChange: (ev) => update("decayMs", Number(ev.target.value)) },
          Math.round(Number(v.decayMs) || 900) + " ms"),
        h("div", { key: "preview", style: lastRowStyle },
          h("span", { style: labelStyle }, "试听"),
          h("span", { style: controlStyle },
            h("button", {
              style: buttonStyle,
              disabled: disabled,
              onClick: () => play({ volume: v.volume, freq: v.freq, decayMs: v.decayMs }),
            }, "播放一声")),
        ),
        h("p", { style: { gridColumn: "1 / 3", color: hintColor, fontSize: 12, lineHeight: 1.55 } },
          "浏览器自动播放策略:首次与页面交互(点击/按键)或点击试听后,回合结束提示音才会出声。设置写入 $DSH_HOME/settings.yaml 的 falling-ts-web-ding 段。"));
    }

    /**
     * 注册分区、绑定命名空间、把信号接进播放器。
     * @param {import('@deepseek-ai/cordis').Context} ctx - client 根上下文。
     */
    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: NS_SETTINGS });
      const store = createSnapshotStore({ status: "loading", value: undefined, writable: false });
      const derive = () => {
        try {
          const s = scope.getSnapshot();
          if (s === undefined || s === null || typeof s !== "object") return;
          store.update((d) => {
            d.status = s.status;
            d.value = s.value;
            d.writable = s.writable;
          });
          if (s.status === "ready") maybePlayFromValue(s.value);
        } catch { /* never let a cosmetic derive take down the panel */ }
      };
      const unsub = scope.subscribe(derive);
      derive();
      ctx.effect(() => unsub, "web-ding: scope subscription");
      const injected = () => ({
        hooks: { ding: store },
        update: (field, value) => scope.set(field, value),
        play: (opts) => {
          warmup();
          return playDing(opts || {});
        },
      });
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "web-ding",
        order: 80,
        label: () => "回合结束提示音",
        inject: injected,
      }, DingSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
