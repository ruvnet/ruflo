#
# Module providing the `Pool` class for managing a process pool
#
# multiprocessing/pool.py
#
# Copyright (c) 2006-2008, R Oudkerk
# Licensed to PSF under a Contributor Agreement.
#

#
# Imports
#
import copy
import errno
import itertools
import os
import platform
import signal
import sys
import threading
import time
import warnings

from collections import deque
from functools import partial

from . import cpu_count, get_context
from . import util
from .common import (
    TERM_SIGNAL, human_status, pickle_loads, reset_signals, restart_state,
)
from .compat import get_errno, mem_rss, send_offset
from .einfo import ExceptionInfo
from .dummy import DummyProcess
from .exceptions import (
    CoroStop,
    RestartFreqExceeded,
    SoftTimeLimitExceeded,
    Terminated,
    TimeLimitExceeded,
    TimeoutError,
    WorkerLostError,
)
from time import monotonic
from queue import Queue, Empty
from .util import Finalize, debug, warning

MAXMEM_USED_FMT = """\
child process exiting after exceeding memory limit ({0}KiB / {1}KiB)
"""

PY3 = sys.version_info[0] == 3

if platform.system() == 'Windows':  # pragma: no cover
    # On Windows os.kill calls TerminateProcess which cannot be
    # handled by # any process, so this is needed to terminate the task
    # *and its children* (if any).
    from ._win import kill_processtree as _kill  # noqa
    SIGKILL = TERM_SIGNAL
else:
    from os import kill as _kill                 # noqa
    SIGKILL = signal.SIGKILL


try:
    TIMEOUT_MAX = threading.TIMEOUT_MAX
except AttributeError:  # pragma: no cover
    TIMEOUT_MAX = 1e10  # noqa


if sys.version_info >= (3, 3):
    _Semaphore = threading.Semaphore
else:
    # Semaphore is a factory function pointing to _Semaphore
    _Semaphore = threading._Semaphore  # noqa

#
# Constants representing the state of a pool
#

RUN = 0
CLOSE = 1
TERMINATE = 2

#
# Constants representing the state of a job
#

ACK = 0
READY = 1
TASK = 2
NACK = 3
DEATH = 4

#
# Exit code constants
#
EX_OK = 0
EX_FAILURE = 1
EX_RECYCLE = 0x9B


# Signal used for soft time limits.
SIG_SOFT_TIMEOUT = getattr(signal, "SIGUSR1", None)

#
# Miscellaneous
#

LOST_WORKER_TIMEOUT = 10.0
EX_OK = getattr(os, "EX_OK", 0)
GUARANTEE_MESSAGE_CONSUMPTION_RETRY_LIMIT = 300
GUARANTEE_MESSAGE_CONSUMPTION_RETRY_INTERVAL = 0.1

job_counter = itertools.count()

Lock = threading.Lock


def _get_send_offset(connection):
    try:
        native = connection.send_offset
    except AttributeError:
        native = None
    if native is None:
        return partial(send_offset, connection.fileno())
    return native


def mapstar(args):
    return list(map(*args))


def starmapstar(args):
    return list(itertools.starmap(args[0], args[1]))


def error(msg, *args, **kwargs):
    util.get_logger().error(msg, *args, **kwargs)


def stop_if_not_current(thread, timeout=None):
    if thread is not threading.current_thread():
        thread.stop(timeout)


class LaxBoundedSemaphore(_Semaphore):
    """Semaphore that checks that # release is <= # acquires,
    but ignores if # releases >= value."""

    def shrink(self):
        self._initial_value -= 1
        self.acquire()

    if PY3:

        def __init__(self, value=1, verbose=None):
            _Semaphore.__init__(self, value)
            self._initial_value = value

        def grow(self):
            with self._cond:
                self._initial_value += 1
                self._value += 1
                self._cond.notify()

        def release(self):
            cond = self._cond
            with cond:
                if self._value < self._initial_value:
                    self._value += 1
                    cond.notify_all()

        def clear(self):
            while self._value < self._initial_value:
                _Semaphore.release(self)
    else:

        def __init__(self, value=1, verbose=None):
            _Semaphore.__init__(self, value, verbose)
            self._initial_value = value

        def grow(self):
            cond = self._Semaphore__cond
            with cond:
                self._initial_value += 1
                self._Semaphore__value += 1
                cond.notify()

        def release(self):  # noqa
            cond = self._Semaphore__cond
            with cond:
                if self._Semaphore__value < self._initial_value:
                    self._Semaphore__value += 1
                    cond.notifyAll()

        def clear(self):  # noqa
            while self._Semaphore__value < self._initial_value:
                _Semaphore.release(self)

#
# Exceptions
#


class MaybeEncodingError(Exception):
    """Wraps possible unpickleable errors, so they can be
    safely sent through the socket."""

    def __init__(self, exc, value):
        self.exc = repr(exc)
        self.value = repr(value)
        super().__init__(self.exc, self.value)

    def __repr__(self):
        return "<%s: %s>" % (self.__class__.__name__, str(self))

    def __str__(self):
        return "Error sending result: '%r'. Reason: '%r'." % (
            self.value, self.exc)


class WorkersJoined(Exception):
    """All workers have terminated."""


def soft_timeout_sighandler(signum, frame):
    raise SoftTimeLimitExceeded()

#
# Code run by worker processes
#


