/**
 * @claude-flow/codex - Validators
 *
 * Comprehensive validation functions for AGENTS.md, SKILL.md, and config.toml
 * Provides detailed error messages and suggestions for fixes.
 */

import type { ValidationResult, ValidationError, ValidationWarning } from '../types.js';

/**
 * TOML parsing result
 */
interface TomlParseResult {
  valid: boolean;
  errors: Array<{ line: number; message: string }>;
  data: Record<string, unknown>;
}

/**
 * YAML frontmatter parsing result
 */
interface YamlFrontmatterResult {
  valid: boolean;
  errors: Array<{ line: number; message: string }>;
  data: Record<string, unknown>;
  endLine: number;
}

/**
 * Secret patterns to detect
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{32,}/, name: 'OpenAI API key' },
  { pattern: /sk-ant-[a-zA-Z0-9-]{32,}/, name: 'Anthropic API key' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub personal access token' },
  { pattern: /gho_[a-zA-Z0-9]{36}/, name: 'GitHub OAuth token' },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/, name: 'GitHub fine-grained token' },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/, name: 'Slack token' },
  { pattern: /AKIA[A-Z0-9]{16}/, name: 'AWS access key' },
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_-]{20,}["']?/i, name: 'Generic API key' },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/i, name: 'Hardcoded password' },
  { pattern: /(?:secret|token)\s*[:=]\s*["'][a-zA-Z0-9_/-]{16,}["']/i, name: 'Hardcoded secret/token' },
  { pattern: /Bearer\s+[a-zA-Z0-9_.-]{20,}/, name: 'Bearer token' },
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, name: 'Private key' },
];

/**
 * Required sections for AGENTS.md
 */
const AGENTS_MD_REQUIRED_SECTIONS = ['Setup', 'Code Standards', 'Security'];

/**
 * Recommended sections for AGENTS.md
 */
const AGENTS_MD_RECOMMENDED_SECTIONS = [
  'Project Overview',
  'Skills',
  'Agent Types',
  'Memory System',
  'Links',
];

/**
 * Valid approval policies
 */
const VALID_APPROVAL_POLICIES = ['untrusted', 'on-failure', 'on-request', 'never'];

/**
 * Valid sandbox modes
 */
const VALID_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

/**
 * Valid web search modes
 */
const VALID_WEB_SEARCH_MODES = ['disabled', 'cached', 'live'];

/**
 * Required config.toml fields
 */
const CONFIG_TOML_REQUIRED_FIELDS = ['model', 'approval_policy', 'sandbox_mode'];

/**
 * Validate an AGENTS.md file
 */
