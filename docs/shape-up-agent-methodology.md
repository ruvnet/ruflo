# Shape Up for AI Agent Swarms
## Integrating Shopify's Agile Methodology into Rust Agentic Framework

> **Shape Up**: Basecamp/Shopify's revolutionary approach to product development - now adapted for AI agent coordination and autonomous swarm management.

---

## 📚 Shape Up Fundamentals

### Core Principles

1. **Six-week cycles** - Fixed time, variable scope
2. **Appetites not estimates** - Set time budgets upfront
3. **Small batches** - Ship meaningful work frequently
4. **Hill charts** - Visual progress tracking (uphill = figuring out, downhill = executing)
5. **Betting table** - Leadership decides what gets resourced
6. **Cooldown periods** - 2 weeks for bug fixes, experiments, learning

---

## 🤖 Shape Up Adapted for Agent Swarms

### Traditional Shape Up vs Agent Shape Up

```
Traditional Shape Up:
├── 6-week cycles
├── Human teams (3-5 people)
├── Manual hill chart updates
├── Weekly betting table meetings
└── Human-driven scope definition

Agent Shape Up:
├── Configurable cycles (hours to weeks)
├── Agent swarms (unlimited scale)
├── Automated hill chart tracking
├── Continuous betting algorithm
└── AI-driven scope decomposition
```

---

## 🏗️ Architecture: Shape Up Components

### 1. Cycle Manager

```toon
# Shape Up Cycle Configuration
cycle:
  duration: 6w           # 6-week cycles
  cooldown: 2w          # 2-week cooldown
  current: 3            # Cycle number
  status: in_progress   # in_progress | cooldown | betting

betting_table:
  frequency: weekly     # When to evaluate new bets
  participants: [queen-coordinator lead-architect]
  criteria:
    appetite: true      # Must have appetite defined
    shaped: true        # Must be properly shaped
    priority: high      # Must meet priority threshold
```

### 2. Appetite-Based Task Allocation

```toon
# Appetite Definition (Shape Up style)
pitch:
  name: implement-authentication
  problem: Users can't securely access the system
  appetite: small       # small (1-2 weeks) | medium (3-4 weeks) | big (6 weeks)
  solution: OAuth2 with JWT tokens
  risks:
    - Third-party OAuth provider downtime
    - Token refresh complexity
  rabbit_holes:
    - Don't build custom crypto
    - Don't support all OAuth providers
  no_gos:
    - Password-based auth (security risk)
    - Single sign-on (out of scope)

agents_required: [security-architect coder-backend coder-frontend tester]
```

### 3. Hill Chart Progress Tracking

```toon
# Hill Chart Tracking
project:
  name: implement-authentication
  appetite: small

  scopes:
    - name: oauth-integration
      position: 75      # 0-100 (0=start, 50=top of hill, 100=done)
      status: downhill  # uphill | top | downhill | done
      confidence: high  # low | medium | high

    - name: jwt-tokens
      position: 45
      status: uphill
      confidence: medium

    - name: token-refresh
      position: 20
      status: uphill
      confidence: low

# Hill visualization:
#        /\
#       /  \      jwt-tokens (45, figuring out)
#      /    \
#     /      \    oauth-integration (75, executing)
#    /        \___
#   0    50    100
```

---

## 🦀 Rust Implementation

### Shape Up Cycle Manager

