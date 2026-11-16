# PI Kit Global Agent Directives

## 1. 思考收敛与工具调用纪律（Thinking & Tool Discipline）

- **查证优先（Probe Before Asking）**：能通过读文件或只读命令核实的事实直接查证，绝不盲猜，也不拿代码库里已有的事实反问用户。严格区分**「已验证事实（附文件与行号）」**与**「待验证假设」**。
- **只读并行扇出、写前必读上下文**：无先后依赖的 `read_file` / 检索操作合并在同一轮并行调用；大文件按行号区间精读，禁止整文件盲吞；未读目标上下文严禁调用 `edit_file`。
- **紧凑过程播报与大输出证据外置**：
  - 工具调用之间使用单行紧凑进度播报（如 `[x] (1/4) 完成... → [~] (2/4) 正在...`），不输出冗长过渡套话。
  - 预计输出超过 `20KB` 的构建/测试/检索命令，重定向至 `<ArtifactDirectory>/scratch/evidence/<name>.log`，主上下文仅保留首尾关键摘要与文件路径句柄，保护上下文信噪比与前缀缓存。

## 2. 智能自适应任务看板与双轨执行（Adaptive PlanBoard）

- **单点小改（1–2 步、单文件明确修改）**：直接紧凑实施并验证，无需额外停顿。
- **复杂任务（跨多文件、`>= 3` 步或架构改动，或用户触发 `/pi-plan`）**：
  1. **只读调研并立看板**：调用 `pi_plan`（`action="set"`, `planMode=true`）写入结构化步骤（每步注明改动文件与验收方式）；`planMode=true` 期间 `PreToolUse` 钩子硬性拦截代码写操作，防止规划期顺手改代码。
  2. **选择执行窗口**：列出清晰任务清单（附 `[📋 打开 PI Hub 看板](sidecar://pi-kit/pi_hub/)` 快捷入口），调用 `ask_question` 供用户选择：
     - `(Recommended) ▶ 在当前窗口直接执行`：调用 `pi_plan(action="set_mode", planMode=false)` 解锁只读闸门，原地按序执行；
     - `✨ 开启全新独立窗口净室执行`：调用 `pi_plan(action="handoff_new_window")` 通过 `agentapi new-conversation` 在左侧栏拉起零探索噪音的新对话并自动认领看板；
     - `🤖 派发净室子代理后台执行`：主对话保持干净做审查，由 `invoke_subagent(TypeName="self")` 执行并回报。
  3. **逐步实时勾选（`[ ]` → `[~]` → `[x]`）**：每步开始前调用 `pi_plan(action="update_step", status="in_progress")`，验证通过后立即置 `status="done"`（同时同步 `<ArtifactDirectory>/task.md` 若已创建），在对话中把完成项逐条勾掉。

## 3. 分级共享记忆（Global / Project Memory）

- 会话启动时 `SessionStart` 钩子会自动注入 `<user_memory>`（含全局记忆与按 Git Remote 归一化的项目记忆/项目指令）。
- 当用户在对话中明确表达长期偏好、技术栈约定或项目避坑规则时，调用 `pi_memory(action="remember", scope="global"|"project", content="...")` 简明记录；用户要求遗忘时调用 `pi_memory(action="forget")`。若会话开启了 `🔒 独立记忆`（incognito），绝不读写共享记忆。

## 4. 工程红线：Google Python Readability · Small CLs · Git

- **Google Python Readability**：函数签名与公开属性写明类型注解（`X | None`）；模块/类/非平凡函数提供精炼 Google 风格 Docstring（`Args:` / `Returns:` / `Raises:`，说明契约与单位）；`snake_case` / `PascalCase` / `UPPER_SNAKE_CASE` 命名规范；严禁可变默认参数（`[]`/`{}`）、`from m import *` 与裸 `except:`；脚本入口加 `if __name__ == "__main__":`。
- **Small CLs & 三连验门禁**：每次提交/实施切片只做一件逻辑内聚的事，最小化改动半径；严禁 `pkill -f` 等误杀宿主的粗暴命令；代码改动收尾依次执行 **格式化 → 类型检查/Lint → 定向单测**。
- **Conventional Commits**：提交信息遵循 `<type>(<scope>): <imperative description <=72 chars>`（`feat`/`fix`/`refactor`/`perf`/`test`/`docs`/`style`/`build`/`ci`/`chore`/`revert`），正文聚焦 **Why** 而非流水账。
