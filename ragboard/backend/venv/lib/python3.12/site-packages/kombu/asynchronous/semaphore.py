"""Semaphores and concurrency primitives."""
from __future__ import annotations

import sys
from collections import deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from types import TracebackType
    from typing import Callable, Deque
    if sys.version_info < (3, 10):
        from typing_extensions import ParamSpec
    else:
        from typing import ParamSpec

    P = ParamSpec("P")

__all__ = ('DummyLock', 'LaxBoundedSemaphore')


class LaxBoundedSemaphore:
    """Asynchronous Bounded Semaphore.

    Lax means that the value will stay within the specified
    range even if released more times than it was acquired.

    Example:
    -------
        >>> x = LaxBoundedSemaphore(2)

        >>> x.acquire(print, 'HELLO 1')
        HELLO 1

        >>> x.acquire(print, 'HELLO 2')
        HELLO 2

        >>> x.acquire(print, 'HELLO 3')
        >>> x._waiters   # private, do not access directly
        [print, ('HELLO 3',)]

        >>> x.release()
        HELLO 3
    """

    def __init__(self, value: int) -> None:
        self.initial_value = self.value = value
        self._waiting: Deque[tuple] = deque()
        self._add_waiter = self._waiting.append
        self._pop_waiter = self._waiting.popleft

    def acquire(
        self,
        callback: Callable[P, None],
        *partial_args: P.args,
        **partial_kwargs: P.kwargs
    ) -> bool:
        """Acquire semaphore.

        This will immediately apply ``callback`` if
        the resource is available, otherwise the callback is suspended
        until the semaphore is released.

        Arguments:
        ---------
            callback (Callable): The callback to apply.
            *partial_args (Any): partial arguments to callback.
        """
        value = self.value
        if value <= 0:
            self._add_waiter((callback, partial_args, partial_kwargs))
            return False
        else:
            self.value = max(value - 1, 0)
            callback(*partial_args, **partial_kwargs)
            return True

    def release(self) -> None:
        """Release semaphore.

        Note:
        ----
            If there are any waiters this will apply the first waiter
            that is waiting for the resource (FIFO order).
        """
        try:
            waiter, args, kwargs = self._pop_waiter()
        except IndexError:
            self.value = min(self.value + 1, self.initial_value)
        else:
            waiter(*args, **kwargs)

    def grow(self, n: int = 1) -> None:
        """Change the size of the semaphore to accept more users."""
        self.initial_value += n
        self.value += n
        for _ in range(n):
            self.release()

    def shrink(self, n: int = 1) -> None:
        """Change the size of the semaphore to accept less users."""
        self.initial_value = max(self.initial_value - n, 0)
        self.value = max(self.value - n, 0)

    def clear(self) -> None:
        """Reset the semaphore, which also wipes out any waiting callbacks."""
        self._waiting.clear()
        self.value = self.initial_value

    def __repr__(self) -> str:
        return '<{} at {:#x} value:{} waiting:{}>'.format(
            self.__class__.__name__, id(self), self.value, len(self._waiting),
        )


class DummyLock:
    """Pretending to be a lock."""

    def __enter__(self) -> DummyLock:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None
    ) -> None:
        pass
