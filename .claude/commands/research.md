---
description: Deep research with parallel subagents and automatic citations
argument-hint: "<question to investigate>"
allowed-tools: Task, Read, Write, Edit, Grep, Glob
category: workflow
model: sonnet
---

# 🔬 Research Command

Conduct deep, parallel research on any topic using multiple specialized subagents.

## Research Query
$ARGUMENTS

## Research Process

### Phase 1: Query Classification (CRITICAL FIRST STEP)

**PRIMARY DECISION: Classify the query type to determine research strategy**

#### Query Types:

1. **BREADTH-FIRST QUERIES** (Wide exploration)
   - Characteristics: Multiple independent aspects, survey questions, comparisons
   - Examples: "Compare all major cloud providers", "List board members of S&P 500 tech companies"
   - Strategy: 5-10 parallel subagents, each exploring different aspects
   - Each subagent gets narrow, specific tasks

2. **DEPTH-FIRST QUERIES** (Deep investigation)
   - Characteristics: Single topic requiring thorough understanding, technical deep-dives
   - Examples: "How does transformer architecture work?", "Explain quantum entanglement"
   - Strategy: 2-4 subagents with overlapping but complementary angles
   - Each subagent explores the same topic from different perspectives

3. **SIMPLE FACTUAL QUERIES** (Quick lookup)
   - Characteristics: Single fact, recent event, specific data point
   - Examples: "When was GPT-4 released?", "Current CEO of Microsoft"
   - Strategy: 1-2 subagents for verification
   - Focus on authoritative sources

#### After Classification, Determine:
- **Resource Allocation**: Based on query type (1-10 subagents)
- **Search Domains**: Academic, technical, news, or general web
- **Depth vs Coverage**: How deep vs how wide to search

### Phase 2: Parallel Research Execution

Based on the query classification, spawn appropriate research subagents IN A SINGLE MESSAGE for true parallelization.

**CRITICAL: Parallel Execution Pattern**
Use multiple Task tool invocations in ONE message, ALL with subagent_type="research-expert".

**MANDATORY: Start Each Task Prompt with Mode Indicator**
You MUST begin each task prompt with one of these trigger phrases to control subagent behavior:

- **Quick Verification (3-5 searches)**: Start with "Quick check:", "Verify:", or "Confirm:"
- **Focused Investigation (5-10 searches)**: Start with "Investigate:", "Explore:", or "Find details about:"
- **Deep Research (10-15 searches)**: Start with "Deep dive:", "Comprehensive:", "Thorough research:", or "Exhaustive:"

Example Task invocations:
```
Task(description="Academic research", prompt="Deep dive: Find all academic papers on transformer architectures from 2017-2024", subagent_type="research-expert")
Task(description="Quick fact check", prompt="Quick check: Verify the release date of GPT-4", subagent_type="research-expert")
Task(description="Company research", prompt="Investigate: OpenAI's current product offerings and pricing", subagent_type="research-expert")
```

This ensures all subagents work simultaneously AND understand the expected search depth through these trigger words.

**Filesystem Artifact Pattern**:
Each subagent saves full report to `/tmp/research_[timestamp]_[topic].md` and returns only:
- File path to the full report
- Brief 2-3 sentence summary
- Key topics covered
- Number of sources found

### Phase 3: Synthesis from Filesystem Artifacts

**CRITICAL: Subagents Return File References, Not Full Reports**

Each subagent will:
1. Write their full report to `/tmp/research_*.md`
2. Return only a summary with the file path

Synthesis Process:
1. **Collect File References**: Gather all `/tmp/research_*.md` paths from subagent responses
2. **Read Reports**: Use Read tool to access each research artifact
3. **Merge Findings**:
   - Identify common themes across reports
   - Deduplicate overlapping information
   - Preserve unique insights from each report
4. **Consolidate Sources**:
   - Merge all cited sources
   - Remove duplicate URLs
   - Organize by relevance and credibility
5. **Write Final Report**: Save synthesized report to `/tmp/research_final_[timestamp].md`

### Phase 4: Final Report Structure

The synthesized report (written to file) must include:

# Research Report: [Query Topic]