class Worker:

    def __init__(self, inq, outq, synq=None, initializer=None, initargs=(),
                 maxtasks=None, sentinel=None, on_exit=None,
                 sigprotection=True, wrap_exception=True,
                 max_memory_per_child=None, on_ready_counter=None):
        assert maxtasks is None or (type(maxtasks) == int and maxtasks > 0)
        self.initializer = initializer
        self.initargs = initargs
        self.maxtasks = maxtasks
        self.max_memory_per_child = max_memory_per_child
        self._shutdown = sentinel
        self.on_exit = on_exit
        self.sigprotection = sigprotection
        self.inq, self.outq, self.synq = inq, outq, synq
        self.wrap_exception = wrap_exception  # XXX cannot disable yet
        self.on_ready_counter = on_ready_counter
        self.contribute_to_object(self)

    def contribute_to_object(self, obj):
        obj.inq, obj.outq, obj.synq = self.inq, self.outq, self.synq
        obj.inqW_fd = self.inq._writer.fileno()    # inqueue write fd
        obj.outqR_fd = self.outq._reader.fileno()  # outqueue read fd
        if self.synq:
            obj.synqR_fd = self.synq._reader.fileno()  # synqueue read fd
            obj.synqW_fd = self.synq._writer.fileno()  # synqueue write fd
            obj.send_syn_offset = _get_send_offset(self.synq._writer)
        else:
            obj.synqR_fd = obj.synqW_fd = obj._send_syn_offset = None
        obj._quick_put = self.inq._writer.send
        obj._quick_get = self.outq._reader.recv
        obj.send_job_offset = _get_send_offset(self.inq._writer)
        return obj

    def __reduce__(self):
        return self.__class__, (
            self.inq, self.outq, self.synq, self.initializer,
            self.initargs, self.maxtasks, self._shutdown, self.on_exit,
            self.sigprotection, self.wrap_exception, self.max_memory_per_child,
            self.on_ready_counter
        )

    def __call__(self):
        _exit = sys.exit
        _exitcode = [None]

        def exit(status=None):
            _exitcode[0] = status
            return _exit(status)
        sys.exit = exit

        pid = os.getpid()

        self._make_child_methods()
        self.after_fork()
        self.on_loop_start(pid=pid)  # callback on loop start
        try:
            sys.exit(self.workloop(pid=pid))
        except Exception as exc:
            error('Pool process %r error: %r', self, exc, exc_info=1)
            self._do_exit(pid, _exitcode[0], exc)
        finally:
            self._do_exit(pid, _exitcode[0], None)

    def _do_exit(self, pid, exitcode, exc=None):
        if exitcode is None:
            exitcode = EX_FAILURE if exc else EX_OK

        if self.on_exit is not None:
            self.on_exit(pid, exitcode)

        if sys.platform != 'win32':
            try:
                self.outq.put((DEATH, (pid, exitcode)))
                time.sleep(1)
            finally:
                os._exit(exitcode)
        else:
            os._exit(exitcode)

    def on_loop_start(self, pid):
        pass

    def prepare_result(self, result):
        return result

    def workloop(self, debug=debug, now=monotonic, pid=None):
        pid = pid or os.getpid()
        put = self.outq.put
        inqW_fd = self.inqW_fd
        synqW_fd = self.synqW_fd
        maxtasks = self.maxtasks
        max_memory_per_child = self.max_memory_per_child or 0
        prepare_result = self.prepare_result

        wait_for_job = self.wait_for_job
        _wait_for_syn = self.wait_for_syn

        def wait_for_syn(jid):
            i = 0
            while 1:
                if i > 60:
                    error('!!!WAIT FOR ACK TIMEOUT: job:%r fd:%r!!!',
                          jid, self.synq._reader.fileno(), exc_info=1)
                req = _wait_for_syn()
                if req:
                    type_, args = req
                    if type_ == NACK:
                        return False
                    assert type_ == ACK
                    return True
                i += 1

        completed = 0
        try:
            while maxtasks is None or (maxtasks and completed < maxtasks):
                req = wait_for_job()
                if req:
                    type_, args_ = req
                    assert type_ == TASK
                    job, i, fun, args, kwargs = args_
                    put((ACK, (job, i, now(), pid, synqW_fd)))
                    if _wait_for_syn:
                        confirm = wait_for_syn(job)
                        if not confirm:
                            continue  # received NACK
                    try:
                        result = (True, prepare_result(fun(*args, **kwargs)))
                    except Exception:
                        result = (False, ExceptionInfo())
                    try:
                        put((READY, (job, i, result, inqW_fd)))
                    except Exception as exc:
                        _, _, tb = sys.exc_info()
                        try:
                            wrapped = MaybeEncodingError(exc, result[1])
                            einfo = ExceptionInfo((
                                MaybeEncodingError, wrapped, tb,
                            ))
                            put((READY, (job, i, (False, einfo), inqW_fd)))
                        finally:
                            del(tb)
                    completed += 1
                    if max_memory_per_child > 0:
                        used_kb = mem_rss()
                        if used_kb <= 0:
                            error('worker unable to determine memory usage')
                        if used_kb > 0 and used_kb > max_memory_per_child:
                            warning(MAXMEM_USED_FMT.format(
                                used_kb, max_memory_per_child))
                            return EX_RECYCLE

            debug('worker exiting after %d tasks', completed)
            if maxtasks:
                return EX_RECYCLE if completed == maxtasks else EX_FAILURE
            return EX_OK
        finally:
            # Before exiting the worker, we want to ensure that that all
            # messages produced by the worker have been consumed by the main
            # process. This prevents the worker being terminated prematurely
            # and messages being lost.
            self._ensure_messages_consumed(completed=completed)

    def _ensure_messages_consumed(self, completed):
        """ Returns true if all messages sent out have been received and
        consumed within a reasonable amount of time """

        if not self.on_ready_counter:
            return False

        for retry in range(GUARANTEE_MESSAGE_CONSUMPTION_RETRY_LIMIT):
            if self.on_ready_counter.value >= completed:
                debug('ensured messages consumed after %d retries', retry)
                return True
            time.sleep(GUARANTEE_MESSAGE_CONSUMPTION_RETRY_INTERVAL)
        warning('could not ensure all messages were consumed prior to '
                'exiting')
        return False

    def after_fork(self):
        if hasattr(self.inq, '_writer'):
            self.inq._writer.close()
        if hasattr(self.outq, '_reader'):
            self.outq._reader.close()

        if self.initializer is not None:
            self.initializer(*self.initargs)

        # Make sure all exiting signals call finally: blocks.
        # This is important for the semaphore to be released.
        reset_signals(full=self.sigprotection)

        # install signal handler for soft timeouts.
        if SIG_SOFT_TIMEOUT is not None:
            signal.signal(SIG_SOFT_TIMEOUT, soft_timeout_sighandler)

        try:
            signal.signal(signal.SIGINT, signal.SIG_IGN)
        except AttributeError:
            pass

    def _make_recv_method(self, conn):
        get = conn.get

        if hasattr(conn, '_reader'):
            _poll = conn._reader.poll
            if hasattr(conn, 'get_payload') and conn.get_payload:
                get_payload = conn.get_payload

                def _recv(timeout, loads=pickle_loads):
                    return True, loads(get_payload())
            else:
                def _recv(timeout):  # noqa
                    if _poll(timeout):
                        return True, get()
                    return False, None
        else:
            def _recv(timeout):  # noqa
                try:
                    return True, get(timeout=timeout)
                except Queue.Empty:
                    return False, None
        return _recv

    def _make_child_methods(self, loads=pickle_loads):
        self.wait_for_job = self._make_protected_receive(self.inq)
        self.wait_for_syn = (self._make_protected_receive(self.synq)
                             if self.synq else None)

    def _make_protected_receive(self, conn):
        _receive = self._make_recv_method(conn)
        should_shutdown = self._shutdown.is_set if self._shutdown else None

        def receive(debug=debug):
            if should_shutdown and should_shutdown():
                debug('worker got sentinel -- exiting')
                raise SystemExit(EX_OK)
            try:
                ready, req = _receive(1.0)
                if not ready:
                    return None
            except (EOFError, IOError) as exc:
                if get_errno(exc) == errno.EINTR:
                    return None  # interrupted, maybe by gdb
                debug('worker got %s -- exiting', type(exc).__name__)
                raise SystemExit(EX_FAILURE)
            if req is None:
                debug('worker got sentinel -- exiting')
                raise SystemExit(EX_FAILURE)
            return req

        return receive


#
# Class representing a process pool
#


class PoolThread(DummyProcess):

    def __init__(self, *args, **kwargs):
        DummyProcess.__init__(self)
        self._state = RUN
        self._was_started = False
        self.daemon = True

    def run(self):
        try:
            return self.body()
        except RestartFreqExceeded as exc:
            error("Thread %r crashed: %r", type(self).__name__, exc,
                  exc_info=1)
            _kill(os.getpid(), TERM_SIGNAL)
            sys.exit()
        except Exception as exc:
            error("Thread %r crashed: %r", type(self).__name__, exc,
                  exc_info=1)
            os._exit(1)

    def start(self, *args, **kwargs):
        self._was_started = True
        super(PoolThread, self).start(*args, **kwargs)

    def on_stop_not_started(self):
        pass

    def stop(self, timeout=None):
        if self._was_started:
            self.join(timeout)
            return
        self.on_stop_not_started()

    def terminate(self):
        self._state = TERMINATE

    def close(self):
        self._state = CLOSE