export async function validateAgentsMd(content: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const lines = content.split('\n');

  // Check for title (H1 heading)
  if (!content.startsWith('# ')) {
    const firstHeadingMatch = content.match(/^(#{1,6})\s+/m);
    if (firstHeadingMatch && firstHeadingMatch[1]) {
      if (firstHeadingMatch[1].length > 1) {
        errors.push({
          path: 'AGENTS.md',
          message: 'AGENTS.md should start with a level-1 heading (# Title)',
          line: 1,
        });
      }
    } else {
      errors.push({
        path: 'AGENTS.md',
        message: 'AGENTS.md must start with a title heading',
        line: 1,
      });
    }
  }

  // Check for empty content
  if (content.trim().length < 50) {
    errors.push({
      path: 'AGENTS.md',
      message: 'AGENTS.md content is too short - add meaningful instructions',
      line: 1,
    });
  }

  // Extract sections
  const sections = extractSections(content);
  const sectionTitles = sections.map((s) => s.title.toLowerCase());

  // Check for required sections
  for (const required of AGENTS_MD_REQUIRED_SECTIONS) {
    const found = sectionTitles.some(
      (t) => t.includes(required.toLowerCase()) || t === required.toLowerCase()
    );
    if (!found) {
      warnings.push({
        path: 'AGENTS.md',
        message: `Missing recommended section: ## ${required}`,
        suggestion: `Add a "## ${required}" section for better agent guidance`,
      });
    }
  }

  // Check for recommended sections
  for (const recommended of AGENTS_MD_RECOMMENDED_SECTIONS) {
    const found = sectionTitles.some(
      (t) => t.includes(recommended.toLowerCase()) || t === recommended.toLowerCase()
    );
    if (!found) {
      warnings.push({
        path: 'AGENTS.md',
        message: `Consider adding section: ## ${recommended}`,
        suggestion: `A "${recommended}" section would improve agent understanding`,
      });
    }
  }

  // Check for hardcoded secrets
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { pattern, name } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        errors.push({
          path: 'AGENTS.md',
          message: `Potential ${name} detected - never commit secrets`,
          line: i + 1,
        });
      }
    }
  }

  // Check for skill references
  const dollarSkillPattern = /\$([a-z][a-z0-9-]+)/g;
  const slashSkillPattern = /\/([a-z][a-z0-9-]+)/g;
  const dollarSkills = content.match(dollarSkillPattern) || [];
  const slashSkills = content.match(slashSkillPattern) || [];

  if (dollarSkills.length === 0 && slashSkills.length === 0) {
    warnings.push({
      path: 'AGENTS.md',
      message: 'No skill references found',
      suggestion: 'Add skill references using $skill-name syntax (Codex) or /skill-name (Claude Code)',
    });
  }

  // Warn about slash syntax (Claude Code style)
  if (slashSkills.length > 0 && dollarSkills.length === 0) {
    warnings.push({
      path: 'AGENTS.md',
      message: 'Using Claude Code skill syntax (/skill-name)',
      suggestion: 'Codex uses $skill-name syntax. Consider migrating for full compatibility.',
    });
  }

  // Check for code blocks
  const codeBlockCount = (content.match(/```/g) || []).length / 2;
  if (codeBlockCount < 1) {
    warnings.push({
      path: 'AGENTS.md',
      message: 'No code examples found',
      suggestion: 'Add code examples in fenced code blocks (```) to guide agent behavior',
    });
  }

  // Check for common issues
  checkCommonIssues(content, lines, errors, warnings);

  // Check structure
  validateMarkdownStructure(content, lines, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a SKILL.md file
 */
export async function validateSkillMd(content: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const lines = content.split('\n');

  // Check for YAML frontmatter
  if (!content.startsWith('---')) {
    errors.push({
      path: 'SKILL.md',
      message: 'SKILL.md must start with YAML frontmatter (---)',
      line: 1,
    });
    return { valid: false, errors, warnings };
  }

  // Parse YAML frontmatter
  const frontmatterResult = parseYamlFrontmatter(content);

  if (!frontmatterResult.valid) {
    for (const err of frontmatterResult.errors) {
      errors.push({
        path: 'SKILL.md',
        message: err.message,
        line: err.line,
      });
    }
    return { valid: false, errors, warnings };
  }

  const frontmatter = frontmatterResult.data;

  // Check required frontmatter fields
  const requiredFields = ['name', 'description'];
  for (const field of requiredFields) {
    if (!(field in frontmatter)) {
      errors.push({
        path: 'SKILL.md',
        message: `Missing required frontmatter field: ${field}`,
        line: 2,
      });
    } else if (typeof frontmatter[field] !== 'string' || (frontmatter[field] as string).trim() === '') {
      errors.push({
        path: 'SKILL.md',
        message: `Field "${field}" must be a non-empty string`,
        line: 2,
      });
    }
  }

  // Validate name format
  if (frontmatter.name && typeof frontmatter.name === 'string') {
    const name = frontmatter.name as string;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      errors.push({
        path: 'SKILL.md',
        message: `Skill name "${name}" must be lowercase with hyphens only (e.g., my-skill)`,
        line: 2,
      });
    }
    if (name.length > 50) {
      warnings.push({
        path: 'SKILL.md',
        message: 'Skill name is very long',
        suggestion: 'Keep skill names under 50 characters for readability',
      });
    }
  }

  // Check optional but recommended fields
  const recommendedFields = ['version', 'author', 'tags'];
  for (const field of recommendedFields) {
    if (!(field in frontmatter)) {
      warnings.push({
        path: 'SKILL.md',
        message: `Consider adding field: ${field}`,
        suggestion: `Adding "${field}" improves skill discoverability`,
      });
    }
  }

  // Check for model field (should specify min requirements)
  if (frontmatter.model) {
    warnings.push({
      path: 'SKILL.md',
      message: 'Model specification found in frontmatter',
      suggestion: 'Model requirements are informational - skills work with any capable model',
    });
  }

  // Get body content (after frontmatter)
  const bodyStartLine = frontmatterResult.endLine + 1;
  const body = lines.slice(bodyStartLine).join('\n');

  // Check for Purpose section
  if (!body.includes('## Purpose') && !body.includes('## Overview')) {
    warnings.push({
      path: 'SKILL.md',
      message: 'Missing Purpose or Overview section',
      suggestion: 'Add a "## Purpose" section to describe what the skill does',
    });
  }

  // Check for trigger conditions
  const hasTriggers =
    body.includes('When to Trigger') ||
    body.includes('When to Use') ||
    body.includes('Triggers') ||
    (frontmatter.triggers && Array.isArray(frontmatter.triggers));

  if (!hasTriggers) {
    warnings.push({
      path: 'SKILL.md',
      message: 'Missing trigger conditions',
      suggestion: 'Add a section or frontmatter field describing when to trigger this skill',
    });
  }

  // Check for skip conditions
  const hasSkipWhen =
    body.includes('Skip When') ||
    body.includes('When to Skip') ||
    (frontmatter.skip_when && Array.isArray(frontmatter.skip_when));

  if (!hasSkipWhen) {
    warnings.push({
      path: 'SKILL.md',
      message: 'No skip conditions defined',
      suggestion: 'Consider adding skip conditions to prevent unnecessary skill invocation',
    });
  }

  // Check for examples
  const hasExamples = body.includes('## Example') || body.includes('```');
  if (!hasExamples) {
    warnings.push({
      path: 'SKILL.md',
      message: 'No examples provided',
      suggestion: 'Add usage examples to help agents understand skill application',
    });
  }

  // Check for secrets in content
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { pattern, name } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        errors.push({
          path: 'SKILL.md',
          message: `Potential ${name} detected - never commit secrets`,
          line: i + 1,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a config.toml file
 */
export async function validateConfigToml(content: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const lines = content.split('\n');

  // Parse TOML
  const parseResult = parseToml(content);

  if (!parseResult.valid) {
    for (const err of parseResult.errors) {
      errors.push({
        path: 'config.toml',
        message: err.message,
        line: err.line,
      });
    }
    return { valid: false, errors, warnings };
  }

  const config = parseResult.data;

  // Check for required fields
  for (const field of CONFIG_TOML_REQUIRED_FIELDS) {
    const fieldLine = findFieldLine(lines, field);
    if (!content.includes(`${field} =`) && !content.includes(`${field}=`)) {
      errors.push({
        path: 'config.toml',
        message: `Missing required field: ${field}`,
        line: fieldLine,
      });
    }
  }

  // Validate model field
  if (config.model) {
    const model = config.model as string;
    if (typeof model !== 'string') {
      errors.push({
        path: 'config.toml',
        message: 'model must be a string',
        line: findFieldLine(lines, 'model'),
      });
    }
  }

  // Validate approval_policy value
  const approvalMatch = content.match(/approval_policy\s*=\s*"([^"]+)"/);
  if (approvalMatch) {
    const policy = approvalMatch[1]!;
    if (!VALID_APPROVAL_POLICIES.includes(policy)) {
      errors.push({
        path: 'config.toml',
        message: `Invalid approval_policy: "${policy}". Valid values: ${VALID_APPROVAL_POLICIES.join(', ')}`,
        line: findFieldLine(lines, 'approval_policy'),
      });
    }
  }

  // Validate sandbox_mode value
  const sandboxMatch = content.match(/sandbox_mode\s*=\s*"([^"]+)"/);
  if (sandboxMatch) {
    const mode = sandboxMatch[1]!;
    if (!VALID_SANDBOX_MODES.includes(mode)) {
      errors.push({
        path: 'config.toml',
        message: `Invalid sandbox_mode: "${mode}". Valid values: ${VALID_SANDBOX_MODES.join(', ')}`,
        line: findFieldLine(lines, 'sandbox_mode'),
      });
    }
  }

  // Validate web_search value
  const webSearchMatch = content.match(/web_search\s*=\s*"([^"]+)"/);
  if (webSearchMatch) {
    const mode = webSearchMatch[1]!;
    if (!VALID_WEB_SEARCH_MODES.includes(mode)) {
      errors.push({
        path: 'config.toml',
        message: `Invalid web_search: "${mode}". Valid values: ${VALID_WEB_SEARCH_MODES.join(', ')}`,
        line: findFieldLine(lines, 'web_search'),
      });
    }
  }

  // Check for MCP servers section
  if (!content.includes('[mcp_servers')) {
    warnings.push({
      path: 'config.toml',
      message: 'No MCP servers configured',
      suggestion: 'Add [mcp_servers.claude-flow] for Claude Flow integration',
    });
  } else {
    // Validate MCP server configurations
    validateMcpServers(content, lines, errors, warnings);
  }

  // Check for features section
  if (!content.includes('[features]')) {
    warnings.push({
      path: 'config.toml',
      message: 'No [features] section found',
      suggestion: 'Add [features] section to configure Codex behavior',
    });
  }

  // Security warnings for dangerous settings
  if (content.includes('approval_policy = "never"')) {
    if (!content.includes('[profiles.')) {
      warnings.push({
        path: 'config.toml',
        message: 'Using "never" approval policy globally',
        suggestion: 'Consider restricting to dev profile: [profiles.dev] approval_policy = "never"',
      });
    }
  }

  if (content.includes('sandbox_mode = "danger-full-access"')) {
    warnings.push({
      path: 'config.toml',
      message: 'Using "danger-full-access" sandbox mode',
      suggestion: 'This gives unrestricted file system access. Use only in trusted environments.',
    });
  }

  // Check for secrets
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip comment lines
    if (line.trim().startsWith('#')) continue;

    for (const { pattern, name } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        errors.push({
          path: 'config.toml',
          message: `Potential ${name} detected - use environment variables instead`,
          line: i + 1,
        });
      }
    }

    // Check for inline secrets in env sections
    if (line.includes('_KEY =') || line.includes('_SECRET =') || line.includes('_TOKEN =')) {
      const valueMatch = line.match(/=\s*"([^"]+)"/);
      if (valueMatch && valueMatch[1] && !valueMatch[1].startsWith('$')) {
        warnings.push({
          path: 'config.toml',
          message: 'Hardcoded credential detected',
          suggestion: `Use environment variable reference: $ENV_VAR_NAME instead of "${valueMatch[1]}"`,
        });
      }
    }
  }

  // Validate project_doc_max_bytes if present
  const maxBytesMatch = content.match(/project_doc_max_bytes\s*=\s*(\d+)/);
  if (maxBytesMatch) {
    const bytes = parseInt(maxBytesMatch[1]!, 10);
    if (bytes < 1024) {
      warnings.push({
        path: 'config.toml',
        message: `project_doc_max_bytes is very low (${bytes} bytes)`,
        suggestion: 'Consider increasing to at least 65536 for reasonable AGENTS.md support',
      });
    } else if (bytes > 1048576) {
      warnings.push({
        path: 'config.toml',
        message: `project_doc_max_bytes is very high (${bytes} bytes = ${(bytes / 1024 / 1024).toFixed(1)} MB)`,
        suggestion: 'Large values may impact performance. Default is 65536.',
      });
    }
  }

  // Check profiles
  validateProfiles(content, lines, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all files in a project
 */
export async function validateProject(files: {
  agentsMd?: string;
  skillMds?: Array<{ name: string; content: string }>;
  configToml?: string;
}): Promise<{
  valid: boolean;
  results: Record<string, ValidationResult>;
  summary: { errors: number; warnings: number };
}> {
  const results: Record<string, ValidationResult> = {};
  let totalErrors = 0;
  let totalWarnings = 0;

  if (files.agentsMd) {
    results['AGENTS.md'] = await validateAgentsMd(files.agentsMd);
    totalErrors += results['AGENTS.md'].errors.length;
    totalWarnings += results['AGENTS.md'].warnings.length;
  }

  if (files.skillMds) {
    for (const skill of files.skillMds) {
      const key = `skills/${skill.name}`;
      results[key] = await validateSkillMd(skill.content);
      totalErrors += results[key].errors.length;
      totalWarnings += results[key].warnings.length;
    }
  }

  if (files.configToml) {
    results['config.toml'] = await validateConfigToml(files.configToml);
    totalErrors += results['config.toml'].errors.length;
    totalWarnings += results['config.toml'].warnings.length;
  }

  return {
    valid: totalErrors === 0,
    results,
    summary: { errors: totalErrors, warnings: totalWarnings },
  };
}

/**
 * Generate a validation report
 */
export function generateValidationReport(
  results: Record<string, ValidationResult>
): string {
  const lines: string[] = [];
  lines.push('# Validation Report');
  lines.push('');

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [file, result] of Object.entries(results)) {
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;

    lines.push(`## ${file}`);
    lines.push('');
    lines.push(`**Status**: ${result.valid ? 'Valid' : 'Invalid'}`);
    lines.push('');

    if (result.errors.length > 0) {
      lines.push('### Errors');
      lines.push('');
      for (const error of result.errors) {
        const lineInfo = error.line ? ` (line ${error.line})` : '';
        lines.push(`- ${error.message}${lineInfo}`);
      }
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push('### Warnings');
      lines.push('');
      for (const warning of result.warnings) {
        lines.push(`- ${warning.message}`);
        if (warning.suggestion) {
          lines.push(`  - Suggestion: ${warning.suggestion}`);
        }
      }
      lines.push('');
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      lines.push('No issues found.');
      lines.push('');
    }
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total Errors: ${totalErrors}`);
  lines.push(`- Total Warnings: ${totalWarnings}`);
  lines.push(`- Overall Status: ${totalErrors === 0 ? 'PASS' : 'FAIL'}`);
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract sections from markdown content
 */
function extractSections(content: string): Array<{ level: number; title: string; line: number }> {
  const sections: Array<{ level: number; title: string; line: number }> = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && match[1] && match[2]) {
      sections.push({
        level: match[1].length,
        title: match[2].trim(),
        line: i + 1,
      });
    }
  }

  return sections;
}

/**
 * Parse YAML frontmatter
 */
function parseYamlFrontmatter(content: string): YamlFrontmatterResult {
  const result: YamlFrontmatterResult = {
    valid: false,
    errors: [],
    data: {},
    endLine: 0,
  };

  if (!content.startsWith('---')) {
    result.errors.push({ line: 1, message: 'Missing opening ---' });
    return result;
  }

  const lines = content.split('\n');
  let endLineIndex = -1;

  // Find closing ---
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      endLineIndex = i;
      break;
    }
  }

  if (endLineIndex === -1) {
    result.errors.push({ line: 1, message: 'YAML frontmatter not properly closed (missing closing ---)' });
    return result;
  }

  result.endLine = endLineIndex;

  // Parse YAML content (simple key: value parsing)
  const yamlLines = lines.slice(1, endLineIndex);

  for (let i = 0; i < yamlLines.length; i++) {
    const line = yamlLines[i]!.trim();
    if (line === '' || line.startsWith('#')) continue;

    // Simple key: value parsing
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      // Could be a list item or continuation
      continue;
    }

    const key = line.substring(0, colonIndex).trim();
    let value: unknown = line.substring(colonIndex + 1).trim();

    // Parse value type
    if (value === '') {
      value = null;
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (/^-?\d+$/.test(value as string)) {
      value = parseInt(value as string, 10);
    } else if (/^-?\d+\.\d+$/.test(value as string)) {
      value = parseFloat(value as string);
    } else if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
      value = (value as string).slice(1, -1);
    } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
      value = (value as string).slice(1, -1);
    } else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
      // Simple inline array
      try {
        value = JSON.parse((value as string).replace(/'/g, '"'));
      } catch {
        // Keep as string if not valid JSON
      }
    }

    if (key) {
      result.data[key] = value;
    }
  }

  result.valid = true;
  return result;
}

/**
 * Parse TOML content (simplified parser)
 */
function parseToml(content: string): TomlParseResult {
  const result: TomlParseResult = {
    valid: true,
    errors: [],
    data: {},
  };

  const lines = content.split('\n');
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) continue;

    // Section header
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) {
        result.errors.push({
          line: i + 1,
          message: `Invalid section header: ${line} (missing closing bracket)`,
        });
        result.valid = false;
        continue;
      }
      currentSection = line.slice(1, -1);
      continue;
    }

    // Key = value
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      // Could be array continuation or error
      if (!line.startsWith('"') && !line.startsWith("'") && !line.startsWith(']')) {
        result.errors.push({
          line: i + 1,
          message: `Invalid line: ${line} (expected key = value)`,
        });
        result.valid = false;
      }
      continue;
    }

    const key = line.substring(0, eqIndex).trim();
    const valueStr = line.substring(eqIndex + 1).trim();

    // Validate key format
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      result.errors.push({
        line: i + 1,
        message: `Invalid key format: ${key}`,
      });
      result.valid = false;
      continue;
    }

    // Parse value
    let value: unknown = valueStr;

    if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
      value = valueStr.slice(1, -1);
    } else if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
      value = valueStr.slice(1, -1);
    } else if (valueStr === 'true') {
      value = true;
    } else if (valueStr === 'false') {
      value = false;
    } else if (/^-?\d+$/.test(valueStr)) {
      value = parseInt(valueStr, 10);
    } else if (/^-?\d+\.\d+$/.test(valueStr)) {
      value = parseFloat(valueStr);
    } else if (valueStr.startsWith('[')) {
      // Array - simplified handling
      value = valueStr;
    }

    // Store in nested structure
    if (currentSection) {
      if (!result.data[currentSection]) {
        result.data[currentSection] = {};
      }
      (result.data[currentSection] as Record<string, unknown>)[key] = value;
    } else {
      result.data[key] = value;
    }
  }

  return result;
}

/**
 * Find the line number for a field
 */
function findFieldLine(lines: string[], field: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(`${field} =`) || lines[i]!.includes(`${field}=`)) {
      return i + 1;
    }
  }
  return 1;
}

/**
 * Check for common issues in content
 */
function checkCommonIssues(
  content: string,
  lines: string[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Check for broken links
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    const url = match[2]!;
    if (url.startsWith('http') && !url.startsWith('https://')) {
      const line = findLineNumber(content, match.index);
      warnings.push({
        path: 'AGENTS.md',
        message: `Non-HTTPS URL found: ${url}`,
        suggestion: 'Use HTTPS URLs for security',
      });
    }
  }

  // Check for TODO/FIXME comments
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/\b(TODO|FIXME|XXX|HACK)\b/i.test(line)) {
      warnings.push({
        path: 'AGENTS.md',
        message: `Incomplete item found: ${line.trim().substring(0, 50)}...`,
        suggestion: 'Complete or remove TODO/FIXME items before deployment',
      });
    }
  }

  // Check for placeholder content
  const placeholderPatterns = [
    /\[your[- ].*\]/i,
    /\[insert[- ].*\]/i,
    /\[add[- ].*\]/i,
    /\{your[- ].*\}/i,
    /<your[- ].*>/i,
  ];

  for (const pattern of placeholderPatterns) {
    if (pattern.test(content)) {
      warnings.push({
        path: 'AGENTS.md',
        message: 'Placeholder content detected',
        suggestion: 'Replace placeholder text with actual content',
      });
      break;
    }
  }
}

/**
 * Validate markdown structure
 */
function validateMarkdownStructure(
  content: string,
  lines: string[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Check heading hierarchy
  const headings = extractSections(content);
  let prevLevel = 0;

  for (const heading of headings) {
    if (heading.level > prevLevel + 1 && prevLevel > 0) {
      warnings.push({
        path: 'AGENTS.md',
        message: `Heading level jumps from H${prevLevel} to H${heading.level}`,
        suggestion: `Use H${prevLevel + 1} instead of H${heading.level} for proper hierarchy`,
      });
    }
    prevLevel = heading.level;
  }

  // Check for unclosed code blocks
  // Count all triple backticks - they should come in pairs
  const tripleBackticks = (content.match(/```/g) || []).length;
  if (tripleBackticks % 2 !== 0) {
    errors.push({
      path: 'AGENTS.md',
      message: 'Unclosed code block detected (odd number of ``` markers)',
      line: 1,
    });
  }

  // Check for very long lines
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.length > 500) {
      warnings.push({
        path: 'AGENTS.md',
        message: `Very long line (${lines[i]!.length} chars) at line ${i + 1}`,
        suggestion: 'Consider breaking into multiple lines for readability',
      });
    }
  }
}

