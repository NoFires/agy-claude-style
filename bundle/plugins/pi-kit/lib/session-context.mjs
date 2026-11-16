/**
 * Shared helper for recording & resolving conversation session metadata across Hooks, MCP, and Sidecar.
 */
import { join } from "node:path";
import { readJsonSafe, resolveDataDir, writeJsonAtomic } from "./atomic-io.mjs";

export function recordSessionContext(payload = {}) {
  const convId = payload.conversationId;
  if (!convId || typeof convId !== "string") return null;
  const dataDir = resolveDataDir();
  const filePath = join(dataDir, "sessions.json");
  const current = readJsonSafe(filePath, { latestConversationId: null, sessions: {} });
  const workspacePaths = Array.isArray(payload.workspacePaths) ? payload.workspacePaths : [];
  const cwd = payload.cwd || workspacePaths[0] || current.sessions?.[convId]?.cwd || "";
  const artifactDirectoryPath =
    payload.artifactDirectoryPath || current.sessions?.[convId]?.artifactDirectoryPath || "";

  const entry = {
    conversationId: convId,
    cwd,
    workspacePaths: workspacePaths.length ? workspacePaths : current.sessions?.[convId]?.workspacePaths ?? [],
    artifactDirectoryPath,
    modelName: payload.modelName || current.sessions?.[convId]?.modelName || "",
    updatedAt: Date.now(),
  };

  const entries = Object.entries({ ...(current.sessions ?? {}), [convId]: entry }).sort(
    (a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0),
  );
  const next = {
    latestConversationId: convId,
    sessions: Object.fromEntries(entries.slice(0, 120)),
  };
  writeJsonAtomic(filePath, next);
  return entry;
}

export function resolveSessionContext(conversationId = "", fallbackCwd = "", { allowProcessCwd = true } = {}) {
  const dataDir = resolveDataDir();
  const filePath = join(dataDir, "sessions.json");
  const current = readJsonSafe(filePath, { latestConversationId: null, sessions: {} });
  const targetId = conversationId || current.latestConversationId || "default";
  const hasSaved = Boolean(current.sessions && Object.hasOwn(current.sessions, targetId));
  const saved = current.sessions?.[targetId] ?? {};
  const resolvedCwd = fallbackCwd || (hasSaved ? saved.cwd || "" : allowProcessCwd ? process.cwd() : "");
  return {
    conversationId: targetId,
    cwd: resolvedCwd,
    artifactDirectoryPath: saved.artifactDirectoryPath || "",
  };
}

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}
