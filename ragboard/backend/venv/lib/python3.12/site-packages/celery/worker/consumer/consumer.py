"""Worker Consumer Blueprint.

This module contains the components responsible for consuming messages
from the broker, processing the messages and keeping the broker connections
up and running.
"""
import errno
import logging
import os
import warnings
from collections import defaultdict
from time import sleep

from billiard.common import restart_state
from billiard.exceptions import RestartFreqExceeded
from kombu.asynchronous.semaphore import DummyLock
from kombu.exceptions import ContentDisallowed, DecodeError
from kombu.utils.compat import _detect_environment
from kombu.utils.encoding import safe_repr
from kombu.utils.limits import TokenBucket
from vine import ppartial, promise

from celery import bootsteps, signals
from celery.app.trace import build_tracer
from celery.exceptions import (CPendingDeprecationWarning, InvalidTaskError, NotRegistered, WorkerShutdown,
                               WorkerTerminate)
from celery.utils.functional import noop
from celery.utils.log import get_logger
from celery.utils.nodenames import gethostname
from celery.utils.objects import Bunch
from celery.utils.text import truncate
from celery.utils.time import humanize_seconds, rate
from celery.worker import loops
from celery.worker.state import active_requests, maybe_shutdown, requests, reserved_requests, task_reserved

__all__ = ('Consumer', 'Evloop', 'dump_body')

CLOSE = bootsteps.CLOSE
TERMINATE = bootsteps.TERMINATE
STOP_CONDITIONS = {CLOSE, TERMINATE}
logger = get_logger(__name__)
debug, info, warn, error, crit = (logger.debug, logger.info, logger.warning,
                                  logger.error, logger.critical)

CONNECTION_RETRY = """\
consumer: Connection to broker lost. \
Trying to re-establish the connection...\
"""

CONNECTION_RETRY_STEP = """\
Trying again {when}... ({retries}/{max_retries})\
"""

CONNECTION_ERROR = """\
consumer: Cannot connect to %s: %s.
%s
"""

CONNECTION_FAILOVER = """\
Will retry using next failover.\
"""

UNKNOWN_FORMAT = """\
Received and deleted unknown message.  Wrong destination?!?

The full contents of the message body was: %s
"""

#: Error message for when an unregistered task is received.
UNKNOWN_TASK_ERROR = """\
Received unregistered task of type %s.
The message has been ignored and discarded.

Did you remember to import the module containing this task?
Or maybe you're using relative imports?

Please see
https://docs.celeryq.dev/en/latest/internals/protocol.html
for more information.

The full contents of the message body was:
%s

The full contents of the message headers:
%s

The delivery info for this task is:
%s
"""

#: Error message for when an invalid task message is received.
INVALID_TASK_ERROR = """\
Received invalid task message: %s
The message has been ignored and discarded.

Please ensure your message conforms to the task
message protocol as described here:
https://docs.celeryq.dev/en/latest/internals/protocol.html

The full contents of the message body was:
%s
"""

MESSAGE_DECODE_ERROR = """\
Can't decode message body: %r [type:%r encoding:%r headers:%s]

body: %s
"""

MESSAGE_REPORT = """\
body: {0}
{{content_type:{1} content_encoding:{2}
  delivery_info:{3} headers={4}}}
"""

TERMINATING_TASK_ON_RESTART_AFTER_A_CONNECTION_LOSS = """\
Task %s cannot be acknowledged after a connection loss since late acknowledgement is enabled for it.
Terminating it instead.
"""

CANCEL_TASKS_BY_DEFAULT = """
In Celery 5.1 we introduced an optional breaking change which
on connection loss cancels all currently executed tasks with late acknowledgement enabled.
These tasks cannot be acknowledged as the connection is gone, and the tasks are automatically redelivered
back to the queue. You can enable this behavior using the worker_cancel_long_running_tasks_on_connection_loss
setting. In Celery 5.1 it is set to False by default. The setting will be set to True by default in Celery 6.0.
"""


def dump_body(m, body):
    """Format message body for debugging purposes."""
    # v2 protocol does not deserialize body
    body = m.body if body is None else body
    return '{} ({}b)'.format(truncate(safe_repr(body), 1024),
                             len(m.body))


