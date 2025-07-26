from abc import abstractmethod
from typing import Awaitable, Callable, TypeVar, Any
from chromadb.config import Component, System

T = TypeVar("T", bound=Callable[..., Any])
A = TypeVar("A", bound=Awaitable[Any])


class RateLimitEnforcer(Component):
    """
    Rate limit enforcer.

    Implemented as a wrapper around server functions to block requests if rate limits are exceeded.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @abstractmethod
    def rate_limit(self, func: T) -> T:
        pass


class AsyncRateLimitEnforcer(Component):
    """
    Rate limit enforcer.

    Implemented as a wrapper around async functions to block requests if rate limits are exceeded.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @abstractmethod
    def rate_limit(self, func: A) -> A:
        pass
