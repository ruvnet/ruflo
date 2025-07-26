# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

import selectors
import socket
import ssl
import struct
import threading
import time

import aioquic.quic.configuration  # type: ignore
import aioquic.quic.connection  # type: ignore
import aioquic.quic.events  # type: ignore

import dns.exception
import dns.inet
from dns.quic._common import (
    QUIC_MAX_DATAGRAM,
    BaseQuicConnection,
    BaseQuicManager,
    BaseQuicStream,
    UnexpectedEOF,
)

# Function used to create a socket.  Can be overridden if needed in special
# situations.
socket_factory = socket.socket


class SyncQuicStream(BaseQuicStream):
    def __init__(self, connection, stream_id):
        super().__init__(connection, stream_id)
        self._wake_up = threading.Condition()
        self._lock = threading.Lock()

    def wait_for(self, amount, expiration):
        while True:
            timeout = self._timeout_from_expiration(expiration)
            with self._lock:
                if self._buffer.have(amount):
                    return
                self._expecting = amount
            with self._wake_up:
                if not self._wake_up.wait(timeout):
                    raise dns.exception.Timeout
            self._expecting = 0

    def wait_for_end(self, expiration):
        while True:
            timeout = self._timeout_from_expiration(expiration)
            with self._lock:
                if self._buffer.seen_end():
                    return
            with self._wake_up:
                if not self._wake_up.wait(timeout):
                    raise dns.exception.Timeout

    def receive(self, timeout=None):
        expiration = self._expiration_from_timeout(timeout)
        if self._connection.is_h3():
            self.wait_for_end(expiration)
            with self._lock:
                return self._buffer.get_all()
        else:
            self.wait_for(2, expiration)
            with self._lock:
                (size,) = struct.unpack("!H", self._buffer.get(2))
            self.wait_for(size, expiration)
            with self._lock:
                return self._buffer.get(size)

    def send(self, datagram, is_end=False):
        data = self._encapsulate(datagram)
        self._connection.write(self._stream_id, data, is_end)

    def _add_input(self, data, is_end):
        if self._common_add_input(data, is_end):
            with self._wake_up:
                self._wake_up.notify()

    def close(self):
        with self._lock:
            self._close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        with self._wake_up:
            self._wake_up.notify()
        return False


