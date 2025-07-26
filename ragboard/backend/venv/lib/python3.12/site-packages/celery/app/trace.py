"""Trace task execution.

This module defines how the task execution is traced:
errors are recorded, handlers are applied and so on.
"""
import logging
import os
import sys
import time
from collections import namedtuple
from typing import Any, Callable, Dict, FrozenSet, Optional, Sequence, Tuple, Type, Union
from warnings import warn

from billiard.einfo import ExceptionInfo, ExceptionWithTraceback
from kombu.exceptions import EncodeError
from kombu.serialization import loads as loads_message
from kombu.serialization import prepare_accept_content
from kombu.utils.encoding import safe_repr, safe_str

import celery
import celery.loaders.app
from celery import current_app, group, signals, states
from celery._state import _task_stack
from celery.app.task import Context
from celery.app.task import Task as BaseTask
from celery.exceptions import BackendGetMetaError, Ignore, InvalidTaskError, Reject, Retry
from celery.result import AsyncResult
from celery.utils.log import get_logger
from celery.utils.nodenames import gethostname
from celery.utils.objects import mro_lookup
from celery.utils.saferepr import saferepr
from celery.utils.serialization import get_pickleable_etype, get_pickleable_exception, get_pickled_exception

# ## ---
# This is the heart of the worker, the inner loop so to speak.
# It used to be split up into nice little classes and methods,
# but in the end it only resulted in bad performance and horrible tracebacks,
# so instead we now use one closure per task class.

# pylint: disable=redefined-outer-name
# We cache globals and attribute lookups, so disable this warning.
# pylint: disable=broad-except
# We know what we're doing...


__all__ = (
    'TraceInfo', 'build_tracer', 'trace_task',
    'setup_worker_optimizations', 'reset_worker_optimizations',
)

from celery.worker.state import successful_requests

logger = get_logger(__name__)

#: Format string used to log task receipt.
LOG_RECEIVED = """\
Task %(name)s[%(id)s] received\
"""

#: Format string used to log task success.
LOG_SUCCESS = """\
Task %(name)s[%(id)s] succeeded in %(runtime)ss: %(return_value)s\
"""

#: Format string used to log task failure.
LOG_FAILURE = """\
Task %(name)s[%(id)s] %(description)s: %(exc)s\
"""

#: Format string used to log task internal error.
LOG_INTERNAL_ERROR = """\
Task %(name)s[%(id)s] %(description)s: %(exc)s\
"""

#: Format string used to log task ignored.
LOG_IGNORED = """\
Task %(name)s[%(id)s] %(description)s\
"""

#: Format string used to log task rejected.
LOG_REJECTED = """\
Task %(name)s[%(id)s] %(exc)s\
"""

#: Format string used to log task retry.
LOG_RETRY = """\
Task %(name)s[%(id)s] retry: %(exc)s\
"""

log_policy_t = namedtuple(
    'log_policy_t',
    ('format', 'description', 'severity', 'traceback', 'mail'),
)

log_policy_reject = log_policy_t(LOG_REJECTED, 'rejected', logging.WARN, 1, 1)
log_policy_ignore = log_policy_t(LOG_IGNORED, 'ignored', logging.INFO, 0, 0)
log_policy_internal = log_policy_t(
    LOG_INTERNAL_ERROR, 'INTERNAL ERROR', logging.CRITICAL, 1, 1,
)
log_policy_expected = log_policy_t(
    LOG_FAILURE, 'raised expected', logging.INFO, 0, 0,
)
log_policy_unexpected = log_policy_t(
    LOG_FAILURE, 'raised unexpected', logging.ERROR, 1, 1,
)

send_prerun = signals.task_prerun.send
send_postrun = signals.task_postrun.send
send_success = signals.task_success.send
STARTED = states.STARTED
SUCCESS = states.SUCCESS
IGNORED = states.IGNORED
REJECTED = states.REJECTED
RETRY = states.RETRY
FAILURE = states.FAILURE
EXCEPTION_STATES = states.EXCEPTION_STATES
IGNORE_STATES = frozenset({IGNORED, RETRY, REJECTED})

#: set by :func:`setup_worker_optimizations`
_localized = []
_patched = {}

