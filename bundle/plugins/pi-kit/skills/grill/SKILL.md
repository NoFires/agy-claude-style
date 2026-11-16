---
name: grill
description: Stress-test designs, plans, code changes, or technical understanding through relentless, structured questioning ("Grill Mode"). Use when the user says "grill", asks to be grilled on a plan/PR/concept, or wants Socratic deep-dive questioning before implementation or during technical learning.
---

# Grill Skill (灵魂拷问与深度质询)

Use **Grill Mode** whenever the user invokes `grill` (or asks to stress-test a design, code change, or technical topic).

## Mode A: Design, Plan & Code Grilling (方案与代码质询)

When grilling a feature request, architecture plan, or code change before implementation/commit:

1. **Walk the Decision Tree**: Identify unstated assumptions, edge cases, failure modes, state invariants, and API boundaries.
2. **One Focused Batch at a Time**: Ask 1–3 high-leverage questions per round instead of dumping a wall of text.
3. **Provide Recommendations**: For every design question, state your recommended option and its concrete tradeoff.
4. **Verify Against Codebase Facts**: If a question can be answered by reading existing files or running a quick check, inspect the codebase yourself instead of asking the user.
5. **Gate on Readiness**: When used as a pre-PR / pre-commit gate ("grill me on these changes"), challenge the implementation on correctness, Google Python Readability, Small CL boundaries, and test coverage before approving.

## Mode B: Technical Learning & Interview Grilling (苏格拉底式拷问教学)

When the user says `grill` to learn a domain (e.g., robotics, control, RL, systems):

1. **Map the Landscape First**: Give a crisp, opinionated overview of the ecosystem/architecture so the user has the right mental model.
2. **Ask 3 Progressive Questions per Round**:
   - Design questions that expose **counter-intuitive engineering pitfalls** and real-world constraints (not trivial textbook definitions).
   - Wait for the user's intuitive answer before revealing the full breakdown.
3. **Review & Upgrade**:
   - Pinpoint what the user got right and where the hidden trap lies.
   - Upgrade their answer into a rigorous, first-principles explanation (math/physics intuition + system implementation details).
   - Advance to the next round of deeper questions or hands-on code execution.
