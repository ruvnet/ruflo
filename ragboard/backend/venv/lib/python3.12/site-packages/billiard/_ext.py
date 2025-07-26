import sys

supports_exec = True

from .compat import _winapi as win32  # noqa

if sys.platform.startswith("java"):
    _billiard = None
else:
    try:
        import _billiard                                # noqa
    except ImportError:
        import _multiprocessing as _billiard            # noqa
        supports_exec = False


def ensure_multiprocessing():
    if _billiard is None:
        raise NotImplementedError("multiprocessing not supported")


def ensure_SemLock():
    try:
        from _billiard import SemLock                   # noqa
    except ImportError:
        try:
            from _multiprocessing import SemLock        # noqa
        except ImportError:
            raise ImportError("""\
This platform lacks a functioning sem_open implementation, therefore,
the required synchronization primitives needed will not function,
see issue 3770.""")
