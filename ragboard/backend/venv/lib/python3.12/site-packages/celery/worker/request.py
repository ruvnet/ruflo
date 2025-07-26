"""Task request.

This module defines the :class:`Request` class, that specifies
how tasks are executed.
"""
import logging
import sys
from datetime import datetime
from time import monotonic, time
from weakref import ref

from billiard.common import TERM_SIGNAME
from billiard.einfo import ExceptionWithTraceback
from kombu.utils.encoding import safe_repr, safe_str
from kombu.utils.objects import cached_property

from celery import current_app, signals
from celery.app.task import Context
from celery.app.trace import fast_trace_task, trace_task, trace_task_ret
from celery.concurrency.base import BasePool
from celery.exceptions import (Ignore, InvalidTaskError, Reject, Retry, TaskRevokedError, Terminated,
                               TimeLimitExceeded, WorkerLostError)
from celery.platforms import signals as _signals
from celery.utils.functional import maybe, maybe_list, noop
from celery.utils.log import get_logger
from celery.utils.nodenames import gethostname
from celery.utils.serialization import get_pickled_exception
from celery.utils.time import maybe_iso8601, maybe_make_aware, timezone

from . import state

__all__ = ('Request',)

# pylint: disable=redefined-outer-name
# We cache globals and attribute lookups, so disable this warning.

IS_PYPY = hasattr(sys, 'pypy_version_info')

logger = get_logger(__name__)
debug, info, warn, error = (logger.debug, logger.info,
                            logger.warning, logger.error)
_does_info = False
_does_debug = False


def __optimize__():
    # this is also called by celery.app.trace.setup_worker_optimizations
    global _does_debug
    global _does_info
    _does_debug = logger.isEnabledFor(logging.DEBUG)
    _does_info = logger.isEnabledFor(logging.INFO)


__optimize__()

# Localize
tz_or_local = timezone.tz_or_local
send_revoked = signals.task_revoked.send
send_retry = signals.task_retry.send

task_accepted = state.task_accepted
task_ready = state.task_ready
revoked_tasks = state.revoked
revoked_stamps = state.revoked_stamps