class Supervisor(PoolThread):

    def __init__(self, pool):
        self.pool = pool
        super().__init__()

    def body(self):
        debug('worker handler starting')

        time.sleep(0.8)

        pool = self.pool

        try:
            # do a burst at startup to verify that we can start
            # our pool processes, and in that time we lower
            # the max restart frequency.
            prev_state = pool.restart_state
            pool.restart_state = restart_state(10 * pool._processes, 1)
            for _ in range(10):
                if self._state == RUN and pool._state == RUN:
                    pool._maintain_pool()
                    time.sleep(0.1)

            # Keep maintaining workers until the cache gets drained, unless
            # the pool is terminated
            pool.restart_state = prev_state
            while self._state == RUN and pool._state == RUN:
                pool._maintain_pool()
                time.sleep(0.8)
        except RestartFreqExceeded:
            pool.close()
            pool.join()
            raise
        debug('worker handler exiting')


class TaskHandler(PoolThread):

    def __init__(self, taskqueue, put, outqueue, pool, cache):
        self.taskqueue = taskqueue
        self.put = put
        self.outqueue = outqueue
        self.pool = pool
        self.cache = cache
        super().__init__()

    def body(self):
        cache = self.cache
        taskqueue = self.taskqueue
        put = self.put

        for taskseq, set_length in iter(taskqueue.get, None):
            task = None
            i = -1
            try:
                for i, task in enumerate(taskseq):
                    if self._state:
                        debug('task handler found thread._state != RUN')
                        break
                    try:
                        put(task)
                    except IOError:
                        debug('could not put task on queue')
                        break
                    except Exception:
                        job, ind = task[:2]
                        try:
                            cache[job]._set(ind, (False, ExceptionInfo()))
                        except KeyError:
                            pass
                else:
                    if set_length:
                        debug('doing set_length()')
                        set_length(i + 1)
                    continue
                break
            except Exception:
                job, ind = task[:2] if task else (0, 0)
                if job in cache:
                    cache[job]._set(ind + 1, (False, ExceptionInfo()))
                if set_length:
                    util.debug('doing set_length()')
                    set_length(i + 1)
        else:
            debug('task handler got sentinel')

        self.tell_others()

    def tell_others(self):
        outqueue = self.outqueue
        put = self.put
        pool = self.pool

        try:
            # tell result handler to finish when cache is empty
            debug('task handler sending sentinel to result handler')
            outqueue.put(None)

            # tell workers there is no more work
            debug('task handler sending sentinel to workers')
            for p in pool:
                put(None)
        except IOError:
            debug('task handler got IOError when sending sentinels')

        debug('task handler exiting')

    def on_stop_not_started(self):
        self.tell_others()


class TimeoutHandler(PoolThread):

    def __init__(self, processes, cache, t_soft, t_hard):
        self.processes = processes
        self.cache = cache
        self.t_soft = t_soft
        self.t_hard = t_hard
        self._it = None
        super().__init__()

    def _process_by_pid(self, pid):
        return next((
            (proc, i) for i, proc in enumerate(self.processes)
            if proc.pid == pid
        ), (None, None))

    def on_soft_timeout(self, job):
        debug('soft time limit exceeded for %r', job)
        process, _index = self._process_by_pid(job._worker_pid)
        if not process:
            return

        # Run timeout callback
        job.handle_timeout(soft=True)

        try:
            _kill(job._worker_pid, SIG_SOFT_TIMEOUT)
        except OSError as exc:
            if get_errno(exc) != errno.ESRCH:
                raise

    def on_hard_timeout(self, job):
        if job.ready():
            return
        debug('hard time limit exceeded for %r', job)
        # Remove from cache and set return value to an exception
        try:
            raise TimeLimitExceeded(job._timeout)
        except TimeLimitExceeded:
            job._set(job._job, (False, ExceptionInfo()))
        else:  # pragma: no cover
            pass

        # Remove from _pool
        process, _index = self._process_by_pid(job._worker_pid)

        # Run timeout callback
        job.handle_timeout(soft=False)

        if process:
            self._trywaitkill(process)

    def _trywaitkill(self, worker):
        debug('timeout: sending TERM to %s', worker._name)
        try:
            if os.getpgid(worker.pid) == worker.pid:
                debug("worker %s is a group leader. It is safe to kill (SIGTERM) the whole group", worker.pid)
                os.killpg(os.getpgid(worker.pid), signal.SIGTERM)
            else:
                worker.terminate()
        except OSError:
            pass
        else:
            if worker._popen.wait(timeout=0.1):
                return
        debug('timeout: TERM timed-out, now sending KILL to %s', worker._name)
        try:
            if os.getpgid(worker.pid) == worker.pid:
                debug("worker %s is a group leader. It is safe to kill (SIGKILL) the whole group", worker.pid)
                os.killpg(os.getpgid(worker.pid), signal.SIGKILL)
            else:
                _kill(worker.pid, SIGKILL)
        except OSError:
            pass

    def handle_timeouts(self):
        t_hard, t_soft = self.t_hard, self.t_soft
        dirty = set()
        on_soft_timeout = self.on_soft_timeout
        on_hard_timeout = self.on_hard_timeout

        def _timed_out(start, timeout):
            if not start or not timeout:
                return False
            if monotonic() >= start + timeout:
                return True

        # Inner-loop
        while self._state == RUN:
            # Perform a shallow copy before iteration because keys can change.
            # A deep copy fails (on shutdown) due to thread.lock objects.
            # https://github.com/celery/billiard/issues/260
            cache = copy.copy(self.cache)

            # Remove dirty items not in cache anymore
            if dirty:
                dirty = set(k for k in dirty if k in cache)

            for i, job in cache.items():
                ack_time = job._time_accepted
                soft_timeout = job._soft_timeout
                if soft_timeout is None:
                    soft_timeout = t_soft
                hard_timeout = job._timeout
                if hard_timeout is None:
                    hard_timeout = t_hard
                if _timed_out(ack_time, hard_timeout):
                    on_hard_timeout(job)
                elif i not in dirty and _timed_out(ack_time, soft_timeout):
                    on_soft_timeout(job)
                    dirty.add(i)
            yield

    def body(self):
        while self._state == RUN:
            try:
                for _ in self.handle_timeouts():
                    time.sleep(1.0)  # don't spin
            except CoroStop:
                break
        debug('timeout handler exiting')

    def handle_event(self, *args):
        if self._it is None:
            self._it = self.handle_timeouts()
        try:
            next(self._it)
        except StopIteration:
            self._it = None


