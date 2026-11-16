---
name: pi-goal
description: Goal Mode 2.0 with interactive Goal Wizard convergence, independent read-only reviewer subagent (pi-goal-reviewer), and Stop-hook Git Diff stagnation circuit breaker. Use when invoked via /pi-goal or when the user wants autonomous multi-round execution with independent verification instead of blind self-certification.
---

# PI Goal Mode 2.0 (`/pi-goal`)

Ported from `pi-desktop`'s **Goal Mode 2.0** (`Executor + Independent Read-Only Reviewer + Server/Hook Git Diff Stagnation Circuit Breaker`).

## Phase 1: Interactive Goal Convergence Wizard

If the user's goal still has ambiguous scope, deliverables, or acceptance criteria:
1. Inspect the workspace quickly (read-only) so you don't ask questions the codebase already answers.
2. Ask 1–3 high-leverage clarifying questions via `ask_question` (each with a `(Recommended)` default).
3. Synthesize a crisp, testable `objective`, concrete `acceptanceCriteria` list, and `maxRounds` (default `6`).

## Phase 2: Arm Goal 2.0 State Machine

1. Call `pi_goal` with:
   - `action: "set"`
   - `objective`: Clear end-state statement
   - `acceptanceCriteria`: List of verifiable checks (commands, unit tests, UI/API invariants)
   - `maxRounds`: Default `6`
2. Include `[🎯 打开 PI Hub 查看目标看板](sidecar://pi-kit/pi_hub/)` so the user can monitor rounds and diff fingerprints live.

## Phase 3: Execution → Independent Review Loop

1. Execute the implementation and run local verification commands (format, typecheck/lint, unit tests).
2. **Never self-certify completion.** Before finishing a round, spawn the dedicated read-only reviewer:
   ```
   invoke_subagent(
     TypeName: "pi-goal-reviewer",
     Role: "Goal 2.0 Independent Reviewer",
     Prompt: "Goal: <objective>\nAcceptance Criteria:\n<criteria>\nWorkspace: <cwd>\nRound: <r>/<maxRounds>\nClaimed Changes & Test Output:\n<summary>\n\nVerify actual git diff, files, and tests in read-only mode, then return strict JSON: {\"verdict\":\"pass\"|\"revise\"|\"blocked\",\"feedback\":\"...\"}"
   )
   ```
3. When `pi-goal-reviewer` replies, register its exact verdict via:
   `pi_goal(action="record_verdict", verdict="pass"|"revise"|"blocked", feedback="...")`
   - If `pass`: Goal 2.0 transitions to `completed` and the `Stop` hook allows clean completion.
   - If `revise`: Address the reviewer's concrete feedback in the next round.
   - Note: The `Stop` hook independently tracks `git diff` SHA-256 fingerprints and error signatures — **2 consecutive rounds with zero diff progress or identical errors automatically trip the `blocked` circuit breaker** to protect quota.
