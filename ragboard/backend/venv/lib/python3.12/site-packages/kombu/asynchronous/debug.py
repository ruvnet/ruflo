"""Event-loop debugging tools."""

from __future__ import annotations

from kombu.utils.eventio import ERR, READ, WRITE
from kombu.utils.functional import reprcall


def repr_flag(flag):
    """Return description of event loop flag."""
    return '{}{}{}'.format('R' if flag & READ else '',
                           'W' if flag & WRITE else '',
                           '!' if flag & ERR else '')


def _rcb(obj):
    if obj is None:
        return '<missing>'
    if isinstance(obj, str):
        return obj
    if isinstance(obj, tuple):
        cb, args = obj
        return reprcall(cb.__name__, args=args)
    return obj.__name__


def repr_active(h):
    """Return description of active readers and writers."""
    return ', '.join(repr_readers(h) + repr_writers(h))


def repr_events(h, events):
    """Return description of events returned by poll."""
    return ', '.join(
        '{}({})->{}'.format(
            _rcb(callback_for(h, fd, fl, '(GONE)')), fd,
            repr_flag(fl),
        )
        for fd, fl in events
    )


def repr_readers(h):
    """Return description of pending readers."""
    return [f'({fd}){_rcb(cb)}->{repr_flag(READ | ERR)}'
            for fd, cb in h.readers.items()]


def repr_writers(h):
    """Return description of pending writers."""
    return [f'({fd}){_rcb(cb)}->{repr_flag(WRITE)}'
            for fd, cb in h.writers.items()]


def callback_for(h, fd, flag, *default):
    """Return the callback used for hub+fd+flag."""
    try:
        if flag & READ:
            return h.readers[fd]
        if flag & WRITE:
            if fd in h.consolidate:
                return h.consolidate_callback
            return h.writers[fd]
    except KeyError:
        if default:
            return default[0]
        raise