class SyncQuicConnection(BaseQuicConnection):
    def __init__(self, connection, address, port, source, source_port, manager):
        super().__init__(connection, address, port, source, source_port, manager)
        self._socket = socket_factory(self._af, socket.SOCK_DGRAM, 0)
        if self._source is not None:
            try:
                self._socket.bind(
                    dns.inet.low_level_address_tuple(self._source, self._af)
                )
            except Exception:
                self._socket.close()
                raise
        self._socket.connect(self._peer)
        (self._send_wakeup, self._receive_wakeup) = socket.socketpair()
        self._receive_wakeup.setblocking(False)
        self._socket.setblocking(False)
        self._handshake_complete = threading.Event()
        self._worker_thread = None
        self._lock = threading.Lock()

    def _read(self):
        count = 0
        while count < 10:
            count += 1
            try:
                datagram = self._socket.recv(QUIC_MAX_DATAGRAM)
            except BlockingIOError:
                return
            with self._lock:
                self._connection.receive_datagram(datagram, self._peer, time.time())

    def _drain_wakeup(self):
        while True:
            try:
                self._receive_wakeup.recv(32)
            except BlockingIOError:
                return

    def _worker(self):
        try:
            sel = selectors.DefaultSelector()
            sel.register(self._socket, selectors.EVENT_READ, self._read)
            sel.register(self._receive_wakeup, selectors.EVENT_READ, self._drain_wakeup)
            while not self._done:
                (expiration, interval) = self._get_timer_values(False)
                items = sel.select(interval)
                for key, _ in items:
                    key.data()
                with self._lock:
                    self._handle_timer(expiration)
                self._handle_events()
                with self._lock:
                    datagrams = self._connection.datagrams_to_send(time.time())
                for datagram, _ in datagrams:
                    try:
                        self._socket.send(datagram)
                    except BlockingIOError:
                        # we let QUIC handle any lossage
                        pass
        finally:
            with self._lock:
                self._done = True
            self._socket.close()
            # Ensure anyone waiting for this gets woken up.
            self._handshake_complete.set()

    def _handle_events(self):
        while True:
            with self._lock:
                event = self._connection.next_event()
            if event is None:
                return
            if isinstance(event, aioquic.quic.events.StreamDataReceived):
                if self.is_h3():
                    h3_events = self._h3_conn.handle_event(event)
                    for h3_event in h3_events:
                        if isinstance(h3_event, aioquic.h3.events.HeadersReceived):
                            with self._lock:
                                stream = self._streams.get(event.stream_id)
                            if stream:
                                if stream._headers is None:
                                    stream._headers = h3_event.headers
                                elif stream._trailers is None:
                                    stream._trailers = h3_event.headers
                                if h3_event.stream_ended:
                                    stream._add_input(b"", True)
                        elif isinstance(h3_event, aioquic.h3.events.DataReceived):
                            with self._lock:
                                stream = self._streams.get(event.stream_id)
                            if stream:
                                stream._add_input(h3_event.data, h3_event.stream_ended)
                else:
                    with self._lock:
                        stream = self._streams.get(event.stream_id)
                    if stream:
                        stream._add_input(event.data, event.end_stream)
            elif isinstance(event, aioquic.quic.events.HandshakeCompleted):
                self._handshake_complete.set()
            elif isinstance(event, aioquic.quic.events.ConnectionTerminated):
                with self._lock:
                    self._done = True
            elif isinstance(event, aioquic.quic.events.StreamReset):
                with self._lock:
                    stream = self._streams.get(event.stream_id)
                if stream:
                    stream._add_input(b"", True)

    def write(self, stream, data, is_end=False):
        with self._lock:
            self._connection.send_stream_data(stream, data, is_end)
        self._send_wakeup.send(b"\x01")

    def send_headers(self, stream_id, headers, is_end=False):
        with self._lock:
            super().send_headers(stream_id, headers, is_end)
        if is_end:
            self._send_wakeup.send(b"\x01")

    def send_data(self, stream_id, data, is_end=False):
        with self._lock:
            super().send_data(stream_id, data, is_end)
        if is_end:
            self._send_wakeup.send(b"\x01")

    def run(self):
        if self._closed:
            return
        self._worker_thread = threading.Thread(target=self._worker)
        self._worker_thread.start()

    def make_stream(self, timeout=None):
        if not self._handshake_complete.wait(timeout):
            raise dns.exception.Timeout
        with self._lock:
            if self._done:
                raise UnexpectedEOF
            stream_id = self._connection.get_next_available_stream_id(False)
            stream = SyncQuicStream(self, stream_id)
            self._streams[stream_id] = stream
        return stream

    def close_stream(self, stream_id):
        with self._lock:
            super().close_stream(stream_id)

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._manager.closed(self._peer[0], self._peer[1])
            self._closed = True
            self._connection.close()
            self._send_wakeup.send(b"\x01")
        self._worker_thread.join()


class SyncQuicManager(BaseQuicManager):
    def __init__(
        self, conf=None, verify_mode=ssl.CERT_REQUIRED, server_name=None, h3=False
    ):
        super().__init__(conf, verify_mode, SyncQuicConnection, server_name, h3)
        self._lock = threading.Lock()

    def connect(
        self,
        address,
        port=853,
        source=None,
        source_port=0,
        want_session_ticket=True,
        want_token=True,
    ):
        with self._lock:
            (connection, start) = self._connect(
                address, port, source, source_port, want_session_ticket, want_token
            )
            if start:
                connection.run()
            return connection

    def closed(self, address, port):
        with self._lock:
            super().closed(address, port)

    def save_session_ticket(self, address, port, ticket):
        with self._lock:
            super().save_session_ticket(address, port, ticket)

    def save_token(self, address, port, token):
        with self._lock:
            super().save_token(address, port, token)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Copy the iterator into a list as exiting things will mutate the connections
        # table.
        connections = list(self._connections.values())
        for connection in connections:
            connection.close()
        return False
