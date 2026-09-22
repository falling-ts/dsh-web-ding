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
  `agent/status`,在其 idle **转变**时把一条 `{ phase:'done', at, sessionId }`
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
`settings.yaml`(无害残留——客户端首帧只做 `lastAt` 基线、不播放,重启残留
不会重复响)。`at` 兼作序号:`Date.now()` 上叠加进程内单调高水位,避免同毫秒
连续两次 idle 的序号碰撞。客户端仅在 `at > 本页面最后播放的 at` 时响应。

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

## 为什么是 browser 端播放

集合约定的目标场景(用户要求):声音与通知一律走**前端 JS**,不走 Node 后端、
不弹 Windows 通知。因此 Web Audio 合成是唯一合法发声路径。浏览器自动播放策略
的解锁方式是客户端一次性用户手势预热(pointerdown/keydown)+ "试听"按钮;
页面后台标签内 AudioContext 可能被浏览器挂起,属浏览器策略,README 已说明。

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
