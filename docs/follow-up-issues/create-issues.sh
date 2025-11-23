#!/bin/bash

# Script to create GitHub issues using gh CLI
# This script requires the gh CLI to be installed and authenticated

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub"
    echo "Run: gh auth login"
    exit 1
fi

echo "Creating GitHub issues from templates..."
echo ""

# Function to create issue from markdown file
create_issue() {
    local file=$1
    local title=$(grep -m 1 "^# " "$file" | sed 's/^# //')
    local labels=$(grep "## Labels" -A 1 "$file" | tail -n 1 | sed 's/`//g' | tr ',' '\n' | xargs)

    echo "Creating issue: $title"

    # Create issue with the file content as body
    gh issue create \
        --title "$title" \
        --body-file "$file" \
        --label "$labels"

    echo "✓ Created: $title"
    echo ""
}

# Create issues from each template
create_issue "$SCRIPT_DIR/01-truth-score-implementation.md"
create_issue "$SCRIPT_DIR/02-typescript-upgrade.md"
create_issue "$SCRIPT_DIR/03-linting-cleanup.md"
create_issue "$SCRIPT_DIR/04-ci-hardening.md"

echo "All issues created successfully!"
