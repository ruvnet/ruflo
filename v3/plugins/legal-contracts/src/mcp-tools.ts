/**
 * Legal Contracts Plugin - MCP Tools
 *
 * Implements 5 MCP tools for legal contract analysis:
 * 1. legal/clause-extract - Extract and classify clauses
 * 2. legal/risk-assess - Identify and score contractual risks
 * 3. legal/contract-compare - Compare contracts with attention-based alignment
 * 4. legal/obligation-track - Extract obligations with DAG analysis
 * 5. legal/playbook-match - Match clauses against negotiation playbook
 *
 * Based on ADR-034: Legal Contract Analysis Plugin
 *
 * @module v3/plugins/legal-contracts/mcp-tools
 */

import { z } from 'zod';
import type {
  ClauseExtractionResult,
  RiskAssessmentResult,
  ContractComparisonResult,
  ObligationTrackingResult,
  PlaybookMatchResult,
  ExtractedClause,
  RiskFinding,
  Obligation,
  PlaybookMatch,
  DocumentMetadata,
  IAttentionBridge,
  IDAGBridge,
} from './types.js';
import {
  ClauseExtractInputSchema,
  RiskAssessInputSchema,
  ContractCompareInputSchema,
  ObligationTrackInputSchema,
  PlaybookMatchInputSchema,
  ClauseType,
  RiskCategory,
  RiskSeverity,
} from './types.js';
import { createAttentionBridge } from './bridges/attention-bridge.js';
import { createDAGBridge } from './bridges/dag-bridge.js';

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * MCP Tool definition
 */
export interface MCPTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category: string;
  version: string;
  inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, context: ToolContext) => Promise<MCPToolResult<TOutput>>;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  bridges: {
    attention: IAttentionBridge;
    dag: IDAGBridge;
  };
}

/**
 * MCP Tool result format
 */
export interface MCPToolResult<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  data?: T;
}

// ============================================================================
// Clause Extract Tool
// ============================================================================

/**
 * MCP Tool: legal/clause-extract
 *
 * Extract and classify clauses from legal documents
 */
export const clauseExtractTool: MCPTool<
  z.infer<typeof ClauseExtractInputSchema>,
  ClauseExtractionResult