trace_ok_t = namedtuple('trace_ok_t', ('retval', 'info', 'runtime', 'retstr'))


def info(fmt, context):
    """Log 'fmt % context' with severity 'INFO'.

    'context' is also passed in extra with key 'data' for custom handlers.
    """
    logger.info(fmt, context, extra={'data': context})


def task_has_custom(task, attr):
    """Return true if the task overrides ``attr``."""
    return mro_lookup(task.__class__, attr, stop={BaseTask, object},
                      monkey_patched=['celery.app.task'])


def get_log_policy(task, einfo, exc):
    if isinstance(exc, Reject):
        return log_policy_reject
    elif isinstance(exc, Ignore):
        return log_policy_ignore
    elif einfo.internal:
        return log_policy_internal
    else:
        if task.throws and isinstance(exc, task.throws):
            return log_policy_expected
        return log_policy_unexpected


def get_task_name(request, default):
    """Use 'shadow' in request for the task name if applicable."""
    # request.shadow could be None or an empty string.
    # If so, we should use default.
    return getattr(request, 'shadow', None) or default


class TraceInfo:
    """Information about task execution."""

    __slots__ = ('state', 'retval')

    def __init__(self, state, retval=None):
        self.state = state
        self.retval = retval

    def handle_error_state(self, task, req,
                           eager=False, call_errbacks=True):
        if task.ignore_result:
            store_errors = task.store_errors_even_if_ignored
        elif eager and task.store_eager_result:
            store_errors = True
        else:
            store_errors = not eager

        return {
            RETRY: self.handle_retry,
            FAILURE: self.handle_failure,
        }[self.state](task, req,
                      store_errors=store_errors,
                      call_errbacks=call_errbacks)

    def handle_reject(self, task, req, **kwargs):
        self._log_error(task, req, ExceptionInfo())

    def handle_ignore(self, task, req, **kwargs):
        self._log_error(task, req, ExceptionInfo())

    def handle_retry(self, task, req, store_errors=True, **kwargs):
        """Handle retry exception."""
        # the exception raised is the Retry semi-predicate,
        # and it's exc' attribute is the original exception raised (if any).
        type_, _, tb = sys.exc_info()
        try:
            reason = self.retval
            einfo = ExceptionInfo((type_, reason, tb))
            if store_errors:
                task.backend.mark_as_retry(
                    req.id, reason.exc, einfo.traceback, request=req,
                )
            task.on_retry(reason.exc, req.id, req.args, req.kwargs, einfo)
            signals.task_retry.send(sender=task, request=req,
                                    reason=reason, einfo=einfo)
            info(LOG_RETRY, {
                'id': req.id,
                'name': get_task_name(req, task.name),
                'exc': str(reason),
            })
            return einfo
        finally:
            del tb

    def handle_failure(self, task, req, store_errors=True, call_errbacks=True):
        """Handle exception."""
        orig_exc = self.retval

        exc = get_pickleable_exception(orig_exc)
        if exc.__traceback__ is None:
            # `get_pickleable_exception` may have created a new exception without
            # a traceback.
            _, _, exc.__traceback__ = sys.exc_info()

        exc_type = get_pickleable_etype(type(orig_exc))

        # make sure we only send pickleable exceptions back to parent.
        einfo = ExceptionInfo(exc_info=(exc_type, exc, exc.__traceback__))

        task.backend.mark_as_failure(
            req.id, exc, einfo.traceback,
            request=req, store_result=store_errors,
            call_errbacks=call_errbacks,
        )

        task.on_failure(exc, req.id, req.args, req.kwargs, einfo)
        signals.task_failure.send(sender=task, task_id=req.id,
                                  exception=exc, args=req.args,
                                  kwargs=req.kwargs,
                                  traceback=exc.__traceback__,
                                  einfo=einfo)
        self._log_error(task, req, einfo)
        return einfo

    def _log_error(self, task, req, einfo):
        eobj = einfo.exception = get_pickled_exception(einfo.exception)
        if isinstance(eobj, ExceptionWithTraceback):
            eobj = einfo.exception = eobj.exc
        exception, traceback, exc_info, sargs, skwargs = (
            safe_repr(eobj),
            safe_str(einfo.traceback),
            einfo.exc_info,
            req.get('argsrepr') or safe_repr(req.args),
            req.get('kwargsrepr') or safe_repr(req.kwargs),
        )
        policy = get_log_policy(task, einfo, eobj)

        context = {
            'hostname': req.hostname,
            'id': req.id,
            'name': get_task_name(req, task.name),
            'exc': exception,
            'traceback': traceback,
            'args': sargs,
            'kwargs': skwargs,
            'description': policy.description,
            'internal': einfo.internal,
        }

        logger.log(policy.severity, policy.format.strip(), context,
                   exc_info=exc_info if policy.traceback else None,
                   extra={'data': context})


