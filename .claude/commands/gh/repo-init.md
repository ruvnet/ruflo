---
allowed-tools: Bash, Write, TodoWrite
description: Create a new GitHub repository with proper setup including directory creation, git initialization, and remote configuration
category: workflow
argument-hint: "<repository-name>"
---

# GitHub Repository Setup

Create a new GitHub repository named "$ARGUMENTS" with proper directory structure and git setup.

**Note:** The repository will be created as **private** by default for security. If you need a public repository, please specify "public" in your request.

## Steps to execute:

1. Create a new directory named "$ARGUMENTS"
2. Initialize a git repository in that directory
3. Create the GitHub repository using gh CLI
4. Create a basic README.md file
5. Make an initial commit
6. Set up the remote origin
7. Push to GitHub

## Commands:

```bash
# Create the directory
mkdir "$ARGUMENTS"
cd "$ARGUMENTS"

# Initialize git repository
git init

# Create GitHub repository using gh CLI (private by default)
gh repo create "$ARGUMENTS" --private

# Create README.md
echo "# $ARGUMENTS" > README.md
echo "" >> README.md
echo "A new repository created with GitHub CLI." >> README.md

# Initial commit
git add README.md
git commit -m "Initial commit"

# Add remote origin (using SSH)
git remote add origin "git@github.com:$(gh api user --jq .login)/$ARGUMENTS.git"

# Push to GitHub
git branch -M main
git push -u origin main
```

Execute these commands to create the repository.