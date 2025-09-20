#!/usr/bin/env node

/**
 * Mock/Placeholder Verification Script
 * Verifies that no mock or placeholder functionality remains in the Claude Flow MCP system
 * Created by System Coordinator for integrated system optimization
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Patterns that indicate mock/placeholder code
const MOCK_PATTERNS = [
  /mock/i,
  /placeholder/i,
  /todo:?\s*implement/i,
  /not\s+implemented/i,
  /throw\s+new\s+Error\(['"`]not\s+implemented/i,
  /\/\/\s*TODO/i,
  /\/\*\s*TODO/i,
  /FIXME/i,
  /return\s+null;\s*\/\/\s*mock/i,
  /return\s+{};\s*\/\/\s*mock/i,
  /return\s+\[\];\s*\/\/\s*mock/i,
  /console\.log\(['"`]mock/i,
  /console\.warn\(['"`]mock/i,
  /process\.exit\(1\);\s*\/\/\s*not\s+implemented/i
];

// Directories to scan
const SCAN_DIRECTORIES = [
  'src',
  'dist'
];

// Files to exclude from scanning
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.nyc_output/,
  /coverage/,
  /\.DS_Store/,
  /\.log$/,
  /\.md$/,
  /package.*\.json$/,
  /tsconfig.*\.json$/,
  /\.d\.ts$/,
  /test.*\.ts$/,
  /test.*\.js$/,
  /spec.*\.ts$/,
  /spec.*\.js$/,
  /verify-no-mocks\.js$/
];

class MockVerifier {
  constructor() {
    this.issues = [];
    this.scannedFiles = 0;
    this.totalLines = 0;
  }

  async verify() {
    console.log('🔍 Scanning Claude Flow MCP system for mocks and placeholders...\n');

    for (const directory of SCAN_DIRECTORIES) {
      const dirPath = path.join(projectRoot, directory);
      
      try {
        await fs.access(dirPath);
        await this.scanDirectory(dirPath);
      } catch (error) {
        console.log(`⚠️  Directory ${directory} not found, skipping...`);
      }
    }

    this.generateReport();
  }

  async scanDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(projectRoot, fullPath);

      // Skip excluded files and directories
      if (this.shouldExclude(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else if (entry.isFile() && this.isCodeFile(entry.name)) {
        await this.scanFile(fullPath, relativePath);
      }
    }
  }

  shouldExclude(relativePath) {
    return EXCLUDE_PATTERNS.some(pattern => pattern.test(relativePath));
  }

  isCodeFile(filename) {
    const codeExtensions = ['.ts', '.js', '.mjs', '.cjs'];
    return codeExtensions.some(ext => filename.endsWith(ext));
  }

  async scanFile(filePath, relativePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      
      this.scannedFiles++;
      this.totalLines += lines.length;

      for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber];
        this.checkLineForMocks(line, relativePath, lineNumber + 1);
      }
      
      // Check for specific mock/placeholder patterns in file structure
      this.checkFileStructure(content, relativePath);
      
    } catch (error) {
      console.error(`❌ Error scanning ${relativePath}: ${error.message}`);
    }
  }

  checkLineForMocks(line, filePath, lineNumber) {
    for (const pattern of MOCK_PATTERNS) {
      if (pattern.test(line)) {
        // Skip comments that are just documentation
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
          // Allow documentation comments, but flag implementation TODOs
          if (pattern.test(line) && /implement|fixme|todo.*implement/i.test(line)) {
            this.addIssue({
              file: filePath,
              line: lineNumber,
              content: line.trim(),
              pattern: pattern.source,
              severity: 'warning',
              type: 'documentation-todo'
            });
          }
          continue;
        }

        this.addIssue({
          file: filePath,
          line: lineNumber,
          content: line.trim(),
          pattern: pattern.source,
          severity: this.getSeverity(line, pattern),
          type: 'mock-code'
        });
      }
    }
  }

  checkFileStructure(content, filePath) {
    // Check for empty class methods that might be mocks
    const emptyMethodPattern = /(\w+)\s*\([^)]*\)\s*:\s*[^{]*\{\s*\/\/\s*(mock|todo|placeholder|not implemented)/gi;
    let match;
    
    while ((match = emptyMethodPattern.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      this.addIssue({
        file: filePath,
        line: lineNumber,
        content: `Method ${match[1]} appears to be a mock/placeholder`,
        pattern: 'empty-method-mock',
        severity: 'high',
        type: 'structural-mock'
      });
    }

    // Check for mock imports
    const mockImportPattern = /import.*['"`].*mock.*['"`]/gi;
    while ((match = mockImportPattern.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length;
      this.addIssue({
        file: filePath,
        line: lineNumber,
        content: match[0].trim(),
        pattern: 'mock-import',
        severity: 'critical',
        type: 'mock-import'
      });
    }

    // Check for conditional mock/development code
    const devCodePattern = /if\s*\(\s*process\.env\.NODE_ENV\s*===?\s*['"`]development['"`]\s*\)/gi;
    while ((match = devCodePattern.exec(content)) !== null) {
      // This is actually okay for development-specific code
      // Just noting it exists
    }
  }

  getSeverity(line, pattern) {
    const criticalPatterns = [
      /throw\s+new\s+Error\(['"`]not\s+implemented/i,
      /process\.exit\(1\);\s*\/\/\s*not\s+implemented/i
    ];

    const highPatterns = [
      /not\s+implemented/i,
      /return\s+null;\s*\/\/\s*mock/i
    ];

    if (criticalPatterns.some(p => p.test(line))) {
      return 'critical';
    } else if (highPatterns.some(p => p.test(line))) {
      return 'high';
    } else if (/todo.*implement/i.test(line)) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  addIssue(issue) {
    this.issues.push(issue);
  }

  generateReport() {
    console.log('📊 MOCK/PLACEHOLDER VERIFICATION REPORT');
    console.log('=' .repeat(50));
    console.log(`Files scanned: ${this.scannedFiles}`);
    console.log(`Total lines: ${this.totalLines.toLocaleString()}`);
    console.log(`Issues found: ${this.issues.length}\n`);

    if (this.issues.length === 0) {
      console.log('✅ EXCELLENT! No mocks or placeholders found.');
      console.log('✅ The Claude Flow MCP system appears to have complete real implementations.');
      console.log('✅ All components should be production-ready.\n');
      process.exit(0);
    }

    // Group issues by severity
    const issuesBySeverity = {
      critical: this.issues.filter(i => i.severity === 'critical'),
      high: this.issues.filter(i => i.severity === 'high'),
      medium: this.issues.filter(i => i.severity === 'medium'),
      low: this.issues.filter(i => i.severity === 'low'),
      warning: this.issues.filter(i => i.severity === 'warning')
    };

    // Report critical issues
    if (issuesBySeverity.critical.length > 0) {
      console.log('🚨 CRITICAL ISSUES (Must be fixed):');
      console.log('-'.repeat(40));
      issuesBySeverity.critical.forEach(issue => {
        console.log(`❌ ${issue.file}:${issue.line}`);
        console.log(`   ${issue.content}`);
        console.log(`   Pattern: ${issue.pattern}\n`);
      });
    }

    // Report high severity issues
    if (issuesBySeverity.high.length > 0) {
      console.log('⚠️  HIGH PRIORITY ISSUES:');
      console.log('-'.repeat(40));
      issuesBySeverity.high.forEach(issue => {
        console.log(`⚠️  ${issue.file}:${issue.line}`);
        console.log(`   ${issue.content}`);
        console.log(`   Pattern: ${issue.pattern}\n`);
      });
    }

    // Report medium severity issues
    if (issuesBySeverity.medium.length > 0) {
      console.log('📝 MEDIUM PRIORITY ISSUES:');
      console.log('-'.repeat(40));
      issuesBySeverity.medium.forEach(issue => {
        console.log(`📝 ${issue.file}:${issue.line}`);
        console.log(`   ${issue.content}\n`);
      });
    }

    // Report warnings (documentation TODOs, etc.)
    if (issuesBySeverity.warning.length > 0) {
      console.log('💡 WARNINGS (Documentation/Comments):');
      console.log('-'.repeat(40));
      issuesBySeverity.warning.forEach(issue => {
        console.log(`💡 ${issue.file}:${issue.line}`);
        console.log(`   ${issue.content}\n`);
      });
    }

    // Summary and recommendations
    console.log('📋 SUMMARY:');
    console.log('-'.repeat(20));
    console.log(`Critical Issues: ${issuesBySeverity.critical.length}`);
    console.log(`High Priority: ${issuesBySeverity.high.length}`);
    console.log(`Medium Priority: ${issuesBySeverity.medium.length}`);
    console.log(`Warnings: ${issuesBySeverity.warning.length}\n`);

    if (issuesBySeverity.critical.length > 0) {
      console.log('🚨 RESULT: FAILED - Critical issues must be resolved before deployment');
      process.exit(1);
    } else if (issuesBySeverity.high.length > 0) {
      console.log('⚠️  RESULT: NEEDS ATTENTION - High priority issues should be resolved');
      process.exit(1);
    } else if (issuesBySeverity.medium.length > 5) {
      console.log('📝 RESULT: NEEDS CLEANUP - Many medium priority issues found');
      process.exit(1);
    } else {
      console.log('✅ RESULT: ACCEPTABLE - Minor issues found, system appears mostly complete');
      console.log('💡 Consider addressing remaining issues for better code quality\n');
      process.exit(0);
    }
  }
}

// Run the verification
const verifier = new MockVerifier();
verifier.verify().catch(error => {
  console.error('❌ Verification failed:', error);
  process.exit(1);
});