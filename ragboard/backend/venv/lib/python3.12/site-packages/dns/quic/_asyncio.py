# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

import asyncio
import socket
import ssl
import struct
import time

import aioquic.quic.configuration  # type: ignore
import aioquic.quic.connection  # type: ignore
import aioquic.quic.events  # type: ignore

import dns.asyncbackend
import dns.exception
import dns.inet
from dns.quic._common import (
    QUIC_MAX_DATAGRAM,
    AsyncQuicConnection,
    AsyncQuicManager,
    BaseQuicStream,
    UnexpectedEOF,
)


class AsyncioQuicStream(BaseQuicStream):
    def __init__(self, connection, stream_id):
        super().__init__(connection, stream_id)
        self._wake_up = asyncio.Condition()

    async def _wait_for_wake_up(self):
        async with self._wake_up:
            await self._wake_up.wait()

    async def wait_for(self, amount, expiration):
        while True:
            timeout = self._timeout_from_expiration(expiration)
            if self._buffer.have(amount):
                return
            self._expecting = amount
            try:
                await asyncio.wait_for(self._wait_for_wake_up(), timeout)
            except TimeoutError:
                raise dns.exception.Timeout
            self._expecting = 0

    async def wait_for_end(self, expiration):
        while True:
            timeout = self._timeout_from_expiration(expiration)
            if self._buffer.seen_end():
                return
            try:
                await asyncio.wait_for(self._wait_for_wake_up(), timeout)
            except TimeoutError:
                raise dns.exception.Timeout

    async def receive(self, timeout=None):
        expiration = self._expiration_from_timeout(timeout)
        if self._connection.is_h3():
            await self.wait_for_end(expiration)
            return self._buffer.get_all()
        else:
            await self.wait_for(2, expiration)
            (size,) = struct.unpack("!H", self._buffer.get(2))
            await self.wait_for(size, expiration)
            return self._buffer.get(size)

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


class AsyncioQuicConnection(AsyncQuicConnection):
    def __init__(self, connection, address, port, source, source_port, manager=None):
        super().__init__(connection, address, port, source, source_port, manager)
        self._socket = None
        self._handshake_complete = asyncio.Event()
        self._socket_created = asyncio.Event()
        self._wake_timer = asyncio.Condition()
        self._receiver_task = None
        self._sender_task = None
        self._wake_pending = False

    async def _receiver(self):
        try:
            af = dns.inet.af_for_address(self._address)
            backend = dns.asyncbackend.get_backend("asyncio")
            # Note that peer is a low-level address tuple, but make_socket() wants
            # a high-level address tuple, so we convert.
            self._socket = await backend.make_socket(
                af, socket.SOCK_DGRAM, 0, self._source, (self._peer[0], self._peer[1])
            )
            self._socket_created.set()
            async with self._socket:
                while not self._done:
                    (datagram, address) = await self._socket.recvfrom(
                        QUIC_MAX_DATAGRAM, None
                    )
                    if address[0] != self._peer[0] or address[1] != self._peer[1]:
                        continue
                    self._connection.receive_datagram(datagram, address, time.time())
                    # Wake up the timer in case the sender is sleeping, as there may be
                    # stuff to send now.
                    await self._wakeup()
        except Exception:
            pass
        finally:
            self._done = True
            await self._wakeup()
            self._handshake_complete.set()

    async def _wakeup(self):
        self._wake_pending = True
        async with self._wake_timer:
            self._wake_timer.notify_all()

    async def _wait_for_wake_timer(self):
        async with self._wake_timer:
            if not self._wake_pending:
                await self._wake_timer.wait()
        self._wake_pending = False

    async def _sender(self):
        await self._socket_created.wait()
        while not self._done:
            datagrams = self._connection.datagrams_to_send(time.time())
            for datagram, address in datagrams:
                assert address == self._peer
                await self._socket.sendto(datagram, self._peer, None)
            (expiration, interval) = self._get_timer_values()
            try:
                await asyncio.wait_for(self._wait_for_wake_timer(), interval)
            except Exception:
                pass
            self._handle_timer(expiration)
            await self._handle_events()

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
                self._receiver_task.cancel()
            elif isinstance(event, aioquic.quic.events.StreamReset):
                stream = self._streams.get(event.stream_id)
                if stream:
                    await stream._add_input(b"", True)

            count += 1
            if count > 10:
                # yield
                count = 0
                await asyncio.sleep(0)

    async def write(self, stream, data, is_end=False):
        self._connection.send_stream_data(stream, data, is_end)
        await self._wakeup()

    def run(self):
        if self._closed:
            return
        self._receiver_task = asyncio.Task(self._receiver())
        self._sender_task = asyncio.Task(self._sender())

    async def make_stream(self, timeout=None):
        try:
            await asyncio.wait_for(self._handshake_complete.wait(), timeout)
        except TimeoutError:
            raise dns.exception.Timeout
        if self._done:
            raise UnexpectedEOF
        stream_id = self._connection.get_next_available_stream_id(False)
        stream = AsyncioQuicStream(self, stream_id)
        self._streams[stream_id] = stream
        return stream

    async def close(self):
        if not self._closed:
            self._manager.closed(self._peer[0], self._peer[1])
            self._closed = True
            self._connection.close()
            # sender might be blocked on this, so set it
            self._socket_created.set()
            await self._wakeup()
            try:
                await self._receiver_task
            except asyncio.CancelledError:
                pass
            try:
                await self._sender_task
            except asyncio.CancelledError:
                pass
            await self._socket.close()


class AsyncioQuicManager(AsyncQuicManager):
    def __init__(
        self, conf=None, verify_mode=ssl.CERT_REQUIRED, server_name=None, h3=False
    ):
        super().__init__(conf, verify_mode, AsyncioQuicConnection, server_name, h3)

    def connect(
        self, address, port=853, source=None, source_port=0, want_session_ticket=True
    ):
        (connection, start) = self._connect(
            address, port, source, source_port, want_session_ticket
        )
        if start:
            connection.run()
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
