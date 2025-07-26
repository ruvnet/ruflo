# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

import socket
import ssl
import struct
import time

import aioquic.quic.configuration  # type: ignore
import aioquic.quic.connection  # type: ignore
import aioquic.quic.events  # type: ignore
import trio

import dns.exception
import dns.inet
from dns._asyncbackend import NullContext
from dns.quic._common import (
    QUIC_MAX_DATAGRAM,
    AsyncQuicConnection,
    AsyncQuicManager,
    BaseQuicStream,
    UnexpectedEOF,
)


class TrioQuicStream(BaseQuicStream):
    def __init__(self, connection, stream_id):
        super().__init__(connection, stream_id)
        self._wake_up = trio.Condition()

    async def wait_for(self, amount):
        while True:
            if self._buffer.have(amount):
                return
            self._expecting = amount
            async with self._wake_up:
                await self._wake_up.wait()
            self._expecting = 0

    async def wait_for_end(self):
        while True:
            if self._buffer.seen_end():
                return
            async with self._wake_up:
                await self._wake_up.wait()

    async def receive(self, timeout=None):
        if timeout is None:
            context = NullContext(None)
        else:
            context = trio.move_on_after(timeout)
        with context:
            if self._connection.is_h3():
                await self.wait_for_end()
                return self._buffer.get_all()
            else:
                await self.wait_for(2)
                (size,) = struct.unpack("!H", self._buffer.get(2))
                await self.wait_for(size)
                return self._buffer.get(size)
        raise dns.exception.Timeout

    async def send(self, datagram, is_end=False):
        data = self._encapsulate(datagram)
        await self._connection.write(self._stream_id, data, is_end)

    async def _add_input(self, data, is_end):
        if self._common_add_input(data, is_end):
            async with self._wake_up:
                self._wake_up.notify()

    async def close(self):
        self._close()

    # Streams are async context managers

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
        async with self._wake_up:
            self._wake_up.notify()
        return False


class TrioQuicConnection(AsyncQuicConnection):
    def __init__(self, connection, address, port, source, source_port, manager=None):
        super().__init__(connection, address, port, source, source_port, manager)
        self._socket = trio.socket.socket(self._af, socket.SOCK_DGRAM, 0)
        self._handshake_complete = trio.Event()
        self._run_done = trio.Event()
        self._worker_scope = None
        self._send_pending = False

    async def _worker(self):
        try:
            if self._source:
                await self._socket.bind(
                    dns.inet.low_level_address_tuple(self._source, self._af)
                )
            await self._socket.connect(self._peer)
            while not self._done:
                (expiration, interval) = self._get_timer_values(False)
                if self._send_pending:
                    # Do not block forever if sends are pending.  Even though we
                    # have a wake-up mechanism if we've already started the blocking
                    # read, the possibility of context switching in send means that
                    # more writes can happen while we have no wake up context, so
                    # we need self._send_pending to avoid (effectively) a "lost wakeup"
                    # race.
                    interval = 0.0
                with trio.CancelScope(
                    deadline=trio.current_time() + interval
                ) as self._worker_scope:
                    datagram = await self._socket.recv(QUIC_MAX_DATAGRAM)
                    self._connection.receive_datagram(datagram, self._peer, time.time())
                self._worker_scope = None
                self._handle_timer(expiration)
                await self._handle_events()
                # We clear this now, before sending anything, as sending can cause
                # context switches that do more sends.  We want to know if that
                # happens so we don't block a long time on the recv() above.
                self._send_pending = False
                datagrams = self._connection.datagrams_to_send(time.time())
                for datagram, _ in datagrams:
                    await self._socket.send(datagram)
        finally:
            self._done = True
            self._socket.close()
            self._handshake_complete.set()

    async def _handle_events(self):
        count = 0
        while True:
            event = self._connection.next_event()
            if event is None:
                return
            if isinstance(event, aioquic.quic.events.StreamDataReceived):
                if self.is_h3():
                    h3_events = self._h3_conn.handle_event(event)
                    for h3_event in h3_events:
                        if isinstance(h3_event, aioquic.h3.events.HeadersReceived):
                            stream = self._streams.get(event.stream_id)
                            if stream:
                                if stream._headers is None:
                                    stream._headers = h3_event.headers
                                elif stream._trailers is None:
                                    stream._trailers = h3_event.headers
                                if h3_event.stream_ended:
                                    await stream._add_input(b"", True)
                        elif isinstance(h3_event, aioquic.h3.events.DataReceived):
                            stream = self._streams.get(event.stream_id)
                            if stream:
                                await stream._add_input(
                                    h3_event.data, h3_event.stream_ended
                                )
                else:
                    stream = self._streams.get(event.stream_id)
                    if stream:
                        await stream._add_input(event.data, event.end_stream)
            elif isinstance(event, aioquic.quic.events.HandshakeCompleted):
                self._handshake_complete.set()
            elif isinstance(event, aioquic.quic.events.ConnectionTerminated):
                self._done = True
                self._socket.close()
            elif isinstance(event, aioquic.quic.events.StreamReset):
                stream = self._streams.get(event.stream_id)
                if stream:
                    await stream._add_input(b"", True)
            count += 1
            if count > 10:
                # yield
                count = 0
                await trio.sleep(0)

    async def write(self, stream, data, is_end=False):
        self._connection.send_stream_data(stream, data, is_end)
        self._send_pending = True
        if self._worker_scope is not None:
            self._worker_scope.cancel()

    async def run(self):
        if self._closed:
            return
        async with trio.open_nursery() as nursery:
            nursery.start_soon(self._worker)
        self._run_done.set()

    async def make_stream(self, timeout=None):
        if timeout is None:
            context = NullContext(None)
        else:
            context = trio.move_on_after(timeout)
        with context:
            await self._handshake_complete.wait()
            if self._done:
                raise UnexpectedEOF
            stream_id = self._connection.get_next_available_stream_id(False)
            stream = TrioQuicStream(self, stream_id)
            self._streams[stream_id] = stream
            return stream
        raise dns.exception.Timeout

    async def close(self):
        if not self._closed:
            self._manager.closed(self._peer[0], self._peer[1])
            self._closed = True
            self._connection.close()
            self._send_pending = True
            if self._worker_scope is not None:
                self._worker_scope.cancel()
            await self._run_done.wait()


class TrioQuicManager(AsyncQuicManager):
    def __init__(
        self,
        nursery,
        conf=None,
        verify_mode=ssl.CERT_REQUIRED,
        server_name=None,
        h3=False,
    ):
        super().__init__(conf, verify_mode, TrioQuicConnection, server_name, h3)
        self._nursery = nursery

    def connect(
        self, address, port=853, source=None, source_port=0, want_session_ticket=True
    ):
        (connection, start) = self._connect(
            address, port, source, source_port, want_session_ticket
        )
        if start:
            self._nursery.start_soon(connection.run)
        return connection

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        # Copy the iterator into a list as exiting things will mutate the connections
        # table.
        connections = list(self._connections.values())
        for connection in connections:
            await connection.close()
        return False
