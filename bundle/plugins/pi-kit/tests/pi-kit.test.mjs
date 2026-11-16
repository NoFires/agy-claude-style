/**
 * Comprehensive hermetic test suite for `pi-kit` (Port of `SeredenFei/pi-desktop` to Antigravity).
 *
 * Uses temporary `mkdtempSync` directories via `PI_KIT_DATA_DIR` so production state in
 * `~/.gemini/config/plugin-data/pi-kit` is NEVER touched by tests.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  detectGitRemoteKey,
  emptyMemoryDocument,
  mergeMemoryDocuments,
  PiMemoryStore,
  resolveProjectIdentity,
  seedFromPiDesktopIfNeeded,
} from "../lib/memory-core.mjs";
import {
  checkHighRiskCommand,
  computeWorkspaceDiffFingerprint,
  isShellCommandReadOnly,
  PiGoalStore,
  PiPlanStore,
} from "../lib/plan-goal-core.mjs";
import { recordSessionContext, resolveSessionContext } from "../lib/session-context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");

function makeTempDir(prefix = "pi-kit-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolvePort(port)));
    });
    srv.on("error", reject);
  });
}

function runHook(scriptRelPath, stdinObj, dataDir) {
  const scriptPath = join(PLUGIN_ROOT, scriptRelPath);
  const res = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(stdinObj),
    encoding: "utf8",
    env: { ...process.env, PI_KIT_DATA_DIR: dataDir },
    timeout: 8000,
  });
  assert.equal(res.status, 0, `Hook ${scriptRelPath} failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

describe("1. Workspace & Git Remote Identity", () => {
  let rootDir;
  before(() => {
    rootDir = makeTempDir("pi-git-id-");
  });
  after(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("normalizes SSH, HTTPS, nested subdir, worktree, non-git dir, and standalone chat-space", () => {
    // SSH repo + nested subdir
    const sshRepo = join(rootDir, "ssh-repo");
    mkdirSync(join(sshRepo, ".git"), { recursive: true });
    mkdirSync(join(sshRepo, "packages", "web"), { recursive: true });
    writeFileSync(
      join(sshRepo, ".git", "config"),
      '[remote "origin"]\n\turl = git@github.com:SeredenFei/pi-desktop.git\n',
    );
    assert.equal(detectGitRemoteKey(join(sshRepo, "packages", "web")), "git:github.com/seredenfei/pi-desktop");

    // HTTPS repo
    const httpsRepo = join(rootDir, "https-repo");
    mkdirSync(join(httpsRepo, ".git"), { recursive: true });
    writeFileSync(
      join(httpsRepo, ".git", "config"),
      '[remote "origin"]\n\turl = https://github.com/SeredenFei/pi-memory-sync.git/\n',
    );
    assert.equal(detectGitRemoteKey(httpsRepo), "git:github.com/seredenfei/pi-memory-sync");

    // Git worktree (.git file pointing to main repo .git/worktrees/feat)
    const wtDir = join(rootDir, "wt-feat");
    const wtMeta = join(sshRepo, ".git", "worktrees", "wt-feat");
    mkdirSync(wtDir, { recursive: true });
    mkdirSync(wtMeta, { recursive: true });
    writeFileSync(join(wtDir, ".git"), `gitdir: ${wtMeta}\n`);
    assert.equal(detectGitRemoteKey(wtDir), "git:github.com/seredenfei/pi-desktop");

    // Non-git folder
    const plainDir = join(rootDir, "MyScratchApp");
    mkdirSync(plainDir, { recursive: true });
    const plainId = resolveProjectIdentity(plainDir);
    assert.equal(plainId.projectKey, "dir:myscratchapp");
    assert.equal(plainId.isChatSpace, false);

    // Standalone non-workspace chat
    const chatId = resolveProjectIdentity("");
    assert.equal(chatId.projectKey, "chat-space");
    assert.equal(chatId.isChatSpace, true);

    // Sidecar session resolution must NOT leak process.cwd() when conversation is standalone
    const ctxDir = makeTempDir("pi-ctx-");
    const prevEnv = process.env.PI_KIT_DATA_DIR;
    process.env.PI_KIT_DATA_DIR = ctxDir;
    try {
      recordSessionContext({ conversationId: "conv-standalone", cwd: "" });
      const resolved = resolveSessionContext("conv-standalone", "", { allowProcessCwd: false });
      assert.equal(resolved.cwd, "");
    } finally {
      if (prevEnv === undefined) delete process.env.PI_KIT_DATA_DIR;
      else process.env.PI_KIT_DATA_DIR = prevEnv;
      rmSync(ctxDir, { recursive: true, force: true });
    }
  });
});

describe("2. Hierarchical Memory, Tombstone LWW Merge & pi-desktop Lossless Compatibility", () => {
  let tempDir;
  before(() => {
    tempDir = makeTempDir("pi-mem-");
  });
  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("seeds once non-destructively from pi-desktop data dir", () => {
    const mockPiDesktop = join(tempDir, "mock-pi-desktop");
    const targetDataDir = join(tempDir, "seeded-data");
    mkdirSync(mockPiDesktop, { recursive: true });
    mkdirSync(targetDataDir, { recursive: true });

    const sourceDoc = {
      version: 1,
      updatedAt: 1000,
      global: [{ id: "g1", content: "Prefer Small CLs", enabled: true, createdAt: 900, updatedAt: 1000 }],
      projects: {
        "git:github.com/seredenfei/pi-desktop": {
          projectKey: "git:github.com/seredenfei/pi-desktop",
          name: "pi-desktop",
          instructions: "Keep #FAF9F5 warm aesthetic",
          updatedAt: 1000,
          items: [{ id: "p1", content: "Never use pkill -f", enabled: true, createdAt: 950, updatedAt: 1000 }],
        },
      },
      transcriptIndex: {
        "sess-123": { title: "Important PI Desktop Chat", updatedAt: 1200, lineCount: 42 },
      },
    };
    writeFileSync(join(mockPiDesktop, "memory-store.json"), JSON.stringify(sourceDoc));
    writeFileSync(
      join(mockPiDesktop, "memory-sync.json"),
      JSON.stringify({ account: { token: "gho_mock_token", username: "SeredenFei", repo: "pi-memory-sync" } }),
    );

    const res1 = seedFromPiDesktopIfNeeded(targetDataDir, [mockPiDesktop]);
    assert.equal(res1.seeded, true);
    assert.equal(res1.globalCount, 1);
    assert.equal(res1.projectCount, 1);
    assert.equal(res1.syncImported, true);

    // Second call is a no-op
    const res2 = seedFromPiDesktopIfNeeded(targetDataDir, [mockPiDesktop]);
    assert.equal(res2.seeded, false);

    // Verify transcriptIndex survived seeding intact
    const store = new PiMemoryStore(targetDataDir, { autoSeed: false });
    const loaded = store.load();
    assert.equal(loaded.transcriptIndex["sess-123"].lineCount, 42);
  });

  test("LWW merge respects tombstones and preserves transcriptIndex + future fields in both directions", () => {
    const local = {
      ...emptyMemoryDocument(),
      localFutureField: { keepMe: true },
      global: [
        { id: "m1", content: "Old text", enabled: true, createdAt: 100, updatedAt: 200 },
        { id: "m2", content: "Deleted locally", enabled: true, createdAt: 100, updatedAt: 500, deletedAt: 500 },
      ],
      transcriptIndex: {
        "s-local": { title: "Local session", updatedAt: 300 },
        "s-shared": { title: "Older title", updatedAt: 100 },
      },
    };
    const remote = {
      ...emptyMemoryDocument(),
      remoteFutureField: "from-pi-desktop-v2",
      global: [
        { id: "m1", content: "Newer remote text", enabled: true, createdAt: 100, updatedAt: 400 },
        { id: "m2", content: "Stale active copy on remote", enabled: true, createdAt: 100, updatedAt: 300 },
      ],
      transcriptIndex: {
        "s-remote": { title: "Remote session", updatedAt: 600 },
        "s-shared": { title: "Newer remote title", updatedAt: 450 },
      },
    };

    const merged = mergeMemoryDocuments(local, remote);
    const m1 = merged.global.find((x) => x.id === "m1");
    const m2 = merged.global.find((x) => x.id === "m2");
    assert.equal(m1.content, "Newer remote text");
    assert.equal(m2.deletedAt, 500, "Tombstone with newer timestamp must prevent resurrection");
    assert.equal(merged.transcriptIndex["s-local"].title, "Local session");
    assert.equal(merged.transcriptIndex["s-remote"].title, "Remote session");
    assert.equal(merged.transcriptIndex["s-shared"].title, "Newer remote title");
    assert.deepEqual(merged.localFutureField, { keepMe: true });
    assert.equal(merged.remoteFutureField, "from-pi-desktop-v2");
  });

  test("supports project memories, prompt injection, and per-conversation incognito isolation", () => {
    const dataDir = join(tempDir, "crud-data");
    const repoDir = join(tempDir, "demo-repo");
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    writeFileSync(join(repoDir, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:acme/demo.git\n');

    const store = new PiMemoryStore(dataDir, { autoSeed: false });
    store.remember({ scope: "global", content: "Use Conventional Commits" });
    store.remember({ scope: "project", content: "Run pnpm test before PR", cwd: repoDir });
    store.setProjectInstructions({ cwd: repoDir, instructions: "Strict TypeScript mode enabled." });

    const xml = store.buildPromptInjection({ cwd: repoDir, conversationId: "conv-normal" });
    assert.match(xml, /<user_memory>/);
    assert.match(xml, /Strict TypeScript mode enabled\./);
    assert.match(xml, /Use Conventional Commits/);
    assert.match(xml, /Run pnpm test before PR/);

    // Enable incognito for conv-secret
    store.setIsolated("conv-secret", true);
    assert.equal(store.isIsolated("conv-secret"), true);
    assert.equal(store.buildPromptInjection({ cwd: repoDir, conversationId: "conv-secret" }), "");
    assert.throws(
      () => store.remember({ scope: "global", content: "Secret note", conversationId: "conv-secret" }),
      /独立记忆/,
    );
  });
});

describe("3. Quote-Aware Read-Only Shell Gate & High-Risk Safety Redlines", () => {
  test("isShellCommandReadOnly allows safe inspection pipelines and blocks mutations/escapes", () => {
    assert.equal(isShellCommandReadOnly("git status --short"), true);
    assert.equal(isShellCommandReadOnly("git -C /tmp/repo --no-pager diff --stat"), true);
    assert.equal(isShellCommandReadOnly('rg -n "mergeMemory|PlanBoard" lib | head -n 20'), true);
    assert.equal(isShellCommandReadOnly("ls -la && pwd"), true);
    assert.equal(isShellCommandReadOnly("node --version"), true);
    assert.equal(isShellCommandReadOnly("jq -r .version plugin.json"), true);

    // Rejects writes, subshells, redirections, arbitrary execution, backgrounding
    assert.equal(isShellCommandReadOnly("rm -f foo.txt"), false);
    assert.equal(isShellCommandReadOnly("git commit -m 'wip'"), false);
    assert.equal(isShellCommandReadOnly("npm install lodash"), false);
    assert.equal(isShellCommandReadOnly("node -e 'fs.unlinkSync(\"a\")'"), false);
    assert.equal(isShellCommandReadOnly("echo hello > out.txt"), false);
    assert.equal(isShellCommandReadOnly("ls $(whoami)"), false);
    assert.equal(isShellCommandReadOnly("cat `id`"), false);
    assert.equal(isShellCommandReadOnly("ls &"), false);
    assert.equal(isShellCommandReadOnly("find . -exec rm {} ;"), false);
  });

  test("checkHighRiskCommand blocks pkill -f and catastrophic rm -rf, force_asks destructive git", () => {
    assert.equal(checkHighRiskCommand("pkill -f node").action, "deny");
    assert.equal(checkHighRiskCommand("rm -rf /").action, "deny");
    assert.equal(checkHighRiskCommand("rm -rf ~").action, "deny");
    assert.equal(checkHighRiskCommand("git reset --hard HEAD~1").action, "force_ask");
    assert.equal(checkHighRiskCommand("git clean -fd").action, "force_ask");
    assert.equal(checkHighRiskCommand("git checkout -- .").action, "force_ask");
    assert.equal(checkHighRiskCommand("git push origin main --force").action, "force_ask");
    assert.equal(checkHighRiskCommand("git push origin feat --force-with-lease").action, "allow");
  });
});

describe("4. PlanBoard State Machine & Clean-Session New-Window Handoff", () => {
  let tempDir;
  before(() => {
    tempDir = makeTempDir("pi-plan-");
  });
  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("manages planMode, step check-offs, artifact mirroring, and [PI_HANDOFF:<id>] auto-claim", () => {
    const artifactDir = join(tempDir, "artifacts");
    mkdirSync(artifactDir, { recursive: true });
    const store = new PiPlanStore(tempDir);

    const plan = store.setPlan("conv-plan-1", {
      title: "Port PI Strengths",
      planMode: true,
      artifactDir,
      cwd: "/tmp/demo",
      steps: [
        { id: "s1", title: "Audit codebase", files: ["server/memory-store.ts"] },
        { id: "s2", title: "Implement MCP server", verify: "node --test" },
      ],
    });
    assert.equal(plan.planMode, true);
    assert.equal(existsSync(join(artifactDir, "pi-plan-board.md")), true);

    // Create Clean-Session Handoff -> unlocks source conversation & creates claimable token
    const handoff = store.createHandoff("conv-plan-1", {
      contextNotes: "Zero external npm dependencies.",
    });
    assert.equal(store.getPlan("conv-plan-1").planMode, false, "Source plan must unlock on handoff");
    assert.match(handoff.prompt, new RegExp(`\\[PI_HANDOFF:${handoff.handoffId}\\]`));

    // Claim in brand-new window
    const claimed = store.claimHandoffFromPrompt("conv-clean-2", handoff.prompt);
    assert.ok(claimed);
    assert.equal(claimed.planMode, false);
    assert.equal(claimed.steps[0].status, "in_progress");
    assert.equal(claimed.steps[1].status, "pending");

    // Tick off step 1 -> step 2
    const afterS1 = store.updateStep("conv-clean-2", { stepId: "s1", status: "done" });
    assert.equal(afterS1.steps[0].status, "done");
    assert.equal(afterS1.activeStepId, "s2");
  });
});

describe("5. Goal Mode 2.0 & Deterministic Git Diff Stagnation Circuit Breaker", () => {
  let tempDir;
  let gitRepo;
  before(() => {
    tempDir = makeTempDir("pi-goal-");
    gitRepo = join(tempDir, "repo");
    mkdirSync(gitRepo, { recursive: true });
    execFileSync("git", ["init"], { cwd: gitRepo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: gitRepo });
    execFileSync("git", ["config", "user.name", "PI Test"], { cwd: gitRepo });
    writeFileSync(join(gitRepo, "index.js"), "export const v = 1;\n");
    execFileSync("git", ["add", "."], { cwd: gitRepo });
    execFileSync("git", ["commit", "-m", "chore: init"], { cwd: gitRepo });
  });
  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("computes git diff fingerprints, enforces reviewer gate, and trips 2-round stagnation breaker", async () => {
    const store = new PiGoalStore(tempDir);
    store.setGoal("conv-g1", {
      objective: "Add v2 export with passing tests",
      maxRounds: 5,
      cwd: gitRepo,
    });

    // Make real edit in round 1
    writeFileSync(join(gitRepo, "index.js"), "export const v = 2;\n");
    const snap1 = await computeWorkspaceDiffFingerprint(gitRepo);
    assert.equal(snap1.isGitRepo, true);
    assert.equal(snap1.changedFiles, 1);

    // Stop 1: no verdict yet -> asks agent to invoke pi-goal-reviewer
    const stop1 = await store.evaluateOnStop("conv-g1", { cwd: gitRepo });
    assert.equal(stop1.shouldContinue, true);
    assert.match(stop1.reason, /pi-goal-reviewer/);

    // Reviewer requests revision, but agent makes ZERO further file edits for 2 stops -> trips circuit breaker!
    store.recordVerdict("conv-g1", { verdict: "revise", feedback: "Missing unit test" });
    const stop2 = await store.evaluateOnStop("conv-g1", { cwd: gitRepo, continuationActive: true });
    assert.equal(stop2.shouldContinue, true);
    assert.equal(stop2.goal.round, 2);
    assert.equal(stop2.goal.stagnantRounds, 1);

    const stop3 = await store.evaluateOnStop("conv-g1", { cwd: gitRepo, continuationActive: true });
    assert.equal(stop3.shouldContinue, false);
    assert.equal(stop3.blocked, true);
    assert.equal(stop3.goal.phase, "blocked");
    assert.match(stop3.goal.blockedReason, /Git Diff 指纹无任何变化/);

    // Fresh goal passing reviewer verdict completes cleanly
    store.setGoal("conv-g2", { objective: "Ship feature", maxRounds: 4, cwd: gitRepo });
    store.recordVerdict("conv-g2", { verdict: "pass", feedback: "All tests green" });
    const stopPass = await store.evaluateOnStop("conv-g2", { cwd: gitRepo });
    assert.equal(stopPass.shouldContinue, false);
    assert.equal(stopPass.goal.phase, "completed");
  });
});

describe("6. Lifecycle Hooks End-to-End Subprocess Verification", () => {
  let dataDir;
  let artifactDir;
  before(() => {
    dataDir = makeTempDir("pi-hooks-");
    artifactDir = join(dataDir, "conv-artifacts");
    mkdirSync(artifactDir, { recursive: true });
  });
  after(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("session-start, pre-tool-use, and stop hooks enforce exact Antigravity JSON contracts", () => {
    const memStore = new PiMemoryStore(dataDir, { autoSeed: false });
    memStore.remember({ scope: "global", content: "Hook test global memory" });

    const planStore = new PiPlanStore(dataDir);
    planStore.setPlan("conv-hook", {
      title: "Hook Gate Test",
      planMode: true,
      steps: [{ id: "step-1", title: "Step one" }],
    });

    // 1. SessionStart injects <pi_session> + <user_memory>
    const startOut = runHook(
      "hooks/session-start.mjs",
      {
        conversationId: "conv-hook",
        cwd: dataDir,
        artifactDirectoryPath: artifactDir,
        lastUserInput: "Hello",
      },
      dataDir,
    );
    const sysMsg = startOut.injectSteps?.[0]?.systemMessage?.systemMessage || "";
    assert.match(sysMsg, /<pi_session conversation_id="conv-hook"/);
    assert.match(sysMsg, /Hook test global memory/);

    // 2. PreToolUse while planMode=true: blocks edit_file, blocks workspace write_file, allows artifact write_file, allows git status, blocks npm install
    assert.equal(
      runHook(
        "hooks/pre-tool-use.mjs",
        {
          conversationId: "conv-hook",
          artifactDirectoryPath: artifactDir,
          toolCall: { name: "edit_file", args: { Path: "/tmp/a.js" } },
        },
        dataDir,
      ).decision,
      "deny",
    );
    assert.equal(
      runHook(
        "hooks/pre-tool-use.mjs",
        {
          conversationId: "conv-hook",
          artifactDirectoryPath: artifactDir,
          toolCall: { name: "write_file", args: { Path: "/tmp/outside.md" } },
        },
        dataDir,
      ).decision,
      "deny",
    );
    assert.equal(
      runHook(
        "hooks/pre-tool-use.mjs",
        {
          conversationId: "conv-hook",
          artifactDirectoryPath: artifactDir,
          toolCall: { name: "write_file", args: { Path: join(artifactDir, "plan.md") } },
        },
        dataDir,
      ).decision,
      "allow",
    );
    assert.equal(
      runHook(
        "hooks/pre-tool-use.mjs",
        {
          conversationId: "conv-hook",
          artifactDirectoryPath: artifactDir,
          toolCall: { name: "run_command", args: { CommandLine: "git status --short" } },
        },
        dataDir,
      ).decision,
      "allow",
    );
    assert.equal(
      runHook(
        "hooks/pre-tool-use.mjs",
        {
          conversationId: "conv-hook",
          artifactDirectoryPath: artifactDir,
          toolCall: { name: "run_command", args: { CommandLine: "npm test" } },
        },
        dataDir,
      ).decision,
      "deny",
    );

    // 3. Unlock Plan Mode -> first step becomes in_progress; Stop hook nudges once if forgotten
    planStore.setPlanMode("conv-hook", false);
    const stopNudge = runHook(
      "hooks/stop.mjs",
      {
        conversationId: "conv-hook",
        terminationReason: "NO_TOOL_CALL",
        continuationActive: false,
      },
      dataDir,
    );
    assert.equal(stopNudge.decision, "continue");
    assert.match(stopNudge.reason, /PI PlanBoard 检查/);

    // Never infinite-loop when continuationActive is already true
    const stopAfterNudge = runHook(
      "hooks/stop.mjs",
      {
        conversationId: "conv-hook",
        terminationReason: "NO_TOOL_CALL",
        continuationActive: true,
      },
      dataDir,
    );
    assert.equal(stopAfterNudge.decision, "stop");
  });
});

describe("7. Zero-Dependency MCP Stdio Server (NDJSON & Content-Length)", () => {
  let dataDir;
  before(() => {
    dataDir = makeTempDir("pi-mcp-");
    // Ensure non-seeding marker exists so test is hermetic
    writeFileSync(join(dataDir, ".seeded-v1.json"), JSON.stringify({ seededAt: Date.now() }));
  });
  after(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("serves initialize, compact tools/list (<4KB budget), and tools/call over NDJSON", async () => {
    const serverPath = join(PLUGIN_ROOT, "mcp", "server.mjs");
    const proc = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PI_KIT_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const responses = new Map();
    let buf = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) {
          const msg = JSON.parse(line);
          responses.set(msg.id, msg);
        }
      }
    });

    const rpc = (id, method, params = {}) =>
      new Promise((resolveResp, reject) => {
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        const deadline = setTimeout(() => reject(new Error(`MCP timeout for ${method}`)), 5000);
        const timer = setInterval(() => {
          if (responses.has(id)) {
            clearInterval(timer);
            clearTimeout(deadline);
            resolveResp(responses.get(id));
          }
        }, 15);
      });

    try {
      const initRes = await rpc(1, "initialize", { protocolVersion: "2024-11-05" });
      assert.equal(initRes.result.serverInfo.name, "pi-kit");

      const listRes = await rpc(2, "tools/list");
      const tools = listRes.result.tools;
      assert.deepEqual(
        tools.map((t) => t.name),
        ["pi_memory", "pi_plan", "pi_goal"],
      );
      assert.ok(
        Buffer.byteLength(JSON.stringify(tools), "utf8") < 4096,
        "Always-on MCP tool schema must stay under 4KB context budget",
      );

      const memCall = await rpc(3, "tools/call", {
        name: "pi_memory",
        arguments: { action: "remember", scope: "global", content: "MCP integration works", conversationId: "c-mcp" },
      });
      assert.match(memCall.result.content[0].text, /已写入记忆/);

      const planCall = await rpc(4, "tools/call", {
        name: "pi_plan",
        arguments: {
          action: "set",
          conversationId: "c-mcp",
          title: "MCP Plan",
          planMode: false,
          steps: [{ title: "Verify MCP" }],
        },
      });
      assert.match(planCall.result.content[0].text, /MCP Plan/);
    } finally {
      proc.kill("SIGTERM");
    }
  });

  test("auto-detects and speaks Content-Length framing", async () => {
    const serverPath = join(PLUGIN_ROOT, "mcp", "server.mjs");
    const proc = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PI_KIT_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      const payload = JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" });
      const frame = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
      const rawOut = await new Promise((resolveOut, reject) => {
        let acc = "";
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", (d) => {
          acc += d;
          if (acc.includes("\r\n\r\n") && acc.includes('"id":99')) resolveOut(acc);
        });
        setTimeout(() => reject(new Error("Content-Length ping timeout")), 5000);
        proc.stdin.write(frame);
      });
      assert.match(rawOut, /^Content-Length:\s*\d+\r\n\r\n/);
    } finally {
      proc.kill("SIGTERM");
    }
  });
});

describe("8. PI Hub Sidecar HTTP Server & New-Window Loopback Bridge", () => {
  let dataDir;
  let port;
  let sidecarProc;
  const uiToken = "test-sidecar-secret-token";

  before(async () => {
    dataDir = makeTempDir("pi-sidecar-");
    writeFileSync(join(dataDir, ".seeded-v1.json"), JSON.stringify({ seededAt: Date.now() }));

    // Create a mock agentapi executable to verify Clean-Session New-Window Handoff arguments!
    const mockAgentApi = join(dataDir, "mock-agentapi.mjs");
    writeFileSync(
      mockAgentApi,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("get-conversation-metadata")) {
  process.stdout.write(JSON.stringify({ response: { conversationMetadata: { metadata: { projectId: "proj-42" } } } }));
} else if (args.includes("new-conversation")) {
  process.stdout.write(JSON.stringify({ conversationId: "spawned-conv-888", receivedArgs: args, projectId: process.env.ANTIGRAVITY_PROJECT_ID || "" }));
} else {
  process.stdout.write("{}");
}
`,
    );
    chmodSync(mockAgentApi, 0o755);

    const mockSdkPath = join(dataDir, "mock-sidecar-sdk.mjs");
    writeFileSync(
      mockSdkPath,
      `import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
export class Response {
  constructor(body, { contentType = "text/plain", status = 200, headers } = {}) {
    this.body = body;
    this.contentType = contentType;
    this.status = status;
    this.headers = headers;
  }
}
export class SidecarApp {
  #token = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
  #port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT);
  #pages = new Map();
  #apis = new Map();
  get config() {
    return {
      projectId: process.env.ANTIGRAVITY_PROJECT_ID,
      conversationId: process.env.ANTIGRAVITY_CONVERSATION_ID,
    };
  }
  page(p, h) { this.#pages.set(p, h); }
  api(p, h, m = "POST") {
    if (!this.#apis.has(p)) this.#apis.set(p, new Map());
    this.#apis.get(p).set(m.toUpperCase(), h);
  }
  getConversationMetadata(id) {
    const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE || "agentapi";
    const out = execFileSync(exe, exe === "agentapi" ? ["get-conversation-metadata", id] : ["agentapi", "get-conversation-metadata", id], { encoding: "utf8" });
    return out.trim() ? JSON.parse(out) : {};
  }
  run() {
    this.#pages.set("/preload.js", () => "window.sidecar = {};");
    const srv = createServer(async (req, res) => {
      const url = new URL(req.url, "http://127.0.0.1:" + this.#port);
      if (req.method !== "GET" && url.pathname !== "/preload.js" && this.#token) {
        const tok = req.headers["x-sidecar-token"] || url.searchParams.get("token");
        if (tok !== this.#token) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }
      if (req.method === "GET" && this.#pages.has(url.pathname)) {
        const c = await this.#pages.get(url.pathname)();
        if (c instanceof Response) {
          res.writeHead(c.status || 200, { "Content-Type": c.contentType, ...c.headers });
          res.end(c.body);
          return;
        }
        res.writeHead(200, { "Content-Type": url.pathname.endsWith(".js") ? "application/javascript" : "text/html" });
        res.end(c);
        return;
      }
      if (this.#apis.has(url.pathname) && this.#apis.get(url.pathname).has(req.method)) {
        let body = "";
        req.on("data", (ch) => { body += ch; });
        req.on("end", async () => {
          try {
            const data = {};
            for (const [k, v] of url.searchParams.entries()) if (k.toLowerCase() !== "token") data[k] = v;
            if (body) Object.assign(data, JSON.parse(body));
            const r = await this.#apis.get(url.pathname).get(req.method)(data);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(r));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    return new Promise((r) => srv.listen(this.#port, "127.0.0.1", () => {
      console.log("[sidecar] listening on 127.0.0.1:" + srv.address().port);
      r(srv);
    }));
  }
}
`,
    );

    port = await getFreePort();
    sidecarProc = spawn(process.execPath, [join(PLUGIN_ROOT, "sidecars", "pi_hub", "main.mjs")], {
      env: {
        ...process.env,
        PI_KIT_DATA_DIR: dataDir,
        PI_KIT_SIDECAR_SDK_SPECIFIER: new URL(`file://${mockSdkPath}`).href,
        ANTIGRAVITY_LS_ADDRESS: "127.0.0.1:59999",
        ANTIGRAVITY_CSRF_TOKEN: "mock-csrf",
        ANTIGRAVITY_SIDECAR_WEB_PORT: String(port),
        ANTIGRAVITY_SIDECAR_UI_TOKEN: uiToken,
        ANTIGRAVITY_CONVERSATION_ID: "conv-ui-1",
        ANTIGRAVITY_AGENTAPI_EXE: mockAgentApi,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sidecar startup timeout")), 8000);
      sidecarProc.stdout.setEncoding("utf8");
      sidecarProc.stdout.on("data", (chunk) => {
        if (chunk.includes("[sidecar] listening")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
      sidecarProc.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Sidecar exited prematurely with code ${code}`));
      });
    });
  });

  after(() => {
    if (sidecarProc) sidecarProc.kill("SIGTERM");
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("serves host-theme-synced UI assets, enforces X-Sidecar-Token on POST, and executes Clean New-Window Handoff", async () => {
    // 1. Static UI & CSS bound to host theme tokens
    const htmlRes = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /PI Hub/);

    const cssRes = await fetch(`http://127.0.0.1:${port}/styles.css`);
    assert.equal(cssRes.status, 200);
    const css = await cssRes.text();
    assert.match(css, /var\(--background/);
    assert.match(css, /var\(--primary/);

    // 2. Unauthenticated POST must be rejected with 401
    const unauth = await fetch(`http://127.0.0.1:${port}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_step", title: "Should fail" }),
    });
    assert.equal(unauth.status, 401);

    // 3. Authenticated Plan creation + Snapshot check
    const addRes = await fetch(`http://127.0.0.1:${port}/api/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Token": uiToken,
      },
      body: JSON.stringify({
        conversationId: "conv-ui-1",
        action: "add_step",
        title: "Verify PI Hub Sidecar",
      }),
    });
    assert.equal(addRes.status, 200);

    const snapRes = await fetch(`http://127.0.0.1:${port}/api/snapshot?conversationId=conv-ui-1`);
    assert.equal(snapRes.status, 200);
    const snap = await snapRes.json();
    assert.equal(snap.plan.steps.length, 1);
    assert.equal(snap.plan.steps[0].title, "Verify PI Hub Sidecar");

    // 4. End-to-end launchNewWindowHandoff from PiPlanStore via sidecar-bridge.json!
    const planStore = new PiPlanStore(dataDir);
    const launched = await planStore.launchNewWindowHandoff("conv-ui-1", {
      title: "Clean Window Test",
      contextNotes: "Keep warm palette",
    });
    assert.equal(launched.launched, true);
    assert.equal(launched.via, "sidecar-agentapi");
    assert.equal(launched.newConversationId, "spawned-conv-888");

    // Spawned conversation automatically has the claimed PlanBoard!
    const spawnedPlan = planStore.getPlan("spawned-conv-888");
    assert.ok(spawnedPlan);
    assert.equal(spawnedPlan.steps[0].status, "in_progress");
  });
});
