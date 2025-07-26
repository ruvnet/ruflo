"""The ``RPC`` result backend for AMQP brokers.

RPC-style result backend, using reply-to and one queue per client.
"""
import time

import kombu
from kombu.common import maybe_declare
from kombu.utils.compat import register_after_fork
from kombu.utils.objects import cached_property

from celery import states
from celery._state import current_task, task_join_will_block

from . import base
from .asynchronous import AsyncBackendMixin, BaseResultConsumer

__all__ = ('BacklogLimitExceeded', 'RPCBackend')

E_NO_CHORD_SUPPORT = """
The "rpc" result backend does not support chords!

Note that a group chained with a task is also upgraded to be a chord,
as this pattern requires synchronization.

Result backends that supports chords: Redis, Database, Memcached, and more.
"""


class BacklogLimitExceeded(Exception):
    """Too much state history to fast-forward."""


def _on_after_fork_cleanup_backend(backend):
    backend._after_fork()


class ResultConsumer(BaseResultConsumer):
    Consumer = kombu.Consumer

    _connection = None
    _consumer = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_binding = self.backend._create_binding

    def start(self, initial_task_id, no_ack=True, **kwargs):
        self._connection = self.app.connection()
        initial_queue = self._create_binding(initial_task_id)
        self._consumer = self.Consumer(
            self._connection.default_channel, [initial_queue],
            callbacks=[self.on_state_change], no_ack=no_ack,
            accept=self.accept)
        self._consumer.consume()

    def drain_events(self, timeout=None):
        if self._connection:
            return self._connection.drain_events(timeout=timeout)
        elif timeout:
            time.sleep(timeout)

    def stop(self):
        try:
            self._consumer.cancel()
        finally:
            self._connection.close()

    def on_after_fork(self):
        self._consumer = None
        if self._connection is not None:
            self._connection.collect()
            self._connection = None

    def consume_from(self, task_id):
        if self._consumer is None:
            return self.start(task_id)
        queue = self._create_binding(task_id)
        if not self._consumer.consuming_from(queue):
            self._consumer.add_queue(queue)
            self._consumer.consume()

    def cancel_for(self, task_id):
        if self._consumer:
            self._consumer.cancel_by_queue(self._create_binding(task_id).name)


