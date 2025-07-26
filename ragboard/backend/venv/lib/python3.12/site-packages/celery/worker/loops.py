"""The consumers highly-optimized inner loop."""
import errno
import socket

from celery import bootsteps
from celery.exceptions import WorkerLostError
from celery.utils.log import get_logger

from . import state

__all__ = ('asynloop', 'synloop')

# pylint: disable=redefined-outer-name
# We cache globals and attribute lookups, so disable this warning.

logger = get_logger(__name__)


def _quick_drain(connection, timeout=0.1):
    try:
        connection.drain_events(timeout=timeout)
    except Exception as exc:  # pylint: disable=broad-except
        exc_errno = getattr(exc, 'errno', None)
        if exc_errno is not None and exc_errno != errno.EAGAIN:
            raise


def _enable_amqheartbeats(timer, connection, rate=2.0):
    heartbeat_error = [None]

    if not connection:
        return heartbeat_error

    heartbeat = connection.get_heartbeat_interval()  # negotiated
    if not (heartbeat and connection.supports_heartbeats):
        return heartbeat_error

    def tick(rate):
        try:
            connection.heartbeat_check(rate)
        except Exception as e:
            # heartbeat_error is passed by reference can be updated
            # no append here list should be fixed size=1
            heartbeat_error[0] = e

    timer.call_repeatedly(heartbeat / rate, tick, (rate,))
    return heartbeat_error


def asynloop(obj, connection, consumer, blueprint, hub, qos,
             heartbeat, clock, hbrate=2.0):
    """Non-blocking event loop."""
    RUN = bootsteps.RUN
    update_qos = qos.update
    errors = connection.connection_errors

    on_task_received = obj.create_task_handler()

    heartbeat_error = _enable_amqheartbeats(hub.timer, connection, rate=hbrate)

    consumer.on_message = on_task_received
    obj.controller.register_with_event_loop(hub)
    obj.register_with_event_loop(hub)
    consumer.consume()
    obj.on_ready()

    # did_start_ok will verify that pool processes were able to start,
    # but this will only work the first time we start, as
    # maxtasksperchild will mess up metrics.
    if not obj.restart_count and not obj.pool.did_start_ok():
        raise WorkerLostError('Could not start worker processes')

    # consumer.consume() may have prefetched up to our
    # limit - drain an event so we're in a clean state
    # prior to starting our event loop.
    if connection.transport.driver_type == 'amqp':
        hub.call_soon(_quick_drain, connection)

    # FIXME: Use loop.run_forever
    # Tried and works, but no time to test properly before release.
    hub.propagate_errors = errors
    loop = hub.create_loop()

    try:
        while blueprint.state == RUN and obj.connection:
            state.maybe_shutdown()
            if heartbeat_error[0] is not None:
                raise heartbeat_error[0]

            # We only update QoS when there's no more messages to read.
            # This groups together qos calls, and makes sure that remote
            # control commands will be prioritized over task messages.
            if qos.prev != qos.value:
                update_qos()

            try:
                next(loop)
            except StopIteration:
                loop = hub.create_loop()
    finally:
        try:
            hub.reset()
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                'Error cleaning up after event loop: %r', exc)


def synloop(obj, connection, consumer, blueprint, hub, qos,
            heartbeat, clock, hbrate=2.0, **kwargs):
    """Fallback blocking event loop for transports that doesn't support AIO."""
    RUN = bootsteps.RUN
    on_task_received = obj.create_task_handler()
    perform_pending_operations = obj.perform_pending_operations
    heartbeat_error = [None]
    if getattr(obj.pool, 'is_green', False):
        heartbeat_error = _enable_amqheartbeats(obj.timer, connection, rate=hbrate)
    consumer.on_message = on_task_received
    consumer.consume()

    obj.on_ready()

    while blueprint.state == RUN and obj.connection:
        state.maybe_shutdown()
        if heartbeat_error[0] is not None:
            raise heartbeat_error[0]
        if qos.prev != qos.value:
            qos.update()
        try:
            perform_pending_operations()
            connection.drain_events(timeout=2.0)
        except socket.timeout:
            pass
        except OSError:
            if blueprint.state == RUN:
                raise
