"""Public resource pools."""

from __future__ import annotations

import os
from itertools import chain

from .connection import Resource
from .messaging import Producer
from .utils.collections import EqualityDict
from .utils.compat import register_after_fork
from .utils.functional import lazy

__all__ = ('ProducerPool', 'PoolGroup', 'register_group',
           'connections', 'producers', 'get_limit', 'set_limit', 'reset')
_limit = [10]
_groups = []
use_global_limit = object()
disable_limit_protection = os.environ.get('KOMBU_DISABLE_LIMIT_PROTECTION')


def _after_fork_cleanup_group(group):
    group.clear()


class ProducerPool(Resource):
    """Pool of :class:`kombu.Producer` instances."""

    Producer = Producer
    close_after_fork = True

    def __init__(self, connections, *args, **kwargs):
        self.connections = connections
        self.Producer = kwargs.pop('Producer', None) or self.Producer
        super().__init__(*args, **kwargs)

    def _acquire_connection(self):
        return self.connections.acquire(block=True)

    def create_producer(self):
        conn = self._acquire_connection()
        try:
            return self.Producer(conn)
        except BaseException:
            conn.release()
            raise

    def new(self):
        return lazy(self.create_producer)

    def setup(self):
        if self.limit:
            for _ in range(self.limit):
                self._resource.put_nowait(self.new())

    def close_resource(self, resource):
        pass

    def prepare(self, p):
        if callable(p):
            p = p()
        if p._channel is None:
            conn = self._acquire_connection()
            try:
                p.revive(conn)
            except BaseException:
                conn.release()
                raise
        return p

    def release(self, resource):
        if resource.__connection__:
            resource.__connection__.release()
        resource.channel = None
        super().release(resource)


class PoolGroup(EqualityDict):
    """Collection of resource pools."""

    def __init__(self, limit=None, close_after_fork=True):
        self.limit = limit
        self.close_after_fork = close_after_fork
        if self.close_after_fork and register_after_fork is not None:
            register_after_fork(self, _after_fork_cleanup_group)

    def create(self, resource, limit):
        raise NotImplementedError('PoolGroups must define ``create``')

    def __missing__(self, resource):
        limit = self.limit
        if limit is use_global_limit:
            limit = get_limit()
        k = self[resource] = self.create(resource, limit)
        return k


def register_group(group):
    """Register group (can be used as decorator)."""
    _groups.append(group)
    return group


class Connections(PoolGroup):
    """Collection of connection pools."""

    def create(self, connection, limit):
        return connection.Pool(limit=limit)


connections = register_group(Connections(limit=use_global_limit))


class Producers(PoolGroup):
    """Collection of producer pools."""

    def create(self, connection, limit):
        return ProducerPool(connections[connection], limit=limit)


producers = register_group(Producers(limit=use_global_limit))


def _all_pools():
    return chain(*((g.values() if g else iter([])) for g in _groups))


def get_limit():
    """Get current connection pool limit."""
    return _limit[0]


def set_limit(limit, force=False, reset_after=False, ignore_errors=False):
    """Set new connection pool limit."""
    limit = limit or 0
    glimit = _limit[0] or 0
    if limit != glimit:
        _limit[0] = limit
        for pool in _all_pools():
            pool.resize(limit)
    return limit


def reset(*args, **kwargs):
    """Reset all pools by closing open resources."""
    for pool in _all_pools():
        try:
            pool.force_close_all()
        except Exception:
            pass
    for group in _groups:
        group.clear()
