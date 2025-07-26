"""Task implementation: request context and the task base class."""
import sys

from billiard.einfo import ExceptionInfo, ExceptionWithTraceback
from kombu import serialization
from kombu.exceptions import OperationalError
from kombu.utils.uuid import uuid

from celery import current_app, states
from celery._state import _task_stack
from celery.canvas import _chain, group, signature
from celery.exceptions import Ignore, ImproperlyConfigured, MaxRetriesExceededError, Reject, Retry
from celery.local import class_property
from celery.result import EagerResult, denied_join_result
from celery.utils import abstract
from celery.utils.functional import mattrgetter, maybe_list
from celery.utils.imports import instantiate
from celery.utils.nodenames import gethostname
from celery.utils.serialization import raise_with_context

from .annotations import resolve_all as resolve_all_annotations
from .registry import _unpickle_task_v2
from .utils import appstr

__all__ = ('Context', 'Task')

#: extracts attributes related to publishing a message from an object.
extract_exec_options = mattrgetter(
    'queue', 'routing_key', 'exchange', 'priority', 'expires',
    'serializer', 'delivery_mode', 'compression', 'time_limit',
    'soft_time_limit', 'immediate', 'mandatory',  # imm+man is deprecated
)

# We take __repr__ very seriously around here ;)
R_BOUND_TASK = '<class {0.__name__} of {app}{flags}>'
R_UNBOUND_TASK = '<unbound {0.__name__}{flags}>'
R_INSTANCE = '<@task: {0.name} of {app}{flags}>'

#: Here for backwards compatibility as tasks no longer use a custom meta-class.
TaskType = type


def _strflags(flags, default=''):
    if flags:
        return ' ({})'.format(', '.join(flags))
    return default


def _reprtask(task, fmt=None, flags=None):
    flags = list(flags) if flags is not None else []
    flags.append('v2 compatible') if task.__v2_compat__ else None
    if not fmt:
        fmt = R_BOUND_TASK if task._app else R_UNBOUND_TASK
    return fmt.format(
        task, flags=_strflags(flags),
        app=appstr(task._app) if task._app else None,
    )


class Context:
    """Task request variables (Task.request)."""

    _children = None   # see property
    _protected = 0
    args = None
    callbacks = None
    called_directly = True
    chain = None
    chord = None
    correlation_id = None
    delivery_info = None
    errbacks = None
    eta = None
    expires = None
    group = None
    group_index = None
    headers = None
    hostname = None
    id = None
    ignore_result = False
    is_eager = False
    kwargs = None
    logfile = None
    loglevel = None
    origin = None
    parent_id = None
    properties = None
    retries = 0
    reply_to = None
    replaced_task_nesting = 0
    root_id = None
    shadow = None
    taskset = None   # compat alias to group
    timelimit = None
    utc = None
    stamped_headers = None
    stamps = None

    def __init__(self, *args, **kwargs):
        self.update(*args, **kwargs)
        if self.headers is None:
            self.headers = self._get_custom_headers(*args, **kwargs)

    def _get_custom_headers(self, *args, **kwargs):
        headers = {}
        headers.update(*args, **kwargs)
        celery_keys = {*Context.__dict__.keys(), 'lang', 'task', 'argsrepr', 'kwargsrepr'}
        for key in celery_keys:
            headers.pop(key, None)
        if not headers:
            return None
        return headers

    def update(self, *args, **kwargs):
        return self.__dict__.update(*args, **kwargs)

    def clear(self):
        return self.__dict__.clear()

    def get(self, key, default=None):
        return getattr(self, key, default)

    def __repr__(self):
        return f'<Context: {vars(self)!r}>'

    def as_execution_options(self):
        limit_hard, limit_soft = self.timelimit or (None, None)
        execution_options = {
            'task_id': self.id,
            'root_id': self.root_id,
            'parent_id': self.parent_id,
            'group_id': self.group,
            'group_index': self.group_index,
            'shadow': self.shadow,
            'chord': self.chord,
            'chain': self.chain,
            'link': self.callbacks,
            'link_error': self.errbacks,
            'expires': self.expires,
            'soft_time_limit': limit_soft,
            'time_limit': limit_hard,
            'headers': self.headers,
            'retries': self.retries,
            'reply_to': self.reply_to,
            'replaced_task_nesting': self.replaced_task_nesting,
            'origin': self.origin,
        }
        if hasattr(self, 'stamps') and hasattr(self, 'stamped_headers'):
            if self.stamps is not None and self.stamped_headers is not None:
                execution_options['stamped_headers'] = self.stamped_headers
                for k, v in self.stamps.items():
                    execution_options[k] = v
        return execution_options

    @property
    def children(self):
        # children must be an empty list for every thread
        if self._children is None:
            self._children = []
        return self._children