```rust
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cycle {
    pub number: u32,
    pub start_date: DateTime<Utc>,
    pub duration_weeks: u32,
    pub cooldown_weeks: u32,
    pub status: CycleStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CycleStatus {
    InProgress,
    Cooldown,
    Betting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Appetite {
    Small,      // 1-2 weeks
    Medium,     // 3-4 weeks
    Big,        // 6 weeks (full cycle)
}

impl Appetite {
    pub fn duration_days(&self) -> u32 {
        match self {
            Appetite::Small => 10,   // 2 weeks
            Appetite::Medium => 25,  // 3.5 weeks
            Appetite::Big => 42,     // 6 weeks
        }
    }

    pub fn recommended_agents(&self) -> usize {
        match self {
            Appetite::Small => 2,
            Appetite::Medium => 4,
            Appetite::Big => 6,
        }
    }
}

pub struct CycleManager {
    current_cycle: Cycle,
    active_projects: Vec<Project>,
    betting_queue: Vec<Pitch>,
}

impl CycleManager {
    pub fn new() -> Self {
        Self {
            current_cycle: Cycle {
                number: 1,
                start_date: Utc::now(),
                duration_weeks: 6,
                cooldown_weeks: 2,
                status: CycleStatus::InProgress,
            },
            active_projects: Vec::new(),
            betting_queue: Vec::new(),
        }
    }

    pub fn is_in_cooldown(&self) -> bool {
        matches!(self.current_cycle.status, CycleStatus::Cooldown)
    }

    pub fn days_remaining(&self) -> i64 {
        let cycle_end = self.current_cycle.start_date
            + Duration::weeks(self.current_cycle.duration_weeks as i64);

        (cycle_end - Utc::now()).num_days()
    }

    pub fn should_start_betting(&self) -> bool {
        let days_left = self.days_remaining();

        // Start betting when entering cooldown
        days_left <= (self.current_cycle.cooldown_weeks * 7) as i64
    }

    pub async fn advance_cycle(&mut self) -> Result<()> {
        match self.current_cycle.status {
            CycleStatus::InProgress => {
                if self.days_remaining() <= 0 {
                    self.current_cycle.status = CycleStatus::Cooldown;
                    self.handle_cooldown().await?;
                }
            }
            CycleStatus::Cooldown => {
                let cooldown_end = self.current_cycle.start_date
                    + Duration::weeks(
                        (self.current_cycle.duration_weeks + self.current_cycle.cooldown_weeks) as i64
                    );

                if Utc::now() >= cooldown_end {
                    self.current_cycle.status = CycleStatus::Betting;
                    self.run_betting_table().await?;
                }
            }
            CycleStatus::Betting => {
                // After betting, start new cycle
                self.start_new_cycle().await?;
            }
        }

        Ok(())
    }

    async fn handle_cooldown(&mut self) -> Result<()> {
        // Finish up current projects
        for project in &mut self.active_projects {
            if project.is_incomplete() {
                // Ship what's done, cut what's not
                project.ship_completed_scopes().await?;
            }
        }

        // Clear for next cycle
        self.active_projects.clear();

        Ok(())
    }

    async fn run_betting_table(&mut self) -> Result<()> {
        // Evaluate all pitches in queue
        let mut selected_projects = Vec::new();

        for pitch in &self.betting_queue {
            if self.should_bet_on(pitch) {
                let project = Project::from_pitch(pitch.clone());
                selected_projects.push(project);
            }
        }

        self.active_projects = selected_projects;
        self.betting_queue.clear();

        Ok(())
    }

    fn should_bet_on(&self, pitch: &Pitch) -> bool {
        // Betting criteria
        pitch.is_properly_shaped()
            && pitch.fits_appetite()
            && pitch.has_clear_boundaries()
            && !pitch.has_rabbit_holes()
    }

    async fn start_new_cycle(&mut self) -> Result<()> {
        self.current_cycle = Cycle {
            number: self.current_cycle.number + 1,
            start_date: Utc::now(),
            duration_weeks: 6,
            cooldown_weeks: 2,
            status: CycleStatus::InProgress,
        };

        Ok(())
    }
}
```

### Pitch Structure

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pitch {
    pub name: String,
    pub problem: String,
    pub appetite: Appetite,
    pub solution: String,
    pub risks: Vec<String>,
    pub rabbit_holes: Vec<String>,  // Things to avoid
    pub no_gos: Vec<String>,        // Out of scope
    pub agents_required: Vec<String>,
}

impl Pitch {
    pub fn is_properly_shaped(&self) -> bool {
        // Must have clear problem and solution
        !self.problem.is_empty()
            && !self.solution.is_empty()
            && !self.agents_required.is_empty()
    }

    pub fn fits_appetite(&self) -> bool {
        // Appetite is reasonable for scope
        match self.appetite {
            Appetite::Small => self.agents_required.len() <= 3,
            Appetite::Medium => self.agents_required.len() <= 5,
            Appetite::Big => self.agents_required.len() <= 8,
        }
    }

