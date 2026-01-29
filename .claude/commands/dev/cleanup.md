---
description: Clean up debug files, test artifacts, and status reports created during development
category: workflow
allowed-tools: Task, Bash(git:*), Bash(echo:*), Bash(grep:*), Bash(ls:*), Bash(pwd:*), Bash(head:*), Bash(wc:*), Bash(test:*)
---

## Purpose

Clean up temporary files and debug artifacts that Claude Code commonly creates during development sessions. These files clutter the workspace and should not be committed to version control.

## Context

\!`git status --porcelain && git status --ignored --porcelain | grep "^!!" && echo "--- PWD: $(pwd) ---" && ls -la && if [ -z "$(git status --porcelain)" ]; then echo "WORKING_DIR_CLEAN=true" && git ls-files | grep -E "(analyze-.*\.(js|ts)|debug-.*\.(js|ts)|test-.*\.(js|ts|sh)|.*-test\.(js|ts|sh)|quick-test\.(js|ts|sh)|.*-poc\..*|poc-.*\..*|.*_poc\..*|proof-of-concept-.*\..*|verify-.*\.md|research-.*\.(js|ts)|temp-.*/|test-.*/|.*_SUMMARY\.md|.*_REPORT\.md|.*_CHECKLIST\.md|.*_COMPLETE\.md|.*_GUIDE\.md|.*_ANALYSIS\.md|.*-analysis\.md|.*-examples\.(js|ts))$" | head -20 && echo "--- Found $(git ls-files | grep -E "(analyze-.*\.(js|ts)|debug-.*\.(js|ts)|test-.*\.(js|ts|sh)|.*-test\.(js|ts|sh)|quick-test\.(js|ts|sh)|.*-poc\..*|poc-.*\..*|.*_poc\..*|proof-of-concept-.*\..*|verify-.*\.md|research-.*\.(js|ts)|temp-.*/|test-.*/|.*_SUMMARY\.md|.*_REPORT\.md|.*_CHECKLIST\.md|.*_COMPLETE\.md|.*_GUIDE\.md|.*_ANALYSIS\.md|.*-analysis\.md|.*-examples\.(js|ts))$" | wc -l) committed cleanup candidates ---"; else echo "WORKING_DIR_CLEAN=false"; fi`

Launch ONE subagent to analyze the git status (including ignored files) and propose files for deletion. If the working directory is clean, also check for committed files that match cleanup patterns.

## Target Files for Cleanup

**Debug & Analysis Files:**
- `analyze-*.js`, `analyze-*.ts` - Analysis scripts (e.g., `analyze-race-condition.js`)
- `debug-*.js`, `debug-*.ts` - Debug scripts (e.g., `debug-detailed.js`, `debug-race-condition.js`)
- `research-*.js`, `research-*.ts` - Research scripts (e.g., `research-frontmatter-libs.js`)
- `*-analysis.md` - Analysis documents (e.g., `eslint-manual-analysis.md`)

**Test Files (temporary/experimental):**
- `test-*.js`, `test-*.ts`, `test-*.sh` - Test scripts (e.g., `test-race-condition.js`, `test-basic-add.js`, `test-poc.sh`)
- `*-test.js`, `*-test.ts`, `*-test.sh` - Test scripts with suffix
- `quick-test.js`, `quick-test.ts`, `quick-test.sh` - Quick test files
- `verify-*.md` - Verification documents (e.g., `verify-migration.md`)
- `*-examples.js`, `*-examples.ts` - Example files (e.g., `frontmatter-replacement-examples.ts`)

**Proof of Concept (POC) Files:**
- `*-poc.*` - POC files in any language (e.g., `test-poc.sh`, `auth-poc.js`)
- `poc-*.*` - POC files with prefix (e.g., `poc-validation.ts`)
- `*_poc.*` - POC files with underscore (e.g., `feature_poc.js`)
- `proof-of-concept-*.*` - Verbose POC naming

**Temporary Directories:**
- `temp-*` - Temporary directories (e.g., `temp-debug/`, `temp-test/`, `temp-test-fix/`)
- `test-*` - Temporary test directories (e.g., `test-integration/`, `test-2-concurrent/`)
- NOTE: These are different from standard `test/` or `tests/` directories which should be preserved

**Reports & Summaries:**
- `*_SUMMARY.md` - Summary reports (e.g., `TEST_SUMMARY.md`, `ESLINT_FIXES_SUMMARY.md`)
- `*_REPORT.md` - Various reports (e.g., `QUALITY_VALIDATION_REPORT.md`, `RELEASE_READINESS_REPORT.md`)
- `*_CHECKLIST.md` - Checklist documents (e.g., `MIGRATION_CHECKLIST.md`)
- `*_COMPLETE.md` - Completion markers (e.g., `MIGRATION_COMPLETE.md`)
- `*_GUIDE.md` - Temporary guides (e.g., `MIGRATION_GUIDE.md`)
- `*_ANALYSIS.md` - Analysis reports (e.g., `FRONTMATTER_ANALYSIS.md`)

