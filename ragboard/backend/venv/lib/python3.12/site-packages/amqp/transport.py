"""Transport implementation."""
# Copyright (C) 2009 Barry Pederson <bp@barryp.org>

import errno
import os
import re
import socket
import ssl
from contextlib import contextmanager
from ssl import SSLError
from struct import pack, unpack

from .exceptions import UnexpectedFrame
from .platform import KNOWN_TCP_OPTS, SOL_TCP
from .utils import set_cloexec

_UNAVAIL = {errno.EAGAIN, errno.EINTR, errno.ENOENT, errno.EWOULDBLOCK}

AMQP_PORT = 5672

EMPTY_BUFFER = bytes()

SIGNED_INT_MAX = 0x7FFFFFFF

# Yes, Advanced Message Queuing Protocol Protocol is redundant
AMQP_PROTOCOL_HEADER = b'AMQP\x00\x00\x09\x01'

# Match things like: [fe80::1]:5432, from RFC 2732
IPV6_LITERAL = re.compile(r'\[([\.0-9a-f:]+)\](?::(\d+))?')

DEFAULT_SOCKET_SETTINGS = {
    'TCP_NODELAY': 1,
    'TCP_USER_TIMEOUT': 1000,
    'TCP_KEEPIDLE': 60,
    'TCP_KEEPINTVL': 10,
    'TCP_KEEPCNT': 9,
}


def to_host_port(host, default=AMQP_PORT):
    """Convert hostname:port string to host, port tuple."""
    port = default
    m = IPV6_LITERAL.match(host)
    if m:
        host = m.group(1)
        if m.group(2):
            port = int(m.group(2))
    else:
        if ':' in host:
            host, port = host.rsplit(':', 1)
            port = int(port)
    return host, port


