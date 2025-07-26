"""Creating events, and event exchange definition."""
import time
from copy import copy

from kombu import Exchange

__all__ = (
    'Event', 'event_exchange', 'get_exchange', 'group_from',
)

EVENT_EXCHANGE_NAME = 'celeryev'
#: Exchange used to send events on.
#: Note: Use :func:`get_exchange` instead, as the type of
#: exchange will vary depending on the broker connection.
event_exchange = Exchange(EVENT_EXCHANGE_NAME, type='topic')


def Event(type, _fields=None, __dict__=dict, __now__=time.time, **fields):
    """Create an event.

    Notes:
        An event is simply a dictionary: the only required field is ``type``.
        A ``timestamp`` field will be set to the current time if not provided.
    """
    event = __dict__(_fields, **fields) if _fields else fields
    if 'timestamp' not in event:
        event.update(timestamp=__now__(), type=type)
    else:
        event['type'] = type
    return event


def group_from(type):
    """Get the group part of an event type name.

    Example:
        >>> group_from('task-sent')
        'task'

        >>> group_from('custom-my-event')
        'custom'
    """
    return type.split('-', 1)[0]


def get_exchange(conn, name=EVENT_EXCHANGE_NAME):
    """Get exchange used for sending events.

    Arguments:
        conn (kombu.Connection): Connection used for sending/receiving events.
        name (str): Name of the exchange. Default is ``celeryev``.

    Note:
        The event type changes if Redis is used as the transport
        (from topic -> fanout).
    """
    ex = copy(event_exchange)
    if conn.transport.driver_type == 'redis':
        # quick hack for Issue #436
        ex.type = 'fanout'
    if name != ex.name:
        ex.name = name
    return ex
