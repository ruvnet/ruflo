#
# Module implementing queues
#
# multiprocessing/queues.py
#
# Copyright (c) 2006-2008, R Oudkerk
# Licensed to PSF under a Contributor Agreement.
#

import sys
import os
import threading
import collections
import weakref
import errno

from . import connection
from . import context

from .compat import get_errno
from time import monotonic
from queue import Empty, Full
from .util import (
    debug, error, info, Finalize, register_after_fork, is_exiting,
)
from .reduction import ForkingPickler

__all__ = ['Queue', 'SimpleQueue', 'JoinableQueue']


class Queue:
    '''
    Queue type using a pipe, buffer and thread
    '''
    def __init__(self, maxsize=0, *args, **kwargs):
        try:
            ctx = kwargs['ctx']
        except KeyError:
            raise TypeError('missing 1 required keyword-only argument: ctx')
        if maxsize <= 0:
            # Can raise ImportError (see issues #3770 and #23400)
            from .synchronize import SEM_VALUE_MAX as maxsize  # noqa
        self._maxsize = maxsize
        self._reader, self._writer = connection.Pipe(duplex=False)
        self._rlock = ctx.Lock()
        self._opid = os.getpid()
        if sys.platform == 'win32':
            self._wlock = None
        else:
            self._wlock = ctx.Lock()
        self._sem = ctx.BoundedSemaphore(maxsize)
        # For use by concurrent.futures
        self._ignore_epipe = False

        self._after_fork()

        if sys.platform != 'win32':
            register_after_fork(self, Queue._after_fork)

    def __getstate__(self):
        context.assert_spawning(self)
        return (self._ignore_epipe, self._maxsize, self._reader, self._writer,
                self._rlock, self._wlock, self._sem, self._opid)

    def __setstate__(self, state):
        (self._ignore_epipe, self._maxsize, self._reader, self._writer,
         self._rlock, self._wlock, self._sem, self._opid) = state
        self._after_fork()

    def _after_fork(self):
        debug('Queue._after_fork()')
        self._notempty = threading.Condition(threading.Lock())
        self._buffer = collections.deque()
        self._thread = None
        self._jointhread = None
        self._joincancelled = False
        self._closed = False
        self._close = None
        self._send_bytes = self._writer.send
        self._recv = self._reader.recv
        self._send_bytes = self._writer.send_bytes
        self._recv_bytes = self._reader.recv_bytes
        self._poll = self._reader.poll

    def put(self, obj, block=True, timeout=None):
        assert not self._closed
        if not self._sem.acquire(block, timeout):
            raise Full

        with self._notempty:
            if self._thread is None:
                self._start_thread()
            self._buffer.append(obj)
            self._notempty.notify()

    def get(self, block=True, timeout=None):
        if block and timeout is None:
            with self._rlock:
                res = self._recv_bytes()
            self._sem.release()

        else:
            if block:
                deadline = monotonic() + timeout
            if not self._rlock.acquire(block, timeout):
                raise Empty
            try:
                if block:
                    timeout = deadline - monotonic()
                    if timeout < 0 or not self._poll(timeout):
                        raise Empty
                elif not self._poll():
                    raise Empty
                res = self._recv_bytes()
                self._sem.release()
            finally:
                self._rlock.release()
        # unserialize the data after having released the lock
        return ForkingPickler.loads(res)

    def qsize(self):
        # Raises NotImplementedError on macOS because
        # of broken sem_getvalue()
        return self._maxsize - self._sem._semlock._get_value()

    def empty(self):
        return not self._poll()

    def full(self):
        return self._sem._semlock._is_zero()

    def get_nowait(self):
        return self.get(False)

    def put_nowait(self, obj):
        return self.put(obj, False)

    def close(self):
        self._closed = True
        try:
            self._reader.close()
        finally:
            close = self._close
            if close:
                self._close = None
                close()

    def join_thread(self):
        debug('Queue.join_thread()')
        assert self._closed
        if self._jointhread:
            self._jointhread()

    def cancel_join_thread(self):
        debug('Queue.cancel_join_thread()')
        self._joincancelled = True
        try:
            self._jointhread.cancel()
        except AttributeError:
            pass

    def _start_thread(self):
        debug('Queue._start_thread()')

        # Start thread which transfers data from buffer to pipe
        self._buffer.clear()
        self._thread = threading.Thread(
            target=Queue._feed,
            args=(self._buffer, self._notempty, self._send_bytes,
                  self._wlock, self._writer.close, self._ignore_epipe),
            name='QueueFeederThread'
        )
        self._thread.daemon = True

        debug('doing self._thread.start()')
        self._thread.start()
        debug('... done self._thread.start()')

        # On process exit we will wait for data to be flushed to pipe.
        #
        # However, if this process created the queue then all
        # processes which use the queue will be descendants of this
        # process.  Therefore waiting for the queue to be flushed
        # is pointless once all the child processes have been joined.
        created_by_this_process = (self._opid == os.getpid())
        if not self._joincancelled and not created_by_this_process:
            self._jointhread = Finalize(
                self._thread, Queue._finalize_join,
                [weakref.ref(self._thread)],
                exitpriority=-5
            )

        # Send sentinel to the thread queue object when garbage collected
        self._close = Finalize(
            self, Queue._finalize_close,
            [self._buffer, self._notempty],
            exitpriority=10
        )

    @staticmethod
    def _finalize_join(twr):
        debug('joining queue thread')
        thread = twr()
        if thread is not None:
            thread.join()
            debug('... queue thread joined')
        else:
            debug('... queue thread already dead')

    @staticmethod
    def _finalize_close(buffer, notempty):
        debug('telling queue thread to quit')
        with notempty:
            buffer.append(_sentinel)
            notempty.notify()

    @staticmethod
    def _feed(buffer, notempty, send_bytes, writelock, close, ignore_epipe):
        debug('starting thread to feed data to pipe')

        nacquire = notempty.acquire
        nrelease = notempty.release
        nwait = notempty.wait
        bpopleft = buffer.popleft
        sentinel = _sentinel
        if sys.platform != 'win32':
            wacquire = writelock.acquire
            wrelease = writelock.release
        else:
            wacquire = None

        try:
            while 1:
                nacquire()
                try:
                    if not buffer:
                        nwait()
                finally:
                    nrelease()
                try:
                    while 1:
                        obj = bpopleft()
                        if obj is sentinel:
                            debug('feeder thread got sentinel -- exiting')
                            close()
                            return

                        # serialize the data before acquiring the lock
                        obj = ForkingPickler.dumps(obj)
                        if wacquire is None:
                            send_bytes(obj)
                        else:
                            wacquire()
                            try:
                                send_bytes(obj)
                            finally:
                                wrelease()
                except IndexError:
                    pass
        except Exception as exc:
            if ignore_epipe and get_errno(exc) == errno.EPIPE:
                return
            # Since this runs in a daemon thread the resources it uses
            # may be become unusable while the process is cleaning up.
            # We ignore errors which happen after the process has
            # started to cleanup.
            try:
                if is_exiting():
                    info('error in queue thread: %r', exc, exc_info=True)
                else:
                    if not error('error in queue thread: %r', exc,
                                 exc_info=True):
                        import traceback
                        traceback.print_exc()
            except Exception:
                pass

