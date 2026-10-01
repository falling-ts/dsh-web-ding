# AGENTS.md — dsh-web-ding

本规则适用于 `dsh-web-ding/`,并补充[集合约定](../AGENTS.md)。

## 插件定位

两条提示音路径,都通过**浏览器前端 JS** 播放合成"叮",各自独立配置:

- **块 1 — 弹出用户选择(question)**:harness 弹出用户选择题(ask_user_question)
  时,浏览器对话区渲染的 QuestionComposer 根节点带稳定的 `data-question-key`
  属性(CSS Modules 类名是哈希的,不可用)。Client 半部用 **MutationObserver**
  观察 DOM 上新增的 `[data-question-key]` 节点,首次出现即播放块 1 的 ding。
  **宿主的 Host 半部看不到 question/requested 帧**(该帧走 connection 层
  MuxFrame,Host 插件无订阅缝),所以这一块识别完全在浏览器侧完成,宿主不参与。
- **块 2 — 回合结束(turn-end)**:**Host 半部是纯监听器**,只监听
  `agent/status`,在其 idle **转变**时把一条 `{ phase:'done', at, sessionId, title }`
  信号写进 `falling-ts-web-ding` 命名空间的 `signal` 字段(经
  `settings.update`,走官方 `settings/document-updated` 广播镜像到浏览器)。
  Host **绝不**发声,也绝**不**发起 Windows/系统通知。
- **Client 半部**(`web/client.js`)订阅该命名空间,收到 `at` 严格更新的
  `done` 信号后用 **Web Audio API 纯前端合成**"叮"(三个正弦振荡器叠加 +
  指数衰减包络,无音频资产)。声音只发生在浏览器标签页里。
- **浏览器通知中心(同属 client 半部)**:ding 的同时在右下角弹一条 Win11 风格
  toast(6 秒自动消失、可手动关闭),点击 toast 展开右侧消息列表面板;消息存
  **浏览器 localStorage**(键 `falling-ts-web-ding.notify.v1`,按 `at` 去重、
  上限 100 条),面板支持单条删除与全部删除。同样是纯前端实现——不经过 Node
  后端,也不发 Windows/系统通知。

## Host→浏览器通道(signal 字段)

`falling-ts-web-ding.signal` 是**插件私有的瞬态信使**,完全复刻 dsh-force-compact
的 `liveUi` 通道模式:宿主唯一写入方、客户端只读、故意与其它字段一样持久化到
`settings.yaml`(无害残留——见下文首帧语义)。载荷是
**`{ phase:'done', at, sessionId?, title? }`**;`at` 兼作序号:`Date.now()` 上叠加进程内
单调高水位,避免同毫秒连续两次 idle 的序号碰撞。客户端仅在 `at > 本页面最后播放的 at` 时响应。

**会话标题随信号走(2026-09-30 改)** —— `title` 由 **Host** 半部在 idle 转变时从
`ctx.get('sessionProjections').snapshot(session).values.title`(官方 `title` 投影单元,
即会话列表行读的同一份)读出,与 `sessionId` 一起写进信号;读失败一律降级为"没有 `title`
字段",**绝不**影响叮一声(见 `wd-signal-title-probe.mjs` 的 7 种降级用例)。客户端**不再**
自己发 RPC 取标题:

- 旧实现让浏览器半部手拼 wire 信封 + 自铸 `rpcId` 调 `/api/session/list`,违反
  `packages/client/AGENTS.md` 的 "rpcId is strictly bidirectional … minting stays in
  Connection",并把"当前 build 的传输形态"知识(句点 → 斜杠那次漂移)塞进了一条纯装饰路径;
- 新实现符合 `references/practices.md` 的取向:客户端不自己折叠会话事件,值在 Host 侧算好再送。
  Host 本来就持有 `agent.session`,零额外成本。

**首帧语义(2026-09-30 修正)** —— `lastAt === null` 时的基线:命名空间里**有**残留 done 信号
→ 以它的 `at` 为基线且不播(页面打开前的信号不补响);**没有**残留(全新 home / 从未跑过回合)
→ 基线取 `0`,于是本安装的**第一声** done 照常响。旧实现一律把首帧信号当残留吞掉,真浏览器实测
在全新 home 上表现为"第一次回合结束不响、第二次才响"(3099 全新 home 复现:写入 signal 后振荡器
计数仍为 0)。

