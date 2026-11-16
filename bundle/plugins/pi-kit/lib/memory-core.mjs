/**
 * Hierarchical Memory Store & GitHub `pi-memory-sync` Lossless Merge Engine.
 *
 * Schema-compatible with `SeredenFei/pi-desktop` (`v0.117.0`):
 * - Supports `global` memories + `project` buckets (keyed by normalized Git remote URL `git:<host>/<owner>/<repo>`
 *   or `dir:<folder>`), plus `chat-space` fallback when no workspace is open.
 * - Supports per-conversation isolated/incognito mode (`isolatedSessionIds`).
 * - Deterministic per-item `id + max(updatedAt, deletedAt)` tombstone merge (`mergeMemoryDocuments`),
 *   strictly preserving `pi-desktop` remote fields such as `transcriptIndex` so cross-app cloud sync never drops transcripts.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { readJsonSafe, resolveDataDir, writeJsonAtomic } from "./atomic-io.mjs";

export const MAX_MEMORY_ITEM_CHARS = 1000;
export const MAX_MEMORIES_PER_SCOPE = 300;
export const MAX_PROJECT_INSTRUCTIONS_CHARS = 8000;
export const GITHUB_DEVICE_CLIENT_ID = "178c6fc778ccc68e1d6a";
export const DEFAULT_SYNC_REPO = "pi-memory-sync";
export const REMOTE_FILE_PATH = "memory-store.json";

function clampText(raw, maxChars) {
  const trimmed = String(raw ?? "").trim().replace(/\r\n/g, "\n");
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

export function emptyMemoryDocument() {
  return {
    version: 1,
    updatedAt: 0,
    global: [],
    projects: {},
    isolatedSessionIds: [],
  };
}

/**
 * Walks up from `cwd` to locate `.git/config` (handling both normal repos and worktree `.git` gitdir files)
 * and extracts a normalized `git:<host>/<owner>/<repo>` key matching `pi-desktop`.
 */
