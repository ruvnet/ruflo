# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef class WriteBuffer:
    cdef:
        # Preallocated small buffer
        bint _smallbuf_inuse
        char _smallbuf[_BUFFER_INITIAL_SIZE]

        char *_buf

        # Allocated size
        ssize_t _size

        # Length of data in the buffer
        ssize_t _length

        # Number of memoryviews attached to the buffer
        int _view_count

        # True is start_message was used
        bint _message_mode

    cdef inline len(self):
        return self._length

    cdef inline write_len_prefixed_utf8(self, str s):
        return self.write_len_prefixed_bytes(s.encode('utf-8'))

    cdef inline _check_readonly(self)
    cdef inline _ensure_alloced(self, ssize_t extra_length)
    cdef _reallocate(self, ssize_t new_size)
    cdef inline reset(self)
    cdef inline start_message(self, char type)
    cdef inline end_message(self)
    cdef write_buffer(self, WriteBuffer buf)
    cdef write_byte(self, char b)
    cdef write_bytes(self, bytes data)
    cdef write_len_prefixed_buffer(self, WriteBuffer buf)
    cdef write_len_prefixed_bytes(self, bytes data)
    cdef write_bytestring(self, bytes string)
    cdef write_str(self, str string, str encoding)
    cdef write_frbuf(self, FRBuffer *buf)
    cdef write_cstr(self, const char *data, ssize_t len)
    cdef write_int16(self, int16_t i)
    cdef write_int32(self, int32_t i)
    cdef write_int64(self, int64_t i)
    cdef write_float(self, float f)
    cdef write_double(self, double d)

    @staticmethod
    cdef WriteBuffer new_message(char type)

    @staticmethod
    cdef WriteBuffer new()


ctypedef const char * (*try_consume_message_method)(object, ssize_t*)
ctypedef int32_t (*take_message_type_method)(object, char) except -1
ctypedef int32_t (*take_message_method)(object) except -1
ctypedef char (*get_message_type_method)(object)


cdef class ReadBuffer:
    cdef:
        # A deque of buffers (bytes objects)
        object _bufs
        object _bufs_append
        object _bufs_popleft

        # A pointer to the first buffer in `_bufs`
        bytes _buf0

        # A pointer to the previous first buffer
        # (used to prolong the life of _buf0 when using
        # methods like _try_read_bytes)
        bytes _buf0_prev

        # Number of buffers in `_bufs`
        int32_t _bufs_len

        # A read position in the first buffer in `_bufs`
        ssize_t _pos0

        # Length of the first buffer in `_bufs`
        ssize_t _len0

        # A total number of buffered bytes in ReadBuffer
        ssize_t _length

        char _current_message_type
        int32_t _current_message_len
        ssize_t _current_message_len_unread
        bint _current_message_ready

    cdef inline len(self):
        return self._length

    cdef inline char get_message_type(self):
        return self._current_message_type

    cdef inline int32_t get_message_length(self):
        return self._current_message_len

    cdef feed_data(self, data)
    cdef inline _ensure_first_buf(self)
    cdef _switch_to_next_buf(self)
    cdef inline char read_byte(self) except? -1
    cdef inline const char* _try_read_bytes(self, ssize_t nbytes)
    cdef inline _read_into(self, char *buf, ssize_t nbytes)
    cdef inline _read_and_discard(self, ssize_t nbytes)
    cdef bytes read_bytes(self, ssize_t nbytes)
    cdef bytes read_len_prefixed_bytes(self)
    cdef str read_len_prefixed_utf8(self)
    cdef read_uuid(self)
    cdef inline int64_t read_int64(self) except? -1
    cdef inline int32_t read_int32(self) except? -1
    cdef inline int16_t read_int16(self) except? -1
    cdef inline read_null_str(self)
    cdef int32_t take_message(self) except -1
    cdef inline int32_t take_message_type(self, char mtype) except -1
    cdef int32_t put_message(self) except -1
    cdef inline const char* try_consume_message(self, ssize_t* len)
    cdef bytes consume_message(self)
    cdef discard_message(self)
    cdef redirect_messages(self, WriteBuffer buf, char mtype, int stop_at=?)
    cdef bytearray consume_messages(self, char mtype)
    cdef finish_message(self)
    cdef inline _finish_message(self)

    @staticmethod
    cdef ReadBuffer new_message_parser(object data)
