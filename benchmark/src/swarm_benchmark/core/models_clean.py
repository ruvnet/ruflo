"""Clean canonical models used by tests (copy used by core.__init__).

This file provides a single, compact set of enums and dataclasses so the
package can be safely imported during testing and matches test expectations.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any, Union
import uuid


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class AgentStatus(Enum):
    IDLE = "idle"
    BUSY = "busy"
    FAILED = "failed"
    OFFLINE = "offline"


class ResultStatus(Enum):
    SUCCESS = "success"
    FAILURE = "failure"
    ERROR = "error"


class StrategyType(Enum):
    AUTO = "auto"
    RESEARCH = "research"
    DEVELOPMENT = "development"


class CoordinationMode(Enum):
    CENTRALIZED = "centralized"
    DISTRIBUTED = "distributed"
    HIERARCHICAL = "hierarchical"


class AgentType(Enum):
    SPECIALIST = "specialist"
    RESEARCHER = "researcher"


@dataclass
class PerformanceMetrics:
    execution_time: float = 0.0
    queue_time: float = 0.0
    throughput: float = 0.0
    success_rate: float = 1.0
    error_rate: float = 0.0
    retry_count: int = 0


@dataclass
class QualityMetrics:
    accuracy_score: float = 0.0
    completeness_score: float = 0.0
    consistency_score: float = 0.0
    relevance_score: float = 0.0
    overall_quality: float = 0.0
    review_score: float = 0.0


@dataclass
class ResourceUsage:
    # Primary canonical fields
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    network_bytes_sent: int = 0
    network_bytes_recv: int = 0
    disk_bytes_read: int = 0
    disk_bytes_write: int = 0
    peak_memory_mb: float = 0.0
    average_cpu_percent: float = 0.0

    # Backwards-compatible aliases used in older tests
    cpu_usage: Optional[float] = None
    memory_usage: Optional[int] = None
    network_io: Optional[int] = None
    disk_io: Optional[int] = None

    def __post_init__(self):
        # Map aliases to canonical names when provided
        if self.cpu_usage is not None:
            self.cpu_percent = float(self.cpu_usage)
        if self.memory_usage is not None:
            self.memory_mb = float(self.memory_usage)
        if self.network_io is not None:
            # split into sent/recv for compatibility (best-effort)
            self.network_bytes_sent = int(self.network_io)
            self.network_bytes_recv = int(self.network_io)
        if self.disk_io is not None:
            self.disk_bytes_read = int(self.disk_io)
            self.disk_bytes_write = int(self.disk_io)

        # Basic validation
        if self.cpu_percent < 0 or self.cpu_percent > 100:
            raise ValueError('cpu_percent out of range')
        if self.memory_mb < 0:
            raise ValueError('memory_mb out of range')


@dataclass
class Result:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    task_id: str = ""
    agent_id: str = ""
    status: ResultStatus = ResultStatus.SUCCESS
    performance_metrics: PerformanceMetrics = field(default_factory=PerformanceMetrics)
    quality_metrics: QualityMetrics = field(default_factory=QualityMetrics)
    resource_usage: ResourceUsage = field(default_factory=ResourceUsage)
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    execution_time: Optional[float] = None
    # Additional expected fields
    output: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    execution_details: Dict[str, Any] = field(default_factory=dict)

    def duration(self) -> Optional[float]:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None

    def __post_init__(self):
        # If completed_at not set, keep it as provided; some tests expect
        # a completed_at timestamp for basic Result creation
        if self.completed_at is None:
            self.completed_at = datetime.now()


@dataclass
class Task:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    objective: str = ""
    description: str = ""
    strategy: StrategyType = StrategyType.AUTO
    mode: CoordinationMode = CoordinationMode.CENTRALIZED
    parameters: Dict[str, Any] = field(default_factory=dict)
    timeout: int = 3600
    max_retries: int = 3
    priority: int = 1
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    def duration(self) -> Optional[float]:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


@dataclass
class Agent:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    type: Union[AgentType, str] = AgentType.SPECIALIST
    name: str = ""
    capabilities: List[str] = field(default_factory=list)
    status: AgentStatus = AgentStatus.IDLE
    current_task: Optional[Union[str, Task]] = None
    total_tasks_completed: int = 0
    total_tasks_failed: int = 0
    total_execution_time: float = 0.0
    success_rate: float = 1.0
    average_execution_time: float = 0.0
    created_at: datetime = field(default_factory=datetime.now)
    last_active: datetime = field(default_factory=datetime.now)

    def assign_task(self, task: Task) -> None:
        self.current_task = task
        self.status = AgentStatus.BUSY
        self.last_active = datetime.now()

    def complete_task(self, task: Optional[Task] = None, success: bool = True) -> None:
        self.current_task = None
        self.status = AgentStatus.IDLE
        self.last_active = datetime.now()

    def update_performance(self, metrics: PerformanceMetrics) -> None:
        # Interpret success_rate: treat 1.0 as full success, 0.0 as failure
        if metrics.success_rate >= 1.0:
            self.total_tasks_completed += 1
        elif metrics.success_rate <= 0.0:
            self.total_tasks_failed += 1
        else:
            # partial success counts as completed
            self.total_tasks_completed += 1

        self.total_execution_time += getattr(metrics, 'execution_time', 0.0)
        total_count = self.total_tasks_completed + self.total_tasks_failed
        if total_count > 0:
            self.success_rate = self.total_tasks_completed / total_count
            self.average_execution_time = self.total_execution_time / total_count


@dataclass
class BenchmarkMetrics:
    total_tasks: int = 0
    completed_tasks: int = 0
    failed_tasks: int = 0
    average_execution_time: float = 0.0
    total_execution_time: float = 0.0
    success_rate: float = 0.0
    quality_score: float = 0.0
    peak_memory_usage: float = 0.0

    def update_from_results(self, results: List[Result]) -> None:
        if not results:
            self.total_tasks = 0
            self.completed_tasks = 0
            self.failed_tasks = 0
            self.average_execution_time = 0.0
            self.total_execution_time = 0.0
            self.success_rate = 0.0
            self.quality_score = 0.0
            self.peak_memory_usage = 0.0
            return

        self.total_tasks = len(results)
        self.completed_tasks = sum(1 for r in results if getattr(r.status, 'value', r.status) == 'success')
        self.failed_tasks = sum(1 for r in results if getattr(r.status, 'value', r.status) in ('failure', 'error'))
        times = [getattr(r.performance_metrics, 'execution_time', 0) for r in results]
        self.total_execution_time = sum(times)
        self.average_execution_time = (self.total_execution_time / len(results)) if results else 0.0
        self.success_rate = (self.completed_tasks / self.total_tasks) if self.total_tasks else 0.0
        # quality_score: average overall_quality for successful results
        success_qualities = [getattr(r.quality_metrics, 'overall_quality', 0) for r in results if getattr(r.status, 'value', r.status) == 'success']
        if success_qualities:
            self.quality_score = sum(success_qualities) / len(success_qualities)
        else:
            self.quality_score = 0.0
        # peak memory
        peaks = [getattr(r.resource_usage, 'peak_memory_mb', 0) for r in results]
        self.peak_memory_usage = max(peaks) if peaks else 0.0

    def __post_init__(self):
        # Compute success_rate if total_tasks provided
        if self.total_tasks:
            self.success_rate = (self.completed_tasks / self.total_tasks) if self.total_tasks else 0.0


@dataclass
class BenchmarkConfig:
    name: str = "benchmark"
    description: str = ""
    strategy: StrategyType = StrategyType.AUTO
    mode: CoordinationMode = CoordinationMode.CENTRALIZED
    max_agents: int = 5
    max_tasks: int = 100
    timeout: int = 3600
    task_timeout: int = 300
    max_retries: int = 3
    parallel: bool = False
    background: bool = False
    monitoring: bool = True
    quality_threshold: float = 0.8
    output_formats: List[str] = field(default_factory=lambda: ["json"])
    output_directory: str = "./reports"
    verbose: bool = False


@dataclass
class Benchmark:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    description: str = ""
    # For backwards compatibility some tests pass `strategy`/`mode` kwargs
    strategy: Union[str, StrategyType] = StrategyType.AUTO
    mode: Union[str, CoordinationMode] = CoordinationMode.CENTRALIZED
    config: BenchmarkConfig = field(default_factory=BenchmarkConfig)
    tasks: List[Task] = field(default_factory=list)
    agents: List[Union[str, Agent]] = field(default_factory=list)
    results: List[Result] = field(default_factory=list)
    metrics: BenchmarkMetrics = field(default_factory=BenchmarkMetrics)
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    error_log: List[str] = field(default_factory=list)

    def add_task(self, task: Task) -> None:
        self.tasks.append(task)

    def add_agent(self, agent: Union[str, Agent]) -> None:
        self.agents.append(agent)

    def add_result(self, result: Result) -> None:
        self.results.append(result)
        self.metrics.update_from_results(self.results)

    def get_task_by_id(self, id: str) -> Optional[Task]:
        for t in self.tasks:
            if t.id == id:
                return t
        return None

    def get_agent_by_id(self, id: str) -> Optional[Agent]:
        for a in self.agents:
            if isinstance(a, Agent) and a.id == id:
                return a
        return None

    def get_results_by_task_id(self, task_id: str) -> List[Result]:
        return [r for r in self.results if r.task_id == task_id]

    def get_results_by_agent_id(self, agent_id: str) -> List[Result]:
        return [r for r in self.results if r.agent_id == agent_id]

    def duration(self) -> Optional[float]:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None

    def complete(self) -> None:
        self.completed_at = datetime.now()



# Backwards-compatible aliases
BenchmarkResult = Result
BenchmarkTask = Task

