# coding:utf-8
import logging
import sys
from typing import (Any, Callable, Coroutine, Dict, Generator, Sequence, Tuple,
                    TypeVar, Union)

if sys.version_info >= (3, 8):  # pragma: no cover
    from typing import TypedDict
else:  # pragma: no cover
    # use typing_extensions if installed but don't require it
    try:
        from typing_extensions import TypedDict
    except ImportError:
        class TypedDict(dict):
            def __init_subclass__(cls, **kwargs: Any) -> None:
                return super().__init_subclass__()


class _Details(TypedDict):
    target: Callable[..., Any]
    args: Tuple[Any, ...]
    kwargs: Dict[str, Any]
    tries: int
    elapsed: float


class Details(_Details, total=False):
    wait: float  # present in the on_backoff handler case for either decorator
    value: Any  # present in the on_predicate decorator case


T = TypeVar("T")

_CallableT = TypeVar('_CallableT', bound=Callable[..., Any])
_Handler = Union[
    Callable[[Details], None],
    Callable[[Details], Coroutine[Any, Any, None]],
]
_Jitterer = Callable[[float], float]
_MaybeCallable = Union[T, Callable[[], T]]
_MaybeLogger = Union[str, logging.Logger, None]
_MaybeSequence = Union[T, Sequence[T]]
_Predicate = Callable[[T], bool]
_WaitGenerator = Callable[..., Generator[float, None, None]]
