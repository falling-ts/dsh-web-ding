# AGENTS.md — dsh-web-ding

本规则适用于 `dsh-web-ding/`,并补充[集合约定](../AGENTS.md)。

## 插件定位

在 **agent 回合结束**(`agent/status` 从 running 转为 idle,即所有轮次与子代理
工作全部安静、下一次人为对话之前)时,通过**浏览器前端 JS** 播放一声"叮":

- **Host 半部是纯监听器**:只监听 `agent/status`,在其 idle **转变**时把一条
  `{ phase:'done', at, sessionId }` 信号写进 `falling-ts-web-ding` 命名空间的
  `signal` 字段(经 `settings.update`,走官方 `settings/document-updated`
  广播镜像到浏览器)。Host **绝不**发声,也绝**不**发起 Windows/系统通知。
- **Client 半部**(`web/client.js`)订阅该命名空间,收到 `at` 严格更新的
  `done` 信号后用 **Web Audio API 纯前端合成**"叮"(三个正弦振荡器叠加 +
  指数衰减包络,无音频资产)。声音只发生在浏览器标签页里。

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
- `enabled=false` 时宿主仍监听但跳过发布,客户端也不播(双端都有闸)。
- 所有监听器与发布路径**绝不抛入事件派发**:异常记日志并 settle。
- 新增 Web Audio/UI 能力时保持"纯前端合成、零资产、零系统通知"的红线。
