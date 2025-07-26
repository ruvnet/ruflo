# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


# cython: language_level=3

cimport cython
cimport cpython

import asyncio
import builtins
import codecs
import collections.abc
import socket
import time
import weakref

from asyncpg.pgproto.pgproto cimport (
    WriteBuffer,
    ReadBuffer,

    FRBuffer,
    frb_init,
    frb_read,
    frb_read_all,
    frb_slice_from,
    frb_check,
    frb_set_len,
    frb_get_len,
)

from asyncpg.pgproto cimport pgproto
from asyncpg.protocol cimport cpythonx
from asyncpg.protocol cimport record

from libc.stdint cimport int8_t, uint8_t, int16_t, uint16_t, \
                         int32_t, uint32_t, int64_t, uint64_t, \
                         INT32_MAX, UINT32_MAX

from asyncpg.exceptions import _base as apg_exc_base
from asyncpg import compat
from asyncpg import types as apg_types
from asyncpg import exceptions as apg_exc

from asyncpg.pgproto cimport hton


include "consts.pxi"
include "pgtypes.pxi"

include "encodings.pyx"
include "settings.pyx"

include "codecs/base.pyx"
include "codecs/textutils.pyx"

# register codecs provided by pgproto
include "codecs/pgproto.pyx"

# nonscalar
include "codecs/array.pyx"
include "codecs/range.pyx"
include "codecs/record.pyx"

include "coreproto.pyx"
include "prepared_stmt.pyx"


NO_TIMEOUT = object()


