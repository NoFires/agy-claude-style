---
name: pi-memory
description: Manage hierarchical Global & Project memories, per-conversation incognito isolation, and GitHub pi-memory-sync lossless cloud synchronization. Use when invoked via /pi-memory or when the user asks to view, add, forget, isolate, or sync memories across devices and pi-desktop.
---

# PI Memory & GitHub Cloud Sync (`/pi-memory`)

Ported from `pi-desktop`'s **Global/Project Memory + Tombstone Cloud Sync (`pi-memory-sync`)**.

## Capabilities & Actions (via `pi_memory` MCP tool)

1. **Inspect Memories & Sync Status**:
   - Call `pi_memory(action="list")` and `pi_memory(action="sync_status")`.
   - Surface `[🧠 打开 PI Hub 记忆面板](sidecar://pi-kit/pi_hub/)` so the user can visually browse, toggle, edit, or sync memories in the warm minimal side panel.
2. **Remember / Forget**:
   - Global preferences (cross-project tech stack, coding style, workflow habits): `pi_memory(action="remember", scope="global", content="...")`.
   - Project-specific conventions & architecture notes (automatically keyed by normalized Git remote URL `git:<host>/<owner>/<repo>`, matching `pi-desktop` across machines): `pi_memory(action="remember", scope="project", content="...")`.
   - Project custom instructions: `pi_memory(action="set_instructions", content="...")`.
   - Soft-delete with tombstone (prevents resurrection during multi-device sync): `pi_memory(action="forget", id="..." | query="...")`.
3. **Per-Conversation Incognito (`🔒 独立记忆`)**:
   - Call `pi_memory(action="set_incognito", incognito=true|false)` to isolate or reconnect the current conversation.
4. **GitHub Cloud Sync (`pi-memory-sync`)**:
   - If already logged in (`loggedIn: true`), run `pi_memory(action="sync")` to perform a bidirectional lossless merge (`id + updatedAt + deletedAt` tombstone merge while preserving `pi-desktop`'s `transcriptIndex` untouched).
   - If not logged in, call `pi_memory(action="device_login")` to generate an 8-digit GitHub OAuth Device Code (`https://github.com/login/device`), show the code to the user, and once authorized call `pi_memory(action="poll_device_login")`.
