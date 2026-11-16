#!/usr/bin/env node
/**
 * Zero-Dependency Stdio MCP Server for `pi-kit`.
 *
 * Exposes ONLY 3 polymorphic action tools (`pi_memory`, `pi_plan`, `pi_goal`) to keep
 * always-on tool schema overhead under 3 KB (porting `pi-desktop` Tool Context Budget discipline).
 * Supports both standard MCP newline-delimited JSON-RPC 2.0 and Content-Length framing.
 */
import { PiMemoryStore, PiMemorySyncClient } from "../lib/memory-core.mjs";
import { formatPlanMarkdown, PiGoalStore, PiPlanStore } from "../lib/plan-goal-core.mjs";
import { resolveSessionContext } from "../lib/session-context.mjs";

const TOOLS = [
  {
    name: "pi_memory",
    description:
      "Manage global/project memories, per-conversation incognito isolation, and GitHub pi-memory-sync lossless cloud sync.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "remember",
            "forget",
            "set_instructions",
            "set_incognito",
            "sync",
            "sync_status",
            "device_login",
            "poll_device_login",
          ],
          description: "Memory action to run",
        },
        scope: {
          type: "string",
          enum: ["global", "project", "all"],
          description: "Scope for list/remember/forget (default: global for remember, all for list/forget)",
        },
        content: { type: "string", description: "Memory item text or project instructions" },
        id: { type: "string", description: "Memory item ID for update/forget" },
        query: { type: "string", description: "Substring query for forget" },
        incognito: { type: "boolean", description: "Enable/disable isolated memory for this conversation" },
        cwd: { type: "string", description: "Workspace directory path (optional; auto-resolved)" },
        conversationId: { type: "string", description: "Conversation ID from <pi_session> (optional)" },
      },
      required: ["action"],
    },
  },
  {
    name: "pi_plan",
    description:
      "Manage the structured PlanBoard checklist, Plan Mode hard read-only gate, live step check-offs ([ ] -> [/] -> [x]), and Clean-Session New-Window Handoff.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "update_step", "set_mode", "handoff_new_window", "clear"],
          description: "PlanBoard action",
        },
        title: { type: "string", description: "Plan or new-window handoff title" },
        planMode: {
          type: "boolean",
          description: "true = enforce hard read-only gate while planning; false = unlock for execution",
        },
        steps: {
          type: "array",
          description: "Full step list for action='set'",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "done", "failed"] },
              description: { type: "string" },
              files: { type: "array", items: { type: "string" } },
              verify: { type: "string" },
            },
            required: ["title"],
          },
        },
        stepId: { type: "string", description: "Target step ID or 1-based index for update_step" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "failed"],
          description: "New step status for update_step",
        },
        contextNotes: {
          type: "string",
          description: "Verified codebase facts & constraints passed to the new window on handoff_new_window",
        },
        cwd: { type: "string", description: "Workspace directory path (optional)" },
        conversationId: { type: "string", description: "Conversation ID from <pi_session> (optional)" },
      },
      required: ["action"],
    },
  },
  {
    name: "pi_goal",
    description:
      "Manage Goal Mode 2.0 state (objective, round budget, independent pi-goal-reviewer verdict registration, and status).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get", "set", "record_verdict", "pause", "clear"],
          description: "Goal 2.0 action",
        },
        objective: { type: "string", description: "Clear verifiable objective for action='set'" },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" },
          description: "Concrete acceptance checks",
        },
        maxRounds: { type: "number", description: "Max execution-review rounds (default: 6)" },
        verdict: {
          type: "string",
          enum: ["pass", "revise", "blocked"],
          description: "Verdict returned by pi-goal-reviewer for record_verdict",
        },
        feedback: { type: "string", description: "Reviewer feedback / evidence summary" },
        cwd: { type: "string", description: "Workspace directory path (optional)" },
        conversationId: { type: "string", description: "Conversation ID from <pi_session> (optional)" },
      },
      required: ["action"],
    },
  },
];

