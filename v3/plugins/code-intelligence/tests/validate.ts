/**
 * Code Intelligence Plugin - Validation Script
 * Validates that all MCP tools work correctly with test data.
 */

import {
  codeIntelligenceTools,
  semanticSearchTool,
  architectureAnalyzeTool,
  refactorImpactTool,
  splitSuggestTool,
  learnPatternsTool,
  toolHandlers,
  createToolContext,
} from '../dist/mcp-tools.js';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';

interface ValidationResult {
  tool: string;
  passed: boolean;
  error?: string;
}

async function validateTool(
  name: string,
  handler: (input: unknown, context: unknown) => Promise<{ content: Array<{ type: string; text: string }>; data?: unknown }>,
  input: unknown,
  context: unknown
): Promise<ValidationResult> {
  try {
    const result = await handler(input, context);

    if (!result.content || result.content.length === 0) {
      return { tool: name, passed: false, error: 'No content returned' };
    }

    const parsed = JSON.parse(result.content[0].text);

    if (!parsed.success && parsed.error) {
      return { tool: name, passed: false, error: parsed.error };
    }

    return { tool: name, passed: true };
  } catch (err) {
    return { tool: name, passed: false, error: String(err) };
  }
}

async function main() {
  console.log('Code Intelligence Plugin - MCP Tools Validation\n');
  console.log('='.repeat(60));

  const results: ValidationResult[] = [];
  const context = createToolContext({
    allowedRoots: ['.', '/workspaces/claude-flow'],
    maskSecrets: true,
  });

  // 1. Semantic Search Tool
  console.log('\n1. Testing code/semantic-search...');
  results.push(await validateTool(
    'code/semantic-search',
    semanticSearchTool.handler,
    {
      query: 'function that handles user authentication',
      searchType: 'semantic',
      topK: 10,
      scope: {
        paths: ['.'],
        languages: ['typescript', 'javascript'],
        excludeTests: true,
      },
    },
    context
  ));

  // 2. Architecture Analyze Tool
  console.log('2. Testing code/architecture-analyze...');
  results.push(await validateTool(
    'code/architecture-analyze',
    architectureAnalyzeTool.handler,
    {
      rootPath: '.',
      analysis: ['dependency_graph', 'circular_deps', 'component_coupling'],
      layers: {
        presentation: ['src/ui', 'src/components'],
        business: ['src/services', 'src/domain'],
        data: ['src/repositories', 'src/models'],
      },
    },
    context
  ));

  // 3. Refactor Impact Tool
  console.log('3. Testing code/refactor-impact...');
  results.push(await validateTool(
    'code/refactor-impact',
    refactorImpactTool.handler,
    {
      changes: [
        { file: 'src/utils.ts', type: 'rename', details: { oldName: 'formatDate', newName: 'formatDateISO' } },
        { file: 'src/api/client.ts', type: 'move', details: { newPath: 'src/services/client.ts' } },
      ],
      depth: 3,
      includeTests: true,
    },
    context
  ));

  // 4. Split Suggest Tool
  console.log('4. Testing code/split-suggest...');
  results.push(await validateTool(
    'code/split-suggest',
    splitSuggestTool.handler,
    {
      targetPath: '.',
      strategy: 'minimize_coupling',  // Valid options: 'minimize_coupling', 'balance_size', 'feature_isolation'
      targetModules: 4,
      constraints: {
        minModuleSize: 3,
        maxModuleSize: 50,
      },
    },
    context
  ));

  // 5. Learn Patterns Tool
  console.log('5. Testing code/learn-patterns...');
  results.push(await validateTool(
    'code/learn-patterns',
    learnPatternsTool.handler,
    {
      scope: {
        gitRange: 'HEAD~10..HEAD',
      },
      patternTypes: ['bug_patterns', 'refactor_patterns', 'api_patterns'],  // Valid: 'bug_patterns', 'refactor_patterns', 'api_patterns', 'test_patterns'
      minOccurrences: 2,
    },
    context
  ));

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const result of results) {
    console.log(`  ${result.passed ? PASS : FAIL} ${result.tool}`);
    if (result.error) {
      console.log(`      Error: ${result.error.slice(0, 100)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('Exported tools:', codeIntelligenceTools.length);
  console.log('Handler map size:', toolHandlers.size);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
