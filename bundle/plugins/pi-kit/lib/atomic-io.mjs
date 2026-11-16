/**
 * Atomic JSON I/O and shared persistent directory helpers for pi-kit.
 * Shared across lifecycle hooks, MCP server, and PI Hub sidecar to avoid split-brain paths.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Resolves the single source-of-truth persistent data directory for pi-kit.
 * Respects PI_KIT_DATA_DIR override for hermetic unit testing (mkdtemp).
 */
export function resolveDataDir() {
  const custom = process.env.PI_KIT_DATA_DIR?.trim();
  const dir = custom
    ? resolve(custom)
    : join(homedir(), ".gemini", "config", "plugin-data", "pi-kit");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Reads and parses a JSON file safely, returning `fallback` on missing or malformed content.
 */
export function readJsonSafe(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Writes JSON atomically via a PID+random sibling temp file and POSIX rename.
 */
export function writeJsonAtomic(filePath, value, { mode = 0o600 } = {}) {
  const dir = dirname(resolve(filePath));
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(tmpPath, serialized, { encoding: "utf8", mode });
    try {
      chmodSync(tmpPath, mode);
    } catch {
      // Ignore chmod issues on filesystems without POSIX permissions.
    }
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
    throw err;
  }
}
