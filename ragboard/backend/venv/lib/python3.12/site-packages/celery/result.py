"""Task results/state and results for groups of tasks."""

import datetime
import time
from collections import deque
from contextlib import contextmanager
from weakref import proxy

from kombu.utils.objects import cached_property
from vine import Thenable, barrier, promise

from . import current_app, states
from ._state import _set_task_join_will_block, task_join_will_block
from .app import app_or_default
from .exceptions import ImproperlyConfigured, IncompleteStream, TimeoutError
from .utils.graph import DependencyGraph, GraphFormatter

try:
    import tblib
except ImportError:
    tblib = None

__all__ = (
    'ResultBase', 'AsyncResult', 'ResultSet',
    'GroupResult', 'EagerResult', 'result_from_tuple',
)

E_WOULDBLOCK = """\
Never call result.get() within a task!
See https://docs.celeryq.dev/en/latest/userguide/tasks.html\
#avoid-launching-synchronous-subtasks
"""


def assert_will_not_block():
    if task_join_will_block():
        raise RuntimeError(E_WOULDBLOCK)


@contextmanager
def allow_join_result():
    reset_value = task_join_will_block()
    _set_task_join_will_block(False)
    try:
        yield
    finally:
        _set_task_join_will_block(reset_value)


@contextmanager
def denied_join_result():
    reset_value = task_join_will_block()
    _set_task_join_will_block(True)
    try:
        yield
    finally:
        _set_task_join_will_block(reset_value)


class ResultBase:
    """Base class for results."""

    #: Parent result (if part of a chain)
    parent = None


