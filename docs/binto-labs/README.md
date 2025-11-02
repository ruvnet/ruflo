# binto-labs/claude-flow Fork Documentation

## 🎯 Fork Mission

This is a **pure documentation fork** of [ruvnet/claude-flow](https://github.com/ruvnet/claude-flow). Our mission is to create the most comprehensive, user-friendly documentation for claude-flow to help developers learn and master this powerful AI orchestration framework.

## 📚 What Makes This Fork Different

### Documentation Focus
- **Comprehensive documentation** - Complete coverage of all features
- **User-friendly guides** - Practical examples and real-world scenarios
- **Working code examples** - Copy-paste ready TypeScript/JavaScript
- **Troubleshooting guides** - Common issues and solutions
- **Architecture Decision Records** - Understanding design choices
- **ReasoningBank setup** - Production-ready self-contained approach

### Enhanced Security
- **Improved .gitignore** - 192 lines of security-focused patterns
- **Prevents credential leaks** - API keys, secrets, tokens automatically ignored
- **Runtime data excluded** - User data never committed to git
- **Comments explain why** - Each ignore pattern documented

### Zero Code Changes
- **No functionality modifications** - Uses upstream code as-is
- **Regular upstream syncs** - Stay current with latest features
- **Pure documentation** - 94% of fork changes are documentation
- **Easy to maintain** - Minimal merge conflicts

## 📖 Documentation Structure

### `/docs/binto-labs/` Directory

**Root Files:**
- `README.md` - This file (fork overview)
- `index.md` - Navigation hub for all binto-labs documentation
- `project-reasoningbank-readme.md` - Production ReasoningBank setup guide
- `evaluation-system-summary.md` - Documentation quality framework

**Subdirectories:**

#### **Practical Guides**
- `claude-flow-practical-guide-2025.md` - Complete user guide (1,606 lines)
- `guide-architecture-design-2025-10-14.md` - Architecture overview

#### **Technical Reference** (`/docs/technical-reference/`)
- `REASONINGBANK-INTEGRATION.md` - 27+ AI models, WASM, SAFLA
- `AGENT-EXECUTION-FRAMEWORK.md` - 5 execution strategies
- `CHECKPOINT-MANAGEMENT.md` - Git-like session restore
- `DOCKER-VALIDATION.md` - 50+ automated tests
- `SDK-PROGRAMMATIC-ACCESS.md` - Complete SDK API
- `NEURAL-TRAINING.md` - Neural reasoning models
- `MEMORY-ARCHITECTURE.md` - Persistent semantic memory
- `HOOKS-SYSTEM.md` - Event-driven automation
- `ORCHESTRATION-PATTERNS.md` - Swarm coordination
- `VERIFICATION-SYSTEM.md` - Quality assurance
- `SPARC-VERIFICATION.md` - SPARC methodology
- `SESSION-MANAGEMENT.md` - Session lifecycle

#### **SDK Documentation** (`/docs/sdk/`)
- `INDEX.md` - Navigation hub
- `EXECUTIVE-SUMMARY.md` - High-level overview
- `SDK-IMPROVEMENTS-ANALYSIS.md` - Deep technical analysis (2,300 lines)
- `API-REFERENCE.md` - Complete TypeScript API (1,700 lines)
- `examples/` - 3 working TypeScript examples

#### **DevOps Documentation** (`/docs/devops/`)
- `README.md` - DevOps navigation index
- `DEVOPS_TOOLING_ANALYSIS.md` - Comprehensive 21KB analysis
- `DOCKER_VALIDATION_GUIDE.md` - Quick start for testing
- `INTEGRATION_TESTING_GUIDE.md` - Test framework reference
- `BENCHMARK_REFERENCE.md` - Performance tracking
- `QUICK_SETUP_EXAMPLES.md` - Copy-paste examples

#### **Architecture Decision Records** (`/docs/adr/`)
- `README.md` - ADR process and workflow
- `TEMPLATE.md` - ADR template
- `001-user-guide-architecture-workflow-first.md` - User guide design
- `002-upstream-integration-v2.7.0-alpha.md` - Upstream merge decisions

#### **Investigation Reports** (`/docs/investigation/`)
- `ARCHITECTURE-DEEP-DIVE.md` - System architecture analysis
- `NEW-GUIDE-RECOMMENDATIONS.md` - Documentation improvements
- `README.md` - Investigation index

## 🚀 Quick Start

### For Users Learning Claude-Flow

1. **Start Here:** Read `/docs/claude-flow-practical-guide-2025.md`
2. **Technical Deep Dive:** Browse `/docs/technical-reference/`
3. **Code Examples:** Check `/docs/sdk/examples/`
4. **Troubleshooting:** See DevOps guides in `/docs/devops/`

### For Contributors

1. **Fork Policy:** Documentation only - no code changes
2. **Contribution Areas:**
   - Improve existing documentation
   - Add new examples and guides
   - Fix typos and clarify confusing sections
   - Add troubleshooting tips
   - Create video tutorials or diagrams

3. **Style Guide:**
   - Clear, concise, user-friendly language
   - Working code examples with comments
   - Step-by-step instructions
   - Troubleshooting sections
   - Cross-references to related docs

## 📊 Fork Statistics

| Metric | Value |
|--------|-------|
| **Root Documentation** | 4 files (README, index, ReasoningBank, evaluation) |
| **Subdirectory Docs** | Technical, SDK, DevOps, ADR, Investigation, Guides, Examples |
| **Code Examples** | 3 TypeScript files (SDK examples) |
| **Security Improvements** | 192 lines (.gitignore with security patterns) |
| **Fork Focus** | 95% documentation, 5% security + tooling |

## 🔄 Upstream Sync Policy

This fork regularly syncs with [ruvnet/claude-flow](https://github.com/ruvnet/claude-flow) to stay current:

- **Code:** Accept ALL upstream changes (pure doc fork)
- **Documentation:** Merge carefully, preserve fork improvements
- **Conflicts:** Prefer upstream for code, fork for docs
- **Frequency:** Sync every major upstream release

### Recent Syncs
- **2025-11-02:** Documentation cleanup - removed obsolete files, standardized naming
- **2025-11-01:** Added production ReasoningBank setup guide (self-contained approach)
- **2025-10-31:** Quality review and accuracy validation of documentation
- **2025-10-16:** Merged v2.7.0-alpha.14 (ReasoningBank, Agent Booster, SDK improvements)

## 🤝 Contributing Back to Upstream

We aim to contribute documentation improvements back to upstream:

### Contribution Candidates
- ✅ User-friendly guides and examples
- ✅ Troubleshooting documentation
- ✅ API reference improvements
- ✅ Setup and installation guides
- ❌ Fork-specific organizational changes

### Process
1. Identify documentation that benefits all users
2. Create PR to [ruvnet/claude-flow](https://github.com/ruvnet/claude-flow)
3. Maintain fork's enhanced organization separately

## 📞 Support

### For Claude-Flow Questions
- **Upstream Issues:** https://github.com/ruvnet/claude-flow/issues
- **Official Docs:** https://github.com/ruvnet/claude-flow
- **Flow-Nexus Platform:** https://flow-nexus.ruv.io

### For Fork Documentation
- **Fork Issues:** https://github.com/binto-labs/claude-flow/issues
- **Documentation PRs:** Welcome!
- **Suggestions:** Open an issue with "docs:" prefix

## 🔒 Security

### Enhanced .gitignore
This fork has a comprehensive .gitignore (192 lines vs upstream's 52):

- ✅ API keys, secrets, credentials
- ✅ Runtime databases (.swarm/memory.db)
- ✅ User settings and sessions
- ✅ Claude Code workspace data
- ✅ Temporary files and caches

### Reporting Security Issues
- **Code Security:** Report to upstream (ruvnet/claude-flow)
- **Documentation Leaks:** Report to this fork's issues

## 📜 License

Same as upstream: [ruvnet/claude-flow license](https://github.com/ruvnet/claude-flow/blob/main/LICENSE)

## 🙏 Credits

- **Original Author:** [@ruvnet](https://github.com/ruvnet) - Claude-Flow creator
- **Fork Maintainer:** [@binto-labs](https://github.com/binto-labs) - Documentation focus
- **Contributors:** All documentation contributors welcome!

## 🎯 Core Philosophy

> "The best code is useless without great documentation."

This fork exists to make claude-flow accessible to everyone through clear, comprehensive, user-friendly documentation. We don't change the code - we explain it.

---

**Remember:** This is a pure documentation fork. For code issues, features, or bugs, please use the upstream repository.

**Upstream:** https://github.com/ruvnet/claude-flow
**Fork:** https://github.com/binto-labs/claude-flow
