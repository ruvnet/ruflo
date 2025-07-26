#
# Module which supports allocation of memory from an mmap
#
# multiprocessing/heap.py
#
# Copyright (c) 2006-2008, R Oudkerk
# Licensed to PSF under a Contributor Agreement.
#

import bisect
import errno
import io
import mmap
import os
import sys
import threading
import tempfile

from . import context
from . import reduction
from . import util

from ._ext import _billiard, win32

__all__ = ['BufferWrapper']

PY3 = sys.version_info[0] == 3

#
# Inheritable class which wraps an mmap, and from which blocks can be allocated
#

if sys.platform == 'win32':

    class Arena:

        _rand = tempfile._RandomNameSequence()

        def __init__(self, size):
            self.size = size
            for i in range(100):
                name = 'pym-%d-%s' % (os.getpid(), next(self._rand))
                buf = mmap.mmap(-1, size, tagname=name)
                if win32.GetLastError() == 0:
                    break
                # we have reopened a preexisting map
                buf.close()
            else:
                exc = IOError('Cannot find name for new mmap')
                exc.errno = errno.EEXIST
                raise exc
            self.name = name
            self.buffer = buf
            self._state = (self.size, self.name)

        def __getstate__(self):
            context.assert_spawning(self)
            return self._state

        def __setstate__(self, state):
            self.size, self.name = self._state = state
            self.buffer = mmap.mmap(-1, self.size, tagname=self.name)
            # XXX Temporarily preventing buildbot failures while determining
            # XXX the correct long-term fix. See issue #23060
            # assert win32.GetLastError() == win32.ERROR_ALREADY_EXISTS