@Thenable.register
class AsyncResult(ResultBase):
    """Query task state.

    Arguments:
        id (str): See :attr:`id`.
        backend (Backend): See :attr:`backend`.
    """

    app = None

    #: Error raised for timeouts.
    TimeoutError = TimeoutError

    #: The task's UUID.
    id = None

    #: The task result backend to use.
    backend = None

    def __init__(self, id, backend=None,
                 task_name=None,            # deprecated
                 app=None, parent=None):
        if id is None:
            raise ValueError(
                f'AsyncResult requires valid id, not {type(id)}')
        self.app = app_or_default(app or self.app)
        self.id = id
        self.backend = backend or self.app.backend
        self.parent = parent
        self.on_ready = promise(self._on_fulfilled, weak=True)
        self._cache = None
        self._ignored = False

    @property
    def ignored(self):
        """If True, task result retrieval is disabled."""
        if hasattr(self, '_ignored'):
            return self._ignored
        return False

    @ignored.setter
    def ignored(self, value):
        """Enable/disable task result retrieval."""
        self._ignored = value

    def then(self, callback, on_error=None, weak=False):
        self.backend.add_pending_result(self, weak=weak)
        return self.on_ready.then(callback, on_error)

    def _on_fulfilled(self, result):
        self.backend.remove_pending_result(self)
        return result

    def as_tuple(self):
        parent = self.parent
        return (self.id, parent and parent.as_tuple()), None

    def as_list(self):
        """Return as a list of task IDs."""
        results = []
        parent = self.parent
        results.append(self.id)
        if parent is not None:
            results.extend(parent.as_list())
        return results

    def forget(self):
        """Forget the result of this task and its parents."""
        self._cache = None
        if self.parent:
            self.parent.forget()
        self.backend.forget(self.id)

    def revoke(self, connection=None, terminate=False, signal=None,
               wait=False, timeout=None):
        """Send revoke signal to all workers.

        Any worker receiving the task, or having reserved the
        task, *must* ignore it.

        Arguments:
            terminate (bool): Also terminate the process currently working
                on the task (if any).
            signal (str): Name of signal to send to process if terminate.
                Default is TERM.
            wait (bool): Wait for replies from workers.
                The ``timeout`` argument specifies the seconds to wait.
                Disabled by default.
            timeout (float): Time in seconds to wait for replies when
                ``wait`` is enabled.
        """
        self.app.control.revoke(self.id, connection=connection,
                                terminate=terminate, signal=signal,
                                reply=wait, timeout=timeout)

    def revoke_by_stamped_headers(self, headers, connection=None, terminate=False, signal=None,
                                  wait=False, timeout=None):
        """Send revoke signal to all workers only for tasks with matching headers values.

        Any worker receiving the task, or having reserved the
        task, *must* ignore it.
        All header fields *must* match.

        Arguments:
            headers (dict[str, Union(str, list)]): Headers to match when revoking tasks.
            terminate (bool): Also terminate the process currently working
                on the task (if any).
            signal (str): Name of signal to send to process if terminate.
                Default is TERM.
            wait (bool): Wait for replies from workers.
                The ``timeout`` argument specifies the seconds to wait.
                Disabled by default.
            timeout (float): Time in seconds to wait for replies when
                ``wait`` is enabled.
        """
        self.app.control.revoke_by_stamped_headers(headers, connection=connection,
                                                   terminate=terminate, signal=signal,
                                                   reply=wait, timeout=timeout)

    def get(self, timeout=None, propagate=True, interval=0.5,
            no_ack=True, follow_parents=True, callback=None, on_message=None,
            on_interval=None, disable_sync_subtasks=True,
            EXCEPTION_STATES=states.EXCEPTION_STATES,
            PROPAGATE_STATES=states.PROPAGATE_STATES):
        """Wait until task is ready, and return its result.

        Warning:
           Waiting for tasks within a task may lead to deadlocks.
           Please read :ref:`task-synchronous-subtasks`.

        Warning:
           Backends use resources to store and transmit results. To ensure
           that resources are released, you must eventually call
           :meth:`~@AsyncResult.get` or :meth:`~@AsyncResult.forget` on
           EVERY :class:`~@AsyncResult` instance returned after calling
           a task.

        Arguments:
            timeout (float): How long to wait, in seconds, before the
                operation times out. This is the setting for the publisher
                (celery client) and is different from `timeout` parameter of
                `@app.task`, which is the setting for the worker. The task
                isn't terminated even if timeout occurs.
            propagate (bool): Re-raise exception if the task failed.
            interval (float): Time to wait (in seconds) before retrying to
                retrieve the result.  Note that this does not have any effect
                when using the RPC/redis result store backends, as they don't
                use polling.
            no_ack (bool): Enable amqp no ack (automatically acknowledge
                message).  If this is :const:`False` then the message will
                **not be acked**.
            follow_parents (bool): Re-raise any exception raised by
                parent tasks.
            disable_sync_subtasks (bool): Disable tasks to wait for sub tasks
                this is the default configuration. CAUTION do not enable this
                unless you must.

        Raises:
            celery.exceptions.TimeoutError: if `timeout` isn't
                :const:`None` and the result does not arrive within
                `timeout` seconds.
            Exception: If the remote call raised an exception then that
                exception will be re-raised in the caller process.
        """
        if self.ignored:
            return

        if disable_sync_subtasks:
            assert_will_not_block()
        _on_interval = promise()
        if follow_parents and propagate and self.parent:
            _on_interval = promise(self._maybe_reraise_parent_error, weak=True)
            self._maybe_reraise_parent_error()
        if on_interval:
            _on_interval.then(on_interval)

        if self._cache:
            if propagate:
                self.maybe_throw(callback=callback)
            return self.result

        self.backend.add_pending_result(self)
        return self.backend.wait_for_pending(
            self, timeout=timeout,
            interval=interval,
            on_interval=_on_interval,
            no_ack=no_ack,
            propagate=propagate,
            callback=callback,
            on_message=on_message,
        )
    wait = get  # deprecated alias to :meth:`get`.

    def _maybe_reraise_parent_error(self):
        for node in reversed(list(self._parents())):
            node.maybe_throw()

    def _parents(self):
        node = self.parent
        while node:
            yield node
            node = node.parent

    def collect(self, intermediate=False, **kwargs):
        """Collect results as they return.

        Iterator, like :meth:`get` will wait for the task to complete,
        but will also follow :class:`AsyncResult` and :class:`ResultSet`
        returned by the task, yielding ``(result, value)`` tuples for each
        result in the tree.

        An example would be having the following tasks:

        .. code-block:: python

            from celery import group
            from proj.celery import app

            @app.task(trail=True)
            def A(how_many):
                return group(B.s(i) for i in range(how_many))()

            @app.task(trail=True)
            def B(i):
                return pow2.delay(i)

            @app.task(trail=True)
            def pow2(i):
                return i ** 2

        .. code-block:: pycon

            >>> from celery.result import ResultBase
            >>> from proj.tasks import A

            >>> result = A.delay(10)
            >>> [v for v in result.collect()
            ...  if not isinstance(v, (ResultBase, tuple))]
            [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]

        Note:
            The ``Task.trail`` option must be enabled
            so that the list of children is stored in ``result.children``.
            This is the default but enabled explicitly for illustration.

        Yields:
            Tuple[AsyncResult, Any]: tuples containing the result instance
            of the child task, and the return value of that task.
        """
        for _, R in self.iterdeps(intermediate=intermediate):
            yield R, R.get(**kwargs)

    def get_leaf(self):
        value = None
        for _, R in self.iterdeps():
            value = R.get()
        return value

    def iterdeps(self, intermediate=False):
        stack = deque([(None, self)])

        is_incomplete_stream = not intermediate

        while stack:
            parent, node = stack.popleft()
            yield parent, node
            if node.ready():
                stack.extend((node, child) for child in node.children or [])
            else:
                if is_incomplete_stream:
                    raise IncompleteStream()

    def ready(self):
        """Return :const:`True` if the task has executed.

        If the task is still running, pending, or is waiting
        for retry then :const:`False` is returned.
        """
        return self.state in self.backend.READY_STATES

    def successful(self):
        """Return :const:`True` if the task executed successfully."""
        return self.state == states.SUCCESS

    def failed(self):
        """Return :const:`True` if the task failed."""
        return self.state == states.FAILURE

    def throw(self, *args, **kwargs):
        self.on_ready.throw(*args, **kwargs)

    def maybe_throw(self, propagate=True, callback=None):
        cache = self._get_task_meta() if self._cache is None else self._cache
        state, value, tb = (
            cache['status'], cache['result'], cache.get('traceback'))
        if state in states.PROPAGATE_STATES and propagate:
            self.throw(value, self._to_remote_traceback(tb))
        if callback is not None:
            callback(self.id, value)
        return value
    maybe_reraise = maybe_throw   # XXX compat alias

    def _to_remote_traceback(self, tb):
        if tb and tblib is not None and self.app.conf.task_remote_tracebacks:
            return tblib.Traceback.from_string(tb).as_traceback()

    def build_graph(self, intermediate=False, formatter=None):
        graph = DependencyGraph(
            formatter=formatter or GraphFormatter(root=self.id, shape='oval'),
        )
        for parent, node in self.iterdeps(intermediate=intermediate):
            graph.add_arc(node)
            if parent:
                graph.add_edge(parent, node)
        return graph

    def __str__(self):
        """`str(self) -> self.id`."""
        return str(self.id)

    def __hash__(self):
        """`hash(self) -> hash(self.id)`."""
        return hash(self.id)

    def __repr__(self):
        return f'<{type(self).__name__}: {self.id}>'

    def __eq__(self, other):
        if isinstance(other, AsyncResult):
            return other.id == self.id
        elif isinstance(other, str):
            return other == self.id
        return NotImplemented

    def __copy__(self):
        return self.__class__(
            self.id, self.backend, None, self.app, self.parent,
        )

    def __reduce__(self):
        return self.__class__, self.__reduce_args__()

    def __reduce_args__(self):
        return self.id, self.backend, None, None, self.parent

    def __del__(self):
        """Cancel pending operations when the instance is destroyed."""
        if self.backend is not None:
            self.backend.remove_pending_result(self)

    @cached_property
    def graph(self):
        return self.build_graph()

    @property
    def supports_native_join(self):
        return self.backend.supports_native_join

    @property
    def children(self):
        return self._get_task_meta().get('children')

    def _maybe_set_cache(self, meta):
        if meta:
            state = meta['status']
            if state in states.READY_STATES:
                d = self._set_cache(self.backend.meta_from_decoded(meta))
                self.on_ready(self)
                return d
        return meta

    def _get_task_meta(self):
        if self._cache is None:
            return self._maybe_set_cache(self.backend.get_task_meta(self.id))
        return self._cache

    def _iter_meta(self, **kwargs):
        return iter([self._get_task_meta()])

    def _set_cache(self, d):
        children = d.get('children')
        if children:
            d['children'] = [
                result_from_tuple(child, self.app) for child in children
            ]
        self._cache = d
        return d

    @property
    def result(self):
        """Task return value.

        Note:
            When the task has been executed, this contains the return value.
            If the task raised an exception, this will be the exception
            instance.
        """
        return self._get_task_meta()['result']
    info = result

    @property
    def traceback(self):
        """Get the traceback of a failed task."""
        return self._get_task_meta().get('traceback')

    @property
    def state(self):
        """The tasks current state.

        Possible values includes:

            *PENDING*

                The task is waiting for execution.

            *STARTED*

                The task has been started.

            *RETRY*

                The task is to be retried, possibly because of failure.

            *FAILURE*

                The task raised an exception, or has exceeded the retry limit.
                The :attr:`result` attribute then contains the
                exception raised by the task.

            *SUCCESS*

                The task executed successfully.  The :attr:`result` attribute
                then contains the tasks return value.
        """
        return self._get_task_meta()['status']
    status = state  # XXX compat

    @property
    def task_id(self):
        """Compat. alias to :attr:`id`."""
        return self.id

    @task_id.setter
    def task_id(self, id):
        self.id = id

    @property
    def name(self):
        return self._get_task_meta().get('name')

    @property
    def args(self):
        return self._get_task_meta().get('args')

    @property
    def kwargs(self):
        return self._get_task_meta().get('kwargs')

    @property
    def worker(self):
        return self._get_task_meta().get('worker')

    @property
    def date_done(self):
        """UTC date and time."""
        date_done = self._get_task_meta().get('date_done')
        if date_done and not isinstance(date_done, datetime.datetime):
            return datetime.datetime.fromisoformat(date_done)
        return date_done

    @property
    def retries(self):
        return self._get_task_meta().get('retries')

    @property
    def queue(self):
        return self._get_task_meta().get('queue')