def traceback_clear(exc=None):
    # Cleared Tb, but einfo still has a reference to Traceback.
    # exc cleans up the Traceback at the last moment that can be revealed.
    tb = None
    if exc is not None:
        if hasattr(exc, '__traceback__'):
            tb = exc.__traceback__
        else:
            _, _, tb = sys.exc_info()
    else:
        _, _, tb = sys.exc_info()

    while tb is not None:
        try:
            tb.tb_frame.clear()
            tb.tb_frame.f_locals
        except RuntimeError:
            # Ignore the exception raised if the frame is still executing.
            pass
        tb = tb.tb_next


def build_tracer(
        name: str,
        task: Union[celery.Task, celery.local.PromiseProxy],
        loader: Optional[celery.loaders.app.AppLoader] = None,
        hostname: Optional[str] = None,
        store_errors: bool = True,
        Info: Type[TraceInfo] = TraceInfo,
        eager: bool = False,
        propagate: bool = False,
        app: Optional[celery.Celery] = None,
        monotonic: Callable[[], int] = time.monotonic,
        trace_ok_t: Type[trace_ok_t] = trace_ok_t,
        IGNORE_STATES: FrozenSet[str] = IGNORE_STATES) -> \
        Callable[[str, Tuple[Any, ...], Dict[str, Any], Any], trace_ok_t]:
    """Return a function that traces task execution.

    Catches all exceptions and updates result backend with the
    state and result.

    If the call was successful, it saves the result to the task result
    backend, and sets the task status to `"SUCCESS"`.

    If the call raises :exc:`~@Retry`, it extracts
    the original exception, uses that as the result and sets the task state
    to `"RETRY"`.

    If the call results in an exception, it saves the exception as the task
    result, and sets the task state to `"FAILURE"`.

    Return a function that takes the following arguments:

        :param uuid: The id of the task.
        :param args: List of positional args to pass on to the function.
        :param kwargs: Keyword arguments mapping to pass on to the function.
        :keyword request: Request dict.

    """

    # pylint: disable=too-many-statements

    # If the task doesn't define a custom __call__ method
    # we optimize it away by simply calling the run method directly,
    # saving the extra method call and a line less in the stack trace.
    fun = task if task_has_custom(task, '__call__') else task.run

    loader = loader or app.loader
    ignore_result = task.ignore_result
    track_started = task.track_started
    track_started = not eager and (task.track_started and not ignore_result)

    # #6476
    if eager and not ignore_result and task.store_eager_result:
        publish_result = True
    else:
        publish_result = not eager and not ignore_result

    deduplicate_successful_tasks = ((app.conf.task_acks_late or task.acks_late)
                                    and app.conf.worker_deduplicate_successful_tasks
                                    and app.backend.persistent)

    hostname = hostname or gethostname()
    inherit_parent_priority = app.conf.task_inherit_parent_priority

    loader_task_init = loader.on_task_init
    loader_cleanup = loader.on_process_cleanup

    task_before_start = None
    task_on_success = None
    task_after_return = None
    if task_has_custom(task, 'before_start'):
        task_before_start = task.before_start
    if task_has_custom(task, 'on_success'):
        task_on_success = task.on_success
    if task_has_custom(task, 'after_return'):
        task_after_return = task.after_return

    pid = os.getpid()

    request_stack = task.request_stack
    push_request = request_stack.push
    pop_request = request_stack.pop
    push_task = _task_stack.push
    pop_task = _task_stack.pop
    _does_info = logger.isEnabledFor(logging.INFO)
    resultrepr_maxsize = task.resultrepr_maxsize

    prerun_receivers = signals.task_prerun.receivers
    postrun_receivers = signals.task_postrun.receivers
    success_receivers = signals.task_success.receivers

    from celery import canvas
    signature = canvas.maybe_signature  # maybe_ does not clone if already

    def on_error(
            request: celery.app.task.Context,
            exc: Union[Exception, Type[Exception]],
            state: str = FAILURE,
            call_errbacks: bool = True) -> Tuple[Info, Any, Any, Any]:
        """Handle any errors raised by a `Task`'s execution."""
        if propagate:
            raise
        I = Info(state, exc)
        R = I.handle_error_state(
            task, request, eager=eager, call_errbacks=call_errbacks,
        )
        return I, R, I.state, I.retval

    def trace_task(
            uuid: str,
            args: Sequence[Any],
            kwargs: Dict[str, Any],
            request: Optional[Dict[str, Any]] = None) -> trace_ok_t:
        """Execute and trace a `Task`."""

        # R      - is the possibly prepared return value.
        # I      - is the Info object.
        # T      - runtime
        # Rstr   - textual representation of return value
        # retval - is the always unmodified return value.
        # state  - is the resulting task state.

        # This function is very long because we've unrolled all the calls
        # for performance reasons, and because the function is so long
        # we want the main variables (I, and R) to stand out visually from the
        # the rest of the variables, so breaking PEP8 is worth it ;)
        R = I = T = Rstr = retval = state = None
        task_request = None
        time_start = monotonic()
        try:
            try:
                kwargs.items
            except AttributeError:
                raise InvalidTaskError(
                    'Task keyword arguments is not a mapping')

            task_request = Context(request or {}, args=args,
                                   called_directly=False, kwargs=kwargs)

            redelivered = (task_request.delivery_info
                           and task_request.delivery_info.get('redelivered', False))
            if deduplicate_successful_tasks and redelivered:
                if task_request.id in successful_requests:
                    return trace_ok_t(R, I, T, Rstr)
                r = AsyncResult(task_request.id, app=app)

                try:
                    state = r.state
                except BackendGetMetaError:
                    pass
                else:
                    if state == SUCCESS:
                        info(LOG_IGNORED, {
                            'id': task_request.id,
                            'name': get_task_name(task_request, name),
                            'description': 'Task already completed successfully.'
                        })
                        return trace_ok_t(R, I, T, Rstr)

            push_task(task)
            root_id = task_request.root_id or uuid
            task_priority = task_request.delivery_info.get('priority') if \
                inherit_parent_priority else None
            push_request(task_request)
            try:
                # -*- PRE -*-
                if prerun_receivers:
                    send_prerun(sender=task, task_id=uuid, task=task,
                                args=args, kwargs=kwargs)
                loader_task_init(uuid, task)
                if track_started:
                    task.backend.store_result(
                        uuid, {'pid': pid, 'hostname': hostname}, STARTED,
                        request=task_request,
                    )

                # -*- TRACE -*-
                try:
                    if task_before_start:
                        task_before_start(uuid, args, kwargs)

                    R = retval = fun(*args, **kwargs)
                    state = SUCCESS
                except Reject as exc:
                    I, R = Info(REJECTED, exc), ExceptionInfo(internal=True)
                    state, retval = I.state, I.retval
                    I.handle_reject(task, task_request)
                    traceback_clear(exc)
                except Ignore as exc:
                    I, R = Info(IGNORED, exc), ExceptionInfo(internal=True)
                    state, retval = I.state, I.retval
                    I.handle_ignore(task, task_request)
                    traceback_clear(exc)
                except Retry as exc:
                    I, R, state, retval = on_error(
                        task_request, exc, RETRY, call_errbacks=False)
                    traceback_clear(exc)
                except Exception as exc:
                    I, R, state, retval = on_error(task_request, exc)
                    traceback_clear(exc)
                except BaseException:
                    raise
                else:
                    try:
                        # callback tasks must be applied before the result is
                        # stored, so that result.children is populated.

                        # groups are called inline and will store trail
                        # separately, so need to call them separately
                        # so that the trail's not added multiple times :(
                        # (Issue #1936)
                        callbacks = task.request.callbacks
                        if callbacks:
                            if len(task.request.callbacks) > 1:
                                sigs, groups = [], []
                                for sig in callbacks:
                                    sig = signature(sig, app=app)
                                    if isinstance(sig, group):
                                        groups.append(sig)
                                    else:
                                        sigs.append(sig)
                                for group_ in groups:
                                    group_.apply_async(
                                        (retval,),
                                        parent_id=uuid, root_id=root_id,
                                        priority=task_priority
                                    )
                                if sigs:
                                    group(sigs, app=app).apply_async(
                                        (retval,),
                                        parent_id=uuid, root_id=root_id,
                                        priority=task_priority
                                    )
                            else:
                                signature(callbacks[0], app=app).apply_async(
                                    (retval,), parent_id=uuid, root_id=root_id,
                                    priority=task_priority
                                )

                        # execute first task in chain
                        chain = task_request.chain
                        if chain:
                            _chsig = signature(chain.pop(), app=app)
                            _chsig.apply_async(
                                (retval,), chain=chain,
                                parent_id=uuid, root_id=root_id,
                                priority=task_priority
                            )
                        task.backend.mark_as_done(
                            uuid, retval, task_request, publish_result,
                        )
                    except EncodeError as exc:
                        I, R, state, retval = on_error(task_request, exc)
                    else:
                        Rstr = saferepr(R, resultrepr_maxsize)
                        T = monotonic() - time_start
                        if task_on_success:
                            task_on_success(retval, uuid, args, kwargs)
                        if success_receivers:
                            send_success(sender=task, result=retval)
                        if _does_info:
                            info(LOG_SUCCESS, {
                                'id': uuid,
                                'name': get_task_name(task_request, name),
                                'return_value': Rstr,
                                'runtime': T,
                                'args': task_request.get('argsrepr') or safe_repr(args),
                                'kwargs': task_request.get('kwargsrepr') or safe_repr(kwargs),
                            })

                # -* POST *-
                if state not in IGNORE_STATES:
                    if task_after_return:
                        task_after_return(
                            state, retval, uuid, args, kwargs, None,
                        )
            finally:
                try:
                    if postrun_receivers:
                        send_postrun(sender=task, task_id=uuid, task=task,
                                     args=args, kwargs=kwargs,
                                     retval=retval, state=state)
                finally:
                    pop_task()
                    pop_request()
                    if not eager:
                        try:
                            task.backend.process_cleanup()
                            loader_cleanup()
                        except (KeyboardInterrupt, SystemExit, MemoryError):
                            raise
                        except Exception as exc:
                            logger.error('Process cleanup failed: %r', exc,
                                         exc_info=True)
        except MemoryError:
            raise
        except Exception as exc:
            _signal_internal_error(task, uuid, args, kwargs, request, exc)
            if eager:
                raise
            R = report_internal_error(task, exc)
            if task_request is not None:
                I, _, _, _ = on_error(task_request, exc)
        return trace_ok_t(R, I, T, Rstr)

    return trace_task


