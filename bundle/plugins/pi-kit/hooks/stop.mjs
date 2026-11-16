#!/usr/bin/env node
/**
 * Stop Lifecycle Hook for `pi-kit`:
 * 1. Goal Mode 2.0 Referee: runs Git Diff SHA-256 stagnation circuit breaker & requires independent `pi-goal-reviewer` verdict.
 * 2. PlanBoard Completion Nudge: if a plan is actively executing (`planMode === false`), has an `in_progress` step,
 *    and `!continuationActive`, reminds once so the agent doesn't forget to tick `[x]` or finish remaining steps.
 */
import { PiGoalStore, PiPlanStore } from "../lib/plan-goal-core.mjs";
import { readStdinJson, recordSessionContext } from "../lib/session-context.mjs";

async function main() {
  let input = {};
  try {
    input = await readStdinJson();
  } catch {
    process.stdout.write(JSON.stringify({ decision: "stop" }) + "\n");
    return;
  }

  recordSessionContext(input);
  const conversationId = input.conversationId || "";
  const cwd = input.cwd || input.workspacePaths?.[0] || "";
  const terminationReason = input.terminationReason || "";
  const continuationActive = Boolean(input.continuationActive);
  const errorText = input.error || "";

  // Never override explicit user cancellation or token/invocation hard caps.
  if (
    !conversationId ||
    ["USER_CANCELED", "MAX_INVOCATIONS", "MAX_FORCED_INVOCATIONS", "MAX_TOKEN_BUDGET_EXCEEDED"].includes(
      terminationReason,
    )
  ) {
    process.stdout.write(JSON.stringify({ decision: "stop" }) + "\n");
    return;
  }

  // 1. Goal Mode 2.0 evaluation (handles both NO_TOOL_CALL and ERROR stagnation tracking)
  try {
    const goalStore = new PiGoalStore();
    const evalRes = await goalStore.evaluateOnStop(conversationId, {
      cwd,
      errorText,
      continuationActive,
    });
    if (evalRes.shouldContinue && terminationReason === "NO_TOOL_CALL") {
      process.stdout.write(
        JSON.stringify({
          decision: "continue",
          reason: evalRes.reason,
        }) + "\n",
      );
      return;
    }
  } catch {
    // Non-fatal goal evaluation error.
  }

  // 2. PlanBoard single-shot reminder if steps remain `in_progress` during normal completion
  if (terminationReason === "NO_TOOL_CALL" && !continuationActive && !errorText) {
    try {
      const planStore = new PiPlanStore();
      const plan = planStore.getPlan(conversationId);
      if (plan && !plan.planMode && Array.isArray(plan.steps) && plan.steps.length > 0) {
        const inProg = plan.steps.filter((s) => s.status === "in_progress");
        const pending = plan.steps.filter((s) => s.status === "pending");
        if (inProg.length > 0) {
          const titles = inProg.map((s) => `${s.id}: ${s.title}`).join("; ");
          process.stdout.write(
            JSON.stringify({
              decision: "continue",
              reason:
                `[PI PlanBoard 检查] 当前仍有步骤处于进行中 (${titles})，尚未勾选完成（剩余待执行 ${pending.length} 步）。` +
                `若已完成当前步，请调用 \`pi_plan(action="update_step", status="done")\` 勾选并继续下一步；若需等待用户指示，请将阻塞步标为 pending/failed 后说明原因。`,
            }) + "\n",
          );
          return;
        }
      }
    } catch {
      // Non-fatal plan check error.
    }
  }

  process.stdout.write(JSON.stringify({ decision: "stop" }) + "\n");
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "stop" }) + "\n");
});