## harness 0.1.7-alpha.2 适配(2026-09-23)

peer 基线为 **`>=0.1.7-alpha.1`**(cordis `>=4.0.4`,schemastery `>=3.18.4`)。
peer 清单按**实际用到的包**声明(除 cordis 外全部 `optional`):`dsh-settings`(设置表单与
`settings.update`)、`dsh-agent`(`agent/status` 事件契约)、`schemastery`(Config schema),
客户端 `dsh-client-ui-settings`(`configForms` + `settings.section`)、`dsh-client-locale`、
`dsh-client-store`(`createSnapshotStore`)。
0.1.7 改了 **settings 的两侧**,本插件 Host 与 Client 半部都要跟。

**Host 半部(2026-09-23 修复;此前本节误判为"零改动",已更正)** —— 0.1.7 **删除了整套
旧 settings API**:`settings.register(ns, schema, { base })` 与 `settings.get(ns)` 在
`packages/settings/settings/src/index.ts` 已不存在(旧服务换成 `SettingsForms`,
`settings-file` 整包删除)。新模型:

- 插件**导出 schemastery `Config`**(字段标 `.volatile()`),`apply(ctx, config)` 收到
  解析后的值,读值用 `config.<field>.get()`;默认值走 `.default()`,旧的 `{ base }`
  第三参**没有等价物**;
- **设置命名空间 = 该 profile 条目的 loader id**(`settings/src/index.ts` 用
  `entry.options.id`),所以 `cordis.patch.yml` 的 `insert.id` 必须是
  **`falling-ts-web-ding`**(与客户端常量一致);
- 只有 `.volatile()` 字段可被表单写;`settings.update(ns, patch)` 仍在,但 `ns` 必须是
  条目 id,且被写路径必须 volatile(`signal` 字段因此也标了 volatile);
- 自带设置页面的插件应声明
  `ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))`;
- 设置持久化载体从 `$DSH_HOME/settings.yaml` 变成 **profile 的 `cordis.patch.yml`**
  (config-editor 写入)。

本插件据此删除了 `registerNamespace` 与 30×1s 重试计时器,新增
`buildConfigSchema` / `bindConfig` / `readConfigField`。

**Client 半部** —— 服务名 **`settingsScope` → `configForms`**,取用方式从
`ctx.settingsScope.bind({ namespace })` 变成 **`ctx.configForms.get(namespace)`**;
旧名在 0.1.7 的 `packages/client` 里已全量消失(提供方换成 `settings-mirror.ts` +
`config-form.ts`)。返回的 `ConfigForm` 与旧 `SettingsScope` **同形**:
`getSnapshot`/`subscribe`/`set`/`unset`/`mutate` 都在,快照字段
`status`/`value`/`writable` 也都在;两处差异:① `status` 枚举多了 `'loading'`
(本插件本就只在 `'ready'` 时播,无需改);② 三个写方法从 `Promise<void>` 变成
**`Promise<boolean>`**(本插件忽略返回值,无需改)。client `inject` 已是
`['slots','locale','configForms']`。

`agent/status`(同步、`{agent,status}`、`'idle'`)、`settings.section` 槽、
`createSnapshotStore`、`dsh.client` 清单字段、`settings/document-updated` 广播在
0.1.6→0.1.7 **均未变**。

端到端验证(0.1.7-alpha.2):`settings/describe` 出现 `falling-ts-web-ding`
(`autoGenerate=false`,9 个字段——含宿主写的瞬态 `signal`),跑一轮后 `signal` 成功写入 profile 配置。

## harness 0.2.0-rc.2 复核（2026-09-30）：零改动

peer 下界保持 `>=0.2.0-rc.1`（0.2.0 列车；rc.1 → rc.2 是同列车补丁，纯下界本就不该收窄——
收窄只会让 0.2.0 的 boot 期 peer 预检在 rc.1 运行时静默禁用本插件）。逐缝复核结论：

