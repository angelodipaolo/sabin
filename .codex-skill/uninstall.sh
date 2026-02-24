#!/usr/bin/env bash
set -euo pipefail

# Sabin Codex Skill Uninstaller
# Removes the Sabin workflow section from AGENTS.md.
#
# Usage:
#   .codex-skill/uninstall.sh [target-project-dir]

TARGET_DIR="${1:-.}"
AGENTS_FILE="$TARGET_DIR/AGENTS.md"
START_MARKER="<!-- SABIN_SKILL_START -->"
END_MARKER="<!-- SABIN_SKILL_END -->"

if [ ! -f "$AGENTS_FILE" ]; then
  echo "No AGENTS.md found at $AGENTS_FILE"
  exit 0
fi

if ! grep -Fq "$START_MARKER" "$AGENTS_FILE" 2>/dev/null; then
  echo "Sabin skill not found in $AGENTS_FILE"
  exit 0
fi

START_LINE=$(grep -nF "$START_MARKER" "$AGENTS_FILE" | head -1 | cut -d: -f1)
END_LINE=$(grep -nF "$END_MARKER" "$AGENTS_FILE" | awk -F: -v start="$START_LINE" '$1 > start { print $1; exit }')

if [ -z "$START_LINE" ] || [ -z "$END_LINE" ]; then
  echo "Error: found '$START_MARKER' without matching '$END_MARKER'"
  exit 1
fi

# If installed by install.sh, remove the separator block before markers too:
# optional blank line + '---' + blank line + marker block.
REMOVE_FROM="$START_LINE"
if [ "$START_LINE" -ge 2 ]; then
  PREV_LINE=$(sed -n "$((START_LINE - 1))p" "$AGENTS_FILE")
  if [ "$PREV_LINE" = "" ] && [ "$START_LINE" -ge 3 ]; then
    SEP_LINE=$(sed -n "$((START_LINE - 2))p" "$AGENTS_FILE")
    if [ "$SEP_LINE" = "---" ]; then
      REMOVE_FROM=$((START_LINE - 2))
      if [ "$START_LINE" -ge 4 ]; then
        BEFORE_SEP=$(sed -n "$((START_LINE - 3))p" "$AGENTS_FILE")
        if [ "$BEFORE_SEP" = "" ]; then
          REMOVE_FROM=$((START_LINE - 3))
        fi
      fi
    fi
  fi
fi

TMP_FILE="$(mktemp)"
awk -v start="$REMOVE_FROM" -v end="$END_LINE" '
  NR < start || NR > end { print }
' "$AGENTS_FILE" > "$TMP_FILE"

if [ ! -s "$TMP_FILE" ]; then
  rm -f "$AGENTS_FILE"
  echo "✅ Removed $AGENTS_FILE (was entirely the Sabin skill)"
else
  mv "$TMP_FILE" "$AGENTS_FILE"
  echo "✅ Sabin skill removed from $AGENTS_FILE"
fi

rm -f "$TMP_FILE"
