# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0-alpha.154] - 2026-01-22

### Fixed
- Memory delete command now properly supports `--key` and `--namespace` options (#980)
- Added missing 'type' column to memory schema migration (#977)
- Updated pnpm-lock.yaml for @claude-flow/browser dependencies

## [3.0.0-alpha.153] - 2026-01-22

### Fixed
- Added missing 'type' column to ensureSchemaColumns() for older databases

## [3.0.0-alpha.152] - 2026-01-22

### Added
- V3 CLI with 26 commands and 140+ subcommands
- Domain-Driven Design architecture with 15 @claude-flow modules
- HNSW-indexed vector search
- RuVector Intelligence System (Pattern Learning, MoE, Flash Attention)
- 60+ agent types for swarm coordination
- Queen-led Byzantine fault-tolerant voting
- 17 hooks + 12 background workers

### Changed
- Restructured as monorepo with pnpm workspaces
- Moved CLI to @claude-flow/cli package

For earlier versions, see the git history.