def trace_task(task, uuid, args, kwargs, request=None, **opts):
    """Trace task execution."""
    request = {} if not request else request
    try:
        if task.__trace__ is None:
            task.__trace__ = build_tracer(task.name, task, **opts)
        return task.__trace__(uuid, args, kwargs, request)
    except Exception as exc:
        _signal_internal_error(task, uuid, args, kwargs, request, exc)
        return trace_ok_t(report_internal_error(task, exc), TraceInfo(FAILURE, exc), 0.0, None)


def _signal_internal_error(task, uuid, args, kwargs, request, exc):
    """Send a special `internal_error` signal to the app for outside body errors."""
    try:
        _, _, tb = sys.exc_info()
        einfo = ExceptionInfo()
        einfo.exception = get_pickleable_exception(einfo.exception)
        einfo.type = get_pickleable_etype(einfo.type)
        signals.task_internal_error.send(
            sender=task,
            task_id=uuid,
            args=args,
            kwargs=kwargs,
            request=request,
            exception=exc,
            traceback=tb,
            einfo=einfo,
        )
    finally:
        del tb


def trace_task_ret(name, uuid, request, body, content_type,
                   content_encoding, loads=loads_message, app=None,
                   **extra_request):
    app = app or current_app._get_current_object()
    embed = None
    if content_type:
        accept = prepare_accept_content(app.conf.accept_content)
        args, kwargs, embed = loads(
            body, content_type, content_encoding, accept=accept,
        )
    else:
        args, kwargs, embed = body
    hostname = gethostname()
    request.update({
        'args': args, 'kwargs': kwargs,
        'hostname': hostname, 'is_eager': False,
    }, **embed or {})
    R, I, T, Rstr = trace_task(app.tasks[name],
                               uuid, args, kwargs, request, app=app)
    return (1, R, T) if I else (0, Rstr, T)


