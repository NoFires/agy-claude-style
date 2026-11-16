#!/usr/bin/env node
/**
 * PreToolUse Lifecycle Hook for `pi-kit`:
 * 1. Enforces always-on safety redlines (`pkill -f` hard block, destructive git `force_ask`).
 * 2. Enforces Plan Mode (`planMode === true`) hard read-only gate:
 *    - Blocks `edit_file`
 *    - Blocks `write_file` outside `artifactDirectoryPath`
 *    - Blocks `run_command` unless `isShellCommandReadOnly(CommandLine)` passes
 */
import { resolve } from "node:path";
import { checkHighRiskCommand, isShellCommandReadOnly, PiPlanStore } from "../lib/plan-goal-core.mjs";
import { readStdinJson, recordSessionContext } from "../lib/session-context.mjs";

function isInsideDir(targetPath, parentDir) {
  if (!targetPath || !parentDir) return false;
  const normTarget = resolve(String(targetPath)).replace(/\/+$/, "");
  const normParent = resolve(String(parentDir)).replace(/\/+$/, "");
  return normTarget === normParent || normTarget.startsWith(`${normParent}/`);
}

async function main() {
  let input = {};
  try {
    input = await readStdinJson();
  } catch {
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
    return;
  }

  recordSessionContext(input);
  const conversationId = input.conversationId || "";
  const artifactDir = input.artifactDirectoryPath || "";
  const toolName = input.toolCall?.name || "";
  const args = input.toolCall?.args ?? {};

  // 1. Always-on high-risk command guard
  if (toolName === "run_command") {
    const cmd = String(args.CommandLine ?? args.command ?? "");
    const safety = checkHighRiskCommand(cmd);
    if (safety.action === "deny") {
      process.stdout.write(JSON.stringify({ decision: "deny", reason: safety.reason }) + "\n");
      return;
    }
    if (safety.action === "force_ask") {
      process.stdout.write(JSON.stringify({ decision: "force_ask", reason: safety.reason }) + "\n");
      return;
    }
  }

  // 2. Plan Mode hard read-only gate
  if (conversationId) {
    const planStore = new PiPlanStore();
    const plan = planStore.getPlan(conversationId);
    if (plan?.planMode) {
      if (toolName === "edit_file") {
        process.stdout.write(
          JSON.stringify({
            decision: "deny",
            reason:
              "Blocked by PI Plan Mode (read-only gate): finish listing tasks and ask the user to choose '▶ 本窗口执行' or '✨ 新窗口净室执行' before modifying files (unlock via pi_plan action='set_mode', planMode=false).",
          }) + "\n",
        );
        return;
      }
      if (toolName === "write_file") {
        const targetPath = args.Path ?? args.path ?? "";
        if (!isInsideDir(targetPath, artifactDir)) {
          process.stdout.write(
            JSON.stringify({
              decision: "deny",
              reason:
                "Blocked by PI Plan Mode (read-only gate): writing workspace files is disabled during planning (only artifact files inside artifactDirectoryPath are permitted). Ask the user to confirm execution mode first.",
            }) + "\n",
          );
          return;
        }
      }
      if (toolName === "run_command") {
        const cmd = String(args.CommandLine ?? args.command ?? "");
        if (!isShellCommandReadOnly(cmd)) {
          process.stdout.write(
            JSON.stringify({
              decision: "deny",
              reason:
                `Blocked by PI Plan Mode (read-only gate): shell command is not in the read-only allowlist (${cmd.slice(0, 80)}). Use read_file or read-only git/rg/ls commands during planning, or unlock Plan Mode after user confirmation.`,
            }) + "\n",
          );
          return;
        }
      }
    }
  }

  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
});
