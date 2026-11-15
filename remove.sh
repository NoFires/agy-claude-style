#!/usr/bin/env bash
# Stop the AGY Claude Style (agy-claude-style) watcher and restore Antigravity UI.
cd "$(dirname "$0")"
echo "Removing AGY Claude Style (agy-claude-style)..."
node remove.js