    pub fn has_clear_boundaries(&self) -> bool {
        // Has defined rabbit holes and no-gos
        !self.rabbit_holes.is_empty() || !self.no_gos.is_empty()
    }

    pub fn has_rabbit_holes(&self) -> bool {
        // Check if solution ventures into rabbit holes
        // (In real implementation, use NLP or pattern matching)
        false
    }
}
```

### Hill Chart Implementation

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HillChart {
    pub project_name: String,
    pub scopes: Vec<Scope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scope {
    pub name: String,
    pub position: f32,        // 0-100
    pub confidence: Confidence,
    pub last_updated: DateTime<Utc>,
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Confidence {
    Low,      // Still figuring out
    Medium,   // Making progress
    High,     // Executing smoothly
}

impl Scope {
    pub fn status(&self) -> ScopeStatus {
        match self.position {
            p if p < 50.0 => ScopeStatus::Uphill,    // Figuring out
            p if p == 50.0 => ScopeStatus::TopOfHill, // Transition
            p if p > 50.0 && p < 100.0 => ScopeStatus::Downhill, // Executing
            _ => ScopeStatus::Done,
        }
    }

    pub fn is_stuck(&self, days_threshold: i64) -> bool {
        // Hasn't moved in X days
        let days_since_update = (Utc::now() - self.last_updated).num_days();
        days_since_update > days_threshold && self.position < 100.0
    }

    pub fn update_position(&mut self, progress: f32, confidence: Confidence) {
        self.position = (self.position + progress).min(100.0);
        self.confidence = confidence;
        self.last_updated = Utc::now();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScopeStatus {
    Uphill,      // Problem solving phase
    TopOfHill,   // Clarity achieved
    Downhill,    // Execution phase
    Done,        // Complete
}

impl HillChart {
    pub fn overall_progress(&self) -> f32 {
        if self.scopes.is_empty() {
            return 0.0;
        }

        self.scopes.iter().map(|s| s.position).sum::<f32>() / self.scopes.len() as f32
    }

    pub fn identify_stuck_scopes(&self, days: i64) -> Vec<&Scope> {
        self.scopes.iter()
            .filter(|s| s.is_stuck(days))
            .collect()
    }

    pub fn scopes_by_status(&self) -> std::collections::HashMap<ScopeStatus, Vec<&Scope>> {
        let mut map = std::collections::HashMap::new();

        for scope in &self.scopes {
            map.entry(scope.status())
                .or_insert_with(Vec::new)
                .push(scope);
        }

        map
    }
}
```

### Project Structure

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub appetite: Appetite,
    pub hill_chart: HillChart,
    pub assigned_agents: Vec<String>,
    pub start_date: DateTime<Utc>,
    pub deadline: DateTime<Utc>,
}

impl Project {
    pub fn from_pitch(pitch: Pitch) -> Self {
        let start = Utc::now();
        let deadline = start + Duration::days(pitch.appetite.duration_days() as i64);

        // Break solution into scopes
        let scopes = Self::decompose_into_scopes(&pitch.solution);

        Self {
            name: pitch.name,
            appetite: pitch.appetite,
            hill_chart: HillChart {
                project_name: pitch.name.clone(),
                scopes,
            },
            assigned_agents: pitch.agents_required,
            start_date: start,
            deadline,
        }
    }

    fn decompose_into_scopes(solution: &str) -> Vec<Scope> {
        // Use AI to break solution into integrated slices
        // For now, simple split
        solution.split(';')
            .map(|s| Scope {
                name: s.trim().to_string(),
                position: 0.0,
                confidence: Confidence::Low,
                last_updated: Utc::now(),
                agent_id: None,
            })
            .collect()
    }

    pub fn is_incomplete(&self) -> bool {
        self.hill_chart.overall_progress() < 100.0
    }

    pub async fn ship_completed_scopes(&self) -> Result<()> {
        for scope in &self.hill_chart.scopes {
            if scope.position >= 100.0 {
                // Ship this scope
                println!("✅ Shipping scope: {}", scope.name);
            } else {
                // Cut incomplete scope
                println!("✂️  Cutting scope: {} ({}% done)", scope.name, scope.position);
            }
        }

        Ok(())
    }

