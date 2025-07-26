"""Task execution strategy (optimization)."""
import logging

from kombu.asynchronous.timer import to_timestamp

from celery import signals
from celery.app import trace as _app_trace
from celery.exceptions import InvalidTaskError
from celery.utils.imports import symbol_by_name
from celery.utils.log import get_logger
from celery.utils.saferepr import saferepr
from celery.utils.time import timezone

from .request import create_request_cls
from .state import task_reserved

__all__ = ('default',)

logger = get_logger(__name__)

# pylint: disable=redefined-outer-name
# We cache globals and attribute lookups, so disable this warning.


def hybrid_to_proto2(message, body):
    """Create a fresh protocol 2 message from a hybrid protocol 1/2 message."""
    try:
        args, kwargs = body.get('args', ()), body.get('kwargs', {})
        kwargs.items  # pylint: disable=pointless-statement
    except KeyError:
        raise InvalidTaskError('Message does not have args/kwargs')
    except AttributeError:
        raise InvalidTaskError(
            'Task keyword arguments must be a mapping',
        )

    headers = {
        'lang': body.get('lang'),
        'task': body.get('task'),
        'id': body.get('id'),
        'root_id': body.get('root_id'),
        'parent_id': body.get('parent_id'),
        'group': body.get('group'),
        'meth': body.get('meth'),
        'shadow': body.get('shadow'),
        'eta': body.get('eta'),
        'expires': body.get('expires'),
        'retries': body.get('retries', 0),
        'timelimit': body.get('timelimit', (None, None)),
        'argsrepr': body.get('argsrepr'),
        'kwargsrepr': body.get('kwargsrepr'),
        'origin': body.get('origin'),
    }
    headers.update(message.headers or {})

    embed = {
        'callbacks': body.get('callbacks'),
        'errbacks': body.get('errbacks'),
        'chord': body.get('chord'),
        'chain': None,
    }

    return (args, kwargs, embed), headers, True, body.get('utc', True)


def proto1_to_proto2(message, body):
    """Convert Task message protocol 1 arguments to protocol 2.

    Returns:
        Tuple: of ``(body, headers, already_decoded_status, utc)``
    """
    try:
        args, kwargs = body.get('args', ()), body.get('kwargs', {})
        kwargs.items  # pylint: disable=pointless-statement
    except KeyError:
        raise InvalidTaskError('Message does not have args/kwargs')
    except AttributeError:
        raise InvalidTaskError(
            'Task keyword arguments must be a mapping',
        )
    body.update(
        argsrepr=saferepr(args),
        kwargsrepr=saferepr(kwargs),
        headers=message.headers,
    )
    try:
        body['group'] = body['taskset']
    except KeyError:
        pass
    embed = {
        'callbacks': body.get('callbacks'),
        'errbacks': body.get('errbacks'),
        'chord': body.get('chord'),
        'chain': None,
    }
    return (args, kwargs, embed), body, True, body.get('utc', True)


def default(task, app, consumer,
            info=logger.info, error=logger.error, task_reserved=task_reserved,
            to_system_tz=timezone.to_system, bytes=bytes,
            proto1_to_proto2=proto1_to_proto2):
    """Default task execution strategy.

    Note:
        Strategies are here as an optimization, so sadly
        it's not very easy to override.
    """
    hostname = consumer.hostname
    connection_errors = consumer.connection_errors
    _does_info = logger.isEnabledFor(logging.INFO)

    # task event related
    # (optimized to avoid calling request.send_event)
    eventer = consumer.event_dispatcher
    events = eventer and eventer.enabled
    send_event = eventer and eventer.send
    task_sends_events = events and task.send_events

    call_at = consumer.timer.call_at
    apply_eta_task = consumer.apply_eta_task
    rate_limits_enabled = not consumer.disable_rate_limits
    get_bucket = consumer.task_buckets.__getitem__
    handle = consumer.on_task_request
    limit_task = consumer._limit_task
    limit_post_eta = consumer._limit_post_eta
    Request = symbol_by_name(task.Request)
    Req = create_request_cls(Request, task, consumer.pool, hostname, eventer, app=app)

    revoked_tasks = consumer.controller.state.revoked

    def task_message_handler(message, body, ack, reject, callbacks,
                             to_timestamp=to_timestamp):
        if body is None and 'args' not in message.payload:
            body, headers, decoded, utc = (
                message.body, message.headers, False, app.uses_utc_timezone(),
            )
        else:
            if 'args' in message.payload:
                body, headers, decoded, utc = hybrid_to_proto2(message,
                                                               message.payload)
            else:
                body, headers, decoded, utc = proto1_to_proto2(message, body)

        req = Req(
            message,
            on_ack=ack, on_reject=reject, app=app, hostname=hostname,
            eventer=eventer, task=task, connection_errors=connection_errors,
            body=body, headers=headers, decoded=decoded, utc=utc,
        )
        if _does_info:
            # Similar to `app.trace.info()`, we pass the formatting args as the
            # `extra` kwarg for custom log handlers
            context = {
                'id': req.id,
                'name': req.name,
                'args': req.argsrepr,
                'kwargs': req.kwargsrepr,
                'eta': req.eta,
            }
            info(_app_trace.LOG_RECEIVED, context, extra={'data': context})
        if (req.expires or req.id in revoked_tasks) and req.revoked():
            return

        signals.task_received.send(sender=consumer, request=req)

        if task_sends_events:
            send_event(
                'task-received',
                uuid=req.id, name=req.name,
                args=req.argsrepr, kwargs=req.kwargsrepr,
                root_id=req.root_id, parent_id=req.parent_id,
                retries=req.request_dict.get('retries', 0),
                eta=req.eta and req.eta.isoformat(),
                expires=req.expires and req.expires.isoformat(),
            )

        bucket = None
        eta = None
        if req.eta:
            try:
                if req.utc:
                    eta = to_timestamp(to_system_tz(req.eta))
                else:
                    eta = to_timestamp(req.eta, app.timezone)
            except (OverflowError, ValueError) as exc:
                error("Couldn't convert ETA %r to timestamp: %r. Task: %r",
                      req.eta, exc, req.info(safe=True), exc_info=True)
                req.reject(requeue=False)
        if rate_limits_enabled:
            bucket = get_bucket(task.name)

        if eta and bucket:
            consumer.qos.increment_eventually()
            return call_at(eta, limit_post_eta, (req, bucket, 1),
                           priority=6)
        if eta:
            consumer.qos.increment_eventually()
            call_at(eta, apply_eta_task, (req,), priority=6)
            return task_message_handler
        if bucket:
            return limit_task(req, bucket, 1)

        task_reserved(req)
        if callbacks:
            [callback(req) for callback in callbacks]
        handle(req)
    return task_message_handler
