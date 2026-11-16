#!/usr/bin/env node
/**
 * SessionStart Lifecycle Hook for `pi-kit`:
 * 1. Records exact `conversationId`, `cwd`, and `artifactDirectoryPath`.
 * 2. Detects Clean-Session Handoff tokens (`[PI_HANDOFF:<id>]`) in `lastUserInput` and binds the PlanBoard checklist.
 * 3. Injects `<pi_session>` identity + `<user_memory>` (Global + normalized Git Project Memory) ONCE at session start,
 *    keeping subsequent turns 100% prefix-cache stable.
 */
import { PiMemoryStore } from "../lib/memory-core.mjs";
import { formatPlanMarkdown, PiPlanStore } from "../lib/plan-goal-core.mjs";
import { readStdinJson, recordSessionContext } from "../lib/session-context.mjs";

async function main() {
  let input = {};
  try {
    input = await readStdinJson();
  } catch {
    process.stdout.write("{}\n");
    return;
  }

  const ctx = recordSessionContext(input);
  const conversationId = input.conversationId || ctx?.conversationId || "";
  const cwd = input.cwd || input.workspacePaths?.[0] || ctx?.cwd || "";

  const blocks = [];
  if (conversationId) {
    blocks.push(
      `<pi_session conversation_id="${conversationId}" workspace="${cwd || "standalone-chat"}" hub_link="sidecar://pi-kit/pi_hub/" />`,
    );
  }

  // Check if this brand-new conversation was spawned by Clean-Session Handoff!
  if (conversationId && input.lastUserInput) {
    try {
      const planStore = new PiPlanStore();
      const claimed = planStore.claimHandoffFromPrompt(conversationId, input.lastUserInput);
      if (claimed) {
        if (input.artifactDirectoryPath) {
          claimed.artifactDir = input.artifactDirectoryPath;
          planStore.mirrorToArtifactTaskMd(claimed);
        }
        blocks.push(`<pi_clean_handoff_plan>\n${formatPlanMarkdown(claimed)}\n</pi_clean_handoff_plan>`);
      }
    } catch {
      // Non-fatal handoff claim error.
    }
  }

  // Inject Global + Project memories once at SessionStart (skipped automatically if incognito).
  try {
    const memoryStore = new PiMemoryStore();
    const memoryBlock = memoryStore.buildPromptInjection({ cwd, conversationId });
    if (memoryBlock) blocks.push(memoryBlock);
  } catch {
    // Non-fatal memory read error.
  }

  if (blocks.length === 0) {
    process.stdout.write("{}\n");
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: blocks.join("\n\n"),
          },
        },
      ],
    })}\n`,
  );
}

main().catch(() => {
  process.stdout.write("{}\n");
});
