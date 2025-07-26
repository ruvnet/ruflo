"""Selector Utilities."""

from __future__ import annotations

import errno
import math
import select as __select__
import sys
from numbers import Integral

from . import fileno
from .compat import detect_environment

__all__ = ('poll',)

_selectf = __select__.select
_selecterr = __select__.error
xpoll = getattr(__select__, 'poll', None)
epoll = getattr(__select__, 'epoll', None)
kqueue = getattr(__select__, 'kqueue', None)
kevent = getattr(__select__, 'kevent', None)
KQ_EV_ADD = getattr(__select__, 'KQ_EV_ADD', 1)
KQ_EV_DELETE = getattr(__select__, 'KQ_EV_DELETE', 2)
KQ_EV_ENABLE = getattr(__select__, 'KQ_EV_ENABLE', 4)
KQ_EV_CLEAR = getattr(__select__, 'KQ_EV_CLEAR', 32)
KQ_EV_ERROR = getattr(__select__, 'KQ_EV_ERROR', 16384)
KQ_EV_EOF = getattr(__select__, 'KQ_EV_EOF', 32768)
KQ_FILTER_READ = getattr(__select__, 'KQ_FILTER_READ', -1)
KQ_FILTER_WRITE = getattr(__select__, 'KQ_FILTER_WRITE', -2)
KQ_FILTER_AIO = getattr(__select__, 'KQ_FILTER_AIO', -3)
KQ_FILTER_VNODE = getattr(__select__, 'KQ_FILTER_VNODE', -4)
KQ_FILTER_PROC = getattr(__select__, 'KQ_FILTER_PROC', -5)
KQ_FILTER_SIGNAL = getattr(__select__, 'KQ_FILTER_SIGNAL', -6)
KQ_FILTER_TIMER = getattr(__select__, 'KQ_FILTER_TIMER', -7)
KQ_NOTE_LOWAT = getattr(__select__, 'KQ_NOTE_LOWAT', 1)
KQ_NOTE_DELETE = getattr(__select__, 'KQ_NOTE_DELETE', 1)
KQ_NOTE_WRITE = getattr(__select__, 'KQ_NOTE_WRITE', 2)
KQ_NOTE_EXTEND = getattr(__select__, 'KQ_NOTE_EXTEND', 4)
KQ_NOTE_ATTRIB = getattr(__select__, 'KQ_NOTE_ATTRIB', 8)
KQ_NOTE_LINK = getattr(__select__, 'KQ_NOTE_LINK', 16)
KQ_NOTE_RENAME = getattr(__select__, 'KQ_NOTE_RENAME', 32)
KQ_NOTE_REVOKE = getattr(__select__, 'KQ_NOTE_REVOKE', 64)
POLLIN = getattr(__select__, 'POLLIN', 1)
POLLOUT = getattr(__select__, 'POLLOUT', 4)
POLLERR = getattr(__select__, 'POLLERR', 8)
POLLHUP = getattr(__select__, 'POLLHUP', 16)
POLLNVAL = getattr(__select__, 'POLLNVAL', 32)

READ = POLL_READ = 0x001
WRITE = POLL_WRITE = 0x004
ERR = POLL_ERR = 0x008 | 0x010

try:
    SELECT_BAD_FD = {errno.EBADF, errno.WSAENOTSOCK}
except AttributeError:
    SELECT_BAD_FD = {errno.EBADF}


class _epoll:

    def __init__(self):
        self._epoll = epoll()

    def register(self, fd, events):
        try:
            self._epoll.register(fd, events)
        except Exception as exc:
            if getattr(exc, 'errno', None) != errno.EEXIST:
                raise
        return fd

    def unregister(self, fd):
        try:
            self._epoll.unregister(fd)
        except (OSError, ValueError, KeyError, TypeError):
            pass
        except OSError as exc:
            if getattr(exc, 'errno', None) not in (errno.ENOENT, errno.EPERM):
                raise

    def poll(self, timeout):
        try:
            return self._epoll.poll(timeout if timeout is not None else -1)
        except Exception as exc:
            if getattr(exc, 'errno', None) != errno.EINTR:
                raise

    def close(self):
        self._epoll.close()


