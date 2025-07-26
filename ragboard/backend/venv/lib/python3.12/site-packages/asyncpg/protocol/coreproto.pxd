# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


include "scram.pxd"


cdef enum ConnectionStatus:
    CONNECTION_OK = 1
    CONNECTION_BAD = 2
    CONNECTION_STARTED = 3           # Waiting for connection to be made.


cdef enum ProtocolState:
    PROTOCOL_IDLE = 0

    PROTOCOL_FAILED = 1
    PROTOCOL_ERROR_CONSUME = 2
    PROTOCOL_CANCELLED = 3
    PROTOCOL_TERMINATING = 4

    PROTOCOL_AUTH = 10
    PROTOCOL_PREPARE = 11
    PROTOCOL_BIND_EXECUTE = 12
    PROTOCOL_BIND_EXECUTE_MANY = 13
    PROTOCOL_CLOSE_STMT_PORTAL = 14
    PROTOCOL_SIMPLE_QUERY = 15
    PROTOCOL_EXECUTE = 16
    PROTOCOL_BIND = 17
    PROTOCOL_COPY_OUT = 18
    PROTOCOL_COPY_OUT_DATA = 19
    PROTOCOL_COPY_OUT_DONE = 20
    PROTOCOL_COPY_IN = 21
    PROTOCOL_COPY_IN_DATA = 22


cdef enum AuthenticationMessage:
    AUTH_SUCCESSFUL = 0
    AUTH_REQUIRED_KERBEROS = 2
    AUTH_REQUIRED_PASSWORD = 3
    AUTH_REQUIRED_PASSWORDMD5 = 5
    AUTH_REQUIRED_SCMCRED = 6
    AUTH_REQUIRED_GSS = 7
    AUTH_REQUIRED_GSS_CONTINUE = 8
    AUTH_REQUIRED_SSPI = 9
    AUTH_REQUIRED_SASL = 10
    AUTH_SASL_CONTINUE = 11
    AUTH_SASL_FINAL = 12


AUTH_METHOD_NAME = {
    AUTH_REQUIRED_KERBEROS: 'kerberosv5',
    AUTH_REQUIRED_PASSWORD: 'password',
    AUTH_REQUIRED_PASSWORDMD5: 'md5',
    AUTH_REQUIRED_GSS: 'gss',
    AUTH_REQUIRED_SASL: 'scram-sha-256',
    AUTH_REQUIRED_SSPI: 'sspi',
}


cdef enum ResultType:
    RESULT_OK = 1
    RESULT_FAILED = 2


cdef enum TransactionStatus:
    PQTRANS_IDLE = 0                 # connection idle
    PQTRANS_ACTIVE = 1               # command in progress
    PQTRANS_INTRANS = 2              # idle, within transaction block
    PQTRANS_INERROR = 3              # idle, within failed transaction
    PQTRANS_UNKNOWN = 4              # cannot determine status


ctypedef object (*decode_row_method)(object, const char*, ssize_t)


cdef class CoreProtocol:
    cdef:
        ReadBuffer buffer
        bint _skip_discard
        bint _discard_data

        # executemany support data
        object _execute_iter
        str _execute_portal_name
        str _execute_stmt_name

        ConnectionStatus con_status
        ProtocolState state
        TransactionStatus xact_status

        str encoding

        object transport

        # Instance of _ConnectionParameters
        object con_params
        # Instance of SCRAMAuthentication
        SCRAMAuthentication scram

        readonly int32_t backend_pid
        readonly int32_t backend_secret

        ## Result
        ResultType result_type
        object result
        bytes result_param_desc
        bytes result_row_desc
        bytes result_status_msg

        # True - completed, False - suspended
        bint result_execute_completed

    cpdef is_in_transaction(self)
    cdef _process__auth(self, char mtype)
    cdef _process__prepare(self, char mtype)
    cdef _process__bind_execute(self, char mtype)
    cdef _process__bind_execute_many(self, char mtype)
    cdef _process__close_stmt_portal(self, char mtype)
    cdef _process__simple_query(self, char mtype)
    cdef _process__bind(self, char mtype)
    cdef _process__copy_out(self, char mtype)
    cdef _process__copy_out_data(self, char mtype)
    cdef _process__copy_in(self, char mtype)
    cdef _process__copy_in_data(self, char mtype)

    cdef _parse_msg_authentication(self)
    cdef _parse_msg_parameter_status(self)
    cdef _parse_msg_notification(self)
    cdef _parse_msg_backend_key_data(self)
    cdef _parse_msg_ready_for_query(self)
    cdef _parse_data_msgs(self)
    cdef _parse_copy_data_msgs(self)
    cdef _parse_msg_error_response(self, is_error)
    cdef _parse_msg_command_complete(self)

    cdef _write_copy_data_msg(self, object data)
    cdef _write_copy_done_msg(self)
    cdef _write_copy_fail_msg(self, str cause)

    cdef _auth_password_message_cleartext(self)
    cdef _auth_password_message_md5(self, bytes salt)
    cdef _auth_password_message_sasl_initial(self, list sasl_auth_methods)
    cdef _auth_password_message_sasl_continue(self, bytes server_response)

    cdef _write(self, buf)
    cdef _writelines(self, list buffers)

    cdef _read_server_messages(self)

    cdef _push_result(self)
    cdef _reset_result(self)
    cdef _set_state(self, ProtocolState new_state)

    cdef _ensure_connected(self)

    cdef WriteBuffer _build_parse_message(self, str stmt_name, str query)
    cdef WriteBuffer _build_bind_message(self, str portal_name,
                                         str stmt_name,
                                         WriteBuffer bind_data)
    cdef WriteBuffer _build_empty_bind_data(self)
    cdef WriteBuffer _build_execute_message(self, str portal_name,
                                            int32_t limit)


    cdef _connect(self)
    cdef _prepare_and_describe(self, str stmt_name, str query)
    cdef _send_parse_message(self, str stmt_name, str query)
    cdef _send_bind_message(self, str portal_name, str stmt_name,
                            WriteBuffer bind_data, int32_t limit)
    cdef _bind_execute(self, str portal_name, str stmt_name,
                       WriteBuffer bind_data, int32_t limit)
    cdef bint _bind_execute_many(self, str portal_name, str stmt_name,
                                 object bind_data)
    cdef bint _bind_execute_many_more(self, bint first=*)
    cdef _bind_execute_many_fail(self, object error, bint first=*)
    cdef _bind(self, str portal_name, str stmt_name,
               WriteBuffer bind_data)
    cdef _execute(self, str portal_name, int32_t limit)
    cdef _close(self, str name, bint is_portal)
    cdef _simple_query(self, str query)
    cdef _copy_out(self, str copy_stmt)
    cdef _copy_in(self, str copy_stmt)
    cdef _terminate(self)

    cdef _decode_row(self, const char* buf, ssize_t buf_len)

    cdef _on_result(self)
    cdef _on_notification(self, pid, channel, payload)
    cdef _on_notice(self, parsed)
    cdef _set_server_parameter(self, name, val)
    cdef _on_connection_lost(self, exc)