else:

    class Arena:

        def __init__(self, size, fd=-1):
            self.size = size
            self.fd = fd
            if fd == -1:
                if PY3:
                    self.fd, name = tempfile.mkstemp(
                        prefix='pym-%d-' % (os.getpid(),),
                        dir=util.get_temp_dir(),
                    )

                    os.unlink(name)
                    util.Finalize(self, os.close, (self.fd,))
                    with io.open(self.fd, 'wb', closefd=False) as f:
                        bs = 1024 * 1024
                        if size >= bs:
                            zeros = b'\0' * bs
                            for _ in range(size // bs):
                                f.write(zeros)
                            del(zeros)
                        f.write(b'\0' * (size % bs))
                        assert f.tell() == size
                else:
                    self.fd, name = tempfile.mkstemp(
                        prefix='pym-%d-' % (os.getpid(),),
                        dir=util.get_temp_dir(),
                    )
                    os.unlink(name)
                    util.Finalize(self, os.close, (self.fd,))
                    os.ftruncate(self.fd, size)
            self.buffer = mmap.mmap(self.fd, self.size)

    def reduce_arena(a):
        if a.fd == -1:
            raise ValueError('Arena is unpicklable because'
                             'forking was enabled when it was created')
        return rebuild_arena, (a.size, reduction.DupFd(a.fd))

    def rebuild_arena(size, dupfd):
        return Arena(size, dupfd.detach())

    reduction.register(Arena, reduce_arena)

#
# Class allowing allocation of chunks of memory from arenas
#


class Heap:

    _alignment = 8

    def __init__(self, size=mmap.PAGESIZE):
        self._lastpid = os.getpid()
        self._lock = threading.Lock()
        self._size = size
        self._lengths = []
        self._len_to_seq = {}
        self._start_to_block = {}
        self._stop_to_block = {}
        self._allocated_blocks = set()
        self._arenas = []
        # list of pending blocks to free - see free() comment below
        self._pending_free_blocks = []

    @staticmethod
    def _roundup(n, alignment):
        # alignment must be a power of 2
        mask = alignment - 1
        return (n + mask) & ~mask

    def _malloc(self, size):
        # returns a large enough block -- it might be much larger
        i = bisect.bisect_left(self._lengths, size)
        if i == len(self._lengths):
            length = self._roundup(max(self._size, size), mmap.PAGESIZE)
            self._size *= 2
            util.info('allocating a new mmap of length %d', length)
            arena = Arena(length)
            self._arenas.append(arena)
            return (arena, 0, length)
        else:
            length = self._lengths[i]
            seq = self._len_to_seq[length]
            block = seq.pop()
            if not seq:
                del self._len_to_seq[length], self._lengths[i]

        (arena, start, stop) = block
        del self._start_to_block[(arena, start)]
        del self._stop_to_block[(arena, stop)]
        return block

    def _free(self, block):
        # free location and try to merge with neighbours
        (arena, start, stop) = block

        try:
            prev_block = self._stop_to_block[(arena, start)]
        except KeyError:
            pass
        else:
            start, _ = self._absorb(prev_block)

        try:
            next_block = self._start_to_block[(arena, stop)]
        except KeyError:
            pass
        else:
            _, stop = self._absorb(next_block)

        block = (arena, start, stop)
        length = stop - start

        try:
            self._len_to_seq[length].append(block)
        except KeyError:
            self._len_to_seq[length] = [block]
            bisect.insort(self._lengths, length)

        self._start_to_block[(arena, start)] = block
        self._stop_to_block[(arena, stop)] = block

    def _absorb(self, block):
        # deregister this block so it can be merged with a neighbour
        (arena, start, stop) = block
        del self._start_to_block[(arena, start)]
        del self._stop_to_block[(arena, stop)]

        length = stop - start
        seq = self._len_to_seq[length]
        seq.remove(block)
        if not seq:
            del self._len_to_seq[length]
            self._lengths.remove(length)

        return start, stop

    def _free_pending_blocks(self):
        # Free all the blocks in the pending list - called with the lock held
        while 1:
            try:
                block = self._pending_free_blocks.pop()
            except IndexError:
                break
            self._allocated_blocks.remove(block)
            self._free(block)

    def free(self, block):
        # free a block returned by malloc()
        # Since free() can be called asynchronously by the GC, it could happen
        # that it's called while self._lock is held: in that case,
        # self._lock.acquire() would deadlock (issue #12352). To avoid that, a
        # trylock is used instead, and if the lock can't be acquired
        # immediately, the block is added to a list of blocks to be freed
        # synchronously sometimes later from malloc() or free(), by calling
        # _free_pending_blocks() (appending and retrieving from a list is not
        # strictly thread-safe but under cPython it's atomic
        # thanks to the GIL).
        assert os.getpid() == self._lastpid
        if not self._lock.acquire(False):
            # can't acquire the lock right now, add the block to the list of
            # pending blocks to free
            self._pending_free_blocks.append(block)
        else:
            # we hold the lock
            try:
                self._free_pending_blocks()
                self._allocated_blocks.remove(block)
                self._free(block)
            finally:
                self._lock.release()

    def malloc(self, size):
        # return a block of right size (possibly rounded up)
        assert 0 <= size < sys.maxsize
        if os.getpid() != self._lastpid:
            self.__init__()                     # reinitialize after fork
        with self._lock:
            self._free_pending_blocks()
            size = self._roundup(max(size, 1), self._alignment)
            (arena, start, stop) = self._malloc(size)
            new_stop = start + size
            if new_stop < stop:
                self._free((arena, new_stop, stop))
            block = (arena, start, new_stop)
            self._allocated_blocks.add(block)
            return block

#
# Class representing a chunk of an mmap -- can be inherited
#


class BufferWrapper:

    _heap = Heap()

    def __init__(self, size):
        assert 0 <= size < sys.maxsize
        block = BufferWrapper._heap.malloc(size)
        self._state = (block, size)
        util.Finalize(self, BufferWrapper._heap.free, args=(block,))

    def get_address(self):
        (arena, start, stop), size = self._state
        address, length = _billiard.address_of_buffer(arena.buffer)
        assert size <= length
        return address + start

    def get_size(self):
        return self._state[1]

    def create_memoryview(self):
        (arena, start, stop), size = self._state
        return memoryview(arena.buffer)[start:start + size]