- 本插件依赖的两侧 settings 缝在 rc.2 全部未变：`ctx.configForms.get` + `ConfigForm` 五方法
  （`getSnapshot`/`subscribe`/`set`/`unset`/`mutate`；快照状态枚举仍为
  `'loading'|'ready'|'unavailable'`）、`ctx.slots.inject('settings.section')`（仍
  `kind:'list'; scope:'root'`）、`settings.update(ns, patch)`、`settings/document-updated`
  广播（仍在 `API_REMOTE_FORWARDED_EVENTS` 白名单里，`packages/api/remotes/src/remote-events.ts`）。
- `agent/status`（同步、`{agent,status}`、`'idle'`）签名与 dispatch mode 未变。
- question 块的 DOM 锚点 `data-question-key` 仍在
  （`packages/client/ui-user-questions/src/client/QuestionComposer.tsx` 的 frame 根节点）。
- 客户端 `ctx.locale`、`createSnapshotStore`、`dsh.client` 清单字段未变。

端到端复核（3080 web 实例 + `DSH_HOME=~/.dsh-web`）：`pluginInventory/list` 中
`include:falling-ts-web-ding` 为 `enabled:true` / `fiberPhase:active`，
`settings/describe` 出现 `falling-ts-web-ding` 命名空间。**本仓库源码与文档无需改动**，
故 version 不动。

## 音频解锁加固（2026-09-30，排查"完成或询问都不叮一声"）

**症状**：回合结束(块 2)与弹出用户选择(块 1)两条路径都听不到声音,但右下角 toast 与
消息缓存(`falling-ts-web-ding.notify.v1`)照常出现。

**逐层排查结论(活的 3080 实例 + 真实浏览器)**——检测与广播这两层都是好的:

- Host 半部确实在真回合结束时写 `signal`(`settings/describe` 可见新的 `at`/`sessionId`);
- 客户端半部确实收到广播并**已经调度了 3 个振荡器**、写了缓存、弹了 toast:
  真 `agent/status` idle 转变端到端复现,真实 `ask_user_question` 卡片挂载也复现;
- 唯一会静音的是 **AudioContext 没解锁**。真 Chromium 实测到浏览器警告
  `The AudioContext was not allowed to start. It must be resumed (or created) after a
  user gesture on the page`——提示音到达时若页面**还没有用户手势**,`playDing` 会在
  手势之外惰性创建 AudioContext,浏览器策略拒绝启动它;旧实现还会在该挂起上下文上
  当场排程(挂起期 `currentTime` 冻结),把这一声压到以后某次 resume 的瞬间迟到播放,
  于是表现为"toast 弹了、声音没有"。

**修复(`web/client.js`,纯客户端)**:

1. 解锁监听不再 `{ once: true }` + 冒泡阶段,改为**捕获阶段**挂
   `pointerdown / mousedown / keydown / click / touchstart / focus` 且**不一次性**:
   已在 `running` 时短路,未运行才 `resume()`。理由:一次性监听会被"本模块求值之前
   发生的那次手势"打空(此后再无补解锁机会);冒泡监听会被宿主 UI 里可能的
   `stopPropagation()` 吞掉。任何一次后续手势都能补上解锁。
2. `playDing` 在 `ctx.state !== "running"` 时**先 `resume()`、成功后再按当时的时间轴排程**;
   resume 被拒(无手势的浏览器策略)则保持静音,绝不抛出、绝不排一声幻音。
3. 已 `running` 时立即排程——延迟与改动前逐字一致。

**监听器归 apply 所有(2026-09-30 规范收敛)**:`UNLOCK_GESTURES` 的注册/撤销成对收进
`installUnlockListeners()`,由 `apply` 里的
`ctx.effect(() => installUnlockListeners(), "web-ding: audio unlock listeners")` 拥有。此前它在
**工厂求值期**直接挂(工厂有副作用、且永无 disposer),违反 `references/ui-plugin.md` 的
"Keep factories free of side effects … register … listeners … inside `apply` with
`ctx.effect`/`ctx.on` and return their cleanup functions"。撤销必须用与注册相同的 `capture`
取值,否则撤不掉。"不一次性"的性质与所有权无关:插件存活期间任何一次手势都还能补解锁。