    pub fn time_remaining(&self) -> Duration {
        self.deadline - Utc::now()
    }

    pub fn is_over_appetite(&self) -> bool {
        self.time_remaining() < Duration::zero()
    }
}
```

---

## 🎯 Agent Swarm Integration

### Betting Table for Agent Coordination

```rust
pub struct BettingTable {
    queen: Arc<QueenCoordinator>,
    pitches: Vec<Pitch>,
}

impl BettingTable {
    pub async fn evaluate_pitches(&self) -> Vec<Project> {
        let mut selected = Vec::new();

        for pitch in &self.pitches {
            // AI-driven betting decision
            let score = self.score_pitch(pitch).await;

            if score > 0.7 {  // 70% confidence threshold
                selected.push(Project::from_pitch(pitch.clone()));
            }
        }

        selected
    }

    async fn score_pitch(&self, pitch: &Pitch) -> f32 {
        let mut score = 0.0;

        // Factor 1: Clear problem definition (0.3)
        if !pitch.problem.is_empty() {
            score += 0.3;
        }

        // Factor 2: Realistic appetite (0.3)
        if pitch.fits_appetite() {
            score += 0.3;
        }

        // Factor 3: Clear boundaries (0.2)
        if pitch.has_clear_boundaries() {
            score += 0.2;
        }

        // Factor 4: Available agents (0.2)
        let available_agents = self.queen.available_agents().await;
        if available_agents >= pitch.agents_required.len() {
            score += 0.2;
        }

        score
    }
}
```

### Automatic Hill Chart Updates

```rust
pub struct HillTracker {
    memory: Arc<MemoryManager>,
}

impl HillTracker {
    pub async fn track_agent_progress(&self, agent_id: &str, scope: &str) -> Result<()> {
        // Get agent's recent activity
        let activity = self.memory.retrieve(agent_id, "recent_activity").await?;

        // Analyze progress
        let (progress_delta, confidence) = self.analyze_progress(&activity)?;

        // Update hill position
        self.update_scope_position(scope, progress_delta, confidence).await?;

        Ok(())
    }

    fn analyze_progress(&self, activity: &Option<MemoryEntry>) -> Result<(f32, Confidence)> {
        // AI analysis of agent activity
        // Returns: (progress delta, confidence level)

        // Signals of uphill work (figuring out):
        // - Many questions asked
        // - Research patterns
        // - Trying multiple approaches
        // - Low commit frequency

        // Signals of downhill work (executing):
        // - Steady commits
        // - Test coverage increasing
        // - Clear implementation pattern
        // - High confidence

        if let Some(entry) = activity {
            // Simple heuristic (would use AI in production)
            let commits = entry.value.get("commits").and_then(|v| v.as_u64()).unwrap_or(0);
            let questions = entry.value.get("questions").and_then(|v| v.as_u64()).unwrap_or(0);

            if questions > commits {
                // Still figuring out
                Ok((2.0, Confidence::Low))
            } else if commits > 10 {
                // Executing
                Ok((5.0, Confidence::High))
            } else {
                Ok((3.0, Confidence::Medium))
            }
        } else {
            Ok((0.0, Confidence::Low))
        }
    }

    async fn update_scope_position(
        &self,
        scope: &str,
        delta: f32,
        confidence: Confidence,
    ) -> Result<()> {
        // Store updated position in database
        self.memory.store(MemoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            agent_id: "hill-tracker".to_string(),
            key: format!("scope:{}", scope),
            value: serde_json::json!({
                "delta": delta,
                "confidence": confidence,
                "updated_at": chrono::Utc::now().to_rfc3339(),
            }),
            created_at: chrono::Utc::now().timestamp(),
            ..Default::default()
        }).await?;

