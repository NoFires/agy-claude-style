/**
 * Structured PlanBoard State Machine, Clean-Session New-Window Handoff,
 * Quote-Aware Read-Only Shell Gate, and Goal Mode 2.0 Git Diff Stagnation Circuit Breaker.
 *
 * Ported from `SeredenFei/pi-desktop` (`server/plan-mode.ts`, `server/plan-manager.ts`,
 * `web/src/components/PlanBoard.tsx`, and `docs/goal-conversation-design.md`).
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { readJsonSafe, resolveDataDir, writeJsonAtomic } from "./atomic-io.mjs";

const execFileAsync = promisify(execFile);

export const VALID_STEP_STATUSES = new Set(["pending", "in_progress", "done", "failed"]);

// ---------------------------------------------------------------------------
// 1. Quote-Aware Shell Read-Only & High-Risk Command Guards
// ---------------------------------------------------------------------------

const UNSUPPORTED_SHELL_CHARS = /[$`\\<>\x00-\x08\x0b-\x1f\x7f]/;

export function splitShellSegments(cmd) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      cur += ch;
      if (ch === quote && cmd[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (/[(){}~#*?[\]]/.test(ch)) return [""];
    if (ch === ";" || ch === "\n") {
      out.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "&" || ch === "|") && cmd[i + 1] === ch) {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "|") {
      out.push(cur);
      cur = "";
      continue;
    }
    if (ch === "&") return [""];
    cur += ch;
  }
  if (quote) return [""];
  out.push(cur);
  return out.map((s) => s.trim());
}

function readOnlyArgs(args, spec) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return true;
    if (!arg.startsWith("-") || arg === "-") continue;
    if (spec.flags?.includes(arg)) continue;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--")) {
      const option = eq < 0 ? arg : arg.slice(0, eq);
      if (!spec.values?.includes(option)) return false;
      if (eq < 0 && (args[++i] === undefined || args[i].startsWith("-"))) return false;
      continue;
    }
    if (spec.numeric && /^-\d+$/.test(arg)) continue;
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j];
      if (spec.shortValues?.includes(flag)) {
        if (j === arg.length - 1 && (args[++i] === undefined || args[i].startsWith("-"))) return false;
        break;
      }
      if (!spec.short?.includes(flag)) return false;
    }
  }
  return true;
}

const READ_ONLY_OPTIONS = {
  ls: { short: "aAlhRtdrS1Fipn", flags: ["--all", "--almost-all", "--human-readable"] },
  pwd: { short: "LP" },
  cat: { short: "nbsETAv" },
  head: { short: "qv", shortValues: "nc", numeric: true },
  tail: { short: "qv", shortValues: "nc", numeric: true },
  wc: { short: "clmwL", flags: ["--bytes", "--lines", "--words", "--chars"] },
  stat: { short: "Lf", shortValues: "cf", values: ["--format"] },
  du: { short: "ahskmd", shortValues: "d", values: ["--max-depth"] },
  df: { short: "hkiPT" },
  realpath: { short: "emqs" },
  readlink: { short: "femqns" },
  basename: { short: "a", shortValues: "s" },
  dirname: {},
  uname: { short: "asnrvmpio" },
  whoami: {},
  which: { short: "as" },
  printenv: {},
  md5sum: { short: "bct", flags: ["--check"] },
  shasum: { short: "bc", shortValues: "a", flags: ["--check"] },
  sha256sum: { short: "bct", flags: ["--check"] },
  grep: {
    short: "EFGPivwnrlLchsoqRH",
    shortValues: "efABCm",
    numeric: true,
    flags: ["--line-number", "--recursive", "--ignore-case", "--fixed-strings"],
  },
  rg: {
    short: "nNliwsvqocUFHL",
    shortValues: "egtfmABC",
    flags: [
      "--files",
      "--hidden",
      "--no-ignore",
      "--no-heading",
      "--heading",
      "--line-number",
      "--count",
      "--fixed-strings",
      "--ignore-case",
      "--files-with-matches",
      "--files-without-match",
      "--stats",
      "--json",
    ],
    values: [
      "--glob",
      "--type",
      "--max-count",
      "--max-depth",
      "--context",
      "--before-context",
      "--after-context",
      "--regexp",
      "--file",
    ],
  },
  fd: {
    short: "HILais0",
    shortValues: "etEd",
    flags: ["--hidden", "--no-ignore", "--absolute-path", "--full-path"],
    values: ["--extension", "--type", "--exclude", "--max-depth"],
  },
  cut: { short: "sn", shortValues: "bcfd", values: ["--bytes", "--characters", "--fields", "--delimiter"] },
  sort: { short: "rnufbV", shortValues: "kt" },
  uniq: { short: "cduif" },
};

const GIT_OPTIONS = {
  status: {
    short: "sbz",
    flags: [
      "--short",
      "--branch",
      "--porcelain",
      "--porcelain=v1",
      "--porcelain=v2",
      "--untracked-files=no",
      "--untracked-files=all",
    ],
  },
  diff: {
    short: "pwb",
    shortValues: "U",
    flags: [
      "--stat",
      "--numstat",
      "--shortstat",
      "--name-only",
      "--name-status",
      "--cached",
      "--staged",
      "--check",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--color=never",
      "--no-renames",
    ],
  },
  log: {
    short: "p",
    shortValues: "n",
    numeric: true,
    flags: [
      "--oneline",
      "--stat",
      "--name-only",
      "--name-status",
      "--all",
      "--graph",
      "--decorate",
      "--no-decorate",
      "--no-color",
      "--no-show-signature",
    ],
    values: ["--max-count", "--since", "--until", "--author", "--grep", "--format", "--pretty"],
  },
  show: {
    short: "ps",
    flags: ["--stat", "--name-only", "--name-status", "--oneline", "--no-ext-diff", "--no-textconv", "--no-color"],
    values: ["--format", "--pretty"],
  },
  blame: { short: "w", shortValues: "L", flags: ["--line-porcelain", "--porcelain"] },
  branch: { short: "avr", flags: ["--all", "--remotes", "--show-current", "--list"] },
  remote: { short: "v", flags: ["--verbose"] },
  "rev-parse": {
    flags: [
      "--show-toplevel",
      "--show-prefix",
      "--git-dir",
      "--short",
      "--verify",
      "--abbrev-ref",
      "--is-inside-work-tree",
    ],
  },
  "rev-list": { shortValues: "n", numeric: true, flags: ["--count", "--all"], values: ["--max-count"] },
  "ls-files": { short: "zcmot", flags: ["--cached", "--modified", "--others", "--exclude-standard", "--stage"] },
  "ls-tree": { short: "rdtz", flags: ["--name-only", "--name-status", "--full-tree"] },
  describe: { flags: ["--tags", "--always", "--long", "--dirty"] },
  "cat-file": { short: "ptse" },
  grep: READ_ONLY_OPTIONS.grep,
};

function tokenizeWords(segment) {
  const words = [];
  let word = "";
  let quote = "";
  let started = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = "";
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words;
}

function segmentIsReadOnly(segment) {
  const words = tokenizeWords(segment);
  if (!words || words.length === 0) return false;
  const [name, ...rawArgs] = words;
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) return false;

  if (["node", "npm", "python", "python3", "cargo", "rustc", "go"].includes(name)) {
    return rawArgs.length === 1 && ["--version", "-v", "-V", "version", "--help", "-h"].includes(rawArgs[0]);
  }
  if (name === "git") {
    const args = [...rawArgs];
    while (args[0] === "--no-pager" || args[0] === "-C") {
      if (args[0] === "-C") {
        args.shift();
        if (!args.shift()) return false;
      } else {
        args.shift();
      }
    }
    const sub = args.shift() ?? "";
    return Object.hasOwn(GIT_OPTIONS, sub) && readOnlyArgs(args, GIT_OPTIONS[sub]);
  }
  if (name === "jq") {
    const args = [...rawArgs];
    while (args[0] === "-r" || args[0] === "-c") args.shift();
    return (
      args.length > 0 &&
      /^\.(?:[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*|\[\d*\])*)?$/.test(args[0]) &&
      args.slice(1).every((a) => !a.startsWith("-"))
    );
  }
  if (name === "find") {
    let i = 0;
    while (i < rawArgs.length && !rawArgs[i].startsWith("-")) i++;
    while (i < rawArgs.length) {
      const arg = rawArgs[i++];
      if (["-print", "-print0", "-a", "-o"].includes(arg)) continue;
      if (!["-name", "-iname", "-path", "-type", "-maxdepth", "-mindepth", "-newer", "-mtime", "-size"].includes(arg)) {
        return false;
      }
      if (rawArgs[i] === undefined || rawArgs[i++].startsWith("-")) return false;
    }
    return true;
  }
  return Object.hasOwn(READ_ONLY_OPTIONS, name) && readOnlyArgs(rawArgs, READ_ONLY_OPTIONS[name]);
}

export function isShellCommandReadOnly(cmd) {
  const text = String(cmd ?? "").trim();
  if (!text || UNSUPPORTED_SHELL_CHARS.test(text)) return false;
  const segments = splitShellSegments(text);
  return segments.length > 0 && segments.every((s) => s.length > 0 && segmentIsReadOnly(s));
}

/**
 * Always-on safety gate against destructive host/git commands (`AGENTS.md` redlines).
 * Returns `{ action: "allow" | "deny" | "force_ask", reason?: string }`.
 */