@Thenable.register
class ResultSet(ResultBase):
    """A collection of results.

    Arguments:
        results (Sequence[AsyncResult]): List of result instances.
    """

    _app = None

    #: List of results in in the set.
    results = None

    def __init__(self, results, app=None, ready_barrier=None, **kwargs):
        self._app = app
        self.results = results
        self.on_ready = promise(args=(proxy(self),))
        self._on_full = ready_barrier or barrier(results)
        if self._on_full:
            self._on_full.then(promise(self._on_ready, weak=True))

    def add(self, result):
        """Add :class:`AsyncResult` as a new member of the set.

        Does nothing if the result is already a member.
        """
        if result not in self.results:
            self.results.append(result)
            if self._on_full:
                self._on_full.add(result)

    def _on_ready(self):
        if self.backend.is_async:
            self.on_ready()

    def remove(self, result):
        """Remove result from the set; it must be a member.

        Raises:
            KeyError: if the result isn't a member.
        """
        if isinstance(result, str):
            result = self.app.AsyncResult(result)
        try:
            self.results.remove(result)
        except ValueError:
            raise KeyError(result)

    def discard(self, result):
        """Remove result from the set if it is a member.

        Does nothing if it's not a member.
        """
        try:
            self.remove(result)
        except KeyError:
            pass

    def update(self, results):
        """Extend from iterable of results."""
        self.results.extend(r for r in results if r not in self.results)

    def clear(self):
        """Remove all results from this set."""
        self.results[:] = []  # don't create new list.

    def successful(self):
        """Return true if all tasks successful.

        Returns:
            bool: true if all of the tasks finished
                successfully (i.e. didn't raise an exception).
        """
        return all(result.successful() for result in self.results)

    def failed(self):
        """Return true if any of the tasks failed.

        Returns:
            bool: true if one of the tasks failed.
                (i.e., raised an exception)
        """
        return any(result.failed() for result in self.results)

    def maybe_throw(self, callback=None, propagate=True):
        for result in self.results:
            result.maybe_throw(callback=callback, propagate=propagate)
    maybe_reraise = maybe_throw  # XXX compat alias.

    def waiting(self):
        """Return true if any of the tasks are incomplete.

        Returns:
            bool: true if one of the tasks are still
                waiting for execution.
        """
        return any(not result.ready() for result in self.results)

    def ready(self):
        """Did all of the tasks complete? (either by success of failure).

        Returns:
            bool: true if all of the tasks have been executed.
        """
        return all(result.ready() for result in self.results)

    def completed_count(self):
        """Task completion count.

        Note that `complete` means `successful` in this context. In other words, the
        return value of this method is the number of ``successful`` tasks.

        Returns:
            int: the number of complete (i.e. successful) tasks.
        """
        return sum(int(result.successful()) for result in self.results)

    def forget(self):
        """Forget about (and possible remove the result of) all the tasks."""
        for result in self.results:
            result.forget()

    def revoke(self, connection=None, terminate=False, signal=None,
               wait=False, timeout=None):
        """Send revoke signal to all workers for all tasks in the set.

        Arguments:
            terminate (bool): Also terminate the process currently working
                on the task (if any).
            signal (str): Name of signal to send to process if terminate.
                Default is TERM.
            wait (bool): Wait for replies from worker.
                The ``timeout`` argument specifies the number of seconds
                to wait.  Disabled by default.
            timeout (float): Time in seconds to wait for replies when
                the ``wait`` argument is enabled.
        """
        self.app.control.revoke([r.id for r in self.results],
                                connection=connection, timeout=timeout,
                                terminate=terminate, signal=signal, reply=wait)

    def __iter__(self):
        return iter(self.results)

    def __getitem__(self, index):
        """`res[i] -> res.results[i]`."""
        return self.results[index]

    def get(self, timeout=None, propagate=True, interval=0.5,
            callback=None, no_ack=True, on_message=None,
            disable_sync_subtasks=True, on_interval=None):
        """See :meth:`join`.

        This is here for API compatibility with :class:`AsyncResult`,
        in addition it uses :meth:`join_native` if available for the
        current result backend.
        """
        return (self.join_native if self.supports_native_join else self.join)(
            timeout=timeout, propagate=propagate,
            interval=interval, callback=callback, no_ack=no_ack,
            on_message=on_message, disable_sync_subtasks=disable_sync_subtasks,
            on_interval=on_interval,
        )

    def join(self, timeout=None, propagate=True, interval=0.5,
             callback=None, no_ack=True, on_message=None,
             disable_sync_subtasks=True, on_interval=None):
        """Gather the results of all tasks as a list in order.

        Note:
            This can be an expensive operation for result store
            backends that must resort to polling (e.g., database).

            You should consider using :meth:`join_native` if your backend
            supports it.

        Warning:
            Waiting for tasks within a task may lead to deadlocks.
            Please see :ref:`task-synchronous-subtasks`.

        Arguments:
            timeout (float): The number of seconds to wait for results
                before the operation times out.
            propagate (bool): If any of the tasks raises an exception,
                the exception will be re-raised when this flag is set.
            interval (float): Time to wait (in seconds) before retrying to
                retrieve a result from the set.  Note that this does not have
                any effect when using the amqp result store backend,
                as it does not use polling.
            callback (Callable): Optional callback to be called for every
                result received.  Must have signature ``(task_id, value)``
                No results will be returned by this function if a callback
                is specified.  The order of results is also arbitrary when a
                callback is used.  To get access to the result object for
                a particular id you'll have to generate an index first:
                ``index = {r.id: r for r in gres.results.values()}``
                Or you can create new result objects on the fly:
                ``result = app.AsyncResult(task_id)`` (both will
                take advantage of the backend cache anyway).
            no_ack (bool): Automatic message acknowledgment (Note that if this
                is set to :const:`False` then the messages
                *will not be acknowledged*).
            disable_sync_subtasks (bool): Disable tasks to wait for sub tasks
                this is the default configuration. CAUTION do not enable this
                unless you must.

        Raises:
            celery.exceptions.TimeoutError: if ``timeout`` isn't
                :const:`None` and the operation takes longer than ``timeout``
                seconds.
        """
        if disable_sync_subtasks:
            assert_will_not_block()
        time_start = time.monotonic()
        remaining = None

        if on_message is not None:
            raise ImproperlyConfigured(
                'Backend does not support on_message callback')

        results = []
        for result in self.results:
            remaining = None
            if timeout:
                remaining = timeout - (time.monotonic() - time_start)
                if remaining <= 0.0:
                    raise TimeoutError('join operation timed out')
            value = result.get(
                timeout=remaining, propagate=propagate,
                interval=interval, no_ack=no_ack, on_interval=on_interval,
                disable_sync_subtasks=disable_sync_subtasks,
            )
            if callback:
                callback(result.id, value)
            else:
                results.append(value)
        return results

    def then(self, callback, on_error=None, weak=False):
        return self.on_ready.then(callback, on_error)

    def iter_native(self, timeout=None, interval=0.5, no_ack=True,
                    on_message=None, on_interval=None):
        """Backend optimized version of :meth:`iterate`.

        .. versionadded:: 2.2

        Note that this does not support collecting the results
        for different task types using different backends.

        This is currently only supported by the amqp, Redis and cache
        result backends.
        """
        return self.backend.iter_native(
            self,
            timeout=timeout, interval=interval, no_ack=no_ack,
            on_message=on_message, on_interval=on_interval,
        )

    def join_native(self, timeout=None, propagate=True,
                    interval=0.5, callback=None, no_ack=True,
                    on_message=None, on_interval=None,
                    disable_sync_subtasks=True):
        """Backend optimized version of :meth:`join`.

        .. versionadded:: 2.2

        Note that this does not support collecting the results
        for different task types using different backends.

        This is currently only supported by the amqp, Redis and cache
        result backends.
        """
        if disable_sync_subtasks:
            assert_will_not_block()
        order_index = None if callback else {
            result.id: i for i, result in enumerate(self.results)
        }
        acc = None if callback else [None for _ in range(len(self))]
        for task_id, meta in self.iter_native(timeout, interval, no_ack,
                                              on_message, on_interval):
            if isinstance(meta, list):
                value = []
                for children_result in meta:
                    value.append(children_result.get())
            else:
                value = meta['result']
                if propagate and meta['status'] in states.PROPAGATE_STATES:
                    raise value
            if callback:
                callback(task_id, value)
            else:
                acc[order_index[task_id]] = value
        return acc

    def _iter_meta(self, **kwargs):
        return (meta for _, meta in self.backend.get_many(
            {r.id for r in self.results}, max_iterations=1, **kwargs
        ))

    def _failed_join_report(self):
        return (res for res in self.results
                if res.backend.is_cached(res.id) and
                res.state in states.PROPAGATE_STATES)

    def __len__(self):
        return len(self.results)

    def __eq__(self, other):
        if isinstance(other, ResultSet):
            return other.results == self.results
        return NotImplemented

    def __repr__(self):
        return f'<{type(self).__name__}: [{", ".join(r.id for r in self.results)}]>'

    @property
    def supports_native_join(self):
        try:
            return self.results[0].supports_native_join
        except IndexError:
            pass

    @property
    def app(self):
        if self._app is None:
            self._app = (self.results[0].app if self.results else
                         current_app._get_current_object())
        return self._app

    @app.setter
    def app(self, app):
        self._app = app

    @property
    def backend(self):
        return self.app.backend if self.app else self.results[0].backend


