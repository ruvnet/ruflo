# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from libc.string cimport memcpy

import collections

class BufferError(Exception):
    pass

@cython.no_gc_clear
@cython.final
@cython.freelist(_BUFFER_FREELIST_SIZE)
cdef class WriteBuffer:

    def __cinit__(self):
        self._smallbuf_inuse = True
        self._buf = self._smallbuf
        self._size = _BUFFER_INITIAL_SIZE
        self._length = 0
        self._message_mode = 0

    def __dealloc__(self):
        if self._buf is not NULL and not self._smallbuf_inuse:
            cpython.PyMem_Free(self._buf)
            self._buf = NULL
            self._size = 0

        if self._view_count:
            raise BufferError(
                'Deallocating buffer with attached memoryviews')

    def __getbuffer__(self, Py_buffer *buffer, int flags):
        self._view_count += 1

        cpython.PyBuffer_FillInfo(
            buffer, self, self._buf, self._length,
            1,  # read-only
            flags)

    def __releasebuffer__(self, Py_buffer *buffer):
        self._view_count -= 1

    cdef inline _check_readonly(self):
        if self._view_count:
            raise BufferError('the buffer is in read-only mode')

    cdef inline _ensure_alloced(self, ssize_t extra_length):
        cdef ssize_t new_size = extra_length + self._length

        if new_size > self._size:
            self._reallocate(new_size)

    cdef _reallocate(self, ssize_t new_size):
        cdef char *new_buf

        if new_size < _BUFFER_MAX_GROW:
            new_size = _BUFFER_MAX_GROW
        else:
            # Add a little extra
            new_size += _BUFFER_INITIAL_SIZE

        if self._smallbuf_inuse:
            new_buf = <char*>cpython.PyMem_Malloc(
                sizeof(char) * <size_t>new_size)
            if new_buf is NULL:
                self._buf = NULL
                self._size = 0
                self._length = 0
                raise MemoryError
            memcpy(new_buf, self._buf, <size_t>self._size)
            self._size = new_size
            self._buf = new_buf
            self._smallbuf_inuse = False
        else:
            new_buf = <char*>cpython.PyMem_Realloc(
                <void*>self._buf, <size_t>new_size)
            if new_buf is NULL:
                cpython.PyMem_Free(self._buf)
                self._buf = NULL
                self._size = 0
                self._length = 0
                raise MemoryError
            self._buf = new_buf
            self._size = new_size

    cdef inline start_message(self, char type):
        if self._length != 0:
            raise BufferError(
                'cannot start_message for a non-empty buffer')
        self._ensure_alloced(5)
        self._message_mode = 1
        self._buf[0] = type
        self._length = 5

    cdef inline end_message(self):
        # "length-1" to exclude the message type byte
        cdef ssize_t mlen = self._length - 1

        self._check_readonly()
        if not self._message_mode:
            raise BufferError(
                'end_message can only be called with start_message')
        if self._length < 5:
            raise BufferError('end_message: buffer is too small')
        if mlen > _MAXINT32:
            raise BufferError('end_message: message is too large')

        hton.pack_int32(&self._buf[1], <int32_t>mlen)
        return self

    cdef inline reset(self):
        self._length = 0
        self._message_mode = 0

    cdef write_buffer(self, WriteBuffer buf):
        self._check_readonly()

        if not buf._length:
            return

        self._ensure_alloced(buf._length)
        memcpy(self._buf + self._length,
               <void*>buf._buf,
               <size_t>buf._length)
        self._length += buf._length

    cdef write_byte(self, char b):
        self._check_readonly()

        self._ensure_alloced(1)
        self._buf[self._length] = b
        self._length += 1

    cdef write_bytes(self, bytes data):
        cdef char* buf
        cdef ssize_t len

        cpython.PyBytes_AsStringAndSize(data, &buf, &len)
        self.write_cstr(buf, len)

    cdef write_bytestring(self, bytes string):
        cdef char* buf
        cdef ssize_t len

        cpython.PyBytes_AsStringAndSize(string, &buf, &len)
        # PyBytes_AsStringAndSize returns a null-terminated buffer,
        # but the null byte is not counted in len. hence the + 1
        self.write_cstr(buf, len + 1)

    cdef write_str(self, str string, str encoding):
        self.write_bytestring(string.encode(encoding))

    cdef write_len_prefixed_buffer(self, WriteBuffer buf):
        # Write a length-prefixed (not NULL-terminated) bytes sequence.
        self.write_int32(<int32_t>buf.len())
        self.write_buffer(buf)

    cdef write_len_prefixed_bytes(self, bytes data):
        # Write a length-prefixed (not NULL-terminated) bytes sequence.
        cdef:
            char *buf
            ssize_t size

        cpython.PyBytes_AsStringAndSize(data, &buf, &size)
        if size > _MAXINT32:
            raise BufferError('string is too large')
        # `size` does not account for the NULL at the end.
        self.write_int32(<int32_t>size)
        self.write_cstr(buf, size)

    cdef write_frbuf(self, FRBuffer *buf):
        cdef:
            ssize_t buf_len = buf.len
        if buf_len > 0:
            self.write_cstr(frb_read_all(buf), buf_len)

    cdef write_cstr(self, const char *data, ssize_t len):
        self._check_readonly()
        self._ensure_alloced(len)

        memcpy(self._buf + self._length, <void*>data, <size_t>len)
        self._length += len

    cdef write_int16(self, int16_t i):
        self._check_readonly()
        self._ensure_alloced(2)

        hton.pack_int16(&self._buf[self._length], i)
        self._length += 2

    cdef write_int32(self, int32_t i):
        self._check_readonly()
        self._ensure_alloced(4)

        hton.pack_int32(&self._buf[self._length], i)
        self._length += 4

    cdef write_int64(self, int64_t i):
        self._check_readonly()
        self._ensure_alloced(8)

        hton.pack_int64(&self._buf[self._length], i)
        self._length += 8

    cdef write_float(self, float f):
        self._check_readonly()
        self._ensure_alloced(4)

        hton.pack_float(&self._buf[self._length], f)
        self._length += 4

    cdef write_double(self, double d):
        self._check_readonly()
        self._ensure_alloced(8)

        hton.pack_double(&self._buf[self._length], d)
        self._length += 8

    @staticmethod
    cdef WriteBuffer new_message(char type):
        cdef WriteBuffer buf
        buf = WriteBuffer.__new__(WriteBuffer)
        buf.start_message(type)
        return buf

    @staticmethod
    cdef WriteBuffer new():
        cdef WriteBuffer buf
        buf = WriteBuffer.__new__(WriteBuffer)
        return buf


