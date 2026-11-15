<div align="center">

<img src="assets/clawd-banner.svg" alt="AGY Claude Style — Clawd Mascot Banner" width="880" />

# 🦀✨ AGY Claude Style (`agy-claude-style`)

**让会眨眼、会摸鱼、还能被挠痒痒的像素小螃蟹 `Clawd` 陪你在 Google Antigravity 里写代码** `(๑•̀ㅂ•́)و✧`

为 **Google Antigravity**（Windows / macOS / Linux）打造的一体化界面重塑、多语言本地化与 Token HUD 遥测增强插件。<br/>
基于 Antigravity 内置 **Chrome DevTools Protocol（CDP）** 调试端口实现无损动态注入——**不改动任何原版安装文件**，支持热更新与一键无痕退潮还原 🌊

<p>
  <a href="#clawd-饲养指南"><img src="https://img.shields.io/badge/Clawd_Mascot-19_Animations-D97757?style=flat-square" alt="Clawd Mascot: 19 Animations" /></a>
  <a href="#快速开始"><img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4D6BFE?style=flat-square" alt="Platform: Windows | macOS | Linux" /></a>
  <a href="#核心特性"><img src="https://img.shields.io/badge/i18n-5_Languages-E2A45F?style=flat-square" alt="i18n: 5 Languages" /></a>
  <a href="#环境要求"><img src="https://img.shields.io/badge/Zero--Mod-CDP_Live_Inject-63C59A?style=flat-square" alt="Zero-Mod: CDP Live Inject" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-8FA4FF?style=flat-square" alt="License: MIT" /></a>
</p>

