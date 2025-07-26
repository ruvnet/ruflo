import asyncio
from functools import partial, singledispatch
from io import BufferedRandom, BufferedReader, BufferedWriter, FileIO, TextIOBase
from tempfile import NamedTemporaryFile as syncNamedTemporaryFile
from tempfile import SpooledTemporaryFile as syncSpooledTemporaryFile
from tempfile import TemporaryDirectory as syncTemporaryDirectory
from tempfile import TemporaryFile as syncTemporaryFile
from tempfile import _TemporaryFileWrapper as syncTemporaryFileWrapper

from ..base import AiofilesContextManager
from ..threadpool.binary import AsyncBufferedIOBase, AsyncBufferedReader, AsyncFileIO
from ..threadpool.text import AsyncTextIOWrapper
from .temptypes import AsyncSpooledTemporaryFile, AsyncTemporaryDirectory
import sys

__all__ = [
    "NamedTemporaryFile",
    "TemporaryFile",
    "SpooledTemporaryFile",
    "TemporaryDirectory",
]


# ================================================================
# Public methods for async open and return of temp file/directory
# objects with async interface
# ================================================================
if sys.version_info >= (3, 12):

    def NamedTemporaryFile(
        mode="w+b",
        buffering=-1,
        encoding=None,
        newline=None,
        suffix=None,
        prefix=None,
        dir=None,
        delete=True,
        delete_on_close=True,
        loop=None,
        executor=None,
    ):
        """Async open a named temporary file"""
        return AiofilesContextManager(
            _temporary_file(
                named=True,
                mode=mode,
                buffering=buffering,
                encoding=encoding,
                newline=newline,
                suffix=suffix,
                prefix=prefix,
                dir=dir,
                delete=delete,
                delete_on_close=delete_on_close,
                loop=loop,
                executor=executor,
            )
        )

else:

    def NamedTemporaryFile(
        mode="w+b",
        buffering=-1,
        encoding=None,
        newline=None,
        suffix=None,
        prefix=None,
        dir=None,
        delete=True,
        loop=None,
        executor=None,
    ):
        """Async open a named temporary file"""
        return AiofilesContextManager(
            _temporary_file(
                named=True,
                mode=mode,
                buffering=buffering,
                encoding=encoding,
                newline=newline,
                suffix=suffix,
                prefix=prefix,
                dir=dir,
                delete=delete,
                loop=loop,
                executor=executor,
            )
        )


def TemporaryFile(
    mode="w+b",
    buffering=-1,
    encoding=None,
    newline=None,
    suffix=None,
    prefix=None,
    dir=None,
    loop=None,
    executor=None,
):
    """Async open an unnamed temporary file"""
    return AiofilesContextManager(
        _temporary_file(
            named=False,
            mode=mode,
            buffering=buffering,
            encoding=encoding,
            newline=newline,
            suffix=suffix,
            prefix=prefix,
            dir=dir,
            loop=loop,
            executor=executor,
        )
    )


def SpooledTemporaryFile(
    max_size=0,
    mode="w+b",
    buffering=-1,
    encoding=None,
    newline=None,
    suffix=None,
    prefix=None,
    dir=None,
    loop=None,
    executor=None,
):
    """Async open a spooled temporary file"""
    return AiofilesContextManager(
        _spooled_temporary_file(
            max_size=max_size,
            mode=mode,
            buffering=buffering,
            encoding=encoding,
            newline=newline,
            suffix=suffix,
            prefix=prefix,
            dir=dir,
            loop=loop,
            executor=executor,
        )
    )


def TemporaryDirectory(suffix=None, prefix=None, dir=None, loop=None, executor=None):
    """Async open a temporary directory"""
    return AiofilesContextManagerTempDir(
        _temporary_directory(
            suffix=suffix, prefix=prefix, dir=dir, loop=loop, executor=executor
        )
    )