@cython.no_gc_clear
@cython.final
@cython.freelist(_BUFFER_FREELIST_SIZE)
cdef class ReadBuffer:

    def __cinit__(self):
        self._bufs = collections.deque()
        self._bufs_append = self._bufs.append
        self._bufs_popleft = self._bufs.popleft
        self._bufs_len = 0
        self._buf0 = None
        self._buf0_prev = None
        self._pos0 = 0
        self._len0 = 0
        self._length = 0

        self._current_message_type = 0
        self._current_message_len = 0
        self._current_message_len_unread = 0
        self._current_message_ready = 0

    cdef feed_data(self, data):
        cdef:
            ssize_t dlen
            bytes data_bytes

        if not cpython.PyBytes_CheckExact(data):
            if cpythonx.PyByteArray_CheckExact(data):
                # ProactorEventLoop in Python 3.10+ seems to be sending
                # bytearray objects instead of bytes.  Handle this here
                # to avoid duplicating this check in every data_received().
                data = bytes(data)
            else:
                raise BufferError(
                    'feed_data: a bytes or bytearray object expected')

        # Uncomment the below code to test code paths that
        # read single int/str/bytes sequences are split over
        # multiple received buffers.
        #
        # ll = 107
        # if len(data) > ll:
        #     self.feed_data(data[:ll])
        #     self.feed_data(data[ll:])
        #     return

        data_bytes = <bytes>data

        dlen = cpython.Py_SIZE(data_bytes)
        if dlen == 0:
            # EOF?
            return

        self._bufs_append(data_bytes)
        self._length += dlen

        if self._bufs_len == 0:
            # First buffer
            self._len0 = dlen
            self._buf0 = data_bytes

        self._bufs_len += 1

    cdef inline _ensure_first_buf(self):
        if PG_DEBUG:
            if self._len0 == 0:
                raise BufferError('empty first buffer')
            if self._length == 0:
                raise BufferError('empty buffer')

        if self._pos0 == self._len0:
            self._switch_to_next_buf()

    cdef _switch_to_next_buf(self):
        # The first buffer is fully read, discard it
        self._bufs_popleft()
        self._bufs_len -= 1

        # Shouldn't fail, since we've checked that `_length >= 1`
        # in _ensure_first_buf()
        self._buf0_prev = self._buf0
        self._buf0 = <bytes>self._bufs[0]

        self._pos0 = 0
        self._len0 = len(self._buf0)

        if PG_DEBUG:
            if self._len0 < 1:
                raise BufferError(
                    'debug: second buffer of ReadBuffer is empty')

    cdef inline const char* _try_read_bytes(self, ssize_t nbytes):
        # Try to read *nbytes* from the first buffer.
        #
        # Returns pointer to data if there is at least *nbytes*
        # in the buffer, NULL otherwise.
        #
        # Important: caller must call _ensure_first_buf() prior
        # to calling try_read_bytes, and must not overread

        cdef:
            const char *result

        if PG_DEBUG:
            if nbytes > self._length:
                return NULL

        if self._current_message_ready:
            if self._current_message_len_unread < nbytes:
                return NULL

        if self._pos0 + nbytes <= self._len0:
            result = cpython.PyBytes_AS_STRING(self._buf0)
            result += self._pos0
            self._pos0 += nbytes
            self._length -= nbytes
            if self._current_message_ready:
                self._current_message_len_unread -= nbytes
            return result
        else:
            return NULL

    cdef inline _read_into(self, char *buf, ssize_t nbytes):
        cdef:
            ssize_t nread
            char *buf0

        while True:
            buf0 = cpython.PyBytes_AS_STRING(self._buf0)

            if self._pos0 + nbytes > self._len0:
                nread = self._len0 - self._pos0
                memcpy(buf, buf0 + self._pos0, <size_t>nread)
                self._pos0 = self._len0
                self._length -= nread
                nbytes -= nread
                buf += nread
                self._ensure_first_buf()

            else:
                memcpy(buf, buf0 + self._pos0, <size_t>nbytes)
                self._pos0 += nbytes
                self._length -= nbytes
                break

    cdef inline _read_and_discard(self, ssize_t nbytes):
        cdef:
            ssize_t nread

        self._ensure_first_buf()
        while True:
            if self._pos0 + nbytes > self._len0:
                nread = self._len0 - self._pos0
                self._pos0 = self._len0
                self._length -= nread
                nbytes -= nread
                self._ensure_first_buf()

            else:
                self._pos0 += nbytes
                self._length -= nbytes
                break

    cdef bytes read_bytes(self, ssize_t nbytes):
        cdef:
            bytes result
            ssize_t nread
            const char *cbuf
            char *buf

        self._ensure_first_buf()
        cbuf = self._try_read_bytes(nbytes)
        if cbuf != NULL:
            return cpython.PyBytes_FromStringAndSize(cbuf, nbytes)

        if nbytes > self._length:
            raise BufferError(
                'not enough data to read {} bytes'.format(nbytes))

        if self._current_message_ready:
            self._current_message_len_unread -= nbytes
            if self._current_message_len_unread < 0:
                raise BufferError('buffer overread')

        result = cpython.PyBytes_FromStringAndSize(NULL, nbytes)
        buf = cpython.PyBytes_AS_STRING(result)
        self._read_into(buf, nbytes)
        return result

    cdef bytes read_len_prefixed_bytes(self):
        cdef int32_t size = self.read_int32()
        if size < 0:
            raise BufferError(
                'negative length for a len-prefixed bytes value')
        if size == 0:
            return b''
        return self.read_bytes(size)

    cdef str read_len_prefixed_utf8(self):
        cdef:
            int32_t size
            const char *cbuf

        size = self.read_int32()
        if size < 0:
            raise BufferError(
                'negative length for a len-prefixed bytes value')

        if size == 0:
            return ''

        self._ensure_first_buf()
        cbuf = self._try_read_bytes(size)
        if cbuf != NULL:
            return cpython.PyUnicode_DecodeUTF8(cbuf, size, NULL)
        else:
            return self.read_bytes(size).decode('utf-8')

    cdef read_uuid(self):
        cdef:
            bytes mem
            const char *cbuf

        self._ensure_first_buf()
        cbuf = self._try_read_bytes(16)
        if cbuf != NULL:
            return pg_uuid_from_buf(cbuf)
        else:
            return pg_UUID(self.read_bytes(16))

    cdef inline char read_byte(self) except? -1:
        cdef const char *first_byte

        if PG_DEBUG:
            if not self._buf0:
                raise BufferError(
                    'debug: first buffer of ReadBuffer is empty')

        self._ensure_first_buf()
        first_byte = self._try_read_bytes(1)
        if first_byte is NULL:
            raise BufferError('not enough data to read one byte')

        return first_byte[0]

    cdef inline int64_t read_int64(self) except? -1:
        cdef:
            bytes mem
            const char *cbuf

        self._ensure_first_buf()
        cbuf = self._try_read_bytes(8)
        if cbuf != NULL:
            return hton.unpack_int64(cbuf)
        else:
            mem = self.read_bytes(8)
            return hton.unpack_int64(cpython.PyBytes_AS_STRING(mem))

    cdef inline int32_t read_int32(self) except? -1:
        cdef:
            bytes mem
            const char *cbuf

        self._ensure_first_buf()
        cbuf = self._try_read_bytes(4)
        if cbuf != NULL:
            return hton.unpack_int32(cbuf)
        else:
            mem = self.read_bytes(4)
            return hton.unpack_int32(cpython.PyBytes_AS_STRING(mem))

    cdef inline int16_t read_int16(self) except? -1:
        cdef:
            bytes mem
            const char *cbuf

        self._ensure_first_buf()
        cbuf = self._try_read_bytes(2)
        if cbuf != NULL:
            return hton.unpack_int16(cbuf)
        else:
            mem = self.read_bytes(2)
            return hton.unpack_int16(cpython.PyBytes_AS_STRING(mem))

    cdef inline read_null_str(self):
        if not self._current_message_ready:
            raise BufferError(
                'read_null_str only works when the message guaranteed '
                'to be in the buffer')

        cdef:
            ssize_t pos
            ssize_t nread
            bytes result
            const char *buf
            const char *buf_start

        self._ensure_first_buf()

        buf_start = cpython.PyBytes_AS_STRING(self._buf0)
        buf = buf_start + self._pos0
        while buf - buf_start < self._len0:
            if buf[0] == 0:
                pos = buf - buf_start
                nread = pos - self._pos0
                buf = self._try_read_bytes(nread + 1)
                if buf != NULL:
                    return cpython.PyBytes_FromStringAndSize(buf, nread)
                else:
                    break
            else:
                buf += 1

        result = b''
        while True:
            pos = self._buf0.find(b'\x00', self._pos0)
            if pos >= 0:
                result += self._buf0[self._pos0 : pos]
                nread = pos - self._pos0 + 1
                self._pos0 = pos + 1
                self._length -= nread

                self._current_message_len_unread -= nread
                if self._current_message_len_unread < 0:
                    raise BufferError(
                        'read_null_str: buffer overread')

                return result

            else:
                result += self._buf0[self._pos0:]
                nread = self._len0 - self._pos0
                self._pos0 = self._len0
                self._length -= nread

                self._current_message_len_unread -= nread
                if self._current_message_len_unread < 0:
                    raise BufferError(
                        'read_null_str: buffer overread')

                self._ensure_first_buf()

    cdef int32_t take_message(self) except -1:
        cdef:
            const char *cbuf

        if self._current_message_ready:
            return 1

        if self._current_message_type == 0:
            if self._length < 1:
                return 0
            self._ensure_first_buf()
            cbuf = self._try_read_bytes(1)
            if cbuf == NULL:
                raise BufferError(
                    'failed to read one byte on a non-empty buffer')
            self._current_message_type = cbuf[0]

        if self._current_message_len == 0:
            if self._length < 4:
                return 0

            self._ensure_first_buf()
            cbuf = self._try_read_bytes(4)
            if cbuf != NULL:
                self._current_message_len = hton.unpack_int32(cbuf)
            else:
                self._current_message_len = self.read_int32()

            self._current_message_len_unread = self._current_message_len - 4

        if self._length < self._current_message_len_unread:
            return 0

        self._current_message_ready = 1
        return 1

    cdef inline int32_t take_message_type(self, char mtype) except -1:
        cdef const char *buf0

        if self._current_message_ready:
            return self._current_message_type == mtype
        elif self._length >= 1:
            self._ensure_first_buf()
            buf0 = cpython.PyBytes_AS_STRING(self._buf0)

            return buf0[self._pos0] == mtype and self.take_message()
        else:
            return 0

    cdef int32_t put_message(self) except -1:
        if not self._current_message_ready:
            raise BufferError(
                'cannot put message: no message taken')
        self._current_message_ready = False
        return 0

    cdef inline const char* try_consume_message(self, ssize_t* len):
        cdef:
            ssize_t buf_len
            const char *buf

        if not self._current_message_ready:
            return NULL

        self._ensure_first_buf()
        buf_len = self._current_message_len_unread
        buf = self._try_read_bytes(buf_len)
        if buf != NULL:
            len[0] = buf_len
            self._finish_message()
        return buf

    cdef discard_message(self):
        if not self._current_message_ready:
            raise BufferError('no message to discard')
        if self._current_message_len_unread > 0:
            self._read_and_discard(self._current_message_len_unread)
            self._current_message_len_unread = 0
        self._finish_message()

    cdef bytes consume_message(self):
        if not self._current_message_ready:
            raise BufferError('no message to consume')
        if self._current_message_len_unread > 0:
            mem = self.read_bytes(self._current_message_len_unread)
        else:
            mem = b''
        self._finish_message()
        return mem

    cdef redirect_messages(self, WriteBuffer buf, char mtype,
                           int stop_at=0):
        if not self._current_message_ready:
            raise BufferError(
                'consume_full_messages called on a buffer without a '
                'complete first message')
        if mtype != self._current_message_type:
            raise BufferError(
                'consume_full_messages called with a wrong mtype')
        if self._current_message_len_unread != self._current_message_len - 4:
            raise BufferError(
                'consume_full_messages called on a partially read message')

        cdef:
            const char* cbuf
            ssize_t cbuf_len
            int32_t msg_len
            ssize_t new_pos0
            ssize_t pos_delta
            int32_t done

        while True:
            buf.write_byte(mtype)
            buf.write_int32(self._current_message_len)

            cbuf = self.try_consume_message(&cbuf_len)
            if cbuf != NULL:
                buf.write_cstr(cbuf, cbuf_len)
            else:
                buf.write_bytes(self.consume_message())

            if self._length > 0:
                self._ensure_first_buf()
            else:
                return

            if stop_at and buf._length >= stop_at:
                return

           # Fast path: exhaust buf0 as efficiently as possible.
            if self._pos0 + 5 <= self._len0:
                cbuf = cpython.PyBytes_AS_STRING(self._buf0)
                new_pos0 = self._pos0
                cbuf_len = self._len0

                done = 0
                # Scan the first buffer and find the position of the
                # end of the last "mtype" message.
                while new_pos0 + 5 <= cbuf_len:
                    if (cbuf + new_pos0)[0] != mtype:
                        done = 1
                        break
                    if (stop_at and
                            (buf._length + new_pos0 - self._pos0) > stop_at):
                        done = 1
                        break
                    msg_len = hton.unpack_int32(cbuf + new_pos0 + 1) + 1
                    if new_pos0 + msg_len > cbuf_len:
                        break
                    new_pos0 += msg_len

                if new_pos0 != self._pos0:
                    assert self._pos0 < new_pos0 <= self._len0

                    pos_delta = new_pos0 - self._pos0
                    buf.write_cstr(
                        cbuf + self._pos0,
                        pos_delta)

                    self._pos0 = new_pos0
                    self._length -= pos_delta

                    assert self._length >= 0

                if done:
                    # The next message is of a different type.
                    return

            # Back to slow path.
            if not self.take_message_type(mtype):
                return

    cdef bytearray consume_messages(self, char mtype):
        """Consume consecutive messages of the same type."""
        cdef:
            char *buf
            ssize_t nbytes
            ssize_t total_bytes = 0
            bytearray result

        if not self.take_message_type(mtype):
            return None

        # consume_messages is a volume-oriented method, so
        # we assume that the remainder of the buffer will contain
        # messages of the requested type.
        result = cpythonx.PyByteArray_FromStringAndSize(NULL, self._length)
        buf = cpythonx.PyByteArray_AsString(result)

        while self.take_message_type(mtype):
            self._ensure_first_buf()
            nbytes = self._current_message_len_unread
            self._read_into(buf, nbytes)
            buf += nbytes
            total_bytes += nbytes
            self._finish_message()

        # Clamp the result to an actual size read.
        cpythonx.PyByteArray_Resize(result, total_bytes)

        return result

    cdef finish_message(self):
        if self._current_message_type == 0 or not self._current_message_ready:
            # The message has already been finished (e.g by consume_message()),
            # or has been put back by put_message().
            return

        if self._current_message_len_unread:
            if PG_DEBUG:
                mtype = chr(self._current_message_type)

            discarded = self.consume_message()

            if PG_DEBUG:
                print('!!! discarding message {!r} unread data: {!r}'.format(
                    mtype,
                    discarded))

        self._finish_message()

    cdef inline _finish_message(self):
        self._current_message_type = 0
        self._current_message_len = 0
        self._current_message_ready = 0
        self._current_message_len_unread = 0

    @staticmethod
    cdef ReadBuffer new_message_parser(object data):
        cdef ReadBuffer buf

        buf = ReadBuffer.__new__(ReadBuffer)
        buf.feed_data(data)

        buf._current_message_ready = 1
        buf._current_message_len_unread = buf._len0

        return buf