async function dispatchToolCall(name, rawArgs = {}) {
  const ctx = resolveSessionContext(rawArgs.conversationId, rawArgs.cwd);
  const conversationId = ctx.conversationId;
  const cwd = ctx.cwd;
  const artifactDir = ctx.artifactDirectoryPath;

  if (name === "pi_memory") {
    const store = new PiMemoryStore();
    const sync = new PiMemorySyncClient(store);
    switch (rawArgs.action) {
      case "list": {
        const res = store.list({ scope: rawArgs.scope || "all", cwd });
        const incog = store.isIsolated(conversationId);
        return JSON.stringify(
          {
            conversationId,
            incognito: incog,
            project: res.identity,
            projectInstructions: res.projectInstructions,
            globalCount: res.globalItems.length,
            projectCount: res.projectItems.length,
            globalItems: res.globalItems,
            projectItems: res.projectItems,
          },
          null,
          2,
        );
      }
      case "remember": {
        const saved = store.remember({
          scope: rawArgs.scope || "global",
          content: rawArgs.content,
          id: rawArgs.id,
          cwd,
          conversationId,
        });
        return `已写入记忆 (${saved.scope}${saved.projectKey ? ` · ${saved.projectKey}` : ""}): [${saved.item.id}] ${saved.item.content}`;
      }
      case "forget": {
        const removed = store.forget({
          id: rawArgs.id,
          query: rawArgs.query,
          scope: rawArgs.scope || "all",
          cwd,
          conversationId,
        });
        return removed.length > 0
          ? `已软删除 ${removed.length} 条记忆（墓碑已记录，跨端同步不复活）：\n${removed.map((r) => `- [${r.id}] ${r.content}`).join("\n")}`
          : "未匹配到需要删除的记忆条目。";
      }
      case "set_instructions": {
        const bucket = store.setProjectInstructions({
          cwd,
          instructions: rawArgs.content || "",
        });
        return `已更新项目专属指令 (${bucket.projectKey})。`;
      }
      case "set_incognito": {
        const next = store.setIsolated(conversationId, Boolean(rawArgs.incognito));
        return next
          ? `🔒 当前会话 (${conversationId}) 已开启「独立记忆」无痕模式：不再读写共享记忆库。`
          : `🔓 当前会话 (${conversationId}) 已恢复共享记忆连接。`;
      }
      case "sync_status":
        return JSON.stringify(sync.getStatus(), null, 2);
      case "sync": {
        const status = await sync.syncNow();
        return `✅ GitHub 云同步完成 (${status.username}/${status.repo})：全局记忆 ${status.globalCount} 条，活跃项目 ${status.projectCount} 个。`;
      }
      case "device_login": {
        const flow = await sync.startDeviceLogin();
        return JSON.stringify(flow, null, 2);
      }
      case "poll_device_login": {
        const status = await sync.pollDeviceLoginOnce();
        return JSON.stringify(status, null, 2);
      }
      default:
        throw new Error(`Unknown pi_memory action: ${rawArgs.action}`);
    }
  }

  if (name === "pi_plan") {
    const planStore = new PiPlanStore();
    switch (rawArgs.action) {
      case "get": {
        const plan = planStore.getPlan(conversationId);
        return plan ? `${formatPlanMarkdown(plan)}\n\n[PI Hub 看板](sidecar://pi-kit/pi_hub/)` : "当前会话尚无任务计划。";
      }
      case "set": {
        const plan = planStore.setPlan(conversationId, {
          title: rawArgs.title,
          steps: rawArgs.steps || [],
          planMode: rawArgs.planMode,
          cwd,
          artifactDir,
        });
        return plan
          ? `${formatPlanMarkdown(plan)}\n\n看板已同步至 [PI Hub](sidecar://pi-kit/pi_hub/)。`
          : "任务计划已清空。";
      }
      case "update_step": {
        const plan = planStore.updateStep(conversationId, {
          stepId: rawArgs.stepId,
          status: rawArgs.status,
          title: rawArgs.title,
          artifactDir,
        });
        return formatPlanMarkdown(plan);
      }
      case "set_mode": {
        const plan = planStore.setPlanMode(conversationId, Boolean(rawArgs.planMode));
        return `${plan.planMode ? "🔒 已开启规划只读闸门" : "🚀 已解除只读闸门，进入实施阶段"}\n\n${formatPlanMarkdown(plan)}`;
      }
      case "handoff_new_window": {
        const res = await planStore.launchNewWindowHandoff(conversationId, {
          title: rawArgs.title,
          contextNotes: rawArgs.contextNotes,
          cwd,
        });
        if (res.launched) {
          return (
            `✨ 已在左侧栏拉起全新净室对话窗口：**${res.title}**` +
            (res.newConversationId ? ` (conversationId: \`${res.newConversationId}\`)` : "") +
            `\n交接令牌：\`[PI_HANDOFF:${res.handoffId}]\`（新窗口启动时会自动挂载同一份任务看板并逐步打勾执行）。` +
            `\n同时本窗口只读闸门已自动解除。`
          );
        }
        return (
          `已生成净室交接包 \`[PI_HANDOFF:${res.handoffId}]\`，但当前子进程未能直接调用 agentapi (${res.error})。\n` +
          `可点击 [📋 打开 PI Hub 看板](sidecar://pi-kit/pi_hub/) 点「✨ 新窗口净室执行」一键拉起，或新建对话粘贴以下交接单：\n\n\`\`\`markdown\n${res.prompt}\n\`\`\``
        );
      }
      case "clear": {
        planStore.clearPlan(conversationId);
        return "已清空当前会话任务看板。";
      }
      default:
        throw new Error(`Unknown pi_plan action: ${rawArgs.action}`);
    }
  }

  if (name === "pi_goal") {
    const goalStore = new PiGoalStore();
    switch (rawArgs.action) {
      case "get": {
        const goal = goalStore.getGoal(conversationId);
        return goal ? JSON.stringify(goal, null, 2) : "当前会话没有激活的 Goal 2.0 目标。";
      }
      case "set": {
        const goal = goalStore.setGoal(conversationId, {
          objective: rawArgs.objective,
          acceptanceCriteria: rawArgs.acceptanceCriteria,
          maxRounds: rawArgs.maxRounds,
          cwd,
        });
        return `🎯 Goal 2.0 已激活（第 1/${goal.maxRounds} 轮）：${goal.objective}\n每轮完成修改后请调用只读子代理 \`pi-goal-reviewer\` 独立审查并登记 \`record_verdict\`。`;
      }
      case "record_verdict": {
        const goal = goalStore.recordVerdict(conversationId, {
          verdict: rawArgs.verdict,
          feedback: rawArgs.feedback,
        });
        return `📋 已登记第 ${goal.round} 轮审查裁决：verdict=${goal.lastVerdict?.verdict} · phase=${goal.phase}\n反馈：${goal.lastVerdict?.feedback || "(无)"}`;
      }
      case "pause": {
        const goal = goalStore.pauseGoal(conversationId);
        return goal ? `Goal 2.0 状态已切换为：${goal.phase}` : "当前无目标。";
      }
      case "clear": {
        goalStore.clearGoal(conversationId);
        return "已清空当前会话 Goal 2.0 目标。";
      }
      default:
        throw new Error(`Unknown pi_goal action: ${rawArgs.action}`);
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ---------------------------------------------------------------------------
// Dual-mode JSON-RPC 2.0 Stdio Transport (NDJSON + Content-Length auto-detect)
// ---------------------------------------------------------------------------

let useContentLength = false;

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  if (useContentLength) {
    const bytes = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function handleRpc(req) {
  if (!req || typeof req !== "object") return;
  const { id, method, params } = req;

  // Notifications have no `id`
  if (id === undefined || id === null) return;

  try {
    if (method === "initialize") {
      sendMessage({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "pi-kit", version: "1.0.0" },
        },
      });
      return;
    }
    if (method === "ping") {
      sendMessage({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      sendMessage({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      try {
        const text = await dispatchToolCall(params?.name, params?.arguments ?? {});
        sendMessage({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
          },
        });
      } catch (toolErr) {
        sendMessage({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${toolErr?.message || String(toolErr)}` }],
            isError: true,
          },
        });
      }
      return;
    }
    sendMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    sendMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: err?.message || String(err) },
    });
  }
}

let buffer = Buffer.alloc(0);

function drainBuffer() {
  while (buffer.length > 0) {
    // Check Content-Length header framing first
    const headerCheck = buffer.subarray(0, Math.min(buffer.length, 64)).toString("utf8");
    if (/^Content-Length:/i.test(headerCheck)) {
      useContentLength = true;
      const sepIdx = buffer.indexOf("\r\n\r\n");
      if (sepIdx < 0) return;
      const headerStr = buffer.subarray(0, sepIdx).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!m) {
        buffer = buffer.subarray(sepIdx + 4);
        continue;
      }
      const len = Number(m[1]);
      const bodyStart = sepIdx + 4;
      if (buffer.length < bodyStart + len) return;
      const bodyStr = buffer.subarray(bodyStart, bodyStart + len).toString("utf8");
      buffer = buffer.subarray(bodyStart + len);
      try {
        void handleRpc(JSON.parse(bodyStr));
      } catch {
        // Ignore malformed frame
      }
      continue;
    }

    // Standard MCP newline-delimited JSON
    const nlIdx = buffer.indexOf(0x0a);
    if (nlIdx < 0) return;
    const line = buffer.subarray(0, nlIdx).toString("utf8").trim();
    buffer = buffer.subarray(nlIdx + 1);
    if (!line) continue;
    try {
      void handleRpc(JSON.parse(line));
    } catch {
      // Ignore non-JSON lines
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  drainBuffer();
});