class ResultHandler(PoolThread):

    def __init__(self, outqueue, get, cache, poll,
                 join_exited_workers, putlock, restart_state,
                 check_timeouts, on_job_ready, on_ready_counters=None):
        self.outqueue = outqueue
        self.get = get
        self.cache = cache
        self.poll = poll
        self.join_exited_workers = join_exited_workers
        self.putlock = putlock
        self.restart_state = restart_state
        self._it = None
        self._shutdown_complete = False
        self.check_timeouts = check_timeouts
        self.on_job_ready = on_job_ready
        self.on_ready_counters = on_ready_counters
        self._make_methods()
        super().__init__()

    def on_stop_not_started(self):
        # used when pool started without result handler thread.
        self.finish_at_shutdown(handle_timeouts=True)

    def _make_methods(self):
        cache = self.cache
        putlock = self.putlock
        restart_state = self.restart_state
        on_job_ready = self.on_job_ready

        def on_ack(job, i, time_accepted, pid, synqW_fd):
            restart_state.R = 0
            try:
                cache[job]._ack(i, time_accepted, pid, synqW_fd)
            except (KeyError, AttributeError):
                # Object gone or doesn't support _ack (e.g. IMAPIterator).
                pass

        def on_ready(job, i, obj, inqW_fd):
            if on_job_ready is not None:
                on_job_ready(job, i, obj, inqW_fd)
            try:
                item = cache[job]
            except KeyError:
                return

            if self.on_ready_counters:
                worker_pid = next(iter(item.worker_pids()), None)
                if worker_pid and worker_pid in self.on_ready_counters:
                    on_ready_counter = self.on_ready_counters[worker_pid]
                    with on_ready_counter.get_lock():
                        on_ready_counter.value += 1

            if not item.ready():
                if putlock is not None:
                    putlock.release()
            try:
                item._set(i, obj)
            except KeyError:
                pass

        def on_death(pid, exitcode):
            try:
                os.kill(pid, TERM_SIGNAL)
            except OSError as exc:
                if get_errno(exc) != errno.ESRCH:
                    raise

        state_handlers = self.state_handlers = {
            ACK: on_ack, READY: on_ready, DEATH: on_death
        }

        def on_state_change(task):
            state, args = task
            try:
                state_handlers[state](*args)
            except KeyError:
                debug("Unknown job state: %s (args=%s)", state, args)
        self.on_state_change = on_state_change

    def _process_result(self, timeout=1.0):
        poll = self.poll
        on_state_change = self.on_state_change

        while 1:
            try:
                ready, task = poll(timeout)
            except (IOError, EOFError) as exc:
                debug('result handler got %r -- exiting', exc)
                raise CoroStop()

            if self._state:
                assert self._state == TERMINATE
                debug('result handler found thread._state=TERMINATE')
                raise CoroStop()

            if ready:
                if task is None:
                    debug('result handler got sentinel')
                    raise CoroStop()
                on_state_change(task)
                if timeout != 0:  # blocking
                    break
            else:
                break
            yield

    def handle_event(self, fileno=None, events=None):
        if self._state == RUN:
            if self._it is None:
                self._it = self._process_result(0)  # non-blocking
            try:
                next(self._it)
            except (StopIteration, CoroStop):
                self._it = None

    def body(self):
        debug('result handler starting')
        try:
            while self._state == RUN:
                try:
                    for _ in self._process_result(1.0):  # blocking
                        pass
                except CoroStop:
                    break
        finally:
            self.finish_at_shutdown()

    def finish_at_shutdown(self, handle_timeouts=False):
        self._shutdown_complete = True
        get = self.get
        outqueue = self.outqueue
        cache = self.cache
        poll = self.poll
        join_exited_workers = self.join_exited_workers
        check_timeouts = self.check_timeouts
        on_state_change = self.on_state_change

        time_terminate = None
        while cache and self._state != TERMINATE:
            if check_timeouts is not None:
                check_timeouts()
            try:
                ready, task = poll(1.0)
            except (IOError, EOFError) as exc:
                debug('result handler got %r -- exiting', exc)
                return

            if ready:
                if task is None:
                    debug('result handler ignoring extra sentinel')
                    continue

                on_state_change(task)
            try:
                join_exited_workers(shutdown=True)
            except WorkersJoined:
                now = monotonic()
                if not time_terminate:
                    time_terminate = now
                else:
                    if now - time_terminate > 5.0:
                        debug('result handler exiting: timed out')
                        break
                    debug('result handler: all workers terminated, '
                          'timeout in %ss',
                          abs(min(now - time_terminate - 5.0, 0)))

        if hasattr(outqueue, '_reader'):
            debug('ensuring that outqueue is not full')
            # If we don't make room available in outqueue then
            # attempts to add the sentinel (None) to outqueue may
            # block.  There is guaranteed to be no more than 2 sentinels.
            try:
                for i in range(10):
                    if not outqueue._reader.poll():
                        break
                    get()
            except (IOError, EOFError):
                pass

        debug('result handler exiting: len(cache)=%s, thread._state=%s',
              len(cache), self._state)


