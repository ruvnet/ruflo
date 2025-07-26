import sys
from typing import Any, Iterator, Protocol, Type

if sys.version_info >= (3, 10):  # pragma: no cover
    from typing import ParamSpec
else:  # pragma: no cover
    from typing_extensions import ParamSpec

from starlette.types import ASGIApp, Receive, Scope, Send

P = ParamSpec("P")


class _MiddlewareClass(Protocol[P]):
    def __init__(self, app: ASGIApp, *args: P.args, **kwargs: P.kwargs) -> None:
        ...  # pragma: no cover

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        ...  # pragma: no cover


class Middleware:
    def __init__(
        self,
        cls: Type[_MiddlewareClass[P]],
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> None:
        self.cls = cls
        self.args = args
        self.kwargs = kwargs

    def __iter__(self) -> Iterator[Any]:
        as_tuple = (self.cls, self.args, self.kwargs)
        return iter(as_tuple)

    def __repr__(self) -> str:
        class_name = self.__class__.__name__
        args_strings = [f"{value!r}" for value in self.args]
        option_strings = [f"{key}={value!r}" for key, value in self.kwargs.items()]
        args_repr = ", ".join([self.cls.__name__] + args_strings + option_strings)
        return f"{class_name}({args_repr})"
