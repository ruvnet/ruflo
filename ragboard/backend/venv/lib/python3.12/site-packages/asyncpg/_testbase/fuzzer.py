# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import asyncio
import socket
import threading
import typing

from asyncpg import cluster


class StopServer(Exception):
    pass


class TCPFuzzingProxy:
    def __init__(self, *, listening_addr: str='127.0.0.1',
                 listening_port: typing.Optional[int]=None,
                 backend_host: str, backend_port: int,
                 settings: typing.Optional[dict]=None) -> None:
        self.listening_addr = listening_addr
        self.listening_port = listening_port
        self.backend_host = backend_host
        self.backend_port = backend_port
        self.settings = settings or {}
        self.loop = None
        self.connectivity = None
        self.connectivity_loss = None
        self.stop_event = None
        self.connections = {}
        self.sock = None
        self.listen_task = None

    async def _wait(self, work):
        work_task = asyncio.ensure_future(work)
        stop_event_task = asyncio.ensure_future(self.stop_event.wait())

        try:
            await asyncio.wait(
                [work_task, stop_event_task],
                return_when=asyncio.FIRST_COMPLETED)

            if self.stop_event.is_set():
                raise StopServer()
            else:
                return work_task.result()
        finally:
            if not work_task.done():
                work_task.cancel()
            if not stop_event_task.done():
                stop_event_task.cancel()

    def start(self):
        started = threading.Event()
        self.thread = threading.Thread(
            target=self._start_thread, args=(started,))
        self.thread.start()
        if not started.wait(timeout=2):
            raise RuntimeError('fuzzer proxy failed to start')

    def stop(self):
        self.loop.call_soon_threadsafe(self._stop)
        self.thread.join()

    def _stop(self):
        self.stop_event.set()

    def _start_thread(self, started_event):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        self.connectivity = asyncio.Event()
        self.connectivity.set()
        self.connectivity_loss = asyncio.Event()
        self.stop_event = asyncio.Event()

        if self.listening_port is None:
            self.listening_port = cluster.find_available_port()

        self.sock = socket.socket()
        self.sock.bind((self.listening_addr, self.listening_port))
        self.sock.listen(50)
        self.sock.setblocking(False)

        try:
            self.loop.run_until_complete(self._main(started_event))
        finally:
            self.loop.close()

    async def _main(self, started_event):
        self.listen_task = asyncio.ensure_future(self.listen())
        # Notify the main thread that we are ready to go.
        started_event.set()
        try:
            await self.listen_task
        finally:
            for c in list(self.connections):
                c.close()
            await asyncio.sleep(0.01)
            if hasattr(self.loop, 'remove_reader'):
                self.loop.remove_reader(self.sock.fileno())
            self.sock.close()

    async def listen(self):
        while True:
            try:
                client_sock, _ = await self._wait(
                    self.loop.sock_accept(self.sock))

                backend_sock = socket.socket()
                backend_sock.setblocking(False)

                await self._wait(self.loop.sock_connect(
                    backend_sock, (self.backend_host, self.backend_port)))
            except StopServer:
                break

            conn = Connection(client_sock, backend_sock, self)
            conn_task = self.loop.create_task(conn.handle())
            self.connections[conn] = conn_task

    def trigger_connectivity_loss(self):
        self.loop.call_soon_threadsafe(self._trigger_connectivity_loss)

    def _trigger_connectivity_loss(self):
        self.connectivity.clear()
        self.connectivity_loss.set()

    def restore_connectivity(self):
        self.loop.call_soon_threadsafe(self._restore_connectivity)

    def _restore_connectivity(self):
        self.connectivity.set()
        self.connectivity_loss.clear()

    def reset(self):
        self.restore_connectivity()

    def _close_connection(self, connection):
        conn_task = self.connections.pop(connection, None)
        if conn_task is not None:
            conn_task.cancel()

    def close_all_connections(self):
        for conn in list(self.connections):
            self.loop.call_soon_threadsafe(self._close_connection, conn)


