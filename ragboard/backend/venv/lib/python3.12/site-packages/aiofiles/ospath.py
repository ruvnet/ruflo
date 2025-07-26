"""Async executor versions of file functions from the os.path module."""
import asyncio
from functools import partial, wraps
from os import path


def wrap(func):
    @wraps(func)
    async def run(*args, loop=None, executor=None, **kwargs):
        if loop is None:
            loop = asyncio.get_running_loop()
        pfunc = partial(func, *args, **kwargs)
        return await loop.run_in_executor(executor, pfunc)

    return run


exists = wrap(path.exists)
isfile = wrap(path.isfile)
isdir = wrap(path.isdir)
islink = wrap(path.islink)
ismount = wrap(path.ismount)
getsize = wrap(path.getsize)
getmtime = wrap(path.getmtime)
getatime = wrap(path.getatime)
getctime = wrap(path.getctime)
samefile = wrap(path.samefile)
sameopenfile = wrap(path.sameopenfile)