class RPCBackend(base.Backend, AsyncBackendMixin):
    """Base class for the RPC result backend."""

    Exchange = kombu.Exchange
    Producer = kombu.Producer
    ResultConsumer = ResultConsumer

    #: Exception raised when there are too many messages for a task id.
    BacklogLimitExceeded = BacklogLimitExceeded

    persistent = False
    supports_autoexpire = True
    supports_native_join = True

    retry_policy = {
        'max_retries': 20,
        'interval_start': 0,
        'interval_step': 1,
        'interval_max': 1,
    }

    class Consumer(kombu.Consumer):
        """Consumer that requires manual declaration of queues."""

        auto_declare = False

    class Queue(kombu.Queue):
        """Queue that never caches declaration."""

        can_cache_declaration = False

    def __init__(self, app, connection=None, exchange=None, exchange_type=None,
                 persistent=None, serializer=None, auto_delete=True, **kwargs):
        super().__init__(app, **kwargs)
        conf = self.app.conf
        self._connection = connection
        self._out_of_band = {}
        self.persistent = self.prepare_persistent(persistent)
        self.delivery_mode = 2 if self.persistent else 1
        exchange = exchange or conf.result_exchange
        exchange_type = exchange_type or conf.result_exchange_type
        self.exchange = self._create_exchange(
            exchange, exchange_type, self.delivery_mode,
        )
        self.serializer = serializer or conf.result_serializer
        self.auto_delete = auto_delete
        self.result_consumer = self.ResultConsumer(
            self, self.app, self.accept,
            self._pending_results, self._pending_messages,
        )
        if register_after_fork is not None:
            register_after_fork(self, _on_after_fork_cleanup_backend)

    def _after_fork(self):
        # clear state for child processes.
        self._pending_results.clear()
        self.result_consumer._after_fork()

    def _create_exchange(self, name, type='direct', delivery_mode=2):
        # uses direct to queue routing (anon exchange).
        return self.Exchange(None)

    def _create_binding(self, task_id):
        """Create new binding for task with id."""
        # RPC backend caches the binding, as one queue is used for all tasks.
        return self.binding

    def ensure_chords_allowed(self):
        raise NotImplementedError(E_NO_CHORD_SUPPORT.strip())

    def on_task_call(self, producer, task_id):
        # Called every time a task is sent when using this backend.
        # We declare the queue we receive replies on in advance of sending
        # the message, but we skip this if running in the prefork pool
        # (task_join_will_block), as we know the queue is already declared.
        if not task_join_will_block():
            maybe_declare(self.binding(producer.channel), retry=True)

    def destination_for(self, task_id, request):
        """Get the destination for result by task id.

        Returns:
            Tuple[str, str]: tuple of ``(reply_to, correlation_id)``.
        """
        # Backends didn't always receive the `request`, so we must still
        # support old code that relies on current_task.
        try:
            request = request or current_task.request
        except AttributeError:
            raise RuntimeError(
                f'RPC backend missing task request for {task_id!r}')
        return request.reply_to, request.correlation_id or task_id

    def on_reply_declare(self, task_id):
        # Return value here is used as the `declare=` argument
        # for Producer.publish.
        # By default we don't have to declare anything when sending a result.
        pass

    def on_result_fulfilled(self, result):
        # This usually cancels the queue after the result is received,
        # but we don't have to cancel since we have one queue per process.
        pass

    def as_uri(self, include_password=True):
        return 'rpc://'

    def store_result(self, task_id, result, state,
                     traceback=None, request=None, **kwargs):
        """Send task return value and state."""
        routing_key, correlation_id = self.destination_for(task_id, request)
        if not routing_key:
            return
        with self.app.amqp.producer_pool.acquire(block=True) as producer:
            producer.publish(
                self._to_result(task_id, state, result, traceback, request),
                exchange=self.exchange,
                routing_key=routing_key,
                correlation_id=correlation_id,
                serializer=self.serializer,
                retry=True, retry_policy=self.retry_policy,
                declare=self.on_reply_declare(task_id),
                delivery_mode=self.delivery_mode,
            )
        return result

    def _to_result(self, task_id, state, result, traceback, request):
        return {
            'task_id': task_id,
            'status': state,
            'result': self.encode_result(result, state),
            'traceback': traceback,
            'children': self.current_task_children(request),
        }

    def on_out_of_band_result(self, task_id, message):
        # Callback called when a reply for a task is received,
        # but we have no idea what do do with it.
        # Since the result is not pending, we put it in a separate
        # buffer: probably it will become pending later.
        if self.result_consumer:
            self.result_consumer.on_out_of_band_result(message)
        self._out_of_band[task_id] = message

    def get_task_meta(self, task_id, backlog_limit=1000):
        buffered = self._out_of_band.pop(task_id, None)
        if buffered:
            return self._set_cache_by_message(task_id, buffered)

        # Polling and using basic_get
        latest_by_id = {}
        prev = None
        for acc in self._slurp_from_queue(task_id, self.accept, backlog_limit):
            tid = self._get_message_task_id(acc)
            prev, latest_by_id[tid] = latest_by_id.get(tid), acc
            if prev:
                # backends aren't expected to keep history,
                # so we delete everything except the most recent state.
                prev.ack()
                prev = None

        latest = latest_by_id.pop(task_id, None)
        for tid, msg in latest_by_id.items():
            self.on_out_of_band_result(tid, msg)

        if latest:
            latest.requeue()
            return self._set_cache_by_message(task_id, latest)
        else:
            # no new state, use previous
            try:
                return self._cache[task_id]
            except KeyError:
                # result probably pending.
                return {'status': states.PENDING, 'result': None}
    poll = get_task_meta  # XXX compat

    def _set_cache_by_message(self, task_id, message):
        payload = self._cache[task_id] = self.meta_from_decoded(
            message.payload)
        return payload

    def _slurp_from_queue(self, task_id, accept,
                          limit=1000, no_ack=False):
        with self.app.pool.acquire_channel(block=True) as (_, channel):
            binding = self._create_binding(task_id)(channel)
            binding.declare()

            for _ in range(limit):
                msg = binding.get(accept=accept, no_ack=no_ack)
                if not msg:
                    break
                yield msg
            else:
                raise self.BacklogLimitExceeded(task_id)

    def _get_message_task_id(self, message):
        try:
            # try property first so we don't have to deserialize
            # the payload.
            return message.properties['correlation_id']
        except (AttributeError, KeyError):
            # message sent by old Celery version, need to deserialize.
            return message.payload['task_id']

    def revive(self, channel):
        pass

    def reload_task_result(self, task_id):
        raise NotImplementedError(
            'reload_task_result is not supported by this backend.')

    def reload_group_result(self, task_id):
        """Reload group result, even if it has been previously fetched."""
        raise NotImplementedError(
            'reload_group_result is not supported by this backend.')

    def save_group(self, group_id, result):
        raise NotImplementedError(
            'save_group is not supported by this backend.')

    def restore_group(self, group_id, cache=True):
        raise NotImplementedError(
            'restore_group is not supported by this backend.')

    def delete_group(self, group_id):
        raise NotImplementedError(
            'delete_group is not supported by this backend.')

    def __reduce__(self, args=(), kwargs=None):
        kwargs = {} if not kwargs else kwargs
        return super().__reduce__(args, dict(
            kwargs,
            connection=self._connection,
            exchange=self.exchange.name,
            exchange_type=self.exchange.type,
            persistent=self.persistent,
            serializer=self.serializer,
            auto_delete=self.auto_delete,
            expires=self.expires,
        ))

    @property
    def binding(self):
        return self.Queue(
            self.oid, self.exchange, self.oid,
            durable=False,
            auto_delete=True,
            expires=self.expires,
        )

    @cached_property
    def oid(self):
        # cached here is the app thread OID: name of queue we receive results on.
        return self.app.thread_oid