@abstract.CallableTask.register
class Task:
    """Task base class.

    Note:
        When called tasks apply the :meth:`run` method.  This method must
        be defined by all tasks (that is unless the :meth:`__call__` method
        is overridden).
    """

    __trace__ = None
    __v2_compat__ = False  # set by old base in celery.task.base

    MaxRetriesExceededError = MaxRetriesExceededError
    OperationalError = OperationalError

    #: Execution strategy used, or the qualified name of one.
    Strategy = 'celery.worker.strategy:default'

    #: Request class used, or the qualified name of one.
    Request = 'celery.worker.request:Request'

    #: The application instance associated with this task class.
    _app = None

    #: Name of the task.
    name = None

    #: Enable argument checking.
    #: You can set this to false if you don't want the signature to be
    #: checked when calling the task.
    #: Defaults to :attr:`app.strict_typing <@Celery.strict_typing>`.
    typing = None

    #: Maximum number of retries before giving up.  If set to :const:`None`,
    #: it will **never** stop retrying.
    max_retries = 3

    #: Default time in seconds before a retry of the task should be
    #: executed.  3 minutes by default.
    default_retry_delay = 3 * 60

    #: Rate limit for this task type.  Examples: :const:`None` (no rate
    #: limit), `'100/s'` (hundred tasks a second), `'100/m'` (hundred tasks
    #: a minute),`'100/h'` (hundred tasks an hour)
    rate_limit = None

    #: If enabled the worker won't store task state and return values
    #: for this task.  Defaults to the :setting:`task_ignore_result`
    #: setting.
    ignore_result = None

    #: If enabled the request will keep track of subtasks started by
    #: this task, and this information will be sent with the result
    #: (``result.children``).
    trail = True

    #: If enabled the worker will send monitoring events related to
    #: this task (but only if the worker is configured to send
    #: task related events).
    #: Note that this has no effect on the task-failure event case
    #: where a task is not registered (as it will have no task class
    #: to check this flag).
    send_events = True

    #: When enabled errors will be stored even if the task is otherwise
    #: configured to ignore results.
    store_errors_even_if_ignored = None

    #: The name of a serializer that are registered with
    #: :mod:`kombu.serialization.registry`.  Default is `'json'`.
    serializer = None

    #: Hard time limit.
    #: Defaults to the :setting:`task_time_limit` setting.
    time_limit = None

    #: Soft time limit.
    #: Defaults to the :setting:`task_soft_time_limit` setting.
    soft_time_limit = None

    #: The result store backend used for this task.
    backend = None

    #: If enabled the task will report its status as 'started' when the task
    #: is executed by a worker.  Disabled by default as the normal behavior
    #: is to not report that level of granularity.  Tasks are either pending,
    #: finished, or waiting to be retried.
    #:
    #: Having a 'started' status can be useful for when there are long
    #: running tasks and there's a need to report what task is currently
    #: running.
    #:
    #: The application default can be overridden using the
    #: :setting:`task_track_started` setting.
    track_started = None

    #: When enabled messages for this task will be acknowledged **after**
    #: the task has been executed, and not *right before* (the
    #: default behavior).
    #:
    #: Please note that this means the task may be executed twice if the
    #: worker crashes mid execution.
    #:
    #: The application default can be overridden with the
    #: :setting:`task_acks_late` setting.
    acks_late = None

    #: When enabled messages for this task will be acknowledged even if it
    #: fails or times out.
    #:
    #: Configuring this setting only applies to tasks that are
    #: acknowledged **after** they have been executed and only if
    #: :setting:`task_acks_late` is enabled.
    #:
    #: The application default can be overridden with the
    #: :setting:`task_acks_on_failure_or_timeout` setting.
    acks_on_failure_or_timeout = None

    #: Even if :attr:`acks_late` is enabled, the worker will
    #: acknowledge tasks when the worker process executing them abruptly
    #: exits or is signaled (e.g., :sig:`KILL`/:sig:`INT`, etc).
    #:
    #: Setting this to true allows the message to be re-queued instead,
    #: so that the task will execute again by the same worker, or another
    #: worker.
    #:
    #: Warning: Enabling this can cause message loops; make sure you know
    #: what you're doing.
    reject_on_worker_lost = None

    #: Tuple of expected exceptions.
    #:
    #: These are errors that are expected in normal operation
    #: and that shouldn't be regarded as a real error by the worker.
    #: Currently this means that the state will be updated to an error
    #: state, but the worker won't log the event as an error.
    throws = ()

    #: Default task expiry time.
    expires = None

    #: Default task priority.
    priority = None

    #: Max length of result representation used in logs and events.
    resultrepr_maxsize = 1024

    #: Task request stack, the current request will be the topmost.
    request_stack = None

    #: Some may expect a request to exist even if the task hasn't been
    #: called.  This should probably be deprecated.
    _default_request = None

    #: Deprecated attribute ``abstract`` here for compatibility.
    abstract = True

    _exec_options = None

    __bound__ = False

    from_config = (
        ('serializer', 'task_serializer'),
        ('rate_limit', 'task_default_rate_limit'),
        ('priority', 'task_default_priority'),
        ('track_started', 'task_track_started'),
        ('acks_late', 'task_acks_late'),
        ('acks_on_failure_or_timeout', 'task_acks_on_failure_or_timeout'),
        ('reject_on_worker_lost', 'task_reject_on_worker_lost'),
        ('ignore_result', 'task_ignore_result'),
        ('store_eager_result', 'task_store_eager_result'),
        ('store_errors_even_if_ignored', 'task_store_errors_even_if_ignored'),
    )

    _backend = None  # set by backend property.

    # - Tasks are lazily bound, so that configuration is not set
    # - until the task is actually used

    @classmethod
    def bind(cls, app):
        was_bound, cls.__bound__ = cls.__bound__, True
        cls._app = app
        conf = app.conf
        cls._exec_options = None  # clear option cache

        if cls.typing is None:
            cls.typing = app.strict_typing

        for attr_name, config_name in cls.from_config:
            if getattr(cls, attr_name, None) is None:
                setattr(cls, attr_name, conf[config_name])

        # decorate with annotations from config.
        if not was_bound:
            cls.annotate()

            from celery.utils.threads import LocalStack
            cls.request_stack = LocalStack()

        # PeriodicTask uses this to add itself to the PeriodicTask schedule.
        cls.on_bound(app)

        return app

    @classmethod
    def on_bound(cls, app):
        """Called when the task is bound to an app.

        Note:
            This class method can be defined to do additional actions when
            the task class is bound to an app.
        """

    @classmethod
    def _get_app(cls):
        if cls._app is None:
            cls._app = current_app
        if not cls.__bound__:
            # The app property's __set__  method is not called
            # if Task.app is set (on the class), so must bind on use.
            cls.bind(cls._app)
        return cls._app
    app = class_property(_get_app, bind)

    @classmethod
    def annotate(cls):
        for d in resolve_all_annotations(cls.app.annotations, cls):
            for key, value in d.items():
                if key.startswith('@'):
                    cls.add_around(key[1:], value)
                else:
                    setattr(cls, key, value)

    @classmethod
    def add_around(cls, attr, around):
        orig = getattr(cls, attr)
        if getattr(orig, '__wrapped__', None):
            orig = orig.__wrapped__
        meth = around(orig)
        meth.__wrapped__ = orig
        setattr(cls, attr, meth)

    def __call__(self, *args, **kwargs):
        _task_stack.push(self)
        self.push_request(args=args, kwargs=kwargs)
        try:
            return self.run(*args, **kwargs)
        finally:
            self.pop_request()
            _task_stack.pop()

    def __reduce__(self):
        # - tasks are pickled into the name of the task only, and the receiver
        # - simply grabs it from the local registry.
        # - in later versions the module of the task is also included,
        # - and the receiving side tries to import that module so that
        # - it will work even if the task hasn't been registered.
        mod = type(self).__module__
        mod = mod if mod and mod in sys.modules else None
        return (_unpickle_task_v2, (self.name, mod), None)

    def run(self, *args, **kwargs):
        """The body of the task executed by workers."""
        raise NotImplementedError('Tasks must define the run method.')

    def start_strategy(self, app, consumer, **kwargs):
        return instantiate(self.Strategy, self, app, consumer, **kwargs)

    def delay(self, *args, **kwargs):
        """Star argument version of :meth:`apply_async`.

        Does not support the extra options enabled by :meth:`apply_async`.

        Arguments:
            *args (Any): Positional arguments passed on to the task.
            **kwargs (Any): Keyword arguments passed on to the task.
        Returns:
            celery.result.AsyncResult: Future promise.
        """
        return self.apply_async(args, kwargs)

    def apply_async(self, args=None, kwargs=None, task_id=None, producer=None,
                    link=None, link_error=None, shadow=None, **options):
        """Apply tasks asynchronously by sending a message.

        Arguments:
            args (Tuple): The positional arguments to pass on to the task.

            kwargs (Dict): The keyword arguments to pass on to the task.

            countdown (float): Number of seconds into the future that the
                task should execute.  Defaults to immediate execution.

            eta (~datetime.datetime): Absolute time and date of when the task
                should be executed.  May not be specified if `countdown`
                is also supplied.

            expires (float, ~datetime.datetime): Datetime or
                seconds in the future for the task should expire.
                The task won't be executed after the expiration time.

            shadow (str): Override task name used in logs/monitoring.
                Default is retrieved from :meth:`shadow_name`.

            connection (kombu.Connection): Re-use existing broker connection
                instead of acquiring one from the connection pool.

            retry (bool): If enabled sending of the task message will be
                retried in the event of connection loss or failure.
                Default is taken from the :setting:`task_publish_retry`
                setting.  Note that you need to handle the
                producer/connection manually for this to work.

            retry_policy (Mapping): Override the retry policy used.
                See the :setting:`task_publish_retry_policy` setting.

            time_limit (int): If set, overrides the default time limit.

            soft_time_limit (int): If set, overrides the default soft
                time limit.

            queue (str, kombu.Queue): The queue to route the task to.
                This must be a key present in :setting:`task_queues`, or
                :setting:`task_create_missing_queues` must be
                enabled.  See :ref:`guide-routing` for more
                information.

            exchange (str, kombu.Exchange): Named custom exchange to send the
                task to.  Usually not used in combination with the ``queue``
                argument.

            routing_key (str): Custom routing key used to route the task to a
                worker server.  If in combination with a ``queue`` argument
                only used to specify custom routing keys to topic exchanges.

            priority (int): The task priority, a number between 0 and 9.
                Defaults to the :attr:`priority` attribute.

            serializer (str): Serialization method to use.
                Can be `pickle`, `json`, `yaml`, `msgpack` or any custom
                serialization method that's been registered
                with :mod:`kombu.serialization.registry`.
                Defaults to the :attr:`serializer` attribute.

            compression (str): Optional compression method
                to use.  Can be one of ``zlib``, ``bzip2``,
                or any custom compression methods registered with
                :func:`kombu.compression.register`.
                Defaults to the :setting:`task_compression` setting.

            link (Signature): A single, or a list of tasks signatures
                to apply if the task returns successfully.

            link_error (Signature): A single, or a list of task signatures
                to apply if an error occurs while executing the task.

            producer (kombu.Producer): custom producer to use when publishing
                the task.

            add_to_parent (bool): If set to True (default) and the task
                is applied while executing another task, then the result
                will be appended to the parent tasks ``request.children``
                attribute.  Trailing can also be disabled by default using the
                :attr:`trail` attribute

            ignore_result (bool): If set to `False` (default) the result
                of a task will be stored in the backend. If set to `True`
                the result will not be stored. This can also be set
                using the :attr:`ignore_result` in the `app.task` decorator.

            publisher (kombu.Producer): Deprecated alias to ``producer``.

            headers (Dict): Message headers to be included in the message.

        Returns:
            celery.result.AsyncResult: Promise of future evaluation.

        Raises:
            TypeError: If not enough arguments are passed, or too many
                arguments are passed.  Note that signature checks may
                be disabled by specifying ``@task(typing=False)``.
            kombu.exceptions.OperationalError: If a connection to the
               transport cannot be made, or if the connection is lost.

        Note:
            Also supports all keyword arguments supported by
            :meth:`kombu.Producer.publish`.
        """
        if self.typing:
            try:
                check_arguments = self.__header__
            except AttributeError:  # pragma: no cover
                pass
            else:
                check_arguments(*(args or ()), **(kwargs or {}))

        if self.__v2_compat__:
            shadow = shadow or self.shadow_name(self(), args, kwargs, options)
        else:
            shadow = shadow or self.shadow_name(args, kwargs, options)

        preopts = self._get_exec_options()
        options = dict(preopts, **options) if options else preopts

        options.setdefault('ignore_result', self.ignore_result)
        if self.priority:
            options.setdefault('priority', self.priority)

        app = self._get_app()
        if app.conf.task_always_eager:
            with app.producer_or_acquire(producer) as eager_producer:
                serializer = options.get('serializer')
                if serializer is None:
                    if eager_producer.serializer:
                        serializer = eager_producer.serializer
                    else:
                        serializer = app.conf.task_serializer
                body = args, kwargs
                content_type, content_encoding, data = serialization.dumps(
                    body, serializer,
                )
                args, kwargs = serialization.loads(
                    data, content_type, content_encoding,
                    accept=[content_type]
                )
            with denied_join_result():
                return self.apply(args, kwargs, task_id=task_id or uuid(),
                                  link=link, link_error=link_error, **options)
        else:
            return app.send_task(
                self.name, args, kwargs, task_id=task_id, producer=producer,
                link=link, link_error=link_error, result_cls=self.AsyncResult,
                shadow=shadow, task_type=self,
                **options
            )

    def shadow_name(self, args, kwargs, options):
        """Override for custom task name in worker logs/monitoring.

        Example:
            .. code-block:: python

                from celery.utils.imports import qualname

                def shadow_name(task, args, kwargs, options):
                    return qualname(args[0])

                @app.task(shadow_name=shadow_name, serializer='pickle')
                def apply_function_async(fun, *args, **kwargs):
                    return fun(*args, **kwargs)

        Arguments:
            args (Tuple): Task positional arguments.
            kwargs (Dict): Task keyword arguments.
            options (Dict): Task execution options.
        """

    def signature_from_request(self, request=None, args=None, kwargs=None,
                               queue=None, **extra_options):
        request = self.request if request is None else request
        args = request.args if args is None else args
        kwargs = request.kwargs if kwargs is None else kwargs
        options = {**request.as_execution_options(), **extra_options}
        delivery_info = request.delivery_info or {}
        priority = delivery_info.get('priority')
        if priority is not None:
            options['priority'] = priority
        if queue:
            options['queue'] = queue
        else:
            exchange = delivery_info.get('exchange')
            routing_key = delivery_info.get('routing_key')
            if exchange == '' and routing_key:
                # sent to anon-exchange
                options['queue'] = routing_key
            else:
                options.update(delivery_info)
        return self.signature(
            args, kwargs, options, type=self, **extra_options
        )
    subtask_from_request = signature_from_request  # XXX compat

    def retry(self, args=None, kwargs=None, exc=None, throw=True,
              eta=None, countdown=None, max_retries=None, **options):
        """Retry the task, adding it to the back of the queue.

        Example:
            >>> from imaginary_twitter_lib import Twitter
            >>> from proj.celery import app

            >>> @app.task(bind=True)
            ... def tweet(self, auth, message):
            ...     twitter = Twitter(oauth=auth)
            ...     try:
            ...         twitter.post_status_update(message)
            ...     except twitter.FailWhale as exc:
            ...         # Retry in 5 minutes.
            ...         raise self.retry(countdown=60 * 5, exc=exc)

        Note:
            Although the task will never return above as `retry` raises an
            exception to notify the worker, we use `raise` in front of the
            retry to convey that the rest of the block won't be executed.

        Arguments:
            args (Tuple): Positional arguments to retry with.
            kwargs (Dict): Keyword arguments to retry with.
            exc (Exception): Custom exception to report when the max retry
                limit has been exceeded (default:
                :exc:`~@MaxRetriesExceededError`).

                If this argument is set and retry is called while
                an exception was raised (``sys.exc_info()`` is set)
                it will attempt to re-raise the current exception.

                If no exception was raised it will raise the ``exc``
                argument provided.
            countdown (float): Time in seconds to delay the retry for.
            eta (~datetime.datetime): Explicit time and date to run the
                retry at.
            max_retries (int): If set, overrides the default retry limit for
                this execution.  Changes to this parameter don't propagate to
                subsequent task retry attempts.  A value of :const:`None`,
                means "use the default", so if you want infinite retries you'd
                have to set the :attr:`max_retries` attribute of the task to
                :const:`None` first.
            time_limit (int): If set, overrides the default time limit.
            soft_time_limit (int): If set, overrides the default soft
                time limit.
            throw (bool): If this is :const:`False`, don't raise the
                :exc:`~@Retry` exception, that tells the worker to mark
                the task as being retried.  Note that this means the task
                will be marked as failed if the task raises an exception,
                or successful if it returns after the retry call.
            **options (Any): Extra options to pass on to :meth:`apply_async`.

        Raises:

            celery.exceptions.Retry:
                To tell the worker that the task has been re-sent for retry.
                This always happens, unless the `throw` keyword argument
                has been explicitly set to :const:`False`, and is considered
                normal operation.
        """
        request = self.request
        retries = request.retries + 1
        if max_retries is not None:
            self.override_max_retries = max_retries
        max_retries = self.max_retries if max_retries is None else max_retries

        # Not in worker or emulated by (apply/always_eager),
        # so just raise the original exception.
        if request.called_directly:
            # raises orig stack if PyErr_Occurred,
            # and augments with exc' if that argument is defined.
            raise_with_context(exc or Retry('Task can be retried', None))

        if not eta and countdown is None:
            countdown = self.default_retry_delay

        is_eager = request.is_eager
        S = self.signature_from_request(
            request, args, kwargs,
            countdown=countdown, eta=eta, retries=retries,
            **options
        )

        if max_retries is not None and retries > max_retries:
            if exc:
                # On Py3: will augment any current exception with
                # the exc' argument provided (raise exc from orig)
                raise_with_context(exc)
            raise self.MaxRetriesExceededError(
                "Can't retry {}[{}] args:{} kwargs:{}".format(
                    self.name, request.id, S.args, S.kwargs
                ), task_args=S.args, task_kwargs=S.kwargs
            )

        ret = Retry(exc=exc, when=eta or countdown, is_eager=is_eager, sig=S)

        if is_eager:
            # if task was executed eagerly using apply(),
            # then the retry must also be executed eagerly in apply method
            if throw:
                raise ret
            return ret

        try:
            S.apply_async()
        except Exception as exc:
            raise Reject(exc, requeue=False)
        if throw:
            raise ret
        return ret

    def apply(self, args=None, kwargs=None,
              link=None, link_error=None,
              task_id=None, retries=None, throw=None,
              logfile=None, loglevel=None, headers=None, **options):
        """Execute this task locally, by blocking until the task returns.

        Arguments:
            args (Tuple): positional arguments passed on to the task.
            kwargs (Dict): keyword arguments passed on to the task.
            throw (bool): Re-raise task exceptions.
                Defaults to the :setting:`task_eager_propagates` setting.

        Returns:
            celery.result.EagerResult: pre-evaluated result.
        """
        # trace imports Task, so need to import inline.
        from celery.app.trace import build_tracer

        app = self._get_app()
        args = args or ()
        kwargs = kwargs or {}
        task_id = task_id or uuid()
        retries = retries or 0
        if throw is None:
            throw = app.conf.task_eager_propagates

        # Make sure we get the task instance, not class.
        task = app._tasks[self.name]

        request = {
            'id': task_id,
            'retries': retries,
            'is_eager': True,
            'logfile': logfile,
            'loglevel': loglevel or 0,
            'hostname': gethostname(),
            'callbacks': maybe_list(link),
            'errbacks': maybe_list(link_error),
            'headers': headers,
            'ignore_result': options.get('ignore_result', False),
            'delivery_info': {
                'is_eager': True,
                'exchange': options.get('exchange'),
                'routing_key': options.get('routing_key'),
                'priority': options.get('priority'),
            }
        }
        if 'stamped_headers' in options:
            request['stamped_headers'] = maybe_list(options['stamped_headers'])
            request['stamps'] = {
                header: maybe_list(options.get(header, [])) for header in request['stamped_headers']
            }

        tb = None
        tracer = build_tracer(
            task.name, task, eager=True,
            propagate=throw, app=self._get_app(),
        )
        ret = tracer(task_id, args, kwargs, request)
        retval = ret.retval
        if isinstance(retval, ExceptionInfo):
            retval, tb = retval.exception, retval.traceback
            if isinstance(retval, ExceptionWithTraceback):
                retval = retval.exc
        if isinstance(retval, Retry) and retval.sig is not None:
            return retval.sig.apply(retries=retries + 1)
        state = states.SUCCESS if ret.info is None else ret.info.state
        return EagerResult(task_id, retval, state, traceback=tb)

    def AsyncResult(self, task_id, **kwargs):
        """Get AsyncResult instance for the specified task.

        Arguments:
            task_id (str): Task id to get result for.
        """
        return self._get_app().AsyncResult(task_id, backend=self.backend,
                                           task_name=self.name, **kwargs)

    def signature(self, args=None, *starargs, **starkwargs):
        """Create signature.

        Returns:
            :class:`~celery.signature`:  object for
                this task, wrapping arguments and execution options
                for a single task invocation.
        """
        starkwargs.setdefault('app', self.app)
        return signature(self, args, *starargs, **starkwargs)
    subtask = signature

    def s(self, *args, **kwargs):
        """Create signature.

        Shortcut for ``.s(*a, **k) -> .signature(a, k)``.
        """
        return self.signature(args, kwargs)

    def si(self, *args, **kwargs):
        """Create immutable signature.

        Shortcut for ``.si(*a, **k) -> .signature(a, k, immutable=True)``.
        """
        return self.signature(args, kwargs, immutable=True)

    def chunks(self, it, n):
        """Create a :class:`~celery.canvas.chunks` task for this task."""
        from celery import chunks
        return chunks(self.s(), it, n, app=self.app)

    def map(self, it):
        """Create a :class:`~celery.canvas.xmap` task from ``it``."""
        from celery import xmap
        return xmap(self.s(), it, app=self.app)

    def starmap(self, it):
        """Create a :class:`~celery.canvas.xstarmap` task from ``it``."""
        from celery import xstarmap
        return xstarmap(self.s(), it, app=self.app)

    def send_event(self, type_, retry=True, retry_policy=None, **fields):
        """Send monitoring event message.

        This can be used to add custom event types in :pypi:`Flower`
        and other monitors.

        Arguments:
            type_ (str):  Type of event, e.g. ``"task-failed"``.

        Keyword Arguments:
            retry (bool):  Retry sending the message
                if the connection is lost.  Default is taken from the
                :setting:`task_publish_retry` setting.
            retry_policy (Mapping): Retry settings.  Default is taken
                from the :setting:`task_publish_retry_policy` setting.
            **fields (Any): Map containing information about the event.
                Must be JSON serializable.
        """
        req = self.request
        if retry_policy is None:
            retry_policy = self.app.conf.task_publish_retry_policy
        with self.app.events.default_dispatcher(hostname=req.hostname) as d:
            return d.send(
                type_,
                uuid=req.id, retry=retry, retry_policy=retry_policy, **fields)

    def replace(self, sig):
        """Replace this task, with a new task inheriting the task id.

        Execution of the host task ends immediately and no subsequent statements
        will be run.

        .. versionadded:: 4.0

        Arguments:
            sig (Signature): signature to replace with.
            visitor (StampingVisitor): Visitor API object.

        Raises:
            ~@Ignore: This is always raised when called in asynchronous context.
            It is best to always use ``return self.replace(...)`` to convey
            to the reader that the task won't continue after being replaced.
        """
        chord = self.request.chord
        if 'chord' in sig.options:
            raise ImproperlyConfigured(
                "A signature replacing a task must not be part of a chord"
            )
        if isinstance(sig, _chain) and not getattr(sig, "tasks", True):
            raise ImproperlyConfigured("Cannot replace with an empty chain")

        # Ensure callbacks or errbacks from the replaced signature are retained
        if isinstance(sig, group):
            # Groups get uplifted to a chord so that we can link onto the body
            sig |= self.app.tasks['celery.accumulate'].s(index=0)
        for callback in maybe_list(self.request.callbacks) or []:
            sig.link(callback)
        for errback in maybe_list(self.request.errbacks) or []:
            sig.link_error(errback)
        # If the replacement signature is a chain, we need to push callbacks
        # down to the final task so they run at the right time even if we
        # proceed to link further tasks from the original request below
        if isinstance(sig, _chain) and "link" in sig.options:
            final_task_links = sig.tasks[-1].options.setdefault("link", [])
            final_task_links.extend(maybe_list(sig.options["link"]))
        # We need to freeze the replacement signature with the current task's
        # ID to ensure that we don't disassociate it from the existing task IDs
        # which would break previously constructed results objects.
        sig.freeze(self.request.id)
        # Ensure the important options from the original signature are retained
        replaced_task_nesting = self.request.get('replaced_task_nesting', 0) + 1
        sig.set(
            chord=chord,
            group_id=self.request.group,
            group_index=self.request.group_index,
            root_id=self.request.root_id,
            replaced_task_nesting=replaced_task_nesting
        )
        # If the task being replaced is part of a chain, we need to re-create
        # it with the replacement signature - these subsequent tasks will
        # retain their original task IDs as well
        for t in reversed(self.request.chain or []):
            sig |= signature(t, app=self.app)
        return self.on_replace(sig)

    def add_to_chord(self, sig, lazy=False):
        """Add signature to the chord the current task is a member of.

        .. versionadded:: 4.0

        Currently only supported by the Redis result backend.

        Arguments:
            sig (Signature): Signature to extend chord with.
            lazy (bool): If enabled the new task won't actually be called,
                and ``sig.delay()`` must be called manually.
        """
        if not self.request.chord:
            raise ValueError('Current task is not member of any chord')
        sig.set(
            group_id=self.request.group,
            group_index=self.request.group_index,
            chord=self.request.chord,
            root_id=self.request.root_id,
        )
        result = sig.freeze()
        self.backend.add_to_chord(self.request.group, result)
        return sig.delay() if not lazy else sig

    def update_state(self, task_id=None, state=None, meta=None, **kwargs):
        """Update task state.

        Arguments:
            task_id (str): Id of the task to update.
                Defaults to the id of the current task.
            state (str): New state.
            meta (Dict): State meta-data.
        """
        if task_id is None:
            task_id = self.request.id
        self.backend.store_result(
            task_id, meta, state, request=self.request, **kwargs)

    def before_start(self, task_id, args, kwargs):
        """Handler called before the task starts.

        .. versionadded:: 5.2

        Arguments:
            task_id (str): Unique id of the task to execute.
            args (Tuple): Original arguments for the task to execute.
            kwargs (Dict): Original keyword arguments for the task to execute.

        Returns:
            None: The return value of this handler is ignored.
        """

    def on_success(self, retval, task_id, args, kwargs):
        """Success handler.

        Run by the worker if the task executes successfully.

        Arguments:
            retval (Any): The return value of the task.
            task_id (str): Unique id of the executed task.
            args (Tuple): Original arguments for the executed task.
            kwargs (Dict): Original keyword arguments for the executed task.

        Returns:
            None: The return value of this handler is ignored.
        """

    def on_retry(self, exc, task_id, args, kwargs, einfo):
        """Retry handler.

        This is run by the worker when the task is to be retried.

        Arguments:
            exc (Exception): The exception sent to :meth:`retry`.
            task_id (str): Unique id of the retried task.
            args (Tuple): Original arguments for the retried task.
            kwargs (Dict): Original keyword arguments for the retried task.
            einfo (~billiard.einfo.ExceptionInfo): Exception information.

        Returns:
            None: The return value of this handler is ignored.
        """

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Error handler.

        This is run by the worker when the task fails.

        Arguments:
            exc (Exception): The exception raised by the task.
            task_id (str): Unique id of the failed task.
            args (Tuple): Original arguments for the task that failed.
            kwargs (Dict): Original keyword arguments for the task that failed.
            einfo (~billiard.einfo.ExceptionInfo): Exception information.

        Returns:
            None: The return value of this handler is ignored.
        """

    def after_return(self, status, retval, task_id, args, kwargs, einfo):
        """Handler called after the task returns.

        Arguments:
            status (str): Current task state.
            retval (Any): Task return value/exception.
            task_id (str): Unique id of the task.
            args (Tuple): Original arguments for the task.
            kwargs (Dict): Original keyword arguments for the task.
            einfo (~billiard.einfo.ExceptionInfo): Exception information.

        Returns:
            None: The return value of this handler is ignored.
        """

    def on_replace(self, sig):
        """Handler called when the task is replaced.

        Must return super().on_replace(sig) when overriding to ensure the task replacement
        is properly handled.

        .. versionadded:: 5.3

        Arguments:
            sig (Signature): signature to replace with.
        """
        # Finally, either apply or delay the new signature!
        if self.request.is_eager:
            return sig.apply().get()
        else:
            sig.delay()
            raise Ignore('Replaced by new task')

    def add_trail(self, result):
        if self.trail:
            self.request.children.append(result)
        return result

    def push_request(self, *args, **kwargs):
        self.request_stack.push(Context(*args, **kwargs))

    def pop_request(self):
        self.request_stack.pop()

    def __repr__(self):
        """``repr(task)``."""
        return _reprtask(self, R_INSTANCE)

    def _get_request(self):
        """Get current request object."""
        req = self.request_stack.top
        if req is None:
            # task was not called, but some may still expect a request
            # to be there, perhaps that should be deprecated.
            if self._default_request is None:
                self._default_request = Context()
            return self._default_request
        return req
    request = property(_get_request)

    def _get_exec_options(self):
        if self._exec_options is None:
            self._exec_options = extract_exec_options(self)
        return self._exec_options

    @property
    def backend(self):  # noqa: F811
        backend = self._backend
        if backend is None:
            return self.app.backend
        return backend

    @backend.setter
    def backend(self, value):
        self._backend = value

    @property
    def __name__(self):
        return self.__class__.__name__


BaseTask = Task  # XXX compat alias
