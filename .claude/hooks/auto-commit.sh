#!/usr/bin/env bash
# PostToolUse hook — auto-commit après chaque Edit/Write/MultiEdit.
# Empêche la perte de travail non commité.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

# Check if there are staged or unstaged changes to tracked files
if git diff --quiet HEAD 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
  exit 0
fi

# Get list of changed files for the commit message
changed=$(git diff --name-only HEAD 2>/dev/null | head -5 | tr '\n' ', ' | sed 's/,$//')
if [ -z "$changed" ]; then
  changed=$(git diff --cached --name-only 2>/dev/null | head -5 | tr '\n' ', ' | sed 's/,$//')
fi

if [ -z "$changed" ]; then
  exit 0
fi

# Stage all tracked changes and commit
git add -u
git commit -m "wip: auto-commit ${changed}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" --no-verify 2>/dev/null || true

exit 0
