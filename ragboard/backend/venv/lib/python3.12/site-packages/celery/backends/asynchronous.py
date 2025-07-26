"""Async I/O backend support utilities."""
import socket
import threading
import time
from collections import deque
from queue import Empty
from time import sleep
from weakref import WeakKeyDictionary

from kombu.utils.compat import detect_environment

from celery import states
from celery.exceptions import TimeoutError
from celery.utils.threads import THREAD_TIMEOUT_MAX

__all__ = (
    'AsyncBackendMixin', 'BaseResultConsumer', 'Drainer',
    'register_drainer',
)

drainers = {}


def register_drainer(name):
    """Decorator used to register a new result drainer type."""
    def _inner(cls):
        drainers[name] = cls
        return cls
    return _inner


@register_drainer('default')
class Drainer:
    """Result draining service."""

    def __init__(self, result_consumer):
        self.result_consumer = result_consumer

    def start(self):
        pass

    def stop(self):
        pass

    def drain_events_until(self, p, timeout=None, interval=1, on_interval=None, wait=None):
        wait = wait or self.result_consumer.drain_events
        time_start = time.monotonic()

        while 1:
            # Total time spent may exceed a single call to wait()
            if timeout and time.monotonic() - time_start >= timeout:
                raise socket.timeout()
            try:
                yield self.wait_for(p, wait, timeout=interval)
            except socket.timeout:
                pass
            if on_interval:
                on_interval()
            if p.ready:  # got event on the wanted channel.
                break

    def wait_for(self, p, wait, timeout=None):
        wait(timeout=timeout)


class greenletDrainer(Drainer):
    spawn = None
    _g = None
    _drain_complete_event = None    # event, sended (and recreated) after every drain_events iteration

    def _create_drain_complete_event(self):
        """create new self._drain_complete_event object"""
        pass

    def _send_drain_complete_event(self):
        """raise self._drain_complete_event for wakeup .wait_for"""
        pass

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._started = threading.Event()
        self._stopped = threading.Event()
        self._shutdown = threading.Event()
        self._create_drain_complete_event()

    def run(self):
        self._started.set()
        while not self._stopped.is_set():
            try:
                self.result_consumer.drain_events(timeout=1)
                self._send_drain_complete_event()
                self._create_drain_complete_event()
            except socket.timeout:
                pass
        self._shutdown.set()

    def start(self):
        if not self._started.is_set():
            self._g = self.spawn(self.run)
            self._started.wait()

    def stop(self):
        self._stopped.set()
        self._send_drain_complete_event()
        self._shutdown.wait(THREAD_TIMEOUT_MAX)

    def wait_for(self, p, wait, timeout=None):
        self.start()
        if not p.ready:
            self._drain_complete_event.wait(timeout=timeout)


@register_drainer('eventlet')
class eventletDrainer(greenletDrainer):

    def spawn(self, func):
        from eventlet import sleep, spawn
        g = spawn(func)
        sleep(0)
        return g

    def _create_drain_complete_event(self):
        from eventlet.event import Event
        self._drain_complete_event = Event()

    def _send_drain_complete_event(self):
        self._drain_complete_event.send()


@register_drainer('gevent')
class geventDrainer(greenletDrainer):

    def spawn(self, func):
        import gevent
        g = gevent.spawn(func)
        gevent.sleep(0)
        return g

    def _create_drain_complete_event(self):
        from gevent.event import Event
        self._drain_complete_event = Event()

    def _send_drain_complete_event(self):
        self._drain_complete_event.set()
        self._create_drain_complete_event()


