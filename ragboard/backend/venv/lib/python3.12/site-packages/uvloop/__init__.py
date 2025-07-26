import asyncio as __asyncio
import typing as _typing
import sys as _sys
import warnings as _warnings

from asyncio.events import BaseDefaultEventLoopPolicy as __BasePolicy

from . import includes as __includes  # NOQA
from .loop import Loop as __BaseLoop  # NOQA
from ._version import __version__  # NOQA


__all__ = ('new_event_loop', 'install', 'EventLoopPolicy')


_T = _typing.TypeVar("_T")


class Loop(__BaseLoop, __asyncio.AbstractEventLoop):  # type: ignore[misc]
    pass


def new_event_loop() -> Loop:
    """Return a new event loop."""
    return Loop()


def install() -> None:
    """A helper function to install uvloop policy."""
    if _sys.version_info[:2] >= (3, 12):
        _warnings.warn(
            'uvloop.install() is deprecated in favor of uvloop.run() '
            'starting with Python 3.12.',
            DeprecationWarning,
            stacklevel=1,
        )
    __asyncio.set_event_loop_policy(EventLoopPolicy())


if _typing.TYPE_CHECKING:
    def run(
        main: _typing.Coroutine[_typing.Any, _typing.Any, _T],
        *,
        loop_factory: _typing.Optional[
            _typing.Callable[[], Loop]
        ] = new_event_loop,
        debug: _typing.Optional[bool]=None,
    ) -> _T:
        """The preferred way of running a coroutine with uvloop."""
else:
    def run(main, *, loop_factory=new_event_loop, debug=None, **run_kwargs):
        """The preferred way of running a coroutine with uvloop."""

        async def wrapper():
            # If `loop_factory` is provided we want it to return
            # either uvloop.Loop or a subtype of it, assuming the user
            # is using `uvloop.run()` intentionally.
            loop = __asyncio._get_running_loop()
            if not isinstance(loop, Loop):
                raise TypeError('uvloop.run() uses a non-uvloop event loop')
            return await main

        vi = _sys.version_info[:2]

        if vi <= (3, 10):
            # Copied from python/cpython

            if __asyncio._get_running_loop() is not None:
                raise RuntimeError(
                    "asyncio.run() cannot be called from a running event loop")

            if not __asyncio.iscoroutine(main):
                raise ValueError(
                    "a coroutine was expected, got {!r}".format(main)
                )

            loop = loop_factory()
            try:
                __asyncio.set_event_loop(loop)
                if debug is not None:
                    loop.set_debug(debug)
                return loop.run_until_complete(wrapper())
            finally:
                try:
                    _cancel_all_tasks(loop)
                    loop.run_until_complete(loop.shutdown_asyncgens())
                    if hasattr(loop, 'shutdown_default_executor'):
                        loop.run_until_complete(
                            loop.shutdown_default_executor()
                        )
                finally:
                    __asyncio.set_event_loop(None)
                    loop.close()

        elif vi == (3, 11):
            if __asyncio._get_running_loop() is not None:
                raise RuntimeError(
                    "asyncio.run() cannot be called from a running event loop")

            with __asyncio.Runner(
                loop_factory=loop_factory,
                debug=debug,
                **run_kwargs
            ) as runner:
                return runner.run(wrapper())

        else:
            assert vi >= (3, 12)
            return __asyncio.run(
                wrapper(),
                loop_factory=loop_factory,
                debug=debug,
                **run_kwargs
            )


def _cancel_all_tasks(loop: __asyncio.AbstractEventLoop) -> None:
    # Copied from python/cpython

    to_cancel = __asyncio.all_tasks(loop)
    if not to_cancel:
        return

    for task in to_cancel:
        task.cancel()

    loop.run_until_complete(
        __asyncio.gather(*to_cancel, return_exceptions=True)
    )

    for task in to_cancel:
        if task.cancelled():
            continue
        if task.exception() is not None:
            loop.call_exception_handler({
                'message': 'unhandled exception during asyncio.run() shutdown',
                'exception': task.exception(),
                'task': task,
            })


class EventLoopPolicy(__BasePolicy):
    """Event loop policy.

    The preferred way to make your application use uvloop:

    >>> import asyncio
    >>> import uvloop
    >>> asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    >>> asyncio.get_event_loop()
    <uvloop.Loop running=False closed=False debug=False>
    """

    def _loop_factory(self) -> Loop:
        return new_event_loop()

    if _typing.TYPE_CHECKING:
        # EventLoopPolicy doesn't implement these, but since they are marked
        # as abstract in typeshed, we have to put them in so mypy thinks
        # the base methods are overridden. This is the same approach taken
        # for the Windows event loop policy classes in typeshed.
        def get_child_watcher(self) -> _typing.NoReturn:
            ...

        def set_child_watcher(
            self, watcher: _typing.Any
        ) -> _typing.NoReturn:
            ...
