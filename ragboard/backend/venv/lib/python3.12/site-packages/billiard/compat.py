import errno
import numbers
import os
import subprocess
import sys

from itertools import zip_longest

if sys.platform == 'win32':
    try:
        import _winapi  # noqa
    except ImportError:                            # pragma: no cover
        from _multiprocessing import win32 as _winapi  # noqa
else:
    _winapi = None  # noqa

try:
    import resource
except ImportError:  # pragma: no cover
    resource = None

from io import UnsupportedOperation
FILENO_ERRORS = (AttributeError, ValueError, UnsupportedOperation)


if hasattr(os, 'write'):
    __write__ = os.write

    def send_offset(fd, buf, offset):
        return __write__(fd, buf[offset:])

else:  # non-posix platform

    def send_offset(fd, buf, offset):  # noqa
        raise NotImplementedError('send_offset')


try:
    fsencode = os.fsencode
    fsdecode = os.fsdecode
except AttributeError:
    def _fscodec():
        encoding = sys.getfilesystemencoding()
        if encoding == 'mbcs':
            errors = 'strict'
        else:
            errors = 'surrogateescape'

        def fsencode(filename):
            """
            Encode filename to the filesystem encoding with 'surrogateescape'
            error handler, return bytes unchanged. On Windows, use 'strict'
            error handler if the file system encoding is 'mbcs' (which is the
            default encoding).
            """
            if isinstance(filename, bytes):
                return filename
            elif isinstance(filename, str):
                return filename.encode(encoding, errors)
            else:
                raise TypeError("expect bytes or str, not %s"
                                % type(filename).__name__)

        def fsdecode(filename):
            """
            Decode filename from the filesystem encoding with 'surrogateescape'
            error handler, return str unchanged. On Windows, use 'strict' error
            handler if the file system encoding is 'mbcs' (which is the default
            encoding).
            """
            if isinstance(filename, str):
                return filename
            elif isinstance(filename, bytes):
                return filename.decode(encoding, errors)
            else:
                raise TypeError("expect bytes or str, not %s"
                                % type(filename).__name__)

        return fsencode, fsdecode

    fsencode, fsdecode = _fscodec()
    del _fscodec


def maybe_fileno(f):
    """Get object fileno, or :const:`None` if not defined."""
    if isinstance(f, numbers.Integral):
        return f
    try:
        return f.fileno()
    except FILENO_ERRORS:
        pass


def get_fdmax(default=None):
    """Return the maximum number of open file descriptors
    on this system.

    :keyword default: Value returned if there's no file
                      descriptor limit.

    """
    try:
        return os.sysconf('SC_OPEN_MAX')
    except:
        pass
    if resource is None:  # Windows
        return default
    fdmax = resource.getrlimit(resource.RLIMIT_NOFILE)[1]
    if fdmax == resource.RLIM_INFINITY:
        return default
    return fdmax


def uniq(it):
    """Return all unique elements in ``it``, preserving order."""
    seen = set()
    return (seen.add(obj) or obj for obj in it if obj not in seen)


try:
    closerange = os.closerange
except AttributeError:

    def closerange(fd_low, fd_high):  # noqa
        for fd in reversed(range(fd_low, fd_high)):
            try:
                os.close(fd)
            except OSError as exc:
                if exc.errno != errno.EBADF:
                    raise

    def close_open_fds(keep=None):
        # must make sure this is 0-inclusive (Issue #celery/1882)
        keep = list(uniq(sorted(
            f for f in map(maybe_fileno, keep or []) if f is not None
        )))
        maxfd = get_fdmax(default=2048)
        kL, kH = iter([-1] + keep), iter(keep + [maxfd])
        for low, high in zip_longest(kL, kH):
            if low + 1 != high:
                closerange(low + 1, high)