**验证**(全部退出码 0):

- `node exploration/wd-audio-unlock-apply-probe.mjs`(31 项,离线可重复:按浏览器
  `__ModuleLoader__.load` 契约真装载 `web/client.js` 并跑 `apply(ctx)`,用桩 AudioContext
  覆盖 挂起→resume→排程、已运行立即排程、resume 被拒保持静音、监听器形状(捕获/非一次性/
  多手势)、后续手势补解锁、已运行短路;并额外锁住**工厂无副作用**(求值期零监听)、
  **apply 所有权**(撤销器把 6 个监听全部摘掉、capture 取值一致)、**标题随信号进缓存**、
  **客户端零 RPC**,以及**首帧语义的两种情形**——有残留不播 / 无残留则第一声必须播。
  后一情形由第二次独立求值的模块实例覆盖,因为基线闩锁是模块级的,一个进程只能验一次首帧);
- `node exploration/wd-signal-title-probe.mjs`(27 项,离线:直接 import Host 的
  `src/hooks/idle.js` + `src/core/signal.js`,桩 `settings`/`sessionProjections`,
  覆盖 标题读取、只写 `signal` 一个字段、idle 转变闩锁(新建会话不响 / 重复 tick 不响 /
  `turnEndEnabled=false` 不响)、**7 种标题降级**(服务缺失 / 无 `snapshot` / 抛异常 /
  无 `values` / 未折叠 / 空白 / 非字符串)都必须照响且不带 `title`、settings 写入被拒不上抛、
  同毫秒两次发布的 `at` 不撞号);
- `node exploration/wd-ding-trigger-probe.mjs 3080`(活实例 8 项断言:按真实 host 路径写
  `signal`(含 `title`)→ 页面调度 3 个振荡器 + toast + 缓存,并断言**缓存记录带上了那个标题**;
  该探针曾复现上面那条 autoplay 拒绝警告)。

诊断期间另跑过一次性探针(真回合 end-to-end、在 GUI 里真发一问触发真实
`QuestionComposer`、以及从本机 Pake/WebView2 窗口的 LevelDB 里挖
`falling-ts-web-ding.notify.v1` 记录)——结论都写在上面,脚本随诊断结束清理,只留上面三个
可复用的检查。

**真回合端到端复验(2026-09-30)**:`node exploration/wd-browser-probe.mjs <port>` 用 wire 协议
真跑一个回合,缓存里落下的记录是
`{"at":…,"timeText":"…","sessionId":"session-…","title":"Say exactly: ping"}` ——
即 **Host 从 `sessionProjections` 读到的真实会话标题**经信号 → 镜像 → 客户端渲染全链贯通。

**排障备忘**:本机用户的 GUI 是 **Pake/WebView2 窗口**(`pake-harness.exe`,user-data
`%APPDATA%\Harness\EBWebView`),它的 localStorage 里能找到
`falling-ts-web-ding.notify.v1` 与含真实 `at`/`sessionId` 的条目——这是"信号确实到达该
窗口"的离线判据(该窗口的 WebView2 命令行**不带**
`--autoplay-policy=no-user-gesture-required`,故默认策略要求用户手势,与上面结论一致)。
若加固后仍无声,先点设置分区里的**「试听」**(真实手势;现在会先 resume 再播放)确认
输出设备/窗口音量,再看是不是窗口被静音。

## 为什么是 browser 端播放

集合约定的目标场景(用户要求):声音与通知一律走**前端 JS**,不走 Node 后端、
不弹 Windows 通知。因此 Web Audio 合成是唯一合法发声路径。浏览器自动播放策略
的解锁方式是客户端手势预热(捕获阶段挂多种手势、由 `apply` 的 `ctx.effect` 拥有并在插件
卸载时撤销,见上文"音频解锁加固")+「试听」按钮;页面后台标签内 AudioContext 可能被浏览器挂起,
属浏览器策略,README 已说明。

## 主题(浅色 / 暗色):设置区颜色一律走 `--fcts-*`(2026-09-17 增补)