class Pool:
    '''
    Class which supports an async version of applying functions to arguments.
    '''
    _wrap_exception = True
    Worker = Worker
    Supervisor = Supervisor
    TaskHandler = TaskHandler
    TimeoutHandler = TimeoutHandler
    ResultHandler = ResultHandler
    SoftTimeLimitExceeded = SoftTimeLimitExceeded

    def __init__(self, processes=None, initializer=None, initargs=(),
                 maxtasksperchild=None, timeout=None, soft_timeout=None,
                 lost_worker_timeout=None,
                 max_restarts=None, max_restart_freq=1,
                 on_process_up=None,
                 on_process_down=None,
                 on_timeout_set=None,
                 on_timeout_cancel=None,
                 threads=True,
                 semaphore=None,
                 putlocks=False,
                 allow_restart=False,
                 synack=False,
                 on_process_exit=None,
                 context=None,
                 max_memory_per_child=None,
                 enable_timeouts=False,
                 **kwargs):
        self._ctx = context or get_context()
        self.synack = synack
        self._setup_queues()
        self._taskqueue = Queue()
        self._cache = {}
        self._state = RUN
        self.timeout = timeout
        self.soft_timeout = soft_timeout
        self._maxtasksperchild = maxtasksperchild
        self._max_memory_per_child = max_memory_per_child
        self._initializer = initializer
        self._initargs = initargs
        self._on_process_exit = on_process_exit
        self.lost_worker_timeout = lost_worker_timeout or LOST_WORKER_TIMEOUT
        self.on_process_up = on_process_up
        self.on_process_down = on_process_down
        self.on_timeout_set = on_timeout_set
        self.on_timeout_cancel = on_timeout_cancel
        self.threads = threads
        self.readers = {}
        self.allow_restart = allow_restart

        self.enable_timeouts = bool(
            enable_timeouts or
            self.timeout is not None or
            self.soft_timeout is not None
        )

        if soft_timeout and SIG_SOFT_TIMEOUT is None:
            warnings.warn(UserWarning(
                "Soft timeouts are not supported: "
                "on this platform: It does not have the SIGUSR1 signal.",
            ))
            soft_timeout = None

        self._processes = self.cpu_count() if processes is None else processes
        self.max_restarts = max_restarts or round(self._processes * 100)
        self.restart_state = restart_state(max_restarts, max_restart_freq or 1)

        if initializer is not None and not callable(initializer):
            raise TypeError('initializer must be a callable')

        if on_process_exit is not None and not callable(on_process_exit):
            raise TypeError('on_process_exit must be callable')

        self._Process = self._ctx.Process

        self._pool = []
        self._poolctrl = {}
        self._on_ready_counters = {}
        self.putlocks = putlocks
        self._putlock = semaphore or LaxBoundedSemaphore(self._processes)
        for i in range(self._processes):
            self._create_worker_process(i)

        self._worker_handler = self.Supervisor(self)
        if threads:
            self._worker_handler.start()

        self._task_handler = self.TaskHandler(self._taskqueue,
                                              self._quick_put,
                                              self._outqueue,
                                              self._pool,
                                              self._cache)
        if threads:
            self._task_handler.start()

        self.check_timeouts = None

        # Thread killing timedout jobs.
        if self.enable_timeouts:
            self._timeout_handler = self.TimeoutHandler(
                self._pool, self._cache,
                self.soft_timeout, self.timeout,
            )
            self._timeout_handler_mutex = Lock()
            self._timeout_handler_started = False
            self._start_timeout_handler()
            # If running without threads, we need to check for timeouts
            # while waiting for unfinished work at shutdown.
            if not threads:
                self.check_timeouts = self._timeout_handler.handle_event
        else:
            self._timeout_handler = None
            self._timeout_handler_started = False
            self._timeout_handler_mutex = None

        # Thread processing results in the outqueue.
        self._result_handler = self.create_result_handler()
        self.handle_result_event = self._result_handler.handle_event

        if threads:
            self._result_handler.start()

        self._terminate = Finalize(
            self, self._terminate_pool,
            args=(self._taskqueue, self._inqueue, self._outqueue,
                  self._pool, self._worker_handler, self._task_handler,
                  self._result_handler, self._cache,
                  self._timeout_handler,
                  self._help_stuff_finish_args()),
            exitpriority=15,
        )

    def Process(self, *args, **kwds):
        return self._Process(*args, **kwds)

    def WorkerProcess(self, worker):
        return worker.contribute_to_object(self.Process(target=worker))

    def create_result_handler(self, **extra_kwargs):
        return self.ResultHandler(
            self._outqueue, self._quick_get, self._cache,
            self._poll_result, self._join_exited_workers,
            self._putlock, self.restart_state, self.check_timeouts,
            self.on_job_ready, on_ready_counters=self._on_ready_counters,
            **extra_kwargs
        )

    def on_job_ready(self, job, i, obj, inqW_fd):
        pass

    def _help_stuff_finish_args(self):
        return self._inqueue, self._task_handler, self._pool

    def cpu_count(self):
        try:
            return cpu_count()
        except NotImplementedError:
            return 1

    def handle_result_event(self, *args):
        return self._result_handler.handle_event(*args)

    def _process_register_queues(self, worker, queues):
        pass

    def _process_by_pid(self, pid):
        return next((
            (proc, i) for i, proc in enumerate(self._pool)
            if proc.pid == pid
        ), (None, None))

    def get_process_queues(self):
        return self._inqueue, self._outqueue, None

    def _create_worker_process(self, i):
        sentinel = self._ctx.Event() if self.allow_restart else None
        inq, outq, synq = self.get_process_queues()
        on_ready_counter = self._ctx.Value('i')
        w = self.WorkerProcess(self.Worker(
            inq, outq, synq, self._initializer, self._initargs,
            self._maxtasksperchild, sentinel, self._on_process_exit,
            # Need to handle all signals if using the ipc semaphore,
            # to make sure the semaphore is released.
            sigprotection=self.threads,
            wrap_exception=self._wrap_exception,
            max_memory_per_child=self._max_memory_per_child,
            on_ready_counter=on_ready_counter,
        ))
        self._pool.append(w)
        self._process_register_queues(w, (inq, outq, synq))
        w.name = w.name.replace('Process', 'PoolWorker')
        w.daemon = True
        w.index = i
        w.start()
        self._poolctrl[w.pid] = sentinel
        self._on_ready_counters[w.pid] = on_ready_counter
        if self.on_process_up:
            self.on_process_up(w)
        return w

    def process_flush_queues(self, worker):
        pass

    def _join_exited_workers(self, shutdown=False):
        """Cleanup after any worker processes which have exited due to
        reaching their specified lifetime. Returns True if any workers were
        cleaned up.
        """
        now = None
        # The worker may have published a result before being terminated,
        # but we have no way to accurately tell if it did.  So we wait for
        # _lost_worker_timeout seconds before we mark the job with
        # WorkerLostError.
        for job in [job for job in list(self._cache.values())
                    if not job.ready() and job._worker_lost]:
            now = now or monotonic()
            lost_time, lost_ret = job._worker_lost
            if now - lost_time > job._lost_worker_timeout:
                self.mark_as_worker_lost(job, lost_ret)

        if shutdown and not len(self._pool):
            raise WorkersJoined()

        cleaned, exitcodes = {}, {}
        for i in reversed(range(len(self._pool))):
            worker = self._pool[i]
            exitcode = worker.exitcode
            popen = worker._popen
            if popen is None or exitcode is not None:
                # worker exited
                debug('Supervisor: cleaning up worker %d', i)
                if popen is not None:
                    worker.join()
                debug('Supervisor: worked %d joined', i)
                cleaned[worker.pid] = worker
                exitcodes[worker.pid] = exitcode
                if exitcode not in (EX_OK, EX_RECYCLE) and \
                        not getattr(worker, '_controlled_termination', False):
                    error(
                        'Process %r pid:%r exited with %r',
                        worker.name, worker.pid, human_status(exitcode),
                        exc_info=0,
                    )
                self.process_flush_queues(worker)
                del self._pool[i]
                del self._poolctrl[worker.pid]
                del self._on_ready_counters[worker.pid]
        if cleaned:
            all_pids = [w.pid for w in self._pool]
            for job in list(self._cache.values()):
                acked_by_gone = next(
                    (pid for pid in job.worker_pids()
                     if pid in cleaned or pid not in all_pids),
                    None
                )
                # already accepted by process
                if acked_by_gone:
                    self.on_job_process_down(job, acked_by_gone)
                    if not job.ready():
                        exitcode = exitcodes.get(acked_by_gone) or 0
                        proc = cleaned.get(acked_by_gone)
                        if proc and getattr(proc, '_job_terminated', False):
                            job._set_terminated(exitcode)
                        else:
                            self.on_job_process_lost(
                                job, acked_by_gone, exitcode,
                            )
                else:
                    # started writing to
                    write_to = job._write_to
                    # was scheduled to write to
                    sched_for = job._scheduled_for

                    if write_to and not write_to._is_alive():
                        self.on_job_process_down(job, write_to.pid)
                    elif sched_for and not sched_for._is_alive():
                        self.on_job_process_down(job, sched_for.pid)

            for worker in cleaned.values():
                if self.on_process_down:
                    if not shutdown:
                        self._process_cleanup_queues(worker)
                    self.on_process_down(worker)
            return list(exitcodes.values())
        return []

    def on_partial_read(self, job, worker):
        pass

    def _process_cleanup_queues(self, worker):
        pass

    def on_job_process_down(self, job, pid_gone):
        pass

    def on_job_process_lost(self, job, pid, exitcode):
        job._worker_lost = (monotonic(), exitcode)

    def mark_as_worker_lost(self, job, exitcode):
        try:
            raise WorkerLostError(
                'Worker exited prematurely: {0} Job: {1}.'.format(
                    human_status(exitcode), job._job),
            )
        except WorkerLostError:
            job._set(None, (False, ExceptionInfo()))
        else:  # pragma: no cover
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return self.terminate()

    def on_grow(self, n):
        pass

    def on_shrink(self, n):
        pass

    def shrink(self, n=1):
        for i, worker in enumerate(self._iterinactive()):
            self._processes -= 1
            if self._putlock:
                self._putlock.shrink()
            worker.terminate_controlled()
            self.on_shrink(1)
            if i >= n - 1:
                break
        else:
            raise ValueError("Can't shrink pool. All processes busy!")

    def grow(self, n=1):
        for i in range(n):
            self._processes += 1
            if self._putlock:
                self._putlock.grow()
        self.on_grow(n)

    def _iterinactive(self):
        for worker in self._pool:
            if not self._worker_active(worker):
                yield worker

    def _worker_active(self, worker):
        for job in self._cache.values():
            if worker.pid in job.worker_pids():
                return True
        return False

    def _repopulate_pool(self, exitcodes):
        """Bring the number of pool processes up to the specified number,
        for use after reaping workers which have exited.
        """
        for i in range(self._processes - len(self._pool)):
            if self._state != RUN:
                return
            try:
                if exitcodes and exitcodes[i] not in (EX_OK, EX_RECYCLE):
                    self.restart_state.step()
            except IndexError:
                self.restart_state.step()
            self._create_worker_process(self._avail_index())
            debug('added worker')

    def _avail_index(self):
        assert len(self._pool) < self._processes
        indices = set(p.index for p in self._pool)
        return next(i for i in range(self._processes) if i not in indices)

    def did_start_ok(self):
        return not self._join_exited_workers()

    def _maintain_pool(self):
        """"Clean up any exited workers and start replacements for them.
        """
        joined = self._join_exited_workers()
        self._repopulate_pool(joined)
        for i in range(len(joined)):
            if self._putlock is not None:
                self._putlock.release()

    def maintain_pool(self):
        if self._worker_handler._state == RUN and self._state == RUN:
            try:
                self._maintain_pool()
            except RestartFreqExceeded:
                self.close()
                self.join()
                raise
            except OSError as exc:
                if get_errno(exc) == errno.ENOMEM:
                    raise MemoryError from exc
                raise

    def _setup_queues(self):
        self._inqueue = self._ctx.SimpleQueue()
        self._outqueue = self._ctx.SimpleQueue()
        self._quick_put = self._inqueue._writer.send
        self._quick_get = self._outqueue._reader.recv

        def _poll_result(timeout):
            if self._outqueue._reader.poll(timeout):
                return True, self._quick_get()
            return False, None
        self._poll_result = _poll_result

    def _start_timeout_handler(self):
        # ensure more than one thread does not start the timeout handler
        # thread at once.
        if self.threads and self._timeout_handler is not None:
            with self._timeout_handler_mutex:
                if not self._timeout_handler_started:
                    self._timeout_handler_started = True
                    self._timeout_handler.start()

    def apply(self, func, args=(), kwds={}):
        '''
        Equivalent of `func(*args, **kwargs)`.
        '''
        if self._state == RUN:
            return self.apply_async(func, args, kwds).get()

    def starmap(self, func, iterable, chunksize=None):
        '''
        Like `map()` method but the elements of the `iterable` are expected to
        be iterables as well and will be unpacked as arguments. Hence
        `func` and (a, b) becomes func(a, b).
        '''
        if self._state == RUN:
            return self._map_async(func, iterable,
                                   starmapstar, chunksize).get()

    def starmap_async(self, func, iterable, chunksize=None,
                      callback=None, error_callback=None):
        '''
        Asynchronous version of `starmap()` method.
        '''
        if self._state == RUN:
            return self._map_async(func, iterable, starmapstar, chunksize,
                                   callback, error_callback)

    def map(self, func, iterable, chunksize=None):
        '''
        Apply `func` to each element in `iterable`, collecting the results
        in a list that is returned.
        '''
        if self._state == RUN:
            return self.map_async(func, iterable, chunksize).get()

    def imap(self, func, iterable, chunksize=1, lost_worker_timeout=None):
        '''
        Equivalent of `map()` -- can be MUCH slower than `Pool.map()`.
        '''
        if self._state != RUN:
            return
        lost_worker_timeout = lost_worker_timeout or self.lost_worker_timeout
        if chunksize == 1:
            result = IMapIterator(self._cache,
                                  lost_worker_timeout=lost_worker_timeout)
            self._taskqueue.put((
                ((TASK, (result._job, i, func, (x,), {}))
                 for i, x in enumerate(iterable)),
                result._set_length,
            ))
            return result
        else:
            assert chunksize > 1
            task_batches = Pool._get_tasks(func, iterable, chunksize)
            result = IMapIterator(self._cache,
                                  lost_worker_timeout=lost_worker_timeout)
            self._taskqueue.put((
                ((TASK, (result._job, i, mapstar, (x,), {}))
                 for i, x in enumerate(task_batches)),
                result._set_length,
            ))
            return (item for chunk in result for item in chunk)

    def imap_unordered(self, func, iterable, chunksize=1,
                       lost_worker_timeout=None):
        '''
        Like `imap()` method but ordering of results is arbitrary.
        '''
        if self._state != RUN:
            return
        lost_worker_timeout = lost_worker_timeout or self.lost_worker_timeout
        if chunksize == 1:
            result = IMapUnorderedIterator(
                self._cache, lost_worker_timeout=lost_worker_timeout,
            )
            self._taskqueue.put((
                ((TASK, (result._job, i, func, (x,), {}))
                 for i, x in enumerate(iterable)),
                result._set_length,
            ))
            return result
        else:
            assert chunksize > 1
            task_batches = Pool._get_tasks(func, iterable, chunksize)
            result = IMapUnorderedIterator(
                self._cache, lost_worker_timeout=lost_worker_timeout,
            )
            self._taskqueue.put((
                ((TASK, (result._job, i, mapstar, (x,), {}))
                 for i, x in enumerate(task_batches)),
                result._set_length,
            ))
            return (item for chunk in result for item in chunk)

    def apply_async(self, func, args=(), kwds={},
                    callback=None, error_callback=None, accept_callback=None,
                    timeout_callback=None, waitforslot=None,
                    soft_timeout=None, timeout=None, lost_worker_timeout=None,
                    callbacks_propagate=(),
                    correlation_id=None):
        '''
        Asynchronous equivalent of `apply()` method.

        Callback is called when the functions return value is ready.
        The accept callback is called when the job is accepted to be executed.

        Simplified the flow is like this:

            >>> def apply_async(func, args, kwds, callback, accept_callback):
            ...     if accept_callback:
            ...         accept_callback()
            ...     retval = func(*args, **kwds)
            ...     if callback:
            ...         callback(retval)

        '''
        if self._state != RUN:
            return
        soft_timeout = soft_timeout or self.soft_timeout
        timeout = timeout or self.timeout
        lost_worker_timeout = lost_worker_timeout or self.lost_worker_timeout
        if soft_timeout and SIG_SOFT_TIMEOUT is None:
            warnings.warn(UserWarning(
                "Soft timeouts are not supported: "
                "on this platform: It does not have the SIGUSR1 signal.",
            ))
            soft_timeout = None
        if self._state == RUN:
            waitforslot = self.putlocks if waitforslot is None else waitforslot
            if waitforslot and self._putlock is not None:
                self._putlock.acquire()
            result = ApplyResult(
                self._cache, callback, accept_callback, timeout_callback,
                error_callback, soft_timeout, timeout, lost_worker_timeout,
                on_timeout_set=self.on_timeout_set,
                on_timeout_cancel=self.on_timeout_cancel,
                callbacks_propagate=callbacks_propagate,
                send_ack=self.send_ack if self.synack else None,
                correlation_id=correlation_id,
            )
            if timeout or soft_timeout:
                # start the timeout handler thread when required.
                self._start_timeout_handler()
            if self.threads:
                self._taskqueue.put(([(TASK, (result._job, None,
                                    func, args, kwds))], None))
            else:
                self._quick_put((TASK, (result._job, None, func, args, kwds)))
            return result

    def send_ack(self, response, job, i, fd):
        pass

    def terminate_job(self, pid, sig=None):
        proc, _ = self._process_by_pid(pid)
        if proc is not None:
            try:
                _kill(pid, sig or TERM_SIGNAL)
            except OSError as exc:
                if get_errno(exc) != errno.ESRCH:
                    raise
            else:
                proc._controlled_termination = True
                proc._job_terminated = True

    def map_async(self, func, iterable, chunksize=None,
                  callback=None, error_callback=None):
        '''
        Asynchronous equivalent of `map()` method.
        '''
        return self._map_async(
            func, iterable, mapstar, chunksize, callback, error_callback,
        )

    def _map_async(self, func, iterable, mapper, chunksize=None,
                   callback=None, error_callback=None):
        '''
        Helper function to implement map, starmap and their async counterparts.
        '''
        if self._state != RUN:
            return
        if not hasattr(iterable, '__len__'):
            iterable = list(iterable)

        if chunksize is None:
            chunksize, extra = divmod(len(iterable), len(self._pool) * 4)
            if extra:
                chunksize += 1
        if len(iterable) == 0:
            chunksize = 0

        task_batches = Pool._get_tasks(func, iterable, chunksize)
        result = MapResult(self._cache, chunksize, len(iterable), callback,
                           error_callback=error_callback)
        self._taskqueue.put((((TASK, (result._job, i, mapper, (x,), {}))
                              for i, x in enumerate(task_batches)), None))
        return result

    @staticmethod
    def _get_tasks(func, it, size):
        it = iter(it)
        while 1:
            x = tuple(itertools.islice(it, size))
            if not x:
                return
            yield (func, x)

    def __reduce__(self):
        raise NotImplementedError(
            'pool objects cannot be passed between processes or pickled',
        )

    def close(self):
        debug('closing pool')
        if self._state == RUN:
            self._state = CLOSE
            if self._putlock:
                self._putlock.clear()
            self._worker_handler.close()
            self._taskqueue.put(None)
            stop_if_not_current(self._worker_handler)

    def terminate(self):
        debug('terminating pool')
        self._state = TERMINATE
        self._worker_handler.terminate()
        self._terminate()

    @staticmethod
    def _stop_task_handler(task_handler):
        stop_if_not_current(task_handler)

    def join(self):
        assert self._state in (CLOSE, TERMINATE)
        debug('joining worker handler')
        stop_if_not_current(self._worker_handler)
        debug('joining task handler')
        self._stop_task_handler(self._task_handler)
        debug('joining result handler')
        stop_if_not_current(self._result_handler)
        debug('result handler joined')
        for i, p in enumerate(self._pool):
            debug('joining worker %s/%s (%r)', i + 1, len(self._pool), p)
            if p._popen is not None:  # process started?
                p.join()
        debug('pool join complete')

    def restart(self):
        for e in self._poolctrl.values():
            e.set()

    @staticmethod
    def _help_stuff_finish(inqueue, task_handler, _pool):
        # task_handler may be blocked trying to put items on inqueue
        debug('removing tasks from inqueue until task handler finished')
        inqueue._rlock.acquire()
        while task_handler.is_alive() and inqueue._reader.poll():
            inqueue._reader.recv()
            time.sleep(0)

    @classmethod
    def _set_result_sentinel(cls, outqueue, pool):
        outqueue.put(None)

    @classmethod
    def _terminate_pool(cls, taskqueue, inqueue, outqueue, pool,
                        worker_handler, task_handler,
                        result_handler, cache, timeout_handler,
                        help_stuff_finish_args):

        # this is guaranteed to only be called once
        debug('finalizing pool')

        worker_handler.terminate()

        task_handler.terminate()
        taskqueue.put(None)                 # sentinel

        debug('helping task handler/workers to finish')
        cls._help_stuff_finish(*help_stuff_finish_args)

        result_handler.terminate()
        cls._set_result_sentinel(outqueue, pool)

        if timeout_handler is not None:
            timeout_handler.terminate()

        # Terminate workers which haven't already finished
        if pool and hasattr(pool[0], 'terminate'):
            debug('terminating workers')
            for p in pool:
                if p._is_alive():
                    p.terminate()

        debug('joining task handler')
        cls._stop_task_handler(task_handler)

        debug('joining result handler')
        result_handler.stop()

        if timeout_handler is not None:
            debug('joining timeout handler')
            timeout_handler.stop(TIMEOUT_MAX)

        if pool and hasattr(pool[0], 'terminate'):
            debug('joining pool workers')
            for p in pool:
                if p.is_alive():
                    # worker has not yet exited
                    debug('cleaning up worker %d', p.pid)
                    if p._popen is not None:
                        p.join()
            debug('pool workers joined')

        if inqueue:
            inqueue.close()
        if outqueue:
            outqueue.close()

    @property
    def process_sentinels(self):
        return [w._popen.sentinel for w in self._pool]

