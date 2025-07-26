# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from libc.stdint cimport int16_t, int32_t, uint16_t, \
                         uint32_t, int64_t, uint64_t

from asyncpg.pgproto.debug cimport PG_DEBUG

from asyncpg.pgproto.pgproto cimport (
    WriteBuffer,
    ReadBuffer,
    FRBuffer,
)

from asyncpg.pgproto cimport pgproto

include "consts.pxi"
include "pgtypes.pxi"

include "codecs/base.pxd"
include "settings.pxd"
include "coreproto.pxd"
include "prepared_stmt.pxd"


cdef class BaseProtocol(CoreProtocol):

    cdef:
        object loop
        object address
        ConnectionSettings settings
        object cancel_sent_waiter
        object cancel_waiter
        object waiter
        bint return_extra
        object create_future
        object timeout_handle
        object conref
        type record_class
        bint is_reading

        str last_query

        bint writing_paused
        bint closing

        readonly uint64_t queries_count

        bint _is_ssl

        PreparedStatementState statement

    cdef get_connection(self)

    cdef _get_timeout_impl(self, timeout)
    cdef _check_state(self)
    cdef _new_waiter(self, timeout)
    cdef _coreproto_error(self)

    cdef _on_result__connect(self, object waiter)
    cdef _on_result__prepare(self, object waiter)
    cdef _on_result__bind_and_exec(self, object waiter)
    cdef _on_result__close_stmt_or_portal(self, object waiter)
    cdef _on_result__simple_query(self, object waiter)
    cdef _on_result__bind(self, object waiter)
    cdef _on_result__copy_out(self, object waiter)
    cdef _on_result__copy_in(self, object waiter)

    cdef _handle_waiter_on_connection_lost(self, cause)

    cdef _dispatch_result(self)

    cdef inline resume_reading(self)
    cdef inline pause_reading(self)
