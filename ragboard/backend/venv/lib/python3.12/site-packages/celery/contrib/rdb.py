"""Remote Debugger.

Introduction
============

This is a remote debugger for Celery tasks running in multiprocessing
pool workers.  Inspired by a lost post on dzone.com.

Usage
-----

.. code-block:: python

    from celery.contrib import rdb
    from celery import task

    @task()
    def add(x, y):
        result = x + y
        rdb.set_trace()
        return result

Environment Variables
=====================

.. envvar:: CELERY_RDB_HOST

``CELERY_RDB_HOST``
-------------------

    Hostname to bind to.  Default is '127.0.0.1' (only accessible from
    localhost).

.. envvar:: CELERY_RDB_PORT

``CELERY_RDB_PORT``
-------------------

    Base port to bind to.  Default is 6899.
    The debugger will try to find an available port starting from the
    base port.  The selected port will be logged by the worker.
"""
import errno
import os
import socket
import sys
from pdb import Pdb

from billiard.process import current_process

__all__ = (
    'CELERY_RDB_HOST', 'CELERY_RDB_PORT', 'DEFAULT_PORT',
    'Rdb', 'debugger', 'set_trace',
)

DEFAULT_PORT = 6899

CELERY_RDB_HOST = os.environ.get('CELERY_RDB_HOST') or '127.0.0.1'
CELERY_RDB_PORT = int(os.environ.get('CELERY_RDB_PORT') or DEFAULT_PORT)

#: Holds the currently active debugger.
_current = [None]

_frame = getattr(sys, '_getframe')

NO_AVAILABLE_PORT = """\
{self.ident}: Couldn't find an available port.

Please specify one using the CELERY_RDB_PORT environment variable.
"""

BANNER = """\
{self.ident}: Ready to connect: telnet {self.host} {self.port}

Type `exit` in session to continue.

{self.ident}: Waiting for client...
"""

SESSION_STARTED = '{self.ident}: Now in session with {self.remote_addr}.'
SESSION_ENDED = '{self.ident}: Session with {self.remote_addr} ended.'


class Rdb(Pdb):
    """Remote debugger."""

    me = 'Remote Debugger'
    _prev_outs = None
    _sock = None

    def __init__(self, host=CELERY_RDB_HOST, port=CELERY_RDB_PORT,
                 port_search_limit=100, port_skew=+0, out=sys.stdout):
        self.active = True
        self.out = out

        self._prev_handles = sys.stdin, sys.stdout

        self._sock, this_port = self.get_avail_port(
            host, port, port_search_limit, port_skew,
        )
        self._sock.setblocking(1)
        self._sock.listen(1)
        self.ident = f'{self.me}:{this_port}'
        self.host = host
        self.port = this_port
        self.say(BANNER.format(self=self))

        self._client, address = self._sock.accept()
        self._client.setblocking(1)
        self.remote_addr = ':'.join(str(v) for v in address)
        self.say(SESSION_STARTED.format(self=self))
        self._handle = sys.stdin = sys.stdout = self._client.makefile('rw')
        super().__init__(completekey='tab',
                         stdin=self._handle, stdout=self._handle)

    def get_avail_port(self, host, port, search_limit=100, skew=+0):
        try:
            _, skew = current_process().name.split('-')
            skew = int(skew)
        except ValueError:
            pass
        this_port = None
        for i in range(search_limit):
            _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            _sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            this_port = port + skew + i
            try:
                _sock.bind((host, this_port))
            except OSError as exc:
                if exc.errno in [errno.EADDRINUSE, errno.EINVAL]:
                    continue
                raise
            else:
                return _sock, this_port
        raise Exception(NO_AVAILABLE_PORT.format(self=self))

    def say(self, m):
        print(m, file=self.out)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self._close_session()

    def _close_session(self):
        self.stdin, self.stdout = sys.stdin, sys.stdout = self._prev_handles
        if self.active:
            if self._handle is not None:
                self._handle.close()
            if self._client is not None:
                self._client.close()
            if self._sock is not None:
                self._sock.close()
            self.active = False
            self.say(SESSION_ENDED.format(self=self))

    def do_continue(self, arg):
        self._close_session()
        self.set_continue()
        return 1
    do_c = do_cont = do_continue

    def do_quit(self, arg):
        self._close_session()
        self.set_quit()
        return 1
    do_q = do_exit = do_quit

    def set_quit(self):
        # this raises a BdbQuit exception that we're unable to catch.
        sys.settrace(None)


def debugger():
    """Return the current debugger instance, or create if none."""
    rdb = _current[0]
    if rdb is None or not rdb.active:
        rdb = _current[0] = Rdb()
    return rdb


def set_trace(frame=None):
    """Set break-point at current location, or a specified frame."""
    if frame is None:
        frame = _frame().f_back
    return debugger().set_trace(frame)