_sentinel = object()


class JoinableQueue(Queue):
    '''
    A queue type which also supports join() and task_done() methods

    Note that if you do not call task_done() for each finished task then
    eventually the counter's semaphore may overflow causing Bad Things
    to happen.
    '''

    def __init__(self, maxsize=0, *args, **kwargs):
        try:
            ctx = kwargs['ctx']
        except KeyError:
            raise TypeError('missing 1 required keyword argument: ctx')
        Queue.__init__(self, maxsize, ctx=ctx)
        self._unfinished_tasks = ctx.Semaphore(0)
        self._cond = ctx.Condition()

    def __getstate__(self):
        return Queue.__getstate__(self) + (self._cond, self._unfinished_tasks)

    def __setstate__(self, state):
        Queue.__setstate__(self, state[:-2])
        self._cond, self._unfinished_tasks = state[-2:]

    def put(self, obj, block=True, timeout=None):
        assert not self._closed
        if not self._sem.acquire(block, timeout):
            raise Full

        with self._notempty:
            with self._cond:
                if self._thread is None:
                    self._start_thread()
                self._buffer.append(obj)
                self._unfinished_tasks.release()
                self._notempty.notify()

    def task_done(self):
        with self._cond:
            if not self._unfinished_tasks.acquire(False):
                raise ValueError('task_done() called too many times')
            if self._unfinished_tasks._semlock._is_zero():
                self._cond.notify_all()

    def join(self):
        with self._cond:
            if not self._unfinished_tasks._semlock._is_zero():
                self._cond.wait()


class _SimpleQueue:
    '''
    Simplified Queue type -- really just a locked pipe
    '''

    def __init__(self, rnonblock=False, wnonblock=False, ctx=None):
        self._reader, self._writer = connection.Pipe(
            duplex=False, rnonblock=rnonblock, wnonblock=wnonblock,
        )
        self._poll = self._reader.poll
        self._rlock = self._wlock = None

    def empty(self):
        return not self._poll()

    def __getstate__(self):
        context.assert_spawning(self)
        return (self._reader, self._writer, self._rlock, self._wlock)

    def __setstate__(self, state):
        (self._reader, self._writer, self._rlock, self._wlock) = state

    def get_payload(self):
        return self._reader.recv_bytes()

    def send_payload(self, value):
        self._writer.send_bytes(value)

    def get(self):
        # unserialize the data after having released the lock
        return ForkingPickler.loads(self.get_payload())

    def put(self, obj):
        # serialize the data before acquiring the lock
        self.send_payload(ForkingPickler.dumps(obj))

    def close(self):
        if self._reader is not None:
            try:
                self._reader.close()
            finally:
                self._reader = None

        if self._writer is not None:
            try:
                self._writer.close()
            finally:
                self._writer = None


class SimpleQueue(_SimpleQueue):

    def __init__(self, *args, **kwargs):
        try:
            ctx = kwargs['ctx']
        except KeyError:
            raise TypeError('missing required keyword argument: ctx')
        self._reader, self._writer = connection.Pipe(duplex=False)
        self._rlock = ctx.Lock()
        self._wlock = ctx.Lock() if sys.platform != 'win32' else None

    def get_payload(self):
        with self._rlock:
            return self._reader.recv_bytes()

    def send_payload(self, value):
        if self._wlock is None:
            # writes to a message oriented win32 pipe are atomic
            self._writer.send_bytes(value)
        else:
            with self._wlock:
                self._writer.send_bytes(value)
