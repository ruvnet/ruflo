# V3 Cleanup Quick Start Guide

**TL;DR:** Run cleanup script to remove 25 MB of build artifacts and backup files from git tracking.

---

## Quick Commands

### Preview Changes (Safe)
```bash
cd /workspaces/claude-flow
bash scripts/cleanup-v3.sh --dry-run
```

### Execute Cleanup
```bash
cd /workspaces/claude-flow
bash scripts/cleanup-v3.sh
```

### Commit Changes
```bash
git add .gitignore
git commit -m "chore(v3): repository cleanup - remove build artifacts"
git push origin v3
```

---

## What Gets Cleaned

| Item | Size | Impact |
|------|------|--------|
| `v2/dist-cjs/` (1,098 files) | 24 MB | Removes from git tracking |
| Backup files (10 files) | ~1 MB | Deletes permanently |
| .gitignore duplicates | N/A | Improves maintainability |

**Total Savings:** ~25 MB

---

## Safety Features

✅ Dry-run mode available
✅ Only removes from git tracking (preserves local files)
✅ Only deletes obvious backup files
✅ Easy rollback with `git reset`

---

## Full Documentation

See [CLEANUP-REPORT.md](./CLEANUP-REPORT.md) for:
- Detailed analysis
- File-by-file breakdown
- Expected savings calculations
- Safety measures
- Rollback procedures

---

**Part of:** Master Plan Section 5 - Repository Cleanup
**Status:** Ready for execution