设置分区用内联 style。**内联 style 里的 `var()` 会沿 DOM 继承解析**,所以 `web/client.js` 在
`apply` 时注入一张只定义变量的样式表 `<style id="falling-ts-theme-tokens">`
(`THEME_TOKENS_CSS`,按 id 幂等;规则与 dsh-force-compact 注入的**逐字相同**,共享 `--fcts-`
工作区命名空间,谁先注入都一样),设置区只引用 `var(--fcts-*)`:

- `body{…}` = **改动前的浅色字面值**(`rgba(0,0,0,…)` 系)→ 浅色外观逐字节不变;
- `body[data-ds-dark-theme]{…}` = **上游语义别名**,由官方主题包按肤定义、随主题自动翻转。
  **暗色下说明文字(hint / intro / value)取 `--dsw-alias-label-primary` = `rgb(249,250,251)`
  (纯白)**,对比度 17.45:1;此前的 `rgba(0,0,0,0.45)` 在暗色下几乎不可见。

**边界**:toast 与右侧消息面板是**浮层通知**,刻意保持 Win11 风格的浅色玻璃质感(白底深字),
两种主题下都可读,故**不**走这套设置区别名——探针按"设置区标记之后"扫描,正是为了让这条边界
可检查。

验证:`node exploration/theme-token-probe.mjs`(解析官方主题表 → 逐级解析 var 链 → 按 WCAG
算对比度 → 拒绝悬空上游 token → 保证浅色取值未漂移 → 扫出设置区残留字面色)。

## 界面文案与语言(i18n,2026-09-17 增补)

toast、右侧消息面板与设置分区的**每一句文案都归 locale 服务所有**,代码里不得出现硬编码
副本(上游 `packages/client/AGENTS.md` 的 locale-owned copy 红线)。本插件的三处 UI 全部
经模块级 `tr` 取词,`tr` 在 `apply` 里绑定到 `ctx.locale.bind("settings.webDing")`——绑定
函数按**调用时刻**读活动语言,因此切换语言不需要重注册任何东西。

**支持语言**:`zh` / `en` / `ja`(日本語) / `ko`(한국어)。zh 是键集事实源,其余三份必须
逐键对齐;缺键**不报错**,只会沿查找链回落到 en(再回落 `common` 命名空间,最后显示键名),
所以键集一致性由探针守住。

**ja/ko 经语言包缝贡献**:上游 `@deepseek-ai/dsh-client-locale` 只内置 zh/en,
`ctx.locale.addLanguage({ id, label, fallback })` 是其余语言的扩展点(`label` 用该语言
自述,fallback 链必须以 `en` 为终点)。`dsh-force-compact` 贡献同样的两个 id,两个插件各自
可独立安装;先到者拥有目录项,后到者命中 `already registered`——`contributeLanguages`
只吞这一种错(其余照抛),且只为真正添加的项登记 disposer。

**用户数据不入词典**:会话标题、会话 id、时间戳都是数据,原样展示;只有其周围的模板
(`doneTitle: "{title} 已完成"`、`sessionLabel: "会话 {id}…"`)走词典,经 `{name}` 占位符
插值。消息缓存里存的是数据字段(`at`/`title`/`sessionId`/`timeText`),模板在渲染时才套,
因此切换语言不会篡改已有记录。

**验证**:`node exploration/i18n-parity-probe.mjs`(词典键集/语言包/硬编码副本扫描);
两个插件共用同一份探针,它在一次运行里同时校验二者。

## 状态与约束

- Host 半部无 timer(命名空间安装的 bounded retry 是安装簿记,成功即自取消,
  非持久定时器);唯一进程内存态是两个惰性闩锁(`prevStatus` Map + `everBusy`
  Set,按 sessionId 跟踪"idle 转变"判定),无持久化、随进程消失。
- 两块开关各自独立:`questionEnabled=false` 时浏览器跳过弹出用户选择的 ding
  (question 块纯前端检测,无宿主参与);`turnEndEnabled=false` 时宿主仍监听
  `agent/status` 但跳过发布,客户端也不播(回合结束块双端都有闸)。
