#!/usr/bin/env bash
set -euo pipefail

# Sabin Codex Skill Installer
# Appends Sabin workflow instructions to AGENTS.md in the target project.
#
# Usage:
#   .codex-skill/install.sh [target-project-dir]
#
# If no target is specified, installs to the current directory.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_FILE="$SCRIPT_DIR/SKILL.md"
TARGET_DIR="${1:-.}"
AGENTS_FILE="$TARGET_DIR/AGENTS.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "Error: SKILL.md not found at $SKILL_FILE"
  exit 1
fi

# Check if sabin CLI is available
if ! command -v sabin &> /dev/null; then
  echo "Warning: sabin CLI is not installed. Install it first:"
  echo "  cd $(cd "$SCRIPT_DIR/.." && pwd)/packages/cli && npm link"
fi

# Check if already installed
if [ -f "$AGENTS_FILE" ] && grep -q "# Sabin Workflow Skill" "$AGENTS_FILE" 2>/dev/null; then
  echo "Sabin skill already present in $AGENTS_FILE"
  echo "To update, remove the existing Sabin section and re-run."
  exit 0
fi

# Extract just the content (skip the frontmatter)
CONTENT=$(awk '
  BEGIN { in_frontmatter=0; past_frontmatter=0 }
  /^---$/ && !past_frontmatter { in_frontmatter = !in_frontmatter; if (!in_frontmatter) { past_frontmatter=1 }; next }
  past_frontmatter { print }
' "$SKILL_FILE")

# Append to AGENTS.md
{
  if [ -f "$AGENTS_FILE" ] && [ -s "$AGENTS_FILE" ]; then
    echo ""
    echo "---"
    echo ""
  fi
  echo "$CONTENT"
} >> "$AGENTS_FILE"

echo "✅ Sabin skill installed to $AGENTS_FILE"
echo ""
echo "Codex will now follow the Sabin workflow when working in this project."
