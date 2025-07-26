#
# Module providing various facilities to other parts of the package
#
# billiard/util.py
#
# Copyright (c) 2006-2008, R Oudkerk --- see COPYING.txt
# Licensed to PSF under a Contributor Agreement.
#

import sys
import errno
import functools
import atexit

try:
    import cffi
except ImportError:
    import ctypes

try:
    from subprocess import _args_from_interpreter_flags  # noqa
except ImportError:  # pragma: no cover
    def _args_from_interpreter_flags():  # noqa
        """Return a list of command-line arguments reproducing the current
        settings in sys.flags and sys.warnoptions."""
        flag_opt_map = {
            'debug': 'd',
            'optimize': 'O',
            'dont_write_bytecode': 'B',
            'no_user_site': 's',
            'no_site': 'S',
            'ignore_environment': 'E',
            'verbose': 'v',
            'bytes_warning': 'b',
            'hash_randomization': 'R',
            'py3k_warning': '3',
        }
        args = []
        for flag, opt in flag_opt_map.items():
            v = getattr(sys.flags, flag)
            if v > 0:
                args.append('-' + opt * v)
        for opt in sys.warnoptions:
            args.append('-W' + opt)
        return args

from multiprocessing.util import (  # noqa
    _afterfork_registry,
    _afterfork_counter,
    _exit_function,
    _finalizer_registry,
    _finalizer_counter,
    Finalize,
    ForkAwareLocal,
    ForkAwareThreadLock,
    get_temp_dir,
    is_exiting,
    register_after_fork,
    _run_after_forkers,
    _run_finalizers,
)

from .compat import get_errno

__all__ = [
    'sub_debug', 'debug', 'info', 'sub_warning', 'get_logger',
    'log_to_stderr', 'get_temp_dir', 'register_after_fork',
    'is_exiting', 'Finalize', 'ForkAwareThreadLock', 'ForkAwareLocal',
    'SUBDEBUG', 'SUBWARNING',
]


# Constants from prctl.h
PR_GET_PDEATHSIG = 2
PR_SET_PDEATHSIG = 1

#
# Logging
#

NOTSET = 0
SUBDEBUG = 5
DEBUG = 10
INFO = 20
SUBWARNING = 25
WARNING = 30
ERROR = 40

LOGGER_NAME = 'multiprocessing'
DEFAULT_LOGGING_FORMAT = '[%(levelname)s/%(processName)s] %(message)s'

_logger = None
_log_to_stderr = False


def sub_debug(msg, *args, **kwargs):
    if _logger:
        _logger.log(SUBDEBUG, msg, *args, **kwargs)


def debug(msg, *args, **kwargs):
    if _logger:
        _logger.log(DEBUG, msg, *args, **kwargs)


def info(msg, *args, **kwargs):
    if _logger:
        _logger.log(INFO, msg, *args, **kwargs)


def sub_warning(msg, *args, **kwargs):
    if _logger:
        _logger.log(SUBWARNING, msg, *args, **kwargs)

def warning(msg, *args, **kwargs):
    if _logger:
        _logger.log(WARNING, msg, *args, **kwargs)

def error(msg, *args, **kwargs):
    if _logger:
        _logger.log(ERROR, msg, *args, **kwargs)


def get_logger():
    '''
    Returns logger used by multiprocessing
    '''
    global _logger
    import logging

    try:
        # Python 3.13+
        acquire, release = logging._prepareFork, logging._afterFork
    except AttributeError:
        acquire, release = logging._acquireLock, logging._releaseLock
    acquire()
    try:
        if not _logger:

            _logger = logging.getLogger(LOGGER_NAME)
            _logger.propagate = 0
            logging.addLevelName(SUBDEBUG, 'SUBDEBUG')
            logging.addLevelName(SUBWARNING, 'SUBWARNING')

            # XXX multiprocessing should cleanup before logging
            if hasattr(atexit, 'unregister'):
                atexit.unregister(_exit_function)
                atexit.register(_exit_function)
            else:
                atexit._exithandlers.remove((_exit_function, (), {}))
                atexit._exithandlers.append((_exit_function, (), {}))
    finally:
        release()

    return _logger


def log_to_stderr(level=None):
    '''
    Turn on logging and add a handler which prints to stderr
    '''
    global _log_to_stderr
    import logging

    logger = get_logger()
    formatter = logging.Formatter(DEFAULT_LOGGING_FORMAT)
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    if level:
        logger.setLevel(level)
    _log_to_stderr = True
    return _logger


def get_pdeathsig():
    """
    Return the current value of the parent process death signal
    """
    if not sys.platform.startswith('linux'):
        # currently we support only linux platform.
        raise OSError()
    try:
        if 'cffi' in sys.modules:
            ffi = cffi.FFI()
            ffi.cdef("int prctl (int __option, ...);")
            arg = ffi.new("int *")
            C = ffi.dlopen(None)
            C.prctl(PR_GET_PDEATHSIG, arg)
            return arg[0]
        else:
            sig = ctypes.c_int()
            libc = ctypes.cdll.LoadLibrary("libc.so.6")
            libc.prctl(PR_GET_PDEATHSIG, ctypes.byref(sig))
            return sig.value
    except Exception:
        raise OSError()


def set_pdeathsig(sig):
    """
    Set the parent process death signal of the calling process to sig
    (either a signal value in the range 1..maxsig, or 0 to clear).
    This is the signal that the calling process will get when its parent dies.
    This value is cleared for the child of a fork(2) and
    (since Linux 2.4.36 / 2.6.23) when executing a set-user-ID or set-group-ID binary.
    """
    if not sys.platform.startswith('linux'):
        # currently we support only linux platform.
        raise OSError("pdeathsig is only supported on linux")
    try:
        if 'cffi' in sys.modules:
            ffi = cffi.FFI()
            ffi.cdef("int prctl (int __option, ...);")
            C = ffi.dlopen(None)
            C.prctl(PR_SET_PDEATHSIG, ffi.cast("int", sig))
        else:
            libc = ctypes.cdll.LoadLibrary("libc.so.6")
            libc.prctl(PR_SET_PDEATHSIG, ctypes.c_int(sig))
    except Exception as e:
        raise OSError("An error occured while setting pdeathsig") from e

def _eintr_retry(func):
    '''
    Automatic retry after EINTR.
    '''

    @functools.wraps(func)
    def wrapped(*args, **kwargs):
        while 1:
            try:
                return func(*args, **kwargs)
            except OSError as exc:
                if get_errno(exc) != errno.EINTR:
                    raise
    return wrapped
