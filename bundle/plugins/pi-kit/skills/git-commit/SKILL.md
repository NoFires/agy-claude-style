---
name: git-commit
description: Follows Conventional Commits standards to craft clean, atomic, descriptive git commit messages and PR summaries. Use when committing code, drafting PRs, or summarizing git diffs.
---

# Git Commit & Pull Request Crafting

Follow these rules when generating commit messages and pull request descriptions:

## Conventional Commit Structure
Format: `<type>(<optional-scope>): <short imperative description>`

Allowed Types:
- `feat`: A new feature for the user
- `fix`: A bug fix
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `docs`: Documentation only changes
- `style`: Formatting, white-space, missing semi-colons (no code change)
- `chore`: Build process, package manager, or tooling updates

## Guidelines
1. Use imperative mood in the subject line (e.g. "add support for...", not "added" or "adds").
2. Do not capitalize the first letter of the subject line, and do not end with a period.
3. Keep the first line strictly under 72 characters.
4. If there is a body, separate it with a blank line and explain **why** the change was made, not just what was changed.
5. If there are breaking changes, add `BREAKING CHANGE:` in the footer.