else:
    def close_open_fds(keep=None):  # noqa
        keep = [maybe_fileno(f)
                for f in (keep or []) if maybe_fileno(f) is not None]
        for fd in reversed(range(get_fdmax(default=2048))):
            if fd not in keep:
                try:
                    os.close(fd)
                except OSError as exc:
                    if exc.errno != errno.EBADF:
                        raise


def get_errno(exc):
    """:exc:`socket.error` and :exc:`IOError` first got
    the ``.errno`` attribute in Py2.7"""
    try:
        return exc.errno
    except AttributeError:
        return 0


try:
    import _posixsubprocess
except ImportError:
    def spawnv_passfds(path, args, passfds):
        if sys.platform != 'win32':
            # when not using _posixsubprocess (on earlier python) and not on
            # windows, we want to keep stdout/stderr open...
            passfds = passfds + [
                maybe_fileno(sys.stdout),
                maybe_fileno(sys.stderr),
            ]
        pid = os.fork()
        if not pid:
            close_open_fds(keep=sorted(f for f in passfds if f))
            os.execv(fsencode(path), args)
        return pid
else:
    def spawnv_passfds(path, args, passfds):
        passfds = sorted(passfds)
        errpipe_read, errpipe_write = os.pipe()
        try:
            args = [
                args, [fsencode(path)], True, tuple(passfds), None, None,
                -1, -1, -1, -1, -1, -1, errpipe_read, errpipe_write,
                False, False]
            if sys.version_info >= (3, 11):
                args.append(-1)  # process_group
            if sys.version_info >= (3, 9):
                args.extend((None, None, None, -1))  # group, extra_groups, user, umask
            args.append(None)  # preexec_fn
            if sys.version_info >= (3, 11):
                args.append(subprocess._USE_VFORK)
            return _posixsubprocess.fork_exec(*args)
        finally:
            os.close(errpipe_read)
            os.close(errpipe_write)


if sys.platform == 'win32':

    def setblocking(handle, blocking):
        raise NotImplementedError('setblocking not implemented on win32')

    def isblocking(handle):
        raise NotImplementedError('isblocking not implemented on win32')

else:
    from os import O_NONBLOCK
    from fcntl import fcntl, F_GETFL, F_SETFL

    def isblocking(handle):  # noqa
        return not (fcntl(handle, F_GETFL) & O_NONBLOCK)

    def setblocking(handle, blocking):  # noqa
        flags = fcntl(handle, F_GETFL, 0)
        fcntl(
            handle, F_SETFL,
            flags & (~O_NONBLOCK) if blocking else flags | O_NONBLOCK,
        )


E_PSUTIL_MISSING = """
On Windows, the ability to inspect memory usage requires the psutil library.

You can install it using pip:

    $ pip install psutil
"""


E_RESOURCE_MISSING = """
Your platform ({0}) does not seem to have the `resource.getrusage' function.

Please open an issue so that we can add support for this platform.
"""


if sys.platform == 'win32':

    try:
        import psutil
    except ImportError:  # pragma: no cover
        psutil = None    # noqa

    def mem_rss():
        # type () -> int
        if psutil is None:
            raise ImportError(E_PSUTIL_MISSING.strip())
        return int(psutil.Process(os.getpid()).memory_info()[0] / 1024.0)

else:
    try:
        from resource import getrusage, RUSAGE_SELF
    except ImportError:  # pragma: no cover
        getrusage = RUSAGE_SELF = None  # noqa

    if 'bsd' in sys.platform or sys.platform == 'darwin':
        # On BSD platforms :man:`getrusage(2)` ru_maxrss field is in bytes.

        def maxrss_to_kb(v):
            # type: (SupportsInt) -> int
            return int(v) / 1024.0

    else:
        # On Linux it's kilobytes.

        def maxrss_to_kb(v):
            # type: (SupportsInt) -> int
            return int(v)

    def mem_rss():
        # type () -> int
        if resource is None:
            raise ImportError(E_RESOURCE_MISSING.strip().format(sys.platform))
        return maxrss_to_kb(getrusage(RUSAGE_SELF).ru_maxrss)
