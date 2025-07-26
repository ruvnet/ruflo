# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import hashlib


include "scram.pyx"


cdef class CoreProtocol:

    def __init__(self, con_params):
        # type of `con_params` is `_ConnectionParameters`
        self.buffer = ReadBuffer()
        self.user = con_params.user
        self.password = con_params.password
        self.auth_msg = None
        self.con_params = con_params
        self.con_status = CONNECTION_BAD
        self.state = PROTOCOL_IDLE
        self.xact_status = PQTRANS_IDLE
        self.encoding = 'utf-8'
        # type of `scram` is `SCRAMAuthentcation`
        self.scram = None

        self._reset_result()

    cpdef is_in_transaction(self):
        # PQTRANS_INTRANS = idle, within transaction block
        # PQTRANS_INERROR = idle, within failed transaction
        return self.xact_status in (PQTRANS_INTRANS, PQTRANS_INERROR)

    cdef _read_server_messages(self):
        cdef:
            char mtype
            ProtocolState state
            pgproto.take_message_method take_message = \
                <pgproto.take_message_method>self.buffer.take_message
            pgproto.get_message_type_method get_message_type= \
                <pgproto.get_message_type_method>self.buffer.get_message_type

        while take_message(self.buffer) == 1:
            mtype = get_message_type(self.buffer)
            state = self.state

            try:
                if mtype == b'S':
                    # ParameterStatus
                    self._parse_msg_parameter_status()

                elif mtype == b'A':
                    # NotificationResponse
                    self._parse_msg_notification()

                elif mtype == b'N':
                    # 'N' - NoticeResponse
                    self._on_notice(self._parse_msg_error_response(False))

                elif state == PROTOCOL_AUTH:
                    self._process__auth(mtype)

                elif state == PROTOCOL_PREPARE:
                    self._process__prepare(mtype)

                elif state == PROTOCOL_BIND_EXECUTE:
                    self._process__bind_execute(mtype)

                elif state == PROTOCOL_BIND_EXECUTE_MANY:
                    self._process__bind_execute_many(mtype)

                elif state == PROTOCOL_EXECUTE:
                    self._process__bind_execute(mtype)

                elif state == PROTOCOL_BIND:
                    self._process__bind(mtype)

                elif state == PROTOCOL_CLOSE_STMT_PORTAL:
                    self._process__close_stmt_portal(mtype)

                elif state == PROTOCOL_SIMPLE_QUERY:
                    self._process__simple_query(mtype)

                elif state == PROTOCOL_COPY_OUT:
                    self._process__copy_out(mtype)

                elif (state == PROTOCOL_COPY_OUT_DATA or
                        state == PROTOCOL_COPY_OUT_DONE):
                    self._process__copy_out_data(mtype)

                elif state == PROTOCOL_COPY_IN:
                    self._process__copy_in(mtype)

                elif state == PROTOCOL_COPY_IN_DATA:
                    self._process__copy_in_data(mtype)

                elif state == PROTOCOL_CANCELLED:
                    # discard all messages until the sync message
                    if mtype == b'E':
                        self._parse_msg_error_response(True)
                    elif mtype == b'Z':
                        self._parse_msg_ready_for_query()
                        self._push_result()
                    else:
                        self.buffer.discard_message()

                elif state == PROTOCOL_ERROR_CONSUME:
                    # Error in protocol (on asyncpg side);
                    # discard all messages until sync message

                    if mtype == b'Z':
                        # Sync point, self to push the result
                        if self.result_type != RESULT_FAILED:
                            self.result_type = RESULT_FAILED
                            self.result = apg_exc.InternalClientError(
                                'unknown error in protocol implementation')

                        self._parse_msg_ready_for_query()
                        self._push_result()

                    else:
                        self.buffer.discard_message()

                elif state == PROTOCOL_TERMINATING:
                    # The connection is being terminated.
                    # discard all messages until connection
                    # termination.
                    self.buffer.discard_message()

                else:
                    raise apg_exc.InternalClientError(
                        f'cannot process message {chr(mtype)!r}: '
                        f'protocol is in an unexpected state {state!r}.')

            except Exception as ex:
                self.result_type = RESULT_FAILED
                self.result = ex

                if mtype == b'Z':
                    self._push_result()
                else:
                    self.state = PROTOCOL_ERROR_CONSUME

            finally:
                self.buffer.finish_message()

    cdef _process__auth(self, char mtype):
        if mtype == b'R':
            # Authentication...
            try:
                self._parse_msg_authentication()
            except Exception as ex:
                # Exception in authentication parsing code
                # is usually either malformed authentication data
                # or missing support for cryptographic primitives
                # in the hashlib module.
                self.result_type = RESULT_FAILED
                self.result = apg_exc.InternalClientError(
                    f"unexpected error while performing authentication: {ex}")
                self.result.__cause__ = ex
                self.con_status = CONNECTION_BAD
                self._push_result()
            else:
                if self.result_type != RESULT_OK:
                    self.con_status = CONNECTION_BAD
                    self._push_result()

                elif self.auth_msg is not None:
                    # Server wants us to send auth data, so do that.
                    self._write(self.auth_msg)
                    self.auth_msg = None

        elif mtype == b'K':
            # BackendKeyData
            self._parse_msg_backend_key_data()

        elif mtype == b'E':
            # ErrorResponse
            self.con_status = CONNECTION_BAD
            self._parse_msg_error_response(True)
            self._push_result()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self.con_status = CONNECTION_OK
            self._push_result()

    cdef _process__prepare(self, char mtype):
        if mtype == b't':
            # Parameters description
            self.result_param_desc = self.buffer.consume_message()

        elif mtype == b'1':
            # ParseComplete
            self.buffer.discard_message()

        elif mtype == b'T':
            # Row description
            self.result_row_desc = self.buffer.consume_message()
            self._push_result()

        elif mtype == b'E':
            # ErrorResponse
            self._parse_msg_error_response(True)
            # we don't send a sync during the parse/describe sequence
            # but send a FLUSH instead. If an error happens we need to
            # send a SYNC explicitly in order to mark the end of the transaction.
            # this effectively clears the error and we then wait until we get a
            # ready for new query message
            self._write(SYNC_MESSAGE)
            self.state = PROTOCOL_ERROR_CONSUME

        elif mtype == b'n':
            # NoData
            self.buffer.discard_message()
            self._push_result()

    cdef _process__bind_execute(self, char mtype):
        if mtype == b'D':
            # DataRow
            self._parse_data_msgs()

        elif mtype == b's':
            # PortalSuspended
            self.buffer.discard_message()

        elif mtype == b'C':
            # CommandComplete
            self.result_execute_completed = True
            self._parse_msg_command_complete()

        elif mtype == b'E':
            # ErrorResponse
            self._parse_msg_error_response(True)

        elif mtype == b'1':
            # ParseComplete, in case `_bind_execute()` is reparsing
            self.buffer.discard_message()

        elif mtype == b'2':
            # BindComplete
            self.buffer.discard_message()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

        elif mtype == b'I':
            # EmptyQueryResponse
            self.buffer.discard_message()

    cdef _process__bind_execute_many(self, char mtype):
        cdef WriteBuffer buf

        if mtype == b'D':
            # DataRow
            self._parse_data_msgs()

        elif mtype == b's':
            # PortalSuspended
            self.buffer.discard_message()

        elif mtype == b'C':
            # CommandComplete
            self._parse_msg_command_complete()

        elif mtype == b'E':
            # ErrorResponse
            self._parse_msg_error_response(True)

        elif mtype == b'1':
            # ParseComplete, in case `_bind_execute_many()` is reparsing
            self.buffer.discard_message()

        elif mtype == b'2':
            # BindComplete
            self.buffer.discard_message()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

        elif mtype == b'I':
            # EmptyQueryResponse
            self.buffer.discard_message()

        elif mtype == b'1':
            # ParseComplete
            self.buffer.discard_message()

    cdef _process__bind(self, char mtype):
        if mtype == b'E':
            # ErrorResponse
            self._parse_msg_error_response(True)

        elif mtype == b'2':
            # BindComplete
            self.buffer.discard_message()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

    cdef _process__close_stmt_portal(self, char mtype):
        if mtype == b'E':
            # ErrorResponse
            self._parse_msg_error_response(True)

        elif mtype == b'3':
            # CloseComplete
            self.buffer.discard_message()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

    cdef _process__simple_query(self, char mtype):
        if mtype in {b'D', b'I', b'T'}:
            # 'D' - DataRow
            # 'I' - EmptyQueryResponse
            # 'T' - RowDescription
            self.buffer.discard_message()

        elif mtype == b'E':
            # ErrorResponse
            self._parse_msg_error_response(True)

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

        elif mtype == b'C':
            # CommandComplete
            self._parse_msg_command_complete()

        else:
            # We don't really care about COPY IN etc
            self.buffer.discard_message()

    cdef _process__copy_out(self, char mtype):
        if mtype == b'E':
            self._parse_msg_error_response(True)

        elif mtype == b'H':
            # CopyOutResponse
            self._set_state(PROTOCOL_COPY_OUT_DATA)
            self.buffer.discard_message()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

    cdef _process__copy_out_data(self, char mtype):
        if mtype == b'E':
            self._parse_msg_error_response(True)

        elif mtype == b'd':
            # CopyData
            self._parse_copy_data_msgs()

        elif mtype == b'c':
            # CopyDone
            self.buffer.discard_message()
            self._set_state(PROTOCOL_COPY_OUT_DONE)

        elif mtype == b'C':
            # CommandComplete
            self._parse_msg_command_complete()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

    cdef _process__copy_in(self, char mtype):
        if mtype == b'E':
            self._parse_msg_error_response(True)

        elif mtype == b'G':
            # CopyInResponse
            self._set_state(PROTOCOL_COPY_IN_DATA)
            self.buffer.discard_message()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

    cdef _process__copy_in_data(self, char mtype):
        if mtype == b'E':
            self._parse_msg_error_response(True)

        elif mtype == b'C':
            # CommandComplete
            self._parse_msg_command_complete()

        elif mtype == b'Z':
            # ReadyForQuery
            self._parse_msg_ready_for_query()
            self._push_result()

    cdef _parse_msg_command_complete(self):
        cdef:
            const char* cbuf
            ssize_t cbuf_len

        cbuf = self.buffer.try_consume_message(&cbuf_len)
        if cbuf != NULL and cbuf_len > 0:
            msg = cpython.PyBytes_FromStringAndSize(cbuf, cbuf_len - 1)
        else:
            msg = self.buffer.read_null_str()
        self.result_status_msg = msg

    cdef _parse_copy_data_msgs(self):
        cdef:
            ReadBuffer buf = self.buffer

        self.result = buf.consume_messages(b'd')

        # By this point we have consumed all CopyData messages
        # in the inbound buffer.  If there are no messages left
        # in the buffer, we need to push the accumulated data
        # out to the caller in anticipation of the new CopyData
        # batch.  If there _are_ non-CopyData messages left,
        # we must not push the result here and let the
        # _process__copy_out_data subprotocol do the job.
        if not buf.take_message():
            self._on_result()
            self.result = None
        else:
            # If there is a message in the buffer, put it back to
            # be processed by the next protocol iteration.
            buf.put_message()

    cdef _write_copy_data_msg(self, object data):
        cdef:
            WriteBuffer buf
            object mview
            Py_buffer *pybuf

        mview = cpythonx.PyMemoryView_GetContiguous(
            data, cpython.PyBUF_READ, b'C')

        try:
            pybuf = cpythonx.PyMemoryView_GET_BUFFER(mview)

            buf = WriteBuffer.new_message(b'd')
            buf.write_cstr(<const char *>pybuf.buf, pybuf.len)
            buf.end_message()
        finally:
            mview.release()

        self._write(buf)

    cdef _write_copy_done_msg(self):
        cdef:
            WriteBuffer buf

        buf = WriteBuffer.new_message(b'c')
        buf.end_message()
        self._write(buf)

    cdef _write_copy_fail_msg(self, str cause):
        cdef:
            WriteBuffer buf

        buf = WriteBuffer.new_message(b'f')
        buf.write_str(cause or '', self.encoding)
        buf.end_message()
        self._write(buf)

    cdef _parse_data_msgs(self):
        cdef:
            ReadBuffer buf = self.buffer
            list rows

            decode_row_method decoder = <decode_row_method>self._decode_row
            pgproto.try_consume_message_method try_consume_message = \
                <pgproto.try_consume_message_method>buf.try_consume_message
            pgproto.take_message_type_method take_message_type = \
                <pgproto.take_message_type_method>buf.take_message_type

            const char* cbuf
            ssize_t cbuf_len
            object row
            bytes mem

        if PG_DEBUG:
            if buf.get_message_type() != b'D':
                raise apg_exc.InternalClientError(
                    '_parse_data_msgs: first message is not "D"')

        if self._discard_data:
            while take_message_type(buf, b'D'):
                buf.discard_message()
            return

        if PG_DEBUG:
            if type(self.result) is not list:
                raise apg_exc.InternalClientError(
                    '_parse_data_msgs: result is not a list, but {!r}'.
                    format(self.result))

        rows = self.result
        while take_message_type(buf, b'D'):
            cbuf = try_consume_message(buf, &cbuf_len)
            if cbuf != NULL:
                row = decoder(self, cbuf, cbuf_len)
            else:
                mem = buf.consume_message()
                row = decoder(
                    self,
                    cpython.PyBytes_AS_STRING(mem),
                    cpython.PyBytes_GET_SIZE(mem))

            cpython.PyList_Append(rows, row)

    cdef _parse_msg_backend_key_data(self):
        self.backend_pid = self.buffer.read_int32()
        self.backend_secret = self.buffer.read_int32()

    cdef _parse_msg_parameter_status(self):
        name = self.buffer.read_null_str()
        name = name.decode(self.encoding)

        val = self.buffer.read_null_str()
        val = val.decode(self.encoding)

        self._set_server_parameter(name, val)

    cdef _parse_msg_notification(self):
        pid = self.buffer.read_int32()
        channel = self.buffer.read_null_str().decode(self.encoding)
        payload = self.buffer.read_null_str().decode(self.encoding)
        self._on_notification(pid, channel, payload)

    cdef _parse_msg_authentication(self):
        cdef:
            int32_t status
            bytes md5_salt
            list sasl_auth_methods
            list unsupported_sasl_auth_methods

        status = self.buffer.read_int32()

        if status == AUTH_SUCCESSFUL:
            # AuthenticationOk
            self.result_type = RESULT_OK

        elif status == AUTH_REQUIRED_PASSWORD:
            # AuthenticationCleartextPassword
            self.result_type = RESULT_OK
            self.auth_msg = self._auth_password_message_cleartext()

        elif status == AUTH_REQUIRED_PASSWORDMD5:
            # AuthenticationMD5Password
            # Note: MD5 salt is passed as a four-byte sequence
            md5_salt = self.buffer.read_bytes(4)
            self.auth_msg = self._auth_password_message_md5(md5_salt)

        elif status == AUTH_REQUIRED_SASL:
            # AuthenticationSASL
            # This requires making additional requests to the server in order
            # to follow the SCRAM protocol defined in RFC 5802.
            # get the SASL authentication methods that the server is providing
            sasl_auth_methods = []
            unsupported_sasl_auth_methods = []
            # determine if the advertised authentication methods are supported,
            # and if so, add them to the list
            auth_method = self.buffer.read_null_str()
            while auth_method:
                if auth_method in SCRAMAuthentication.AUTHENTICATION_METHODS:
                    sasl_auth_methods.append(auth_method)
                else:
                    unsupported_sasl_auth_methods.append(auth_method)
                auth_method = self.buffer.read_null_str()

            # if none of the advertised authentication methods are supported,
            # raise an error
            # otherwise, initialize the SASL authentication exchange
            if not sasl_auth_methods:
                unsupported_sasl_auth_methods = [m.decode("ascii")
                    for m in unsupported_sasl_auth_methods]
                self.result_type = RESULT_FAILED
                self.result = apg_exc.InterfaceError(
                    'unsupported SASL Authentication methods requested by the '
                    'server: {!r}'.format(
                        ", ".join(unsupported_sasl_auth_methods)))
            else:
                self.auth_msg = self._auth_password_message_sasl_initial(
                    sasl_auth_methods)

        elif status == AUTH_SASL_CONTINUE:
            # AUTH_SASL_CONTINUE
            # this requeires sending the second part of the SASL exchange, where
            # the client parses information back from the server and determines
            # if this is valid.
            # The client builds a challenge response to the server
            server_response = self.buffer.consume_message()
            self.auth_msg = self._auth_password_message_sasl_continue(
                server_response)

        elif status == AUTH_SASL_FINAL:
            # AUTH_SASL_FINAL
            server_response = self.buffer.consume_message()
            if not self.scram.verify_server_final_message(server_response):
                self.result_type = RESULT_FAILED
                self.result = apg_exc.InterfaceError(
                    'could not verify server signature for '
                    'SCRAM authentciation: scram-sha-256',
                )

        elif status in (AUTH_REQUIRED_KERBEROS, AUTH_REQUIRED_SCMCRED,
                        AUTH_REQUIRED_GSS, AUTH_REQUIRED_GSS_CONTINUE,
                        AUTH_REQUIRED_SSPI):
            self.result_type = RESULT_FAILED
            self.result = apg_exc.InterfaceError(
                'unsupported authentication method requested by the '
                'server: {!r}'.format(AUTH_METHOD_NAME[status]))

        else:
            self.result_type = RESULT_FAILED
            self.result = apg_exc.InterfaceError(
                'unsupported authentication method requested by the '
                'server: {}'.format(status))

        if status not in [AUTH_SASL_CONTINUE, AUTH_SASL_FINAL]:
            self.buffer.discard_message()

    cdef _auth_password_message_cleartext(self):
        cdef:
            WriteBuffer msg

        msg = WriteBuffer.new_message(b'p')
        msg.write_bytestring(self.password.encode(self.encoding))
        msg.end_message()

        return msg

    cdef _auth_password_message_md5(self, bytes salt):
        cdef:
            WriteBuffer msg

        msg = WriteBuffer.new_message(b'p')

        # 'md5' + md5(md5(password + username) + salt))
        userpass = (self.password or '') + (self.user or '')
        md5_1 = hashlib.md5(userpass.encode(self.encoding)).hexdigest()
        md5_2 = hashlib.md5(md5_1.encode('ascii') + salt).hexdigest()

        msg.write_bytestring(b'md5' + md5_2.encode('ascii'))
        msg.end_message()

        return msg

    cdef _auth_password_message_sasl_initial(self, list sasl_auth_methods):
        cdef:
            WriteBuffer msg

        # use the first supported advertized mechanism
        self.scram = SCRAMAuthentication(sasl_auth_methods[0])
        # this involves a call and response with the server
        msg = WriteBuffer.new_message(b'p')
        msg.write_bytes(self.scram.create_client_first_message(self.user or ''))
        msg.end_message()

        return msg

    cdef _auth_password_message_sasl_continue(self, bytes server_response):
        cdef:
            WriteBuffer msg

        # determine if there is a valid server response
        self.scram.parse_server_first_message(server_response)
        # this involves a call and response with the server
        msg = WriteBuffer.new_message(b'p')
        client_final_message = self.scram.create_client_final_message(
            self.password or '')
        msg.write_bytes(client_final_message)
        msg.end_message()

        return msg

    cdef _parse_msg_ready_for_query(self):
        cdef char status = self.buffer.read_byte()

        if status == b'I':
            self.xact_status = PQTRANS_IDLE
        elif status == b'T':
            self.xact_status = PQTRANS_INTRANS
        elif status == b'E':
            self.xact_status = PQTRANS_INERROR
        else:
            self.xact_status = PQTRANS_UNKNOWN

    cdef _parse_msg_error_response(self, is_error):
        cdef:
            char code
            bytes message
            dict parsed = {}

        while True:
            code = self.buffer.read_byte()
            if code == 0:
                break

            message = self.buffer.read_null_str()

            parsed[chr(code)] = message.decode()

        if is_error:
            self.result_type = RESULT_FAILED
            self.result = parsed
        else:
            return parsed

    cdef _push_result(self):
        try:
            self._on_result()
        finally:
            self._set_state(PROTOCOL_IDLE)
            self._reset_result()

    cdef _reset_result(self):
        self.result_type = RESULT_OK
        self.result = None
        self.result_param_desc = None
        self.result_row_desc = None
        self.result_status_msg = None
        self.result_execute_completed = False
        self._discard_data = False

        # executemany support data
        self._execute_iter = None
        self._execute_portal_name = None
        self._execute_stmt_name = None

    cdef _set_state(self, ProtocolState new_state):
        if new_state == PROTOCOL_IDLE:
            if self.state == PROTOCOL_FAILED:
                raise apg_exc.InternalClientError(
                    'cannot switch to "idle" state; '
                    'protocol is in the "failed" state')
            elif self.state == PROTOCOL_IDLE:
                pass
            else:
                self.state = new_state

        elif new_state == PROTOCOL_FAILED:
            self.state = PROTOCOL_FAILED

        elif new_state == PROTOCOL_CANCELLED:
            self.state = PROTOCOL_CANCELLED

        elif new_state == PROTOCOL_TERMINATING:
            self.state = PROTOCOL_TERMINATING

        else:
            if self.state == PROTOCOL_IDLE:
                self.state = new_state

            elif (self.state == PROTOCOL_COPY_OUT and
                    new_state == PROTOCOL_COPY_OUT_DATA):
                self.state = new_state

            elif (self.state == PROTOCOL_COPY_OUT_DATA and
                    new_state == PROTOCOL_COPY_OUT_DONE):
                self.state = new_state

            elif (self.state == PROTOCOL_COPY_IN and
                    new_state == PROTOCOL_COPY_IN_DATA):
                self.state = new_state

            elif self.state == PROTOCOL_FAILED:
                raise apg_exc.InternalClientError(
                    'cannot switch to state {}; '
                    'protocol is in the "failed" state'.format(new_state))
            else:
                raise apg_exc.InternalClientError(
                    'cannot switch to state {}; '
                    'another operation ({}) is in progress'.format(
                        new_state, self.state))

    cdef _ensure_connected(self):
        if self.con_status != CONNECTION_OK:
            raise apg_exc.InternalClientError('not connected')

    cdef WriteBuffer _build_parse_message(self, str stmt_name, str query):
        cdef WriteBuffer buf

        buf = WriteBuffer.new_message(b'P')
        buf.write_str(stmt_name, self.encoding)
        buf.write_str(query, self.encoding)
        buf.write_int16(0)

        buf.end_message()
        return buf

    cdef WriteBuffer _build_bind_message(self, str portal_name,
                                         str stmt_name,
                                         WriteBuffer bind_data):
        cdef WriteBuffer buf

        buf = WriteBuffer.new_message(b'B')
        buf.write_str(portal_name, self.encoding)
        buf.write_str(stmt_name, self.encoding)

        # Arguments
        buf.write_buffer(bind_data)

        buf.end_message()
        return buf

    cdef WriteBuffer _build_empty_bind_data(self):
        cdef WriteBuffer buf
        buf = WriteBuffer.new()
        buf.write_int16(0)  # The number of parameter format codes
        buf.write_int16(0)  # The number of parameter values
        buf.write_int16(0)  # The number of result-column format codes
        return buf

    cdef WriteBuffer _build_execute_message(self, str portal_name,
                                            int32_t limit):
        cdef WriteBuffer buf

        buf = WriteBuffer.new_message(b'E')
        buf.write_str(portal_name, self.encoding)  # name of the portal
        buf.write_int32(limit)  # number of rows to return; 0 - all

        buf.end_message()
        return buf

    # API for subclasses

    cdef _connect(self):
        cdef:
            WriteBuffer buf
            WriteBuffer outbuf

        if self.con_status != CONNECTION_BAD:
            raise apg_exc.InternalClientError('already connected')

        self._set_state(PROTOCOL_AUTH)
        self.con_status = CONNECTION_STARTED

        # Assemble a startup message
        buf = WriteBuffer()

        # protocol version
        buf.write_int16(3)
        buf.write_int16(0)

        buf.write_bytestring(b'client_encoding')
        buf.write_bytestring("'{}'".format(self.encoding).encode('ascii'))

        buf.write_str('user', self.encoding)
        buf.write_str(self.con_params.user, self.encoding)

        buf.write_str('database', self.encoding)
        buf.write_str(self.con_params.database, self.encoding)

        if self.con_params.server_settings is not None:
            for k, v in self.con_params.server_settings.items():
                buf.write_str(k, self.encoding)
                buf.write_str(v, self.encoding)

        buf.write_bytestring(b'')

        # Send the buffer
        outbuf = WriteBuffer()
        outbuf.write_int32(buf.len() + 4)
        outbuf.write_buffer(buf)
        self._write(outbuf)

    cdef _send_parse_message(self, str stmt_name, str query):
        cdef:
            WriteBuffer msg

        self._ensure_connected()
        msg = self._build_parse_message(stmt_name, query)
        self._write(msg)

    cdef _prepare_and_describe(self, str stmt_name, str query):
        cdef:
            WriteBuffer packet
            WriteBuffer buf

        self._ensure_connected()
        self._set_state(PROTOCOL_PREPARE)

        packet = self._build_parse_message(stmt_name, query)

        buf = WriteBuffer.new_message(b'D')
        buf.write_byte(b'S')
        buf.write_str(stmt_name, self.encoding)
        buf.end_message()
        packet.write_buffer(buf)

        packet.write_bytes(FLUSH_MESSAGE)

        self._write(packet)

    cdef _send_bind_message(self, str portal_name, str stmt_name,
                            WriteBuffer bind_data, int32_t limit):

        cdef:
            WriteBuffer packet
            WriteBuffer buf

        buf = self._build_bind_message(portal_name, stmt_name, bind_data)
        packet = buf

        buf = self._build_execute_message(portal_name, limit)
        packet.write_buffer(buf)

        packet.write_bytes(SYNC_MESSAGE)

        self._write(packet)

    cdef _bind_execute(self, str portal_name, str stmt_name,
                       WriteBuffer bind_data, int32_t limit):

        cdef WriteBuffer buf

        self._ensure_connected()
        self._set_state(PROTOCOL_BIND_EXECUTE)

        self.result = []

        self._send_bind_message(portal_name, stmt_name, bind_data, limit)

    cdef bint _bind_execute_many(self, str portal_name, str stmt_name,
                                 object bind_data):
        self._ensure_connected()
        self._set_state(PROTOCOL_BIND_EXECUTE_MANY)

        self.result = None
        self._discard_data = True
        self._execute_iter = bind_data
        self._execute_portal_name = portal_name
        self._execute_stmt_name = stmt_name
        return self._bind_execute_many_more(True)

    cdef bint _bind_execute_many_more(self, bint first=False):
        cdef:
            WriteBuffer packet
            WriteBuffer buf
            list buffers = []

        # as we keep sending, the server may return an error early
        if self.result_type == RESULT_FAILED:
            self._write(SYNC_MESSAGE)
            return False

        # collect up to four 32KB buffers to send
        # https://github.com/MagicStack/asyncpg/pull/289#issuecomment-391215051
        while len(buffers) < _EXECUTE_MANY_BUF_NUM:
            packet = WriteBuffer.new()

            # fill one 32KB buffer
            while packet.len() < _EXECUTE_MANY_BUF_SIZE:
                try:
                    # grab one item from the input
                    buf = <WriteBuffer>next(self._execute_iter)

                # reached the end of the input
                except StopIteration:
                    if first:
                        # if we never send anything, simply set the result
                        self._push_result()
                    else:
                        # otherwise, append SYNC and send the buffers
                        packet.write_bytes(SYNC_MESSAGE)
                        buffers.append(memoryview(packet))
                        self._writelines(buffers)
                    return False

                # error in input, give up the buffers and cleanup
                except Exception as ex:
                    self._bind_execute_many_fail(ex, first)
                    return False

                # all good, write to the buffer
                first = False
                packet.write_buffer(
                    self._build_bind_message(
                        self._execute_portal_name,
                        self._execute_stmt_name,
                        buf,
                    )
                )
                packet.write_buffer(
                    self._build_execute_message(self._execute_portal_name, 0,
                    )
                )

            # collected one buffer
            buffers.append(memoryview(packet))

        # write to the wire, and signal the caller for more to send
        self._writelines(buffers)
        return True

    cdef _bind_execute_many_fail(self, object error, bint first=False):
        cdef WriteBuffer buf

        self.result_type = RESULT_FAILED
        self.result = error
        if first:
            self._push_result()
        elif self.is_in_transaction():
            # we're in an explicit transaction, just SYNC
            self._write(SYNC_MESSAGE)
        else:
            # In an implicit transaction, if `ignore_till_sync` is set,
            # `ROLLBACK` will be ignored and `Sync` will restore the state;
            # or the transaction will be rolled back with a warning saying
            # that there was no transaction, but rollback is done anyway,
            # so we could safely ignore this warning.
            # GOTCHA: cannot use simple query message here, because it is
            # ignored if `ignore_till_sync` is set.
            buf = self._build_parse_message('', 'ROLLBACK')
            buf.write_buffer(self._build_bind_message(
                '', '', self._build_empty_bind_data()))
            buf.write_buffer(self._build_execute_message('', 0))
            buf.write_bytes(SYNC_MESSAGE)
            self._write(buf)

    cdef _execute(self, str portal_name, int32_t limit):
        cdef WriteBuffer buf

        self._ensure_connected()
        self._set_state(PROTOCOL_EXECUTE)

        self.result = []

        buf = self._build_execute_message(portal_name, limit)

        buf.write_bytes(SYNC_MESSAGE)

        self._write(buf)

    cdef _bind(self, str portal_name, str stmt_name,
               WriteBuffer bind_data):

        cdef WriteBuffer buf

        self._ensure_connected()
        self._set_state(PROTOCOL_BIND)

        buf = self._build_bind_message(portal_name, stmt_name, bind_data)

        buf.write_bytes(SYNC_MESSAGE)

        self._write(buf)

    cdef _close(self, str name, bint is_portal):
        cdef WriteBuffer buf

        self._ensure_connected()
        self._set_state(PROTOCOL_CLOSE_STMT_PORTAL)

        buf = WriteBuffer.new_message(b'C')

        if is_portal:
            buf.write_byte(b'P')
        else:
            buf.write_byte(b'S')

        buf.write_str(name, self.encoding)
        buf.end_message()

        buf.write_bytes(SYNC_MESSAGE)

        self._write(buf)

    cdef _simple_query(self, str query):
        cdef WriteBuffer buf
        self._ensure_connected()
        self._set_state(PROTOCOL_SIMPLE_QUERY)
        buf = WriteBuffer.new_message(b'Q')
        buf.write_str(query, self.encoding)
        buf.end_message()
        self._write(buf)

    cdef _copy_out(self, str copy_stmt):
        cdef WriteBuffer buf

        self._ensure_connected()
        self._set_state(PROTOCOL_COPY_OUT)

        # Send the COPY .. TO STDOUT using the SimpleQuery protocol.
        buf = WriteBuffer.new_message(b'Q')
        buf.write_str(copy_stmt, self.encoding)
        buf.end_message()
        self._write(buf)

    cdef _copy_in(self, str copy_stmt):
        cdef WriteBuffer buf

        self._ensure_connected()
        self._set_state(PROTOCOL_COPY_IN)

        buf = WriteBuffer.new_message(b'Q')
        buf.write_str(copy_stmt, self.encoding)
        buf.end_message()
        self._write(buf)

    cdef _terminate(self):
        cdef WriteBuffer buf
        self._ensure_connected()
        self._set_state(PROTOCOL_TERMINATING)
        buf = WriteBuffer.new_message(b'X')
        buf.end_message()
        self._write(buf)

    cdef _write(self, buf):
        raise NotImplementedError

    cdef _writelines(self, list buffers):
        raise NotImplementedError

    cdef _decode_row(self, const char* buf, ssize_t buf_len):
        pass

    cdef _set_server_parameter(self, name, val):
        pass

    cdef _on_result(self):
        pass

    cdef _on_notice(self, parsed):
        pass

    cdef _on_notification(self, pid, channel, payload):
        pass

    cdef _on_connection_lost(self, exc):
        pass


cdef bytes SYNC_MESSAGE = bytes(WriteBuffer.new_message(b'S').end_message())
cdef bytes FLUSH_MESSAGE = bytes(WriteBuffer.new_message(b'H').end_message())