/**
 * Find line number for a character index
 */
function findLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

/**
 * Validate MCP server configurations
 */
function validateMcpServers(
  content: string,
  lines: string[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Find all MCP server sections
  const serverRegex = /\[mcp_servers\.([^\]]+)\]/g;
  const servers: string[] = [];
  let match;

  while ((match = serverRegex.exec(content)) !== null) {
    servers.push(match[1]!);
  }

  for (const serverName of servers) {
    // Check if server has command
    const serverSection = content.match(
      new RegExp(`\\[mcp_servers\\.${serverName.replace('.', '\\.')}\\][\\s\\S]*?(?=\\[|$)`)
    );

    if (serverSection) {
      const section = serverSection[0];

      if (!section.includes('command =')) {
        errors.push({
          path: 'config.toml',
          message: `MCP server "${serverName}" missing required "command" field`,
          line: findFieldLine(lines, `[mcp_servers.${serverName}]`),
        });
      }

      // Check for enabled = false (info)
      if (section.includes('enabled = false')) {
        warnings.push({
          path: 'config.toml',
          message: `MCP server "${serverName}" is disabled`,
          suggestion: 'Set enabled = true to activate this server',
        });
      }
    }
  }
}

/**
 * Validate profiles
 */
function validateProfiles(
  content: string,
  lines: string[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const profileRegex = /\[profiles\.([^\]]+)\]/g;
  const profiles: string[] = [];
  let match;

  while ((match = profileRegex.exec(content)) !== null) {
    profiles.push(match[1]!);
  }

  // Suggest common profiles if missing
  const recommendedProfiles = ['dev', 'safe', 'ci'];
  for (const profile of recommendedProfiles) {
    if (!profiles.includes(profile)) {
      warnings.push({
        path: 'config.toml',
        message: `Consider adding "${profile}" profile`,
        suggestion: `Add [profiles.${profile}] for ${profile === 'dev' ? 'development' : profile === 'safe' ? 'restricted' : 'CI/CD'} environment`,
      });
    }
  }

  // Check profile settings
  for (const profile of profiles) {
    const profileSection = content.match(
      new RegExp(`\\[profiles\\.${profile}\\][\\s\\S]*?(?=\\[profiles|$)`)
    );

    if (profileSection) {
      const section = profileSection[0];

      // Check if profile has any settings
      if (!section.includes('=')) {
        warnings.push({
          path: 'config.toml',
          message: `Profile "${profile}" has no settings`,
          suggestion: 'Add approval_policy, sandbox_mode, or web_search settings',
        });
      }
    }
  }
}
