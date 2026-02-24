#!/usr/bin/env bash
set -euo pipefail

# Sabin Codex Skill Installer
# Appends Sabin workflow instructions to AGENTS.md in the target project.
#
# Usage:
#   .codex-skill/install.sh [--force] [target-project-dir]
#
# If no target is specified, installs to the current directory.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_FILE="$SCRIPT_DIR/SKILL.md"
START_MARKER="<!-- SABIN_SKILL_START -->"
END_MARKER="<!-- SABIN_SKILL_END -->"

FORCE=0
TARGET_DIR="."

while [ $# -gt 0 ]; do
  case "$1" in
    --force)
      FORCE=1
      ;;
    -h|--help)
      echo "Usage: $0 [--force] [target-project-dir]"
      exit 0
      ;;
    -*)
      echo "Error: unknown option '$1'"
      echo "Usage: $0 [--force] [target-project-dir]"
      exit 1
      ;;
    *)
      if [ "$TARGET_DIR" != "." ]; then
        echo "Error: multiple target directories provided"
        echo "Usage: $0 [--force] [target-project-dir]"
        exit 1
      fi
      TARGET_DIR="$1"
      ;;
  esac
  shift
done

AGENTS_FILE="$TARGET_DIR/AGENTS.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "Error: SKILL.md not found at $SKILL_FILE"
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: target directory not found: $TARGET_DIR"
  exit 1
fi

# Check if sabin CLI is available
if ! command -v sabin &> /dev/null; then
  if [ "$FORCE" -eq 0 ]; then
    echo "Error: sabin CLI is not installed or not on PATH."
    echo "Install it first:"
    echo "  cd $(cd "$SCRIPT_DIR/.." && pwd)/packages/cli && npm link"
    echo "Or bypass this check with --force."
    exit 1
  fi

  echo "Warning: sabin CLI is not installed. Continuing due to --force."
fi

# Extract just the content (skip the frontmatter)
CONTENT=$(awk '
  BEGIN { in_frontmatter=0; past_frontmatter=0 }
  /^---$/ && !past_frontmatter { in_frontmatter = !in_frontmatter; if (!in_frontmatter) { past_frontmatter=1 }; next }
  past_frontmatter { print }
' "$SKILL_FILE")

HAD_EXISTING=0
if [ -f "$AGENTS_FILE" ] && grep -Fq "$START_MARKER" "$AGENTS_FILE" 2>/dev/null; then
  HAD_EXISTING=1
fi

TMP_FILE="$(mktemp)"
if [ -f "$AGENTS_FILE" ]; then
  awk -v start="$START_MARKER" -v end="$END_MARKER" '
    $0 == start { in_block=1; next }
    in_block && $0 == end { in_block=0; next }
    !in_block { print }
  ' "$AGENTS_FILE" > "$TMP_FILE"
else
  : > "$TMP_FILE"
fi

{
  if [ -s "$TMP_FILE" ]; then
    cat "$TMP_FILE"
    echo ""
    echo "---"
    echo ""
  fi
  echo "$START_MARKER"
  echo "$CONTENT"
  echo "$END_MARKER"
} > "$AGENTS_FILE"

rm -f "$TMP_FILE"

if [ "$HAD_EXISTING" -eq 1 ]; then
  echo "✅ Sabin skill upgraded in $AGENTS_FILE"
else
  echo "✅ Sabin skill installed to $AGENTS_FILE"
fi