class _AbstractTransport:
    """Common superclass for TCP and SSL transports.

    PARAMETERS:
        host: str

            Broker address in format ``HOSTNAME:PORT``.

        connect_timeout: int

            Timeout of creating new connection.

        read_timeout: int

            sets ``SO_RCVTIMEO`` parameter of socket.

        write_timeout: int

            sets ``SO_SNDTIMEO`` parameter of socket.

        socket_settings: dict

            dictionary containing `optname` and ``optval`` passed to
            ``setsockopt(2)``.

        raise_on_initial_eintr: bool

            when True, ``socket.timeout`` is raised
            when exception is received during first read. See ``_read()`` for
            details.
    """

    def __init__(self, host, connect_timeout=None,
                 read_timeout=None, write_timeout=None,
                 socket_settings=None, raise_on_initial_eintr=True, **kwargs):
        self.connected = False
        self.sock = None
        self.raise_on_initial_eintr = raise_on_initial_eintr
        self._read_buffer = EMPTY_BUFFER
        self.host, self.port = to_host_port(host)
        self.connect_timeout = connect_timeout
        self.read_timeout = read_timeout
        self.write_timeout = write_timeout
        self.socket_settings = socket_settings

    __slots__ = (
        "connection",
        "sock",
        "raise_on_initial_eintr",
        "_read_buffer",
        "host",
        "port",
        "connect_timeout",
        "read_timeout",
        "write_timeout",
        "socket_settings",
        # adding '__dict__' to get dynamic assignment
        "__dict__",
        "__weakref__",
        )

    def __repr__(self):
        if self.sock:
            src = f'{self.sock.getsockname()[0]}:{self.sock.getsockname()[1]}'
            try:
                dst = f'{self.sock.getpeername()[0]}:{self.sock.getpeername()[1]}'
            except (socket.error) as e:
                dst = f'ERROR: {e}'
            return f'<{type(self).__name__}: {src} -> {dst} at {id(self):#x}>'
        else:
            return f'<{type(self).__name__}: (disconnected) at {id(self):#x}>'

    def connect(self):
        try:
            # are we already connected?
            if self.connected:
                return
            self._connect(self.host, self.port, self.connect_timeout)
            self._init_socket(
                self.socket_settings, self.read_timeout, self.write_timeout,
            )
            # we've sent the banner; signal connect
            # EINTR, EAGAIN, EWOULDBLOCK would signal that the banner
            # has _not_ been sent
            self.connected = True
        except (OSError, SSLError):
            # if not fully connected, close socket, and reraise error
            if self.sock and not self.connected:
                self.sock.close()
                self.sock = None
            raise

    @contextmanager
    def having_timeout(self, timeout):
        if timeout is None:
            yield self.sock
        else:
            sock = self.sock
            prev = sock.gettimeout()
            if prev != timeout:
                sock.settimeout(timeout)
            try:
                yield self.sock
            except SSLError as exc:
                if 'timed out' in str(exc):
                    # http://bugs.python.org/issue10272
                    raise socket.timeout()
                elif 'The operation did not complete' in str(exc):
                    # Non-blocking SSL sockets can throw SSLError
                    raise socket.timeout()
                raise
            except OSError as exc:
                if exc.errno == errno.EWOULDBLOCK:
                    raise socket.timeout()
                raise
            finally:
                if timeout != prev:
                    sock.settimeout(prev)

    def _connect(self, host, port, timeout):
        entries = socket.getaddrinfo(
            host, port, socket.AF_UNSPEC, socket.SOCK_STREAM, SOL_TCP,
        )
        for i, res in enumerate(entries):
            af, socktype, proto, canonname, sa = res
            try:
                self.sock = socket.socket(af, socktype, proto)
                try:
                    set_cloexec(self.sock, True)
                except NotImplementedError:
                    pass
                self.sock.settimeout(timeout)
                self.sock.connect(sa)
            except socket.error:
                if self.sock:
                    self.sock.close()
                self.sock = None
                if i + 1 >= len(entries):
                    raise
            else:
                break

    def _init_socket(self, socket_settings, read_timeout, write_timeout):
        self.sock.settimeout(None)  # set socket back to blocking mode
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        self._set_socket_options(socket_settings)

        # set socket timeouts
        for timeout, interval in ((socket.SO_SNDTIMEO, write_timeout),
                                  (socket.SO_RCVTIMEO, read_timeout)):
            if interval is not None:
                sec = int(interval)
                usec = int((interval - sec) * 1000000)
                self.sock.setsockopt(
                    socket.SOL_SOCKET, timeout,
                    pack('ll', sec, usec),
                )
        self._setup_transport()

        self._write(AMQP_PROTOCOL_HEADER)

    def _get_tcp_socket_defaults(self, sock):
        tcp_opts = {}
        for opt in KNOWN_TCP_OPTS:
            enum = None
            if opt == 'TCP_USER_TIMEOUT':
                try:
                    from socket import TCP_USER_TIMEOUT as enum
                except ImportError:
                    # should be in Python 3.6+ on Linux.
                    enum = 18
            elif hasattr(socket, opt):
                enum = getattr(socket, opt)

            if enum:
                if opt in DEFAULT_SOCKET_SETTINGS:
                    tcp_opts[enum] = DEFAULT_SOCKET_SETTINGS[opt]
                elif hasattr(socket, opt):
                    tcp_opts[enum] = sock.getsockopt(
                        SOL_TCP, getattr(socket, opt))
        return tcp_opts

    def _set_socket_options(self, socket_settings):
        tcp_opts = self._get_tcp_socket_defaults(self.sock)
        if socket_settings:
            tcp_opts.update(socket_settings)
        for opt, val in tcp_opts.items():
            self.sock.setsockopt(SOL_TCP, opt, val)

    def _read(self, n, initial=False):
        """Read exactly n bytes from the peer."""
        raise NotImplementedError('Must be overridden in subclass')

    def _setup_transport(self):
        """Do any additional initialization of the class."""
        pass

    def _shutdown_transport(self):
        """Do any preliminary work in shutting down the connection."""
        pass

    def _write(self, s):
        """Completely write a string to the peer."""
        raise NotImplementedError('Must be overridden in subclass')

    def close(self):
        if self.sock is not None:
            try:
                self._shutdown_transport()
            except OSError:
                pass

            # Call shutdown first to make sure that pending messages
            # reach the AMQP broker if the program exits after
            # calling this method.
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None
        self.connected = False

    def read_frame(self, unpack=unpack):
        """Parse AMQP frame.

        Frame has following format::

            0      1         3         7                   size+7      size+8
            +------+---------+---------+   +-------------+   +-----------+
            | type | channel |  size   |   |   payload   |   | frame-end |
            +------+---------+---------+   +-------------+   +-----------+
             octet    short     long        'size' octets        octet

        """
        read = self._read
        read_frame_buffer = EMPTY_BUFFER
        try:
            frame_header = read(7, True)
            read_frame_buffer += frame_header
            frame_type, channel, size = unpack('>BHI', frame_header)
            # >I is an unsigned int, but the argument to sock.recv is signed,
            # so we know the size can be at most 2 * SIGNED_INT_MAX
            if size > SIGNED_INT_MAX:
                part1 = read(SIGNED_INT_MAX)

                try:
                    part2 = read(size - SIGNED_INT_MAX)
                except (socket.timeout, OSError, SSLError):
                    # In case this read times out, we need to make sure to not
                    # lose part1 when we retry the read
                    read_frame_buffer += part1
                    raise

                payload = b''.join([part1, part2])
            else:
                payload = read(size)
            read_frame_buffer += payload
            frame_end = ord(read(1))
        except socket.timeout:
            self._read_buffer = read_frame_buffer + self._read_buffer
            raise
        except (OSError, SSLError) as exc:
            if (
                isinstance(exc, socket.error) and os.name == 'nt'
                and exc.errno == errno.EWOULDBLOCK  # noqa
            ):
                # On windows we can get a read timeout with a winsock error
                # code instead of a proper socket.timeout() error, see
                # https://github.com/celery/py-amqp/issues/320
                self._read_buffer = read_frame_buffer + self._read_buffer
                raise socket.timeout()

            if isinstance(exc, SSLError) and 'timed out' in str(exc):
                # Don't disconnect for ssl read time outs
                # http://bugs.python.org/issue10272
                self._read_buffer = read_frame_buffer + self._read_buffer
                raise socket.timeout()

            if exc.errno not in _UNAVAIL:
                self.connected = False
            raise
        # frame-end octet must contain '\xce' value
        if frame_end == 206:
            return frame_type, channel, payload
        else:
            raise UnexpectedFrame(
                f'Received frame_end {frame_end:#04x} while expecting 0xce')

    def write(self, s):
        try:
            self._write(s)
        except socket.timeout:
            raise
        except OSError as exc:
            if exc.errno not in _UNAVAIL:
                self.connected = False
            raise


