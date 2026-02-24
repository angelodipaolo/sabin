#!/usr/bin/env bash
set -euo pipefail

# Sabin Codex Skill Uninstaller
# Removes the Sabin workflow section from AGENTS.md.
#
# Usage:
#   .codex-skill/uninstall.sh [target-project-dir]

TARGET_DIR="${1:-.}"
AGENTS_FILE="$TARGET_DIR/AGENTS.md"

if [ ! -f "$AGENTS_FILE" ]; then
  echo "No AGENTS.md found at $AGENTS_FILE"
  exit 0
fi

if ! grep -q "# Sabin Workflow Skill" "$AGENTS_FILE" 2>/dev/null; then
  echo "Sabin skill not found in $AGENTS_FILE"
  exit 0
fi

# Remove from the "---" line before the Sabin section to end of file
# (assumes Sabin is the last section appended)
MARKER_LINE=$(grep -n "# Sabin Workflow Skill" "$AGENTS_FILE" | head -1 | cut -d: -f1)

if [ -n "$MARKER_LINE" ]; then
  # Check for a separator line (---) 2 lines before the marker
  SEPARATOR_LINE=$((MARKER_LINE - 2))
  if [ "$SEPARATOR_LINE" -ge 1 ] && sed -n "${SEPARATOR_LINE}p" "$AGENTS_FILE" | grep -q "^---$"; then
    START_LINE=$((SEPARATOR_LINE - 1))
  else
    START_LINE=$((MARKER_LINE - 1))
  fi

  if [ "$START_LINE" -le 0 ]; then
    # Sabin section is the entire file
    rm "$AGENTS_FILE"
    echo "✅ Removed $AGENTS_FILE (was entirely the Sabin skill)"
  else
    head -n "$START_LINE" "$AGENTS_FILE" > "$AGENTS_FILE.tmp"
    mv "$AGENTS_FILE.tmp" "$AGENTS_FILE"
    echo "✅ Sabin skill removed from $AGENTS_FILE"
  fi
else
  echo "Could not find Sabin section marker"
  exit 1
fi
