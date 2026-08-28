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

## 为什么是 browser 端播放

集合约定的目标场景(用户要求):声音与通知一律走**前端 JS**,不走 Node 后端、
不弹 Windows 通知。因此 Web Audio 合成是唯一合法发声路径。浏览器自动播放策略
的解锁方式是客户端一次性用户手势预热(pointerdown/keydown)+ "试听"按钮;
页面后台标签内 AudioContext 可能被浏览器挂起,属浏览器策略,README 已说明。

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