class Connection:
    def __init__(self, client_sock, backend_sock, proxy):
        self.client_sock = client_sock
        self.backend_sock = backend_sock
        self.proxy = proxy
        self.loop = proxy.loop
        self.connectivity = proxy.connectivity
        self.connectivity_loss = proxy.connectivity_loss
        self.proxy_to_backend_task = None
        self.proxy_from_backend_task = None
        self.is_closed = False

    def close(self):
        if self.is_closed:
            return

        self.is_closed = True

        if self.proxy_to_backend_task is not None:
            self.proxy_to_backend_task.cancel()
            self.proxy_to_backend_task = None

        if self.proxy_from_backend_task is not None:
            self.proxy_from_backend_task.cancel()
            self.proxy_from_backend_task = None

        self.proxy._close_connection(self)

    async def handle(self):
        self.proxy_to_backend_task = asyncio.ensure_future(
            self.proxy_to_backend())

        self.proxy_from_backend_task = asyncio.ensure_future(
            self.proxy_from_backend())

        try:
            await asyncio.wait(
                [self.proxy_to_backend_task, self.proxy_from_backend_task],
                return_when=asyncio.FIRST_COMPLETED)

        finally:
            if self.proxy_to_backend_task is not None:
                self.proxy_to_backend_task.cancel()

            if self.proxy_from_backend_task is not None:
                self.proxy_from_backend_task.cancel()

            # Asyncio fails to properly remove the readers and writers
            # when the task doing recv() or send() is cancelled, so
            # we must remove the readers and writers manually before
            # closing the sockets.
            self.loop.remove_reader(self.client_sock.fileno())
            self.loop.remove_writer(self.client_sock.fileno())
            self.loop.remove_reader(self.backend_sock.fileno())
            self.loop.remove_writer(self.backend_sock.fileno())

            self.client_sock.close()
            self.backend_sock.close()

    async def _read(self, sock, n):
        read_task = asyncio.ensure_future(
            self.loop.sock_recv(sock, n))
        conn_event_task = asyncio.ensure_future(
            self.connectivity_loss.wait())

        try:
            await asyncio.wait(
                [read_task, conn_event_task],
                return_when=asyncio.FIRST_COMPLETED)

            if self.connectivity_loss.is_set():
                return None
            else:
                return read_task.result()
        finally:
            if not self.loop.is_closed():
                if not read_task.done():
                    read_task.cancel()
                if not conn_event_task.done():
                    conn_event_task.cancel()

    async def _write(self, sock, data):
        write_task = asyncio.ensure_future(
            self.loop.sock_sendall(sock, data))
        conn_event_task = asyncio.ensure_future(
            self.connectivity_loss.wait())

        try:
            await asyncio.wait(
                [write_task, conn_event_task],
                return_when=asyncio.FIRST_COMPLETED)

            if self.connectivity_loss.is_set():
                return None
            else:
                return write_task.result()
        finally:
            if not self.loop.is_closed():
                if not write_task.done():
                    write_task.cancel()
                if not conn_event_task.done():
                    conn_event_task.cancel()

    async def proxy_to_backend(self):
        buf = None

        try:
            while True:
                await self.connectivity.wait()
                if buf is not None:
                    data = buf
                    buf = None
                else:
                    data = await self._read(self.client_sock, 4096)
                if data == b'':
                    break
                if self.connectivity_loss.is_set():
                    if data:
                        buf = data
                    continue
                await self._write(self.backend_sock, data)

        except ConnectionError:
            pass

        finally:
            if not self.loop.is_closed():
                self.loop.call_soon(self.close)

    async def proxy_from_backend(self):
        buf = None

        try:
            while True:
                await self.connectivity.wait()
                if buf is not None:
                    data = buf
                    buf = None
                else:
                    data = await self._read(self.backend_sock, 4096)
                if data == b'':
                    break
                if self.connectivity_loss.is_set():
                    if data:
                        buf = data
                    continue
                await self._write(self.client_sock, data)

        except ConnectionError:
            pass

        finally:
            if not self.loop.is_closed():
                self.loop.call_soon(self.close)
