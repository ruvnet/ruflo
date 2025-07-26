#
# Module providing the `Process` class which emulates `threading.Thread`
#
# multiprocessing/process.py
#
# Copyright (c) 2006-2008, R Oudkerk
# Licensed to PSF under a Contributor Agreement.
#
#
# Imports
#

import os
import sys
import signal
import itertools
import logging
import threading
from _weakrefset import WeakSet

from multiprocessing import process as _mproc

try:
    ORIGINAL_DIR = os.path.abspath(os.getcwd())
except OSError:
    ORIGINAL_DIR = None

__all__ = ['BaseProcess', 'Process', 'current_process', 'active_children']

#
# Public functions
#


def current_process():
    '''
    Return process object representing the current process
    '''
    return _current_process


def _set_current_process(process):
    global _current_process
    _current_process = _mproc._current_process = process


def _cleanup():
    # check for processes which have finished
    for p in list(_children):
        if p._popen.poll() is not None:
            _children.discard(p)


def _maybe_flush(f):
    try:
        f.flush()
    except (AttributeError, EnvironmentError, NotImplementedError):
        pass


def active_children(_cleanup=_cleanup):
    '''
    Return list of process objects corresponding to live child processes
    '''
    try:
        _cleanup()
    except TypeError:
        # called after gc collect so _cleanup does not exist anymore
        return []
    return list(_children)