# =========================================================
# Internal coroutines to open new temp files/directories
# =========================================================
if sys.version_info >= (3, 12):

    async def _temporary_file(
        named=True,
        mode="w+b",
        buffering=-1,
        encoding=None,
        newline=None,
        suffix=None,
        prefix=None,
        dir=None,
        delete=True,
        delete_on_close=True,
        loop=None,
        executor=None,
        max_size=0,
    ):
        """Async method to open a temporary file with async interface"""
        if loop is None:
            loop = asyncio.get_running_loop()

        if named:
            cb = partial(
                syncNamedTemporaryFile,
                mode=mode,
                buffering=buffering,
                encoding=encoding,
                newline=newline,
                suffix=suffix,
                prefix=prefix,
                dir=dir,
                delete=delete,
                delete_on_close=delete_on_close,
            )
        else:
            cb = partial(
                syncTemporaryFile,
                mode=mode,
                buffering=buffering,
                encoding=encoding,
                newline=newline,
                suffix=suffix,
                prefix=prefix,
                dir=dir,
            )

        f = await loop.run_in_executor(executor, cb)

        # Wrap based on type of underlying IO object
        if type(f) is syncTemporaryFileWrapper:
            # _TemporaryFileWrapper was used (named files)
            result = wrap(f.file, f, loop=loop, executor=executor)
            result._closer = f._closer
            return result
        else:
            # IO object was returned directly without wrapper
            return wrap(f, f, loop=loop, executor=executor)

else:

    async def _temporary_file(
        named=True,
        mode="w+b",
        buffering=-1,
        encoding=None,
        newline=None,
        suffix=None,
        prefix=None,
        dir=None,
        delete=True,
        loop=None,
        executor=None,
        max_size=0,
    ):
        """Async method to open a temporary file with async interface"""
        if loop is None:
            loop = asyncio.get_running_loop()

        if named:
            cb = partial(
                syncNamedTemporaryFile,
                mode=mode,
                buffering=buffering,
                encoding=encoding,
                newline=newline,
                suffix=suffix,
                prefix=prefix,
                dir=dir,
                delete=delete,
            )
        else:
            cb = partial(
                syncTemporaryFile,
                mode=mode,
                buffering=buffering,
                encoding=encoding,
                newline=newline,
                suffix=suffix,
                prefix=prefix,
                dir=dir,
            )

        f = await loop.run_in_executor(executor, cb)

        # Wrap based on type of underlying IO object
        if type(f) is syncTemporaryFileWrapper:
            # _TemporaryFileWrapper was used (named files)
            result = wrap(f.file, f, loop=loop, executor=executor)
            # add delete property
            result.delete = f.delete
            return result
        else:
            # IO object was returned directly without wrapper
            return wrap(f, f, loop=loop, executor=executor)


async def _spooled_temporary_file(
    max_size=0,
    mode="w+b",
    buffering=-1,
    encoding=None,
    newline=None,
    suffix=None,
    prefix=None,
    dir=None,
    loop=None,
    executor=None,
):
    """Open a spooled temporary file with async interface"""
    if loop is None:
        loop = asyncio.get_running_loop()

    cb = partial(
        syncSpooledTemporaryFile,
        max_size=max_size,
        mode=mode,
        buffering=buffering,
        encoding=encoding,
        newline=newline,
        suffix=suffix,
        prefix=prefix,
        dir=dir,
    )

    f = await loop.run_in_executor(executor, cb)

    # Single interface provided by SpooledTemporaryFile for all modes
    return AsyncSpooledTemporaryFile(f, loop=loop, executor=executor)


async def _temporary_directory(
    suffix=None, prefix=None, dir=None, loop=None, executor=None
):
    """Async method to open a temporary directory with async interface"""
    if loop is None:
        loop = asyncio.get_running_loop()

    cb = partial(syncTemporaryDirectory, suffix, prefix, dir)
    f = await loop.run_in_executor(executor, cb)

    return AsyncTemporaryDirectory(f, loop=loop, executor=executor)


class AiofilesContextManagerTempDir(AiofilesContextManager):
    """With returns the directory location, not the object (matching sync lib)"""

    async def __aenter__(self):
        self._obj = await self._coro
        return self._obj.name


@singledispatch
def wrap(base_io_obj, file, *, loop=None, executor=None):
    """Wrap the object with interface based on type of underlying IO"""
    raise TypeError("Unsupported IO type: {}".format(base_io_obj))


@wrap.register(TextIOBase)
def _(base_io_obj, file, *, loop=None, executor=None):
    return AsyncTextIOWrapper(file, loop=loop, executor=executor)


@wrap.register(BufferedWriter)
def _(base_io_obj, file, *, loop=None, executor=None):
    return AsyncBufferedIOBase(file, loop=loop, executor=executor)


@wrap.register(BufferedReader)
@wrap.register(BufferedRandom)
def _(base_io_obj, file, *, loop=None, executor=None):
    return AsyncBufferedReader(file, loop=loop, executor=executor)


@wrap.register(FileIO)
def _(base_io_obj, file, *, loop=None, executor=None):
    return AsyncFileIO(file, loop=loop, executor=executor)
