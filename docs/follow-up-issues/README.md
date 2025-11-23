# Follow-Up Issues

This directory contains detailed issue templates for post-merge follow-up work.

## Issues Overview

### 1. Truth Score Implementation (High Priority)
**File**: `01-truth-score-implementation.md`
**Impact**: Fixes 3 failing test suites
**Effort**: Medium
**Dependencies**: None

### 2. TypeScript Upgrade (Critical Priority)
**File**: `02-typescript-upgrade.md`
**Impact**: Resolves compiler crash
**Effort**: Medium
**Dependencies**: None

### 3. Linting Cleanup (Medium Priority)
**File**: `03-linting-cleanup.md`
**Impact**: Reduces 8,175 ESLint issues
**Effort**: High (phased approach)
**Dependencies**: TypeScript upgrade recommended first

### 4. CI/CD Hardening (High Priority)
**File**: `04-ci-hardening.md`
**Impact**: Adds retry logic, improves pipeline reliability
**Effort**: Medium
**Dependencies**: None

## Creating Issues

### Option 1: Manual Creation
1. Open each markdown file
2. Copy the content
3. Create a new GitHub issue
4. Paste the content and adjust formatting
5. Add appropriate labels

### Option 2: Using the Creation Script
```bash
# If GitHub CLI becomes available
node docs/follow-up-issues/create-issues.js
```

### Option 3: GitHub API
Use the provided Node.js script to create issues programmatically:
```bash
GITHUB_TOKEN=your_token node docs/follow-up-issues/create-issues-api.js
```

## Recommended Order

1. **TypeScript Upgrade** (Critical) - Fixes compiler crashes affecting all development
2. **CI/CD Hardening** (High) - Improves pipeline reliability for all future work
3. **Truth Score Implementation** (High) - Resolves test failures
4. **Linting Cleanup** (Medium) - Can be done in parallel with other work

## Issue Labels

Ensure these labels exist in your repository:
- `enhancement`
- `testing`
- `high-priority`
- `critical`
- `dependencies`
- `typescript`
- `code-quality`
- `refactoring`
- `medium-priority`
- `technical-debt`
- `ci-cd`
- `infrastructure`
- `reliability`
- `follow-up`
- `bug`

## Tracking Progress

Create a GitHub Project or Milestone to track these follow-up issues collectively.