class BaseProcess:
    '''
    Process objects represent activity that is run in a separate process

    The class is analogous to `threading.Thread`
    '''

    def _Popen(self):
        raise NotImplementedError()

    def __init__(self, group=None, target=None, name=None,
                 args=(), kwargs={}, daemon=None, **_kw):
        assert group is None, 'group argument must be None for now'
        count = next(_process_counter)
        self._identity = _current_process._identity + (count, )
        self._config = _current_process._config.copy()
        self._parent_pid = os.getpid()
        self._popen = None
        self._target = target
        self._args = tuple(args)
        self._kwargs = dict(kwargs)
        self._name = (
            name or type(self).__name__ + '-' +
            ':'.join(str(i) for i in self._identity)
        )
        if daemon is not None:
            self.daemon = daemon
        if _dangling is not None:
            _dangling.add(self)
        
        self._controlled_termination = False

    def run(self):
        '''
        Method to be run in sub-process; can be overridden in sub-class
        '''
        if self._target:
            self._target(*self._args, **self._kwargs)

    def start(self):
        '''
        Start child process
        '''
        assert self._popen is None, 'cannot start a process twice'
        assert self._parent_pid == os.getpid(), \
            'can only start a process object created by current process'
        _cleanup()
        self._popen = self._Popen(self)
        self._sentinel = self._popen.sentinel
        _children.add(self)

    def close(self):
        if self._popen is not None:
            self._popen.close()

    def terminate(self):
        '''
        Terminate process; sends SIGTERM signal or uses TerminateProcess()
        '''
        self._popen.terminate()
        
    def terminate_controlled(self):
        self._controlled_termination = True
        self.terminate()

    def join(self, timeout=None):
        '''
        Wait until child process terminates
        '''
        assert self._parent_pid == os.getpid(), 'can only join a child process'
        assert self._popen is not None, 'can only join a started process'
        res = self._popen.wait(timeout)
        if res is not None:
            _children.discard(self)
            self.close()

    def is_alive(self):
        '''
        Return whether process is alive
        '''
        if self is _current_process:
            return True
        assert self._parent_pid == os.getpid(), 'can only test a child process'
        if self._popen is None:
            return False
        self._popen.poll()
        return self._popen.returncode is None

    def _is_alive(self):
        if self._popen is None:
            return False
        return self._popen.poll() is None

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, name):   # noqa
        assert isinstance(name, str), 'name must be a string'
        self._name = name

    @property
    def daemon(self):
        '''
        Return whether process is a daemon
        '''
        return self._config.get('daemon', False)

    @daemon.setter  # noqa
    def daemon(self, daemonic):
        '''
        Set whether process is a daemon
        '''
        assert self._popen is None, 'process has already started'
        self._config['daemon'] = daemonic

    @property
    def authkey(self):
        return self._config['authkey']

    @authkey.setter  # noqa
    def authkey(self, authkey):
        '''
        Set authorization key of process
        '''
        self._config['authkey'] = AuthenticationString(authkey)

    @property
    def exitcode(self):
        '''
        Return exit code of process or `None` if it has yet to stop
        '''
        if self._popen is None:
            return self._popen
        return self._popen.poll()

    @property
    def ident(self):
        '''
        Return identifier (PID) of process or `None` if it has yet to start
        '''
        if self is _current_process:
            return os.getpid()
        else:
            return self._popen and self._popen.pid

    pid = ident

    @property
    def sentinel(self):
        '''
        Return a file descriptor (Unix) or handle (Windows) suitable for
        waiting for process termination.
        '''
        try:
            return self._sentinel
        except AttributeError:
            raise ValueError("process not started")

    @property
    def _counter(self):
        # compat for 2.7
        return _process_counter

    @property
    def _children(self):
        # compat for 2.7
        return _children

    @property
    def _authkey(self):
        # compat for 2.7
        return self.authkey

    @property
    def _daemonic(self):
        # compat for 2.7
        return self.daemon

    @property
    def _tempdir(self):
        # compat for 2.7
        return self._config.get('tempdir')

    def __repr__(self):
        if self is _current_process:
            status = 'started'
        elif self._parent_pid != os.getpid():
            status = 'unknown'
        elif self._popen is None:
            status = 'initial'
        else:
            if self._popen.poll() is not None:
                status = self.exitcode
            else:
                status = 'started'

        if type(status) is int:
            if status == 0:
                status = 'stopped'
            else:
                status = 'stopped[%s]' % _exitcode_to_name.get(status, status)

        return '<%s(%s, %s%s)>' % (type(self).__name__, self._name,
                                   status, self.daemon and ' daemon' or '')

    ##

    def _bootstrap(self):
        from . import util, context
        global _current_process, _process_counter, _children

        try:
            if self._start_method is not None:
                context._force_start_method(self._start_method)
            _process_counter = itertools.count(1)
            _children = set()
            if sys.stdin is not None:
                try:
                    sys.stdin.close()
                    sys.stdin = open(os.devnull)
                except (EnvironmentError, OSError, ValueError):
                    pass
            old_process = _current_process
            _set_current_process(self)

            # Re-init logging system.
            # Workaround for https://bugs.python.org/issue6721/#msg140215
            # Python logging module uses RLock() objects which are broken
            # after fork. This can result in a deadlock (Celery Issue #496).
            loggerDict = logging.Logger.manager.loggerDict
            logger_names = list(loggerDict.keys())
            logger_names.append(None)  # for root logger
            for name in logger_names:
                if not name or not isinstance(loggerDict[name],
                                              logging.PlaceHolder):
                    for handler in logging.getLogger(name).handlers:
                        handler.createLock()
            logging._lock = threading.RLock()

            try:
                util._finalizer_registry.clear()
                util._run_after_forkers()
            finally:
                # delay finalization of the old process object until after
                # _run_after_forkers() is executed
                del old_process
            util.info('child process %s calling self.run()', self.pid)
            try:
                self.run()
                exitcode = 0
            finally:
                util._exit_function()
        except SystemExit as exc:
            if not exc.args:
                exitcode = 1
            elif isinstance(exc.args[0], int):
                exitcode = exc.args[0]
            else:
                sys.stderr.write(str(exc.args[0]) + '\n')
                _maybe_flush(sys.stderr)
                exitcode = 0 if isinstance(exc.args[0], str) else 1
        except:
            exitcode = 1
            if not util.error('Process %s', self.name, exc_info=True):
                import traceback
                sys.stderr.write('Process %s:\n' % self.name)
                traceback.print_exc()
        finally:
            util.info('process %s exiting with exitcode %d',
                      self.pid, exitcode)
            _maybe_flush(sys.stdout)
            _maybe_flush(sys.stderr)

        return exitcode

#
# We subclass bytes to avoid accidental transmission of auth keys over network
#


class AuthenticationString(bytes):

    def __reduce__(self):
        from .context import get_spawning_popen

        if get_spawning_popen() is None:
            raise TypeError(
                'Pickling an AuthenticationString object is '
                'disallowed for security reasons')
        return AuthenticationString, (bytes(self),)

#
# Create object representing the main process
#


class _MainProcess(BaseProcess):

    def __init__(self):
        self._identity = ()
        self._name = 'MainProcess'
        self._parent_pid = None
        self._popen = None
        self._config = {'authkey': AuthenticationString(os.urandom(32)),
                        'semprefix': '/mp'}

_current_process = _MainProcess()
_process_counter = itertools.count(1)
_children = set()
del _MainProcess


Process = BaseProcess

#
# Give names to some return codes
#

_exitcode_to_name = {}

for name, signum in signal.__dict__.items():
    if name[:3] == 'SIG' and '_' not in name:
        _exitcode_to_name[-signum] = name

# For debug and leak testing
_dangling = WeakSet()
