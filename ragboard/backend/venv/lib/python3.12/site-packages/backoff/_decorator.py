# coding:utf-8
import asyncio
import logging
import operator
from typing import Any, Callable, Iterable, Optional, Type, Union

from backoff._common import (
    _prepare_logger,
    _config_handlers,
    _log_backoff,
    _log_giveup
)
from backoff._jitter import full_jitter
from backoff import _async, _sync
from backoff._typing import (
    _CallableT,
    _Handler,
    _Jitterer,
    _MaybeCallable,
    _MaybeLogger,
    _MaybeSequence,
    _Predicate,
    _WaitGenerator,
)


def on_predicate(wait_gen: _WaitGenerator,
                 predicate: _Predicate[Any] = operator.not_,
                 *,
                 max_tries: Optional[_MaybeCallable[int]] = None,
                 max_time: Optional[_MaybeCallable[float]] = None,
                 jitter: Union[_Jitterer, None] = full_jitter,
                 on_success: Union[_Handler, Iterable[_Handler], None] = None,
                 on_backoff: Union[_Handler, Iterable[_Handler], None] = None,
                 on_giveup: Union[_Handler, Iterable[_Handler], None] = None,
                 logger: _MaybeLogger = 'backoff',
                 backoff_log_level: int = logging.INFO,
                 giveup_log_level: int = logging.ERROR,
                 **wait_gen_kwargs: Any) -> Callable[[_CallableT], _CallableT]:
    """Returns decorator for backoff and retry triggered by predicate.

    Args:
        wait_gen: A generator yielding successive wait times in
            seconds.
        predicate: A function which when called on the return value of
            the target function will trigger backoff when considered
            truthily. If not specified, the default behavior is to
            backoff on falsey return values.
        max_tries: The maximum number of attempts to make before giving
            up. In the case of failure, the result of the last attempt
            will be returned. The default value of None means there
            is no limit to the number of tries. If a callable is passed,
            it will be evaluated at runtime and its return value used.
        max_time: The maximum total amount of time to try for before
            giving up. If this time expires, the result of the last
            attempt will be returned. If a callable is passed, it will
            be evaluated at runtime and its return value used.
        jitter: A function of the value yielded by wait_gen returning
            the actual time to wait. This distributes wait times
            stochastically in order to avoid timing collisions across
            concurrent clients. Wait times are jittered by default
            using the full_jitter function. Jittering may be disabled
            altogether by passing jitter=None.
        on_success: Callable (or iterable of callables) with a unary
            signature to be called in the event of success. The
            parameter is a dict containing details about the invocation.
        on_backoff: Callable (or iterable of callables) with a unary
            signature to be called in the event of a backoff. The
            parameter is a dict containing details about the invocation.
        on_giveup: Callable (or iterable of callables) with a unary
            signature to be called in the event that max_tries
            is exceeded.  The parameter is a dict containing details
            about the invocation.
        logger: Name of logger or Logger object to log to. Defaults to
            'backoff'.
        backoff_log_level: log level for the backoff event. Defaults to "INFO"
        giveup_log_level: log level for the give up event. Defaults to "ERROR"
        **wait_gen_kwargs: Any additional keyword args specified will be
            passed to wait_gen when it is initialized.  Any callable
            args will first be evaluated and their return values passed.
            This is useful for runtime configuration.
    """
    def decorate(target):
        nonlocal logger, on_success, on_backoff, on_giveup

        logger = _prepare_logger(logger)
        on_success = _config_handlers(on_success)
        on_backoff = _config_handlers(
            on_backoff,
            default_handler=_log_backoff,
            logger=logger,
            log_level=backoff_log_level
        )
        on_giveup = _config_handlers(
            on_giveup,
            default_handler=_log_giveup,
            logger=logger,
            log_level=giveup_log_level
        )

        if asyncio.iscoroutinefunction(target):
            retry = _async.retry_predicate
        else:
            retry = _sync.retry_predicate

        return retry(
            target,
            wait_gen,
            predicate,
            max_tries=max_tries,
            max_time=max_time,
            jitter=jitter,
            on_success=on_success,
            on_backoff=on_backoff,
            on_giveup=on_giveup,
            wait_gen_kwargs=wait_gen_kwargs
        )

    # Return a function which decorates a target with a retry loop.
    return decorate


