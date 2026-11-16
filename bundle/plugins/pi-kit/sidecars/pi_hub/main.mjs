/**
 * PI Hub Sidecar Backend (`sidecars/pi_hub/main.mjs`).
 *
 * Powered by Antigravity's native `sidecar_sdk`:
 * - Serves the host-theme-adaptive PI Hub Auxiliary Pane Web UI.
 * - Provides real-time JSON APIs for PlanBoard, Hierarchical Memory + GitHub `pi-memory-sync`, and Goal Mode 2.0.
 * - Exposes a local loopback bridge (`sidecar-bridge.json`, mode 0600) so `pi_plan(action="handoff_new_window")`
 *   can spawn genuine top-level Antigravity conversations preserving `projectId`.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, fileURLToPath as uriToPath } from "node:url";
import { promisify } from "node:util";

const { Response, SidecarApp } = await import(
  process.env.PI_KIT_SIDECAR_SDK_SPECIFIER || "sidecar_sdk"
);

const execFileAsync = promisify(execFile);
import { resolveDataDir, writeJsonAtomic } from "../../lib/atomic-io.mjs";
import { PiMemoryStore, PiMemorySyncClient } from "../../lib/memory-core.mjs";
import {
  computeWorkspaceDiffFingerprint,
  formatPlanMarkdown,
  PiGoalStore,
  PiPlanStore,
} from "../../lib/plan-goal-core.mjs";
import { resolveSessionContext } from "../../lib/session-context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..", "..");

function discoverCapabilities() {
  const skillsDir = join(PLUGIN_ROOT, "skills");
  const skills = [];
  try {
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir).sort()) {
        const mdPath = join(skillsDir, entry, "SKILL.md");
        if (!existsSync(mdPath)) continue;
        const raw = readFileSync(mdPath, "utf8");
        const nameMatch = /^name:\s*(.+)$/m.exec(raw);
        const descMatch = /^description:\s*(.+)$/m.exec(raw);
        const name = (nameMatch?.[1] || entry).trim().replace(/^["']|["']$/g, "");
        const description = (descMatch?.[1] || "").trim().replace(/^["']|["']$/g, "");
        const isNativePiKit = ["pi-plan", "pi-goal", "pi-memory"].includes(name);
        skills.push({ name, description, group: isNativePiKit ? "pi-core" : "pi-agent" });
      }
    }
  } catch {
    // Ignore skill scan errors
  }
  return {
    skills,
    mcpTools: ["pi_plan", "pi_memory", "pi_goal"],
    hooks: ["SessionStart (记忆静态注入 & 净室认领)", "PreToolUse (只读闸门 & pkill 红线)", "Stop (Goal 2.0 Diff 熔断 & 勾选检查)"],
    subagents: ["pi-goal-reviewer (独立只读审查官)"],
  };
}

function uriToFsPath(uriOrPath = "") {
  const s = String(uriOrPath || "").trim();
  if (!s) return "";
  if (s.startsWith("file://")) {
    try {
      return uriToPath(s);
    } catch {
      return s.replace(/^file:\/\//, "");
    }
  }
  return s;
}

const app = new SidecarApp();

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
let lastDevicePollAt = 0;

async function buildSnapshotPayload(rawConvId = "", workspaceUri = "") {
  const workspacePath = uriToFsPath(workspaceUri);
  const ctx = resolveSessionContext(rawConvId, workspacePath, { allowProcessCwd: false });
  const convId = rawConvId || ctx.conversationId;
  const cwd = workspacePath || ctx.cwd || "";

  const memStore = new PiMemoryStore();
  const syncClient = new PiMemorySyncClient(memStore);
  const planStore = new PiPlanStore();
  const goalStore = new PiGoalStore();

  let syncStatus = syncClient.getStatus();
  if (syncStatus.deviceFlow && Date.now() - lastDevicePollAt >= 5000) {
    lastDevicePollAt = Date.now();
    try {
      syncStatus = await syncClient.pollDeviceLoginOnce();
    } catch {
      // Ignore transient network poll errors
    }
  }

  const memList = memStore.list({ scope: "all", cwd, includeDisabled: true });
  const plan = planStore.getPlan(convId);
  const goal = goalStore.getGoal(convId);
  let liveDiff = null;
  if (goal && goal.phase === "active" && cwd) {
    liveDiff = await computeWorkspaceDiffFingerprint(cwd);
  }

  return {
    conversationId: convId,
    cwd,
    incognito: memStore.isIsolated(convId),
    plan,
    allPlans: planStore.listPlans().slice(0, 20),
    planMarkdown: plan ? formatPlanMarkdown(plan) : "",
    memory: {
      identity: memList.identity,
      projectInstructions: memList.projectInstructions,
      globalItems: memList.globalItems,
      projectItems: memList.projectItems,
      allProjects: memList.allProjects,
    },
    sync: syncStatus,
    goal: goal ? { ...goal, liveDiff } : null,
    capabilities: discoverCapabilities(),
    now: Date.now(),
  };
}

process.on("uncaughtException", (err) => {
  console.error(`[pi_hub ${new Date().toISOString()}] uncaughtException:`, err);
});
process.on("unhandledRejection", (err) => {
  console.error(`[pi_hub ${new Date().toISOString()}] unhandledRejection:`, err);
});

// Serve plain HTML via app.page (matching swarm_board) and static assets via GET app.api
// so external scripts/styles comply with strict host CSP and reload without stale inlined state.
app.page("/", () => {
  console.log(`[pi_hub ${new Date().toISOString()}] GET /`);
  return readFileSync(join(__dirname, "index.html"), "utf8");
});

const STATIC_ASSETS = {
  "/styles.css": ["styles.css", "text/css"],
  "/app.js": ["app.js", "application/javascript"],
};

for (const [route, [file, contentType]] of Object.entries(STATIC_ASSETS)) {
  app.api(
    route,
    () =>
      new Response(readFileSync(join(__dirname, file), "utf8"), {
        contentType,
        headers: NO_STORE_HEADERS,
      }),
    "GET",
  );
}

// Unified snapshot endpoint polled by the PI Hub UI
app.api(
  "/api/snapshot",
  async (data) => {
    const conv = data.conversationId || app.config.conversationId || "";
    try {
      return await buildSnapshotPayload(conv, data.workspaceUri || "");
    } catch (err) {
      console.error(`[pi_hub ${new Date().toISOString()}] GET /api/snapshot fail:`, err);
      throw err;
    }
  },
  "GET",
);

// PlanBoard mutations & Clean Handoff preparation
app.api("/api/plan", async (data) => {
  const ctx = resolveSessionContext(data.conversationId || "", uriToFsPath(data.workspaceUri || ""), { allowProcessCwd: false });
  const convId = ctx.conversationId;
  const cwd = ctx.cwd;
  const planStore = new PiPlanStore();

  switch (data.action) {
    case "set_mode":
      return { plan: planStore.setPlanMode(convId, Boolean(data.planMode)) };
    case "update_step":
      return {
        plan: planStore.updateStep(convId, {
          stepId: data.stepId,
          status: data.status,
          title: data.title,
          description: data.description,
        }),
      };
    case "add_step":
      return {
        plan: planStore.addStep(convId, {
          title: data.title,
          description: data.description || "",
        }),
      };
    case "delete_step":
      return { plan: planStore.deleteStep(convId, data.stepId) };
    case "clear":
      planStore.clearPlan(convId);
      return { plan: null };
    case "prepare_handoff": {
      const handoff = planStore.createHandoff(convId, {
        title: data.title,
        contextNotes: data.contextNotes || "",
        cwd,
      });
      return { handoff };
    }
    case "claim_handoff": {
      const claimed = planStore.claimHandoffFromPrompt(data.newConversationId, data.prompt);
      return { plan: claimed };
    }
    default:
      throw new Error(`Unsupported plan action: ${data.action}`);
  }
});

// Memory & GitHub Cloud Sync mutations
app.api("/api/memory", async (data) => {
  const ctx = resolveSessionContext(data.conversationId || "", uriToFsPath(data.workspaceUri || ""), { allowProcessCwd: false });
  const convId = ctx.conversationId;
  const cwd = ctx.cwd;
  const memStore = new PiMemoryStore();
  const syncClient = new PiMemorySyncClient(memStore);

  switch (data.action) {
    case "remember":
      return memStore.remember({
        scope: data.scope || "global",
        content: data.content,
        id: data.id,
        cwd,
        projectKey: data.projectKey || "",
        projectName: data.projectName || "",
        conversationId: data.bypassIncognito ? "" : convId,
      });
    case "toggle_item":
      return {
        item: memStore.toggleItem({
          scope: data.scope || "global",
          id: data.id,
          enabled: data.enabled,
          cwd,
          projectKey: data.projectKey || "",
        }),
      };
    case "forget":
      return {
        removed: memStore.forget({
          id: data.id,
          query: data.query,
          scope: data.scope || "all",
          cwd,
          projectKey: data.projectKey || "",
        }),
      };
    case "set_instructions":
      return {
        bucket: memStore.setProjectInstructions({
          cwd,
          projectKey: data.projectKey || "",
          name: data.projectName || "",
          instructions: data.instructions || "",
        }),
      };
    case "set_incognito":
      return { incognito: memStore.setIsolated(convId, Boolean(data.incognito)) };
    case "sync":
      return await syncClient.syncNow();
    case "device_login":
      return await syncClient.startDeviceLogin(data.repo);
    case "poll_device_login":
      return await syncClient.pollDeviceLoginOnce();
    case "token_login":
      return await syncClient.loginWithToken(data.token, data.repo);
    case "logout":
      return syncClient.logout();
    default:
      throw new Error(`Unsupported memory action: ${data.action}`);
  }
});

// Goal Mode 2.0 mutations
app.api("/api/goal", async (data) => {
  const ctx = resolveSessionContext(data.conversationId || "", uriToFsPath(data.workspaceUri || ""), { allowProcessCwd: false });
  const convId = ctx.conversationId;
  const cwd = ctx.cwd;
  const goalStore = new PiGoalStore();

  switch (data.action) {
    case "set":
      return {
        goal: goalStore.setGoal(convId, {
          objective: data.objective,
          acceptanceCriteria: data.acceptanceCriteria || [],
          maxRounds: data.maxRounds || 6,
          cwd,
        }),
      };
    case "pause":
      return { goal: goalStore.pauseGoal(convId) };
    case "clear":
      goalStore.clearGoal(convId);
      return { goal: null };
    default:
      throw new Error(`Unsupported goal action: ${data.action}`);
  }
});

// Internal loopback bridge so PI Hub UI & MCP `pi_plan(action="handoff_new_window")` can spawn a conversation
// inheriting the exact projectId of `fromConversationId`, preserving `--title`, and keeping the user's default model.
app.api("/api/internal/new-window", async (data) => {
  let projectId = app.config.projectId || "";
  if (data.fromConversationId) {
    try {
      const metaRes = app.getConversationMetadata(data.fromConversationId);
      const metaEvt =
        metaRes?.response?.conversationMetadata || metaRes?.response?.conversation_metadata;
      projectId = metaEvt?.metadata?.projectId || metaEvt?.metadata?.project_id || projectId;
    } catch {
      // Fallback to default projectId
    }
  }
  const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE || "agentapi";
  const baseArgs = process.env.ANTIGRAVITY_AGENTAPI_EXE ? ["agentapi"] : [];
  const cliArgs = [...baseArgs, "new-conversation"];
  if (data.title) cliArgs.push(`--title=${String(data.title).slice(0, 80)}`);
  if (data.model) cliArgs.push(`--model=${String(data.model)}`);
  cliArgs.push("--", String(data.prompt || ""));

  const env = { ...process.env };
  if (projectId) env.ANTIGRAVITY_PROJECT_ID = projectId;

  const { stdout } = await execFileAsync(exe, cliArgs, { timeout: 10000, env });
  const result = stdout?.trim() ? JSON.parse(stdout.trim()) : {};
  return { ok: true, result };
});

const server = await app.run();
try {
  const port = server.address()?.port;
  if (port) {
    writeJsonAtomic(
      join(resolveDataDir(), "sidecar-bridge.json"),
      {
        port,
        secret: process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || "",
        pid: process.pid,
        updatedAt: Date.now(),
      },
      { mode: 0o600 },
    );
  }
} catch {
  // Non-fatal bridge registration error
}