export function checkHighRiskCommand(cmd) {
  const text = String(cmd ?? "").trim();
  if (!text) return { action: "allow" };

  if (/\bpkill\s+-f\b/.test(text)) {
    return {
      action: "deny",
      reason: "Blocked by PI Safety Gate: `pkill -f` is forbidden (AGENTS.md redline — risks killing host/unrelated processes). Use targeted PID termination or manage_task.",
    };
  }
  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(\/|~|\$HOME|\*)\s*($|;|\|)/.test(text)) {
    return {
      action: "deny",
      reason: "Blocked by PI Safety Gate: catastrophic recursive delete (`rm -rf` on root/home/wildcard).",
    };
  }
  if (
    /\bgit\s+(?:reset\s+--hard\b|clean\s+-[a-zA-Z]*f[a-zA-Z]*\b|push\b.*--force(?!-with-lease)\b|checkout\s+--\s+\.(?:\s|$|;|&|\|))/.test(
      text,
    )
  ) {
    return {
      action: "force_ask",
      reason: "PI Safety Gate: Destructive git operation detected (`reset --hard` / `clean -f` / `--force` / `checkout .`). Please confirm explicitly.",
    };
  }
  return { action: "allow" };
}

// ---------------------------------------------------------------------------
// 2. PlanBoard State Machine & Clean New-Window Handoff
// ---------------------------------------------------------------------------

