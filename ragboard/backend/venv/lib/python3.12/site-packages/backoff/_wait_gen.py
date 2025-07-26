# coding:utf-8

import itertools
from typing import Any, Callable, Generator, Iterable, Optional, Union


def expo(
    base: float = 2,
    factor: float = 1,
    max_value: Optional[float] = None
) -> Generator[float, Any, None]:

    """Generator for exponential decay.

    Args:
        base: The mathematical base of the exponentiation operation
        factor: Factor to multiply the exponentiation by.
        max_value: The maximum value to yield. Once the value in the
             true exponential sequence exceeds this, the value
             of max_value will forever after be yielded.
    """
    # Advance past initial .send() call
    yield  # type: ignore[misc]
    n = 0
    while True:
        a = factor * base ** n
        if max_value is None or a < max_value:
            yield a
            n += 1
        else:
            yield max_value


def fibo(max_value: Optional[int] = None) -> Generator[int, None, None]:
    """Generator for fibonaccial decay.

    Args:
        max_value: The maximum value to yield. Once the value in the
             true fibonacci sequence exceeds this, the value
             of max_value will forever after be yielded.
    """
    # Advance past initial .send() call
    yield  # type: ignore[misc]

    a = 1
    b = 1
    while True:
        if max_value is None or a < max_value:
            yield a
            a, b = b, a + b
        else:
            yield max_value


def constant(
    interval: Union[int, Iterable[float]] = 1
) -> Generator[float, None, None]:
    """Generator for constant intervals.

    Args:
        interval: A constant value to yield or an iterable of such values.
    """
    # Advance past initial .send() call
    yield  # type: ignore[misc]

    try:
        itr = iter(interval)  # type: ignore
    except TypeError:
        itr = itertools.repeat(interval)  # type: ignore

    for val in itr:
        yield val


def runtime(
    *,
    value: Callable[[Any], float]
) -> Generator[float, None, None]:
    """Generator that is based on parsing the return value or thrown
        exception of the decorated method

    Args:
        value: a callable which takes as input the decorated
            function's return value or thrown exception and
            determines how long to wait
    """
    ret_or_exc = yield  # type: ignore[misc]
    while True:
        ret_or_exc = yield value(ret_or_exc)