class _kqueue:
    w_fflags = (KQ_NOTE_WRITE | KQ_NOTE_EXTEND |
                KQ_NOTE_ATTRIB | KQ_NOTE_DELETE)

    def __init__(self):
        self._kqueue = kqueue()
        self._active = {}
        self.on_file_change = None
        self._kcontrol = self._kqueue.control

    def register(self, fd, events):
        self._control(fd, events, KQ_EV_ADD)
        self._active[fd] = events
        return fd

    def unregister(self, fd):
        events = self._active.pop(fd, None)
        if events:
            try:
                self._control(fd, events, KQ_EV_DELETE)
            except OSError:
                pass

    def watch_file(self, fd):
        ev = kevent(fd,
                    filter=KQ_FILTER_VNODE,
                    flags=KQ_EV_ADD | KQ_EV_ENABLE | KQ_EV_CLEAR,
                    fflags=self.w_fflags)
        self._kcontrol([ev], 0)

    def unwatch_file(self, fd):
        ev = kevent(fd,
                    filter=KQ_FILTER_VNODE,
                    flags=KQ_EV_DELETE,
                    fflags=self.w_fflags)
        self._kcontrol([ev], 0)

    def _control(self, fd, events, flags):
        if not events:
            return
        kevents = []
        if events & WRITE:
            kevents.append(kevent(fd,
                                  filter=KQ_FILTER_WRITE,
                                  flags=flags))
        if not kevents or events & READ:
            kevents.append(
                kevent(fd, filter=KQ_FILTER_READ, flags=flags),
            )
        control = self._kcontrol
        for e in kevents:
            try:
                control([e], 0)
            except ValueError:
                pass

    def poll(self, timeout):
        try:
            kevents = self._kcontrol(None, 1000, timeout)
        except Exception as exc:
            if getattr(exc, 'errno', None) == errno.EINTR:
                return
            raise
        events, file_changes = {}, []
        for k in kevents:
            fd = k.ident
            if k.filter == KQ_FILTER_READ:
                events[fd] = events.get(fd, 0) | READ
            elif k.filter == KQ_FILTER_WRITE:
                if k.flags & KQ_EV_EOF:
                    events[fd] = ERR
                else:
                    events[fd] = events.get(fd, 0) | WRITE
            elif k.filter == KQ_EV_ERROR:
                events[fd] = events.get(fd, 0) | ERR
            elif k.filter == KQ_FILTER_VNODE:
                if k.fflags & KQ_NOTE_DELETE:
                    self.unregister(fd)
                file_changes.append(k)
        if file_changes:
            self.on_file_change(file_changes)
        return list(events.items())

    def close(self):
        self._kqueue.close()


class _poll:

    def __init__(self):
        self._poller = xpoll()
        self._quick_poll = self._poller.poll
        self._quick_register = self._poller.register
        self._quick_unregister = self._poller.unregister

    def register(self, fd, events):
        fd = fileno(fd)
        poll_flags = 0
        if events & ERR:
            poll_flags |= POLLERR
        if events & WRITE:
            poll_flags |= POLLOUT
        if events & READ:
            poll_flags |= POLLIN
        self._quick_register(fd, poll_flags)
        return fd

    def unregister(self, fd):
        try:
            fd = fileno(fd)
        except OSError as exc:
            # we don't know the previous fd of this object
            # but it will be removed by the next poll iteration.
            if getattr(exc, 'errno', None) in SELECT_BAD_FD:
                return fd
            raise
        self._quick_unregister(fd)
        return fd

    def poll(self, timeout, round=math.ceil,
             POLLIN=POLLIN, POLLOUT=POLLOUT, POLLERR=POLLERR,
             READ=READ, WRITE=WRITE, ERR=ERR, Integral=Integral):
        timeout = 0 if timeout and timeout < 0 else round((timeout or 0) * 1e3)
        try:
            event_list = self._quick_poll(timeout)
        except (_selecterr, OSError) as exc:
            if getattr(exc, 'errno', None) == errno.EINTR:
                return
            raise

        ready = []
        for fd, event in event_list:
            events = 0
            if event & POLLIN:
                events |= READ
            if event & POLLOUT:
                events |= WRITE
            if event & POLLERR or event & POLLNVAL or event & POLLHUP:
                events |= ERR
            assert events
            if not isinstance(fd, Integral):
                fd = fd.fileno()
            ready.append((fd, events))
        return ready

    def close(self):
        self._poller = None


class _select:

    def __init__(self):
        self._all = (self._rfd,
                     self._wfd,
                     self._efd) = set(), set(), set()

    def register(self, fd, events):
        fd = fileno(fd)
        if events & ERR:
            self._efd.add(fd)
        if events & WRITE:
            self._wfd.add(fd)
        if events & READ:
            self._rfd.add(fd)
        return fd

    def _remove_bad(self):
        for fd in self._rfd | self._wfd | self._efd:
            try:
                _selectf([fd], [], [], 0)
            except (_selecterr, OSError) as exc:
                if getattr(exc, 'errno', None) in SELECT_BAD_FD:
                    self.unregister(fd)

    def unregister(self, fd):
        try:
            fd = fileno(fd)
        except OSError as exc:
            # we don't know the previous fd of this object
            # but it will be removed by the next poll iteration.
            if getattr(exc, 'errno', None) in SELECT_BAD_FD:
                return
            raise
        self._rfd.discard(fd)
        self._wfd.discard(fd)
        self._efd.discard(fd)

    def poll(self, timeout):
        try:
            read, write, error = _selectf(
                self._rfd, self._wfd, self._efd, timeout,
            )
        except (_selecterr, OSError) as exc:
            if getattr(exc, 'errno', None) == errno.EINTR:
                return
            elif getattr(exc, 'errno', None) in SELECT_BAD_FD:
                return self._remove_bad()
            raise

        events = {}
        for fd in read:
            if not isinstance(fd, Integral):
                fd = fd.fileno()
            events[fd] = events.get(fd, 0) | READ
        for fd in write:
            if not isinstance(fd, Integral):
                fd = fd.fileno()
            events[fd] = events.get(fd, 0) | WRITE
        for fd in error:
            if not isinstance(fd, Integral):
                fd = fd.fileno()
            events[fd] = events.get(fd, 0) | ERR
        return list(events.items())

    def close(self):
        self._rfd.clear()
        self._wfd.clear()
        self._efd.clear()


def _get_poller():
    if detect_environment() != 'default':
        # greenlet
        return _select
    elif epoll:
        # Py2.6+ Linux
        return _epoll
    elif kqueue and 'netbsd' in sys.platform:
        return _kqueue
    elif xpoll:
        return _poll
    else:
        return _select


def poll(*args, **kwargs):
    """Create new poller instance."""
    return _get_poller()(*args, **kwargs)
