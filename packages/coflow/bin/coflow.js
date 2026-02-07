#!/usr/bin/env node
/**
 * coflow - Shorthand CLI for Claude Flow
 *
 * Delegates all commands to @claude-flow/cli.
 * Usage: npx coflow <command> [options]
 *
 * Auto-detects MCP mode when stdin is piped and no args provided.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Find @claude-flow/cli's entry point
const require = createRequire(import.meta.url);
const cliPath = require.resolve('@claude-flow/cli/bin/cli.js');

// Import and run the CLI
await import(cliPath);
