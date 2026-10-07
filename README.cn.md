# dsh-web-ding

一个 DSH Cordis 插件:当 **agent 回合结束**(所有轮次安静、转入空闲)时,在
**浏览器里**播放一声"叮"。声音**完全由前端 JavaScript(Web Audio API)合成**——
Node/后端从不发声,也不走 Windows/系统通知。

架构参照 [dsh-force-compact](https://github.com/falling-ts/dsh-force-compact):
纯监听器的 Host 半部 + 浏览器 client 半部,之间用官方
`settings/document-updated` 镜像通道相连。

## 工作方式

| 层 | 行为 |
|----|------|
| Host(`index.js` + `src/`) | 监听 `agent/status` 的 **idle 转变**(顶层回合结束、下一次人为对话之前;新建会话从未运行过的首次 idle 与重复 idle tick 都保持静默;被委派的子 agent 回合结束按持久化 session header 识别,默认静默)。向 `falling-ts-web-ding` 设置命名空间写入**每次字段都写全**的 `{ phase:'done', at, sessionId|null, title|null, subagent, depth }`(`settings.update` 是递归合并,省略的键会继承上一次发布的值——`subagent` 曾经因此 latch,详见 README.md 与 AGENTS.md);`title` 在这里从官方 `sessionProjections` 的 `title` 投影读出,浏览器因此无需自己去取。绝不发声、绝不调用系统。 |
| 浏览器(`web/client.js`) | 经 `configForms` 实时镜像命名空间;收到 `at` 严格更新的 `done` 信号后用 Web Audio API 合成一声短"叮",经标签页播放——同一瞬间在右下角弹出 Win11 风格 toast。点击 toast 展开右侧消息列表,展示全部回合结束消息(存在浏览器 localStorage,上限 100、按 signal `at` 去重),支持单条删除与全部删除。全程纯前端:后端不发声、不弹系统通知。 |

除了提示音,每次回合结束还会在右下角弹出一条 Win11 风格 toast(6 秒自动消失)。点击它即可打开右侧消息列表:最近 100 条回合结束消息保存在浏览器 localStorage(键 falling-ts-web-ding.notify.v1),每条可单独删除,顶部"全部删除"按钮一键清空。消息记录纯前端——Host 不读也不写。

## 安装

```bash
dsh plugin --profile web add github:falling-ts/dsh-web-ding
```

(需要 Web 应用带上 client bundle——`package.json` 的 `dsh.client` 声明会自动
完成。)

## 配置(`falling-ts-web-ding` 命名空间,写进 profile 的 `cordis.patch.yml`)

两块独立配置,各自有开关与音色:

**块 1 — 弹出用户选择** —— harness 弹出用户选择题时在浏览器播放一声"叮"。
检测在浏览器侧完成(DOM 上 QuestionComposer 的 `[data-question-key]` 锚点):
宿主看不到 question 帧,故本块完全由前端实现。

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `questionEnabled` | boolean | `true` | 弹出用户选择提示音开关。 |
| `questionVolume` | number 0..1 | `0.7` | Web Audio 播放音量。 |
| `questionFreq` | number 80..4000 | `880` | "叮"的基频(Hz)。 |
| `questionDecayMs` | number 100..4000 | `900` | 音色衰减时长(ms)。 |

**块 2 — 回合结束** —— 经典的 agent/status idle 转变提示音。Host 观察
`agent/status`,在 idle 转变(顶层回合结束、下一次人为对话之前;新建后从未运行过的
会话与重复 idle tick 保持静默)时发布 `done` 信号。

> **行为变更(v0.7.0)。** 此前回合结束提示音在**每一次** idle 转变时都响,包括被委派
> 的子 agent 的回合——于是派出 N 个子 agent 的父 agent 会响 N+1 次。现在子 agent 的
> 回合结束会被识别并**默认静默**(`subagentEnabled: false`),即**子 agent 自己跑完不再
> 响**;父 agent 收尾时照旧响一声。置 `subagentEnabled: true` 可恢复旧的"每次回合结束
> 都响"行为(可再配独立子音色)。

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `turnEndEnabled` | boolean | `true` | 回合结束提示音开关(关闭时 Host 跳过发布)。 |
| `turnEndVolume` | number 0..1 | `0.7` | Web Audio 播放音量。 |
| `turnEndFreq` | number 80..4000 | `880` | "叮"的基频(Hz)。 |
| `turnEndDecayMs` | number 100..4000 | `900` | 音色衰减时长(ms)。 |

**块 2 闸门 —— 子 agent 回合结束。** `agent/status` 是 scope 过滤的,但过滤只向下
收窄:挂在未打 tag 的根上下文上的监听器对每个 dispatch key 都放行,所以本插件能看到
父 agent 委派出去的每一个子 agent 的 idle 转变。派出 N 个子 agent 的父 agent 因此产生
N+1 次回合结束信号——每个子 agent 一次,最后父 agent 自己一次。

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `subagentEnabled` | boolean | `false` | 子 agent 跑完时是否也响一声。默认关闭:多出来的 N 声对离开页面的你就是噪音。打开后,主 agent 自己收尾时仍会再响一声(主音)。 |
| `subagentDistinctTone` | boolean | `false` | 给子 agent 一个和主音不同的音色,而不是复用主音。 |
| `subagentVolume` | number 0..1 | `0.7` | 子 agent 提示音的 Web Audio 音量。 |
| `subagentFreq` | number 80..4000 | `440` | 子 agent 提示音的基频(Hz)——默认比主音低一个八度,听起来像"中间进展"而非"整体做完了"。 |
| `subagentDecayMs` | number 100..4000 | `900` | 子 agent 音色衰减时长(ms)。 |

子 agent 由**持久化**的 session header 识别——`origin === 'subagent'` 或
`delegationDepth > 0`——所以该判定能扛过重启与恢复。两个标记独立成立,因为并非所有
子 agent 创建路径都会同时打上两者。单独出现 `parentSession` **不**视为委派:会话
**fork** 也带它,而 fork 是新的独立根,不是子 agent。

**每次发布必须写全字段(2026-10-07 修复)。** `settings.update` 是**递归合并**而非
替换(`mergeLayers`,deepseek-harness `packages/settings/settings/src/index.ts`):
它复制已存的分区、只赋值补丁自己携带的键,于是**补丁省略的键会继承上一次发布的值,
而不是被清空**。旧载荷只在子 agent 时 spread `subagent`,第一次子 agent 回合结束就把
`subagent: true` latch 住了——之后每一次**主 agent** 回合结束都复用它:toast 被打上
`[子agent]` 角标,开启 `subagentDistinctTone` 时主音还会被换成子音。现在
`buildDingSignal` 每次返回完整载荷。回归闸门:`node tests/signal.test.mjs`。

## 浏览器自动播放策略

浏览器要求一次用户手势后才允许出声。客户端在首次指针/按键交互(以及点击
"试听"按钮)时预热 `AudioContext`,所以:与页面交互一次(或点一下试听),之后
每次回合结束就能听到叮。后台标签页里的 AudioContext 可能被浏览器自身挂起——
保持标签页可见才能听到声音。

## 开发

```bash
# 作为开发覆盖层挂载(plain JS,无构建步骤)
dsh web --patch $(pwd)/cordis.patch.yml   # 你的 CLI 支持该选项时
# 或从本地路径安装
dsh plugin --profile web add /path/to/dsh-web-ding
```

插件自身规则见 `AGENTS.md`(纯 Host 监听器、后端不发声、不弹系统通知、只用
官方 settings 镜像通道通向浏览器)。

## 效果截图

![设置页——「提示音配置」分区,两块各自开关与音色,免重启实时可调](assets/setting-ding.png)

*设置页——「提示音配置」分区:「弹出用户选择」与「回合结束」两块,各自
开关、音量、频率、衰减时长,免重启实时可调,各带"试听"按钮预热浏览器
AudioContext。*

---

## License

MIT
