---
name: pi-plan
description: Structured read-only task planning with PlanBoard checklist, 3-way execution window choice (Execute Here vs Clean New Window Handoff vs Clean Subagent), and live [ ] -> [/] -> [x] step check-offs. Use when invoked via /pi-plan, when the user asks to list tasks before executing, or on complex multi-file (>= 3 step) changes.
---

# PI PlanBoard & Clean-Session Handoff (`/pi-plan`)

Ported from `pi-desktop`'s **Plan Mode + PlanBoard + Clean Handoff** workflow.

## Step 1: Parallel Read-Only Discovery & Plan Creation

1. Batch independent `read_file` / search calls in parallel to verify all relevant files, line ranges, and constraints before proposing steps.
2. Call `pi_plan` with `action: "set"` and `planMode: true` (passing `conversationId` from `<pi_session>` if present):
   - Keep each step Small-CL sized (3–7 steps typical).
   - Populate `title`, `files` (File Touch List), `description`, and `verify` (concrete test/check command) per step.
   - While `planMode: true` is set, the `PreToolUse` hook enforces a **hard read-only gate** so no workspace code can be modified prematurely.

## Step 2: Present Checklist & Ask Execution Window Choice

1. Output the concise numbered task checklist in chat and include the side-panel shortcut pill once:
   `[📋 打开 PI Hub 看板](sidecar://pi-kit/pi_hub/)`
2. Immediately call `ask_question` so the user can choose how to execute:
   - **Question**: `"任务清单已就绪，请选择执行方式（也可在右侧 PI Hub 看板微调步骤后启动）："`
   - **Options**:
     - `(Recommended) ▶ 在当前窗口直接执行（解除只读闸门，原地按序推进并实时打勾）`
     - `✨ 开启全新独立窗口净室执行（Clean Handoff：在左侧栏新建零噪音对话并自动挂载同一份看板）`
     - `🤖 派发净室子代理后台执行（当前窗口保持干净做架构审查，子代理执行完汇报）`

## Step 3: Execute & Check Off Live (`[ ]` → `[/]` → `[x]`)

- **If Current Window**:
  1. Call `pi_plan(action="set_mode", planMode=false)` to unlock the read-only gate and mark Step 1 `in_progress`.
  2. For each step `i`:
     - Before editing: ensure `pi_plan(action="update_step", stepId=..., status="in_progress")` is set, and emit a compact status line (`[/] (i/N) 正在执行：...`).
     - Perform the surgical edit and run the step's verification check.
     - Immediately call `pi_plan(action="update_step", stepId=..., status="done")` and emit the checked-off line (`[x] (i/N) 已完成：...`).
- **If Clean New Window (`✨ 开启全新独立窗口净室执行`)**:
  - Call `pi_plan(action="handoff_new_window", title="...", contextNotes="<汇总已查证的关键文件路径、行号与约束>")`.
  - Report the newly launched window title / conversation ID so the user can switch to it in the left sidebar (or via PI Hub).
- **If Clean Subagent (`🤖 派发净室子代理后台执行`)**:
  - Call `pi_plan(action="set_mode", planMode=false)` and launch `invoke_subagent(TypeName="self", Role="Plan Executor", Prompt="...")` passing the `conversationId` and full step list so it ticks off `pi_plan(action="update_step")` as it works.