export function formatPlanMarkdown(plan) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return "_(暂无任务计划)_";
  }
  const doneCount = plan.steps.filter((s) => s.status === "done").length;
  const totalCount = plan.steps.length;
  const pct = Math.round((doneCount / totalCount) * 100);
  const modeTag = plan.planMode ? "🔒 规划只读中（待选择执行窗口）" : "🚀 执行推进中";
  const header = `### 📋 ${plan.title || "任务执行计划"} (${doneCount}/${totalCount} · ${pct}%) — ${modeTag}`;

  const lines = [header, ""];
  plan.steps.forEach((s, idx) => {
    const mark =
      s.status === "done"
        ? "[x]"
        : s.status === "in_progress"
          ? "[/]"
          : s.status === "failed"
            ? "[!]"
            : "[ ]";
    let line = `- ${mark} **${idx + 1}. ${s.title}**`;
    if (s.files?.length) line += ` _(${s.files.join(", ")})_`;
    if (s.description) line += `\n  - ${s.description}`;
    if (s.verify) line += `\n  - 验收: ${s.verify}`;
    lines.push(line);
  });
  return lines.join("\n");
}

export class PiPlanStore {
  constructor(dataDir = resolveDataDir()) {
    this.dataDir = resolve(dataDir);
    this.filePath = join(this.dataDir, "plans.json");
  }

  loadAll() {
    const raw = readJsonSafe(this.filePath, { plans: {}, handoffs: {} });
    return {
      plans: raw?.plans && typeof raw.plans === "object" ? raw.plans : {},
      handoffs: raw?.handoffs && typeof raw.handoffs === "object" ? raw.handoffs : {},
    };
  }

  saveAll(data) {
    // Bound handoffs to latest 100 entries.
    const handoffEntries = Object.entries(data.handoffs ?? {}).sort(
      (a, b) => (b[1]?.createdAt ?? 0) - (a[1]?.createdAt ?? 0),
    );
    const trimmedHandoffs = Object.fromEntries(handoffEntries.slice(0, 100));
    writeJsonAtomic(this.filePath, {
      plans: data.plans ?? {},
      handoffs: trimmedHandoffs,
    });
  }

  getPlan(conversationId) {
    if (!conversationId) return null;
    const { plans } = this.loadAll();
    return plans[conversationId] ?? null;
  }