> = {
  name: 'legal/clause-extract',
  description: 'Extract and classify clauses from legal documents',
  category: 'legal',
  version: '3.0.0-alpha.1',
  inputSchema: ClauseExtractInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      // Validate input
      const validated = ClauseExtractInputSchema.parse(input);

      // Parse document and extract clauses
      const metadata = parseDocumentMetadata(validated.document);
      const clauses = await extractClauses(
        validated.document,
        validated.clauseTypes,
        validated.jurisdiction,
        context
      );

      // Separate classified and unclassified
      const classifiedClauses = clauses.filter(c => c.confidence >= 0.7);
      const unclassified = clauses
        .filter(c => c.confidence < 0.7)
        .map(c => ({
          text: c.text,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          reason: `Low confidence: ${(c.confidence * 100).toFixed(1)}%`,
        }));

      const result: ClauseExtractionResult = {
        success: true,
        clauses: classifiedClauses,
        metadata,
        unclassified,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

// ============================================================================
// Risk Assess Tool
// ============================================================================

/**
 * MCP Tool: legal/risk-assess
 *
 * Assess contractual risks with severity scoring
 */
export const riskAssessTool: MCPTool<
  z.infer<typeof RiskAssessInputSchema>,
  RiskAssessmentResult
> = {
  name: 'legal/risk-assess',
  description: 'Assess contractual risks with severity scoring',
  category: 'legal',
  version: '3.0.0-alpha.1',
  inputSchema: RiskAssessInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = RiskAssessInputSchema.parse(input);

      // Extract clauses first
      const clauses = await extractClauses(validated.document, undefined, 'US', context);

      // Assess risks
      const risks = await assessRisks(
        clauses,
        validated.partyRole,
        validated.riskCategories,
        validated.industryContext
      );

      // Filter by threshold if specified
      const filteredRisks = validated.threshold
        ? risks.filter(r => getSeverityLevel(r.severity) >= getSeverityLevel(validated.threshold!))
        : risks;

      // Build category summary
      const categorySummary = buildCategorySummary(filteredRisks);

      // Calculate overall score
      const overallScore = calculateOverallRiskScore(filteredRisks);
      const grade = scoreToGrade(overallScore);

      const result: RiskAssessmentResult = {
        success: true,
        partyRole: validated.partyRole,
        risks: filteredRisks,
        categorySummary,
        overallScore,
        grade,
        criticalRisks: filteredRisks
          .filter(r => r.severity === 'critical' || r.severity === 'high')
          .slice(0, 5),
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

// ============================================================================
// Contract Compare Tool
// ============================================================================

/**
 * MCP Tool: legal/contract-compare
 *
 * Compare two contracts with detailed diff and semantic alignment
 */
export const contractCompareTool: MCPTool<
  z.infer<typeof ContractCompareInputSchema>,
  ContractComparisonResult
> = {
  name: 'legal/contract-compare',
  description: 'Compare two contracts with detailed diff and semantic alignment',
  category: 'legal',
  version: '3.0.0-alpha.1',
  inputSchema: ContractCompareInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = ContractCompareInputSchema.parse(input);

      // Extract clauses from both documents
      const baseClauses = await extractClauses(validated.baseDocument, undefined, 'US', context);
      const compareClauses = await extractClauses(validated.compareDocument, undefined, 'US', context);

      // Initialize attention bridge
      const attention = context.bridges.attention;
      if (!attention.isInitialized()) {
        await attention.initialize();
      }

      // Align clauses using attention
      const alignments = await attention.alignClauses(baseClauses, compareClauses);

      // Detect changes
      const changes = detectChanges(baseClauses, compareClauses, alignments);

      // Calculate similarity score
      const similarityScore = alignments.length > 0
        ? alignments.reduce((sum, a) => sum + a.similarity, 0) / alignments.length
        : 0;

      // Build summary
      const summary = {
        totalChanges: changes.length,
        added: changes.filter(c => c.type === 'added').length,
        removed: changes.filter(c => c.type === 'removed').length,
        modified: changes.filter(c => c.type === 'modified').length,
        favorable: changes.filter(c => c.impact === 'favorable').length,
        unfavorable: changes.filter(c => c.impact === 'unfavorable').length,
      };

      // Generate redline if requested
      const redlineMarkup = validated.generateRedline
        ? generateRedlineMarkup(validated.baseDocument, changes)
        : undefined;

      const result: ContractComparisonResult = {
        success: true,
        mode: validated.comparisonMode,
        changes,
        alignments,
        similarityScore,
        summary,
        redlineMarkup,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

// ============================================================================
// Obligation Track Tool
// ============================================================================

/**
 * MCP Tool: legal/obligation-track
 *
 * Extract obligations, deadlines, and dependencies using DAG analysis
 */
export const obligationTrackTool: MCPTool<
  z.infer<typeof ObligationTrackInputSchema>,
  ObligationTrackingResult
> = {
  name: 'legal/obligation-track',
  description: 'Extract obligations, deadlines, and dependencies using DAG analysis',
  category: 'legal',
  version: '3.0.0-alpha.1',
  inputSchema: ObligationTrackInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = ObligationTrackInputSchema.parse(input);

      // Extract obligations
      let obligations = await extractObligations(
        validated.document,
        validated.obligationTypes
      );

      // Filter by party if specified
      if (validated.party) {
        obligations = obligations.filter(o =>
          o.party.toLowerCase().includes(validated.party!.toLowerCase())
        );
      }

      // Filter by timeframe if specified
      if (validated.timeframe) {
        obligations = filterByTimeframe(obligations, validated.timeframe);
      }

      // Initialize DAG bridge
      const dag = context.bridges.dag;
      if (!dag.isInitialized()) {
        await dag.initialize();
      }

      // Build dependency graph
      const graph = await dag.buildDependencyGraph(obligations);

      // Build timeline
      const timeline = buildTimeline(obligations);

      // Find upcoming deadlines (next 30 days)
      const now = new Date();
      const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const upcomingDeadlines = obligations.filter(o =>
        o.dueDate && o.dueDate >= now && o.dueDate <= thirtyDaysLater
      );

      // Find overdue
      const overdue = obligations.filter(o =>
        o.dueDate && o.dueDate < now && o.status !== 'completed' && o.status !== 'waived'
      );

      const result: ObligationTrackingResult = {
        success: true,
        obligations,
        graph,
        timeline,
        upcomingDeadlines,
        overdue,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

// ============================================================================
// Playbook Match Tool
// ============================================================================

/**
 * MCP Tool: legal/playbook-match
 *
 * Compare contract clauses against negotiation playbook
 */
export const playbookMatchTool: MCPTool<
  z.infer<typeof PlaybookMatchInputSchema>,
  PlaybookMatchResult
> = {
  name: 'legal/playbook-match',
  description: 'Compare contract clauses against negotiation playbook',
  category: 'legal',
  version: '3.0.0-alpha.1',
  inputSchema: PlaybookMatchInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = PlaybookMatchInputSchema.parse(input);

      // Parse playbook
      const playbook = parsePlaybook(validated.playbook);

      // Extract clauses from document
      const clauses = await extractClauses(validated.document, undefined, 'US', context);

      // Initialize attention bridge
      const attention = context.bridges.attention;
      if (!attention.isInitialized()) {
        await attention.initialize();
      }

      // Match clauses against playbook
      const matches = await matchAgainstPlaybook(
        clauses,
        playbook,
        validated.strictness,
        validated.suggestAlternatives,
        attention
      );

      // Build summary
      const summary = {
        totalClauses: matches.length,
        matchesPreferred: matches.filter(m => m.status === 'matches_preferred').length,
        matchesAcceptable: matches.filter(m => m.status === 'matches_acceptable').length,
        requiresFallback: matches.filter(m => m.status === 'requires_fallback').length,
        violatesRedline: matches.filter(m => m.status === 'violates_redline').length,
        noMatch: matches.filter(m => m.status === 'no_match').length,
      };

      // Find red line violations
      const redLineViolations = matches.filter(m => m.status === 'violates_redline');

      // Prioritize negotiations
      const negotiationPriorities = buildNegotiationPriorities(matches, validated.prioritizeClauses);

      const result: PlaybookMatchResult = {
        success: true,
        playbook: {
          id: playbook.id,
          name: playbook.name,
          version: playbook.version,
        },
        matches,
        summary,
        redLineViolations,
        negotiationPriorities,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse document metadata
 */
function parseDocumentMetadata(document: string): DocumentMetadata {
  const hash = simpleHash(document);

  return {
    id: `doc-${hash.substring(0, 8)}`,
    format: 'txt',
    wordCount: document.split(/\s+/).length,
    charCount: document.length,
    language: 'en',
    parties: [],
    contentHash: hash,
  };
}

/**
 * Simple hash function
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/**
 * Extract clauses from document
 */
async function extractClauses(
  document: string,
  clauseTypes: ClauseType[] | undefined,
  jurisdiction: string,
  context: ToolContext
): Promise<ExtractedClause[]> {
  const clauses: ExtractedClause[] = [];

  // Define clause patterns
  const clausePatterns: Record<ClauseType, RegExp[]> = {
    indemnification: [/indemnif/i, /hold\s+harmless/i, /defend\s+and\s+indemnify/i],
    limitation_of_liability: [/limitation\s+of\s+liability/i, /liability\s+shall\s+not\s+exceed/i],
    termination: [/termination/i, /right\s+to\s+terminate/i, /upon\s+termination/i],
    confidentiality: [/confidential/i, /non-disclosure/i, /proprietary\s+information/i],
    ip_assignment: [/intellectual\s+property/i, /assignment\s+of\s+(ip|rights)/i, /work\s+for\s+hire/i],
    governing_law: [/governing\s+law/i, /governed\s+by\s+the\s+laws/i, /jurisdiction/i],
    arbitration: [/arbitration/i, /arbitral\s+proceedings/i, /binding\s+arbitration/i],
    force_majeure: [/force\s+majeure/i, /act\s+of\s+god/i, /beyond\s+reasonable\s+control/i],
    warranty: [/warrant/i, /represents\s+and\s+warrants/i, /as-is/i],
    payment_terms: [/payment/i, /invoic/i, /net\s+\d+/i],
    non_compete: [/non-?compet/i, /not\s+compete/i],
    non_solicitation: [/non-?solicit/i, /not\s+solicit/i],
    assignment: [/assignment/i, /may\s+not\s+assign/i],
    insurance: [/insurance/i, /maintain\s+coverage/i],
    representations: [/represent/i, /represent\s+and\s+warrant/i],
    covenants: [/covenant/i, /agrees\s+to/i],
    data_protection: [/data\s+protection/i, /personal\s+data/i, /gdpr/i, /privacy/i],
    audit_rights: [/audit/i, /right\s+to\s+inspect/i, /access\s+to\s+records/i],
  };

  // Split document into sections/paragraphs
  const sections = document.split(/\n\n+/);
  let offset = 0;

  for (const section of sections) {
    const sectionStart = document.indexOf(section, offset);
    const sectionEnd = sectionStart + section.length;
    offset = sectionEnd;

    // Try to classify section
    for (const [type, patterns] of Object.entries(clausePatterns)) {
      const clauseType = type as ClauseType;

      // Skip if not in requested types
      if (clauseTypes && clauseTypes.length > 0 && !clauseTypes.includes(clauseType)) {
        continue;
      }

      // Check patterns
      let matchCount = 0;
      for (const pattern of patterns) {
        if (pattern.test(section)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const confidence = Math.min(0.5 + matchCount * 0.2, 0.99);

        clauses.push({
          id: `clause-${clauses.length + 1}`,
          type: clauseType,
          text: section.trim(),
          startOffset: sectionStart,
          endOffset: sectionEnd,
          confidence,
          keyTerms: extractKeyTerms(section),
        });

        break; // Only classify as one type
      }
    }
  }

  return clauses;
}

/**
 * Extract key terms from text
 */
function extractKeyTerms(text: string): string[] {
  const terms: string[] = [];
  const termPatterns = [
    /\$[\d,]+/g,              // Dollar amounts
    /\d+\s*(days?|months?|years?)/gi,  // Time periods
    /\d+%/g,                  // Percentages
    /"[^"]+"/g,               // Quoted terms
  ];

  for (const pattern of termPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      terms.push(...matches);
    }
  }

  return [...new Set(terms)].slice(0, 10);
}

/**
 * Assess risks in clauses
 */
async function assessRisks(
  clauses: ExtractedClause[],
  partyRole: string,
  categories: RiskCategory[] | undefined,
  industryContext: string | undefined
): Promise<RiskFinding[]> {
  const risks: RiskFinding[] = [];

  // Risk patterns by clause type and party role
  const riskPatterns: Record<string, Array<{
    pattern: RegExp;
    severity: RiskSeverity;
    category: RiskCategory;
    title: string;
    description: string;
    mitigation: string;
  }>> = {
    indemnification: [
      {
        pattern: /unlimited\s+indemnification/i,
        severity: 'critical',
        category: 'financial',
        title: 'Unlimited Indemnification',
        description: 'Contract requires unlimited indemnification which could expose party to significant financial risk',
        mitigation: 'Negotiate cap on indemnification liability',
      },
    ],
    limitation_of_liability: [
      {
        pattern: /no\s+limitation/i,
        severity: 'high',
        category: 'financial',
        title: 'No Liability Cap',
        description: 'Contract contains no limitation on liability',
        mitigation: 'Add liability cap based on contract value or insurance coverage',
      },
    ],
    termination: [
      {
        pattern: /immediate\s+termination/i,
        severity: 'medium',
        category: 'operational',
        title: 'Immediate Termination Right',
        description: 'Counterparty can terminate immediately without notice',
        mitigation: 'Negotiate notice period for termination',
      },
    ],
    warranty: [
      {
        pattern: /as-?is/i,
        severity: 'medium',
        category: 'legal',
        title: 'As-Is Warranty Disclaimer',
        description: 'Product/service provided without warranty',
        mitigation: 'Negotiate minimum performance warranties',
      },
    ],
  };

  for (const clause of clauses) {
    const patterns = riskPatterns[clause.type] ?? [];

    for (const riskPattern of patterns) {
      if (riskPattern.pattern.test(clause.text)) {
        // Filter by category if specified
        if (categories && !categories.includes(riskPattern.category)) {
          continue;
        }

        risks.push({
          id: `risk-${risks.length + 1}`,
          category: riskPattern.category,
          severity: riskPattern.severity,
          title: riskPattern.title,
          description: riskPattern.description,
          clauseIds: [clause.id],
          mitigations: [riskPattern.mitigation],
          deviatesFromStandard: true,
          confidence: clause.confidence,
        });
      }
    }
  }

  return risks;
}

/**
 * Get severity level as number
 */
function getSeverityLevel(severity: RiskSeverity): number {
  const levels: Record<RiskSeverity, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return levels[severity];
}

/**
 * Build category summary
 */
function buildCategorySummary(
  risks: RiskFinding[]
): Record<RiskCategory, { count: number; highestSeverity: RiskSeverity; averageScore: number }> {
  const summary: Record<string, { count: number; highestSeverity: RiskSeverity; totalScore: number }> = {};

  for (const category of Object.values(RiskCategory.options)) {
    summary[category] = { count: 0, highestSeverity: 'low', totalScore: 0 };
  }

  for (const risk of risks) {
    const cat = summary[risk.category];
    if (cat) {
      cat.count++;
      cat.totalScore += getSeverityLevel(risk.severity);
      if (getSeverityLevel(risk.severity) > getSeverityLevel(cat.highestSeverity)) {
        cat.highestSeverity = risk.severity;
      }
    }
  }

  const result: Record<RiskCategory, { count: number; highestSeverity: RiskSeverity; averageScore: number }> = {} as any;
  for (const [category, data] of Object.entries(summary)) {
    result[category as RiskCategory] = {
      count: data.count,
      highestSeverity: data.highestSeverity,
      averageScore: data.count > 0 ? data.totalScore / data.count : 0,
    };
  }

  return result;
}

/**
 * Calculate overall risk score
 */
function calculateOverallRiskScore(risks: RiskFinding[]): number {
  if (risks.length === 0) return 100;

  const maxScore = 100;
  let penalty = 0;

  for (const risk of risks) {
    const severityPenalty: Record<RiskSeverity, number> = {
      low: 2,
      medium: 5,
      high: 15,
      critical: 30,
    };
    penalty += severityPenalty[risk.severity];
  }

  return Math.max(0, maxScore - penalty);
}

/**
 * Convert score to grade
 */
function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Detect changes between documents
 */
function detectChanges(
  baseClauses: ExtractedClause[],
  compareClauses: ExtractedClause[],
  alignments: import('./types.js').ClauseAlignment[]
): import('./types.js').ContractChange[] {
  const changes: import('./types.js').ContractChange[] = [];
  const alignedCompare = new Set(alignments.map(a => a.compareClauseId));

  for (const alignment of alignments) {
    const baseClause = baseClauses.find(c => c.id === alignment.baseClauseId);
    const compareClause = compareClauses.find(c => c.id === alignment.compareClauseId);

    if (alignment.alignmentType === 'no_match') {
      changes.push({
        type: 'removed',
        clauseType: baseClause?.type,
        baseSection: baseClause?.section,
        baseText: baseClause?.text,
        significance: 0.8,
        impact: 'requires_review',
        explanation: 'Clause exists in base but not in comparison document',
      });
    } else if (alignment.alignmentType !== 'exact') {
      changes.push({
        type: 'modified',
        clauseType: baseClause?.type,
        baseSection: baseClause?.section,
        compareSection: compareClause?.section,
        baseText: baseClause?.text,
        compareText: compareClause?.text,
        significance: 1 - alignment.similarity,
        impact: 'requires_review',
        explanation: `Clause modified (${(alignment.similarity * 100).toFixed(1)}% similarity)`,
      });
    }
  }

  // Find added clauses
  for (const clause of compareClauses) {
    if (!alignedCompare.has(clause.id)) {
      changes.push({
        type: 'added',
        clauseType: clause.type,
        compareSection: clause.section,
        compareText: clause.text,
        significance: 0.7,
        impact: 'requires_review',
        explanation: 'New clause in comparison document',
      });
    }
  }

  return changes;
}

/**
 * Generate redline markup
 */
function generateRedlineMarkup(
  baseDocument: string,
  changes: import('./types.js').ContractChange[]
): string {
  // Simplified redline generation
  let markup = baseDocument;

  for (const change of changes) {
    if (change.type === 'removed' && change.baseText) {
      markup = markup.replace(
        change.baseText,
        `<del style="color:red">${change.baseText}</del>`
      );
    } else if (change.type === 'added' && change.compareText) {
      markup += `\n<ins style="color:green">${change.compareText}</ins>`;
    }
  }

  return markup;
}

/**
 * Extract obligations from document
 */
async function extractObligations(
  document: string,
  types: import('./types.js').ObligationType[] | undefined
): Promise<Obligation[]> {
  const obligations: Obligation[] = [];

  // Obligation patterns
  const obligationPatterns: Record<string, { pattern: RegExp; type: import('./types.js').ObligationType }[]> = {
    payment: [
      { pattern: /shall\s+pay/i, type: 'payment' },
      { pattern: /payment\s+due/i, type: 'payment' },
    ],
    delivery: [
      { pattern: /shall\s+deliver/i, type: 'delivery' },
      { pattern: /delivery\s+date/i, type: 'delivery' },
    ],
    notification: [
      { pattern: /shall\s+notify/i, type: 'notification' },
      { pattern: /provide\s+notice/i, type: 'notification' },
    ],
    approval: [
      { pattern: /shall\s+approve/i, type: 'approval' },
      { pattern: /written\s+approval/i, type: 'approval' },
    ],
    compliance: [
      { pattern: /shall\s+comply/i, type: 'compliance' },
      { pattern: /in\s+compliance\s+with/i, type: 'compliance' },
    ],
  };

  const sentences = document.split(/[.!?]+/);

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]?.trim() ?? '';
    if (!sentence) continue;

    for (const [, patterns] of Object.entries(obligationPatterns)) {
      for (const { pattern, type } of patterns) {
        if (types && !types.includes(type)) continue;

        if (pattern.test(sentence)) {
          obligations.push({
            id: `obl-${obligations.length + 1}`,
            type,
            party: extractParty(sentence),
            description: sentence,
            dependsOn: [],
            blocks: [],
            clauseIds: [],
            status: 'pending',
            priority: 'medium',
          });
          break;
        }
      }
    }
  }

  return obligations;
}

/**
 * Extract party from sentence
 */
function extractParty(sentence: string): string {
  const partyPatterns = [
    /the\s+(buyer|seller|licensor|licensee|employer|employee)/i,
    /(party\s+a|party\s+b)/i,
    /the\s+company/i,
  ];

  for (const pattern of partyPatterns) {
    const match = sentence.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return 'Unknown Party';
}

/**
 * Filter obligations by timeframe
 */
function filterByTimeframe(
  obligations: Obligation[],
  timeframe: string
): Obligation[] {
  // Parse ISO duration or date range
  // Simplified implementation
  return obligations;
}

/**
 * Build timeline from obligations
 */
function buildTimeline(
  obligations: Obligation[]
): Array<{ date: Date; obligations: string[]; isMilestone: boolean }> {
  const timeline: Map<string, { date: Date; obligations: string[]; isMilestone: boolean }> = new Map();

  for (const obligation of obligations) {
    if (obligation.dueDate) {
      const dateKey = obligation.dueDate.toISOString().split('T')[0] ?? '';
      const existing = timeline.get(dateKey);

      if (existing) {
        existing.obligations.push(obligation.id);
      } else {
        timeline.set(dateKey, {
          date: obligation.dueDate,
          obligations: [obligation.id],
          isMilestone: obligation.priority === 'critical',
        });
      }
    }
  }

  return Array.from(timeline.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Parse playbook from string (JSON or ID)
 */
function parsePlaybook(playbookInput: string): import('./types.js').Playbook {
  try {
    const parsed = JSON.parse(playbookInput);
    return parsed as import('./types.js').Playbook;
  } catch {
    // Return a default playbook
    return {
      id: playbookInput,
      name: 'Default Playbook',
      contractType: 'General',
      jurisdiction: 'US',
      partyRole: 'buyer',
      updatedAt: new Date(),
      version: '1.0.0',
      positions: [],
    };
  }
}

/**
 * Match clauses against playbook
 */
async function matchAgainstPlaybook(
  clauses: ExtractedClause[],
  playbook: import('./types.js').Playbook,
  strictness: import('./types.js').PlaybookStrictness,
  suggestAlternatives: boolean,
  attention: IAttentionBridge
): Promise<PlaybookMatch[]> {
  const matches: PlaybookMatch[] = [];

  for (const clause of clauses) {
    const position = playbook.positions.find(p => p.clauseType === clause.type);

    if (!position) {
      matches.push({
        clauseId: clause.id,
        position: {
          clauseType: clause.type,
          preferredLanguage: '',
          acceptableVariations: [],
          redLines: [],
          fallbackPositions: [],
          negotiationNotes: '',
          businessJustification: '',
        },
        status: 'no_match',
        preferredSimilarity: 0,
        recommendation: 'No playbook position defined for this clause type',
      });
      continue;
    }

    // Check against preferred language
    const preferredSimilarity = calculateTextSimilarity(clause.text, position.preferredLanguage);

    // Determine status based on similarity and strictness
    let status: PlaybookMatch['status'];
    const thresholds = {
      strict: { preferred: 0.95, acceptable: 0.9, fallback: 0.8 },
      moderate: { preferred: 0.85, acceptable: 0.75, fallback: 0.6 },
      flexible: { preferred: 0.7, acceptable: 0.6, fallback: 0.4 },
    };

    const threshold = thresholds[strictness];

    // Check red lines first
    const violatesRedLine = position.redLines.some(rl =>
      clause.text.toLowerCase().includes(rl.toLowerCase())
    );

    if (violatesRedLine) {
      status = 'violates_redline';
    } else if (preferredSimilarity >= threshold.preferred) {
      status = 'matches_preferred';
    } else if (position.acceptableVariations.some(v =>
      calculateTextSimilarity(clause.text, v) >= threshold.acceptable
    )) {
      status = 'matches_acceptable';
    } else if (position.fallbackPositions.length > 0) {
      status = 'requires_fallback';
    } else {
      status = 'no_match';
    }

    matches.push({
      clauseId: clause.id,
      position,
      status,
      preferredSimilarity,
      suggestedAlternative: suggestAlternatives ? position.preferredLanguage : undefined,
      recommendation: generateRecommendation(status, clause.type),
    });
  }

  return matches;
}

/**
 * Calculate text similarity (simplified)
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;

  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Generate recommendation based on match status
 */
function generateRecommendation(status: PlaybookMatch['status'], clauseType: ClauseType): string {
  const recommendations: Record<PlaybookMatch['status'], string> = {
    matches_preferred: 'Clause matches preferred playbook position. No action required.',
    matches_acceptable: 'Clause is within acceptable variation. Consider negotiating closer to preferred position.',
    requires_fallback: 'Clause requires fallback position. Review fallback options and negotiate accordingly.',
    violates_redline: 'CRITICAL: Clause violates red line. This must be negotiated before signing.',
    no_match: 'No playbook position available. Conduct independent review of this clause.',
  };

  return recommendations[status];
}

/**
 * Build negotiation priorities
 */
function buildNegotiationPriorities(
  matches: PlaybookMatch[],
  prioritizedTypes: ClauseType[] | undefined
): Array<{ clauseId: string; priority: number; reason: string }> {
  const priorities: Array<{ clauseId: string; priority: number; reason: string }> = [];

  const statusPriority: Record<PlaybookMatch['status'], number> = {
    violates_redline: 100,
    requires_fallback: 70,
    no_match: 50,
    matches_acceptable: 30,
    matches_preferred: 10,
  };

  for (const match of matches) {
    let priority = statusPriority[match.status];

    // Boost priority for prioritized clause types
    if (prioritizedTypes?.includes(match.position.clauseType)) {
      priority += 20;
    }

    priorities.push({
      clauseId: match.clauseId,
      priority,
      reason: match.recommendation,
    });
  }

  return priorities.sort((a, b) => b.priority - a.priority);
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All Legal Contracts MCP Tools
 */
export const legalContractsTools: MCPTool[] = [
  clauseExtractTool as unknown as MCPTool,
  riskAssessTool as unknown as MCPTool,
  contractCompareTool as unknown as MCPTool,
  obligationTrackTool as unknown as MCPTool,
  playbookMatchTool as unknown as MCPTool,
];

/**
 * Tool name to handler map
 */
export const toolHandlers = new Map<string, MCPTool['handler']>([
  ['legal/clause-extract', clauseExtractTool.handler as MCPTool['handler']],
  ['legal/risk-assess', riskAssessTool.handler as MCPTool['handler']],
  ['legal/contract-compare', contractCompareTool.handler as MCPTool['handler']],
  ['legal/obligation-track', obligationTrackTool.handler as MCPTool['handler']],
  ['legal/playbook-match', playbookMatchTool.handler as MCPTool['handler']],
]);

/**
 * Create tool context with bridges
 */
export function createToolContext(): ToolContext {
  const store = new Map<string, unknown>();

  return {
    get: <T>(key: string) => store.get(key) as T | undefined,
    set: <T>(key: string, value: T) => { store.set(key, value); },
    bridges: {
      attention: createAttentionBridge(),
      dag: createDAGBridge(),
    },
  };
}

export default legalContractsTools;
