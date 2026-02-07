#!/bin/bash
# SPARC Methodology - Review Script
# Run SPARC phase review checklist

set -e

FEATURE_DIR="${1:-.}"

echo "SPARC Phase Review Checklist"
echo "============================="

for phase in specification pseudocode architecture refinement completion; do
  if [ -f "$FEATURE_DIR/${phase}.md" ]; then
    echo "[x] $phase - found"
  else
    echo "[ ] $phase - missing"
  fi
done
