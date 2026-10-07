/**
 * dsh-web-ding 浏览器半部:提示音配置(设置分区 + Web Audio 播放器,两块:弹出
 * 用户选择 / 回合结束)。
 *
 * 这是一个闭包工厂 artifact:window.__ModuleLoader__.load({ id, factory }),
 * factory(require) 通过注入的 require 解析外部模块(react、client-runtime),
 * 并返回插件面 { name, inject, apply }。宿主半部(根 index.js)与本文件是
 * 同一 package 的两个面:宿主半部由 main 入口加载,本文件由 exports["./client"]
 * 导出,经 dsh.client 声明被 client module 系统自动组成并服务。
 *
 * 职责:
 *   1. configForms 镜像 falling-ts-web-ding 命名空间,订阅其快照翻转——这
 *      就是宿主的"事件时钟":宿主在 agent/status idle 转变时写入 signal 字段,
 *      经 settings/document-updated 广播到达这里。
 *   2. 检测新的 'done' 信号(at 严格大于本页面最后播放的 at 才响应,首帧只做
 *      基线不播放,重启残留/重复快照都不会重复响)后,用 Web Audio API 合成
 *      一声"叮"。声音 100% 由浏览器 JS 生成——宿主 Node 端从不发声,也不发
 *      Windows/系统通知。
 *   3. 注册 settings.section "提示音配置" 分区:两块(弹出用户选择 / 回合结束),
 *      每块都有开关、音量、音色频率、时长与"试听"按钮(点击试听同时完成音频解锁)。
 *      滑块用 BufferedSlider 本地缓冲——拖动只刷本地 state,松手/失焦才提交,
 *      避免每次拖动写盘 + 广播 + 整块面板重渲染导致卡顿。
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
    // 基线外部(web 平台预载):把 configForms 镜像成 uSES 安全的 SnapshotStore。
    // `createSnapshotStore` 的正确来源是 PLATFORM_MODULES seed 表内的静态包
    // `@deepseek-ai/dsh-client-store`；`@deepseek-ai/dsh-client-runtime` 不在共享模块表
    // 里，require 它会命中 client-modules 的 "missed the module table" 落空错误。
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");

    /** 宿主侧设置命名空间(settings.get 读取的键)。 */
    const NS_SETTINGS = "falling-ts-web-ding";

    /** 该分区拥有的文案命名空间。 */
    const NS = "settings.webDing";

    /** 必需服务(slots 提供分区注册;configForms 由 ui-settings 提供;locale 提供词典与 t)。 */
    const inject = ["slots", "locale", "configForms"];

    /**
     * 翻译入口。apply 时绑定到 ctx.locale.bind(NS)——绑定函数保留稳定身份、按
     * 调用时刻读取活动语言。所有产品可见文案(toast、右侧消息面板、设置分区)都
     * 经它取词,不再有硬编码副本。
     *
     * 词典按上游约定走 locale 查找链:活动语言 → 其 fallback 链 → en → common
     * 命名空间 → 键名本身。模块求值到 apply 之间不渲染任何 DOM,故未绑定期间的
     * 回落值只在异常路径可见。
     */
    let tr = (key) => key;

    // ── 词典 --------------------------------------------------------------------
    // zh 是键集事实源(上游约定),en/ja/ko 必须与之逐键对齐——缺键不会报错,只会
    // 静默回落到 en,故键集一致性由 exploration/i18n-parity-probe.mjs 守住。
    // ja / ko 由本插件作为**语言包**贡献(上游 @deepseek-ai/dsh-client-locale 只内置
    // zh/en),见下方 contributeLanguages。`{name}` 为占位符插值。
    const zh = {
      nav: "提示音配置",
      intro: "两种场景各自提示音,由浏览器 JS 纯前端 Web Audio 合成——宿主不发声、不弹 Windows/系统通知。设置写入 profile 的 cordis.patch.yml(falling-ts-web-ding 段)。",
      unavailable: "设置不可用(宿主端未注册 falling-ts-web-ding 命名空间)。",
      loading: "加载中…",
      enable: "启用",
      volume: "音量",
      freq: "音色频率(Hz)",
      decay: "衰减时长(ms)",
      preview: "试听",
      playOnce: "播放一声",
      questionTitle: "弹出用户选择",
      questionDesc: "harness 弹出用户选择题(浏览器对话区的选择题卡片)时播放一声“叮”,提醒你回来作答。检测走浏览器 DOM(QuestionComposer 的 data-question-key 锚点),宿主端不参与。",
      turnEndTitle: "回合结束",
      turnEndDesc: "agent 回合结束时(agent/status 转入 idle)播放一声“叮”。宿主只在命中 idle 转换时发信号,声音由浏览器合成。",
      subagentEnable: "子 agent 完成时也提醒",
      subagentEnableDesc: "委派出去的子 agent 跑完时是否也响一声。默认关闭:主 agent 派出 N 个子 agent 会产生 N+1 次完成事件,多出来的 N 声对离开页面的你就是噪音。打开后,主 agent 自己收尾时仍会再响一声(主音)。",
      subagentDistinct: "子 agent 用独立音色",
      subagentDistinctDesc: "给子 agent 一个和主音不同的音色(默认低八度),让你听得出这是「中间进展」还是「整体做完了」。关闭则子 agent 复用主音。",
      subagentBadge: "子 agent",
      subagentToast: "子 agent 完成了它的回合——浏览器播放一声“叮”。",
      subagentToneTitle: "子 agent 音色",
      previewMain: "试听（主音）",
      subagentPreview: "试听（子 agent 音）",
      previewCompare: "对比试听",
      autoplayNote: "浏览器自动播放策略:首次与页面交互(点击/按键)或点击任一试听后,提示音才会出声。",
      toastBody: "agent 已完成回合——浏览器播放一声“叮”。",
      doneTitle: "{title} 已完成",
      emptyList: "暂无回合结束消息",
      drawerTitle: "回合结束消息",
      clearAll: "全部删除",
      deleteWord: "删除",
      sessionLabel: "会话 {id}…",
      unitHz: "{value} Hz",
      unitMs: "{value} ms",
    };
    const en = {
      nav: "Notification sounds",
      intro: "Each scenario has its own sound, synthesized entirely in the browser with the Web Audio API — the host plays nothing and raises no Windows/system notification. Settings land in the profile's cordis.patch.yml (falling-ts-web-ding section).",
      unavailable: "Settings unavailable (the host has not registered the falling-ts-web-ding namespace).",
      loading: "Loading…",
      enable: "Enabled",
      volume: "Volume",
      freq: "Tone frequency (Hz)",
      decay: "Decay time (ms)",
      preview: "Preview",
      playOnce: "Play once",
      questionTitle: "User question appears",
      questionDesc: "Plays a ding when the harness raises a user question (the question card in the browser conversation view), calling you back to answer. Detection runs on the browser DOM (the QuestionComposer data-question-key anchor); the host takes no part.",
      turnEndTitle: "Turn ended",
      turnEndDesc: "Plays a ding when the agent's turn ends (agent/status becomes idle). The host only signals the idle transition; the browser synthesizes the sound.",
      subagentEnable: "Also ding for sub-agents",
      subagentEnableDesc: "Whether a delegated sub-agent finishing also dings. Off by default: a parent that fans out to N children produces N+1 completion events, and the extra N are noise if you stepped away. When on, the parent still dings again (main tone) when it wraps up.",
      subagentDistinct: "Separate tone for sub-agents",
      subagentDistinctDesc: "Give sub-agents their own tone (an octave lower by default) so you can hear whether this is intermediate progress or the whole task finishing. Off reuses the main tone.",
      subagentBadge: "Sub-agent",
      subagentToast: "A sub-agent finished its turn — the browser played a ding.",
      subagentToneTitle: "Sub-agent tone",
      previewMain: "Preview (main tone)",
      subagentPreview: "Preview (sub-agent tone)",
      previewCompare: "Compare tones",
      autoplayNote: "Browser autoplay policy: sound starts only after your first interaction with the page (click or keypress) or after clicking either Preview.",
      toastBody: "The agent finished its turn — the browser played a ding.",
      doneTitle: "{title} — done",
      emptyList: "No turn-end messages yet",
      drawerTitle: "Turn-end messages",
      clearAll: "Delete all",
      deleteWord: "Delete",
      sessionLabel: "Session {id}…",
      unitHz: "{value} Hz",
      unitMs: "{value} ms",
    };
    const ja = {
      nav: "通知音の設定",
      intro: "2 つの場面それぞれに通知音があり、ブラウザの Web Audio API だけで合成します——ホストは音を鳴らさず、Windows／システム通知も出しません。設定は profile の cordis.patch.yml(falling-ts-web-ding セクション)に保存されます。",
      unavailable: "設定を利用できません(ホスト側で falling-ts-web-ding 名前空間が登録されていません)。",
      loading: "読み込み中…",
      enable: "有効",
      volume: "音量",
      freq: "音色の周波数(Hz)",
      decay: "減衰時間(ms)",
      preview: "試聴",
      playOnce: "1 回鳴らす",
      questionTitle: "ユーザーへの質問が出たとき",
      questionDesc: "harness がユーザーへの質問(ブラウザの会話ビューに出る質問カード)を表示したときに「チン」と鳴らし、回答へ戻るきっかけを作ります。検出はブラウザの DOM(QuestionComposer の data-question-key アンカー)で行い、ホスト側は関与しません。",
      turnEndTitle: "ターン終了時",
      turnEndDesc: "agent のターンが終了したとき(agent/status が idle へ遷移)に「チン」と鳴らします。ホストは idle 遷移のシグナルだけを出し、音はブラウザが合成します。",
      subagentEnable: "サブ agent 完了時も通知",
      subagentEnableDesc: "委任したサブ agent が終わったときも鳴らすかどうか。既定はオフ:親が N 個の子に分岐すると完了イベントは N+1 回になり、離席中のあなたには余分な N 回がノイズになります。オンでも、親自身の完了時に改めて鳴ります(主音)。",
      subagentDistinct: "サブ agent は別の音色",
      subagentDistinctDesc: "サブ agent に主音とは別の音色(既定は 1 オクターブ下)を与え、「途中経過」か「全体完了」かを聞き分けられるようにします。オフなら主音を再利用します。",
      subagentBadge: "サブ agent",
      subagentToast: "サブ agent がターンを終えました——ブラウザが「チン」と鳴らしました。",
      subagentToneTitle: "サブ agent の音色",
      previewMain: "試聴（主音）",
      subagentPreview: "試聴（サブ agent 音）",
      previewCompare: "音色を比べる",
      autoplayNote: "ブラウザの自動再生ポリシー:ページを最初に操作する(クリック／キー入力)か、いずれかの試聴をクリックした後でないと音は鳴りません。",
      toastBody: "agent がターンを終了しました——ブラウザが「チン」と鳴らしました。",
      doneTitle: "{title} が完了しました",
      emptyList: "ターン終了メッセージはまだありません",
      drawerTitle: "ターン終了メッセージ",
      clearAll: "すべて削除",
      deleteWord: "削除",
      sessionLabel: "セッション {id}…",
      unitHz: "{value} Hz",
      unitMs: "{value} ms",
    };
    const ko = {
      nav: "알림음 설정",
      intro: "두 상황마다 각자의 알림음이 있고, 브라우저의 Web Audio API만으로 합성합니다——호스트는 소리를 내지 않고 Windows/시스템 알림도 띄우지 않습니다. 설정은 profile의 cordis.patch.yml(falling-ts-web-ding 섹션)에 저장됩니다.",
      unavailable: "설정을 사용할 수 없습니다(호스트에서 falling-ts-web-ding 네임스페이스를 등록하지 않았습니다).",
      loading: "불러오는 중…",
      enable: "사용",
      volume: "음량",
      freq: "음색 주파수(Hz)",
      decay: "감쇠 시간(ms)",
      preview: "미리 듣기",
      playOnce: "한 번 재생",
      questionTitle: "사용자 질문이 뜰 때",
      questionDesc: "harness가 사용자 질문(브라우저 대화 영역의 질문 카드)을 띄울 때 '딩' 소리를 내어 답하러 돌아오게 합니다. 감지는 브라우저 DOM(QuestionComposer의 data-question-key 앵커)에서 하고 호스트는 관여하지 않습니다.",
      turnEndTitle: "턴 종료 시",
      turnEndDesc: "agent의 턴이 끝날 때(agent/status가 idle로 전환) '딩' 소리를 냅니다. 호스트는 idle 전환 신호만 보내고 소리는 브라우저가 합성합니다.",
      subagentEnable: "하위 agent 완료 시에도 알림",
      subagentEnableDesc: "위임된 하위 agent가 끝날 때도 소리를 낼지 여부. 기본은 꺼짐: 부모가 N개의 자식으로 분기하면 완료 이벤트가 N+1번 발생하고, 자리를 비운 당신에게 추가 N번은 소음입니다. 켜도 부모가 마무리될 때 다시 울립니다(주 음).",
      subagentDistinct: "하위 agent는 별개 음색",
      subagentDistinctDesc: "하위 agent에 주 음과 다른 음색(기본 한 옥타브 아래)을 주어, 이것이 중간 진행인지 전체 완료인지 들으로 구분하게 합니다. 끄면 주 음을 재사용합니다.",
      subagentBadge: "하위 agent",
      subagentToast: "하위 agent가 턴을 마쳤습니다——브라우저가 '딩' 소리를 재생했습니다.",
      subagentToneTitle: "하위 agent 음색",
      previewMain: "미리 듣기(주 음)",
      subagentPreview: "미리 듣기(하위 agent 음)",
      previewCompare: "음색 비교",
      autoplayNote: "브라우저 자동 재생 정책: 페이지를 처음 조작하거나(클릭/키 입력) 아무 미리 듣기나 클릭한 뒤에야 소리가 납니다.",
      toastBody: "agent가 턴을 마쳤습니다——브라우저가 '딩' 소리를 재생했습니다.",
      doneTitle: "{title} 완료",
      emptyList: "아직 턴 종료 메시지가 없습니다",
      drawerTitle: "턴 종료 메시지",
      clearAll: "전체 삭제",
      deleteWord: "삭제",
      sessionLabel: "세션 {id}…",
      unitHz: "{value} Hz",
      unitMs: "{value} ms",
    };

    /**
     * 把本插件贡献的语言(ja / ko)注册进 locale 目录。
     *
     * 上游只内置 zh / en(LOCALE_IDS 为 ['zh','en']);'ja'/'ko' 这类 id 是**语言包
     * 插件**的扩展点:addLanguage 会把它们加进设置页「语言」下拉,并让浏览器语言
     * 探测(先精确匹配、再按主语言子标签匹配)命中它们。label 用该语言自述,
     * fallback 必须已注册且以 en 为终点——这里直接落到内置的 en。
     *
     * 幂等容错:dsh-force-compact 也贡献同样的两种语言(两个插件必须各自能独立
     * 安装,不能约定只由其中一个注册)。先到者拥有该目录项,后到者命中
     * "already registered" 而让位——字典仍按 id 生效,只是该语言目录项的生存期
     * 不归本插件所有。返回的 disposer 只撤销本插件真正添加的那几项。
     * @param {object} locale - ctx.locale(LocaleRuntime)。
     * @returns {() => void} 撤销本插件添加的语言目录项。
     */
    function contributeLanguages(locale) {
      const owned = [];
      const languages = [
        { id: "ja", label: "日本語", fallback: "en" },
        { id: "ko", label: "한국어", fallback: "en" },
      ];
      for (const lang of languages) {
        try {
          owned.push(locale.addLanguage(lang));
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          if (!/is already registered/.test(message)) throw error;
        }
      }
      return () => { for (const dispose of owned) dispose(); };
    }

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
    /**
     * 用户手势预热:创建 AudioContext 并 resume,解除自动播放静音。
     *
     * 此前是 `{ once: true }` 的冒泡阶段监听。两处都不够稳:
     * ① 一次性 —— 第一次手势若发生在本模块求值之前(页面刚加载、客户端包还在组装),
     *    监听器当时还没挂上,这一枪就永久打空了;此后 AudioContext 只能由信号路径
     *    在**手势之外**惰性创建,状态停在 `suspended`,浏览器策略下 `resume()` 不会生效
     *    → 提示音全程静音(而 toast/消息缓存照常出现,症状是"只有声音不响")。
     * ② 冒泡阶段 —— 宿主 UI 的键盘/指针处理里若有 `stopPropagation()`,原生事件到不了
     *    window,监听器永不触发(实测本机 workspace 的 composer 不吞,但这是外部依赖)。
     * 现在改为:**捕获阶段**挂多种手势,且**不一次性**;已经在运行时直接短路(每次手势
     * 只是一次字符串比较),未运行时才 resume,故任何一次后续手势都能补上解锁。
     */
    function warmup() {
      const a = ensureAudio();
      if (a && a.ctx.state !== "running") {
        void a.ctx.resume().catch(() => {});
      }
    }
    /**
     * 手势类型表。注册与撤销必须用同一个 capture 取值,否则撤销不生效。
     */
    const UNLOCK_GESTURES = ["pointerdown", "mousedown", "keydown", "click", "touchstart", "focus"];
    /**
     * 注册解锁监听器并归还撤销函数。**由 `apply` 里的 `ctx.effect` 调用**,不在工厂
     * 求值期安装:工厂必须无副作用,监听器是 apply 拥有的资源,插件卸载时随 effect
     * 撤销(ui-plugin.md)。"不一次性"的性质与所有权无关——插件存活期间任何一次手势
     * 都还能补上解锁,这才是防"首次手势打空"的关键。
     * @returns {(() => void)|undefined} 撤销函数;无 window 时 undefined。
     */
    function installUnlockListeners() {
      if (typeof window === "undefined") return undefined;
      for (const type of UNLOCK_GESTURES) {
        window.addEventListener(type, warmup, { capture: true, passive: true });
      }
      return () => {
        if (typeof window.removeEventListener !== "function") return;
        for (const type of UNLOCK_GESTURES) {
          window.removeEventListener(type, warmup, { capture: true });
        }
      };
    }
    /**
     * 播放一声"叮"。
     *
     * 未解锁(`suspended`)时先 `resume()`、**成功后再按当时的时间轴排程**:挂起期间
     * `currentTime` 是冻结的,此刻排程只会把这一声压到"以后某次 resume 的瞬间"才迟到
     * 播放(甚至永不播放)——那正是"信号到了、toast 弹了,却没声音"的形态。
     * 已 `running` 时立即排程,零延迟,手感与本改动前一致。
     * @param {{volume?: number, freq?: number, decayMs?: number}} opts
     * @returns {boolean} 是否成功调度(不支持 Web Audio 时返回 false)
     */
    function playDing(opts) {
      const o = opts || {};
      const a = ensureAudio();
      if (!a) return false;
      const ctx = a.ctx;
      const volume = Math.min(1, Math.max(0, Number(o.volume) || 0.7));
      const freq = Math.min(4000, Math.max(80, Number(o.freq) || 880));
      const decay = Math.min(4000, Math.max(100, Number(o.decayMs) || 900)) / 1000;
      const scheduleDing = () => {
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
      };
      if (ctx.state === "running") return scheduleDing();
      // resume 被拒(无用户手势的浏览器策略)= 保持静音,等下一次手势补解锁;绝不抛出。
      void ctx.resume().then(scheduleDing, () => {});
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
    /** 记录一条"回合结束"消息(同一 at 只记一次)。title 为会话标题(信号未携带时省略)。
     * `subagent` 标记该条来自被委派的子 agent(而非你在看的根会话)。 */
    function recordTurnEnd(at, sessionId, title, subagent) {
      const list = loadNotifyCache();
      if (list.some((m) => m.at === at)) return;
      const d = new Date(at);
      const pad = (n) => String(n).padStart(2, "0");
      const timeText = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      list.unshift({
        at,
        timeText,
        sessionId: typeof sessionId === "string" ? sessionId : undefined,
        title: typeof title === "string" && title.trim() ? title : undefined,
        ...(subagent === true ? { subagent: true } : {}),
      });
      if (list.length > NOTIFY_CAP) list.length = NOTIFY_CAP;
      saveNotifyCache();
      emitNotifyChange();
    }
    /** 删除单条"回合结束"消息(按 at 匹配)。 */
    function removeRecord(at) {
      const list = loadNotifyCache();
      const next = list.filter((m) => m.at !== at);
      if (next.length === list.length) return;
      notifyCache = next;
      saveNotifyCache();
      emitNotifyChange();
    }
    /** 清空全部"回合结束"消息。 */
    function clearAllRecords() {
      if (!loadNotifyCache().length) return;
      notifyCache = [];
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
        position: "fixed", right: "20px", bottom: "20px", zIndex: 2147483000,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "12px",
        pointerEvents: "none",
      });
      document.body.appendChild(toastLayer);
      return toastLayer;
    }
    function dismissToast(el) {
      el.style.transition = "opacity 0.22s ease, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)";
      el.style.opacity = "0";
      el.style.transform = "translateX(28px) scale(0.97)";
      window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
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
        pointerEvents: "auto", position: "relative", width: 360, minHeight: 88,
        background: "rgba(255,255,255,0.88)", backdropFilter: "blur(20px) saturate(1.5)",
        WebkitBackdropFilter: "blur(20px) saturate(1.5)",
        border: "1px solid rgba(0,0,0,0.05)", borderRadius: 16,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 6px 16px rgba(0,0,0,0.08), 0 20px 48px rgba(0,0,0,0.14)",
        overflow: "hidden",
        display: "flex", alignItems: "stretch", cursor: "pointer",
        opacity: "0", transform: "translateX(28px) scale(0.97)",
        transition: "opacity 0.22s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif",
        color: "#1f1f1f", fontSize: 13,
      });
      const accent = document.createElement("div");
      Object.assign(accent.style, {
        width: 4, flexShrink: 0, background: "#0078d4",
      });
      const body = document.createElement("div");
      Object.assign(body.style, { padding: "17px 18px 16px", minWidth: 0 });
      const head = document.createElement("div");
      Object.assign(head.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      });
      const title = document.createElement("span");
      title.textContent = tr("turnEndTitle");
      Object.assign(title.style, { fontSize: 14, fontWeight: 600, letterSpacing: 0.2 });
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      Object.assign(closeBtn.style, {
        border: "none", background: "transparent", cursor: "pointer",
        fontSize: 17, lineHeight: 1, padding: "4px 8px", borderRadius: 8,
        color: "rgba(0,0,0,0.55)", transition: "background 0.15s ease",
      });
      closeBtn.addEventListener("mouseenter", () => { closeBtn.style.background = "rgba(0,0,0,0.06)"; });
      closeBtn.addEventListener("mouseleave", () => { closeBtn.style.background = "transparent"; });
      closeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        window.clearTimeout(el._timer);
        dismissToast(el);
      });
      head.appendChild(title);
      head.appendChild(closeBtn);
      const text = document.createElement("div");
      // 子 agent 的完成用另一句文案,并加一枚角标,和主会话收尾区分开。
      const subLabel = msg.subagent === true ? tr("subagentBadge") : undefined;
      text.textContent = subLabel !== undefined
        ? "[" + subLabel + "] " + (msg.title ? tr("doneTitle", { title: msg.title }) : tr("subagentToast"))
        : (msg.title ? tr("doneTitle", { title: msg.title }) : tr("toastBody"));
      Object.assign(text.style, { marginTop: 10, lineHeight: 1.65, color: "rgba(0,0,0,0.66)" });
      const foot = document.createElement("div");
      foot.textContent = timeText;
      Object.assign(foot.style, { marginTop: 12, fontSize: 12, color: "rgba(0,0,0,0.48)" });
      body.appendChild(head);
      body.appendChild(text);
      body.appendChild(foot);
      el.appendChild(accent);
      el.appendChild(body);
      layer.appendChild(el);
      void el.offsetHeight; // force reflow → 触发进入动画
      el.style.opacity = "1";
      el.style.transform = "translateX(0) scale(1)";
      el._timer = window.setTimeout(() => dismissToast(el), 6000);
      el.addEventListener("click", () => {
        window.clearTimeout(el._timer);
        openNotifyDrawer();
      });
      return el;
    }

    // ── 右侧消息列表面板(点击 toast 展开;纯前端 DOM,零资产) ------------------
    // 覆盖层 + 右侧滑入面板:列出缓存里的回合结束消息(时间、会话摘要),空态
    // 提示;通过 subscribeNotify 订阅缓存变更实时重绘。点击遮罩或 × 关闭。
    let drawerHost = null;
    let drawerUnsub = null;
    function closeNotifyDrawer() {
      if (drawerUnsub) { drawerUnsub(); drawerUnsub = null; }
      if (!drawerHost || !document.body.contains(drawerHost)) { drawerHost = null; return; }
      const overlay = drawerHost;
      const panel = overlay._panel;
      panel.style.transform = "translateX(100%)";
      overlay.style.opacity = "0";
      window.setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (drawerHost === overlay) drawerHost = null;
      }, 300);
    }
    function renderDrawerList(container) {
      container.textContent = "";
      const list = loadNotifyCache();
      if (!list.length) {
        const empty = document.createElement("div");
        empty.textContent = tr("emptyList");
        Object.assign(empty.style, {
          padding: "56px 20px", textAlign: "center",
          color: "rgba(0,0,0,0.42)", fontSize: 13, lineHeight: 1.6,
        });
        container.appendChild(empty);
        return;
      }
      list.forEach((m) => {
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 16px", borderRadius: 12,
          marginBottom: 6, cursor: "default",
          background: "rgba(0,0,0,0)", transition: "background 0.16s ease",
        });
        row.addEventListener("mouseenter", () => { row.style.background = "rgba(0,0,0,0.045)"; });
        row.addEventListener("mouseleave", () => { row.style.background = "rgba(0,0,0,0)"; });
        const info = document.createElement("div");
        Object.assign(info.style, { flex: 1, minWidth: 0 });
        const timeEl = document.createElement("div");
        timeEl.textContent = m.timeText;
        Object.assign(timeEl.style, { fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" });
        const subEl = document.createElement("div");
        const subPrefix = m.subagent === true ? "[" + tr("subagentBadge") + "] " : "";
        subEl.textContent = subPrefix + (m.title ? tr("doneTitle", { title: m.title })
          : (m.sessionId ? tr("sessionLabel", { id: String(m.sessionId).slice(0, 12) }) : tr("turnEndTitle")));
        Object.assign(subEl.style, { fontSize: 12.5, color: "rgba(0,0,0,0.5)", marginTop: 4 });
        info.appendChild(timeEl);
        info.appendChild(subEl);
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = tr("deleteWord");
        Object.assign(del.style, {
          border: "1px solid rgba(0,0,0,0.14)", background: "transparent",
          borderRadius: 8, padding: "5px 12px", cursor: "pointer",
          fontSize: 12.5, color: "rgba(0,0,0,0.6)", flexShrink: 0,
          transition: "background 0.16s ease, border-color 0.16s ease",
        });
        del.addEventListener("mouseenter", () => {
          del.style.background = "rgba(0,0,0,0.06)";
          del.style.borderColor = "rgba(0,0,0,0.26)";
        });
        del.addEventListener("mouseleave", () => {
          del.style.background = "transparent";
          del.style.borderColor = "rgba(0,0,0,0.14)";
        });
        del.addEventListener("click", (ev) => { ev.stopPropagation(); removeRecord(m.at); });
        row.appendChild(info);
        row.appendChild(del);
        container.appendChild(row);
      });
    }
    function openNotifyDrawer() {
      if (drawerHost && document.body.contains(drawerHost)) { closeNotifyDrawer(); return; }
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed", inset: 0, zIndex: 2147483001,
        background: "rgba(0,0,0,0.36)",
        pointerEvents: "auto", opacity: 0,
        transition: "opacity 0.2s ease",
      });
      overlay.addEventListener("click", closeNotifyDrawer);
      const panel = document.createElement("div");
      Object.assign(panel.style, {
        position: "absolute", top: 0, right: 0, height: "100%", width: 400, maxWidth: "94vw",
        background: "rgba(255,255,255,0.94)",
        backdropFilter: "blur(24px) saturate(1.5)",
        WebkitBackdropFilter: "blur(24px) saturate(1.5)",
        boxShadow: "-2px 0 6px rgba(0,0,0,0.04), -10px 0 32px rgba(0,0,0,0.10), -32px 0 80px rgba(0,0,0,0.12)",
        transform: "translateX(100%)",
        transition: "transform 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
        display: "flex", flexDirection: "column",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif",
        color: "#1f1f1f",
      });
      const header = document.createElement("div");
      Object.assign(header.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 20px 16px", borderBottom: "1px solid rgba(0,0,0,0.07)",
        flexShrink: 0,
      });
      const titleEl = document.createElement("span");
      titleEl.textContent = tr("drawerTitle");
      Object.assign(titleEl.style, { fontSize: 16, fontWeight: 700, letterSpacing: 0.2 });
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.textContent = tr("clearAll");
      Object.assign(clearBtn.style, {
        border: "1px solid rgba(0,0,0,0.14)", background: "transparent",
        borderRadius: 8, padding: "5px 12px", cursor: "pointer",
        fontSize: 12.5, color: "rgba(0,0,0,0.6)",
        transition: "background 0.16s ease, border-color 0.16s ease",
      });
      clearBtn.addEventListener("mouseenter", () => {
        clearBtn.style.background = "rgba(0,0,0,0.06)";
        clearBtn.style.borderColor = "rgba(0,0,0,0.26)";
      });
      clearBtn.addEventListener("mouseleave", () => {
        clearBtn.style.background = "transparent";
        clearBtn.style.borderColor = "rgba(0,0,0,0.14)";
      });
      clearBtn.addEventListener("click", (ev) => { ev.stopPropagation(); clearAllRecords(); });
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      Object.assign(closeBtn.style, {
        border: "none", background: "transparent", cursor: "pointer",
        fontSize: 19, lineHeight: 1, padding: "4px 9px", borderRadius: 8,
        color: "rgba(0,0,0,0.55)", transition: "background 0.15s ease",
      });
      closeBtn.addEventListener("mouseenter", () => { closeBtn.style.background = "rgba(0,0,0,0.06)"; });
      closeBtn.addEventListener("mouseleave", () => { closeBtn.style.background = "transparent"; });
      closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); closeNotifyDrawer(); });
      const headerActions = document.createElement("div");
      Object.assign(headerActions.style, { display: "flex", alignItems: "center", gap: 8 });
      headerActions.appendChild(clearBtn);
      headerActions.appendChild(closeBtn);
      header.appendChild(titleEl);
      header.appendChild(headerActions);
      const listEl = document.createElement("div");
      Object.assign(listEl.style, { flex: 1, overflowY: "auto", padding: "10px 12px 14px" });
      panel.appendChild(header);
      panel.appendChild(listEl);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      overlay._panel = panel;
      drawerHost = overlay;
      renderDrawerList(listEl);
      drawerUnsub = subscribeNotify(() => renderDrawerList(listEl));
      void overlay.offsetHeight;
      overlay.style.opacity = "1";
      panel.style.transform = "translateX(0)";
    }