@Thenable.register
class GroupResult(ResultSet):
    """Like :class:`ResultSet`, but with an associated id.

    This type is returned by :class:`~celery.group`.

    It enables inspection of the tasks state and return values as
    a single entity.

    Arguments:
        id (str): The id of the group.
        results (Sequence[AsyncResult]): List of result instances.
        parent (ResultBase): Parent result of this group.
    """

    #: The UUID of the group.
    id = None

    #: List/iterator of results in the group
    results = None

    def __init__(self, id=None, results=None, parent=None, **kwargs):
        self.id = id
        self.parent = parent
        super().__init__(results, **kwargs)

    def _on_ready(self):
        self.backend.remove_pending_result(self)
        super()._on_ready()

    def save(self, backend=None):
        """Save group-result for later retrieval using :meth:`restore`.

        Example:
            >>> def save_and_restore(result):
            ...     result.save()
            ...     result = GroupResult.restore(result.id)
        """
        return (backend or self.app.backend).save_group(self.id, self)

    def delete(self, backend=None):
        """Remove this result if it was previously saved."""
        (backend or self.app.backend).delete_group(self.id)

    def __reduce__(self):
        return self.__class__, self.__reduce_args__()

    def __reduce_args__(self):
        return self.id, self.results

    def __bool__(self):
        return bool(self.id or self.results)
    __nonzero__ = __bool__  # Included for Py2 backwards compatibility

    def __eq__(self, other):
        if isinstance(other, GroupResult):
            return (
                other.id == self.id and
                other.results == self.results and
                other.parent == self.parent
            )
        elif isinstance(other, str):
            return other == self.id
        return NotImplemented

    def __repr__(self):
        return f'<{type(self).__name__}: {self.id} [{", ".join(r.id for r in self.results)}]>'

    def __str__(self):
        """`str(self) -> self.id`."""
        return str(self.id)

    def __hash__(self):
        """`hash(self) -> hash(self.id)`."""
        return hash(self.id)

    def as_tuple(self):
        return (
            (self.id, self.parent and self.parent.as_tuple()),
            [r.as_tuple() for r in self.results]
        )

    @property
    def children(self):
        return self.results

    @classmethod
    def restore(cls, id, backend=None, app=None):
        """Restore previously saved group result."""
        app = app or (
            cls.app if not isinstance(cls.app, property) else current_app
        )
        backend = backend or app.backend
        return backend.restore_group(id)


