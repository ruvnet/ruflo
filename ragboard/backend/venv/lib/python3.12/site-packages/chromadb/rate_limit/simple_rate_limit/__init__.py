from overrides import override
from typing import Any, Awaitable, Callable, TypeVar
from functools import wraps

from chromadb.rate_limit import RateLimitEnforcer
from chromadb.config import System

T = TypeVar("T", bound=Callable[..., Any])
A = TypeVar("A", bound=Awaitable[Any])


class SimpleRateLimitEnforcer(RateLimitEnforcer):
    """
    A naive implementation of a rate limit enforcer that allows all requests.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @override
    def rate_limit(self, func: T) -> T:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            return func(*args, **kwargs)

        return wrapper  # type: ignore


class SimpleAsyncRateLimitEnforcer(RateLimitEnforcer):
    """
    A naive implementation of a rate limit enforcer that allows all requests.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @override
    def rate_limit(self, func: A) -> A:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            return await func(*args, **kwargs)
        return wrapper  # type: ignore