#
# Class whose instances are returned by `Pool.apply_async()`
#


class ApplyResult:
    _worker_lost = None
    _write_to = None
    _scheduled_for = None

    def __init__(self, cache, callback, accept_callback=None,
                 timeout_callback=None, error_callback=None, soft_timeout=None,
                 timeout=None, lost_worker_timeout=LOST_WORKER_TIMEOUT,
                 on_timeout_set=None, on_timeout_cancel=None,
                 callbacks_propagate=(), send_ack=None,
                 correlation_id=None):
        self.correlation_id = correlation_id
        self._mutex = Lock()
        self._event = threading.Event()
        self._job = next(job_counter)
        self._cache = cache
        self._callback = callback
        self._accept_callback = accept_callback
        self._error_callback = error_callback
        self._timeout_callback = timeout_callback
        self._timeout = timeout
        self._soft_timeout = soft_timeout
        self._lost_worker_timeout = lost_worker_timeout
        self._on_timeout_set = on_timeout_set
        self._on_timeout_cancel = on_timeout_cancel
        self._callbacks_propagate = callbacks_propagate or ()
        self._send_ack = send_ack

        self._accepted = False
        self._cancelled = False
        self._worker_pid = None
        self._time_accepted = None
        self._terminated = None
        cache[self._job] = self

    def __repr__(self):
        return '<{name}: {id} ack:{ack} ready:{ready}>'.format(
            name=self.__class__.__name__,
            id=self._job, ack=self._accepted, ready=self.ready(),
        )

    def ready(self):
        return self._event.is_set()

    def accepted(self):
        return self._accepted

    def successful(self):
        assert self.ready()
        return self._success

    def _cancel(self):
        """Only works if synack is used."""
        self._cancelled = True

    def discard(self):
        self._cache.pop(self._job, None)

    def terminate(self, signum):
        self._terminated = signum

    def _set_terminated(self, signum=None):
        try:
            raise Terminated(-(signum or 0))
        except Terminated:
            self._set(None, (False, ExceptionInfo()))

    def worker_pids(self):
        return [self._worker_pid] if self._worker_pid else []

    def wait(self, timeout=None):
        self._event.wait(timeout)

    def get(self, timeout=None):
        self.wait(timeout)
        if not self.ready():
            raise TimeoutError
        if self._success:
            return self._value
        else:
            raise self._value.exception

    def safe_apply_callback(self, fun, *args, **kwargs):
        if fun:
            try:
                fun(*args, **kwargs)
            except self._callbacks_propagate:
                raise
            except Exception as exc:
                error('Pool callback raised exception: %r', exc,
                      exc_info=1)

    def handle_timeout(self, soft=False):
        if self._timeout_callback is not None:
            self.safe_apply_callback(
                self._timeout_callback, soft=soft,
                timeout=self._soft_timeout if soft else self._timeout,
            )

    def _set(self, i, obj):
        with self._mutex:
            if self._on_timeout_cancel:
                self._on_timeout_cancel(self)
            self._success, self._value = obj
            self._event.set()
            if self._accepted:
                # if not accepted yet, then the set message
                # was received before the ack, which means
                # the ack will remove the entry.
                self._cache.pop(self._job, None)

            # apply callbacks last
            if self._callback and self._success:
                self.safe_apply_callback(
                    self._callback, self._value)
            if (self._value is not None and
                    self._error_callback and not self._success):
                self.safe_apply_callback(
                    self._error_callback, self._value)

    def _ack(self, i, time_accepted, pid, synqW_fd):
        with self._mutex:
            if self._cancelled and self._send_ack:
                self._accepted = True
                if synqW_fd:
                    return self._send_ack(NACK, pid, self._job, synqW_fd)
                return
            self._accepted = True
            self._time_accepted = time_accepted
            self._worker_pid = pid
            if self.ready():
                # ack received after set()
                self._cache.pop(self._job, None)
            if self._on_timeout_set:
                self._on_timeout_set(self, self._soft_timeout, self._timeout)
            response = ACK
            if self._accept_callback:
                try:
                    self._accept_callback(pid, time_accepted)
                except self._propagate_errors:
                    response = NACK
                    raise
                except Exception:
                    response = NACK
                    # ignore other errors
                finally:
                    if self._send_ack and synqW_fd:
                        return self._send_ack(
                            response, pid, self._job, synqW_fd
                        )
            if self._send_ack and synqW_fd:
                self._send_ack(response, pid, self._job, synqW_fd)

