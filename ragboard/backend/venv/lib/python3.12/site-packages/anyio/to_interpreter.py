from __future__ import annotations

import atexit
import os
import pickle
import sys
from collections import deque
from collections.abc import Callable
from textwrap import dedent
from typing import Any, Final, TypeVar

from . import current_time, to_thread
from ._core._exceptions import BrokenWorkerIntepreter
from ._core._synchronization import CapacityLimiter
from .lowlevel import RunVar

if sys.version_info >= (3, 11):
    from typing import TypeVarTuple, Unpack
else:
    from typing_extensions import TypeVarTuple, Unpack

UNBOUND: Final = 2  # I have no clue how this works, but it was used in the stdlib
FMT_UNPICKLED: Final = 0
FMT_PICKLED: Final = 1
DEFAULT_CPU_COUNT: Final = 8  # this is just an arbitrarily selected value
MAX_WORKER_IDLE_TIME = (
    30  # seconds a subinterpreter can be idle before becoming eligible for pruning
)

T_Retval = TypeVar("T_Retval")
PosArgsT = TypeVarTuple("PosArgsT")

_idle_workers = RunVar[deque["Worker"]]("_available_workers")
_default_interpreter_limiter = RunVar[CapacityLimiter]("_default_interpreter_limiter")


class Worker:
    _run_func = compile(
        dedent("""
        import _interpqueues as queues
        import _interpreters as interpreters
        from pickle import loads, dumps, HIGHEST_PROTOCOL

        item = queues.get(queue_id)[0]
        try:
            func, args = loads(item)
            retval = func(*args)
        except BaseException as exc:
            is_exception = True
            retval = exc
        else:
            is_exception = False

        try:
            queues.put(queue_id, (retval, is_exception), FMT_UNPICKLED, UNBOUND)
        except interpreters.NotShareableError:
            retval = dumps(retval, HIGHEST_PROTOCOL)
            queues.put(queue_id, (retval, is_exception), FMT_PICKLED, UNBOUND)
        """),
        "<string>",
        "exec",
    )

    last_used: float = 0

    _initialized: bool = False
    _interpreter_id: int
    _queue_id: int

    def initialize(self) -> None:
        import _interpqueues as queues
        import _interpreters as interpreters

        self._interpreter_id = interpreters.create()
        self._queue_id = queues.create(2, FMT_UNPICKLED, UNBOUND)
        self._initialized = True
        interpreters.set___main___attrs(
            self._interpreter_id,
            {
                "queue_id": self._queue_id,
                "FMT_PICKLED": FMT_PICKLED,
                "FMT_UNPICKLED": FMT_UNPICKLED,
                "UNBOUND": UNBOUND,
            },
        )

    def destroy(self) -> None:
        import _interpqueues as queues
        import _interpreters as interpreters

        if self._initialized:
            interpreters.destroy(self._interpreter_id)
            queues.destroy(self._queue_id)

    def _call(
        self,
        func: Callable[..., T_Retval],
        args: tuple[Any],
    ) -> tuple[Any, bool]:
        import _interpqueues as queues
        import _interpreters as interpreters

        if not self._initialized:
            self.initialize()

        payload = pickle.dumps((func, args), pickle.HIGHEST_PROTOCOL)
        queues.put(self._queue_id, payload, FMT_PICKLED, UNBOUND)

        res: Any
        is_exception: bool
        if exc_info := interpreters.exec(self._interpreter_id, self._run_func):
            raise BrokenWorkerIntepreter(exc_info)

        (res, is_exception), fmt = queues.get(self._queue_id)[:2]
        if fmt == FMT_PICKLED:
            res = pickle.loads(res)

        return res, is_exception

    async def call(
        self,
        func: Callable[..., T_Retval],
        args: tuple[Any],
        limiter: CapacityLimiter,
    ) -> T_Retval:
        result, is_exception = await to_thread.run_sync(
            self._call,
            func,
            args,
            limiter=limiter,
        )
        if is_exception:
            raise result

        return result


def _stop_workers(workers: deque[Worker]) -> None:
    for worker in workers:
        worker.destroy()

    workers.clear()


async def run_sync(
    func: Callable[[Unpack[PosArgsT]], T_Retval],
    *args: Unpack[PosArgsT],
    limiter: CapacityLimiter | None = None,
) -> T_Retval:
    """
    Call the given function with the given arguments in a subinterpreter.

    If the ``cancellable`` option is enabled and the task waiting for its completion is
    cancelled, the call will still run its course but its return value (or any raised
    exception) will be ignored.

    .. warning:: This feature is **experimental**. The upstream interpreter API has not
        yet been finalized or thoroughly tested, so don't rely on this for anything
        mission critical.

    :param func: a callable
    :param args: positional arguments for the callable
    :param limiter: capacity limiter to use to limit the total amount of subinterpreters
        running (if omitted, the default limiter is used)
    :return: the result of the call
    :raises BrokenWorkerIntepreter: if there's an internal error in a subinterpreter

    """
    if sys.version_info <= (3, 13):
        raise RuntimeError("subinterpreters require at least Python 3.13")

    if limiter is None:
        limiter = current_default_interpreter_limiter()

    try:
        idle_workers = _idle_workers.get()
    except LookupError:
        idle_workers = deque()
        _idle_workers.set(idle_workers)
        atexit.register(_stop_workers, idle_workers)

    async with limiter:
        try:
            worker = idle_workers.pop()
        except IndexError:
            worker = Worker()

    try:
        return await worker.call(func, args, limiter)
    finally:
        # Prune workers that have been idle for too long
        now = current_time()
        while idle_workers:
            if now - idle_workers[0].last_used <= MAX_WORKER_IDLE_TIME:
                break

            await to_thread.run_sync(idle_workers.popleft().destroy, limiter=limiter)

        worker.last_used = current_time()
        idle_workers.append(worker)


def current_default_interpreter_limiter() -> CapacityLimiter:
    """
    Return the capacity limiter that is used by default to limit the number of
    concurrently running subinterpreters.

    Defaults to the number of CPU cores.

    :return: a capacity limiter object

    """
    try:
        return _default_interpreter_limiter.get()
    except LookupError:
        limiter = CapacityLimiter(os.cpu_count() or DEFAULT_CPU_COUNT)
        _default_interpreter_limiter.set(limiter)
        return limiter