        Ok(())
    }
}
```

---

## 📊 TOON Configuration

### Shape Up Cycle Configuration

```toon
# config/shape-up.toon
shape_up:
  enabled: true

  cycles:
    duration: 6w
    cooldown: 2w
    current: 3
    status: in_progress

  appetites:
    small: {weeks: 2, agents: 2}
    medium: {weeks: 4, agents: 4}
    big: {weeks: 6, agents: 6}

  betting_table:
    frequency: weekly
    participants: [queen-coordinator lead-architect product-owner]
    min_confidence: 0.7

  hill_tracking:
    enabled: true
    update_frequency: daily
    stuck_threshold_days: 3

  cooldown_activities:
    - bug_fixes
    - technical_debt
    - experiments
    - learning
```

### Pitch Template (TOON)

```toon
# pitches/authentication-system.toon
pitch:
  name: implement-authentication
  appetite: medium  # 3-4 weeks

  problem: |
    Users cannot securely access the system. We need proper
    authentication to protect user data and enable personalization.

  solution: |
    Implement OAuth2 with JWT tokens;
    Add token refresh mechanism;
    Create login/logout UI;
    Integrate with user profile system

  boundaries:
    risks:
      - Third-party OAuth downtime
      - Token refresh race conditions
      - Session management complexity

    rabbit_holes:
      - Don't build custom crypto
      - Don't support every OAuth provider
      - Don't over-engineer token storage

    no_gos:
      - Password-based auth (insecure)
      - Single sign-on (future cycle)
      - Multi-factor auth (future cycle)

  agents:
    required: [security-architect backend-coder frontend-coder tester]
    optional: [devops-engineer]

  success_criteria:
    - Users can log in via OAuth
    - Tokens refresh automatically
    - Sessions persist across browser restarts
    - All endpoints are authenticated
```

---

## 🎨 Visualization: Hill Charts

### ASCII Hill Chart

```rust
pub struct HillChartRenderer;

impl HillChartRenderer {
    pub fn render_ascii(chart: &HillChart) -> String {
        let mut output = String::new();

        output.push_str(&format!("Hill Chart: {}\n\n", chart.project_name));
        output.push_str("     Uphill (Figuring Out)  |  Downhill (Executing)\n");
        output.push_str("                            /\\\n");
        output.push_str("                           /  \\\n");
        output.push_str("                          /    \\\n");
        output.push_str("                         /      \\\n");
        output.push_str("                        /        \\\n");
        output.push_str("    ___________________/          \\___________________\n");
        output.push_str("    0                 50                            100\n\n");

        // Plot scopes
        for scope in &chart.scopes {
            let position = (scope.position / 2.0) as usize; // Scale to 0-50 for display
            let marker = match scope.confidence {
                Confidence::High => "●",
                Confidence::Medium => "◐",
                Confidence::Low => "○",
            };

            output.push_str(&format!(
                "{}│{:width$}{} {} ({}%)\n",
                " ".repeat(4),
                "",
                marker,
                scope.name,
                scope.position as u32,
                width = position
            ));
        }

        output
    }
}

// Usage
let chart = HillChart { /* ... */ };
println!("{}", HillChartRenderer::render_ascii(&chart));

// Output:
//      Uphill (Figuring Out)  |  Downhill (Executing)
//                             /\
//                            /  \
//                           /    \
//                          /      \
//                         /        \
//     ___________________/          \___________________
//     0                 50                            100
//
//     │          ○ oauth-integration (20%)
//     │                    ◐ jwt-tokens (45%)
//     │                                   ● token-refresh (75%)
```

---

## 🚀 Complete Workflow

### 1. Shaping Phase (Before Cycle)

```rust
// Create and shape a pitch
let pitch = Pitch {
    name: "implement-search".to_string(),
    problem: "Users can't find relevant content".to_string(),
    appetite: Appetite::Medium,
    solution: "Add full-text search with Turso; Create search UI; Add filters".to_string(),
    risks: vec!["Search performance with large datasets".to_string()],
    rabbit_holes: vec!["Don't build custom search algorithm".to_string()],
    no_gos: vec!["Natural language processing".to_string()],
    agents_required: vec!["backend-coder".to_string(), "frontend-coder".to_string()],
};

// Submit to betting queue
cycle_manager.submit_pitch(pitch).await?;
```

### 2. Betting Phase (Cooldown)

```rust
// Run betting table
let betting_table = BettingTable::new(queen_coordinator, pitches);
let selected_projects = betting_table.evaluate_pitches().await;

