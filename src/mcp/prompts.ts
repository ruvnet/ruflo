/**
 * MCP Prompts Management for Agent Coordination Templates
 * Implementation of MCP Prompts specification for template-driven agent coordination
 */

import type { MCPPrompt, MCPContext } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';
import { MCPError } from '../utils/errors.js';
import { EventEmitter } from 'node:events';

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  enum?: string[];
  default?: unknown;
}

export interface PromptTemplate {
  name: string;
  description: string;
  template: string;
  arguments: PromptArgument[];
  category: string;
  tags: string[];
  version: string;
  examples?: Array<{
    name: string;
    description: string;
    arguments: Record<string, unknown>;
    expectedOutput: string;
  }>;
}

export interface PromptCompletionRequest {
  promptName: string;
  argumentName: string;
  currentValue?: string;
  context?: Record<string, unknown>;
}

export interface PromptCompletionResult {
  suggestions: Array<{
    value: string;
    description?: string;
    category?: string;
  }>;
  isComplete: boolean;
}

/**
 * MCP Prompts Registry for template-driven agent coordination
 */
export class PromptsRegistry extends EventEmitter {
  private prompts = new Map<string, PromptTemplate>();
  private completionHandlers = new Map<string, (request: PromptCompletionRequest) => Promise<PromptCompletionResult>>();

  constructor(private logger: ILogger) {
    super();
    this.initializeCoordinationPrompts();
  }

  /**
   * Register a prompt template
   */
  registerPrompt(prompt: PromptTemplate): void {
    if (this.prompts.has(prompt.name)) {
      throw new MCPError(`Prompt already registered: ${prompt.name}`);
    }

    this.validatePromptTemplate(prompt);
    this.prompts.set(prompt.name, prompt);
    
    this.logger.debug('Prompt template registered', { name: prompt.name, category: prompt.category });
    this.emit('promptRegistered', { name: prompt.name, template: prompt });
  }

