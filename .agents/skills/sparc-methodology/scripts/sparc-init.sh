#!/bin/bash
# SPARC Methodology - Init Script
# Initialize SPARC workflow for a new feature

set -e

FEATURE_NAME="${1:-new-feature}"

echo "Initializing SPARC workflow for: $FEATURE_NAME"

# Create SPARC documentation directory
mkdir -p "./docs/sparc/$FEATURE_NAME"

# Create phase files
touch "./docs/sparc/$FEATURE_NAME/1-specification.md"
touch "./docs/sparc/$FEATURE_NAME/2-pseudocode.md"
touch "./docs/sparc/$FEATURE_NAME/3-architecture.md"
touch "./docs/sparc/$FEATURE_NAME/4-refinement.md"
touch "./docs/sparc/$FEATURE_NAME/5-completion.md"

echo "SPARC workflow initialized in ./docs/sparc/$FEATURE_NAME"