- question 块的 DOM 观察器(MutationObserver)是纯前端机制:非 timer、无持久态,
  回调用 `questionValueRef` 读最新快照,dispose 时 disconnect;基线语义与
  `lastAt` 相同(加载时已存在的 `[data-question-key]` 只记 key 不响)。
- 所有监听器与发布路径**绝不抛入事件派发**:异常记日志并 settle。
- 新增 Web Audio/UI 能力时保持"纯前端合成、零资产、零系统通知"的红线。
- 消息缓存是浏览器侧数据(客户端写 `localStorage`,宿主不读不写):不参与
  settings.yaml、不进入 signal 通道;删除/清空操作只在前端进行。

## 官方规范符合性(2026-09-30 评审)

按上游 `docs/user/develop/**` + `packages/preset/agent-preset/skills/cordis-plugin-development/`
(含 `references/{host-plugin,ui-plugin,practices}.md`) + `packages/AGENTS.md` /
`packages/client/AGENTS.md` 逐条核对,本插件**已符合**的面:

- 组合包 manifest:`dsh.bundle.patch` 指向 `./cordis.patch.yml`、patch 按**包名**引用、
  `type: module`、`exports` 含 `./client` 与 `./package.json`、`files` 覆盖全部相对运行时
  入口、`license`、双语 README;非 `private`(要发布)、`publishConfig.access: public`。
- Host 插件导出形态:只具名导出 `name`/`Config`/`apply`,**无 default export**、不混形态
  (混形态会让 Loader 丢掉 function plugin 的命名空间)。
- 注册即 effect:`ctx.on('agent/status')` 走 `ctx.on`;设置表单声明、
  语言字典、快照订阅、主题表、解锁监听全走 `ctx.effect` 并归还 disposer。
- 可选服务用 `ctx.inject(['settings'], …)` / `ctx.get('sessionProjections')`,不用硬 `inject`。
- 客户端模块契约:`__ModuleLoader__.load({ id })` 的 `id` **逐字等于包名**;React 走模块表;
  `@deepseek-ai/dsh-client-store` 是 `PLATFORM_MODULES` 的**基线模块**,故不写
  `dsh.client.external`(重复基线会被 `verify-client-packages` 判违规);
  `immediately` 正确省略(只归基础设施行);未 require `ui-primitives`。
- 客户端 Cordis `inject` = `["slots","locale","configForms"]`,与实际用到的服务一致;
  `dsh.client.inject` 声明了三个客户端包(信息性边,preflight 显示 + HMR diff)。
- UI 文案全部经 `ctx.locale` 词典(zh 键集为事实源 + ja/ko 经 `addLanguage` 贡献);
  用户数据(标题/id/时间戳)不入词典。

**显示元数据(`locale/*.json` + `icon`,2026-09-30 补齐)**:宿主 `readPluginMeta`
(`packages/boot/app-boot/src/package-meta.ts`)按 `${specifier}/locale/en.json` 解析标题与描述、
按清单的 `icon` 读图标,两者都要经 `exports` 发布。此前两个都缺 → 插件卡片直接显示
package.json 里那一整段 npm 描述。现在 `locale/{en,zh}.json` 的 `meta.{title,description}` +
`icon.svg` 齐备(`exports` 加 `"./locale/*.json"`,`files` 加 `locale/*.json` 与 `icon.svg`)。
**注意:清单变更需要重启实例才生效**——profile-resolution 在启动时快照了插件的 exports 表,
热重载只监视 profile 的清单/补丁层,不监视插件自己的 package.json。

**已知偏离(有意的,勿"顺手修")**:

1. **toast 与右侧抽屉直写 `document.body`**([`web/client.js`](web/client.js) 的 toast 层与
   overlay)——`references/practices.md` 要求"不写自己组件之外的 DOM、不 append 到 body",
   浮层的官方出口是 `shell.overlay` 槽。当前实现在两种主题下都可读且会自行移除,迁槽属结构性
   改写,留待有意为之。
2. **question 块观察宿主 DOM 的 `[data-question-key]`**:`[data-question-key]` 是宿主渲染的
   内部属性,上游没有对外缝(Host 半部看不到 question 帧是事实),所以这是"框架没给出口"的
   折中。**风险登记**:该锚点属宿主内部实现,上游一改这块就静默失效;`wd-ding-trigger-probe.mjs`
   与 `wd-audio-unlock-apply-probe.mjs` 是它的回归闸门。
