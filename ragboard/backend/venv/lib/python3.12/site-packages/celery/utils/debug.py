"""Utilities for debugging memory usage, blocking calls, etc."""
import os
import sys
import traceback
from contextlib import contextmanager
from functools import partial
from pprint import pprint

from celery.platforms import signals
from celery.utils.text import WhateverIO

try:
    from psutil import Process
except ImportError:
    Process = None

__all__ = (
    'blockdetection', 'sample_mem', 'memdump', 'sample',
    'humanbytes', 'mem_rss', 'ps', 'cry',
)

UNITS = (
    (2 ** 40.0, 'TB'),
    (2 ** 30.0, 'GB'),
    (2 ** 20.0, 'MB'),
    (2 ** 10.0, 'KB'),
    (0.0, 'b'),
)

_process = None
_mem_sample = []


def _on_blocking(signum, frame):
    import inspect
    raise RuntimeError(
        f'Blocking detection timed-out at: {inspect.getframeinfo(frame)}'
    )


@contextmanager
def blockdetection(timeout):
    """Context that raises an exception if process is blocking.

    Uses ``SIGALRM`` to detect blocking functions.
    """
    if not timeout:
        yield
    else:
        old_handler = signals['ALRM']
        old_handler = None if old_handler == _on_blocking else old_handler

        signals['ALRM'] = _on_blocking

        try:
            yield signals.arm_alarm(timeout)
        finally:
            if old_handler:
                signals['ALRM'] = old_handler
            signals.reset_alarm()


def sample_mem():
    """Sample RSS memory usage.

    Statistics can then be output by calling :func:`memdump`.
    """
    current_rss = mem_rss()
    _mem_sample.append(current_rss)
    return current_rss


def _memdump(samples=10):  # pragma: no cover
    S = _mem_sample
    prev = list(S) if len(S) <= samples else sample(S, samples)
    _mem_sample[:] = []
    import gc
    gc.collect()
    after_collect = mem_rss()
    return prev, after_collect


def memdump(samples=10, file=None):  # pragma: no cover
    """Dump memory statistics.

    Will print a sample of all RSS memory samples added by
    calling :func:`sample_mem`, and in addition print
    used RSS memory after :func:`gc.collect`.
    """
    say = partial(print, file=file)
    if ps() is None:
        say('- rss: (psutil not installed).')
        return
    prev, after_collect = _memdump(samples)
    if prev:
        say('- rss (sample):')
        for mem in prev:
            say(f'-    > {mem},')
    say(f'- rss (end): {after_collect}.')


def sample(x, n, k=0):
    """Given a list `x` a sample of length ``n`` of that list is returned.

    For example, if `n` is 10, and `x` has 100 items, a list of every tenth.
    item is returned.

    ``k`` can be used as offset.
    """
    j = len(x) // n
    for _ in range(n):
        try:
            yield x[k]
        except IndexError:
            break
        k += j


def hfloat(f, p=5):
    """Convert float to value suitable for humans.

    Arguments:
        f (float): The floating point number.
        p (int): Floating point precision (default is 5).
    """
    i = int(f)
    return i if i == f else '{0:.{p}}'.format(f, p=p)


def humanbytes(s):
    """Convert bytes to human-readable form (e.g., KB, MB)."""
    return next(
        f'{hfloat(s / div if div else s)}{unit}'
        for div, unit in UNITS if s >= div
    )


def mem_rss():
    """Return RSS memory usage as a humanized string."""
    p = ps()
    if p is not None:
        return humanbytes(_process_memory_info(p).rss)


def ps():  # pragma: no cover
    """Return the global :class:`psutil.Process` instance.

    Note:
        Returns :const:`None` if :pypi:`psutil` is not installed.
    """
    global _process
    if _process is None and Process is not None:
        _process = Process(os.getpid())
    return _process


def _process_memory_info(process):
    try:
        return process.memory_info()
    except AttributeError:
        return process.get_memory_info()


def cry(out=None, sepchr='=', seplen=49):  # pragma: no cover
    """Return stack-trace of all active threads.

    See Also:
        Taken from https://gist.github.com/737056.
    """
    import threading

    out = WhateverIO() if out is None else out
    P = partial(print, file=out)

    # get a map of threads by their ID so we can print their names
    # during the traceback dump
    tmap = {t.ident: t for t in threading.enumerate()}

    sep = sepchr * seplen
    for tid, frame in sys._current_frames().items():
        thread = tmap.get(tid)
        if not thread:
            # skip old junk (left-overs from a fork)
            continue
        P(f'{thread.name}')
        P(sep)
        traceback.print_stack(frame, file=out)
        P(sep)
        P('LOCAL VARIABLES')
        P(sep)
        pprint(frame.f_locals, stream=out)
        P('\n')
    return out.getvalue()