## Executive Summary
[3-5 paragraph overview synthesizing all findings]

## Key Findings
1. **[Major Finding 1]** - Synthesized from multiple subagent reports
2. **[Major Finding 2]** - Cross-referenced and verified
3. **[Major Finding 3]** - With supporting evidence from multiple sources

## Detailed Analysis

### [Theme 1 - Merged from Multiple Reports]
[Comprehensive synthesis integrating all relevant subagent findings]

### [Theme 2 - Merged from Multiple Reports]
[Comprehensive synthesis integrating all relevant subagent findings]

## Sources & References
[Consolidated list of all sources from all subagents, organized by type]

## Research Methodology
- Query Classification: [Breadth/Depth/Simple]
- Subagents Deployed: [Number and focus areas]
- Total Sources Analyzed: [Combined count]
- Research Artifacts: [List of all /tmp/research_*.md files]

## Research Principles

### Quality Heuristics
- Start with broad searches, then narrow based on findings
- Prefer authoritative sources (academic papers, official docs, primary sources)
- Cross-reference claims across multiple sources
- Identify gaps and contradictions in available information

### Effort Scaling by Query Type
- **Simple Factual**: 1-2 subagents, 3-5 searches each (verification focus)
- **Depth-First**: 2-4 subagents, 10-15 searches each (deep understanding)
- **Breadth-First**: 5-10 subagents, 5-10 searches each (wide coverage)
- **Maximum Complexity**: 10 subagents (Claude Code limit)

### Parallelization Strategy
- Spawn all initial subagents simultaneously for speed
- Each subagent performs multiple parallel searches
- 90% time reduction compared to sequential searching
- Independent exploration prevents bias and groupthink

## Execution

**Step 1: CLASSIFY THE QUERY** (Breadth-first, Depth-first, or Simple factual)

**Step 2: LAUNCH APPROPRIATE SUBAGENT CONFIGURATION**

### Example Execution Patterns:

**BREADTH-FIRST Example:** "Compare AI capabilities of Google, OpenAI, and Anthropic"
- Classification: Breadth-first (multiple independent comparisons)
- Launch 6 subagents in ONE message with focused investigation mode:
  - Task 1: "Investigate: Google's current AI products, models, and capabilities"
  - Task 2: "Investigate: OpenAI's current AI products, models, and capabilities"
  - Task 3: "Investigate: Anthropic's current AI products, models, and capabilities"
  - Task 4: "Explore: Performance benchmarks comparing models from all three companies"
  - Task 5: "Investigate: Business models, pricing, and market positioning for each"
  - Task 6: "Quick check: Latest announcements and news from each company (2024)"

**DEPTH-FIRST Example:** "How do transformer models achieve attention?"
- Classification: Depth-first (single topic, deep understanding)
- Launch 3 subagents in ONE message with deep research mode:
  - Task 1: "Deep dive: Mathematical foundations and formulas behind attention mechanisms"
  - Task 2: "Comprehensive: Visual diagrams and step-by-step walkthrough of self-attention"
  - Task 3: "Thorough research: Seminal papers including 'Attention is All You Need' and subsequent improvements"

**SIMPLE FACTUAL Example:** "When was Claude 3 released?"
- Classification: Simple factual query
- Launch 1 subagent with verification mode:
  - Task 1: "Quick check: Verify the official release date of Claude 3 from Anthropic"

Each subagent works independently, writes findings to `/tmp/research_*.md`, and returns a lightweight summary.

### Step 3: SYNTHESIZE AND DELIVER

After all subagents complete:
1. Read all research artifact files from `/tmp/research_*.md`
2. Synthesize findings into comprehensive report
3. Write final report to `/tmp/research_final_[timestamp].md`
4. Provide user with:
   - Executive summary (displayed directly)
   - Path to full report file
   - Key insights and recommendations

**Benefits of Filesystem Artifacts**:
- 90% reduction in token usage (passing paths vs full reports)
- No information loss during synthesis
- Preserves formatting and structure
- Enables selective reading of sections
- Allows user to access individual subagent reports if needed

Now executing query classification and multi-agent research...