3. **回合结束判据用 `agent/status` 的 idle 转变**(不是 durable 的 `turn/end`):`practices.md`
   偏好 durable 事件,但本插件要的语义是"含子代理在内所有回合都结束、且下一个人类回合之前",
   `turn/end` 会每回合响一次。这是**监听事件、不是轮询**(规范禁的是轮询)。
4. **peer 只声明 `peerDependencies`(+ optional meta),不声明 `devDependencies`**:
   `publish.zh.md` 建议共享宿主实例的 dsh 包同时进 peer 与 dev;本插件是 plain JS、无类型检查
   与独立测试,profile 里由 dsh 提供实例,故只留 peer。
5. **`--fcts-*` token 表的浅色分支是字面值**:`practices.md` 说"字面色只用于 artwork";
   组件本身只用 `var()`,字面量只活在 token 表里,改成 `--dsw-alias-*` 会让浅色外观漂移,
   与"浅色逐字节不变"的目标冲突,故保留。

## 设置导航图标（`settings.section` 没有 icon 选项，2026-10-01 增补）

设置外壳（`ui-settings-general` 的 `SettingsRoot`）按 **section id 硬编码**导航字形：
只有官方那几个 id（account / models / agent-presets / plugins / archived-sessions）
有专属图标，其余一律回退同一枚齿轮。`settings.section` 的注册选项只有
`id` / `order` / `label`（`SettingsSectionRow = { id, order, label }`），
**第三方分区拿不到图标位**。上游 `settings.section` 的 slot 契约与运行时 slot 清单
都只列这三项；工作区 pin 的 `ui-settings-general` 与桌面应用 `app.asar` 里打包的
客户端同源，`navIcon()` 是同一份硬编码映射（已逐行核对）。

生态通行做法（`dshmarket` 的 `settings-nav-icon`、`dsh-better-sidebar`、
`dsh-skill-mcp-panel`）是：对话框挂载后按**本地化 label 文本**认领自己那一行，用
CSS `mask-image` 画自己的标记并隐藏兜底齿轮。本插件照做
（`installSettingsNavIcon`，在 `apply` 里装配），范围刻意收窄：

- 只给「可见文本 === 本插件当前本地化分区名」的 `[role="dialog"] nav button` 打
  `data-wd-nav-icon` 属性；空标签不认领任何行（语言未就绪时不会把整条导航标记掉）；
- **不碰 React 节点**：不删不换，只加一个属性 + 注入一张 `<style>`；
- 属性与样式表都由 `ctx.effect` 持有，随 fiber 卸载一并撤销；
- `MutationObserver` 只在 React 改写导航时触发（切语言 / 分区增减即重新认领），
  空闲零回调，与 LiveUI 贴皮那处观察器同类；
- DOM 面不完整（宿主或测试桩只给了部分 API）时静默跳过——纯装饰，绝不把设置面板带下水。

**标记是纯 alpha 模板**：mask 只用 alpha 通道，模板本身不命名任何颜色（一律
`currentColor`，可见颜色来自 `background-color: currentColor`），所以它既不参与
主题取色、也不在 `--fcts-*` 色表之外引入字面色。图形与 `icon.svg` 同一语义：铃身 + 摆锤 + 两侧声波弧（「提示音」）

**为什么可以接受这次越界**（登记在案的偏离）：不改任何上游行为、不碰 slot 台账、
不新增命令或服务；认领判据只读自己那一行的可见文本。上游一旦给 `settings.section`
加上 `icon` 字段，就删掉 `installSettingsNavIcon` 改用官方字段。

验证：`node exploration/fc-settings-nav-icon-probe.mjs`（三插件 × 27 项，离线：抽出
三个 `web/client.js` 的真实实现 + 最小 DOM 桩，覆盖谓词边界 / mask 与样式表形状 /
只认领自己那一行 / 切语言重认领 / 空标签释放 / 卸载清干净 / 新 fiber 可重装，并核对
三者用的是**三个不同**的属性名与样式表 id）。