@Thenable.register
class EagerResult(AsyncResult):
    """Result that we know has already been executed."""

    def __init__(self, id, ret_value, state, traceback=None):
        # pylint: disable=super-init-not-called
        # XXX should really not be inheriting from AsyncResult
        self.id = id
        self._result = ret_value
        self._state = state
        self._traceback = traceback
        self.on_ready = promise()
        self.on_ready(self)

    def then(self, callback, on_error=None, weak=False):
        return self.on_ready.then(callback, on_error)

    def _get_task_meta(self):
        return self._cache

    def __reduce__(self):
        return self.__class__, self.__reduce_args__()

    def __reduce_args__(self):
        return (self.id, self._result, self._state, self._traceback)

    def __copy__(self):
        cls, args = self.__reduce__()
        return cls(*args)

    def ready(self):
        return True

    def get(self, timeout=None, propagate=True,
            disable_sync_subtasks=True, **kwargs):
        if disable_sync_subtasks:
            assert_will_not_block()

        if self.successful():
            return self.result
        elif self.state in states.PROPAGATE_STATES:
            if propagate:
                raise self.result if isinstance(
                    self.result, Exception) else Exception(self.result)
            return self.result
    wait = get  # XXX Compat (remove 5.0)

    def forget(self):
        pass

    def revoke(self, *args, **kwargs):
        self._state = states.REVOKED

    def __repr__(self):
        return f'<EagerResult: {self.id}>'

    @property
    def _cache(self):
        return {
            'task_id': self.id,
            'result': self._result,
            'status': self._state,
            'traceback': self._traceback,
        }

    @property
    def result(self):
        """The tasks return value."""
        return self._result

    @property
    def state(self):
        """The tasks state."""
        return self._state
    status = state

    @property
    def traceback(self):
        """The traceback if the task failed."""
        return self._traceback

    @property
    def supports_native_join(self):
        return False


def result_from_tuple(r, app=None):
    """Deserialize result from tuple."""
    # earlier backends may just pickle, so check if
    # result is already prepared.
    app = app_or_default(app)
    Result = app.AsyncResult
    if not isinstance(r, ResultBase):
        res, nodes = r
        id, parent = res if isinstance(res, (list, tuple)) else (res, None)
        if parent:
            parent = result_from_tuple(parent, app)

        if nodes is not None:
            return app.GroupResult(
                id, [result_from_tuple(child, app) for child in nodes],
                parent=parent,
            )

        return Result(id, parent=parent)
    return r