  /**
   * Get all available prompts
   */
  listPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values()).map(template => ({
      name: template.name,
      description: template.description,
      arguments: template.arguments.map(arg => ({
        name: arg.name,
        description: arg.description,
        required: arg.required
      }))
    }));
  }

  /**
   * Get a specific prompt template
   */
  getPrompt(name: string): PromptTemplate | undefined {
    return this.prompts.get(name);
  }

  /**
   * Get prompt by name and populate with arguments
   */
  async getPromptWithArguments(name: string, args: Record<string, unknown>): Promise<{
    name: string;
    description: string;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: { type: 'text'; text: string };
    }>;
  }> {
    const template = this.prompts.get(name);
    if (!template) {
      throw new MCPError(`Prompt not found: ${name}`);
    }

    // Validate required arguments
    const missing = template.arguments
      .filter(arg => arg.required && !(arg.name in args))
      .map(arg => arg.name);

    if (missing.length > 0) {
      throw new MCPError(`Missing required arguments: ${missing.join(', ')}`);
    }

    // Apply defaults for missing optional arguments
    const finalArguments = { ...args };
    for (const arg of template.arguments) {
      if (!(arg.name in finalArguments) && arg.default !== undefined) {
        finalArguments[arg.name] = arg.default;
      }
    }

    // Populate template
    let populatedTemplate = template.template;
    for (const [key, value] of Object.entries(finalArguments)) {
      const placeholder = `{${key}}`;
      populatedTemplate = populatedTemplate.replace(new RegExp(placeholder, 'g'), String(value));
    }

    return {
      name: template.name,
      description: template.description,
      messages: [{
        role: 'user',
        content: { type: 'text', text: populatedTemplate }
      }]
    };
  }

  /**
   * Get argument completions for interactive prompts
   */
  async getArgumentCompletions(request: PromptCompletionRequest): Promise<PromptCompletionResult> {
    const template = this.prompts.get(request.promptName);
    if (!template) {
      throw new MCPError(`Prompt not found: ${request.promptName}`);
    }

    const argument = template.arguments.find(arg => arg.name === request.argumentName);
    if (!argument) {
      throw new MCPError(`Argument not found: ${request.argumentName}`);
    }

    // Check for custom completion handler
    const handlerKey = `${request.promptName}.${request.argumentName}`;
    const customHandler = this.completionHandlers.get(handlerKey);
    if (customHandler) {
      return await customHandler(request);
    }

    // Handle enum-based completions
    if (argument.enum) {
      return {
        suggestions: argument.enum.map(value => ({
          value,
          description: `Option: ${value}`,
          category: 'enum'
        })),
        isComplete: true
      };
    }

    // Default completions based on argument type
    return await this.getDefaultCompletions(argument, request);
  }

  /**
   * Register completion handler for dynamic argument completion
   */
  registerCompletionHandler(
    promptName: string, 
    argumentName: string, 
    handler: (request: PromptCompletionRequest) => Promise<PromptCompletionResult>
  ): void {
    const key = `${promptName}.${argumentName}`;
    this.completionHandlers.set(key, handler);
    this.logger.debug('Completion handler registered', { promptName, argumentName });
  }

  /**
   * Validate prompt template structure
   */
  private validatePromptTemplate(template: PromptTemplate): void {
    if (!template.name || typeof template.name !== 'string') {
      throw new MCPError('Prompt name must be a non-empty string');
    }

    if (!template.description || typeof template.description !== 'string') {
      throw new MCPError('Prompt description must be a non-empty string');
    }

    if (!template.template || typeof template.template !== 'string') {
      throw new MCPError('Prompt template must be a non-empty string');
    }

    if (!Array.isArray(template.arguments)) {
      throw new MCPError('Prompt arguments must be an array');
    }

    // Validate each argument
    for (const arg of template.arguments) {
      if (!arg.name || typeof arg.name !== 'string') {
        throw new MCPError('Argument name must be a non-empty string');
      }
    }
  }

  /**
   * Get default completions based on argument type and context
   */
  private async getDefaultCompletions(
    argument: PromptArgument, 
    request: PromptCompletionRequest
  ): Promise<PromptCompletionResult> {
    const suggestions: Array<{ value: string; description?: string; category?: string }> = [];

    switch (request.argumentName) {
      case 'agent_types':
      case 'coordination_mode':
      case 'quality_level':
        return await this.getAgentCoordinationCompletions(request.argumentName);

      case 'knowledge_domains':
        return await this.getKnowledgeDomainsFromMemory();

      default:
        // Type-based defaults
        switch (argument.type) {
          case 'string':
            suggestions.push(
              { value: 'example_value', description: 'Example string value', category: 'template' }
            );
            break;
          case 'number':
            suggestions.push(
              { value: '1', description: 'Example number', category: 'template' },
              { value: '5', description: 'Medium value', category: 'template' },
              { value: '10', description: 'High value', category: 'template' }
            );
            break;
          case 'boolean':
            suggestions.push(
              { value: 'true', description: 'Enable option', category: 'boolean' },
              { value: 'false', description: 'Disable option', category: 'boolean' }
            );
            break;
        }
    }

    return {
      suggestions,
      isComplete: suggestions.length > 0
    };
  }

  /**
   * Get agent coordination specific completions
   */
  private async getAgentCoordinationCompletions(argumentName: string): Promise<PromptCompletionResult> {
    const completions: Record<string, Array<{ value: string; description?: string; category?: string }>> = {
      agent_types: [
        { value: 'researcher', description: 'Information gathering and analysis agent', category: 'agent' },
        { value: 'coder', description: 'Code implementation and development agent', category: 'agent' },
        { value: 'analyst', description: 'Data analysis and insights agent', category: 'agent' },
        { value: 'reviewer', description: 'Quality assurance and review agent', category: 'agent' },
        { value: 'coordinator', description: 'Task coordination and management agent', category: 'agent' },
        { value: 'architect', description: 'System design and architecture agent', category: 'agent' },
        { value: 'tester', description: 'Testing and validation agent', category: 'agent' }
      ],
      coordination_mode: [
        { value: 'parallel', description: 'Agents work simultaneously on independent tasks', category: 'mode' },
        { value: 'sequential', description: 'Agents work in ordered sequence', category: 'mode' },
        { value: 'hierarchical', description: 'Agents work in hierarchical structure', category: 'mode' },
        { value: 'mesh', description: 'Agents work in interconnected mesh network', category: 'mode' },
        { value: 'hybrid', description: 'Combination of coordination modes', category: 'mode' }
      ],
      quality_level: [
        { value: 'rapid', description: 'Fast iteration with basic quality checks', category: 'quality' },
        { value: 'standard', description: 'Balanced speed and quality', category: 'quality' },
        { value: 'thorough', description: 'Comprehensive quality validation', category: 'quality' },
        { value: 'premium', description: 'Maximum quality with extensive verification', category: 'quality' }
      ]
    };

    return {
      suggestions: completions[argumentName] || [],
      isComplete: true
    };
  }

  /**
   * Get knowledge domains from memory system (stub for memory integration)
   */
  private async getKnowledgeDomainsFromMemory(): Promise<PromptCompletionResult> {
    // This would integrate with the enhanced memory system to get actual domains
    const mockDomains = [
      { value: 'web_development', description: 'Frontend and backend web technologies', category: 'domain' },
      { value: 'data_science', description: 'Data analysis and machine learning', category: 'domain' },
      { value: 'system_architecture', description: 'Software system design patterns', category: 'domain' },
      { value: 'devops', description: 'Development operations and CI/CD', category: 'domain' },
      { value: 'security', description: 'Cybersecurity and secure coding', category: 'domain' }
    ];

    return {
      suggestions: mockDomains,
      isComplete: true
    };
  }

  /**
   * Initialize built-in coordination prompt templates
   */
  private initializeCoordinationPrompts(): void {
    // Swarm Coordination Template
    this.registerPrompt({
      name: 'swarm_coordination',
      description: 'Template for multi-agent task coordination with intelligent team assembly',
      category: 'coordination',
      tags: ['swarm', 'coordination', 'multi-agent', 'team'],
      version: '1.0.0',
      template: `Coordinate {agent_count} agents for {task_type} using {coordination_mode} coordination:

🎯 Task: {task_description}
👥 Team Structure: {coordination_mode} with {agent_count} agents
📊 Success Criteria: {success_metrics}
⚡ Quality Level: {quality_threshold}

🤖 Agent Assignments:
{agent_assignments}

🔄 Coordination Protocol:
1. 🔍 Initial knowledge discovery via memory://search/{domain}
2. ⚡ {coordination_mode} execution with smart handoffs
3. ✅ Quality gates at {quality_checkpoints}
4. 🧬 Final synthesis and memory integration

🎯 Expected Outcome: {expected_deliverable}

📋 Memory Integration:
- Store decisions in memory://decisions/{task_type}
- Track progress in memory://progress/{coordination_session_id}
- Update knowledge graph with insights

🚀 Execution Strategy:
Use BatchTool for all operations to ensure parallel efficiency and maintain swarm coherence.`,
      arguments: [
        { name: 'agent_count', description: 'Number of agents in the swarm', required: true, type: 'number', default: 3 },
        { name: 'task_type', description: 'Type of task being coordinated', required: true, type: 'string' },
        { name: 'task_description', description: 'Detailed description of the task', required: true, type: 'string' },
        { name: 'coordination_mode', description: 'Mode of agent coordination', required: true, type: 'string', enum: ['parallel', 'sequential', 'hierarchical', 'mesh', 'hybrid'] },
        { name: 'success_metrics', description: 'Criteria for task success', required: true, type: 'string' },
        { name: 'quality_threshold', description: 'Quality level required', required: true, type: 'string', enum: ['rapid', 'standard', 'thorough', 'premium'] },
        { name: 'agent_assignments', description: 'Specific agent role assignments', required: false, type: 'string', default: 'Auto-assign based on task requirements' },
        { name: 'domain', description: 'Knowledge domain for memory search', required: false, type: 'string', default: 'general' },
        { name: 'quality_checkpoints', description: 'Quality checkpoint stages', required: false, type: 'string', default: 'design, implementation, testing' },
        { name: 'expected_deliverable', description: 'Expected final output', required: true, type: 'string' },
        { name: 'coordination_session_id', description: 'Unique session identifier', required: false, type: 'string', default: 'auto-generated' }
      ],
      examples: [{
        name: 'Web Development Project',
        description: 'Coordinate agents for building a REST API',
        arguments: {
          agent_count: 4,
          task_type: 'web_development',
          task_description: 'Build a secure REST API with authentication',
          coordination_mode: 'hierarchical',
          success_metrics: 'API passes all tests, documented, deployed',
          quality_threshold: 'thorough',
          expected_deliverable: 'Production-ready REST API with documentation'
        },
        expectedOutput: 'Populated template with specific web development coordination plan'
      }]
    });

    // Team Assembly Template
    this.registerPrompt({
      name: 'team_assembly',
      description: 'Intelligent selection and assembly of optimal agent teams',
      category: 'team_management',
      tags: ['team', 'assembly', 'selection', 'optimization'],
      version: '1.0.0',
      template: `🎯 Team Assembly for {project_type}

📋 Project Requirements:
- Domain: {domain}
- Complexity: {complexity_level}
- Timeline: {timeline}
- Quality Requirements: {quality_requirements}

🤖 Recommended Team Composition:
{team_composition}

👥 Agent Selection Criteria:
- Technical skills: {required_skills}
- Experience level: {experience_level}
- Collaboration style: {collaboration_style}

🔄 Team Dynamics:
- Communication patterns: {communication_patterns}
- Decision-making process: {decision_process}
- Conflict resolution: {conflict_resolution}

📊 Success Metrics:
- Team performance: {performance_metrics}
- Delivery quality: {quality_metrics}
- Timeline adherence: {timeline_metrics}

🚀 Initialization Steps:
1. Spawn agents with specified roles
2. Establish communication protocols
3. Initialize shared memory spaces
4. Define task distribution strategy`,
      arguments: [
        { name: 'project_type', description: 'Type of project requiring team assembly', required: true, type: 'string' },
        { name: 'domain', description: 'Technical domain or area of expertise', required: true, type: 'string' },
        { name: 'complexity_level', description: 'Project complexity level', required: true, type: 'string', enum: ['simple', 'moderate', 'complex', 'expert'] },
        { name: 'timeline', description: 'Project timeline or deadline', required: true, type: 'string' },
        { name: 'quality_requirements', description: 'Quality standards and requirements', required: true, type: 'string' },
        { name: 'team_composition', description: 'Specific team structure recommendation', required: false, type: 'string', default: 'Auto-generate based on requirements' },
        { name: 'required_skills', description: 'Required technical skills', required: true, type: 'string' },
        { name: 'experience_level', description: 'Required experience level', required: true, type: 'string', enum: ['junior', 'mid', 'senior', 'expert'] },
        { name: 'collaboration_style', description: 'Preferred collaboration approach', required: false, type: 'string', default: 'collaborative' },
        { name: 'communication_patterns', description: 'Team communication structure', required: false, type: 'string', default: 'peer-to-peer with coordinator' },
        { name: 'decision_process', description: 'How decisions are made', required: false, type: 'string', default: 'consensus with lead approval' },
        { name: 'conflict_resolution', description: 'Conflict resolution strategy', required: false, type: 'string', default: 'escalation to coordinator' },
        { name: 'performance_metrics', description: 'Team performance measurement', required: false, type: 'string', default: 'task completion rate, code quality' },
        { name: 'quality_metrics', description: 'Quality measurement criteria', required: false, type: 'string', default: 'test coverage, review scores' },
        { name: 'timeline_metrics', description: 'Timeline tracking metrics', required: false, type: 'string', default: 'milestone completion rate' }
      ]
    });

    // Quality Gates Template
    this.registerPrompt({
      name: 'quality_gates',
      description: 'Collaborative quality review and validation processes',
      category: 'quality_assurance',
      tags: ['quality', 'review', 'validation', 'gates'],
      version: '1.0.0',
      template: `🔍 Quality Gates for {project_name}

🎯 Quality Standards:
- Coverage Requirements: {coverage_requirements}
- Performance Thresholds: {performance_thresholds}
- Security Standards: {security_standards}
- Documentation Level: {documentation_level}

✅ Gate Sequence:
{gate_sequence}

👥 Review Process:
- Primary Reviewer: {primary_reviewer_type}
- Secondary Reviews: {secondary_reviewers}
- Approval Authority: {approval_authority}

📊 Quality Metrics:
- Code Quality: {code_quality_metrics}
- Test Coverage: {test_coverage_target}%
- Performance: {performance_targets}
- Security Score: {security_score_target}

🚫 Failure Actions:
- Automatic rollback: {auto_rollback}
- Notification escalation: {escalation_chain}
- Remediation process: {remediation_process}

🔄 Continuous Monitoring:
- Real-time metrics: {monitoring_metrics}
- Alert thresholds: {alert_thresholds}
- Feedback loops: {feedback_mechanisms}`,
      arguments: [
        { name: 'project_name', description: 'Name of the project under review', required: true, type: 'string' },
        { name: 'coverage_requirements', description: 'Required test coverage levels', required: true, type: 'string' },
        { name: 'performance_thresholds', description: 'Performance benchmarks', required: true, type: 'string' },
        { name: 'security_standards', description: 'Security compliance requirements', required: true, type: 'string' },
        { name: 'documentation_level', description: 'Required documentation completeness', required: true, type: 'string', enum: ['basic', 'standard', 'comprehensive', 'enterprise'] },
        { name: 'gate_sequence', description: 'Ordered sequence of quality gates', required: false, type: 'string', default: '1. Unit Tests → 2. Integration Tests → 3. Security Scan → 4. Performance Test → 5. Code Review' },
        { name: 'primary_reviewer_type', description: 'Type of primary reviewer agent', required: false, type: 'string', default: 'senior_reviewer' },
        { name: 'secondary_reviewers', description: 'Additional reviewer types', required: false, type: 'string', default: 'domain_expert, security_specialist' },
        { name: 'approval_authority', description: 'Final approval authority', required: false, type: 'string', default: 'architect' },
        { name: 'code_quality_metrics', description: 'Code quality measurement criteria', required: false, type: 'string', default: 'complexity, maintainability, readability' },
        { name: 'test_coverage_target', description: 'Target test coverage percentage', required: false, type: 'number', default: 85 },
        { name: 'performance_targets', description: 'Performance target specifications', required: false, type: 'string', default: 'response time < 200ms, throughput > 1000 rps' },
        { name: 'security_score_target', description: 'Target security score', required: false, type: 'string', default: 'A+' },
        { name: 'auto_rollback', description: 'Automatic rollback on failure', required: false, type: 'boolean', default: true },
        { name: 'escalation_chain', description: 'Escalation notification chain', required: false, type: 'string', default: 'team_lead → project_manager → department_head' },
        { name: 'remediation_process', description: 'Steps for issue remediation', required: false, type: 'string', default: 'identify → assign → fix → retest → approve' },
        { name: 'monitoring_metrics', description: 'Real-time monitoring targets', required: false, type: 'string', default: 'error_rate, response_time, resource_usage' },
        { name: 'alert_thresholds', description: 'Alert trigger thresholds', required: false, type: 'string', default: 'error_rate > 1%, response_time > 500ms' },
        { name: 'feedback_mechanisms', description: 'Feedback collection methods', required: false, type: 'string', default: 'automated_reports, peer_reviews, user_feedback' }
      ]
    });

    // Knowledge Synthesis Template
    this.registerPrompt({
      name: 'knowledge_synthesis',
      description: 'Cross-agent knowledge building and synthesis processes',
      category: 'knowledge_management',
      tags: ['knowledge', 'synthesis', 'learning', 'memory'],
      version: '1.0.0',
      template: `🧠 Knowledge Synthesis Session for {domain}

🎯 Synthesis Objectives:
- Primary Goal: {synthesis_goal}
- Knowledge Domains: {knowledge_domains}
- Integration Target: {integration_target}
- Output Format: {output_format}

👥 Contributing Agents:
{contributing_agents}

🔍 Knowledge Sources:
- Memory Systems: {memory_sources}
- External Data: {external_sources}
- Agent Experiences: {agent_experiences}
- Historical Context: {historical_context}

🔬 Synthesis Process:
1. 📥 Knowledge Gathering
   - Extract from memory://insights/{domain}
   - Aggregate agent learnings
   - Identify patterns and connections

2. 🔄 Cross-Validation
   - Compare perspectives across agents
   - Resolve contradictions
   - Validate against known facts

3. 🧬 Pattern Recognition
   - Identify emerging patterns
   - Extract actionable insights
   - Generate predictive models

4. 📚 Knowledge Encoding
   - Structure insights for memory storage
   - Create knowledge graph connections
   - Generate documentation

🎯 Deliverables:
- Synthesized Knowledge: {deliverable_format}
- Memory Updates: {memory_updates}
- Recommendations: {recommendations}
- Future Research: {future_research_areas}

📊 Quality Validation:
- Accuracy Score: {accuracy_threshold}%
- Completeness: {completeness_level}
- Actionability: {actionability_score}`,
      arguments: [
        { name: 'domain', description: 'Knowledge domain for synthesis', required: true, type: 'string' },
        { name: 'synthesis_goal', description: 'Primary objective of knowledge synthesis', required: true, type: 'string' },
        { name: 'knowledge_domains', description: 'Specific knowledge areas to synthesize', required: true, type: 'string' },
        { name: 'integration_target', description: 'Where synthesized knowledge will be applied', required: true, type: 'string' },
        { name: 'output_format', description: 'Desired output format', required: true, type: 'string', enum: ['report', 'knowledge_graph', 'recommendations', 'model', 'documentation'] },
        { name: 'contributing_agents', description: 'Agents contributing knowledge', required: false, type: 'string', default: 'Auto-select based on domain expertise' },
        { name: 'memory_sources', description: 'Memory system sources to query', required: false, type: 'string', default: 'enhanced_memory, neural_patterns, decision_history' },
        { name: 'external_sources', description: 'External data sources', required: false, type: 'string', default: 'documentation, research, best_practices' },
        { name: 'agent_experiences', description: 'Agent experience data to include', required: false, type: 'string', default: 'task_outcomes, learned_patterns, optimization_discoveries' },
        { name: 'historical_context', description: 'Historical context to consider', required: false, type: 'string', default: 'previous_projects, industry_trends, technical_evolution' },
        { name: 'deliverable_format', description: 'Format of final deliverable', required: false, type: 'string', default: 'structured_report_with_actionable_insights' },
        { name: 'memory_updates', description: 'Memory system updates to perform', required: false, type: 'string', default: 'update_knowledge_graph, store_insights, create_patterns' },
        { name: 'recommendations', description: 'Type of recommendations to generate', required: false, type: 'string', default: 'process_improvements, technology_choices, team_optimizations' },
        { name: 'future_research_areas', description: 'Future research directions', required: false, type: 'string', default: 'identify_knowledge_gaps_and_research_opportunities' },
        { name: 'accuracy_threshold', description: 'Required accuracy percentage', required: false, type: 'number', default: 90 },
        { name: 'completeness_level', description: 'Required completeness level', required: false, type: 'string', enum: ['basic', 'standard', 'comprehensive', 'exhaustive'], default: 'comprehensive' },
        { name: 'actionability_score', description: 'Target actionability score', required: false, type: 'string', default: 'high' }
      ]
    });

    // Performance Optimization Template
    this.registerPrompt({
      name: 'performance_optimization',
      description: 'Swarm performance tuning and optimization coordination',
      category: 'optimization',
      tags: ['performance', 'optimization', 'tuning', 'efficiency'],
      version: '1.0.0',
      template: `⚡ Performance Optimization for {system_name}

🎯 Optimization Targets:
- Primary Metric: {primary_metric}
- Target Improvement: {target_improvement}
- Baseline Performance: {baseline_performance}
- Performance Budget: {performance_budget}

🔍 Analysis Scope:
{analysis_scope}

👥 Optimization Team:
- Performance Engineer: {performance_agent}
- System Analyst: {analysis_agent}
- Implementation Lead: {implementation_agent}
- Validator: {validation_agent}

📊 Metrics & Monitoring:
- Key Metrics: {key_metrics}
- Monitoring Tools: {monitoring_tools}
- Reporting Frequency: {reporting_frequency}
- Alert Thresholds: {alert_thresholds}

🔧 Optimization Strategy:
1. 📈 Performance Profiling
   - Identify bottlenecks in {bottleneck_areas}
   - Measure baseline: {baseline_measurements}
   - Analyze resource usage patterns

2. 🎯 Targeted Improvements
   - Priority optimizations: {priority_optimizations}
   - Resource allocation: {resource_allocation}
   - Algorithm improvements: {algorithm_improvements}

3. ✅ Validation & Testing
   - Load testing: {load_testing_strategy}
   - Performance regression tests
   - Production monitoring

4. 🔄 Continuous Optimization
   - Performance feedback loops
   - Automated optimization triggers
   - Regular performance reviews

🚀 Implementation Plan:
- Phase 1: {phase_1_tasks}
- Phase 2: {phase_2_tasks}
- Phase 3: {phase_3_tasks}

📋 Success Criteria:
- Performance gain: {success_criteria}
- Resource efficiency: {efficiency_targets}
- Stability maintenance: {stability_requirements}`,
      arguments: [
        { name: 'system_name', description: 'Name of system being optimized', required: true, type: 'string' },
        { name: 'primary_metric', description: 'Primary performance metric to optimize', required: true, type: 'string' },
        { name: 'target_improvement', description: 'Target performance improvement', required: true, type: 'string' },
        { name: 'baseline_performance', description: 'Current baseline performance levels', required: true, type: 'string' },
        { name: 'performance_budget', description: 'Performance optimization budget/constraints', required: true, type: 'string' },
        { name: 'analysis_scope', description: 'Scope of performance analysis', required: false, type: 'string', default: 'end-to-end system performance, resource utilization, bottleneck identification' },
        { name: 'performance_agent', description: 'Performance engineering agent type', required: false, type: 'string', default: 'performance_specialist' },
        { name: 'analysis_agent', description: 'System analysis agent type', required: false, type: 'string', default: 'system_analyst' },
        { name: 'implementation_agent', description: 'Implementation agent type', required: false, type: 'string', default: 'optimization_engineer' },
        { name: 'validation_agent', description: 'Validation agent type', required: false, type: 'string', default: 'performance_tester' },
        { name: 'key_metrics', description: 'Key performance metrics to track', required: false, type: 'string', default: 'response_time, throughput, resource_usage, error_rate' },
        { name: 'monitoring_tools', description: 'Performance monitoring tools', required: false, type: 'string', default: 'application_monitors, system_metrics, custom_dashboards' },
        { name: 'reporting_frequency', description: 'Performance reporting frequency', required: false, type: 'string', default: 'real-time monitoring, daily reports, weekly analysis' },
        { name: 'alert_thresholds', description: 'Performance alert thresholds', required: false, type: 'string', default: 'response_time > baseline + 20%, error_rate > 0.1%' },
        { name: 'bottleneck_areas', description: 'Areas to analyze for bottlenecks', required: false, type: 'string', default: 'database_queries, API_endpoints, memory_usage, CPU_utilization' },
        { name: 'baseline_measurements', description: 'Baseline measurement approach', required: false, type: 'string', default: '7-day_average_under_normal_load' },
        { name: 'priority_optimizations', description: 'High-priority optimization areas', required: false, type: 'string', default: 'highest_impact_lowest_effort_improvements' },
        { name: 'resource_allocation', description: 'Resource allocation optimization', required: false, type: 'string', default: 'dynamic_scaling, resource_pooling, load_balancing' },
        { name: 'algorithm_improvements', description: 'Algorithm optimization opportunities', required: false, type: 'string', default: 'data_structures, caching_strategies, parallel_processing' },
        { name: 'load_testing_strategy', description: 'Load testing approach', required: false, type: 'string', default: 'gradual_load_increase, stress_testing, endurance_testing' },
        { name: 'phase_1_tasks', description: 'Phase 1 implementation tasks', required: false, type: 'string', default: 'profiling, analysis, quick_wins' },
        { name: 'phase_2_tasks', description: 'Phase 2 implementation tasks', required: false, type: 'string', default: 'major_optimizations, infrastructure_improvements' },
        { name: 'phase_3_tasks', description: 'Phase 3 implementation tasks', required: false, type: 'string', default: 'fine_tuning, continuous_optimization_setup' },
        { name: 'success_criteria', description: 'Success criteria definition', required: false, type: 'string', default: 'meet_or_exceed_target_improvement_while_maintaining_stability' },
        { name: 'efficiency_targets', description: 'Resource efficiency targets', required: false, type: 'string', default: 'reduce_resource_usage_by_15%_while_improving_performance' },
        { name: 'stability_requirements', description: 'System stability requirements', required: false, type: 'string', default: 'maintain_99.9%_uptime_and_current_error_rates' }
      ]
    });

    this.logger.info('Initialized coordination prompt templates', { 
      count: this.prompts.size,
      templates: Array.from(this.prompts.keys())
    });
  }
}