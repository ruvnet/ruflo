from abc import abstractmethod

from chromadb.api.types import GetResult, QueryResult
from chromadb.config import Component
from chromadb.execution.expression.plan import CountPlan, GetPlan, KNNPlan


class Executor(Component):
    @abstractmethod
    def count(self, plan: CountPlan) -> int:
        pass

    @abstractmethod
    def get(self, plan: GetPlan) -> GetResult:
        pass

    @abstractmethod
    def knn(self, plan: KNNPlan) -> QueryResult:
        pass