class Request:
    """A request for task execution."""

    acknowledged = False
    time_start = None
    worker_pid = None
    time_limits = (None, None)
    _already_revoked = False
    _already_cancelled = False
    _terminate_on_ack = None
    _apply_result = None
    _tzlocal = None

    if not IS_PYPY:  # pragma: no cover
        __slots__ = (
            '_app', '_type', 'name', 'id', '_root_id', '_parent_id',
            '_on_ack', '_body', '_hostname', '_eventer', '_connection_errors',
            '_task', '_eta', '_expires', '_request_dict', '_on_reject', '_utc',
            '_content_type', '_content_encoding', '_argsrepr', '_kwargsrepr',
            '_args', '_kwargs', '_decoded', '__payload',
            '__weakref__', '__dict__',
        )

    def __init__(self, message, on_ack=noop,
                 hostname=None, eventer=None, app=None,
                 connection_errors=None, request_dict=None,
                 task=None, on_reject=noop, body=None,
                 headers=None, decoded=False, utc=True,
                 maybe_make_aware=maybe_make_aware,
                 maybe_iso8601=maybe_iso8601, **opts):
        self._message = message
        self._request_dict = (message.headers.copy() if headers is None
                              else headers.copy())
        self._body = message.body if body is None else body
        self._app = app
        self._utc = utc
        self._decoded = decoded
        if decoded:
            self._content_type = self._content_encoding = None
        else:
            self._content_type, self._content_encoding = (
                message.content_type, message.content_encoding,
            )
        self.__payload = self._body if self._decoded else message.payload
        self.id = self._request_dict['id']
        self._type = self.name = self._request_dict['task']
        if 'shadow' in self._request_dict:
            self.name = self._request_dict['shadow'] or self.name
        self._root_id = self._request_dict.get('root_id')
        self._parent_id = self._request_dict.get('parent_id')
        timelimit = self._request_dict.get('timelimit', None)
        if timelimit:
            self.time_limits = timelimit
        self._argsrepr = self._request_dict.get('argsrepr', '')
        self._kwargsrepr = self._request_dict.get('kwargsrepr', '')
        self._on_ack = on_ack
        self._on_reject = on_reject
        self._hostname = hostname or gethostname()
        self._eventer = eventer
        self._connection_errors = connection_errors or ()
        self._task = task or self._app.tasks[self._type]
        self._ignore_result = self._request_dict.get('ignore_result', False)

        # timezone means the message is timezone-aware, and the only timezone
        # supported at this point is UTC.
        eta = self._request_dict.get('eta')
        if eta is not None:
            try:
                eta = maybe_iso8601(eta)
            except (AttributeError, ValueError, TypeError) as exc:
                raise InvalidTaskError(
                    f'invalid ETA value {eta!r}: {exc}')
            self._eta = maybe_make_aware(eta, self.tzlocal)
        else:
            self._eta = None

        expires = self._request_dict.get('expires')
        if expires is not None:
            try:
                expires = maybe_iso8601(expires)
            except (AttributeError, ValueError, TypeError) as exc:
                raise InvalidTaskError(
                    f'invalid expires value {expires!r}: {exc}')
            self._expires = maybe_make_aware(expires, self.tzlocal)
        else:
            self._expires = None

        delivery_info = message.delivery_info or {}
        properties = message.properties or {}
        self._delivery_info = {
            'exchange': delivery_info.get('exchange'),
            'routing_key': delivery_info.get('routing_key'),
            'priority': properties.get('priority'),
            'redelivered': delivery_info.get('redelivered', False),
        }
        self._request_dict.update({
            'properties': properties,
            'reply_to': properties.get('reply_to'),
            'correlation_id': properties.get('correlation_id'),
            'hostname': self._hostname,
            'delivery_info': self._delivery_info
        })
        # this is a reference pass to avoid memory usage burst
        self._request_dict['args'], self._request_dict['kwargs'], _ = self.__payload
        self._args = self._request_dict['args']
        self._kwargs = self._request_dict['kwargs']

    @property
    def delivery_info(self):
        return self._delivery_info

    @property
    def message(self):
        return self._message

    @property
    def request_dict(self):
        return self._request_dict

    @property
    def body(self):
        return self._body

    @property
    def app(self):
        return self._app

    @property
    def utc(self):
        return self._utc

    @property
    def content_type(self):
        return self._content_type

    @property
    def content_encoding(self):
        return self._content_encoding

    @property
    def type(self):
        return self._type

    @property
    def root_id(self):
        return self._root_id

    @property
    def parent_id(self):
        return self._parent_id

    @property
    def argsrepr(self):
        return self._argsrepr

    @property
    def args(self):
        return self._args

    @property
    def kwargs(self):
        return self._kwargs

    @property
    def kwargsrepr(self):
        return self._kwargsrepr

    @property
    def on_ack(self):
        return self._on_ack

    @property
    def on_reject(self):
        return self._on_reject

    @on_reject.setter
    def on_reject(self, value):
        self._on_reject = value

    @property
    def hostname(self):
        return self._hostname

    @property
    def ignore_result(self):
        return self._ignore_result

    @property
    def eventer(self):
        return self._eventer

    @eventer.setter
    def eventer(self, eventer):
        self._eventer = eventer

    @property
    def connection_errors(self):
        return self._connection_errors

    @property
    def task(self):
        return self._task

    @property
    def eta(self):
        return self._eta

    @property
    def expires(self):
        return self._expires

    @expires.setter
    def expires(self, value):
        self._expires = value

    @property
    def tzlocal(self):
        if self._tzlocal is None:
            self._tzlocal = self._app.conf.timezone
        return self._tzlocal

    @property
    def store_errors(self):
        return (not self.task.ignore_result or
                self.task.store_errors_even_if_ignored)

    @property
    def task_id(self):
        # XXX compat
        return self.id

    @task_id.setter
    def task_id(self, value):
        self.id = value

    @property
    def task_name(self):
        # XXX compat
        return self.name

    @task_name.setter
    def task_name(self, value):
        self.name = value

    @property
    def reply_to(self):
        # used by rpc backend when failures reported by parent process
        return self._request_dict['reply_to']

    @property
    def replaced_task_nesting(self):
        return self._request_dict.get('replaced_task_nesting', 0)

    @property
    def groups(self):
        return self._request_dict.get('groups', [])

    @property
    def stamped_headers(self) -> list:
        return self._request_dict.get('stamped_headers') or []

    @property
    def stamps(self) -> dict:
        stamps = self._request_dict.get('stamps') or {}
        return {header: stamps.get(header) for header in self.stamped_headers}

    @property
    def correlation_id(self):
        # used similarly to reply_to
        return self._request_dict['correlation_id']

    def execute_using_pool(self, pool: BasePool, **kwargs):
        """Used by the worker to send this task to the pool.

        Arguments:
            pool (~celery.concurrency.base.TaskPool): The execution pool
                used to execute this request.

        Raises:
            celery.exceptions.TaskRevokedError: if the task was revoked.
        """
        task_id = self.id
        task = self._task
        if self.revoked():
            raise TaskRevokedError(task_id)

        time_limit, soft_time_limit = self.time_limits
        trace = fast_trace_task if self._app.use_fast_trace_task else trace_task_ret
        result = pool.apply_async(
            trace,
            args=(self._type, task_id, self._request_dict, self._body,
                  self._content_type, self._content_encoding),
            accept_callback=self.on_accepted,
            timeout_callback=self.on_timeout,
            callback=self.on_success,
            error_callback=self.on_failure,
            soft_timeout=soft_time_limit or task.soft_time_limit,
            timeout=time_limit or task.time_limit,
            correlation_id=task_id,
        )
        # cannot create weakref to None
        self._apply_result = maybe(ref, result)
        return result

    def execute(self, loglevel=None, logfile=None):
        """Execute the task in a :func:`~celery.app.trace.trace_task`.

        Arguments:
            loglevel (int): The loglevel used by the task.
            logfile (str): The logfile used by the task.
        """
        if self.revoked():
            return

        # acknowledge task as being processed.
        if not self.task.acks_late:
            self.acknowledge()

        _, _, embed = self._payload
        request = self._request_dict
        # pylint: disable=unpacking-non-sequence
        #    payload is a property, so pylint doesn't think it's a tuple.
        request.update({
            'loglevel': loglevel,
            'logfile': logfile,
            'is_eager': False,
        }, **embed or {})

        retval, I, _, _ = trace_task(self.task, self.id, self._args, self._kwargs, request,
                                     hostname=self._hostname, loader=self._app.loader,
                                     app=self._app)

        if I:
            self.reject(requeue=False)
        else:
            self.acknowledge()
        return retval

    def maybe_expire(self):
        """If expired, mark the task as revoked."""
        if self.expires:
            now = datetime.now(self.expires.tzinfo)
            if now > self.expires:
                revoked_tasks.add(self.id)
                return True

    def terminate(self, pool, signal=None):
        signal = _signals.signum(signal or TERM_SIGNAME)
        if self.time_start:
            pool.terminate_job(self.worker_pid, signal)
            self._announce_revoked('terminated', True, signal, False)
        else:
            self._terminate_on_ack = pool, signal
        if self._apply_result is not None:
            obj = self._apply_result()  # is a weakref
            if obj is not None:
                obj.terminate(signal)

    def cancel(self, pool, signal=None):
        signal = _signals.signum(signal or TERM_SIGNAME)
        if self.time_start:
            pool.terminate_job(self.worker_pid, signal)
            self._announce_cancelled()

        if self._apply_result is not None:
            obj = self._apply_result()  # is a weakref
            if obj is not None:
                obj.terminate(signal)

    def _announce_cancelled(self):
        task_ready(self)
        self.send_event('task-cancelled')
        reason = 'cancelled by Celery'
        exc = Retry(message=reason)
        self.task.backend.mark_as_retry(self.id,
                                        exc,
                                        request=self._context)

        self.task.on_retry(exc, self.id, self.args, self.kwargs, None)
        self._already_cancelled = True
        send_retry(self.task, request=self._context, einfo=None)

    def _announce_revoked(self, reason, terminated, signum, expired):
        task_ready(self)
        self.send_event('task-revoked',
                        terminated=terminated, signum=signum, expired=expired)
        self.task.backend.mark_as_revoked(
            self.id, reason, request=self._context,
            store_result=self.store_errors,
        )
        self.acknowledge()
        self._already_revoked = True
        send_revoked(self.task, request=self._context,
                     terminated=terminated, signum=signum, expired=expired)

    def revoked(self):
        """If revoked, skip task and mark state."""
        expired = False
        if self._already_revoked:
            return True
        if self.expires:
            expired = self.maybe_expire()
        revoked_by_id = self.id in revoked_tasks
        revoked_by_header, revoking_header = False, None

        if not revoked_by_id and self.stamped_headers:
            for stamp in self.stamped_headers:
                if stamp in revoked_stamps:
                    revoked_header = revoked_stamps[stamp]
                    stamped_header = self._message.headers['stamps'][stamp]

                    if isinstance(stamped_header, (list, tuple)):
                        for stamped_value in stamped_header:
                            if stamped_value in maybe_list(revoked_header):
                                revoked_by_header = True
                                revoking_header = {stamp: stamped_value}
                                break
                    else:
                        revoked_by_header = any([
                            stamped_header in maybe_list(revoked_header),
                            stamped_header == revoked_header,  # When the header is a single set value
                        ])
                        revoking_header = {stamp: stamped_header}
                    break

        if any((expired, revoked_by_id, revoked_by_header)):
            log_msg = 'Discarding revoked task: %s[%s]'
            if revoked_by_header:
                log_msg += ' (revoked by header: %s)' % revoking_header
            info(log_msg, self.name, self.id)
            self._announce_revoked(
                'expired' if expired else 'revoked', False, None, expired,
            )
            return True
        return False

    def send_event(self, type, **fields):
        if self._eventer and self._eventer.enabled and self.task.send_events:
            self._eventer.send(type, uuid=self.id, **fields)

    def on_accepted(self, pid, time_accepted):
        """Handler called when task is accepted by worker pool."""
        self.worker_pid = pid
        # Convert monotonic time_accepted to absolute time
        self.time_start = time() - (monotonic() - time_accepted)
        task_accepted(self)
        if not self.task.acks_late:
            self.acknowledge()
        self.send_event('task-started')
        if _does_debug:
            debug('Task accepted: %s[%s] pid:%r', self.name, self.id, pid)
        if self._terminate_on_ack is not None:
            self.terminate(*self._terminate_on_ack)

    def on_timeout(self, soft, timeout):
        """Handler called if the task times out."""
        if soft:
            warn('Soft time limit (%ss) exceeded for %s[%s]',
                 timeout, self.name, self.id)
        else:
            task_ready(self)
            error('Hard time limit (%ss) exceeded for %s[%s]',
                  timeout, self.name, self.id)
            exc = TimeLimitExceeded(timeout)

            self.task.backend.mark_as_failure(
                self.id, exc, request=self._context,
                store_result=self.store_errors,
            )

            if self.task.acks_late and self.task.acks_on_failure_or_timeout:
                self.acknowledge()

    def on_success(self, failed__retval__runtime, **kwargs):
        """Handler called if the task was successfully processed."""
        failed, retval, runtime = failed__retval__runtime
        if failed:
            exc = retval.exception
            if isinstance(exc, ExceptionWithTraceback):
                exc = exc.exc
            if isinstance(exc, (SystemExit, KeyboardInterrupt)):
                raise exc
            return self.on_failure(retval, return_ok=True)
        task_ready(self, successful=True)

        if self.task.acks_late:
            self.acknowledge()

        self.send_event('task-succeeded', result=retval, runtime=runtime)

    def on_retry(self, exc_info):
        """Handler called if the task should be retried."""
        if self.task.acks_late:
            self.acknowledge()

        self.send_event('task-retried',
                        exception=safe_repr(exc_info.exception.exc),
                        traceback=safe_str(exc_info.traceback))

    def on_failure(self, exc_info, send_failed_event=True, return_ok=False):
        """Handler called if the task raised an exception."""
        task_ready(self)
        exc = exc_info.exception

        if isinstance(exc, ExceptionWithTraceback):
            exc = exc.exc

        is_terminated = isinstance(exc, Terminated)
        if is_terminated:
            # If the task was terminated and the task was not cancelled due
            # to a connection loss, it is revoked.

            # We always cancel the tasks inside the master process.
            # If the request was cancelled, it was not revoked and there's
            # nothing to be done.
            # According to the comment below, we need to check if the task
            # is already revoked and if it wasn't, we should announce that
            # it was.
            if not self._already_cancelled and not self._already_revoked:
                # This is a special case where the process
                # would not have had time to write the result.
                self._announce_revoked(
                    'terminated', True, str(exc), False)
            return
        elif isinstance(exc, MemoryError):
            raise MemoryError(f'Process got: {exc}')
        elif isinstance(exc, Reject):
            return self.reject(requeue=exc.requeue)
        elif isinstance(exc, Ignore):
            return self.acknowledge()
        elif isinstance(exc, Retry):
            return self.on_retry(exc_info)

        # (acks_late) acknowledge after result stored.
        requeue = False
        is_worker_lost = isinstance(exc, WorkerLostError)
        if self.task.acks_late:
            reject = (
                self.task.reject_on_worker_lost and
                is_worker_lost
            )
            ack = self.task.acks_on_failure_or_timeout
            if reject:
                requeue = True
                self.reject(requeue=requeue)
                send_failed_event = False
            elif ack:
                self.acknowledge()
            else:
                # supporting the behaviour where a task failed and
                # need to be removed from prefetched local queue
                self.reject(requeue=False)

        # This is a special case where the process would not have had time
        # to write the result.
        if not requeue and (is_worker_lost or not return_ok):
            # only mark as failure if task has not been requeued
            self.task.backend.mark_as_failure(
                self.id, exc, request=self._context,
                store_result=self.store_errors,
            )

            signals.task_failure.send(sender=self.task, task_id=self.id,
                                      exception=exc, args=self.args,
                                      kwargs=self.kwargs,
                                      traceback=exc_info.traceback,
                                      einfo=exc_info)

        if send_failed_event:
            self.send_event(
                'task-failed',
                exception=safe_repr(get_pickled_exception(exc_info.exception)),
                traceback=exc_info.traceback,
            )

        if not return_ok:
            error('Task handler raised error: %r', exc,
                  exc_info=exc_info.exc_info)

    def acknowledge(self):
        """Acknowledge task."""
        if not self.acknowledged:
            self._on_ack(logger, self._connection_errors)
            self.acknowledged = True

    def reject(self, requeue=False):
        if not self.acknowledged:
            self._on_reject(logger, self._connection_errors, requeue)
            self.acknowledged = True
            self.send_event('task-rejected', requeue=requeue)

    def info(self, safe=False):
        return {
            'id': self.id,
            'name': self.name,
            'args': self._args if not safe else self._argsrepr,
            'kwargs': self._kwargs if not safe else self._kwargsrepr,
            'type': self._type,
            'hostname': self._hostname,
            'time_start': self.time_start,
            'acknowledged': self.acknowledged,
            'delivery_info': self.delivery_info,
            'worker_pid': self.worker_pid,
        }

    def humaninfo(self):
        return '{0.name}[{0.id}]'.format(self)

    def __str__(self):
        """``str(self)``."""
        return ' '.join([
            self.humaninfo(),
            f' ETA:[{self._eta}]' if self._eta else '',
            f' expires:[{self._expires}]' if self._expires else '',
        ]).strip()

    def __repr__(self):
        """``repr(self)``."""
        return '<{}: {} {} {}>'.format(
            type(self).__name__, self.humaninfo(),
            self._argsrepr, self._kwargsrepr,
        )

    @cached_property
    def _payload(self):
        return self.__payload

    @cached_property
    def chord(self):
        # used by backend.mark_as_failure when failure is reported
        # by parent process
        # pylint: disable=unpacking-non-sequence
        #    payload is a property, so pylint doesn't think it's a tuple.
        _, _, embed = self._payload
        return embed.get('chord')

    @cached_property
    def errbacks(self):
        # used by backend.mark_as_failure when failure is reported
        # by parent process
        # pylint: disable=unpacking-non-sequence
        #    payload is a property, so pylint doesn't think it's a tuple.
        _, _, embed = self._payload
        return embed.get('errbacks')

    @cached_property
    def group(self):
        # used by backend.on_chord_part_return when failures reported
        # by parent process
        return self._request_dict.get('group')

    @cached_property
    def _context(self):
        """Context (:class:`~celery.app.task.Context`) of this task."""
        request = self._request_dict
        # pylint: disable=unpacking-non-sequence
        #    payload is a property, so pylint doesn't think it's a tuple.
        _, _, embed = self._payload
        request.update(**embed or {})
        return Context(request)

    @cached_property
    def group_index(self):
        # used by backend.on_chord_part_return to order return values in group
        return self._request_dict.get('group_index')


