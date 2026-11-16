# PI Kit (`pi-kit`) — `SeredenFei/pi-desktop` Core Strengths for Antigravity

`pi-kit` packages the signature capabilities of [`SeredenFei/pi-desktop`](https://github.com/SeredenFei/pi-desktop) into a cohesive, low-token-overhead Antigravity global plugin:

1. **Thinking & Tool-Calling Discipline (`rules/AGENTS.md`)**:
   - Parallel read-only fan-out, scoped line-range reads, evidence offloading (`>20KB` outputs archived to `<artifactDir>/scratch/evidence/`), Small CLs, Google Python Readability, and Conventional Commits.
2. **Adaptive `PlanBoard` + Clean New-Window Handoff (`/pi-plan`, `pi_plan`)**:
   - Hard `PreToolUse` read-only gate during planning (`planMode=true`), quote-aware shell allowlist, 3-way execution choice (**Current Window** · **✨ Clean New Window via `agentapi new-conversation`** · **Clean Subagent**), and live `[ ] → [/] → [x]` step check-offs.
3. **Hierarchical Global/Project Memory + GitHub `pi-memory-sync` (`/pi-memory`, `pi_memory`)**:
   - Global memories + normalized Git Remote project buckets (`git:<host>/<owner>/<repo>`), per-conversation `🔒 独立记忆` incognito mode, `SessionStart` cache-friendly injection, and lossless tombstone cloud sync preserving `pi-desktop` `transcriptIndex`.
4. **Goal Mode 2.0 (`/pi-goal`, `pi_goal`, `pi-goal-reviewer`)**:
   - Interactive Goal Wizard + independent read-only `pi-goal-reviewer` subagent + deterministic `Stop`-hook Git Diff SHA-256 fingerprint stagnation circuit breaker.
5. **PI Hub Warm Minimal Side Panel (`sidecars/pi_hub`)**:
   - `#FAF9F5` / `#262624` + `#D97757` Auxiliary Pane Web UI for managing PlanBoard, Memories, GitHub Device Flow sync, and Goal 2.0 live.
6. **10 Personal `~/.pi/agent/skills` Symlinked**:
   - `grill`, `git-commit`, `colab-operator`, `anthropic-frontend-design`, `anthropic-doc-coauthoring`, and the `k-dense-*` scientific suite.