## Safety Rules

**Files safe to propose for deletion:**
- Must be untracked (?? in git status) OR ignored (!! in git status)
- Should match or be similar to cleanup patterns above
- Must be clearly temporary/debug files

**Never propose these files:**
- Any committed files (not marked ?? or !!) unless working directory is clean
- CHANGELOG.md, README.md, AGENTS.md, CLAUDE.md (even if untracked)
- Core project directories: src/, dist/, scripts/, node_modules/, etc.
- Standard test directories: `test/`, `tests/`, `__tests__/` (without hyphens)
- Any files you're uncertain about

## Instructions

Launch ONE subagent to:

1. **Analyze the git status output** provided in the context above
2. **Check if WORKING_DIR_CLEAN=true**: If so, also analyze committed files that match cleanup patterns
3. **Identify cleanup candidates**:
   - For dirty working directory: Focus on untracked (??) and ignored (!!) files
   - For clean working directory: Also include committed files matching cleanup patterns
4. **Create a proposal list** of files and directories to delete
5. **Present the list to the user** for approval before any deletion
6. **Do NOT delete anything** - only propose what should be deleted

The agent should provide:
- Clear list of proposed deletions with reasons
- For untracked files: Confirmation they are marked (??) or (!!)
- For committed files: Clear indication they are committed and match debug/temp patterns
- Ask user for explicit approval before proceeding

**IMPORTANT**: The agent cannot delete files directly. It must present a proposal and wait for user confirmation.

## After User Approval

Once the user approves the proposed deletions:

1. **Delete the approved files** using appropriate commands:
   - For untracked/ignored files: `rm -f` or `rm -rf` for directories
   - For committed files: `git rm` to properly remove from git tracking
2. **Analyze the target cleanup patterns** and approved files to identify common types
3. **Propose .gitignore patterns** based on the cleanup patterns to prevent future accumulation:
   ```
   # Debug and analysis files
   analyze-*.js
   analyze-*.ts
   debug-*.js
   debug-*.ts
   research-*.js
   research-*.ts
   *-analysis.md
   
   # Temporary test files
   test-*.js
   test-*.ts
   *-test.js
   *-test.ts
   quick-test.js
   quick-test.ts
   verify-*.md
   *-examples.js
   *-examples.ts
   
   # Temporary directories
   temp-*/
   test-*/
   
   # Reports and summaries
   *_SUMMARY.md
   *_REPORT.md
   *_CHECKLIST.md
   *_COMPLETE.md
   *_GUIDE.md
   *_ANALYSIS.md
   ```
4. **Add suggested patterns to .gitignore** if user agrees

This prevents the same types of files from cluttering the workspace in future development sessions.

**Note**: When removing committed files, the agent should use `git rm` to ensure proper removal from git tracking, and remind the user to commit these removals.

## Example Output

Here's what a typical cleanup analysis looks like:

```
⏺ Based on my analysis, I've identified 17 files that can be cleaned up from your project. Here's what I found:

🗑️ Untracked Files to Remove (8 files)

Research/Debug files:
rm -f research-frontmatter-libs.js
rm -f eslint-manual-analysis.md
rm -f frontmatter-replacement-examples.ts
rm -f test-content-preservation.ts
rm -f test-migration.ts
rm -f verify-migration.md

Dated reports:
rm -f reports/RELEASE_READINESS_REPORT_2025-07-18.md
rm -f reports/TEST_FAILURE_ANALYSIS_2025-07-18.md

📁 Committed Files to Move or Remove (9 files)

These report files are in the root but should be in reports/:

# Move to reports/ (recommended):
git mv FRONTMATTER_ANALYSIS.md reports/
git mv MIGRATION_CHECKLIST.md reports/
git mv MIGRATION_COMPLETE.md reports/
git mv MIGRATION_GUIDE.md reports/
git mv PERFORMANCE_TEST_FIX_SUMMARY.md reports/
git mv QUALITY_VALIDATION_REPORT.md reports/
git mv RELEASE_READINESS_REPORT.md reports/
git mv TEST_FIXES_SUMMARY.md reports/
git mv VALIDATION_REPORT.md reports/

📝 Update .gitignore

Add these patterns to prevent future accumulation:

# Research and debug files
research-*.js
research-*.ts
*-manual-analysis.md
*-examples.ts
test-*.ts
!test/              # Exclude the test directory itself
verify-*.md

# Reports in root directory (should be in reports/)
/*_ANALYSIS.md
/*_CHECKLIST.md
/*_COMPLETE.md
/*_GUIDE.md
/*_SUMMARY.md
/*_REPORT.md
# Preserve important documentation
!CHANGELOG.md
!README.md
!AGENTS.md

# Dated reports
reports/*_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md

Would you like me to proceed with the cleanup?
```

The command analyzes your project and categorizes cleanup items:
- **Untracked files**: Temporary debug/test files that can be deleted
- **Committed files**: Often reports that should be moved to the reports/ directory
- **.gitignore updates**: Patterns to prevent future accumulation

The agent will always ask for confirmation before making any changes.