def on_exception(wait_gen: _WaitGenerator,
                 exception: _MaybeSequence[Type[Exception]],
                 *,
                 max_tries: Optional[_MaybeCallable[int]] = None,
                 max_time: Optional[_MaybeCallable[float]] = None,
                 jitter: Union[_Jitterer, None] = full_jitter,
                 giveup: _Predicate[Exception] = lambda e: False,
                 on_success: Union[_Handler, Iterable[_Handler], None] = None,
                 on_backoff: Union[_Handler, Iterable[_Handler], None] = None,
                 on_giveup: Union[_Handler, Iterable[_Handler], None] = None,
                 raise_on_giveup: bool = True,
                 logger: _MaybeLogger = 'backoff',
                 backoff_log_level: int = logging.INFO,
                 giveup_log_level: int = logging.ERROR,
                 **wait_gen_kwargs: Any) -> Callable[[_CallableT], _CallableT]:
    """Returns decorator for backoff and retry triggered by exception.

    Args:
        wait_gen: A generator yielding successive wait times in
            seconds.
        exception: An exception type (or tuple of types) which triggers
            backoff.
        max_tries: The maximum number of attempts to make before giving
            up. Once exhausted, the exception will be allowed to escape.
            The default value of None means there is no limit to the
            number of tries. If a callable is passed, it will be
            evaluated at runtime and its return value used.
        max_time: The maximum total amount of time to try for before
            giving up. Once expired, the exception will be allowed to
            escape. If a callable is passed, it will be
            evaluated at runtime and its return value used.
        jitter: A function of the value yielded by wait_gen returning
            the actual time to wait. This distributes wait times
            stochastically in order to avoid timing collisions across
            concurrent clients. Wait times are jittered by default
            using the full_jitter function. Jittering may be disabled
            altogether by passing jitter=None.
        giveup: Function accepting an exception instance and
            returning whether or not to give up. Optional. The default
            is to always continue.
        on_success: Callable (or iterable of callables) with a unary
            signature to be called in the event of success. The
            parameter is a dict containing details about the invocation.
        on_backoff: Callable (or iterable of callables) with a unary
            signature to be called in the event of a backoff. The
            parameter is a dict containing details about the invocation.
        on_giveup: Callable (or iterable of callables) with a unary
            signature to be called in the event that max_tries
            is exceeded.  The parameter is a dict containing details
            about the invocation.
        raise_on_giveup: Boolean indicating whether the registered exceptions
            should be raised on giveup. Defaults to `True`
        logger: Name or Logger object to log to. Defaults to 'backoff'.
        backoff_log_level: log level for the backoff event. Defaults to "INFO"
        giveup_log_level: log level for the give up event. Defaults to "ERROR"
        **wait_gen_kwargs: Any additional keyword args specified will be
            passed to wait_gen when it is initialized.  Any callable
            args will first be evaluated and their return values passed.
            This is useful for runtime configuration.
    """
    def decorate(target):
        nonlocal logger, on_success, on_backoff, on_giveup

        logger = _prepare_logger(logger)
        on_success = _config_handlers(on_success)
        on_backoff = _config_handlers(
            on_backoff,
            default_handler=_log_backoff,
            logger=logger,
            log_level=backoff_log_level,
        )
        on_giveup = _config_handlers(
            on_giveup,
            default_handler=_log_giveup,
            logger=logger,
            log_level=giveup_log_level,
        )

        if asyncio.iscoroutinefunction(target):
            retry = _async.retry_exception
        else:
            retry = _sync.retry_exception

        return retry(
            target,
            wait_gen,
            exception,
            max_tries=max_tries,
            max_time=max_time,
            jitter=jitter,
            giveup=giveup,
            on_success=on_success,
            on_backoff=on_backoff,
            on_giveup=on_giveup,
            raise_on_giveup=raise_on_giveup,
            wait_gen_kwargs=wait_gen_kwargs
        )

    # Return a function which decorates a target with a retry loop.
    return decorate