  listPlans() {
    const { plans } = this.loadAll();
    return Object.entries(plans)
      .map(([convId, p]) => ({ conversationId: convId, ...p }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  normalizeSteps(rawSteps = []) {
    return (Array.isArray(rawSteps) ? rawSteps : []).map((s, idx) => {
      const status = VALID_STEP_STATUSES.has(s?.status) ? s.status : "pending";
      return {
        id: String(s?.id || `step-${idx + 1}`),
        title: String(s?.title || s?.goal || `Step ${idx + 1}`).trim().slice(0, 240),
        status,
        ...(s?.description ? { description: String(s.description).trim().slice(0, 1000) } : {}),
        ...(Array.isArray(s?.files) && s.files.length > 0
          ? { files: s.files.map((f) => String(f).trim()).filter(Boolean).slice(0, 20) }
          : {}),
        ...(s?.verify ? { verify: String(s.verify).trim().slice(0, 400) } : {}),
      };
    });
  }

  setPlan(conversationId, { title = "", steps = [], planMode, activeStepId, cwd = "", artifactDir = "" } = {}) {
    if (!conversationId) throw new Error("conversationId is required");
    const data = this.loadAll();
    const prev = data.plans[conversationId];
    const normalized = this.normalizeSteps(steps);

    if (normalized.length === 0) {
      delete data.plans[conversationId];
      this.saveAll(data);
      return null;
    }

    const inProg = normalized.find((s) => s.status === "in_progress");
    const nextPending = normalized.find((s) => s.status === "pending");
    const effectiveActive =
      activeStepId !== undefined ? activeStepId : inProg?.id ?? nextPending?.id ?? null;

    const nextPlan = {
      conversationId,
      title: String(title || prev?.title || "任务执行计划").trim().slice(0, 200),
      planMode: planMode !== undefined ? Boolean(planMode) : Boolean(prev?.planMode ?? false),
      steps: normalized,
      activeStepId: effectiveActive,
      cwd: cwd || prev?.cwd || "",
      artifactDir: artifactDir || prev?.artifactDir || "",
      createdAt: prev?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    data.plans[conversationId] = nextPlan;
    this.saveAll(data);
    this.mirrorToArtifactTaskMd(nextPlan);
    return nextPlan;
  }

  setPlanMode(conversationId, planMode) {
    if (!conversationId) throw new Error("conversationId is required");
    const data = this.loadAll();
    const cur = data.plans[conversationId] ?? {
      conversationId,
      title: "任务执行计划",
      steps: [],
      activeStepId: null,
      createdAt: Date.now(),
    };
    cur.planMode = Boolean(planMode);
    if (!cur.planMode && cur.steps.length > 0 && !cur.steps.some((s) => s.status === "in_progress")) {
      const firstPending = cur.steps.find((s) => s.status === "pending");
      if (firstPending) {
        firstPending.status = "in_progress";
        cur.activeStepId = firstPending.id;
      }
    }
    cur.updatedAt = Date.now();
    data.plans[conversationId] = cur;
    this.saveAll(data);
    this.mirrorToArtifactTaskMd(cur);
    return cur;
  }

  updateStep(conversationId, { stepId, status, title, description, verify, artifactDir = "" } = {}) {
    if (!conversationId) throw new Error("conversationId is required");
    const data = this.loadAll();
    const plan = data.plans[conversationId];
    if (!plan || !Array.isArray(plan.steps)) {
      throw new Error(`当前会话 (${conversationId}) 尚无任务计划，请先调用 pi_plan(action='set')。`);
    }
    const target =
      plan.steps.find((s) => s.id === String(stepId)) ??
      plan.steps[Number(stepId) - 1];
    if (!target) {
      throw new Error(`未找到步骤: ${stepId}`);
    }
    if (status && VALID_STEP_STATUSES.has(status)) target.status = status;
    if (typeof title === "string" && title.trim()) target.title = title.trim().slice(0, 240);
    if (typeof description === "string") {
      if (description.trim()) target.description = description.trim().slice(0, 1000);
      else delete target.description;
    }
    if (typeof verify === "string") {
      if (verify.trim()) target.verify = verify.trim().slice(0, 400);
      else delete target.verify;
    }
    if (artifactDir) plan.artifactDir = artifactDir;

    const inProg = plan.steps.find((s) => s.status === "in_progress");
    const firstPending = plan.steps.find((s) => s.status === "pending");
    plan.activeStepId = inProg?.id ?? firstPending?.id ?? null;
    plan.updatedAt = Date.now();

    data.plans[conversationId] = plan;
    this.saveAll(data);
    this.mirrorToArtifactTaskMd(plan);
    return plan;
  }

  addStep(conversationId, { title, description = "", files = [], verify = "" } = {}) {
    const data = this.loadAll();
    const plan = data.plans[conversationId] ?? {
      conversationId,
      title: "任务执行计划",
      planMode: false,
      steps: [],
      activeStepId: null,
      createdAt: Date.now(),
    };
    const nextIdx = plan.steps.length + 1;
    let id = `step-${nextIdx}`;
    while (plan.steps.some((s) => s.id === id)) id = `step-${randomUUID().slice(0, 6)}`;
    plan.steps.push({
      id,
      title: String(title || `Step ${nextIdx}`).trim().slice(0, 240),
      status: "pending",
      ...(description.trim() ? { description: description.trim().slice(0, 1000) } : {}),
      ...(files.length ? { files } : {}),
      ...(verify.trim() ? { verify: verify.trim().slice(0, 400) } : {}),
    });
    plan.updatedAt = Date.now();
    data.plans[conversationId] = plan;
    this.saveAll(data);
    this.mirrorToArtifactTaskMd(plan);
    return plan;
  }

  deleteStep(conversationId, stepId) {
    const data = this.loadAll();
    const plan = data.plans[conversationId];
    if (!plan) return null;
    plan.steps = plan.steps.filter((s) => s.id !== String(stepId));
    if (plan.steps.length === 0) {
      delete data.plans[conversationId];
      this.saveAll(data);
      return null;
    }
    const inProg = plan.steps.find((s) => s.status === "in_progress");
    plan.activeStepId = inProg?.id ?? plan.steps.find((s) => s.status === "pending")?.id ?? null;
    plan.updatedAt = Date.now();
    data.plans[conversationId] = plan;
    this.saveAll(data);
    this.mirrorToArtifactTaskMd(plan);
    return plan;
  }

  clearPlan(conversationId) {
    const data = this.loadAll();
    delete data.plans[conversationId];
    this.saveAll(data);
  }

  mirrorToArtifactTaskMd(plan) {
    try {
      if (!plan?.artifactDir || !existsSync(plan.artifactDir)) return;
      const taskMdPath = join(plan.artifactDir, "pi-plan-board.md");
      writeFileSync(taskMdPath, `${formatPlanMarkdown(plan)}\n`, "utf8");
    } catch {
      // Non-fatal mirror write.
    }
  }

  /**
   * Creates a Clean-Session Handoff package and unlocks the source conversation.
   */
  createHandoff(conversationId, { title = "", contextNotes = "", cwd = "" } = {}) {
    const data = this.loadAll();
    const sourcePlan = data.plans[conversationId];
    if (!sourcePlan || !sourcePlan.steps?.length) {
      throw new Error("当前会话没有可交接的任务步骤，请先建立任务计划。");
    }
    // Unlock source conversation so user isn't stuck in read-only mode there.
    sourcePlan.planMode = false;
    sourcePlan.updatedAt = Date.now();

    const handoffId = randomUUID().slice(0, 10);
    const cleanSteps = sourcePlan.steps.map((s) => ({
      ...s,
      status: s.status === "done" ? "done" : "pending",
    }));
    const handoffTitle = String(title || sourcePlan.title || "净室任务执行").trim();
    const effectiveCwd = cwd || sourcePlan.cwd || "";

    const stepLines = cleanSteps
      .map((s, idx) => {
        const mark = s.status === "done" ? "[x]" : "[ ]";
        const filesNote = s.files?.length ? ` [涉及文件: ${s.files.join(", ")}]` : "";
        const descNote = s.description ? `\n   说明: ${s.description}` : "";
        const verifyNote = s.verify ? `\n   验收: ${s.verify}` : "";
        return `${idx + 1}. ${mark} (${s.id}) ${s.title}${filesNote}${descNote}${verifyNote}`;
      })
      .join("\n");

    const prompt = [
      `[PI_HANDOFF:${handoffId}]`,
      `# ✨ 净室执行交接：${handoffTitle}`,
      effectiveCwd ? `\n目标工作区路径：\`${effectiveCwd}\`` : "",
      contextNotes ? `\n## 已验证背景与约束\n${contextNotes.trim()}` : "",
      `\n## 待执行步骤清单（共 ${cleanSteps.length} 步）`,
      stepLines,
      `\n## 执行要求`,
      `1. 本窗口已自动挂载该任务看板（解除只读闸门）。`,
      `2. 严格按顺序逐步执行：每步动手前调用 \`pi_plan(action="update_step", conversationId="<当前会话ID>", stepId="...", status="in_progress")\`，验证通过后立即置 \`status="done"\`，并在回复中打印勾选进度（\`[x] i/N ...\`）。`,
      `3. 遵循 Small CLs，全部完成后执行格式化、类型检查与定向测试验收。`,
    ]
      .filter(Boolean)
      .join("\n");

    data.handoffs[handoffId] = {
      handoffId,
      fromConversationId: conversationId,
      title: handoffTitle,
      cwd: effectiveCwd,
      contextNotes: String(contextNotes || "").trim(),
      steps: cleanSteps,
      prompt,
      claimedByConversationId: null,
      createdAt: Date.now(),
    };
    this.saveAll(data);
    return data.handoffs[handoffId];
  }

  /**
   * Automatically binds a handoff plan to a newly opened conversation when `[PI_HANDOFF:<id>]` is present.
   */
  claimHandoffFromPrompt(newConversationId, promptText = "") {
    if (!newConversationId || !promptText) return null;
    const match = /\[PI_HANDOFF:([a-zA-Z0-9_-]{6,32})\]/.exec(String(promptText));
    if (!match) return null;
    const handoffId = match[1];
    const data = this.loadAll();
    const handoff = data.handoffs[handoffId];
    if (!handoff) return null;

    if (!data.plans[newConversationId]) {
      const steps = handoff.steps.map((s) => ({ ...s }));
      const firstPending = steps.find((s) => s.status === "pending");
      if (firstPending) firstPending.status = "in_progress";
      data.plans[newConversationId] = {
        conversationId: newConversationId,
        title: handoff.title,
        planMode: false,
        steps,
        activeStepId: firstPending?.id ?? null,
        cwd: handoff.cwd || "",
        handoffId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      handoff.claimedByConversationId = newConversationId;
      this.saveAll(data);
    }
    return data.plans[newConversationId];
  }

  /**
   * Launches a brand-new Antigravity conversation window via `agentapi new-conversation`
   * (or via the running PI Hub Sidecar loopback bridge if invoked from an MCP subprocess).
   */
  async launchNewWindowHandoff(conversationId, { title = "", contextNotes = "", cwd = "", model = "" } = {}) {
    const handoff = this.createHandoff(conversationId, { title, contextNotes, cwd });
    const windowTitle = `✨ ${handoff.title}`.slice(0, 80);

    // Path 1: Try Sidecar bridge first if available (preserves projectId automatically).
    const bridgeInfo = readJsonSafe(join(this.dataDir, "sidecar-bridge.json"), null);
    if (bridgeInfo?.port && bridgeInfo?.secret) {
      try {
        const res = await fetch(`http://127.0.0.1:${bridgeInfo.port}/api/internal/new-window`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Sidecar-Token": bridgeInfo.secret,
          },
          body: JSON.stringify({
            fromConversationId: conversationId,
            title: windowTitle,
            prompt: handoff.prompt,
            model,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const payload = await res.json();
          const spawnedId =
            payload?.result?.conversationId ||
            payload?.result?.response?.newConversation?.conversationId ||
            payload?.result?.response?.conversationId ||
            null;
          if (spawnedId) {
            this.claimHandoffFromPrompt(spawnedId, handoff.prompt);
          }
          return {
            launched: true,
            via: "sidecar-agentapi",
            handoffId: handoff.handoffId,
            newConversationId: spawnedId,
            title: windowTitle,
            prompt: handoff.prompt,
          };
        }
      } catch {
        // Fall through to direct CLI invocation.
      }
    }

    // Path 2: Direct `agentapi new-conversation` CLI invocation.
    const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE || "agentapi";
    const baseArgs = process.env.ANTIGRAVITY_AGENTAPI_EXE ? ["agentapi"] : [];
    const cliArgs = [...baseArgs, "new-conversation", `--title=${windowTitle}`];
    if (model) cliArgs.push(`--model=${model}`);
    cliArgs.push("--", handoff.prompt);

    try {
      const { stdout } = await execFileAsync(exe, cliArgs, {
        timeout: 10000,
        env: process.env,
      });
      let parsed = {};
      try {
        parsed = stdout?.trim() ? JSON.parse(stdout.trim()) : {};
      } catch {
        parsed = { raw: stdout?.trim() };
      }
      const spawnedId =
        parsed?.conversationId ||
        parsed?.response?.newConversation?.conversationId ||
        parsed?.response?.conversationId ||
        null;
      if (spawnedId) {
        this.claimHandoffFromPrompt(spawnedId, handoff.prompt);
      }
      return {
        launched: true,
        via: "agentapi-cli",
        handoffId: handoff.handoffId,
        newConversationId: spawnedId,
        title: windowTitle,
        prompt: handoff.prompt,
      };
    } catch (err) {
      return {
        launched: false,
        via: "manual-fallback",
        error: err?.message || String(err),
        handoffId: handoff.handoffId,
        title: windowTitle,
        prompt: handoff.prompt,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Goal Mode 2.0 & Deterministic Git Diff Stagnation Circuit Breaker
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 fingerprint of working-tree + staged changes in `cwd`.
 */
export async function computeWorkspaceDiffFingerprint(cwd) {
  if (!cwd || !existsSync(cwd)) {
    return { isGitRepo: false, fingerprint: "no-workspace", changedFiles: 0, statSummary: "" };
  }
  try {
    const { stdout: inside } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--is-inside-work-tree"],
      { timeout: 4000 },
    );
    if (inside.trim() !== "true") {
      return { isGitRepo: false, fingerprint: "not-git", changedFiles: 0, statSummary: "" };
    }
    const [{ stdout: statusOut }, { stdout: diffOut }, { stdout: cachedOut }, { stdout: statOut }] =
      await Promise.all([
        execFileAsync("git", ["-C", cwd, "status", "--porcelain=v1", "-uall"], {
          timeout: 5000,
          maxBuffer: 4 * 1024 * 1024,
        }),
        execFileAsync("git", ["-C", cwd, "--no-pager", "diff", "--no-ext-diff", "--no-color"], {
          timeout: 5000,
          maxBuffer: 8 * 1024 * 1024,
        }),
        execFileAsync("git", ["-C", cwd, "--no-pager", "diff", "--cached", "--no-ext-diff", "--no-color"], {
          timeout: 5000,
          maxBuffer: 8 * 1024 * 1024,
        }),
        execFileAsync("git", ["-C", cwd, "--no-pager", "diff", "HEAD", "--shortstat"], {
          timeout: 5000,
        }).catch(() => ({ stdout: "" })),
      ]);

    const hash = createHash("sha256")
      .update(statusOut)
      .update("\0")
      .update(diffOut)
      .update("\0")
      .update(cachedOut)
      .digest("hex")
      .slice(0, 16);

    const changedFiles = statusOut
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean).length;

    return {
      isGitRepo: true,
      fingerprint: hash,
      changedFiles,
      statSummary: statOut.trim() || `${changedFiles} file(s) modified/untracked`,
    };
  } catch {
    return { isGitRepo: false, fingerprint: "git-error", changedFiles: 0, statSummary: "" };
  }
}

export class PiGoalStore {
  constructor(dataDir = resolveDataDir()) {
    this.dataDir = resolve(dataDir);
    this.filePath = join(this.dataDir, "goals.json");
  }

  loadAll() {
    const raw = readJsonSafe(this.filePath, { goals: {} });
    return raw?.goals && typeof raw.goals === "object" ? raw.goals : {};
  }

  saveAll(goals) {
    writeJsonAtomic(this.filePath, { goals });
  }

  getGoal(conversationId) {
    if (!conversationId) return null;
    const goals = this.loadAll();
    return goals[conversationId] ?? null;
  }

  listGoals() {
    const goals = this.loadAll();
    return Object.values(goals).sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
  }

  setGoal(conversationId, { objective, acceptanceCriteria = [], maxRounds = 6, cwd = "" } = {}) {
    if (!conversationId) throw new Error("conversationId is required");
    const cleanObj = String(objective ?? "").trim();
    if (!cleanObj) throw new Error("Goal objective cannot be empty");
    const goals = this.loadAll();
    const now = Date.now();
    goals[conversationId] = {
      conversationId,
      objective: cleanObj.slice(0, 2000),
      acceptanceCriteria: Array.isArray(acceptanceCriteria)
        ? acceptanceCriteria.map((c) => String(c).trim()).filter(Boolean).slice(0, 20)
        : [],
      phase: "active", // active | completed | blocked | paused
      round: 1,
      maxRounds: Math.max(1, Math.min(20, Number(maxRounds) || 6)),
      cwd: cwd || "",
      lastFingerprint: null,
      lastStatSummary: "",
      stagnantRounds: 0,
      lastErrorSig: "",
      sameErrorRounds: 0,
      lastVerdict: null, // { round, verdict: "pass"|"revise"|"blocked", feedback, at }
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.saveAll(goals);
    return goals[conversationId];
  }

  recordVerdict(conversationId, { verdict, feedback = "" } = {}) {
    if (!conversationId) throw new Error("conversationId is required");
    const goals = this.loadAll();
    const goal = goals[conversationId];
    if (!goal) throw new Error(`当前会话 (${conversationId}) 没有激活的 Goal 2.0 目标`);
    const v = String(verdict ?? "").toLowerCase();
    if (!["pass", "revise", "blocked"].includes(v)) {
      throw new Error("verdict 必须是 'pass' | 'revise' | 'blocked'");
    }
    const now = Date.now();
    goal.lastVerdict = {
      round: goal.round,
      verdict: v,
      feedback: String(feedback || "").trim().slice(0, 4000),
      at: now,
    };
    if (v === "pass") {
      goal.phase = "completed";
      goal.blockedReason = null;
    } else if (v === "blocked") {
      goal.phase = "blocked";
      goal.blockedReason = goal.lastVerdict.feedback || "独立审查判定受阻 (blocked)";
    } else {
      goal.phase = "active";
    }
    goal.updatedAt = now;
    this.saveAll(goals);
    return goal;
  }

  pauseGoal(conversationId) {
    const goals = this.loadAll();
    const goal = goals[conversationId];
    if (!goal) return null;
    goal.phase = goal.phase === "paused" ? "active" : "paused";
    goal.updatedAt = Date.now();
    this.saveAll(goals);
    return goal;
  }

  clearGoal(conversationId) {
    const goals = this.loadAll();
    delete goals[conversationId];
    this.saveAll(goals);
  }

  /**
   * Deterministic Stop-hook referee for Goal Mode 2.0:
   * - Enforces round budget (`maxRounds`)
   * - Enforces 2-round identical git-diff stagnation & repeated-error circuit breaker
   * - Requires `pi-goal-reviewer` pass verdict before allowing active goal completion
   */
  async evaluateOnStop(conversationId, { cwd = "", errorText = "", continuationActive = false } = {}) {
    const goals = this.loadAll();
    const goal = goals[conversationId];
    if (!goal || goal.phase !== "active") {
      return { shouldContinue: false, goal };
    }

    if (goal.lastVerdict?.verdict === "pass") {
      goal.phase = "completed";
      goal.updatedAt = Date.now();
      this.saveAll(goals);
      return { shouldContinue: false, goal };
    }

    const effectiveCwd = cwd || goal.cwd || "";
    const diffSnap = await computeWorkspaceDiffFingerprint(effectiveCwd);
    const errSig = String(errorText || "").trim().slice(0, 240);

    if (errSig) {
      if (errSig === goal.lastErrorSig) goal.sameErrorRounds = (goal.sameErrorRounds || 0) + 1;
      else {
        goal.lastErrorSig = errSig;
        goal.sameErrorRounds = 1;
      }
    } else {
      goal.lastErrorSig = "";
      goal.sameErrorRounds = 0;
    }

    if (diffSnap.isGitRepo) {
      if (goal.lastFingerprint && diffSnap.fingerprint === goal.lastFingerprint) {
        goal.stagnantRounds = (goal.stagnantRounds || 0) + 1;
      } else {
        goal.lastFingerprint = diffSnap.fingerprint;
        goal.stagnantRounds = 0;
      }
      goal.lastStatSummary = diffSnap.statSummary;
    }

    // Circuit Breaker #1: Repeated identical error
    if (goal.sameErrorRounds >= 2) {
      goal.phase = "blocked";
      goal.blockedReason = `Goal 2.0 停滞熔断：连续 ${goal.sameErrorRounds} 轮命中相同错误 (${errSig})`;
      goal.updatedAt = Date.now();
      this.saveAll(goals);
      return { shouldContinue: false, blocked: true, goal };
    }

    // Circuit Breaker #2: Zero git diff progress across 2 consecutive continuation rounds
    if (diffSnap.isGitRepo && goal.stagnantRounds >= 2) {
      goal.phase = "blocked";
      goal.blockedReason = `Goal 2.0 停滞熔断：连续 ${goal.stagnantRounds} 轮工作区 Git Diff 指纹无任何变化 (${diffSnap.fingerprint})，停止空转。`;
      goal.updatedAt = Date.now();
      this.saveAll(goals);
      return { shouldContinue: false, blocked: true, goal };
    }

    // Circuit Breaker #3: Round budget exhausted
    if (goal.round >= goal.maxRounds && continuationActive) {
      goal.phase = "blocked";
      goal.blockedReason = `Goal 2.0 轮次上限已满 (${goal.round}/${goal.maxRounds}) 且未获 pass 裁决，自动停机交回人工确认。`;
      goal.updatedAt = Date.now();
      this.saveAll(goals);
      return { shouldContinue: false, blocked: true, goal };
    }

    // Advance round and instruct independent reviewer verification or revision!
    const currentRound = goal.round;
    const verdictForThisRound = goal.lastVerdict?.round === currentRound ? goal.lastVerdict : null;

    if (!verdictForThisRound) {
      goal.updatedAt = Date.now();
      this.saveAll(goals);
      return {
        shouldContinue: true,
        goal,
        reason:
          `[PI Goal 2.0 · 第 ${currentRound}/${goal.maxRounds} 轮审查门禁] 目标尚未经独立审查通过。\n` +
          `当前目标：${goal.objective}\n` +
          (diffSnap.statSummary ? `实测改动：${diffSnap.statSummary} (fingerprint: ${diffSnap.fingerprint})\n` : "") +
          `请调用只读审查子代理 \`invoke_subagent(TypeName="pi-goal-reviewer", ...)\` 核验真实改动与测试输出，` +
          `并根据其返回的 JSON 裁决调用 \`pi_goal(action="record_verdict", verdict="pass"|"revise"|"blocked", feedback="...")\`。`,
      };
    }

    // Verdict for current round was "revise" -> enter next round!
    goal.round = currentRound + 1;
    goal.updatedAt = Date.now();
    this.saveAll(goals);
    return {
      shouldContinue: true,
      goal,
      reason:
        `[PI Goal 2.0 · 进入第 ${goal.round}/${goal.maxRounds} 轮修订]\n` +
        `上一轮审查反馈 (revise)：${verdictForThisRound.feedback}\n` +
        `请针对反馈完成修复与验证，完成后再次通过 \`pi-goal-reviewer\` 复核并调用 \`pi_goal(action="record_verdict")\`。`,
    };
  }
}