class SSLTransport(_AbstractTransport):
    """Transport that works over SSL.

    PARAMETERS:
        host: str

            Broker address in format ``HOSTNAME:PORT``.

        connect_timeout: int

            Timeout of creating new connection.

        ssl: bool|dict

            parameters of TLS subsystem.
                - when ``ssl`` is not dictionary, defaults of TLS are used
                - otherwise:
                    - if ``ssl`` dictionary contains ``context`` key,
                      :attr:`~SSLTransport._wrap_context` is used for wrapping
                      socket. ``context`` is a dictionary passed to
                      :attr:`~SSLTransport._wrap_context` as context parameter.
                      All others items from ``ssl`` argument are passed as
                      ``sslopts``.
                    - if ``ssl`` dictionary does not contain ``context`` key,
                      :attr:`~SSLTransport._wrap_socket_sni` is used for
                      wrapping socket. All items in ``ssl`` argument are
                      passed to :attr:`~SSLTransport._wrap_socket_sni` as
                      parameters.

        kwargs:

            additional arguments of
            :class:`~amqp.transport._AbstractTransport` class
    """

    def __init__(self, host, connect_timeout=None, ssl=None, **kwargs):
        self.sslopts = ssl if isinstance(ssl, dict) else {}
        self._read_buffer = EMPTY_BUFFER
        super().__init__(
            host, connect_timeout=connect_timeout, **kwargs)

    __slots__ = (
        "sslopts",
        )

    def _setup_transport(self):
        """Wrap the socket in an SSL object."""
        self.sock = self._wrap_socket(self.sock, **self.sslopts)
        # Explicitly set a timeout here to stop any hangs on handshake.
        self.sock.settimeout(self.connect_timeout)
        self.sock.do_handshake()
        self._quick_recv = self.sock.read

    def _wrap_socket(self, sock, context=None, **sslopts):
        if context:
            return self._wrap_context(sock, sslopts, **context)
        return self._wrap_socket_sni(sock, **sslopts)

    def _wrap_context(self, sock, sslopts, check_hostname=None, **ctx_options):
        """Wrap socket without SNI headers.

        PARAMETERS:
            sock: socket.socket

            Socket to be wrapped.

            sslopts: dict

                Parameters of  :attr:`ssl.SSLContext.wrap_socket`.

            check_hostname

                Whether to match the peer cert’s hostname. See
                :attr:`ssl.SSLContext.check_hostname` for details.

            ctx_options

                Parameters of :attr:`ssl.create_default_context`.
        """
        ctx = ssl.create_default_context(**ctx_options)
        ctx.check_hostname = check_hostname
        return ctx.wrap_socket(sock, **sslopts)

    def _wrap_socket_sni(self, sock, keyfile=None, certfile=None,
                         server_side=False, cert_reqs=None,
                         ca_certs=None, do_handshake_on_connect=False,
                         suppress_ragged_eofs=True, server_hostname=None,
                         ciphers=None, ssl_version=None):
        """Socket wrap with SNI headers.

        stdlib :attr:`ssl.SSLContext.wrap_socket` method augmented with support
        for setting the server_hostname field required for SNI hostname header.

        PARAMETERS:
            sock: socket.socket

                Socket to be wrapped.

            keyfile: str

                Path to the private key

            certfile: str

                Path to the certificate

            server_side: bool

                Identifies whether server-side or client-side
                behavior is desired from this socket. See
                :attr:`~ssl.SSLContext.wrap_socket` for details.

            cert_reqs: ssl.VerifyMode

                When set to other than :attr:`ssl.CERT_NONE`, peers certificate
                is checked. Possible values are :attr:`ssl.CERT_NONE`,
                :attr:`ssl.CERT_OPTIONAL` and :attr:`ssl.CERT_REQUIRED`.

            ca_certs: str

                Path to “certification authority” (CA) certificates
                used to validate other peers’ certificates when ``cert_reqs``
                is other than :attr:`ssl.CERT_NONE`.

            do_handshake_on_connect: bool

                Specifies whether to do the SSL
                handshake automatically. See
                :attr:`~ssl.SSLContext.wrap_socket` for details.

            suppress_ragged_eofs (bool):

                See :attr:`~ssl.SSLContext.wrap_socket` for details.

            server_hostname: str

                Specifies the hostname of the service which
                we are connecting to. See :attr:`~ssl.SSLContext.wrap_socket`
                for details.

            ciphers: str

                Available ciphers for sockets created with this
                context. See :attr:`ssl.SSLContext.set_ciphers`

            ssl_version:

                Protocol of the SSL Context. The value is one of
                ``ssl.PROTOCOL_*`` constants.
        """
        opts = {
            'sock': sock,
            'server_side': server_side,
            'do_handshake_on_connect': do_handshake_on_connect,
            'suppress_ragged_eofs': suppress_ragged_eofs,
            'server_hostname': server_hostname,
        }

        if ssl_version is None:
            ssl_version = (
                ssl.PROTOCOL_TLS_SERVER
                if server_side
                else ssl.PROTOCOL_TLS_CLIENT
            )

        context = ssl.SSLContext(ssl_version)

        if certfile is not None:
            context.load_cert_chain(certfile, keyfile)
        if ca_certs is not None:
            context.load_verify_locations(ca_certs)
        if ciphers is not None:
            context.set_ciphers(ciphers)
        # Set SNI headers if supported.
        # Must set context.check_hostname before setting context.verify_mode
        # to avoid setting context.verify_mode=ssl.CERT_NONE while
        # context.check_hostname is still True (the default value in context
        # if client-side) which results in the following exception:
        # ValueError: Cannot set verify_mode to CERT_NONE when check_hostname
        # is enabled.
        try:
            context.check_hostname = (
                ssl.HAS_SNI and server_hostname is not None
            )
        except AttributeError:
            pass  # ask forgiveness not permission

        # See note above re: ordering for context.check_hostname and
        # context.verify_mode assignments.
        if cert_reqs is not None:
            context.verify_mode = cert_reqs

        if ca_certs is None and context.verify_mode != ssl.CERT_NONE:
            purpose = (
                ssl.Purpose.CLIENT_AUTH
                if server_side
                else ssl.Purpose.SERVER_AUTH
            )
            context.load_default_certs(purpose)

        sock = context.wrap_socket(**opts)
        return sock

    def _shutdown_transport(self):
        """Unwrap a SSL socket, so we can call shutdown()."""
        if self.sock is not None:
            self.sock = self.sock.unwrap()

    def _read(self, n, initial=False,
              _errnos=(errno.ENOENT, errno.EAGAIN, errno.EINTR)):
        # According to SSL_read(3), it can at most return 16kb of data.
        # Thus, we use an internal read buffer like TCPTransport._read
        # to get the exact number of bytes wanted.
        recv = self._quick_recv
        rbuf = self._read_buffer
        try:
            while len(rbuf) < n:
                try:
                    s = recv(n - len(rbuf))  # see note above
                except OSError as exc:
                    # ssl.sock.read may cause ENOENT if the
                    # operation couldn't be performed (Issue celery#1414).
                    if exc.errno in _errnos:
                        if initial and self.raise_on_initial_eintr:
                            raise socket.timeout()
                        continue
                    raise
                if not s:
                    raise OSError('Server unexpectedly closed connection')
                rbuf += s
        except:  # noqa
            self._read_buffer = rbuf
            raise
        result, self._read_buffer = rbuf[:n], rbuf[n:]
        return result

    def _write(self, s):
        """Write a string out to the SSL socket fully."""
        write = self.sock.write
        while s:
            try:
                n = write(s)
            except ValueError:
                # AG: sock._sslobj might become null in the meantime if the
                # remote connection has hung up.
                # In python 3.4, a ValueError is raised is self._sslobj is
                # None.
                n = 0
            if not n:
                raise OSError('Socket closed')
            s = s[n:]