#
# Class whose instances are returned by `Pool.map_async()`
#


class MapResult(ApplyResult):

    def __init__(self, cache, chunksize, length, callback, error_callback):
        ApplyResult.__init__(
            self, cache, callback, error_callback=error_callback,
        )
        self._success = True
        self._length = length
        self._value = [None] * length
        self._accepted = [False] * length
        self._worker_pid = [None] * length
        self._time_accepted = [None] * length
        self._chunksize = chunksize
        if chunksize <= 0:
            self._number_left = 0
            self._event.set()
            del cache[self._job]
        else:
            self._number_left = length // chunksize + bool(length % chunksize)

    def _set(self, i, success_result):
        success, result = success_result
        if success:
            self._value[i * self._chunksize:(i + 1) * self._chunksize] = result
            self._number_left -= 1
            if self._number_left == 0:
                if self._callback:
                    self._callback(self._value)
                if self._accepted:
                    self._cache.pop(self._job, None)
                self._event.set()
        else:
            self._success = False
            self._value = result
            if self._error_callback:
                self._error_callback(self._value)
            if self._accepted:
                self._cache.pop(self._job, None)
            self._event.set()

    def _ack(self, i, time_accepted, pid, *args):
        start = i * self._chunksize
        stop = min((i + 1) * self._chunksize, self._length)
        for j in range(start, stop):
            self._accepted[j] = True
            self._worker_pid[j] = pid
            self._time_accepted[j] = time_accepted
        if self.ready():
            self._cache.pop(self._job, None)

    def accepted(self):
        return all(self._accepted)

    def worker_pids(self):
        return [pid for pid in self._worker_pid if pid]