// ── 命名空间快照 → 信号检测 → 播放 ------------------------------------------
    // lastAt:本页面最后响应过的 signal.at;null = 还没观察到首帧。
    // 首帧语义(2026-09-30 修正):页面**打开前**已存在的残留 done 信号只做基线、不播;
    // 但"这个命名空间里从来没有过 signal"(全新 home、从未跑过回合)时基线取 0 —— 旧实现
    // 一律把首帧信号当残留吞掉,于是**本安装的第一声 done 不响**,要到第二次回合结束才响
    // (真浏览器复现:3099 全新 home 上写完 signal 后振荡器计数仍是 0)。
    let lastAt = null;
    function maybePlayFromValue(value) {
      if (!value || typeof value !== "object") return;
      const sig = value.signal;
      const isDone = !!sig && typeof sig === "object" && sig.phase === "done";
      if (lastAt === null) {
        // 首帧:有残留就以残留为界(它不播);没有残留就从 0 起算,好让下一次 done 必播。
        lastAt = isDone && typeof sig.at === "number" ? sig.at : 0;
        if (isDone) return;
      }
      if (!isDone) return;
      const at = typeof sig.at === "number" ? sig.at : 0;
      if (!(at > lastAt)) return;
      lastAt = at;
      if (value.turnEndEnabled !== false) {
        // 子 agent 回合结束:选它的专属音色(默认关闭、默认同主音),否则用主音。
        const isSub = sig.subagent === true;
        const distinct = isSub && value.subagentDistinctTone === true;
        playDing(distinct
          ? { volume: value.subagentVolume, freq: value.subagentFreq, decayMs: value.subagentDecayMs }
          : { volume: value.turnEndVolume, freq: value.turnEndFreq, decayMs: value.turnEndDecayMs });
        const sessionId = typeof sig.sessionId === "string" ? sig.sessionId : undefined;
        // 标题随信号一起来:Host 半部在 idle 转变时读 sessionProjections 的 title
        // 投影并写进 signal。客户端因此**不再**发任何 RPC(自铸 rpcId 取 session/list
        // 的写法已删除)——传输归 Connection,本半部只镜像本命名空间。
        const title = typeof sig.title === "string" && sig.title.trim() !== "" ? sig.title : undefined;
        recordTurnEnd(at, sessionId, title, isSub);
        showTurnEndToast({ at, sessionId, title, subagent: isSub });
      }
    }

    // ── 弹出用户选择检测(DOM 锚点 [data-question-key],纯前端)────────────────────
    // harness 的用户选择题(ask_user_question)在对话区由 QuestionComposer 渲染,根
    // 节点带稳定的 data-question-key 属性(CSS Modules 类名是哈希的,不可用——与
    // TurnStatus 用 role/aria 识别同思路)。宿主半部看不到 question/requested 帧
    // (那走 connection 层 MuxFrame,Host 插件不可订阅),所以这一块完全在浏览器侧
    // 完成:MutationObserver 观察新出现的 [data-question-key] 节点,首次出现即播
    // 放 Block 1(弹出用户选择)的那声"叮"。非 timer、无持久态,同 lastAt 首帧
    // 基线语义:加载时已存在的 key 只记不响,之后新弹出的 key 才响。
    let seenQuestionKeys = new Set();   // 已响应过的 question key(去重,防重复响)
    let questionObserver = null;        // DOM 观察器(非 timer)
    let questionValueRef = null;        // 最新快照引用,供 observer 回调读取
    function maybePlayQuestionFromDom(value) {
      if (typeof document === "undefined") return;
      const nodes = document.querySelectorAll('[data-question-key]');
      if (nodes.length === 0) return;
      const v = (value && typeof value === "object") ? value : {};
      const enabled = v.questionEnabled !== false;
      for (const el of nodes) {
        const key = el.getAttribute("data-question-key");
        if (!key || seenQuestionKeys.has(key)) continue;
        seenQuestionKeys.add(key);
        if (enabled) {
          playDing({ volume: v.questionVolume, freq: v.questionFreq, decayMs: v.questionDecayMs });
        }
      }
    }
    function installQuestionObserver(value) {
      if (questionObserver || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
      // 基线:先记下当前已存在的 key(不响),之后新 key 才响(同 lastAt 首帧语义)。
      const nodes = document.querySelectorAll('[data-question-key]');
      for (const el of nodes) {
        const key = el.getAttribute("data-question-key");
        if (key) seenQuestionKeys.add(key);
      }
      questionObserver = new MutationObserver(() => maybePlayQuestionFromDom(questionValueRef));
      questionObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ── 设置分区 UI --------------------------------------------------------------
    /**
     * 主题感知的颜色别名（浅色 / 暗色两套）。与 dsh-force-compact 注入的规则**逐字相同**
     * （同一份 `--fcts-` 工作区命名空间；两者都按元素 id 幂等，谁先注入都一样）。
     *
     * 本插件是 plain JS、无构建步骤，组件用内联 style 而非 CSS Module，但内联 style 里的
     * var() 照样沿 DOM 继承解析，所以：样式表只定义变量，组件只引用 `var(--fcts-*)`。
     *
     * - **浅色**：逐个取改动前的字面值（`rgba(0,0,0,…)` 系），浅色外观逐字节不变。
     * - **暗色**（选择器 `body[data-ds-dark-theme]`，官方 ui-theme 切主题时打的属性）：
     *   改指上游语义别名。**说明文字取 `--dsw-alias-label-primary`**——暗色下解析为
     *   `rgb(249,250,251)`（纯白）；分隔/边框取 `border-l*`。官方主题包按肤定义这些别名
     *   （packages/client/ui-theme/src/styles/design-platform.css），随主题自动翻转。
     *
     * 注意：toast 与右侧消息面板是**浮层通知**，刻意保持 Win11 风格的浅色玻璃质感
     * （白底深字），两种主题下都可读，故不走这套设置区别名。
     */
    const THEME_TOKENS_CSS = [
      "body{",
      "--fcts-text-hint:rgba(0,0,0,0.45);",
      "--fcts-text-muted:rgba(0,0,0,0.55);",
      "--fcts-text-body:rgba(0,0,0,0.65);",
      "--fcts-line:rgba(0,0,0,0.08);",
      "--fcts-line-soft:rgba(0,0,0,0.18);",
      "--fcts-line-strong:rgba(0,0,0,0.22);",
      "--fcts-fill-subtle:rgba(0,0,0,0.14);",
      "--fcts-fill-off:rgba(0,0,0,0.16);",
      "--fcts-fill-off-hover:rgba(0,0,0,0.24);",
      "--fcts-fill-hover:rgba(0,0,0,0.06);",
      "}",
      "body[data-ds-dark-theme]{",
      "--fcts-text-hint:var(--dsw-alias-label-primary);",
      "--fcts-text-muted:var(--dsw-alias-label-secondary);",
      "--fcts-text-body:var(--dsw-alias-label-secondary);",
      "--fcts-line:var(--dsw-alias-border-l2);",
      "--fcts-line-soft:var(--dsw-alias-border-l2);",
      "--fcts-line-strong:var(--dsw-alias-border-l3);",
      "--fcts-fill-subtle:var(--dsw-alias-border-l3);",
      "--fcts-fill-off:var(--dsw-alias-interactive-bg-active);",
      "--fcts-fill-off-hover:var(--dsw-alias-interactive-bg-hover-accent);",
      "--fcts-fill-hover:var(--dsw-alias-interactive-bg-hover);",
      "}",
    ].join("");

    /**
     * 确保主题别名样式表已挂在 <head>（幂等，至多一次）。
     * @returns void
     */
    function ensureThemeTokensInlined() {
      if (typeof document === "undefined") return;
      if (document.getElementById("falling-ts-theme-tokens")) return;
      const el = document.createElement("style");
      el.id = "falling-ts-theme-tokens";
      el.textContent = THEME_TOKENS_CSS;
      document.head.appendChild(el);
    }

    const divider = "var(--fcts-line)";
    const hintColor = "var(--fcts-text-hint)";
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
    const buttonStyle = { padding: "6px 14px", borderRadius: 8, border: "1px solid var(--fcts-line-strong)", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 500 };
    const inputRangeStyle = { flex: 1, minWidth: 140 };

    /**
     * 缓冲滑块(React state 本地缓冲,最流畅):拖动期间 onChange 只更新本地 state
     * (仅重渲染这一个 input + 显示值,不写设置、不触发 document-updated 广播),
     * 松手(mouseup/touchend)/失焦(blur)/键盘结束(keyup)时才提交一次 scope.set。
     * 原实现 onChange 每动一格都 update → 配置写盘 + 全量广播 + 整块面板
     * 重渲染,所以拖动卡。
     * @param {{fieldKey:string, labelText:string, min:number, max:number, step:number,
     *   value:number, disabled:boolean, display:(n:number)=>string, onSubmit:(n:number)=>void}} props
     */
    function BufferedSlider(props) {
      const [v, setV] = React.useState(Number.isFinite(Number(props.value)) ? Number(props.value) : 0);
      // 外部值变化(另一标签/外部编辑)时同步进本地缓冲。拖动中 onChange 只 setV
      // 不写盘,props.value 不变,此 effect 不会打断拖动;提交后值已一致,幂等。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => { setV(Number.isFinite(Number(props.value)) ? Number(props.value) : 0); }, [props.value]);
      const commit = () => props.onSubmit(v);
      return h("div", { style: rowStyle },
        h("span", { style: labelStyle }, props.labelText),
        h("span", { style: controlStyle },
          h("input", {
            type: "range",
            min: props.min, max: props.max, step: props.step,
            value: v,
            disabled: props.disabled,
            style: inputRangeStyle,
            // 拖动中:只更新本地 state(不写盘)。React 对 range 的 onChange 即 input
            // 事件,随拖动连续触发——现在每次只是 setState,不重渲染整块面板。
            onChange: (ev) => setV(Number(ev.target.value)),
            // 松手 / 失焦 / 键盘操作结束时才提交一次。
            onMouseUp: commit,
            onTouchEnd: commit,
            onBlur: commit,
            onKeyUp: commit,
          }),
          h("span", { style: valueStyle }, props.display(v))),
      );
    }

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
          h("h2", { style: titleStyle }, tr("nav")),
          h("p", { style: ph }, tr("unavailable")));
      }
      if (snap.status === "loading" || value === undefined) {
        return h("div", { style: wrapStyle },
          h("h2", { style: titleStyle }, tr("nav")),
          h("p", { style: ph }, tr("loading")));
      }
      const disabled = !snap.writable;
      const v = (value && typeof value === "object") ? value : {};
      const pct = (n) => Math.round((Number(n) || 0) * 100) + "%";
      // 两块配置,共用模板:第一块"弹出用户选择"(question),第二块"回合结束"(turnEnd)。
      const block = (blk, title, desc, previewBtn) => {
        const E = "question" === blk ? "questionEnabled" : "turnEndEnabled";
        const Vol = "question" === blk ? "questionVolume" : "turnEndVolume";
        const Freq = "question" === blk ? "questionFreq" : "turnEndFreq";
        const Decay = "question" === blk ? "questionDecayMs" : "turnEndDecayMs";
        // 预览行文案按块区分:回合结束块标明这是主音,和下面的子 agent 音预览区分开。
        const previewLabel = "turnEnd" === blk ? tr("previewMain") : tr("preview");
        // 子 agent 预览播的是“实际会响的声音”:独立音色开着才用子音参数,
        // 否则子 agent 本来就复用主音,预览也播主音,不骗耳朵。
        const subTone = () => (v.subagentDistinctTone === true
          ? { volume: v.subagentVolume, freq: v.subagentFreq, decayMs: v.subagentDecayMs }
          : { volume: v.turnEndVolume, freq: v.turnEndFreq, decayMs: v.turnEndDecayMs });
        return [
          h("h2", { key: blk + "-title", style: titleStyle }, title),
          h("p", { key: blk + "-intro", style: introStyle }, desc),
          h("div", { key: blk + "-enabled", style: rowStyle },
            h("span", { style: labelStyle }, tr("enable")),
            h("span", { style: controlStyle },
              h("input", {
                type: "checkbox",
                checked: v[E] !== false,
                disabled: disabled,
                onChange: (ev) => update(E, ev.target.checked),
              })),
          ),
          h(BufferedSlider, { key: blk + "-vol", labelText: tr("volume"), min: 0, max: 1, step: 0.05, value: Number(v[Vol]) || 0.7, disabled: disabled, display: pct, onSubmit: (n) => update(Vol, n) }),
          h(BufferedSlider, { key: blk + "-freq", labelText: tr("freq"), min: 120, max: 2000, step: 10, value: Number(v[Freq]) || 880, disabled: disabled, display: (n) => tr("unitHz", { value: Math.round(n) }), onSubmit: (n) => update(Freq, n) }),
          h(BufferedSlider, { key: blk + "-decay", labelText: tr("decay"), min: 100, max: 2000, step: 50, value: Number(v[Decay]) || 900, disabled: disabled, display: (n) => tr("unitMs", { value: Math.round(n) }), onSubmit: (n) => update(Decay, n) }),
          h("div", { key: blk + "-preview", style: lastRowStyle },
            h("span", { style: labelStyle }, previewLabel),
            h("span", { style: controlStyle },
              h("button", { style: buttonStyle, disabled: disabled, onClick: previewBtn }, tr("playOnce"))),
          ),
          // 子 agent 开关组:只在第二块(回合结束)里出现。
          ...(blk === "turnEnd" ? [
            h("div", { key: blk + "-sub-enable", style: rowStyle },
              h("span", { style: labelStyle }, tr("subagentEnable")),
              h("span", { style: controlStyle },
                h("input", {
                  type: "checkbox",
                  checked: v.subagentEnabled === true,
                  disabled: disabled,
                  onChange: (ev) => update("subagentEnabled", ev.target.checked),
                })),
            ),
            h("p", { key: blk + "-sub-enable-desc", style: { gridColumn: "1 / 3", color: hintColor, fontSize: 12, lineHeight: 1.55, margin: "0 0 6px" } },
              tr("subagentEnableDesc")),
            h("div", { key: blk + "-sub-distinct", style: rowStyle },
              h("span", { style: labelStyle }, tr("subagentDistinct")),
              h("span", { style: controlStyle },
                h("input", {
                  type: "checkbox",
                  checked: v.subagentDistinctTone === true,
                  disabled: disabled || v.subagentEnabled !== true,
                  onChange: (ev) => update("subagentDistinctTone", ev.target.checked),
                })),
            ),
            h("p", { key: blk + "-sub-distinct-desc", style: { gridColumn: "1 / 3", color: hintColor, fontSize: 12, lineHeight: 1.55, margin: "0 0 6px" } },
              tr("subagentDistinctDesc")),
            // 音色组只在"子 agent 真的会响"时才有意义:总闸(subagentEnabled)关着时
            // 子 agent 一律静音,再展示音色滑杆只会让人以为它生效。此前只看
            // subagentDistinctTone,于是"先勾启用→再勾独立音色→取消启用"会留下
            // {enabled:false, distinct:true} 的搁浅态,并照常渲染整个音色区。
            ...(v.subagentEnabled === true && v.subagentDistinctTone === true ? [
              h("h3", { key: blk + "-sub-tone-title", style: { gridColumn: "1 / 3", fontSize: 13, fontWeight: 600, margin: "6px 0 0" } },
                tr("subagentToneTitle")),
              h(BufferedSlider, { key: blk + "-sub-vol", labelText: tr("volume"), min: 0, max: 1, step: 0.05, value: Number(v.subagentVolume) || 0.7, disabled: disabled, display: pct, onSubmit: (n) => update("subagentVolume", n) }),
              h(BufferedSlider, { key: blk + "-sub-freq", labelText: tr("freq"), min: 120, max: 2000, step: 10, value: Number(v.subagentFreq) || 440, disabled: disabled, display: (n) => tr("unitHz", { value: Math.round(n) }), onSubmit: (n) => update("subagentFreq", n) }),
              h(BufferedSlider, { key: blk + "-sub-decay", labelText: tr("decay"), min: 100, max: 2000, step: 50, value: Number(v.subagentDecayMs) || 900, disabled: disabled, display: (n) => tr("unitMs", { value: Math.round(n) }), onSubmit: (n) => update("subagentDecayMs", n) }),
              h("div", { key: blk + "-sub-preview", style: rowStyle },
                h("span", { style: labelStyle }, tr("subagentPreview")),
                h("span", { style: controlStyle },
                  h("button", { style: buttonStyle, disabled: disabled, onClick: () => play(subTone()) }, tr("playOnce"))),
              ),
              // 对比试听:先主音,隔 0.8s 再子 agent 音——一次点击分辨两种音色。
              // 此行走的是「独立音色已开」的分支:关闭时两种声音本来就相同,整行不渲染,
              // 所以 disabled 只跟随表单可写性,不必再判一次 subagentDistinctTone。
              h("div", { key: blk + "-sub-compare", style: lastRowStyle },
                h("span", { style: labelStyle }, tr("previewCompare")),
                h("span", { style: controlStyle },
                  h("button", { style: buttonStyle, disabled: disabled, onClick: () => {
                    play({ volume: v.turnEndVolume, freq: v.turnEndFreq, decayMs: v.turnEndDecayMs });
                    window.setTimeout(() => play(subTone()), 800);
                  } }, tr("playOnce"))),
              ),
            ] : []),
          ] : []),
        ];
      };
      return h("div", { style: wrapStyle },
        h("h2", { style: { ...titleStyle, fontSize: 16 } }, tr("nav")),
        h("p", { style: introStyle }, tr("intro")),
        ...block("question", tr("questionTitle"),
          tr("questionDesc"),
          () => play({ volume: v.questionVolume, freq: v.questionFreq, decayMs: v.questionDecayMs })),
        ...block("turnEnd", tr("turnEndTitle"),
          tr("turnEndDesc"),
          () => play({ volume: v.turnEndVolume, freq: v.turnEndFreq, decayMs: v.turnEndDecayMs })),
        h("p", { style: { gridColumn: "1 / 3", color: hintColor, fontSize: 12, lineHeight: 1.55 } },
          tr("autoplayNote")));
    }

    /**
     * 注册分区、绑定命名空间、把信号接进播放器。
     * @param {import('@deepseek-ai/cordis').Context} ctx - client 根上下文。
     */
    // ── 设置导航图标（`settings.section` 没有 icon 选项）───────────────────────
    // 设置外壳（ui-settings-general 的 SettingsRoot）按 **section id 硬编码** 导航
    // 字形：只有官方那几个 id 有专属图标，其余一律回退齿轮；而 settings.section 的
    // 注册选项只有 id / order / label，第三方分区**拿不到图标位**。生态通行做法
    // （dshmarket 的 settings-nav-icon、dsh-better-sidebar、dsh-skill-mcp-panel）是：
    // 对话框挂载后按**本地化 label 文本**认领自己那一行，用 CSS `mask-image` 画自己
    // 的标记并隐藏兜底的齿轮。这里照做，范围刻意收窄——
    //   · 只给「可见文本 === 本插件当前本地化分区名」的那一行打属性，不碰外壳结构；
    //   · 属性与注入的样式表都由 ctx.effect 持有，随 fiber 卸载一并撤销；
    //   · 切语言时 MutationObserver 重新认领，标签与字形不会互相矛盾；
    //   · 不新增订阅以外的内存态（一个 style 元素 + 一个属性）。
    // 官方一旦给 settings.section 加上 icon 字段，就删掉这段、改用官方字段。
    const NAV_ICON_ATTR = "data-wd-nav-icon";
    /** 导航行定位：设置对话框 nav 里的按钮（外壳把每个 section 渲染成一个 button）。 */
    const NAV_ROW_SELECTOR = "[role=\"dialog\"] nav button";
    // mask 只用 alpha 通道：模板本身**不命名任何颜色**（一律 currentColor），
    // 可见颜色来自 CSS 的 background-color: currentColor。

    /** 本插件的导航标记（16×16，纯 alpha，颜色由 CSS 的 currentColor 提供）：铃身 + 摆锤 + 两侧声波弧 —— 与 icon.svg 同一个「提示音」语义。 */
    const NAV_MARK_PATH = '<path d="M8 3.4a3 3 0 0 0-3 3v2.2L4 10.6h8l-1-2V6.4a3 3 0 0 0-3-3Z"/>' + '<path d="M6.7 11.2a1.3 1.3 0 0 0 2.6 0Z"/>' + '<path d="M2.4 6a3.4 3.4 0 0 0 0 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' + '<path d="M13.6 6a3.4 3.4 0 0 1 0 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';
    /** 标记的 mask URL（空格等一律运行时编码，不手工转义）。 */
    function navMarkUrl() {
      return "data:image/svg+xml," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">'
        + NAV_MARK_PATH + "</svg>");
    }
    /** 被认领那一行的样式：藏掉外壳齿轮，用 mask 画标记（颜色取 currentColor）。 */
    function navIconCss(maskUrl) {
      const sel = "[" + NAV_ICON_ATTR + "]";
      return [
        sel + " > svg { display: none; }",
        sel + "::before {",
        "  content: '';",
        "  flex: none;",
        "  width: 16px;",
        "  height: 16px;",
        "  background-color: currentColor;",
        "  -webkit-mask-image: url(\"" + maskUrl + "\");",
        "  mask-image: url(\"" + maskUrl + "\");",
        "  -webkit-mask-repeat: no-repeat;",
        "  mask-repeat: no-repeat;",
        "  -webkit-mask-position: center;",
        "  mask-position: center;",
        "  -webkit-mask-size: 16px 16px;",
        "  mask-size: 16px 16px;",
        "}",
      ].join("\n");
    }
    /**
     * 该行是不是本插件自己的。
     *
     * 这是本特性唯一的判断：可见文本 === 外壳当前投影的分区名。空标签不认领任何
     * 行——语言未就绪时不能把整条导航都标记掉。
     */
    function isOwnNavRow(rowText, wantedLabel) {
      const wanted = String(wantedLabel === undefined || wantedLabel === null ? "" : wantedLabel).trim();
      if (wanted.length === 0) return false;
      return String(rowText === undefined || rowText === null ? "" : rowText).trim() === wanted;
    }
    /**
     * 装配设置导航图标。
     * @param ctx - 客户端上下文（用于 effect 归属）。
     * @param resolveLabel - 本插件当前的本地化分区名（每次同步现取，切语言即生效）。
     */
    function installSettingsNavIcon(ctx, resolveLabel) {
      if (typeof document === "undefined") return;
      ctx.effect(() => {
        const tag = document.createElement("style");
      // 装饰性特性：宿主（或测试桩）只提供部分 DOM 面时静默跳过，绝不把
      // 设置面板带下水。
      if (tag === undefined || tag === null || tag.dataset === undefined || tag.dataset === null) return;
        tag.dataset.plugin = "@falling-ts/dsh-web-ding";
        tag.dataset.pluginCss = "web-ding/settings-nav-icon";
        tag.textContent = navIconCss(navMarkUrl());
        document.head.appendChild(tag);
        let disposed = false;
        let scheduled = false;
        const sync = () => {
          scheduled = false;
          if (disposed) return;
          const wanted = resolveLabel();
          for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
            if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_ATTR, "");
            else row.removeAttribute(NAV_ICON_ATTR);
          }
        };
        const schedule = () => {
          if (scheduled || disposed) return;
          scheduled = true;
          queueMicrotask(sync);
        };
        sync();
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        return () => {
          disposed = true;
          observer.disconnect();
          for (const row of document.querySelectorAll("[" + NAV_ICON_ATTR + "]")) row.removeAttribute(NAV_ICON_ATTR);
          if (typeof tag.remove === "function") tag.remove();
        };
      }, "web-ding: settings nav icon");
    }

    function apply(ctx) {
      // 绑定翻译入口:此后所有 UI 文案(toast / 消息面板 / 设置分区)都跟随活动语言。
      // ctx.locale.bind 返回的函数按调用时刻读取活动语言,故切换语言无需重注册。
      tr = ctx.locale.bind(NS);
      // 主题别名（浅色/暗色两套取值）。注入失败只影响取色、不影响功能。
      // 设置导航图标（机制与偏离登记见上方 installSettingsNavIcon）。
      installSettingsNavIcon(ctx, () => tr("nav"));
      ctx.effect(() => ensureThemeTokensInlined(), "web-ding: theme tokens");
      // 音频解锁监听器:属于 apply 拥有的资源(工厂期不得注册),卸载时随本 effect 撤销。
      ctx.effect(() => installUnlockListeners(), "web-ding: audio unlock listeners");
      // zh 是键集事实源,en/ja/ko 必须与之逐键对齐(缺键时查找链回落到 en)。
      // 语言目录项与字典分开登记:addLanguage 可能因兄弟插件已注册同一 id 而让位
      // (见 contributeLanguages),字典注册则始终由本插件持有。
      ctx.effect(() => {
        const disposeLanguages = contributeLanguages(ctx.locale);
        const disposeDicts = ctx.locale.register(NS, { zh, en, ja, ko });
        return () => { disposeDicts(); disposeLanguages(); };
      }, "web-ding: dictionaries and languages");
      // ui-settings 的 configForms 服务按命名空间交出 ConfigForm(getSnapshot/subscribe
      // 与旧 settingsScope 同形:status 枚举为 'loading'|'ready'|'unavailable';set/unset/
      // mutate 现在回答 Promise<boolean>,本插件的 update 回调忽略该返回值)。
      const scope = ctx.configForms.get(NS_SETTINGS);
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
          questionValueRef = s.value;                       // 供 question 观察器回调读取
          installQuestionObserver(s.value);                 // 一次性安装 DOM 观察器(幂等)
          if (s.status === "ready") maybePlayFromValue(s.value);
        } catch { /* never let a cosmetic derive take down the panel */ }
      };
      const unsub = scope.subscribe(derive);
      derive();
      ctx.effect(() => unsub, "web-ding: scope subscription");
      ctx.effect(() => () => {
        if (questionObserver) {
          questionObserver.disconnect();
          questionObserver = null;
        }
      }, "web-ding: question observer cleanup");
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
        label: () => tr("nav"),
        inject: injected,
      }, DingSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