def fast_trace_task(task, uuid, request, body, content_type,
                    content_encoding, loads=loads_message, _loc=None,
                    hostname=None, **_):
    _loc = _localized if not _loc else _loc
    embed = None
    tasks, accept, hostname = _loc
    if content_type:
        args, kwargs, embed = loads(
            body, content_type, content_encoding, accept=accept,
        )
    else:
        args, kwargs, embed = body
    request.update({
        'args': args, 'kwargs': kwargs,
        'hostname': hostname, 'is_eager': False,
    }, **embed or {})
    R, I, T, Rstr = tasks[task].__trace__(
        uuid, args, kwargs, request,
    )
    return (1, R, T) if I else (0, Rstr, T)


def report_internal_error(task, exc):
    _type, _value, _tb = sys.exc_info()
    try:
        _value = task.backend.prepare_exception(exc, 'pickle')
        exc_info = ExceptionInfo((_type, _value, _tb), internal=True)
        warn(RuntimeWarning(
            'Exception raised outside body: {!r}:\n{}'.format(
                exc, exc_info.traceback)))
        return exc_info
    finally:
        del _tb


def setup_worker_optimizations(app, hostname=None):
    """Setup worker related optimizations."""
    hostname = hostname or gethostname()

    # make sure custom Task.__call__ methods that calls super
    # won't mess up the request/task stack.
    _install_stack_protection()

    # all new threads start without a current app, so if an app is not
    # passed on to the thread it will fall back to the "default app",
    # which then could be the wrong app.  So for the worker
    # we set this to always return our app.  This is a hack,
    # and means that only a single app can be used for workers
    # running in the same process.
    app.set_current()
    app.set_default()

    # evaluate all task classes by finalizing the app.
    app.finalize()

    # set fast shortcut to task registry
    _localized[:] = [
        app._tasks,
        prepare_accept_content(app.conf.accept_content),
        hostname,
    ]

    app.use_fast_trace_task = True