class AsyncBackendMixin:
    """Mixin for backends that enables the async API."""

    def _collect_into(self, result, bucket):
        self.result_consumer.buckets[result] = bucket

    def iter_native(self, result, no_ack=True, **kwargs):
        self._ensure_not_eager()

        results = result.results
        if not results:
            raise StopIteration()

        # we tell the result consumer to put consumed results
        # into these buckets.
        bucket = deque()
        for node in results:
            if not hasattr(node, '_cache'):
                bucket.append(node)
            elif node._cache:
                bucket.append(node)
            else:
                self._collect_into(node, bucket)

        for _ in self._wait_for_pending(result, no_ack=no_ack, **kwargs):
            while bucket:
                node = bucket.popleft()
                if not hasattr(node, '_cache'):
                    yield node.id, node.children
                else:
                    yield node.id, node._cache
        while bucket:
            node = bucket.popleft()
            yield node.id, node._cache

    def add_pending_result(self, result, weak=False, start_drainer=True):
        if start_drainer:
            self.result_consumer.drainer.start()
        try:
            self._maybe_resolve_from_buffer(result)
        except Empty:
            self._add_pending_result(result.id, result, weak=weak)
        return result

    def _maybe_resolve_from_buffer(self, result):
        result._maybe_set_cache(self._pending_messages.take(result.id))

    def _add_pending_result(self, task_id, result, weak=False):
        concrete, weak_ = self._pending_results
        if task_id not in weak_ and result.id not in concrete:
            (weak_ if weak else concrete)[task_id] = result
            self.result_consumer.consume_from(task_id)

    def add_pending_results(self, results, weak=False):
        self.result_consumer.drainer.start()
        return [self.add_pending_result(result, weak=weak, start_drainer=False)
                for result in results]

    def remove_pending_result(self, result):
        self._remove_pending_result(result.id)
        self.on_result_fulfilled(result)
        return result

    def _remove_pending_result(self, task_id):
        for mapping in self._pending_results:
            mapping.pop(task_id, None)

    def on_result_fulfilled(self, result):
        self.result_consumer.cancel_for(result.id)

    def wait_for_pending(self, result,
                         callback=None, propagate=True, **kwargs):
        self._ensure_not_eager()
        for _ in self._wait_for_pending(result, **kwargs):
            pass
        return result.maybe_throw(callback=callback, propagate=propagate)

    def _wait_for_pending(self, result,
                          timeout=None, on_interval=None, on_message=None,
                          **kwargs):
        return self.result_consumer._wait_for_pending(
            result, timeout=timeout,
            on_interval=on_interval, on_message=on_message,
            **kwargs
        )

    @property
    def is_async(self):
        return True


class BaseResultConsumer:
    """Manager responsible for consuming result messages."""

    def __init__(self, backend, app, accept,
                 pending_results, pending_messages):
        self.backend = backend
        self.app = app
        self.accept = accept
        self._pending_results = pending_results
        self._pending_messages = pending_messages
        self.on_message = None
        self.buckets = WeakKeyDictionary()
        self.drainer = drainers[detect_environment()](self)

    def start(self, initial_task_id, **kwargs):
        raise NotImplementedError()

    def stop(self):
        pass

    def drain_events(self, timeout=None):
        raise NotImplementedError()

    def consume_from(self, task_id):
        raise NotImplementedError()

    def cancel_for(self, task_id):
        raise NotImplementedError()

    def _after_fork(self):
        self.buckets.clear()
        self.buckets = WeakKeyDictionary()
        self.on_message = None
        self.on_after_fork()

    def on_after_fork(self):
        pass

    def drain_events_until(self, p, timeout=None, on_interval=None):
        return self.drainer.drain_events_until(
            p, timeout=timeout, on_interval=on_interval)

    def _wait_for_pending(self, result,
                          timeout=None, on_interval=None, on_message=None,
                          **kwargs):
        self.on_wait_for_pending(result, timeout=timeout, **kwargs)
        prev_on_m, self.on_message = self.on_message, on_message
        try:
            for _ in self.drain_events_until(
                    result.on_ready, timeout=timeout,
                    on_interval=on_interval):
                yield
                sleep(0)
        except socket.timeout:
            raise TimeoutError('The operation timed out.')
        finally:
            self.on_message = prev_on_m

    def on_wait_for_pending(self, result, timeout=None, **kwargs):
        pass

    def on_out_of_band_result(self, message):
        self.on_state_change(message.payload, message)

    def _get_pending_result(self, task_id):
        for mapping in self._pending_results:
            try:
                return mapping[task_id]
            except KeyError:
                pass
        raise KeyError(task_id)

    def on_state_change(self, meta, message):
        if self.on_message:
            self.on_message(meta)
        if meta['status'] in states.READY_STATES:
            task_id = meta['task_id']
            try:
                result = self._get_pending_result(task_id)
            except KeyError:
                # send to buffer in case we received this result
                # before it was added to _pending_results.
                self._pending_messages.put(task_id, meta)
            else:
                result._maybe_set_cache(meta)
                buckets = self.buckets
                try:
                    # remove bucket for this result, since it's fulfilled
                    bucket = buckets.pop(result)
                except KeyError:
                    pass
                else:
                    # send to waiter via bucket
                    bucket.append(result)
        sleep(0)