def create_request_cls(base, task, pool, hostname, eventer,
                       ref=ref, revoked_tasks=revoked_tasks,
                       task_ready=task_ready, trace=None, app=current_app):
    default_time_limit = task.time_limit
    default_soft_time_limit = task.soft_time_limit
    apply_async = pool.apply_async
    acks_late = task.acks_late
    events = eventer and eventer.enabled

    if trace is None:
        trace = fast_trace_task if app.use_fast_trace_task else trace_task_ret

    class Request(base):

        def execute_using_pool(self, pool, **kwargs):
            task_id = self.task_id
            if self.revoked():
                raise TaskRevokedError(task_id)

            time_limit, soft_time_limit = self.time_limits
            result = apply_async(
                trace,
                args=(self.type, task_id, self.request_dict, self.body,
                      self.content_type, self.content_encoding),
                accept_callback=self.on_accepted,
                timeout_callback=self.on_timeout,
                callback=self.on_success,
                error_callback=self.on_failure,
                soft_timeout=soft_time_limit or default_soft_time_limit,
                timeout=time_limit or default_time_limit,
                correlation_id=task_id,
            )
            # cannot create weakref to None
            # pylint: disable=attribute-defined-outside-init
            self._apply_result = maybe(ref, result)
            return result

        def on_success(self, failed__retval__runtime, **kwargs):
            failed, retval, runtime = failed__retval__runtime
            if failed:
                exc = retval.exception
                if isinstance(exc, ExceptionWithTraceback):
                    exc = exc.exc
                if isinstance(exc, (SystemExit, KeyboardInterrupt)):
                    raise exc
                return self.on_failure(retval, return_ok=True)
            task_ready(self)

            if acks_late:
                self.acknowledge()

            if events:
                self.send_event(
                    'task-succeeded', result=retval, runtime=runtime,
                )

    return Request