cdef class BaseProtocol(CoreProtocol):
    def __init__(self, addr, connected_fut, con_params, record_class: type, loop):
        # type of `con_params` is `_ConnectionParameters`
        CoreProtocol.__init__(self, con_params)

        self.loop = loop
        self.transport = None
        self.waiter = connected_fut
        self.cancel_waiter = None
        self.cancel_sent_waiter = None

        self.address = addr
        self.settings = ConnectionSettings((self.address, con_params.database))
        self.record_class = record_class

        self.statement = None
        self.return_extra = False

        self.last_query = None

        self.closing = False
        self.is_reading = True
        self.writing_allowed = asyncio.Event()
        self.writing_allowed.set()

        self.timeout_handle = None

        self.queries_count = 0

        self._is_ssl = False

        try:
            self.create_future = loop.create_future
        except AttributeError:
            self.create_future = self._create_future_fallback

    def set_connection(self, connection):
        self.conref = weakref.ref(connection)

    cdef get_connection(self):
        if self.conref is not None:
            return self.conref()
        else:
            return None

    def get_server_pid(self):
        return self.backend_pid

    def get_settings(self):
        return self.settings

    def get_record_class(self):
        return self.record_class

    cdef inline resume_reading(self):
        if not self.is_reading:
            self.is_reading = True
            self.transport.resume_reading()

    cdef inline pause_reading(self):
        if self.is_reading:
            self.is_reading = False
            self.transport.pause_reading()

    @cython.iterable_coroutine
    async def prepare(self, stmt_name, query, timeout,
                      *,
                      PreparedStatementState state=None,
                      ignore_custom_codec=False,
                      record_class):
        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()
        timeout = self._get_timeout_impl(timeout)

        waiter = self._new_waiter(timeout)
        try:
            self._prepare_and_describe(stmt_name, query)  # network op
            self.last_query = query
            if state is None:
                state = PreparedStatementState(
                    stmt_name, query, self, record_class, ignore_custom_codec)
            self.statement = state
        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    @cython.iterable_coroutine
    async def bind_execute(
        self,
        state: PreparedStatementState,
        args,
        portal_name: str,
        limit: int,
        return_extra: bool,
        timeout,
    ):
        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()
        timeout = self._get_timeout_impl(timeout)
        args_buf = state._encode_bind_msg(args)

        waiter = self._new_waiter(timeout)
        try:
            if not state.prepared:
                self._send_parse_message(state.name, state.query)

            self._bind_execute(
                portal_name,
                state.name,
                args_buf,
                limit)  # network op

            self.last_query = state.query
            self.statement = state
            self.return_extra = return_extra
            self.queries_count += 1
        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    @cython.iterable_coroutine
    async def bind_execute_many(
        self,
        state: PreparedStatementState,
        args,
        portal_name: str,
        timeout,
    ):
        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()
        timeout = self._get_timeout_impl(timeout)
        timer = Timer(timeout)

        # Make sure the argument sequence is encoded lazily with
        # this generator expression to keep the memory pressure under
        # control.
        data_gen = (state._encode_bind_msg(b, i) for i, b in enumerate(args))
        arg_bufs = iter(data_gen)

        waiter = self._new_waiter(timeout)
        try:
            if not state.prepared:
                self._send_parse_message(state.name, state.query)

            more = self._bind_execute_many(
                portal_name,
                state.name,
                arg_bufs)  # network op

            self.last_query = state.query
            self.statement = state
            self.return_extra = False
            self.queries_count += 1

            while more:
                with timer:
                    await compat.wait_for(
                        self.writing_allowed.wait(),
                        timeout=timer.get_remaining_budget())
                    # On Windows the above event somehow won't allow context
                    # switch, so forcing one with sleep(0) here
                    await asyncio.sleep(0)
                if not timer.has_budget_greater_than(0):
                    raise asyncio.TimeoutError
                more = self._bind_execute_many_more()  # network op

        except asyncio.TimeoutError as e:
            self._bind_execute_many_fail(e)  # network op

        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    @cython.iterable_coroutine
    async def bind(self, PreparedStatementState state, args,
                   str portal_name, timeout):

        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()
        timeout = self._get_timeout_impl(timeout)
        args_buf = state._encode_bind_msg(args)

        waiter = self._new_waiter(timeout)
        try:
            self._bind(
                portal_name,
                state.name,
                args_buf)  # network op

            self.last_query = state.query
            self.statement = state
        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    @cython.iterable_coroutine
    async def execute(self, PreparedStatementState state,
                      str portal_name, int limit, return_extra,
                      timeout):

        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()
        timeout = self._get_timeout_impl(timeout)

        waiter = self._new_waiter(timeout)
        try:
            self._execute(
                portal_name,
                limit)  # network op

            self.last_query = state.query
            self.statement = state
            self.return_extra = return_extra
            self.queries_count += 1
        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    @cython.iterable_coroutine
    async def close_portal(self, str portal_name, timeout):

        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()
        timeout = self._get_timeout_impl(timeout)

        waiter = self._new_waiter(timeout)
        try:
            self._close(
                portal_name,
                True)  # network op
        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    @cython.iterable_coroutine
    async def query(self, query, timeout):
        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()
        # query() needs to call _get_timeout instead of _get_timeout_impl
        # for consistent validation, as it is called differently from
        # prepare/bind/execute methods.
        timeout = self._get_timeout(timeout)

        waiter = self._new_waiter(timeout)
        try:
            self._simple_query(query)  # network op
            self.last_query = query
            self.queries_count += 1
        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    @cython.iterable_coroutine
    async def copy_out(self, copy_stmt, sink, timeout):
        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()

        timeout = self._get_timeout_impl(timeout)
        timer = Timer(timeout)

        # The copy operation is guarded by a single timeout
        # on the top level.
        waiter = self._new_waiter(timer.get_remaining_budget())

        self._copy_out(copy_stmt)

        try:
            while True:
                self.resume_reading()

                with timer:
                    buffer, done, status_msg = await waiter

                # buffer will be empty if CopyDone was received apart from
                # the last CopyData message.
                if buffer:
                    try:
                        with timer:
                            await compat.wait_for(
                                sink(buffer),
                                timeout=timer.get_remaining_budget())
                    except (Exception, asyncio.CancelledError) as ex:
                        # Abort the COPY operation on any error in
                        # output sink.
                        self._request_cancel()
                        # Make asyncio shut up about unretrieved
                        # QueryCanceledError
                        waiter.add_done_callback(lambda f: f.exception())
                        raise

                # done will be True upon receipt of CopyDone.
                if done:
                    break

                waiter = self._new_waiter(timer.get_remaining_budget())

        finally:
            self.resume_reading()

        return status_msg

    @cython.iterable_coroutine
    async def copy_in(self, copy_stmt, reader, data,
                      records, PreparedStatementState record_stmt, timeout):
        cdef:
            WriteBuffer wbuf
            ssize_t num_cols
            Codec codec

        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()

        timeout = self._get_timeout_impl(timeout)
        timer = Timer(timeout)

        waiter = self._new_waiter(timer.get_remaining_budget())

        # Initiate COPY IN.
        self._copy_in(copy_stmt)

        try:
            if record_stmt is not None:
                # copy_in_records in binary mode
                wbuf = WriteBuffer.new()
                # Signature
                wbuf.write_bytes(_COPY_SIGNATURE)
                # Flags field
                wbuf.write_int32(0)
                # No header extension
                wbuf.write_int32(0)

                record_stmt._ensure_rows_decoder()
                codecs = record_stmt.rows_codecs
                num_cols = len(codecs)
                settings = self.settings

                for codec in codecs:
                    if (not codec.has_encoder() or
                            codec.format != PG_FORMAT_BINARY):
                        raise apg_exc.InternalClientError(
                            'no binary format encoder for '
                            'type {} (OID {})'.format(codec.name, codec.oid))

                if isinstance(records, collections.abc.AsyncIterable):
                    async for row in records:
                        # Tuple header
                        wbuf.write_int16(<int16_t>num_cols)
                        # Tuple data
                        for i in range(num_cols):
                            item = row[i]
                            if item is None:
                                wbuf.write_int32(-1)
                            else:
                                codec = <Codec>cpython.PyTuple_GET_ITEM(
                                    codecs, i)
                                codec.encode(settings, wbuf, item)

                        if wbuf.len() >= _COPY_BUFFER_SIZE:
                            with timer:
                                await self.writing_allowed.wait()
                            self._write_copy_data_msg(wbuf)
                            wbuf = WriteBuffer.new()
                else:
                    for row in records:
                        # Tuple header
                        wbuf.write_int16(<int16_t>num_cols)
                        # Tuple data
                        for i in range(num_cols):
                            item = row[i]
                            if item is None:
                                wbuf.write_int32(-1)
                            else:
                                codec = <Codec>cpython.PyTuple_GET_ITEM(
                                    codecs, i)
                                codec.encode(settings, wbuf, item)

                        if wbuf.len() >= _COPY_BUFFER_SIZE:
                            with timer:
                                await self.writing_allowed.wait()
                            self._write_copy_data_msg(wbuf)
                            wbuf = WriteBuffer.new()

                # End of binary copy.
                wbuf.write_int16(-1)
                self._write_copy_data_msg(wbuf)

            elif reader is not None:
                try:
                    aiter = reader.__aiter__
                except AttributeError:
                    raise TypeError('reader is not an asynchronous iterable')
                else:
                    iterator = aiter()

                try:
                    while True:
                        # We rely on protocol flow control to moderate the
                        # rate of data messages.
                        with timer:
                            await self.writing_allowed.wait()
                        with timer:
                            chunk = await compat.wait_for(
                                iterator.__anext__(),
                                timeout=timer.get_remaining_budget())
                        self._write_copy_data_msg(chunk)
                except builtins.StopAsyncIteration:
                    pass
            else:
                # Buffer passed in directly.
                await self.writing_allowed.wait()
                self._write_copy_data_msg(data)

        except asyncio.TimeoutError:
            self._write_copy_fail_msg('TimeoutError')
            self._on_timeout(self.waiter)
            try:
                await waiter
            except TimeoutError:
                raise
            else:
                raise apg_exc.InternalClientError('TimoutError was not raised')

        except (Exception, asyncio.CancelledError) as e:
            self._write_copy_fail_msg(str(e))
            self._request_cancel()
            # Make asyncio shut up about unretrieved QueryCanceledError
            waiter.add_done_callback(lambda f: f.exception())
            raise

        self._write_copy_done_msg()

        status_msg = await waiter

        return status_msg

    @cython.iterable_coroutine
    async def close_statement(self, PreparedStatementState state, timeout):
        if self.cancel_waiter is not None:
            await self.cancel_waiter
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        self._check_state()

        if state.refs != 0:
            raise apg_exc.InternalClientError(
                'cannot close prepared statement; refs == {} != 0'.format(
                    state.refs))

        timeout = self._get_timeout_impl(timeout)
        waiter = self._new_waiter(timeout)
        try:
            self._close(state.name, False)  # network op
            state.closed = True
        except Exception as ex:
            waiter.set_exception(ex)
            self._coreproto_error()
        finally:
            return await waiter

    def is_closed(self):
        return self.closing

    def is_connected(self):
        return not self.closing and self.con_status == CONNECTION_OK

    def abort(self):
        if self.closing:
            return
        self.closing = True
        self._handle_waiter_on_connection_lost(None)
        self._terminate()
        self.transport.abort()
        self.transport = None

    @cython.iterable_coroutine
    async def close(self, timeout):
        if self.closing:
            return

        self.closing = True

        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None

        if self.cancel_waiter is not None:
            await self.cancel_waiter

        if self.waiter is not None:
            # If there is a query running, cancel it
            self._request_cancel()
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None
            if self.cancel_waiter is not None:
                await self.cancel_waiter

        assert self.waiter is None

        timeout = self._get_timeout_impl(timeout)

        # Ask the server to terminate the connection and wait for it
        # to drop.
        self.waiter = self._new_waiter(timeout)
        self._terminate()
        try:
            await self.waiter
        except ConnectionResetError:
            # There appears to be a difference in behaviour of asyncio
            # in Windows, where, instead of calling protocol.connection_lost()
            # a ConnectionResetError will be thrown into the task.
            pass
        finally:
            self.waiter = None
            self.transport.abort()

    def _request_cancel(self):
        self.cancel_waiter = self.create_future()
        self.cancel_sent_waiter = self.create_future()

        con = self.get_connection()
        if con is not None:
            # if 'con' is None it means that the connection object has been
            # garbage collected and that the transport will soon be aborted.
            con._cancel_current_command(self.cancel_sent_waiter)
        else:
            self.loop.call_exception_handler({
                'message': 'asyncpg.Protocol has no reference to its '
                           'Connection object and yet a cancellation '
                           'was requested. Please report this at '
                           'github.com/magicstack/asyncpg.'
            })
            self.abort()

        if self.state == PROTOCOL_PREPARE:
            # we need to send a SYNC to server if we cancel during the PREPARE phase
            # because the PREPARE sequence does not send a SYNC itself.
            # we cannot send this extra SYNC if we are not in PREPARE phase,
            # because then we would issue two SYNCs and we would get two ReadyForQuery
            # replies, which our current state machine implementation cannot handle
            self._write(SYNC_MESSAGE)
        self._set_state(PROTOCOL_CANCELLED)

    def _on_timeout(self, fut):
        if self.waiter is not fut or fut.done() or \
                self.cancel_waiter is not None or \
                self.timeout_handle is None:
            return
        self._request_cancel()
        self.waiter.set_exception(asyncio.TimeoutError())

    def _on_waiter_completed(self, fut):
        if self.timeout_handle:
            self.timeout_handle.cancel()
            self.timeout_handle = None
        if fut is not self.waiter or self.cancel_waiter is not None:
            return
        if fut.cancelled():
            self._request_cancel()

    def _create_future_fallback(self):
        return asyncio.Future(loop=self.loop)

    cdef _handle_waiter_on_connection_lost(self, cause):
        if self.waiter is not None and not self.waiter.done():
            exc = apg_exc.ConnectionDoesNotExistError(
                'connection was closed in the middle of '
                'operation')
            if cause is not None:
                exc.__cause__ = cause
            self.waiter.set_exception(exc)
        self.waiter = None

    cdef _set_server_parameter(self, name, val):
        self.settings.add_setting(name, val)

    def _get_timeout(self, timeout):
        if timeout is not None:
            try:
                if type(timeout) is bool:
                    raise ValueError
                timeout = float(timeout)
            except ValueError:
                raise ValueError(
                    'invalid timeout value: expected non-negative float '
                    '(got {!r})'.format(timeout)) from None

        return self._get_timeout_impl(timeout)

    cdef inline _get_timeout_impl(self, timeout):
        if timeout is None:
            timeout = self.get_connection()._config.command_timeout
        elif timeout is NO_TIMEOUT:
            timeout = None
        else:
            timeout = float(timeout)

        if timeout is not None and timeout <= 0:
            raise asyncio.TimeoutError()
        return timeout

    cdef _check_state(self):
        if self.cancel_waiter is not None:
            raise apg_exc.InterfaceError(
                'cannot perform operation: another operation is cancelling')
        if self.closing:
            raise apg_exc.InterfaceError(
                'cannot perform operation: connection is closed')
        if self.waiter is not None or self.timeout_handle is not None:
            raise apg_exc.InterfaceError(
                'cannot perform operation: another operation is in progress')

    def _is_cancelling(self):
        return (
            self.cancel_waiter is not None or
            self.cancel_sent_waiter is not None
        )

    @cython.iterable_coroutine
    async def _wait_for_cancellation(self):
        if self.cancel_sent_waiter is not None:
            await self.cancel_sent_waiter
            self.cancel_sent_waiter = None
        if self.cancel_waiter is not None:
            await self.cancel_waiter

    cdef _coreproto_error(self):
        try:
            if self.waiter is not None:
                if not self.waiter.done():
                    raise apg_exc.InternalClientError(
                        'waiter is not done while handling critical '
                        'protocol error')
                self.waiter = None
        finally:
            self.abort()

    cdef _new_waiter(self, timeout):
        if self.waiter is not None:
            raise apg_exc.InterfaceError(
                'cannot perform operation: another operation is in progress')
        self.waiter = self.create_future()
        if timeout is not None:
            self.timeout_handle = self.loop.call_later(
                timeout, self._on_timeout, self.waiter)
        self.waiter.add_done_callback(self._on_waiter_completed)
        return self.waiter

    cdef _on_result__connect(self, object waiter):
        waiter.set_result(True)

    cdef _on_result__prepare(self, object waiter):
        if PG_DEBUG:
            if self.statement is None:
                raise apg_exc.InternalClientError(
                    '_on_result__prepare: statement is None')

        if self.result_param_desc is not None:
            self.statement._set_args_desc(self.result_param_desc)
        if self.result_row_desc is not None:
            self.statement._set_row_desc(self.result_row_desc)
        waiter.set_result(self.statement)

    cdef _on_result__bind_and_exec(self, object waiter):
        if self.return_extra:
            waiter.set_result((
                self.result,
                self.result_status_msg,
                self.result_execute_completed))
        else:
            waiter.set_result(self.result)

    cdef _on_result__bind(self, object waiter):
        waiter.set_result(self.result)

    cdef _on_result__close_stmt_or_portal(self, object waiter):
        waiter.set_result(self.result)

    cdef _on_result__simple_query(self, object waiter):
        waiter.set_result(self.result_status_msg.decode(self.encoding))

    cdef _on_result__copy_out(self, object waiter):
        cdef bint copy_done = self.state == PROTOCOL_COPY_OUT_DONE
        if copy_done:
            status_msg = self.result_status_msg.decode(self.encoding)
        else:
            status_msg = None

        # We need to put some backpressure on Postgres
        # here in case the sink is slow to process the output.
        self.pause_reading()

        waiter.set_result((self.result, copy_done, status_msg))

    cdef _on_result__copy_in(self, object waiter):
        status_msg = self.result_status_msg.decode(self.encoding)
        waiter.set_result(status_msg)

    cdef _decode_row(self, const char* buf, ssize_t buf_len):
        if PG_DEBUG:
            if self.statement is None:
                raise apg_exc.InternalClientError(
                    '_decode_row: statement is None')

        return self.statement._decode_row(buf, buf_len)

    cdef _dispatch_result(self):
        waiter = self.waiter
        self.waiter = None

        if PG_DEBUG:
            if waiter is None:
                raise apg_exc.InternalClientError('_on_result: waiter is None')

        if waiter.cancelled():
            return

        if waiter.done():
            raise apg_exc.InternalClientError('_on_result: waiter is done')

        if self.result_type == RESULT_FAILED:
            if isinstance(self.result, dict):
                exc = apg_exc_base.PostgresError.new(
                    self.result, query=self.last_query)
            else:
                exc = self.result
            waiter.set_exception(exc)
            return

        try:
            if self.state == PROTOCOL_AUTH:
                self._on_result__connect(waiter)

            elif self.state == PROTOCOL_PREPARE:
                self._on_result__prepare(waiter)

            elif self.state == PROTOCOL_BIND_EXECUTE:
                self._on_result__bind_and_exec(waiter)

            elif self.state == PROTOCOL_BIND_EXECUTE_MANY:
                self._on_result__bind_and_exec(waiter)

            elif self.state == PROTOCOL_EXECUTE:
                self._on_result__bind_and_exec(waiter)

            elif self.state == PROTOCOL_BIND:
                self._on_result__bind(waiter)

            elif self.state == PROTOCOL_CLOSE_STMT_PORTAL:
                self._on_result__close_stmt_or_portal(waiter)

            elif self.state == PROTOCOL_SIMPLE_QUERY:
                self._on_result__simple_query(waiter)

            elif (self.state == PROTOCOL_COPY_OUT_DATA or
                    self.state == PROTOCOL_COPY_OUT_DONE):
                self._on_result__copy_out(waiter)

            elif self.state == PROTOCOL_COPY_IN_DATA:
                self._on_result__copy_in(waiter)

            elif self.state == PROTOCOL_TERMINATING:
                # We are waiting for the connection to drop, so
                # ignore any stray results at this point.
                pass

            else:
                raise apg_exc.InternalClientError(
                    'got result for unknown protocol state {}'.
                    format(self.state))

        except Exception as exc:
            waiter.set_exception(exc)

    cdef _on_result(self):
        if self.timeout_handle is not None:
            self.timeout_handle.cancel()
            self.timeout_handle = None

        if self.cancel_waiter is not None:
            # We have received the result of a cancelled command.
            if not self.cancel_waiter.done():
                # The cancellation future might have been cancelled
                # by the cancellation of the entire task running the query.
                self.cancel_waiter.set_result(None)
            self.cancel_waiter = None
            if self.waiter is not None and self.waiter.done():
                self.waiter = None
            if self.waiter is None:
                return

        try:
            self._dispatch_result()
        finally:
            self.statement = None
            self.last_query = None
            self.return_extra = False

    cdef _on_notice(self, parsed):
        con = self.get_connection()
        if con is not None:
            con._process_log_message(parsed, self.last_query)

    cdef _on_notification(self, pid, channel, payload):
        con = self.get_connection()
        if con is not None:
            con._process_notification(pid, channel, payload)

    cdef _on_connection_lost(self, exc):
        if self.closing:
            # The connection was lost because
            # Protocol.close() was called
            if self.waiter is not None and not self.waiter.done():
                if exc is None:
                    self.waiter.set_result(None)
                else:
                    self.waiter.set_exception(exc)
            self.waiter = None
        else:
            # The connection was lost because it was
            # terminated or due to another error;
            # Throw an error in any awaiting waiter.
            self.closing = True
            # Cleanup the connection resources, including, possibly,
            # releasing the pool holder.
            con = self.get_connection()
            if con is not None:
                con._cleanup()
            self._handle_waiter_on_connection_lost(exc)

    cdef _write(self, buf):
        self.transport.write(memoryview(buf))

    cdef _writelines(self, list buffers):
        self.transport.writelines(buffers)

    # asyncio callbacks:

    def data_received(self, data):
        self.buffer.feed_data(data)
        self._read_server_messages()

    def connection_made(self, transport):
        self.transport = transport

        sock = transport.get_extra_info('socket')
        if (sock is not None and
              (not hasattr(socket, 'AF_UNIX')
               or sock.family != socket.AF_UNIX)):
            sock.setsockopt(socket.IPPROTO_TCP,
                            socket.TCP_NODELAY, 1)

        try:
            self._connect()
        except Exception as ex:
            transport.abort()
            self.con_status = CONNECTION_BAD
            self._set_state(PROTOCOL_FAILED)
            self._on_error(ex)

    def connection_lost(self, exc):
        self.con_status = CONNECTION_BAD
        self._set_state(PROTOCOL_FAILED)
        self._on_connection_lost(exc)

    def pause_writing(self):
        self.writing_allowed.clear()

    def resume_writing(self):
        self.writing_allowed.set()

    @property
    def is_ssl(self):
        return self._is_ssl

    @is_ssl.setter
    def is_ssl(self, value):
        self._is_ssl = value


class Timer:
    def __init__(self, budget):
        self._budget = budget
        self._started = 0

    def __enter__(self):
        if self._budget is not None:
            self._started = time.monotonic()

    def __exit__(self, et, e, tb):
        if self._budget is not None:
            self._budget -= time.monotonic() - self._started

    def get_remaining_budget(self):
        return self._budget

    def has_budget_greater_than(self, amount):
        if self._budget is None:
            # Unlimited budget.
            return True
        else:
            return self._budget > amount


class Protocol(BaseProtocol, asyncio.Protocol):
    pass


def _create_record(object mapping, tuple elems):
    # Exposed only for testing purposes.

    cdef:
        object rec
        int32_t i

    if mapping is None:
        desc = record.ApgRecordDesc_New({}, ())
    else:
        desc = record.ApgRecordDesc_New(
            mapping, tuple(mapping) if mapping else ())

    rec = record.ApgRecord_New(Record, desc, len(elems))
    for i in range(len(elems)):
        elem = elems[i]
        cpython.Py_INCREF(elem)
        record.ApgRecord_SET_ITEM(rec, i, elem)
    return rec


Record = <object>record.ApgRecord_InitTypes()