#
# Class whose instances are returned by `Pool.imap()`
#


class IMapIterator:
    _worker_lost = None

    def __init__(self, cache, lost_worker_timeout=LOST_WORKER_TIMEOUT):
        self._cond = threading.Condition(threading.Lock())
        self._job = next(job_counter)
        self._cache = cache
        self._items = deque()
        self._index = 0
        self._length = None
        self._ready = False
        self._unsorted = {}
        self._worker_pids = []
        self._lost_worker_timeout = lost_worker_timeout
        cache[self._job] = self

    def __iter__(self):
        return self

    def next(self, timeout=None):
        with self._cond:
            try:
                item = self._items.popleft()
            except IndexError:
                if self._index == self._length:
                    self._ready = True
                    raise StopIteration
                self._cond.wait(timeout)
                try:
                    item = self._items.popleft()
                except IndexError:
                    if self._index == self._length:
                        self._ready = True
                        raise StopIteration
                    raise TimeoutError

        success, value = item
        if success:
            return value
        raise Exception(value)

    __next__ = next                    # XXX

    def _set(self, i, obj):
        with self._cond:
            if self._index == i:
                self._items.append(obj)
                self._index += 1
                while self._index in self._unsorted:
                    obj = self._unsorted.pop(self._index)
                    self._items.append(obj)
                    self._index += 1
                self._cond.notify()
            else:
                self._unsorted[i] = obj

            if self._index == self._length:
                self._ready = True
                del self._cache[self._job]

    def _set_length(self, length):
        with self._cond:
            self._length = length
            if self._index == self._length:
                self._ready = True
                self._cond.notify()
                del self._cache[self._job]

    def _ack(self, i, time_accepted, pid, *args):
        self._worker_pids.append(pid)

    def ready(self):
        return self._ready

    def worker_pids(self):
        return self._worker_pids

#
# Class whose instances are returned by `Pool.imap_unordered()`
#


class IMapUnorderedIterator(IMapIterator):

    def _set(self, i, obj):
        with self._cond:
            self._items.append(obj)
            self._index += 1
            self._cond.notify()
            if self._index == self._length:
                self._ready = True
                del self._cache[self._job]

#
#
#


class ThreadPool(Pool):

    from .dummy import Process as DummyProcess
    Process = DummyProcess

    def __init__(self, processes=None, initializer=None, initargs=()):
        Pool.__init__(self, processes, initializer, initargs)

    def _setup_queues(self):
        self._inqueue = Queue()
        self._outqueue = Queue()
        self._quick_put = self._inqueue.put
        self._quick_get = self._outqueue.get

        def _poll_result(timeout):
            try:
                return True, self._quick_get(timeout=timeout)
            except Empty:
                return False, None
        self._poll_result = _poll_result

    @staticmethod
    def _help_stuff_finish(inqueue, task_handler, pool):
        # put sentinels at head of inqueue to make workers finish
        with inqueue.not_empty:
            inqueue.queue.clear()
            inqueue.queue.extend([None] * len(pool))
            inqueue.not_empty.notify_all()
