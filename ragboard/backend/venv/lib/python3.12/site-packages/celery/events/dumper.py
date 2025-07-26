"""Utility to dump events to screen.

This is a simple program that dumps events to the console
as they happen.  Think of it like a `tcpdump` for Celery events.
"""
import sys
from datetime import datetime

from celery.app import app_or_default
from celery.utils.functional import LRUCache
from celery.utils.time import humanize_seconds

__all__ = ('Dumper', 'evdump')

TASK_NAMES = LRUCache(limit=0xFFF)

HUMAN_TYPES = {
    'worker-offline': 'shutdown',
    'worker-online': 'started',
    'worker-heartbeat': 'heartbeat',
}

CONNECTION_ERROR = """\
-> Cannot connect to %s: %s.
Trying again %s
"""


def humanize_type(type):
    try:
        return HUMAN_TYPES[type.lower()]
    except KeyError:
        return type.lower().replace('-', ' ')


class Dumper:
    """Monitor events."""

    def __init__(self, out=sys.stdout):
        self.out = out

    def say(self, msg):
        print(msg, file=self.out)
        # need to flush so that output can be piped.
        try:
            self.out.flush()
        except AttributeError:  # pragma: no cover
            pass

    def on_event(self, ev):
        timestamp = datetime.utcfromtimestamp(ev.pop('timestamp'))
        type = ev.pop('type').lower()
        hostname = ev.pop('hostname')
        if type.startswith('task-'):
            uuid = ev.pop('uuid')
            if type in ('task-received', 'task-sent'):
                task = TASK_NAMES[uuid] = '{}({}) args={} kwargs={}' \
                    .format(ev.pop('name'), uuid,
                            ev.pop('args'),
                            ev.pop('kwargs'))
            else:
                task = TASK_NAMES.get(uuid, '')
            return self.format_task_event(hostname, timestamp,
                                          type, task, ev)
        fields = ', '.join(
            f'{key}={ev[key]}' for key in sorted(ev)
        )
        sep = fields and ':' or ''
        self.say(f'{hostname} [{timestamp}] {humanize_type(type)}{sep} {fields}')

    def format_task_event(self, hostname, timestamp, type, task, event):
        fields = ', '.join(
            f'{key}={event[key]}' for key in sorted(event)
        )
        sep = fields and ':' or ''
        self.say(f'{hostname} [{timestamp}] {humanize_type(type)}{sep} {task} {fields}')


def evdump(app=None, out=sys.stdout):
    """Start event dump."""
    app = app_or_default(app)
    dumper = Dumper(out=out)
    dumper.say('-> evdump: starting capture...')
    conn = app.connection_for_read().clone()

    def _error_handler(exc, interval):
        dumper.say(CONNECTION_ERROR % (
            conn.as_uri(), exc, humanize_seconds(interval, 'in', ' ')
        ))

    while 1:
        try:
            conn.ensure_connection(_error_handler)
            recv = app.events.Receiver(conn, handlers={'*': dumper.on_event})
            recv.capture()
        except (KeyboardInterrupt, SystemExit):
            return conn and conn.close()
        except conn.connection_errors + conn.channel_errors:
            dumper.say('-> Connection lost, attempting reconnect')


if __name__ == '__main__':  # pragma: no cover
    evdump()
