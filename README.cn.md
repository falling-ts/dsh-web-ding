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
| Host(`index.js` + `src/`) | 监听 `agent/status` 的 **idle 转变**(全部轮次与子代理结束、下一次人为对话之前;新建会话从未运行过的首次 idle 与重复 idle tick 都保持静默)。向 `falling-ts-web-ding` 设置命名空间写入 `{ phase:'done', at, sessionId }`。绝不发声、绝不调用系统。 |
| 浏览器(`web/client.js`) | 经 `settingsScope` 实时镜像命名空间;收到 `at` 严格更新的 `done` 信号后用 Web Audio API 合成一声短"叮",经标签页播放——同一瞬间在右下角弹出 Win11 风格 toast。点击 toast 展开右侧消息列表,展示全部回合结束消息(存在浏览器 localStorage,上限 100、按 signal `at` 去重),支持单条删除与全部删除。全程纯前端:后端不发声、不弹系统通知。 |

除了提示音,每次回合结束还会在右下角弹出一条 Win11 风格 toast(6 秒自动消失)。点击它即可打开右侧消息列表:最近 100 条回合结束消息保存在浏览器 localStorage(键 falling-ts-web-ding.notify.v1),每条可单独删除,顶部"全部删除"按钮一键清空。消息记录纯前端——Host 不读也不写。

## 安装

```bash
dsh plugin --profile web add github:falling-ts/dsh-web-ding
```

(需要 Web 应用带上 client bundle——`package.json` 的 `dsh.client` 声明会自动
完成。)

## 配置(`falling-ts-web-ding` 命名空间,$DSH_HOME/settings.yaml)

| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| `enabled` | boolean | `true` | 总开关(关闭时 Host 跳过发布)。 |
| `volume` | number 0..1 | `0.7` | Web Audio 播放音量。 |
| `freq` | number 80..4000 | `880` | "叮"的基频(Hz)。 |
| `decayMs` | number 100..4000 | `900` | 音色衰减时长(ms)。 |

也可以在 **设置 → 回合结束提示音** 面板里调整,面板带"试听"按钮。

任何会话的 agent 回合结束(转入空闲)都会提示;同一会话内重复 idle tick 与新建后从未运行过的会话保持静默。

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

![设置页——「回合结束提示音」分区,各旋钮免重启实时可调](assets/setting-ding.png)

*设置页——「回合结束提示音」分区:总开关、音量、频率、衰减时长全部免重启
实时可调,并带"试听"按钮预热浏览器 AudioContext。*

---

## License

MIT
