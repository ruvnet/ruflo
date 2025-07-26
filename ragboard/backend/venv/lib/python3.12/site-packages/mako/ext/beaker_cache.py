# ext/beaker_cache.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""Provide a :class:`.CacheImpl` for the Beaker caching system."""

from mako import exceptions
from mako.cache import CacheImpl

try:
    from beaker import cache as beaker_cache
except:
    has_beaker = False
else:
    has_beaker = True

_beaker_cache = None


class BeakerCacheImpl(CacheImpl):

    """A :class:`.CacheImpl` provided for the Beaker caching system.

    This plugin is used by default, based on the default
    value of ``'beaker'`` for the ``cache_impl`` parameter of the
    :class:`.Template` or :class:`.TemplateLookup` classes.

    """

    def __init__(self, cache):
        if not has_beaker:
            raise exceptions.RuntimeException(
                "Can't initialize Beaker plugin; Beaker is not installed."
            )
        global _beaker_cache
        if _beaker_cache is None:
            if "manager" in cache.template.cache_args:
                _beaker_cache = cache.template.cache_args["manager"]
            else:
                _beaker_cache = beaker_cache.CacheManager()
        super().__init__(cache)

    def _get_cache(self, **kw):
        expiretime = kw.pop("timeout", None)
        if "dir" in kw:
            kw["data_dir"] = kw.pop("dir")
        elif self.cache.template.module_directory:
            kw["data_dir"] = self.cache.template.module_directory

        if "manager" in kw:
            kw.pop("manager")

        if kw.get("type") == "memcached":
            kw["type"] = "ext:memcached"

        if "region" in kw:
            region = kw.pop("region")
            cache = _beaker_cache.get_cache_region(self.cache.id, region, **kw)
        else:
            cache = _beaker_cache.get_cache(self.cache.id, **kw)
        cache_args = {"starttime": self.cache.starttime}
        if expiretime:
            cache_args["expiretime"] = expiretime
        return cache, cache_args

    def get_or_create(self, key, creation_function, **kw):
        cache, kw = self._get_cache(**kw)
        return cache.get(key, createfunc=creation_function, **kw)

    def put(self, key, value, **kw):
        cache, kw = self._get_cache(**kw)
        cache.put(key, value, **kw)

    def get(self, key, **kw):
        cache, kw = self._get_cache(**kw)
        return cache.get(key, **kw)

    def invalidate(self, key, **kw):
        cache, kw = self._get_cache(**kw)
        cache.remove_value(key, **kw)