def reset_worker_optimizations(app=current_app):
    """Reset previously configured optimizations."""
    try:
        delattr(BaseTask, '_stackprotected')
    except AttributeError:
        pass
    try:
        BaseTask.__call__ = _patched.pop('BaseTask.__call__')
    except KeyError:
        pass
    app.use_fast_trace_task = False


def _install_stack_protection():
    # Patches BaseTask.__call__ in the worker to handle the edge case
    # where people override it and also call super.
    #
    # - The worker optimizes away BaseTask.__call__ and instead
    #   calls task.run directly.
    # - so with the addition of current_task and the request stack
    #   BaseTask.__call__ now pushes to those stacks so that
    #   they work when tasks are called directly.
    #
    # The worker only optimizes away __call__ in the case
    # where it hasn't been overridden, so the request/task stack
    # will blow if a custom task class defines __call__ and also
    # calls super().
    if not getattr(BaseTask, '_stackprotected', False):
        _patched['BaseTask.__call__'] = orig = BaseTask.__call__

        def __protected_call__(self, *args, **kwargs):
            stack = self.request_stack
            req = stack.top
            if req and not req._protected and \
                    len(stack) == 1 and not req.called_directly:
                req._protected = 1
                return self.run(*args, **kwargs)
            return orig(self, *args, **kwargs)
        BaseTask.__call__ = __protected_call__
        BaseTask._stackprotected = True