export function detectGitRemoteKey(cwd) {
  if (!cwd || typeof cwd !== "string") return null;
  let cur = resolve(cwd);
  for (let depth = 0; depth < 16; depth++) {
    const dotGit = join(cur, ".git");
    if (existsSync(dotGit)) {
      let gitConfigPath = join(dotGit, "config");
      try {
        const st = statSync(dotGit);
        if (st.isFile()) {
          const ptr = readFileSync(dotGit, "utf8");
          const m = /^gitdir:\s*(.+)$/m.exec(ptr);
          if (m) {
            const gitDir = resolve(cur, m[1].trim());
            // Worktree gitdir points to <repo>/.git/worktrees/<name>; walk up to find config.
            if (existsSync(join(gitDir, "config"))) {
              gitConfigPath = join(gitDir, "config");
            } else if (existsSync(join(gitDir, "..", "..", "config"))) {
              gitConfigPath = resolve(gitDir, "..", "..", "config");
            }
          }
        }
      } catch {
        // Ignore stat errors.
      }
      if (existsSync(gitConfigPath)) {
        try {
          const text = readFileSync(gitConfigPath, "utf8");
          const urlMatch = /^\s*url\s*=\s*(.+)$/m.exec(text);
          if (urlMatch) {
            let url = urlMatch[1].trim().toLowerCase();
            url = url
              .replace(/^git@([^:]+):/, "$1/")
              .replace(/^https?:\/\//, "")
              .replace(/^ssh:\/\/git@/, "")
              .replace(/\/+$/, "")
              .replace(/\.git$/, "")
              .replace(/\/+$/, "");
            if (url) return `git:${url}`;
          }
        } catch {
          return null;
        }
      }
      break;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Resolves workspace identity (`chat-space` when no workspace is open, `git:...`, or `dir:...`).
 */
export function resolveProjectIdentity(cwd) {
  const clean = typeof cwd === "string" ? cwd.trim() : "";
  if (!clean || !existsSync(clean)) {
    return {
      projectKey: "chat-space",
      name: "独立对话 (Standalone)",
      isChatSpace: true,
      folderName: "",
    };
  }
  const resolved = resolve(clean);
  const folderName = basename(resolved) || "workspace";
  const gitKey = detectGitRemoteKey(resolved);
  if (gitKey) {
    return {
      projectKey: gitKey,
      name: folderName,
      isChatSpace: false,
      folderName: folderName.toLowerCase(),
    };
  }
  return {
    projectKey: `dir:${folderName.toLowerCase()}`,
    name: folderName,
    isChatSpace: false,
    folderName: folderName.toLowerCase(),
  };
}

/**
 * Deterministic LWW merge per memory item ID with `deletedAt` tombstones.
 */
export function mergeMemoryItems(local = [], remote = []) {
  const map = new Map();
  for (const item of [...local, ...remote]) {
    if (!item || typeof item.id !== "string" || !item.id) continue;
    const prev = map.get(item.id);
    const itemStamp = Math.max(Number(item.updatedAt) || 0, Number(item.deletedAt) || 0);
    const prevStamp = prev ? Math.max(Number(prev.updatedAt) || 0, Number(prev.deletedAt) || 0) : -1;
    if (!prev || itemStamp >= prevStamp) {
      map.set(item.id, {
        id: item.id,
        content: clampText(item.content ?? "", MAX_MEMORY_ITEM_CHARS),
        enabled: item.enabled !== false,
        createdAt: Number(item.createdAt) || itemStamp || Date.now(),
        updatedAt: Number(item.updatedAt) || itemStamp || Date.now(),
        ...(item.deletedAt ? { deletedAt: Number(item.deletedAt) } : {}),
      });
    }
  }
  const all = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const active = [];
  const tombs = [];
  for (const it of all) {
    if (it.deletedAt) tombs.push(it);
    else if (it.content) active.push(it);
  }
  return [...active.slice(0, MAX_MEMORIES_PER_SCOPE), ...tombs.slice(0, MAX_MEMORIES_PER_SCOPE)];
}

/**
 * Lossless merge of two MemoryDocuments while preserving `pi-desktop` specific fields
 * (`transcriptIndex`, `chatTranscripts`, and any future top-level metadata).
 */
export function mergeMemoryDocuments(localRaw, remoteRaw) {
  const local = localRaw && typeof localRaw === "object" ? localRaw : emptyMemoryDocument();
  const remote = remoteRaw && typeof remoteRaw === "object" ? remoteRaw : emptyMemoryDocument();

  const projects = {};
  const keys = new Set([
    ...Object.keys(local.projects ?? {}),
    ...Object.keys(remote.projects ?? {}),
  ]);

  for (const key of keys) {
    const a = local.projects?.[key];
    const b = remote.projects?.[key];
    if (a && !b) {
      projects[key] = { ...a, items: mergeMemoryItems(a.items ?? [], []) };
    } else if (!a && b) {
      projects[key] = { ...b, items: mergeMemoryItems([], b.items ?? []) };
    } else if (a && b) {
      const aDel = Number(a.deletedAt) || 0;
      const bDel = Number(b.deletedAt) || 0;
      const maxDel = Math.max(aDel, bDel);
      const aUpd = Number(a.updatedAt) || 0;
      const bUpd = Number(b.updatedAt) || 0;
      const maxUpd = Math.max(aUpd, bUpd);
      const aInstAt = Number(a.instructionsUpdatedAt) || aUpd;
      const bInstAt = Number(b.instructionsUpdatedAt) || bUpd;
      const newerInst = bInstAt >= aInstAt ? b : a;
      const newerMeta = bUpd >= aUpd ? b : a;
      const isDeleted = maxDel > 0 && maxDel >= maxUpd;

      projects[key] = {
        ...b,
        ...a,
        projectKey: key,
        name: newerMeta.name || a.name || b.name || key,
        ...(newerInst.instructions
          ? { instructions: clampText(newerInst.instructions, MAX_PROJECT_INSTRUCTIONS_CHARS) }
          : {}),
        instructionsUpdatedAt: Math.max(aInstAt, bInstAt),
        ...(a.isChatProject || b.isChatProject ? { isChatProject: true } : {}),
        ...(newerMeta.slug || a.slug || b.slug ? { slug: newerMeta.slug || a.slug || b.slug } : {}),
        ...(newerMeta.folderName || a.folderName || b.folderName
          ? { folderName: newerMeta.folderName || a.folderName || b.folderName }
          : {}),
        ...(isDeleted ? { deletedAt: maxDel } : {}),
        updatedAt: Math.max(maxUpd, maxDel),
        items: isDeleted ? [] : mergeMemoryItems(a.items ?? [], b.items ?? []),
      };
      if (!newerInst.instructions) delete projects[key].instructions;
      if (!isDeleted) delete projects[key].deletedAt;
    }
  }

  // Preserve transcriptIndex from both sides (remote wins on higher updatedAt/lineCount)
  // so pushing from Antigravity NEVER erases pi-desktop's synced chat transcripts!
  const mergedTranscriptIndex = {};
  const tKeys = new Set([
    ...Object.keys(local.transcriptIndex ?? {}),
    ...Object.keys(remote.transcriptIndex ?? {}),
  ]);
  for (const sid of tKeys) {
    const lt = local.transcriptIndex?.[sid];
    const rt = remote.transcriptIndex?.[sid];
    const chosen =
      lt && rt
        ? (Number(rt.updatedAt) || 0) >= (Number(lt.updatedAt) || 0)
          ? rt
          : lt
        : rt ?? lt;
    if (chosen && typeof chosen === "object") {
      if (chosen.scopeKey && projects[chosen.scopeKey]?.deletedAt) continue;
      mergedTranscriptIndex[sid] = chosen;
    }
  }

  // Carry over any unknown top-level keys from both local and remote (remote wins ties)
  // so future pi-desktop fields survive round-trip merges in either direction.
  const passthrough = {};
  for (const [k, v] of [...Object.entries(local), ...Object.entries(remote)]) {
    if (!["version", "updatedAt", "global", "projects", "isolatedSessionIds", "transcriptIndex"].includes(k)) {
      passthrough[k] = v;
    }
  }

  return {
    ...passthrough,
    version: 1,
    updatedAt: Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0, Date.now()),
    global: mergeMemoryItems(local.global ?? [], remote.global ?? []),
    projects,
    isolatedSessionIds: [
      ...new Set([...(local.isolatedSessionIds ?? []), ...(remote.isolatedSessionIds ?? [])]),
    ].slice(-500),
    ...(Object.keys(mergedTranscriptIndex).length > 0 || remote.transcriptIndex || local.transcriptIndex
      ? { transcriptIndex: mergedTranscriptIndex }
      : {}),
  };
}

/**
 * One-time non-destructive seed from local `pi-desktop` data directory on first initialization.
 * Reads `pi-desktop` files strictly read-only and never touches them again.
 */
export function seedFromPiDesktopIfNeeded(dataDir, candidateDirs) {
  const storeFile = join(dataDir, "memory-store.json");
  const syncFile = join(dataDir, "memory-sync.json");
  const markerFile = join(dataDir, ".seeded-v1.json");
  if (existsSync(storeFile) || existsSync(markerFile)) {
    return { seeded: false };
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const defaults = candidateDirs ?? [
    join(xdgConfig, "pi-web-ui", "data"),
    join(xdgConfig, "PI", "data"),
    join(xdgData, "pi-web-ui", "data"),
    join(xdgData, "PI", "data"),
    join(homedir(), "Library", "Application Support", "pi-web-ui", "data"),
    join(homedir(), "Library", "Application Support", "PI", "data"),
    join(homedir(), ".pi-web"),
  ];

  let importedFrom = null;
  let globalCount = 0;
  let projectCount = 0;
  let syncImported = false;

  for (const srcDir of defaults) {
    const srcStore = join(srcDir, "memory-store.json");
    if (existsSync(srcStore)) {
      const raw = readJsonSafe(srcStore, null);
      if (raw && typeof raw === "object") {
        const merged = mergeMemoryDocuments(emptyMemoryDocument(), raw);
        writeJsonAtomic(storeFile, merged);
        importedFrom = srcDir;
        globalCount = (merged.global ?? []).filter((i) => !i.deletedAt && i.content).length;
        projectCount = Object.values(merged.projects ?? {}).filter((p) => !p?.deletedAt).length;
      }
      const srcSync = join(srcDir, "memory-sync.json");
      if (existsSync(srcSync) && !existsSync(syncFile)) {
        const rawSync = readJsonSafe(srcSync, null);
        if (rawSync?.account?.token && rawSync?.account?.username) {
          writeJsonAtomic(syncFile, {
            account: {
              token: String(rawSync.account.token),
              username: String(rawSync.account.username),
              ...(rawSync.account.avatarUrl ? { avatarUrl: String(rawSync.account.avatarUrl) } : {}),
              repo: String(rawSync.account.repo || DEFAULT_SYNC_REPO),
              ...(rawSync.account.lastSyncedAt ? { lastSyncedAt: Number(rawSync.account.lastSyncedAt) } : {}),
            },
          });
          syncImported = true;
        }
      }
      if (importedFrom) break;
    }
  }

  writeJsonAtomic(markerFile, {
    seededAt: Date.now(),
    importedFrom,
    globalCount,
    projectCount,
    syncImported,
  });

  return { seeded: Boolean(importedFrom), importedFrom, globalCount, projectCount, syncImported };
}

export class PiMemoryStore {
  constructor(dataDir = resolveDataDir(), { autoSeed = true } = {}) {
    this.dataDir = resolve(dataDir);
    this.filePath = join(this.dataDir, "memory-store.json");
    if (autoSeed) {
      seedFromPiDesktopIfNeeded(this.dataDir);
    }
  }

  load() {
    const raw = readJsonSafe(this.filePath, null);
    if (!raw || typeof raw !== "object") return emptyMemoryDocument();
    return mergeMemoryDocuments(emptyMemoryDocument(), raw);
  }

  save(doc) {
    const latestOnDisk = readJsonSafe(this.filePath, null);
    const merged = latestOnDisk ? mergeMemoryDocuments(latestOnDisk, doc) : doc;
    merged.updatedAt = Date.now();
    writeJsonAtomic(this.filePath, merged);
    return merged;
  }

  isIsolated(conversationId) {
    if (!conversationId) return false;
    const doc = this.load();
    return Boolean(doc.isolatedSessionIds?.includes(conversationId));
  }

  setIsolated(conversationId, isolated) {
    if (!conversationId) throw new Error("conversationId is required");
    const doc = this.load();
    const set = new Set(doc.isolatedSessionIds ?? []);
    if (isolated) set.add(conversationId);
    else set.delete(conversationId);
    doc.isolatedSessionIds = [...set].slice(-500);
    writeJsonAtomic(this.filePath, { ...doc, updatedAt: Date.now() });
    return Boolean(isolated);
  }

  list({ scope = "all", cwd = "", includeDisabled = false } = {}) {
    const doc = this.load();
    const identity = resolveProjectIdentity(cwd);
    const bucket = doc.projects?.[identity.projectKey];
    const filterFn = (i) => !i.deletedAt && i.content && (includeDisabled || i.enabled !== false);
    const globalItems = scope === "project" ? [] : (doc.global ?? []).filter(filterFn);
    const projectItems =
      scope === "global" || identity.isChatSpace
        ? []
        : (bucket?.deletedAt ? [] : bucket?.items ?? []).filter(filterFn);
    return {
      identity,
      projectInstructions: !identity.isChatSpace && !bucket?.deletedAt ? bucket?.instructions ?? "" : "",
      globalItems,
      projectItems,
      allProjects: Object.values(doc.projects ?? {})
        .filter((b) => b && !b.deletedAt)
        .map((b) => {
          const activeItems = (b.items ?? []).filter(filterFn);
          return {
            projectKey: b.projectKey,
            name: b.name,
            instructions: b.instructions ?? "",
            activeCount: activeItems.length,
            items: activeItems,
            updatedAt: b.updatedAt ?? 0,
          };
        }),
    };
  }

  remember({
    scope = "global",
    content,
    cwd = "",
    projectKey = "",
    projectName = "",
    conversationId = "",
    id = "",
    enabled = true,
  } = {}) {
    if (conversationId && this.isIsolated(conversationId)) {
      throw new Error("当前对话已开启「🔒 独立记忆」，禁止向共享记忆库写入。");
    }
    const clean = clampText(content, MAX_MEMORY_ITEM_CHARS);
    if (!clean) throw new Error("Memory content cannot be empty");

    const doc = this.load();
    const now = Date.now();

    if (scope === "project") {
      const identity = projectKey
        ? {
            projectKey,
            name: projectName || doc.projects?.[projectKey]?.name || projectKey,
            isChatSpace: false,
            folderName: doc.projects?.[projectKey]?.folderName || "",
          }
        : resolveProjectIdentity(cwd);
      if (identity.isChatSpace) {
        throw new Error("当前无打开的代码工作区（处于独立对话空间），请先在下拉框选择一个项目桶或改用全局记忆。");
      }
      const bucket = doc.projects[identity.projectKey] ?? {
        projectKey: identity.projectKey,
        name: identity.name,
        folderName: identity.folderName,
        updatedAt: now,
        items: [],
      };
      delete bucket.deletedAt;
      bucket.updatedAt = now;
      const existing = (bucket.items ?? []).find(
        (i) => !i.deletedAt && (i.id === id || i.content.toLowerCase() === clean.toLowerCase()),
      );
      let targetItem;
      if (existing) {
        existing.content = clean;
        existing.enabled = enabled !== false;
        existing.updatedAt = now;
        targetItem = existing;
      } else {
        targetItem = {
          id: id || randomUUID().slice(0, 8),
          content: clean,
          enabled: enabled !== false,
          createdAt: now,
          updatedAt: now,
        };
        bucket.items = [targetItem, ...(bucket.items ?? [])];
      }
      doc.projects[identity.projectKey] = bucket;
      this.save(doc);
      return { scope: "project", projectKey: identity.projectKey, item: targetItem };
    }

    const existing = (doc.global ?? []).find(
      (i) => !i.deletedAt && (i.id === id || i.content.toLowerCase() === clean.toLowerCase()),
    );
    let targetItem;
    if (existing) {
      existing.content = clean;
      existing.enabled = enabled !== false;
      existing.updatedAt = now;
      targetItem = existing;
    } else {
      targetItem = {
        id: id || randomUUID().slice(0, 8),
        content: clean,
        enabled: enabled !== false,
        createdAt: now,
        updatedAt: now,
      };
      doc.global = [targetItem, ...(doc.global ?? [])];
    }
    this.save(doc);
    return { scope: "global", item: targetItem };
  }

  toggleItem({ scope = "global", id, enabled, cwd = "", projectKey = "" } = {}) {
    if (!id) throw new Error("Memory item id is required");
    const doc = this.load();
    const now = Date.now();
    const list =
      scope === "project"
        ? doc.projects[projectKey || resolveProjectIdentity(cwd).projectKey]?.items ?? []
        : doc.global ?? [];
    const found = list.find((i) => i.id === id && !i.deletedAt);
    if (!found) throw new Error(`Memory item not found: ${id}`);
    found.enabled = Boolean(enabled);
    found.updatedAt = now;
    if (scope === "project") {
      const pk = projectKey || resolveProjectIdentity(cwd).projectKey;
      if (doc.projects[pk]) doc.projects[pk].updatedAt = now;
    }
    writeJsonAtomic(this.filePath, { ...doc, updatedAt: now });
    return found;
  }

  setProjectInstructions({ cwd = "", projectKey = "", name = "", instructions = "" } = {}) {
    const identity = projectKey
      ? { projectKey, name: name || projectKey, isChatSpace: false, folderName: "" }
      : resolveProjectIdentity(cwd);
    if (identity.isChatSpace) {
      throw new Error("独立对话空间不支持项目级自定义指令");
    }
    const doc = this.load();
    const now = Date.now();
    const bucket = doc.projects[identity.projectKey] ?? {
      projectKey: identity.projectKey,
      name: identity.name,
      folderName: identity.folderName,
      updatedAt: now,
      items: [],
    };
    delete bucket.deletedAt;
    const cleanInst = clampText(instructions, MAX_PROJECT_INSTRUCTIONS_CHARS);
    if (cleanInst) bucket.instructions = cleanInst;
    else delete bucket.instructions;
    bucket.instructionsUpdatedAt = now;
    bucket.updatedAt = now;
    doc.projects[identity.projectKey] = bucket;
    writeJsonAtomic(this.filePath, { ...doc, updatedAt: now });
    return bucket;
  }

  forget({ id = "", query = "", scope = "all", cwd = "", projectKey = "", conversationId = "" } = {}) {
    if (conversationId && this.isIsolated(conversationId)) {
      throw new Error("当前对话已开启「🔒 独立记忆」，禁止修改共享记忆库。");
    }
    if (!id && !query) throw new Error("Provide id or query substring to forget");
    const doc = this.load();
    const now = Date.now();
    const needle = String(query || "").trim().toLowerCase();
    const removed = [];

    const matchAndTombstone = (items, bucketLabel) => {
      for (const item of items) {
        if (item.deletedAt) continue;
        const matched = id
          ? item.id === id
          : needle && item.content.toLowerCase().includes(needle);
        if (matched) {
          item.deletedAt = now;
          item.updatedAt = now;
          removed.push({ scope: bucketLabel, id: item.id, content: item.content });
        }
      }
    };

    if (scope === "all" || scope === "global") {
      matchAndTombstone(doc.global ?? [], "global");
    }
    if (scope === "all" || scope === "project") {
      const pk = projectKey || resolveProjectIdentity(cwd).projectKey;
      if (pk && doc.projects?.[pk]) {
        matchAndTombstone(doc.projects[pk].items ?? [], pk);
        if (removed.some((r) => r.scope === pk)) {
          doc.projects[pk].updatedAt = now;
        }
      }
    }

    if (removed.length > 0) {
      writeJsonAtomic(this.filePath, { ...doc, updatedAt: now });
    }
    return removed;
  }

  mergeRemote(remoteDoc) {
    const current = this.load();
    const merged = mergeMemoryDocuments(current, remoteDoc);
    writeJsonAtomic(this.filePath, merged);
    return merged;
  }

  /**
   * Builds the `<user_memory>` XML block injected once at `SessionStart` (cache-prefix friendly).
   */
  buildPromptInjection({ cwd = "", conversationId = "" } = {}) {
    if (conversationId && this.isIsolated(conversationId)) return "";
    const { identity, projectInstructions, globalItems, projectItems } = this.list({
      scope: "all",
      cwd,
      includeDisabled: false,
    });
    if (!projectInstructions && globalItems.length === 0 && projectItems.length === 0) {
      return "";
    }
    const sections = ["<user_memory>"];
    if (projectInstructions) {
      sections.push(
        `<project_custom_instructions project="${identity.name}">\n${projectInstructions}\n</project_custom_instructions>`,
      );
    }
    if (globalItems.length > 0) {
      const lines = globalItems.map((i) => `- [${i.id}] ${i.content}`).join("\n");
      sections.push(`<global_memories>\n${lines}\n</global_memories>`);
    }
    if (projectItems.length > 0) {
      const lines = projectItems.map((i) => `- [${i.id}] ${i.content}`).join("\n");
      sections.push(`<project_memories project="${identity.name}">\n${lines}\n</project_memories>`);
    }
    sections.push("</user_memory>");
    return sections.join("\n\n");
  }
}

/**
 * GitHub Cloud Sync Client (`pi-memory-sync`) supporting PAT, OAuth Device Flow,
 * >1MB Git Blobs fallback, and 409/422 SHA conflict retry.
 */
export class PiMemorySyncClient {
  constructor(store = new PiMemoryStore()) {
    this.store = store;
    this.configPath = join(store.dataDir, "memory-sync.json");
  }

  loadConfig() {
    return readJsonSafe(this.configPath, { account: null, pendingDeviceFlow: null });
  }

  saveConfig(cfg) {
    writeJsonAtomic(this.configPath, cfg, { mode: 0o600 });
  }

  getStatus() {
    const cfg = this.loadConfig();
    const acc = cfg?.account;
    const flow =
      cfg?.pendingDeviceFlow && cfg.pendingDeviceFlow.expiresAt > Date.now()
        ? {
            userCode: cfg.pendingDeviceFlow.userCode,
            verificationUri: cfg.pendingDeviceFlow.verificationUri,
            expiresAt: cfg.pendingDeviceFlow.expiresAt,
          }
        : null;
    return {
      loggedIn: Boolean(acc?.token && acc?.username),
      username: acc?.username ?? null,
      avatarUrl: acc?.avatarUrl ?? null,
      repo: acc?.repo ?? DEFAULT_SYNC_REPO,
      lastSyncedAt: acc?.lastSyncedAt ?? null,
      lastError: cfg?.lastError ?? null,
      deviceFlow: flow,
    };
  }

  async ghFetch(url, init = {}, overrideToken = "") {
    const cfg = this.loadConfig();
    const token = overrideToken || cfg?.account?.token || "";
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "PI-Kit-Antigravity-MemorySync",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(25000),
    });
  }

  async loginWithToken(rawToken, repoName = DEFAULT_SYNC_REPO) {
    const token = String(rawToken ?? "").trim();
    if (!token) throw new Error("GitHub Token 不能为空");
    const res = await this.ghFetch("https://api.github.com/user", {}, token);
    if (!res.ok) throw new Error(`GitHub 鉴权失败 (HTTP ${res.status})`);
    const user = await res.json();
    if (!user?.login) throw new Error("无法读取 GitHub 用户名");
    this.saveConfig({
      account: {
        token,
        username: user.login,
        ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
        repo: String(repoName || DEFAULT_SYNC_REPO).trim(),
      },
      pendingDeviceFlow: null,
      lastError: null,
    });
    return this.syncNow();
  }

  async startDeviceLogin(repoName = DEFAULT_SYNC_REPO) {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "PI-Kit-Antigravity-MemorySync",
      },
      body: JSON.stringify({
        client_id: GITHUB_DEVICE_CLIENT_ID,
        scope: "repo",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`发起 GitHub 设备码登录失败 (HTTP ${res.status})`);
    const data = await res.json();
    if (!data?.device_code || !data?.user_code) {
      throw new Error("GitHub 未返回有效设备码");
    }
    const cfg = this.loadConfig();
    cfg.pendingDeviceFlow = {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri || "https://github.com/login/device",
      intervalSec: Math.max(5, Number(data.interval) || 5),
      expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000,
      repo: String(repoName || DEFAULT_SYNC_REPO).trim(),
    };
    cfg.lastError = null;
    this.saveConfig(cfg);
    return this.getStatus();
  }

  async pollDeviceLoginOnce() {
    const cfg = this.loadConfig();
    const flow = cfg?.pendingDeviceFlow;
    if (!flow) return this.getStatus();
    if (Date.now() >= flow.expiresAt) {
      cfg.pendingDeviceFlow = null;
      cfg.lastError = "设备码已过期，请重新获取";
      this.saveConfig(cfg);
      return this.getStatus();
    }
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "PI-Kit-Antigravity-MemorySync",
      },
      body: JSON.stringify({
        client_id: GITHUB_DEVICE_CLIENT_ID,
        device_code: flow.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data?.access_token) {
      return this.loginWithToken(data.access_token, flow.repo || DEFAULT_SYNC_REPO);
    }
    if (data?.error && data.error !== "authorization_pending" && data.error !== "slow_down") {
      cfg.pendingDeviceFlow = null;
      cfg.lastError = `授权失败: ${data.error}`;
      this.saveConfig(cfg);
    }
    return this.getStatus();
  }

  logout() {
    this.saveConfig({ account: null, pendingDeviceFlow: null, lastError: null });
    return this.getStatus();
  }

  async ensureRemoteRepo(acc) {
    const check = await this.ghFetch(`https://api.github.com/repos/${acc.username}/${acc.repo}`);
    if (check.status === 200) return;
    if (check.status !== 404) throw new Error(`检查同步仓库失败 (HTTP ${check.status})`);
    const create = await this.ghFetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: acc.repo,
        description: "PI Cross-Device Shared Memory & Projects Sync",
        private: true,
        auto_init: true,
      }),
    });
    if (!create.ok && create.status !== 422) {
      throw new Error(`创建私有同步仓库 ${acc.repo} 失败 (HTTP ${create.status})`);
    }
  }

  async fetchGitBlob(acc, sha) {
    const res = await this.ghFetch(
      `https://api.github.com/repos/${acc.username}/${acc.repo}/git/blobs/${sha}`,
      { signal: AbortSignal.timeout(60000) },
    );
    if (!res.ok) throw new Error(`读取远端 Blob 失败 (HTTP ${res.status})`);
    const payload = await res.json();
    const text = payload.content
      ? Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8")
      : "";
    return { sha: payload.sha || sha, text };
  }

  async resolveRemoteShaFromParentDir(acc, repoPath) {
    const clean = repoPath.replace(/^\/+/, "");
    const slash = clean.lastIndexOf("/");
    const parent = slash >= 0 ? clean.slice(0, slash) : "";
    const name = slash >= 0 ? clean.slice(slash + 1) : clean;
    const url = parent
      ? `https://api.github.com/repos/${acc.username}/${acc.repo}/contents/${parent}`
      : `https://api.github.com/repos/${acc.username}/${acc.repo}/contents`;
    const res = await this.ghFetch(url);
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    const found = list.find((e) => e && (e.path === clean || e.name === name) && e.sha);
    return found?.sha ?? null;
  }

  async fetchRemoteFile(acc, repoPath) {
    const url = `https://api.github.com/repos/${acc.username}/${acc.repo}/contents/${repoPath}`;
    const res = await this.ghFetch(url, { signal: AbortSignal.timeout(60000) });
    if (res.status === 404) return null;
    if (res.status === 403) {
      const sha = await this.resolveRemoteShaFromParentDir(acc, repoPath).catch(() => null);
      if (sha) return this.fetchGitBlob(acc, sha);
    }
    if (!res.ok) throw new Error(`读取远端 ${repoPath} 失败 (HTTP ${res.status})`);
    const payload = await res.json();
    if (!payload.content && payload.sha && (payload.size ?? 0) > 0) {
      return this.fetchGitBlob(acc, payload.sha);
    }
    const text = payload.content
      ? Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8")
      : "";
    return { sha: payload.sha || "", text };
  }

  async putRemoteFile(acc, repoPath, text, message, knownSha) {
    const url = `https://api.github.com/repos/${acc.username}/${acc.repo}/contents/${repoPath}`;
    const encodedContent = Buffer.from(text, "utf8").toString("base64");
    const lookupSha = async () => {
      const dirSha = await this.resolveRemoteShaFromParentDir(acc, repoPath).catch(() => null);
      if (dirSha) return dirSha;
      const existing = await this.fetchRemoteFile(acc, repoPath).catch(() => null);
      return existing?.sha || undefined;
    };
    let sha = knownSha !== undefined ? knownSha : await lookupSha();
    for (let attempt = 0; attempt < 2; attempt++) {
      const putRes = await this.ghFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: encodedContent,
          ...(sha ? { sha } : {}),
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (putRes.ok) return;
      if (attempt === 0 && (putRes.status === 409 || putRes.status === 422)) {
        sha = await lookupSha();
        continue;
      }
      throw new Error(`推送远端 ${repoPath} 失败 (HTTP ${putRes.status})`);
    }
  }

  async syncNow() {
    const cfg = this.loadConfig();
    const acc = cfg?.account;
    if (!acc?.token || !acc?.username) {
      throw new Error("尚未配置 GitHub 同步账号，请先通过 PI Hub 面板或 pi_memory 登录。");
    }
    try {
      await this.ensureRemoteRepo(acc);
      const remoteFile = await this.fetchRemoteFile(acc, REMOTE_FILE_PATH);
      let merged;
      if (remoteFile?.text) {
        const remoteDoc = JSON.parse(remoteFile.text);
        merged = this.store.mergeRemote(remoteDoc);
      } else {
        merged = this.store.load();
      }
      const bodyText = JSON.stringify(merged, null, "\t");
      await this.putRemoteFile(
        acc,
        REMOTE_FILE_PATH,
        bodyText,
        `sync memory from antigravity (${new Date().toISOString()})`,
        remoteFile?.sha,
      );
      cfg.account.lastSyncedAt = Date.now();
      cfg.lastError = null;
      this.saveConfig(cfg);
      return {
        ...this.getStatus(),
        globalCount: (merged.global ?? []).filter((x) => !x.deletedAt && x.content).length,
        projectCount: Object.values(merged.projects ?? {}).filter((p) => !p?.deletedAt).length,
      };
    } catch (err) {
      cfg.lastError = err?.message || String(err);
      this.saveConfig(cfg);
      throw err;
    }
  }
}
