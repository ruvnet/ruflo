# Maestro Native Hive Mind API Reference

## MaestroSwarmCoordinator

The main coordinator class for specs-driven development using native hive mind swarm intelligence.

### Constructor

```typescript
constructor(
  config: MaestroSwarmConfig,
  eventBus: IEventBus,
  logger: ILogger
)
```

### Configuration

```typescript
interface MaestroSwarmConfig {
  hiveMindConfig: HiveMindConfig;
  enableConsensusValidation: boolean;
  enableLivingDocumentation: boolean;
  enableSteeringIntegration: boolean;
  specsDirectory: string;
  steeringDirectory: string;
}
```

### Core Methods

#### initialize(): Promise<string>
Initializes the specs-driven hive mind swarm with 8 specialized agents.

**Returns:** Swarm ID string

#### createSpec(featureName: string, initialRequest: string): Promise<void>
Creates initial feature specification using requirements_analyst agent.

**Parameters:**
- `featureName` - Name of the feature
- `initialRequest` - Initial feature description

#### generateDesign(featureName: string): Promise<void>
Generates technical design using 2 design_architect agents with consensus validation.

#### generateTasks(featureName: string): Promise<void>
Creates implementation task breakdown using task_planner agent.

#### implementTask(featureName: string, taskId: number): Promise<void>
Implements specific task using implementation_coder agents.

#### approvePhase(featureName: string): Promise<void>
Approves current workflow phase with optional consensus validation.

#### getWorkflowState(featureName: string): MaestroWorkflowState | undefined
Returns current workflow state for feature.

#### createSteeringDocument(domain: string, content: string): Promise<void>
Creates governance document in native swarm memory.

#### shutdown(): Promise<void>
Gracefully shuts down the swarm coordinator.

## Agent Types

### Specs-Driven Topology Agents

- **requirements_analyst (1)** - Requirements analysis, user stories, acceptance criteria
- **design_architect (2)** - System design, architecture, parallel execution with consensus
- **task_planner (1)** - Task breakdown, workflow orchestration
- **implementation_coder (2)** - Code generation, parallel implementation
- **quality_reviewer (1)** - Code review, quality assurance, testing
- **steering_documenter (1)** - Documentation, governance

## Workflow Phases

1. **Requirements Clarification** - Sequential execution with requirements_analyst
2. **Research & Design** - Parallel execution with 2 design_architects + consensus
3. **Implementation Planning** - Sequential with task_planner
4. **Task Execution** - Parallel with 2 implementation_coders
5. **Quality Gates** - Sequential validation with quality_reviewer

## Events

The coordinator emits the following events:

- `maestro:spec_created` - Specification created
- `maestro:design_generated` - Design generated with consensus
- `maestro:tasks_generated` - Tasks breakdown created
- `maestro:task_implemented` - Individual task completed
- `maestro:phase_approved` - Workflow phase approved

## CLI Commands

```bash
# Initialize specs-driven swarm and create specification
npx claude-flow maestro create-spec <feature-name> [options]

# Generate design with consensus
npx claude-flow maestro generate-design <feature-name>

# Generate implementation tasks
npx claude-flow maestro generate-tasks <feature-name>

# Implement specific task
npx claude-flow maestro implement-task <feature-name> <task-id>

# Approve current phase
npx claude-flow maestro approve-phase <feature-name>

# Check workflow status
npx claude-flow maestro status <feature-name> [--detailed] [--json]

# Create steering document
npx claude-flow maestro init-steering [domain] [--content <content>]
```

## Performance Characteristics

- **Spec Creation**: < 2 minutes (single requirements_analyst)
- **Design Generation**: < 5 minutes (2 architects + consensus)
- **Task Planning**: < 3 minutes (dedicated task_planner)
- **Task Implementation**: < 10 minutes (2 coders in parallel)

## Error Handling

The coordinator includes comprehensive error handling for:
- Swarm initialization timeouts
- Consensus validation failures
- Agent spawning limits
- Task completion timeouts
- Memory access failures

All errors are logged and include actionable error messages with suggested resolutions.