[✨ 核心特性](#核心特性) · [🦀 Clawd 饲养指南](#clawd-饲养指南) · [🚀 马上领养](#快速开始) · [⚙️ 配置调教](#配置说明) · [🗂️ 项目结构](#项目结构) · [💌 来源声明](#来源声明)

</div>

> [!NOTE]
> **来源声明**：本项目基于 [0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style) 扩展构建；灵感及部分源码来源于 [Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style)；6 套双模式极光毛玻璃主题来源于 [MCRYII/antigravity-custom-themes](https://github.com/MCRYII/antigravity-custom-themes)；Codex 思考强度滑杆样式来源于 [Microqian2th/dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider)；梁武峰思考强度滑杆样式来源于 [mobius/dsh-performance-slider](https://github.com/mobius/dsh-performance-slider)。详见 [来源声明](#来源声明)。

---

<a id="目录"></a>
## 🗺️ 目录

- [✨ 核心特性](#核心特性)
- [🦀 小螃蟹 Clawd 饲养指南](#clawd-饲养指南)
- [🎒 环境要求](#环境要求)
- [🚀 快速开始](#快速开始)
  - [🪟 方式一：Windows 独立安装器（目标机器无需 Node.js）](#方式一windows-独立安装器目标机器无需-nodejs)
  - [🍎 方式二：macOS 独立应用（目标机器无需 Node.js）](#方式二macos-独立应用目标机器无需-nodejs)
  - [💻 方式三：Node.js 脚本模式（Windows / macOS / Linux）](#方式三nodejs-脚本模式windows--macos--linux)
- [⚙️ 配置说明 (`config.json`)](#配置说明)
- [🗂️ 项目结构](#项目结构)
- [🧪 开发、测试与构建](#开发测试与构建)
- [💌 来源声明](#来源声明)
- [📜 开源协议](#开源协议)

---

<a id="核心特性"></a>
## ✨ 核心特性

### 🌌 1. Studio 首页、9 套双模式极光配色与会呼吸的字符波纹海
- **9 套深浅自适应配色 + 顶部胶囊切换器**：除 `obsidian`（深邃蓝黑）、`claude` 与 `host`（跟随宿主）外，内置 **6 套双模式极光玻璃拟态主题**（`gemini` 四色极光/暗夜极光、`sky` 蔚蓝晴空/深海晴空、`cyan` 碧水青波/幽谷碧波、`orange` 落霞暖橙/熔岩暮色、`red` 丹霞绯红/丝绒酒红、`purple` 紫罗幽兰/幻夜幽紫），可通过窗口右上角一键主题胶囊（`#ag-cs-theme-selector`）或 `设置 → 外观` 随时切换 🎨。
- **实时字符矩阵波纹场 (`homeRipple`)**：在首页铺设等宽字母数字二维波动网格，带云雾漂移氛围效果；轻点空白处就像把小石子丢进字符星空，触发柔和的阻尼水波纹扩散动画 `~(˘▾˘~)`。
- **编程用量仪表盘 (`概览` / `模型` · `全部` / `30 天` / `7 天`)**：自动聚合本地对话轨迹并剔除子代理重复会话计数，展示 6 项核心指标（会话数、消息数、Token 总量、活跃天数、高峰时段、最常用模型）、`26×7` 周日历热力图、30d/7d 模型堆叠柱状图，以及**60+ 本经典著作 Token 折算标尺**——悄悄告诉你今天写的代码相当于读了几本《爱丽丝漫游奇境》或《哈利·波特》📖✨。

### ⌨️ 2. 极简重排输入框、丝滑光标与温柔侧栏
- **极简输入框 (`composerRestyle`)**：将工作区与环境选择胶囊重排为 `28px` 极简细边样式，底栏控件轻巧落于画布之上，支持 `studio` / `host` 提示占位风格（`placeholderStyle`）。
- **丝滑打字光标 (`smoothCaret`)**：为输入框渲染平滑插值位移动画光标（`.ag-cs-smooth-caret`），兼容多行换行与中文输入法（IME）候选输入态，敲字像德芙一样丝滑 🍫。
- **侧栏样式优化 (`sidebarRestyle` / `sidebarCompact`)**：统一侧边栏行高与悬停高亮板，支持开启更紧凑的条目间距。

### 🎚️ 3. 三风格交互式思考强度滑块 (`effortSliderStyle`)
点击模型名旁的思考强度徽章（`Low` / `Medium` / `High` / `XHigh` / `Max` 等级映射，并保留宿主 `Extra` 标识），弹出可视化推理档位滑块调节器：
- **Claude Code (`claude`)**：5 行动态矩阵噪声点阵、发光竖向胶囊滑块与 `effortAccent` 蓝紫渐变色阶。
- **ChatGPT Codex (`chatgpt`)**：蓝→紫渐变进度条、高档位星云扫光、星空粒子及阻尼刻度手感 ✨。
- **梁武峰 (`liangwufeng`)**：内置 31 帧 320×320 WebP 抠像人像背景，支持 `performanceBackdrop`（`card` 卡片内 / `page` 全窗口 / `off` 关闭）三种渲染模式。

### 📊 4. 贴心 Token HUD 与右下角电量小圆环
- **右下角剩余用量圆环 (`ringMode`)**：支持在**当前上下文剩余可用百分比 (`context`)** 与**模型配额剩余百分比 (`quota`)** 之间切换，随剩余容量动态变色提示（🔵 `>30%` 元气满满 · 🟡 `≤30%` 注意补水 · 🔴 `≤10%` 快见底啦）；点击圆环直达对应标签页。
- **每轮对话 Token 徽章 (`turnBadges`)**：在每轮 AI 回复底部展示 `#T{n}` 模型名、上下文总量与本轮增量、输出与思考 Token、工具调用次数、子代理汇总、输出速率（`tok/s`）及缓存命中率。
- **4 标签页深度遥测浮窗**：
  - **上下文拆分**：展示系统提示与规则、工具声明、对话历史消息、工具执行结果明细（支持展开查看）、实时草稿 Token 估算，并提供一键填充 `/compact` 与复制遥测报告操作。
  - **对话轮次**：按轮次回溯上下文增长与每轮耗时速率详情。
  - **工具与子代理**：统计子代理调用明细与工具结果 Token 排行榜。
  - **模型配额**：实时查看各模型配额池剩余百分比与 5h / 周重置倒计时 ⏳。
- **可选环绕式 HUD**：提供 `hudTopBar`、`hudBottomBar`、`hudRimProgress`、`hudFooterChip`、`hudCompact` 五项可折叠增强开关，默认关闭，按需启用。

### 🦀 5. 像素螃蟹小跟班 `Clawd` (`mascot`)
- 在输入框右上角蹲着一只超有戏的像素小螃蟹 `Clawd`（内置 **19 套双层精灵图动画**），会跟着对话节奏在 `idle`、`thinking`、`typing`、`error`、`sleeping`、`waking` 等状态间切换，无聊了还会自己抱着小本本摸鱼或对你招手 👋。
- **礼貌满分**：当输入框上方出现排队消息、`/` 命令菜单或问答确认卡片时，Clawd 会自觉调整留白或悄悄躲起来，绝不遮挡发送、编辑、删除等按钮。

### 🌐 6. 5 语言全局切换 & 设置面板原生集成
- **5 语言全局本地化 (`language`)**：支持 **简体中文 (`zh-CN`) / 繁體中文 (`zh-TW`) / 粵語 (`yue`) / English (`en`) / 日本語 (`ja`)** 实时切换，作用于整个 Antigravity UI 及插件面板；自动跳过代码编辑器、终端、对话正文与 `data-ag-no-i18n` 保护区，移除插件时无损还原。
- **原生设置集成**：在 Antigravity `设置 → 外观` 底部自动注入 3 组共 20 项可视化开关，修改通过 CDP `Runtime.addBinding` 即时生效并持久化写入 `config.json`。

---

<a id="clawd-饲养指南"></a>
## 🦀 小螃蟹 Clawd 饲养指南

Clawd 是由 [crab-assets.js](crab-assets.js) 与 [mascot-core.js](mascot-core.js) 驱动的双层像素小生命，住在你的输入框右上角 🏡：

<div align="center">
  <img src="assets/clawd-moods.svg" alt="Clawd 5 Iconic Pixel Moods" width="880" />
</div>

### 🎮 怎么和 Clawd 互动？（彩蛋全收录）

| 互动方式 | 触发方法 | Clawd 的反应 |
| --- | --- | --- |
| 👉 **轻戳小钳子** | 单击 Clawd 的左半边或右半边身体 | 害羞扭头给你看不同方向的小动作 (`poke-left` / `poke-right`) |
| 🤭 **疯狂挠痒痒** | `450ms` 内快速连点 Clawd **4 下** | 触发爆笑踢腿大反应 (`tickle`)，眼睛笑成 `^ ^`！ |
| 🤏 **拎起来晃一晃** | 按住鼠标左键拖拽 Clawd | 进入悬空手舞足蹈模式 (`drag`)，松手才乖乖落地 |
| 💤 **挂机小憩** | 对话安静超过 **60 秒** | 自动缩成一团进入 `sleeping` 呼呼模式，点一下或发消息立刻伸懒腰 `waking` |
| 🎉 **任务报喜** | AI 回复完成或出现错误时 | 成功了开心蹦跶 (`happy`)，出错了也会陪你慌张一下 (`error`) |

<details>
<summary>🎀 <b>点此展开：偷看 Clawd 的全部 19 套双层精灵图档案</b></summary>

- **日常发呆 & 随机彩蛋**：`idle`（待机呼吸）、`idle-look`（左顾右盼）、`idle-wave`（举钳打招呼）、`idle-laptop`（抱着迷你笔记本敲代码）
- **认真营业中**：`thinking`（托腮冒气泡思考）、`typing`（哒哒哒飞速打字）、`building`（敲敲打打搞建设）、`compacting`（打包整理上下文）、`music`（戴上小耳机听歌）、`conducting`（挥舞指挥棒）
- **心情与睡眠**：`happy`（撒花蹦跶）、`notification`（来新消息啦）、`error`（哎呀报错了）、`sleeping`（冒着 `Zzz` 睡觉）、`waking`（睡醒伸懒腰）
- **玩家互动专属**：`poke-left`（被戳左边）、`poke-right`（被戳右边）、`tickle`（怕痒爆笑）、`drag`（被拎起来晃）

</details>

---

<a id="环境要求"></a>
## 🎒 环境要求

- **Google Antigravity Desktop**：运行中且开启了内置 CDP 调试端口（插件会自动读取系统用户目录下的 `Antigravity/DevToolsActivePort` 文件，也可通过环境变量 `AG_CDP_PORT` 或安装器 `--cdp-port` 参数显式指定端口）：
  - Windows：`%APPDATA%\Antigravity\DevToolsActivePort`
  - macOS：`~/Library/Application Support/Antigravity/DevToolsActivePort`
  - Linux：`${XDG_CONFIG_HOME:-~/.config}/Antigravity/DevToolsActivePort`
- **Node.js >= 22**（仅脚本模式、测试与从源码构建安装器需要）：项目零第三方 npm 依赖，直接使用 Node.js 内置的 `fetch`、`WebSocket` 与 `node:test`。
- **.NET Framework 4.x (`csc.exe`)**（仅在 Windows 上从源码构建 `installer.exe` 时需要，Windows 10/11 系统默认自带）。
- **Xcode Command Line Tools (`swiftc`)**（仅在 macOS 上从源码构建 `.app` / `.dmg` 时需要，macOS 安装命令行工具后自带）。

---

<a id="快速开始"></a>
<a id="方式一windows-独立安装器目标机器无需-nodejs"></a>
## 🚀 快速开始

> [!TIP]
> **三端开箱即用**：可直接前往仓库 [Releases](../../releases) 下载 GitHub Actions 自动编译发布的三端安装包：
> - **Windows**：`installer.exe`（目标机器无需安装 Node.js）
> - **macOS (Apple Silicon + Intel Universal)**：`AGY-Claude-Style-macOS-universal.dmg`（目标机器无需安装 Node.js）
> - **Linux**：`AGY-Claude-Style-linux.tar.gz`（解压运行 `./install-linux.sh` 自动部署 `systemd --user` 自启守护）

### 🪟 方式一：Windows 独立安装器（目标机器无需 Node.js）

1. 直接从 [Releases](../../releases) 下载 `installer.exe`，或在已安装 Node.js >= 22 的 Windows 环境克隆仓库从源码构建：
   ```bash
   npm run build:installer
   ```
   构建完成后会在项目根目录生成带有像素螃蟹图标的单文件 `installer.exe` 🦀。

2. 双击运行 `installer.exe`（可分发到未安装 Node.js 的 Windows 电脑直接运行）：
   - 自动检测本机 Antigravity Desktop，并将独立运行环境与插件资源部署至 `%LOCALAPPDATA%\agy-claude-style`。
   - 若安装目录已存在 `config.json`，升级/重装时自动保留原有用户配置；全新安装则写入默认配置。
   - 自动注册 Windows 开机自启快捷方式（`AGY-Claude-Style.lnk`）与「设置 → 应用」卸载项，并启动后台静默守护进程 `agy-claude-style-watcher.exe` 实时注入当前及后续新开窗口。
   - 如需卸载，可在安装器界面点击「卸载并恢复原版」，或在 Windows「设置 → 应用」中卸载。

3. 安装器支持的命令行参数：
   ```text
   installer.exe [--silent | /S | -s] [--uninstall] [--status]
                 [--no-autostart] [--no-kill-legacy]
                 [--install-dir <路径>] [--cdp-port <端口>]
                 [--out <结果JSON路径>] [--popup]
   ```

---

<a id="方式二macos-独立应用目标机器无需-nodejs"></a>
### 🍎 方式二：macOS 独立应用（目标机器无需 Node.js）

1. 直接从 [Releases](../../releases) 下载 `AGY-Claude-Style-macOS-universal.dmg`，或在已安装 Node.js >= 22 与 Xcode Command Line Tools 的 macOS 环境从源码构建：
   ```bash
   npm run build:macos
   ```
   构建完成后会在项目根目录生成通用架构（`arm64` + `x86_64`）的 `AGY Claude Style.app` 与 `AGY-Claude-Style-macOS-universal.dmg` 🦀。

2. 打开 `.dmg`，将 `AGY Claude Style.app` 拖入「应用程序」（或直接双击运行）：
   - 若首次打开时 macOS 提示“无法验证开发者”（Release 构建采用 Ad-hoc 签名），请**右键点击 `AGY Claude Style.app` → 打开**，或在终端执行 `xattr -cr "/Applications/AGY Claude Style.app"`。
   - 自动检测本机 `Antigravity.app`，并将独立运行时与插件资源部署至 `~/Library/Application Support/agy-claude-style`（升级时自动保留已有 `config.json`）。
   - 自动注册 `LaunchAgent`（`~/Library/LaunchAgents/io.github.0dnancy.agy-claude-style.plist`）实现登录自启，并立即启动原生 Swift 后台守护进程 `agy-claude-style-watcher` 实时注入及热更新。
   - 如需卸载，重新打开 `AGY Claude Style.app` 点击「卸载并恢复原版」即可自动停止守护、移除自启并恢复原版界面。

---

<a id="方式三nodejs-脚本模式windows--macos--linux"></a>
### 💻 方式三：Node.js 脚本模式（Windows / macOS / Linux）

1. 克隆仓库并准备配置文件（可选，若不创建 `config.json` 将自动使用内置默认配置）：
   ```bash
   git clone https://github.com/0DNANCY/agy-claude-style.git
   cd agy-claude-style
   cp config.example.json config.json
   ```

2. 按操作系统选择对应启动方式：

   - **Windows**：
     - `watch.bat`（或 `npm run watch`）：**推荐**，无黑框后台启动守护进程（`watch-hidden.vbs`），每 2 秒自动检测并注入新窗口/重载页面，并在 `style.css`、`*.js`、`config.json` 变动时自动热更新。日志输出至 `watch.log`。
     - `inject.bat`（或 `npm run inject`）：单次立即注入当前所有 Antigravity 窗口（窗口刷新后失效）。
     - `remove.bat`（或 `npm run remove`）：停止后台守护进程并无损清除所有注入节点与属性，恢复原生界面。
     - `autostart-on.bat` / `autostart-off.bat`：为当前脚本目录开启或取消 Windows 开机自启。

   - **Linux 一键安装自启服务（推荐）**：
     ```bash
     chmod +x install-linux.sh
     ./install-linux.sh              # 部署至 ~/.local/share/agy-claude-style 并启用 systemd --user 自启服务
     ./install-linux.sh --status     # 查看服务与注入状态
     ./install-linux.sh --uninstall  # 停止服务并无损还原原生界面
     ```

   - **macOS / Linux 脚本直跑**：
     ```bash
     chmod +x *.sh
     ./watch.sh     # 启动后台守护（等价于 nohup node inject.js --watch）
     ./inject.sh    # 单次注入
     ./remove.sh    # 停止守护并恢复原生界面
     ```

> [!TIP]
> 只是想先尝鲜看看小螃蟹？先运行一次 `npm run inject` 就能立刻在 Antigravity 里看到 Clawd；随时想恢复原貌只需 `npm run remove`，干干净净不留痕迹 `(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧`

---

<a id="配置说明"></a>
## ⚙️ 配置说明 (`config.json`)

所有配置均可在 Antigravity `设置 → 外观` 中实时可视化调整，也可以直接编辑 `config.json`（守护模式会自动热更新）。默认模板见 [config.example.json](config.example.json)。

| 配置键 | 可选值 / 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `language` | `'zh-CN'` \| `'zh-TW'` \| `'yue'` \| `'en'` \| `'ja'` | `'zh-CN'` | 🌐 全局界面与插件面板语言（简中/繁中/粤语/英文/日语） |
| `palette` | `'obsidian'` \| `'claude'` \| `'gemini'` \| `'sky'` \| `'cyan'` \| `'orange'` \| `'red'` \| `'purple'` \| `'host'` | `'obsidian'` | 🎨 配色方案（深邃蓝黑 / Claude / 6 套双模式极光玻璃拟态主题 / 跟随宿主） |
| `homeLayout` | `'studio'` \| `'classic'` \| `'off'` | `'studio'` | 🏠 新会话首页布局模式 |
| `homeRipple` | `boolean` | `true` | 🌊 首页交互式字符矩阵波纹背景 |
| `logoInk` | `'accent'` \| `'foreground'` | `'accent'` | ✒️ 首页 Antigravity Logo 线条色调 |
| `composerRestyle` | `boolean` | `true` | 💊 极简胶囊工作区栏与输入框重排 |
| `placeholderStyle` | `'studio'` \| `'host'` | `'studio'` | 💬 输入框占位提示文本风格 |
| `smoothCaret` | `boolean` | `true` | ✨ 输入框丝滑插值打字光标 |
| `sidebarRestyle` | `boolean` | `true` | 📑 侧边栏 Claude 风格行高与悬停高亮 |
| `sidebarCompact` | `boolean` | `false` | 📏 侧边栏紧凑间距模式 |
| `mascot` | `'crab'` \| `'off'` | `'crab'` | 🦀 输入框右上角像素螃蟹挂件 `Clawd` |
| `effortSliderStyle` | `'claude'` \| `'chatgpt'` \| `'liangwufeng'` | `'claude'` | 🎚️ 思考强度滑块浮窗风格 |
| `effortAccent` | `boolean` | `true` | 💜 Claude 模式下启用蓝紫思考强度色阶 |
| `performanceBackdrop` | `'card'` \| `'page'` \| `'off'` | `'card'` | 🖼️ 梁武峰模式下 31 帧人像背景渲染范围 |
| `inlineStats` | `boolean` | `true` | 🍩 启用内嵌会话统计与右下角剩余用量圆环 |
| `ringMode` | `'context'` \| `'quota'` | `'context'` | 🔋 右下角圆环显示上下文剩余或模型配额剩余 |
| `turnBadges` | `boolean` | `true` | 🏷️ 对话流每轮 AI 回复底部显示 Token 徽章 |
| `hudTopBar` | `boolean` | `false` | 📏 输入框顶部上下文进度条 |
| `hudBottomBar` | `boolean` | `false` | 📊 输入框底部详细 HUD 遥测栏 |
| `hudRimProgress` | `boolean` | `false` | 🌈 输入框边框环绕上下文进度条 |
| `hudFooterChip` | `boolean` | `false` | 💠 底栏剩余容量标签胶囊 |
| `hudCompact` | `boolean` | `false` | 🧩 Token HUD 紧凑排版模式 |
| `pollIntervalMs` | `number`（最小 `1500`） | `2500` | ⏱️ 遥测轮询间隔（毫秒） |

---

<a id="项目结构"></a>
## 🗂️ 项目结构

```text
agy-claude-style/
├── .github/workflows/         # GitHub Actions CI 测试与自动构建发布 Release 工作流
│   ├── ci.yml                 # PR / main 分支跨平台测试与编译验证
│   └── release.yml            # 推送 v* 标签或手动触发自动发布 Windows/macOS 安装包
├── assets/                    # README 可爱像素螃蟹 Clawd 视觉插图资源
├── cdp.js                     # CDP WebSocket/HTTP 客户端、页面发现与注入/移除表达式构建
├── inject.js                  # 单次注入与 --watch 热更新守护进程（含设置持久化绑定）
├── remove.js                  # 停止守护进程并清理恢复原生界面
├── config.example.json        # 默认配置文件模板
├── style.css                  # 全套主题调色板、首页 Studio、HUD 与滑块样式
├── ui-runtime.js              # 主运行时：Store/Fiber 桥接、首页仪表盘、HUD 浮窗、设置面板集成
├── i18n-core.js               # 5 语言 DOM 翻译引擎（含保护区与无损还原）
├── i18n-locales.js            # 简中 / 繁中 / 粤语 / 英文 / 日语多语言词典
├── usage-core.js              # 会话轨迹解析、Token 拆分、配额池匹配、热力图与书籍标尺计算
├── effort-core.js             # 推理档位解析、阻尼刻度数学模型与 3 套滑块逻辑
├── mascot-core.js             # 像素螃蟹 Clawd 状态机（休眠、唤醒、反应、状态优先级）
├── ripple-core.js             # 首页字符矩阵噪声与二维水波方程求解器
├── crab-assets.js             # 内置 19 套像素螃蟹双层精灵图（body + ink PNG Data URI）
├── perf-assets.js             # 内置 31 帧 320×320 WebP 人像序列
├── installer/                 # Windows (C#) 与 macOS (Swift) 独立安装器及原生守护进程源码
│   ├── common/
│   │   ├── CdpClient.cs       # C# 轻量 CDP WebSocket 客户端与配置热更新同步
│   │   └── MiniJson.cs        # 零依赖 JSON 解析与序列化
│   ├── setup/
│   │   ├── Program.cs         # Windows 安装/升级/卸载 GUI 与 CLI 入口
│   │   └── app.manifest       # Windows DPI 与清单配置
│   ├── watcher/
│   │   └── Program.cs         # Windows 无窗后台 CDP 守护进程
│   └── macos/
│       ├── Common/            # Swift 零依赖 JSON 解析与 URLSession WebSocket CDP 客户端
│       ├── Setup/main.swift   # macOS Cocoa GUI / LaunchAgent 安装与卸载入口
│       └── Watcher/main.swift # macOS 原生后台 CDP 守护进程
├── scripts/
│   ├── build-common.mjs       # 共享构建工具（图标生成、清单、ZIP 打包）
│   ├── build-installer.mjs    # 编译生成 Windows 独立 installer.exe
│   └── build-macos.mjs        # 编译生成 macOS Universal .app 与 .dmg
├── test/                      # 基于 node:test 的单元测试与安装器 E2E 测试套件
├── watch.bat / watch.sh       # 后台守护启动脚本（Windows 配合 watch-hidden.vbs）
├── inject.bat / inject.sh     # 单次注入脚本
├── remove.bat / remove.sh     # 停止守护与还原脚本
└── autostart-on.bat / off.bat # Windows 开机自启快捷方式管理脚本
```

---

<a id="开发测试与构建"></a>
## 🧪 开发、测试与构建

```bash
# 运行全部单元测试与对应平台的安装器端到端测试（Node.js >= 22）
npm test

# 在 Windows 上从源码编译生成独立 installer.exe
npm run build:installer

# 在 macOS 上从源码编译生成 Universal .app 与 .dmg
npm run build:macos

# 运行单次注入 / 监听热更新 / 卸载还原
npm run inject
npm run watch
npm run remove
```

### 🚀 自动构建与发布 Release

仓库已配置 GitHub Actions 工作流（[release.yml](.github/workflows/release.yml) 与 [ci.yml](.github/workflows/ci.yml)）：
- **推送版本标签自动发布**：推送形如 `v1.0.0` 的标签（`git tag v1.0.0 && git push origin v1.0.0`），会自动在 `windows-latest` 与 `macos-latest` 上完成测试、编译 `installer.exe` 与 `AGY-Claude-Style-macOS-universal.dmg`（附带 `SHA256SUMS.txt`）并自动创建 GitHub Release。
- **手动触发**：也可以在 GitHub 仓库 **Actions → Release → Run workflow** 手动触发编译并发布。

测试套件包含对注入包语法、模拟 DOM 挂载/无损卸载、5 语言翻译引擎、思考强度滑块数学模型、用量统计与配额匹配、二维波纹场、螃蟹状态机，以及 Windows `installer.exe` 与 macOS `.app` 编译/静默安装/CDP 注入/设置同步热更新/保留配置升级/卸载清理全流程的自动化验证。

---

<a id="来源声明"></a>
## 💌 来源声明

本项目在设计与实现过程中参考并使用了以下开源项目的灵感、样式及部分源码，特此声明并致谢 🌸：

- **上游基础项目**：[https://github.com/0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style)
- **项目灵感来源及部分源码来源**：[https://github.com/Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style)
- **6 套双模式极光毛玻璃主题来源**：[https://github.com/MCRYII/antigravity-custom-themes](https://github.com/MCRYII/antigravity-custom-themes)
- **Codex 思考强度滑杆样式**：[https://github.com/Microqian2th/dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider)
- **梁武峰思考强度滑杆样式**：[https://github.com/mobius/dsh-performance-slider](https://github.com/mobius/dsh-performance-slider)

---

<a id="开源协议"></a>
## 📜 开源协议

本项目基于 [MIT License](LICENSE) 开源。

<div align="center">

```text
      ╭───────────────────────────────────╮
      │  "What's up next? Let's ship it!" │
      ╰─────────────────┬─────────────────╯
                 ████████████████
                 ██▀▀████████▀▀██
             ████████████████████████
                 ████████████████
                 ██ ██      ██ ██
```

<sub>愿每一行代码都有小螃蟹默默陪你加油 `(っ˘ω˘ς ) ☕️` · 喜欢的话欢迎点亮右上角 ⭐ Star！</sub>

</div>
