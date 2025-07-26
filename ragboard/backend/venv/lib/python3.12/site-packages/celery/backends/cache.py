"""Memcached and in-memory cache result backend."""
from kombu.utils.encoding import bytes_to_str, ensure_bytes
from kombu.utils.objects import cached_property

from celery.exceptions import ImproperlyConfigured
from celery.utils.functional import LRUCache

from .base import KeyValueStoreBackend

__all__ = ('CacheBackend',)

_imp = [None]

REQUIRES_BACKEND = """\
The Memcached backend requires either pylibmc or python-memcached.\
"""

UNKNOWN_BACKEND = """\
The cache backend {0!r} is unknown,
Please use one of the following backends instead: {1}\
"""

# Global shared in-memory cache for in-memory cache client
# This is to share cache between threads
_DUMMY_CLIENT_CACHE = LRUCache(limit=5000)


def import_best_memcache():
    if _imp[0] is None:
        is_pylibmc, memcache_key_t = False, bytes_to_str
        try:
            import pylibmc as memcache
            is_pylibmc = True
        except ImportError:
            try:
                import memcache
            except ImportError:
                raise ImproperlyConfigured(REQUIRES_BACKEND)
        _imp[0] = (is_pylibmc, memcache, memcache_key_t)
    return _imp[0]


def get_best_memcache(*args, **kwargs):
    # pylint: disable=unpacking-non-sequence
    #   This is most definitely a sequence, but pylint thinks it's not.
    is_pylibmc, memcache, key_t = import_best_memcache()
    Client = _Client = memcache.Client

    if not is_pylibmc:
        def Client(*args, **kwargs):  # noqa: F811
            kwargs.pop('behaviors', None)
            return _Client(*args, **kwargs)

    return Client, key_t


class DummyClient:

    def __init__(self, *args, **kwargs):
        self.cache = _DUMMY_CLIENT_CACHE

    def get(self, key, *args, **kwargs):
        return self.cache.get(key)

    def get_multi(self, keys):
        cache = self.cache
        return {k: cache[k] for k in keys if k in cache}

    def set(self, key, value, *args, **kwargs):
        self.cache[key] = value

    def delete(self, key, *args, **kwargs):
        self.cache.pop(key, None)

    def incr(self, key, delta=1):
        return self.cache.incr(key, delta)

    def touch(self, key, expire):
        pass


backends = {
    'memcache': get_best_memcache,
    'memcached': get_best_memcache,
    'pylibmc': get_best_memcache,
    'memory': lambda: (DummyClient, ensure_bytes),
}


class CacheBackend(KeyValueStoreBackend):
    """Cache result backend."""

    servers = None
    supports_autoexpire = True
    supports_native_join = True
    implements_incr = True

    def __init__(self, app, expires=None, backend=None,
                 options=None, url=None, **kwargs):
        options = {} if not options else options
        super().__init__(app, **kwargs)
        self.url = url

        self.options = dict(self.app.conf.cache_backend_options,
                            **options)

        self.backend = url or backend or self.app.conf.cache_backend
        if self.backend:
            self.backend, _, servers = self.backend.partition('://')
            self.servers = servers.rstrip('/').split(';')
        self.expires = self.prepare_expires(expires, type=int)
        try:
            self.Client, self.key_t = backends[self.backend]()
        except KeyError:
            raise ImproperlyConfigured(UNKNOWN_BACKEND.format(
                self.backend, ', '.join(backends)))
        self._encode_prefixes()  # rencode the keyprefixes

    def get(self, key):
        return self.client.get(key)

    def mget(self, keys):
        return self.client.get_multi(keys)

    def set(self, key, value):
        return self.client.set(key, value, self.expires)

    def delete(self, key):
        return self.client.delete(key)

    def _apply_chord_incr(self, header_result_args, body, **kwargs):
        chord_key = self.get_key_for_chord(header_result_args[0])
        self.client.set(chord_key, 0, time=self.expires)
        return super()._apply_chord_incr(
            header_result_args, body, **kwargs)

    def incr(self, key):
        return self.client.incr(key)

    def expire(self, key, value):
        return self.client.touch(key, value)

    @cached_property
    def client(self):
        return self.Client(self.servers, **self.options)

    def __reduce__(self, args=(), kwargs=None):
        kwargs = {} if not kwargs else kwargs
        servers = ';'.join(self.servers)
        backend = f'{self.backend}://{servers}/'
        kwargs.update(
            {'backend': backend,
             'expires': self.expires,
             'options': self.options})
        return super().__reduce__(args, kwargs)

    def as_uri(self, *args, **kwargs):
        """Return the backend as an URI.

        This properly handles the case of multiple servers.
        """
        servers = ';'.join(self.servers)
        return f'{self.backend}://{servers}/'
