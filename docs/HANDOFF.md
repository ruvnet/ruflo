# Claude Desktop ↔ Claude Code Handoff Document

**Created**: 2025-11-28
**Session**: Claude Code (funny-wilbur worktree)
**Purpose**: Research handoff to Claude Desktop, return handoff back

---

## 🎯 CLAUDE DESKTOP: Your Mission

You are receiving a handoff from Claude Code working on a fork of `claude-flow`. The local repository needs GitHub research that requires browser/API access.

### Repository Location
```
C:\Users\jamal\.claude-worktrees\claude-flow\gallant-lamport
```

### Key Files to Reference
```
docs/PROJECT_STATUS.md      - Executive overview of fork vs upstream
docs/OPERATIONAL_STATUS.md  - What works, what doesn't, test results
docs/HANDOFF.md            - This file (handoff protocol)
```

---

## 📋 Research Tasks

### 1. Upstream Issue Tracker
**URL**: https://github.com/ruvnet/claude-flow/issues

Research needed:
- [ ] List open issues (especially bugs)
- [ ] Any issues related to: MCP, memory, verification, Windows
- [ ] Recent closed issues that might affect fork
- [ ] Any breaking changes planned

### 2. Upstream Pull Requests
**URL**: https://github.com/ruvnet/claude-flow/pulls

Research needed:
- [ ] Open PRs that might need merging later
- [ ] Recent merged PRs since v2.7.35
- [ ] Any architectural discussions

### 3. MCP 2025-11 Specification
Research needed:
- [ ] What is the full spec?
- [ ] How does progressive disclosure work?
- [ ] Token reduction implementation details

### 4. AgentDB v1.6.1
Research needed:
- [ ] API changes from previous versions
- [ ] HNSW indexing documentation
- [ ] ReasoningBank integration details

### 5. CI/CD Workflow Status
**URL**: https://github.com/jamaleb67/claude-flow-jamaleb67_fork/actions

Research needed:
- [ ] Are workflows passing?
- [ ] Any failures to investigate?
- [ ] Multi-platform build status

---

## 📝 Return Handoff Template

When you complete research, create a file or provide this structure:

```markdown
# Claude Desktop Research Results

## Date: [DATE]

## 1. Upstream Issues Summary
### Critical/Blocking
- [Issue #XXX]: [Title] - [Brief description]

### Relevant to Fork
- [Issue #XXX]: [Title] - [How it affects us]

### Can Ignore
- [List of non-relevant issues]

## 2. Pull Requests
### Should Merge Later
- [PR #XXX]: [Title] - [Why relevant]

### Already Incorporated (v2.7.35)
- [List]

## 3. MCP 2025-11 Findings
[Key details about the spec]

## 4. AgentDB Notes
[Any important API or usage changes]

## 5. CI/CD Status
- Linux: [PASS/FAIL]
- macOS: [PASS/FAIL]
- Windows: [PASS/FAIL]
- Issues found: [List]

## 6. Recommended Actions for Claude Code
1. [Specific action]
2. [Specific action]
3. [Specific action]
```

---

## 🔄 Return Instructions for User

When returning to Claude Code, say one of:

### Option A: Full Research Complete
```
"I have research results from Claude Desktop. Check docs/DESKTOP_RESEARCH.md
(or paste the content). Process the findings and update the knowledge base."
```

### Option B: Partial Research
```
"Claude Desktop found [X issues / Y PRs / specific finding].
Here's what's relevant: [paste or describe]. Update status accordingly."
```

### Option C: Specific Action Needed
```
"Research shows we need to [specific action]. Execute this fix:
[describe what needs to be done]"
```

---

## 📍 Current Fork State (For Context)

### Version
- **Fork**: 2.7.35-fork.1
- **Upstream merged**: v2.7.35 (75 commits)

### What Works
- ✅ Build (604 files)
- ✅ CLI commands
- ✅ Memory system

### What Needs Work
- ⚠️ Verification commands not in CLI
- ⚠️ Version shows v1.0.45 (bug)
- ⚠️ MCP server untested
- ❌ Jest on Windows

### Fork-Specific Features
- Truth Score system (~20,000 lines in `src/verification/`)
- Deception detector
- Enhanced verification pipeline

---

## 🗂️ File Map for Research Cross-Reference

| Topic | Local File | Research URL |
|-------|------------|--------------|
| Project overview | `docs/PROJECT_STATUS.md` | - |
| Operational status | `docs/OPERATIONAL_STATUS.md` | - |
| Upstream issues | - | github.com/ruvnet/claude-flow/issues |
| Fork CI/CD | - | github.com/jamaleb67/claude-flow-jamaleb67_fork/actions |
| Truth Score | `src/verification/truth-scorer.ts` | - |
| Deception detector | `src/verification/deception-detector.ts` | - |
| MCP server | `src/mcp/mcp-server.js` | - |
| Package config | `package.json` | - |
| Changelog | `CHANGELOG.md` | - |

---

## ⚡ Quick Commands for Claude Code (Post-Research)

```bash
# After research, these might be needed:

# Fix verification CLI registration
# [Claude Code will know how based on research]

# Fix version display
grep -r "1.0.45" src/

# Test MCP server
node dist/src/cli/main.js mcp start

# Run specific fix
# [Based on research findings]
```

---

## 🔐 Authentication Notes

If Claude Desktop needs to use `gh` CLI:
```bash
gh auth login
# Follow prompts for GitHub authentication
```

---

*This handoff document enables seamless agent-to-agent collaboration.*
*Update the "Return Handoff Template" section with findings and return to Claude Code.*
