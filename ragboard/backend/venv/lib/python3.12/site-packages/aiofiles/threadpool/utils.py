import functools


def delegate_to_executor(*attrs):
    def cls_builder(cls):
        for attr_name in attrs:
            setattr(cls, attr_name, _make_delegate_method(attr_name))
        return cls

    return cls_builder


def proxy_method_directly(*attrs):
    def cls_builder(cls):
        for attr_name in attrs:
            setattr(cls, attr_name, _make_proxy_method(attr_name))
        return cls

    return cls_builder


def proxy_property_directly(*attrs):
    def cls_builder(cls):
        for attr_name in attrs:
            setattr(cls, attr_name, _make_proxy_property(attr_name))
        return cls

    return cls_builder


def cond_delegate_to_executor(*attrs):
    def cls_builder(cls):
        for attr_name in attrs:
            setattr(cls, attr_name, _make_cond_delegate_method(attr_name))
        return cls

    return cls_builder


def _make_delegate_method(attr_name):
    async def method(self, *args, **kwargs):
        cb = functools.partial(getattr(self._file, attr_name), *args, **kwargs)
        return await self._loop.run_in_executor(self._executor, cb)

    return method


def _make_proxy_method(attr_name):
    def method(self, *args, **kwargs):
        return getattr(self._file, attr_name)(*args, **kwargs)

    return method


def _make_proxy_property(attr_name):
    def proxy_property(self):
        return getattr(self._file, attr_name)

    return property(proxy_property)


def _make_cond_delegate_method(attr_name):
    """For spooled temp files, delegate only if rolled to file object"""

    async def method(self, *args, **kwargs):
        if self._file._rolled:
            cb = functools.partial(getattr(self._file, attr_name), *args, **kwargs)
            return await self._loop.run_in_executor(self._executor, cb)
        else:
            return getattr(self._file, attr_name)(*args, **kwargs)

    return method
