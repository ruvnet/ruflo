import { describe, it, expect } from '@jest/globals';
import { 
  createSparcClaudeMd, 
  createFullClaudeMd, 
  createMinimalClaudeMd 
} from "../../../../../src/cli/simple-commands/init/templates/claude-md.js";
import { 
  createFullMemoryBankMd, 
  createMinimalMemoryBankMd 
} from "../../../../../src/cli/simple-commands/init/templates/memory-bank-md.js";
import { 
  createFullCoordinationMd, 
  createMinimalCoordinationMd 
} from "../../../../../src/cli/simple-commands/init/templates/coordination-md.js";
import { 
  createAgentsReadme, 
  createSessionsReadme 
} from "../../../../../src/cli/simple-commands/init/templates/readme-files.js";

describe("Template Generation Tests", () => {
  describe("CLAUDE.md templates", () => {
    it("should generate full CLAUDE.md with proper structure", () => {
      const content = createFullClaudeMd();
      
      expect(content).toContain("# Gemini Code Configuration");
      expect(content).toContain("## Project Overview");
      expect(content).toContain("## Key Commands");
      expect(content).toContain("## Code Style");
      expect(content).toContain("## Project Architecture");
    });

    it("should generate minimal CLAUDE.md with basic info", () => {
      const content = createMinimalClaudeMd();
      
      expect(content).toContain("# Gemini Code Configuration");
      expect(content).toContain("Minimal project configuration");
      
      // Should be shorter than full version
      const fullContent = createFullClaudeMd();
      expect(content.length).toBeLessThan(fullContent.length);
    });

    it("should generate SPARC-enhanced CLAUDE.md", () => {
      const content = createSparcClaudeMd();
      
      expect(content).toContain("SPARC Development Environment");
      expect(content).toContain("## SPARC Development Commands");
      expect(content).toContain("## SPARC Methodology Workflow");
      expect(content).toContain("### 1. Specification Phase");
      expect(content).toContain("### 2. Pseudocode Phase");
      expect(content).toContain("### 3. Architecture Phase");
      expect(content).toContain("### 4. Refinement Phase");
      expect(content).toContain("### 5. Completion Phase");
      expect(content).toContain("Test-Driven Development");
    });

    it("should include proper SPARC commands in SPARC template", () => {
      const content = createSparcClaudeMd();
      
      // Check for SPARC commands
      expect(content).toContain("npx gemini-flow sparc modes");
      expect(content).toContain("npx gemini-flow sparc run");
      expect(content).toContain("npx gemini-flow sparc tdd");
      expect(content).toContain("npx gemini-flow sparc info");
    });
  });

  describe("memory-bank.md templates", () => {
    it("should generate full memory bank with sections", () => {
      const content = createFullMemoryBankMd();
      
      expect(content).toContain("# Memory Bank");
      expect(content).toContain("## Active Tasks");
      expect(content).toContain("## Key Decisions");
      expect(content).toContain("## Project Context");
      expect(content).toContain("## Technical Specifications");
    });

    it("should generate minimal memory bank", () => {
      const content = createMinimalMemoryBankMd();
      
      expect(content).toContain("# Memory Bank");
      expect(content).toContain("Simple memory tracking");
      
      // Should be shorter
      const fullContent = createFullMemoryBankMd();
      expect(content.length).toBeLessThan(fullContent.length);
    });
  });

  describe("coordination.md templates", () => {
    it("should generate full coordination with agent structure", () => {
      const content = createFullCoordinationMd();
      
      expect(content).toContain("# Multi-Agent Coordination System");
      expect(content).toContain("## Coordination Structure");
      expect(content).toContain("## Agent Roles");
      expect(content).toContain("## Current Coordination State");
      expect(content).toContain("## Coordination Rules");
    });

    it("should generate minimal coordination", () => {
      const content = createMinimalCoordinationMd();
      
      expect(content).toContain("# Multi-Agent Coordination");
      expect(content).toContain("Simple coordination tracking");
      
      // Should be shorter
      const fullContent = createFullCoordinationMd();
      expect(content.length).toBeLessThan(fullContent.length);
    });
  });

  describe("README templates", () => {
    it("should generate agents README with proper format", () => {
      const content = createAgentsReadme();
      
      expect(content).toContain("# Agent Memory Storage");
      expect(content).toContain("## Directory Structure");
      expect(content).toContain("## File Format");
      expect(content).toContain(".json");
    });

    it("should generate sessions README with proper format", () => {
      const content = createSessionsReadme();
      
      expect(content).toContain("# Session Memory Storage");
      expect(content).toContain("## Directory Structure");
      expect(content).toContain("## File Format");
      expect(content).toContain("session_");
    });
  });

  describe("Template consistency", () => {
    it("should have consistent markdown formatting", () => {
      const templates = [
        createFullClaudeMd(),
        createMinimalClaudeMd(),
        createSparcClaudeMd(),
        createFullMemoryBankMd(),
        createMinimalMemoryBankMd(),
        createFullCoordinationMd(),
        createMinimalCoordinationMd(),
        createAgentsReadme(),
        createSessionsReadme()
      ];

      for (const template of templates) {
        // All should start with a header
        expect(template.startsWith("#")).toBe(true);
        // All should have proper line endings
        expect(template.includes("\r")).toBe(false);
      }
    });

    it("should include proper file extensions in examples", () => {
      const sparcTemplate = createSparcClaudeMd();
      
      // Check for file extensions in examples
      expect(sparcTemplate).toContain(".json");
      expect(sparcTemplate).toContain(".md");
      expect(sparcTemplate).toContain(".ts");
    });
  });

  describe("SPARC-specific content", () => {
    it("should include all SPARC modes in template", () => {
      const content = createSparcClaudeMd();
      
      // Development modes
      expect(content).toContain("architect");
      expect(content).toContain("code");
      expect(content).toContain("tdd");
      expect(content).toContain("spec-pseudocode");
      expect(content).toContain("integration");
      
      // Quality modes
      expect(content).toContain("debug");
      expect(content).toContain("security-review");
      expect(content).toContain("refinement-optimization-mode");
      
      // Support modes
      expect(content).toContain("docs-writer");
      expect(content).toContain("devops");
      expect(content).toContain("mcp");
      expect(content).toContain("swarm");
    });

    it("should include workflow examples", () => {
      const content = createSparcClaudeMd();
      
      expect(content).toContain("### Feature Development Workflow");
      expect(content).toContain("### Bug Fix Workflow");
      expect(content).toContain("# 1. Start with specification");
      expect(content).toContain("# 2. Design architecture");
      expect(content).toContain("# 3. Implement with TDD");
    });

    it("should include memory integration examples", () => {
      const content = createSparcClaudeMd();
      
      expect(content).toContain("## SPARC Memory Integration");
      expect(content).toContain("memory store spec_auth");
      expect(content).toContain("memory store arch_decisions");
      expect(content).toContain("memory store test_coverage");
      expect(content).toContain("memory query");
      expect(content).toContain("memory export");
    });
  });
});