// Assign agents to projects
for project in selected_projects {
    let agents = swarm.allocate_agents(&project.assigned_agents).await?;

    // Start work
    project.begin(agents).await?;
}
```

### 3. Execution Phase (6-week cycle)

```rust
// Agents work on scopes
loop {
    // Each agent updates their scope
    for agent in &agents {
        let progress = agent.work_on_scope().await?;

        // Update hill chart
        hill_tracker.track_agent_progress(&agent.id, &scope_name).await?;
    }

    // Check for stuck scopes
    let stuck = hill_chart.identify_stuck_scopes(3).await?;
    if !stuck.is_empty() {
        // Reassign or get help
        for scope in stuck {
            queen.intervene(scope).await?;
        }
    }

    // Check if cycle ending
    if cycle_manager.should_start_betting() {
        break;
    }
}
```

### 4. Cooldown Phase (2 weeks)

```rust
// Ship completed work
for project in &active_projects {
    project.ship_completed_scopes().await?;
}

// Cooldown activities
cycle_manager.start_cooldown_activities().await?;

// Activities: bug fixes, experiments, learning
let cooldown_tasks = vec![
    "Fix authentication edge cases",
    "Experiment with vector search",
    "Learn new Rust patterns",
];

for task in cooldown_tasks {
    let agent = swarm.get_available_agent().await?;
    agent.execute_cooldown_task(task).await?;
}
```

---

## 📊 Benefits for Agent Swarms

### 1. Fixed Time, Variable Scope

```
Traditional Agile:
- Estimate: 40 story points
- Reality: 60 story points
- Result: Delayed, overtime

Shape Up:
- Appetite: 4 weeks
- Reality: 4 weeks (cut scope if needed)
- Result: On time, shipped features
```

### 2. Autonomous Progress Tracking

```rust
// Agents automatically update hill position
impl Agent {
    async fn work_on_task(&self, task: Task) -> Result<TaskResult> {
        let start_confidence = self.assess_confidence(&task)?;

        // Do work
        let result = self.execute_task(&task).await?;

        let end_confidence = self.assess_confidence(&task)?;

        // Update hill position
        let progress = if end_confidence > start_confidence {
            // Moving downhill (executing)
            5.0
        } else {
            // Moving uphill (figuring out)
            2.0
        };

        self.update_hill_position(progress, end_confidence).await?;

        Ok(result)
    }
}
```

### 3. Clear Boundaries

```toon
# Rabbit holes prevent infinite scope creep
boundaries:
  rabbit_holes:
    - Don't optimize prematurely
    - Don't support every edge case
    - Don't build custom framework

  no_gos:
    - Mobile app (future)
    - Real-time collaboration (future)
    - Internationalization (future)
```

---

## ✅ Integration Summary

```
┌────────────────────────────────────────────────────┐
│   Rust Agentic Framework + Shape Up                │
├────────────────────────────────────────────────────┤
│ Cycles:        6 weeks + 2 week cooldown           │
│ Appetites:     Small/Medium/Big time budgets       │
│ Hill Charts:   Automated progress tracking         │
│ Betting Table: AI-driven project selection         │
│ Scopes:        AI-decomposed work slices           │
│ Boundaries:    Rabbit holes & no-gos defined       │
│ Cooldown:      Learning, experiments, bug fixes    │
└────────────────────────────────────────────────────┘

Result:
✅ Predictable shipping cadence
✅ Autonomous progress tracking
✅ Clear scope boundaries
✅ No overtime or crunch
✅ Continuous learning
✅ AI-driven coordination
```

---

## 📚 Resources

### Shape Up Methodology
- [Shape Up Book](https://basecamp.com/shapeup) - Free online
- [Hill Charts Explained](https://basecamp.com/features/hill-charts)
- [Shopify's Engineering Blog](https://shopify.engineering/)

### Implementation
- Rust Shape Up crate (to be created)
- TOON pitch templates
- Hill chart visualizations

---

**Shape Up + AI Agents = Predictable, Autonomous Software Delivery** 🚀

_Fixed time, variable scope, shipped features._ ⏱️