class TCPTransport(_AbstractTransport):
    """Transport that deals directly with TCP socket.

    All parameters are :class:`~amqp.transport._AbstractTransport` class.
    """

    def _setup_transport(self):
        # Setup to _write() directly to the socket, and
        # do our own buffered reads.
        self._write = self.sock.sendall
        self._read_buffer = EMPTY_BUFFER
        self._quick_recv = self.sock.recv

    def _read(self, n, initial=False, _errnos=(errno.EAGAIN, errno.EINTR)):
        """Read exactly n bytes from the socket."""
        recv = self._quick_recv
        rbuf = self._read_buffer
        try:
            while len(rbuf) < n:
                try:
                    s = recv(n - len(rbuf))
                except OSError as exc:
                    if exc.errno in _errnos:
                        if initial and self.raise_on_initial_eintr:
                            raise socket.timeout()
                        continue
                    raise
                if not s:
                    raise OSError('Server unexpectedly closed connection')
                rbuf += s
        except:  # noqa
            self._read_buffer = rbuf
            raise

        result, self._read_buffer = rbuf[:n], rbuf[n:]
        return result


def Transport(host, connect_timeout=None, ssl=False, **kwargs):
    """Create transport.

    Given a few parameters from the Connection constructor,
    select and create a subclass of
    :class:`~amqp.transport._AbstractTransport`.

    PARAMETERS:

        host: str

            Broker address in format ``HOSTNAME:PORT``.

        connect_timeout: int

            Timeout of creating new connection.

        ssl: bool|dict

            If set, :class:`~amqp.transport.SSLTransport` is used
            and ``ssl`` parameter is passed to it. Otherwise
            :class:`~amqp.transport.TCPTransport` is used.

        kwargs:

            additional arguments of :class:`~amqp.transport._AbstractTransport`
            class
    """
    transport = SSLTransport if ssl else TCPTransport
    return transport(host, connect_timeout=connect_timeout, ssl=ssl, **kwargs)
