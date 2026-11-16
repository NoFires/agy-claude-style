# Dev Workflow Autopilot (`dev-workflow`)

独立的全局工具链自动调度插件（与 `pi-kit` 解耦，升级 `pi-kit` 不会被覆盖，可在 Customizations 页面随时一键启用/停用）。

## 包含内容

- `rules/AGENTS.md`：常驻系统级路由规则，自动串联：
  1. **Context7**：写 `IsaacLab` / `rsl-rl` / `PyTorch` / `Gymnasium` / `MuJoCo` 等第三方库代码前自动按版本核对真实 API。
  2. **Grill / PlanBoard / Goal 2.0**：方案压测、多步净室执行与独立只读审查闭环。
  3. **CodeRabbit + git-commit**：本地 Small CL 提交前审查、PR `autofix` 逐条确认修复与原子化提交。
  4. **Colab Operator + Google Drive + Project Memory**：云端安全训练、实验产物/求职简历归档与仓库级记忆分层沉淀。
