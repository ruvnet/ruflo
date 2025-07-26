"""Compatibility utilities."""
import logging
from logging import NullHandler

# enables celery 3.1.23 to start again
from vine import promise  # noqa
from vine.utils import wraps

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # noqa


def set_cloexec(fd, cloexec):
    """Set flag to close fd after exec."""
    if fcntl is None:
        return
    try:
        FD_CLOEXEC = fcntl.FD_CLOEXEC
    except AttributeError:
        raise NotImplementedError(
            'close-on-exec flag not supported on this platform',
        )
    flags = fcntl.fcntl(fd, fcntl.F_GETFD)
    if cloexec:
        flags |= FD_CLOEXEC
    else:
        flags &= ~FD_CLOEXEC
    return fcntl.fcntl(fd, fcntl.F_SETFD, flags)


def coro(gen):
    """Decorator to mark generator as a co-routine."""
    @wraps(gen)
    def _boot(*args, **kwargs):
        co = gen(*args, **kwargs)
        next(co)
        return co

    return _boot


def str_to_bytes(s):
    """Convert str to bytes."""
    if isinstance(s, str):
        return s.encode('utf-8', 'surrogatepass')
    return s


def bytes_to_str(s):
    """Convert bytes to str."""
    if isinstance(s, bytes):
        return s.decode('utf-8', 'surrogatepass')
    return s


def get_logger(logger):
    """Get logger by name."""
    if isinstance(logger, str):
        logger = logging.getLogger(logger)
    if not logger.handlers:
        logger.addHandler(NullHandler())
    return logger