class Consumer:
    """Consumer blueprint."""

    Strategies = dict

    #: Optional callback called the first time the worker
    #: is ready to receive tasks.
    init_callback = None

    #: The current worker pool instance.
    pool = None

    #: A timer used for high-priority internal tasks, such
    #: as sending heartbeats.
    timer = None

    restart_count = -1  # first start is the same as a restart

    #: This flag will be turned off after the first failed
    #: connection attempt.
    first_connection_attempt = True

    class Blueprint(bootsteps.Blueprint):
        """Consumer blueprint."""

        name = 'Consumer'
        default_steps = [
            'celery.worker.consumer.connection:Connection',
            'celery.worker.consumer.mingle:Mingle',
            'celery.worker.consumer.events:Events',
            'celery.worker.consumer.gossip:Gossip',
            'celery.worker.consumer.heart:Heart',
            'celery.worker.consumer.control:Control',
            'celery.worker.consumer.tasks:Tasks',
            'celery.worker.consumer.consumer:Evloop',
            'celery.worker.consumer.agent:Agent',
        ]

        def shutdown(self, parent):
            self.send_all(parent, 'shutdown')

    def __init__(self, on_task_request,
                 init_callback=noop, hostname=None,
                 pool=None, app=None,
                 timer=None, controller=None, hub=None, amqheartbeat=None,
                 worker_options=None, disable_rate_limits=False,
                 initial_prefetch_count=2, prefetch_multiplier=1, **kwargs):
        self.app = app
        self.controller = controller
        self.init_callback = init_callback
        self.hostname = hostname or gethostname()
        self.pid = os.getpid()
        self.pool = pool
        self.timer = timer
        self.strategies = self.Strategies()
        self.conninfo = self.app.connection_for_read()
        self.connection_errors = self.conninfo.connection_errors
        self.channel_errors = self.conninfo.channel_errors
        self._restart_state = restart_state(maxR=5, maxT=1)

        self._does_info = logger.isEnabledFor(logging.INFO)
        self._limit_order = 0
        self.on_task_request = on_task_request
        self.on_task_message = set()
        self.amqheartbeat_rate = self.app.conf.broker_heartbeat_checkrate
        self.disable_rate_limits = disable_rate_limits
        self.initial_prefetch_count = initial_prefetch_count
        self.prefetch_multiplier = prefetch_multiplier
        self._maximum_prefetch_restored = True

        # this contains a tokenbucket for each task type by name, used for
        # rate limits, or None if rate limits are disabled for that task.
        self.task_buckets = defaultdict(lambda: None)
        self.reset_rate_limits()

        self.hub = hub
        if self.hub or getattr(self.pool, 'is_green', False):
            self.amqheartbeat = amqheartbeat
            if self.amqheartbeat is None:
                self.amqheartbeat = self.app.conf.broker_heartbeat
        else:
            self.amqheartbeat = 0

        if not hasattr(self, 'loop'):
            self.loop = loops.asynloop if hub else loops.synloop

        if _detect_environment() == 'gevent':
            # there's a gevent bug that causes timeouts to not be reset,
            # so if the connection timeout is exceeded once, it can NEVER
            # connect again.
            self.app.conf.broker_connection_timeout = None

        self._pending_operations = []

        self.steps = []
        self.blueprint = self.Blueprint(
            steps=self.app.steps['consumer'],
            on_close=self.on_close,
        )
        self.blueprint.apply(self, **dict(worker_options or {}, **kwargs))

    def call_soon(self, p, *args, **kwargs):
        p = ppartial(p, *args, **kwargs)
        if self.hub:
            return self.hub.call_soon(p)
        self._pending_operations.append(p)
        return p

    def perform_pending_operations(self):
        if not self.hub:
            while self._pending_operations:
                try:
                    self._pending_operations.pop()()
                except Exception as exc:  # pylint: disable=broad-except
                    logger.exception('Pending callback raised: %r', exc)

    def bucket_for_task(self, type):
        limit = rate(getattr(type, 'rate_limit', None))
        return TokenBucket(limit, capacity=1) if limit else None

    def reset_rate_limits(self):
        self.task_buckets.update(
            (n, self.bucket_for_task(t)) for n, t in self.app.tasks.items()
        )

    def _update_prefetch_count(self, index=0):
        """Update prefetch count after pool/shrink grow operations.

        Index must be the change in number of processes as a positive
        (increasing) or negative (decreasing) number.

        Note:
            Currently pool grow operations will end up with an offset
            of +1 if the initial size of the pool was 0 (e.g.
            :option:`--autoscale=1,0 <celery worker --autoscale>`).
        """
        num_processes = self.pool.num_processes
        if not self.initial_prefetch_count or not num_processes:
            return  # prefetch disabled
        self.initial_prefetch_count = (
            self.pool.num_processes * self.prefetch_multiplier
        )
        return self._update_qos_eventually(index)

    def _update_qos_eventually(self, index):
        return (self.qos.decrement_eventually if index < 0
                else self.qos.increment_eventually)(
            abs(index) * self.prefetch_multiplier)

    def _limit_move_to_pool(self, request):
        task_reserved(request)
        self.on_task_request(request)

    def _schedule_bucket_request(self, bucket):
        while True:
            try:
                request, tokens = bucket.pop()
            except IndexError:
                # no request, break
                break

            if bucket.can_consume(tokens):
                self._limit_move_to_pool(request)
                continue
            else:
                # requeue to head, keep the order.
                bucket.contents.appendleft((request, tokens))

                pri = self._limit_order = (self._limit_order + 1) % 10
                hold = bucket.expected_time(tokens)
                self.timer.call_after(
                    hold, self._schedule_bucket_request, (bucket,),
                    priority=pri,
                )
                # no tokens, break
                break

    def _limit_task(self, request, bucket, tokens):
        bucket.add((request, tokens))
        return self._schedule_bucket_request(bucket)

    def _limit_post_eta(self, request, bucket, tokens):
        self.qos.decrement_eventually()
        bucket.add((request, tokens))
        return self._schedule_bucket_request(bucket)

    def start(self):
        blueprint = self.blueprint
        while blueprint.state not in STOP_CONDITIONS:
            maybe_shutdown()
            if self.restart_count:
                try:
                    self._restart_state.step()
                except RestartFreqExceeded as exc:
                    crit('Frequent restarts detected: %r', exc, exc_info=1)
                    sleep(1)
            self.restart_count += 1
            if self.app.conf.broker_channel_error_retry:
                recoverable_errors = (self.connection_errors + self.channel_errors)
            else:
                recoverable_errors = self.connection_errors
            try:
                blueprint.start(self)
            except recoverable_errors as exc:
                # If we're not retrying connections, we need to properly shutdown or terminate
                # the Celery main process instead of abruptly aborting the process without any cleanup.
                is_connection_loss_on_startup = self.first_connection_attempt
                self.first_connection_attempt = False
                connection_retry_type = self._get_connection_retry_type(is_connection_loss_on_startup)
                connection_retry = self.app.conf[connection_retry_type]
                if not connection_retry:
                    crit(
                        f"Retrying to {'establish' if is_connection_loss_on_startup else 're-establish'} "
                        f"a connection to the message broker after a connection loss has "
                        f"been disabled (app.conf.{connection_retry_type}=False). Shutting down..."
                    )
                    raise WorkerShutdown(1) from exc
                if isinstance(exc, OSError) and exc.errno == errno.EMFILE:
                    crit("Too many open files. Aborting...")
                    raise WorkerTerminate(1) from exc
                maybe_shutdown()
                if blueprint.state not in STOP_CONDITIONS:
                    if self.connection:
                        self.on_connection_error_after_connected(exc)
                    else:
                        self.on_connection_error_before_connected(exc)
                    self.on_close()
                    blueprint.restart(self)

    def _get_connection_retry_type(self, is_connection_loss_on_startup):
        return ('broker_connection_retry_on_startup'
                if (is_connection_loss_on_startup
                    and self.app.conf.broker_connection_retry_on_startup is not None)
                else 'broker_connection_retry')

    def on_connection_error_before_connected(self, exc):
        error(CONNECTION_ERROR, self.conninfo.as_uri(), exc,
              'Trying to reconnect...')

    def on_connection_error_after_connected(self, exc):
        warn(CONNECTION_RETRY, exc_info=True)
        try:
            self.connection.collect()
        except Exception:  # pylint: disable=broad-except
            pass

        if self.app.conf.worker_cancel_long_running_tasks_on_connection_loss:
            for request in tuple(active_requests):
                if request.task.acks_late and not request.acknowledged:
                    warn(TERMINATING_TASK_ON_RESTART_AFTER_A_CONNECTION_LOSS,
                         request)
                    request.cancel(self.pool)
        else:
            warnings.warn(CANCEL_TASKS_BY_DEFAULT, CPendingDeprecationWarning)

        self.initial_prefetch_count = max(
            self.prefetch_multiplier,
            self.max_prefetch_count - len(tuple(active_requests)) * self.prefetch_multiplier
        )

        self._maximum_prefetch_restored = self.initial_prefetch_count == self.max_prefetch_count
        if not self._maximum_prefetch_restored:
            logger.info(
                f"Temporarily reducing the prefetch count to {self.initial_prefetch_count} to avoid over-fetching "
                f"since {len(tuple(active_requests))} tasks are currently being processed.\n"
                f"The prefetch count will be gradually restored to {self.max_prefetch_count} as the tasks "
                "complete processing."
            )

    def register_with_event_loop(self, hub):
        self.blueprint.send_all(
            self, 'register_with_event_loop', args=(hub,),
            description='Hub.register',
        )

    def shutdown(self):
        self.blueprint.shutdown(self)

    def stop(self):
        self.blueprint.stop(self)

    def on_ready(self):
        callback, self.init_callback = self.init_callback, None
        if callback:
            callback(self)

    def loop_args(self):
        return (self, self.connection, self.task_consumer,
                self.blueprint, self.hub, self.qos, self.amqheartbeat,
                self.app.clock, self.amqheartbeat_rate)

    def on_decode_error(self, message, exc):
        """Callback called if an error occurs while decoding a message.

        Simply logs the error and acknowledges the message so it
        doesn't enter a loop.

        Arguments:
            message (kombu.Message): The message received.
            exc (Exception): The exception being handled.
        """
        crit(MESSAGE_DECODE_ERROR,
             exc, message.content_type, message.content_encoding,
             safe_repr(message.headers), dump_body(message, message.body),
             exc_info=1)
        message.ack()

    def on_close(self):
        # Clear internal queues to get rid of old messages.
        # They can't be acked anyway, as a delivery tag is specific
        # to the current channel.
        if self.controller and self.controller.semaphore:
            self.controller.semaphore.clear()
        if self.timer:
            self.timer.clear()
        for bucket in self.task_buckets.values():
            if bucket:
                bucket.clear_pending()
        for request_id in reserved_requests:
            if request_id in requests:
                del requests[request_id]
        reserved_requests.clear()
        if self.pool and self.pool.flush:
            self.pool.flush()

    def connect(self):
        """Establish the broker connection used for consuming tasks.

        Retries establishing the connection if the
        :setting:`broker_connection_retry` setting is enabled
        """
        conn = self.connection_for_read(heartbeat=self.amqheartbeat)
        if self.hub:
            conn.transport.register_with_event_loop(conn.connection, self.hub)
        return conn

    def connection_for_read(self, heartbeat=None):
        return self.ensure_connected(
            self.app.connection_for_read(heartbeat=heartbeat))

    def connection_for_write(self, heartbeat=None):
        return self.ensure_connected(
            self.app.connection_for_write(heartbeat=heartbeat))

    def ensure_connected(self, conn):
        # Callback called for each retry while the connection
        # can't be established.
        def _error_handler(exc, interval, next_step=CONNECTION_RETRY_STEP):
            if getattr(conn, 'alt', None) and interval == 0:
                next_step = CONNECTION_FAILOVER
            next_step = next_step.format(
                when=humanize_seconds(interval, 'in', ' '),
                retries=int(interval / 2),
                max_retries=self.app.conf.broker_connection_max_retries)
            error(CONNECTION_ERROR, conn.as_uri(), exc, next_step)

        # Remember that the connection is lazy, it won't establish
        # until needed.

        # TODO: Rely only on broker_connection_retry_on_startup to determine whether connection retries are disabled.
        #       We will make the switch in Celery 6.0.

        retry_disabled = False

        if self.app.conf.broker_connection_retry_on_startup is None:
            # If broker_connection_retry_on_startup is not set, revert to broker_connection_retry
            # to determine whether connection retries are disabled.
            retry_disabled = not self.app.conf.broker_connection_retry

            warnings.warn(
                CPendingDeprecationWarning(
                    f"The broker_connection_retry configuration setting will no longer determine\n"
                    f"whether broker connection retries are made during startup in Celery 6.0 and above.\n"
                    f"If you wish to retain the existing behavior for retrying connections on startup,\n"
                    f"you should set broker_connection_retry_on_startup to {self.app.conf.broker_connection_retry}.")
            )
        else:
            if self.first_connection_attempt:
                retry_disabled = not self.app.conf.broker_connection_retry_on_startup
            else:
                retry_disabled = not self.app.conf.broker_connection_retry

        if retry_disabled:
            # Retry disabled, just call connect directly.
            conn.connect()
            self.first_connection_attempt = False
            return conn

        conn = conn.ensure_connection(
            _error_handler, self.app.conf.broker_connection_max_retries,
            callback=maybe_shutdown,
        )
        self.first_connection_attempt = False
        return conn

    def _flush_events(self):
        if self.event_dispatcher:
            self.event_dispatcher.flush()

    def on_send_event_buffered(self):
        if self.hub:
            self.hub._ready.add(self._flush_events)

    def add_task_queue(self, queue, exchange=None, exchange_type=None,
                       routing_key=None, **options):
        cset = self.task_consumer
        queues = self.app.amqp.queues
        # Must use in' here, as __missing__ will automatically
        # create queues when :setting:`task_create_missing_queues` is enabled.
        # (Issue #1079)
        if queue in queues:
            q = queues[queue]
        else:
            exchange = queue if exchange is None else exchange
            exchange_type = ('direct' if exchange_type is None
                             else exchange_type)
            q = queues.select_add(queue,
                                  exchange=exchange,
                                  exchange_type=exchange_type,
                                  routing_key=routing_key, **options)
        if not cset.consuming_from(queue):
            cset.add_queue(q)
            cset.consume()
            info('Started consuming from %s', queue)

    def cancel_task_queue(self, queue):
        info('Canceling queue %s', queue)
        self.app.amqp.queues.deselect(queue)
        self.task_consumer.cancel_by_queue(queue)

    def apply_eta_task(self, task):
        """Method called by the timer to apply a task with an ETA/countdown."""
        task_reserved(task)
        self.on_task_request(task)
        self.qos.decrement_eventually()

    def _message_report(self, body, message):
        return MESSAGE_REPORT.format(dump_body(message, body),
                                     safe_repr(message.content_type),
                                     safe_repr(message.content_encoding),
                                     safe_repr(message.delivery_info),
                                     safe_repr(message.headers))

    def on_unknown_message(self, body, message):
        warn(UNKNOWN_FORMAT, self._message_report(body, message))
        message.reject_log_error(logger, self.connection_errors)
        signals.task_rejected.send(sender=self, message=message, exc=None)

    def on_unknown_task(self, body, message, exc):
        error(UNKNOWN_TASK_ERROR,
              exc,
              dump_body(message, body),
              message.headers,
              message.delivery_info,
              exc_info=True)
        try:
            id_, name = message.headers['id'], message.headers['task']
            root_id = message.headers.get('root_id')
        except KeyError:  # proto1
            payload = message.payload
            id_, name = payload['id'], payload['task']
            root_id = None
        request = Bunch(
            name=name, chord=None, root_id=root_id,
            correlation_id=message.properties.get('correlation_id'),
            reply_to=message.properties.get('reply_to'),
            errbacks=None,
        )
        message.reject_log_error(logger, self.connection_errors)
        self.app.backend.mark_as_failure(
            id_, NotRegistered(name), request=request,
        )
        if self.event_dispatcher:
            self.event_dispatcher.send(
                'task-failed', uuid=id_,
                exception=f'NotRegistered({name!r})',
            )
        signals.task_unknown.send(
            sender=self, message=message, exc=exc, name=name, id=id_,
        )

    def on_invalid_task(self, body, message, exc):
        error(INVALID_TASK_ERROR, exc, dump_body(message, body),
              exc_info=True)
        message.reject_log_error(logger, self.connection_errors)
        signals.task_rejected.send(sender=self, message=message, exc=exc)

    def update_strategies(self):
        loader = self.app.loader
        for name, task in self.app.tasks.items():
            self.strategies[name] = task.start_strategy(self.app, self)
            task.__trace__ = build_tracer(name, task, loader, self.hostname,
                                          app=self.app)

    def create_task_handler(self, promise=promise):
        strategies = self.strategies
        on_unknown_message = self.on_unknown_message
        on_unknown_task = self.on_unknown_task
        on_invalid_task = self.on_invalid_task
        callbacks = self.on_task_message
        call_soon = self.call_soon

        def on_task_received(message):
            # payload will only be set for v1 protocol, since v2
            # will defer deserializing the message body to the pool.
            payload = None
            try:
                type_ = message.headers['task']  # protocol v2
            except TypeError:
                return on_unknown_message(None, message)
            except KeyError:
                try:
                    payload = message.decode()
                except Exception as exc:  # pylint: disable=broad-except
                    return self.on_decode_error(message, exc)
                try:
                    type_, payload = payload['task'], payload  # protocol v1
                except (TypeError, KeyError):
                    return on_unknown_message(payload, message)
            try:
                strategy = strategies[type_]
            except KeyError as exc:
                return on_unknown_task(None, message, exc)
            else:
                try:
                    ack_log_error_promise = promise(
                        call_soon,
                        (message.ack_log_error,),
                        on_error=self._restore_prefetch_count_after_connection_restart,
                    )
                    reject_log_error_promise = promise(
                        call_soon,
                        (message.reject_log_error,),
                        on_error=self._restore_prefetch_count_after_connection_restart,
                    )

                    if (
                        not self._maximum_prefetch_restored
                        and self.restart_count > 0
                        and self._new_prefetch_count <= self.max_prefetch_count
                    ):
                        ack_log_error_promise.then(self._restore_prefetch_count_after_connection_restart,
                                                   on_error=self._restore_prefetch_count_after_connection_restart)
                        reject_log_error_promise.then(self._restore_prefetch_count_after_connection_restart,
                                                      on_error=self._restore_prefetch_count_after_connection_restart)

                    strategy(
                        message, payload,
                        ack_log_error_promise,
                        reject_log_error_promise,
                        callbacks,
                    )
                except (InvalidTaskError, ContentDisallowed) as exc:
                    return on_invalid_task(payload, message, exc)
                except DecodeError as exc:
                    return self.on_decode_error(message, exc)

        return on_task_received

    def _restore_prefetch_count_after_connection_restart(self, p, *args):
        with self.qos._mutex:
            if self._maximum_prefetch_restored:
                return

            new_prefetch_count = min(self.max_prefetch_count, self._new_prefetch_count)
            self.qos.value = self.initial_prefetch_count = new_prefetch_count
            self.qos.set(self.qos.value)

            already_restored = self._maximum_prefetch_restored
            self._maximum_prefetch_restored = new_prefetch_count == self.max_prefetch_count

            if already_restored is False and self._maximum_prefetch_restored is True:
                logger.info(
                    "Resuming normal operations following a restart.\n"
                    f"Prefetch count has been restored to the maximum of {self.max_prefetch_count}"
                )

    @property
    def max_prefetch_count(self):
        return self.pool.num_processes * self.prefetch_multiplier

    @property
    def _new_prefetch_count(self):
        return self.qos.value + self.prefetch_multiplier

    def __repr__(self):
        """``repr(self)``."""
        return '<Consumer: {self.hostname} ({state})>'.format(
            self=self, state=self.blueprint.human_state(),
        )


class Evloop(bootsteps.StartStopStep):
    """Event loop service.

    Note:
        This is always started last.
    """

    label = 'event loop'
    last = True

    def start(self, c):
        self.patch_all(c)
        c.loop(*c.loop_args())

    def patch_all(self, c):
        c.qos._mutex = DummyLock()
