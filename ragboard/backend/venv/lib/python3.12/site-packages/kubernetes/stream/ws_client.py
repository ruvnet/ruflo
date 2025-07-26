# Copyright 2018 The Kubernetes Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
import sys

from kubernetes.client.rest import ApiException, ApiValueError

import certifi
import collections
import select
import socket
import ssl
import threading
import time

import six
import yaml


from six.moves.urllib.parse import urlencode, urlparse, urlunparse
from six import StringIO, BytesIO

from websocket import WebSocket, ABNF, enableTrace, WebSocketConnectionClosedException
from base64 import urlsafe_b64decode
from requests.utils import should_bypass_proxies

STDIN_CHANNEL = 0
STDOUT_CHANNEL = 1
STDERR_CHANNEL = 2
ERROR_CHANNEL = 3
RESIZE_CHANNEL = 4

class _IgnoredIO:
    def write(self, _x):
        pass

    def getvalue(self):
        raise TypeError("Tried to read_all() from a WSClient configured to not capture. Did you mean `capture_all=True`?")


class WSClient:
    def __init__(self, configuration, url, headers, capture_all, binary=False):
        """A websocket client with support for channels.

            Exec command uses different channels for different streams. for
        example, 0 is stdin, 1 is stdout and 2 is stderr. Some other API calls
        like port forwarding can forward different pods' streams to different
        channels.
        """
        self._connected = False
        self._channels = {}
        self.binary = binary
        self.newline = '\n' if not self.binary else b'\n'
        if capture_all:
            self._all = StringIO() if not self.binary else BytesIO()
        else:
            self._all = _IgnoredIO()
        self.sock = create_websocket(configuration, url, headers)
        self._connected = True
        self._returncode = None

    def peek_channel(self, channel, timeout=0):
        """Peek a channel and return part of the input,
        empty string otherwise."""
        self.update(timeout=timeout)
        if channel in self._channels:
            return self._channels[channel]
        return ""

    def read_channel(self, channel, timeout=0):
        """Read data from a channel."""
        if channel not in self._channels:
            ret = self.peek_channel(channel, timeout)
        else:
            ret = self._channels[channel]
        if channel in self._channels:
            del self._channels[channel]
        return ret

    def readline_channel(self, channel, timeout=None):
        """Read a line from a channel."""
        if timeout is None:
            timeout = float("inf")
        start = time.time()
        while self.is_open() and time.time() - start < timeout:
            if channel in self._channels:
                data = self._channels[channel]
                if self.newline in data:
                    index = data.find(self.newline)
                    ret = data[:index]
                    data = data[index+1:]
                    if data:
                        self._channels[channel] = data
                    else:
                        del self._channels[channel]
                    return ret
            self.update(timeout=(timeout - time.time() + start))

    def write_channel(self, channel, data):
        """Write data to a channel."""
        # check if we're writing binary data or not
        binary = six.PY3 and type(data) == six.binary_type
        opcode = ABNF.OPCODE_BINARY if binary else ABNF.OPCODE_TEXT

        channel_prefix = chr(channel)
        if binary:
            channel_prefix = six.binary_type(channel_prefix, "ascii")

        payload = channel_prefix + data
        self.sock.send(payload, opcode=opcode)

    def peek_stdout(self, timeout=0):
        """Same as peek_channel with channel=1."""
        return self.peek_channel(STDOUT_CHANNEL, timeout=timeout)

    def read_stdout(self, timeout=None):
        """Same as read_channel with channel=1."""
        return self.read_channel(STDOUT_CHANNEL, timeout=timeout)

    def readline_stdout(self, timeout=None):
        """Same as readline_channel with channel=1."""
        return self.readline_channel(STDOUT_CHANNEL, timeout=timeout)

    def peek_stderr(self, timeout=0):
        """Same as peek_channel with channel=2."""
        return self.peek_channel(STDERR_CHANNEL, timeout=timeout)

    def read_stderr(self, timeout=None):
        """Same as read_channel with channel=2."""
        return self.read_channel(STDERR_CHANNEL, timeout=timeout)

    def readline_stderr(self, timeout=None):
        """Same as readline_channel with channel=2."""
        return self.readline_channel(STDERR_CHANNEL, timeout=timeout)

    def read_all(self):
        """Return buffered data received on stdout and stderr channels.
        This is useful for non-interactive call where a set of command passed
        to the API call and their result is needed after the call is concluded.
        Should be called after run_forever() or update()

        TODO: Maybe we can process this and return a more meaningful map with
        channels mapped for each input.
        """
        out = self._all.getvalue()
        self._all = self._all.__class__()
        self._channels = {}
        return out

    def is_open(self):
        """True if the connection is still alive."""
        return self._connected

    def write_stdin(self, data):
        """The same as write_channel with channel=0."""
        self.write_channel(STDIN_CHANNEL, data)

    def update(self, timeout=0):
        """Update channel buffers with at most one complete frame of input."""
        if not self.is_open():
            return
        if not self.sock.connected:
            self._connected = False
            return

        # The options here are:
        # select.select() - this will work on most OS, however, it has a
        #                   limitation of only able to read fd numbers up to 1024.
        #                   i.e. does not scale well. This was the original
        #                   implementation.
        # select.poll()   - this will work on most unix based OS, but not as
        #                   efficient as epoll. Will work for fd numbers above 1024.
        # select.epoll()  - newest and most efficient way of polling.
        #                   However, only works on linux.
        if hasattr(select, "poll"):
            poll = select.poll()
            poll.register(self.sock.sock, select.POLLIN)
            if timeout is not None:
                timeout *= 1_000  # poll method uses milliseconds as the time unit
            r = poll.poll(timeout)
            poll.unregister(self.sock.sock)
        else:
            r, _, _ = select.select(
                (self.sock.sock, ), (), (), timeout)

        if r:
            op_code, frame = self.sock.recv_data_frame(True)
            if op_code == ABNF.OPCODE_CLOSE:
                self._connected = False
                return
            elif op_code == ABNF.OPCODE_BINARY or op_code == ABNF.OPCODE_TEXT:
                data = frame.data
                if six.PY3 and not self.binary:
                    data = data.decode("utf-8", "replace")
                if len(data) > 1:
                    channel = data[0]
                    if six.PY3 and not self.binary:
                        channel = ord(channel)
                    data = data[1:]
                    if data:
                        if channel in [STDOUT_CHANNEL, STDERR_CHANNEL]:
                            # keeping all messages in the order they received
                            # for non-blocking call.
                            self._all.write(data)
                        if channel not in self._channels:
                            self._channels[channel] = data
                        else:
                            self._channels[channel] += data

    def run_forever(self, timeout=None):
        """Wait till connection is closed or timeout reached. Buffer any input
        received during this time."""
        if timeout:
            start = time.time()
            while self.is_open() and time.time() - start < timeout:
                self.update(timeout=(timeout - time.time() + start))
        else:
            while self.is_open():
                self.update(timeout=None)
    @property
    def returncode(self):
        """
        The return code, A None value indicates that the process hasn't
        terminated yet.
        """
        if self.is_open():
            return None
        else:
            if self._returncode is None:
                err = self.read_channel(ERROR_CHANNEL)
                err = yaml.safe_load(err)
                if err['status'] == "Success":
                    self._returncode = 0
                else:
                    self._returncode = int(err['details']['causes'][0]['message'])
            return self._returncode

    def close(self, **kwargs):
        """
        close websocket connection.
        """
        self._connected = False
        if self.sock:
            self.sock.close(**kwargs)


WSResponse = collections.namedtuple('WSResponse', ['data'])


class PortForward:
    def __init__(self, websocket, ports):
        """A websocket client with support for port forwarding.

        Port Forward command sends on 2 channels per port, a read/write
        data channel and a read only error channel. Both channels are sent an
        initial frame containing the port number that channel is associated with.
        """

        self.websocket = websocket
        self.local_ports = {}
        for ix, port_number in enumerate(ports):
            self.local_ports[port_number] = self._Port(ix, port_number)
        # There is a thread run per PortForward instance which performs the translation between the
        # raw socket data sent by the python application and the websocket protocol. This thread
        # terminates after either side has closed all ports, and after flushing all pending data.
        proxy = threading.Thread(
            name="Kubernetes port forward proxy: %s" % ', '.join([str(port) for port in ports]),
            target=self._proxy
        )
        proxy.daemon = True
        proxy.start()

    @property
    def connected(self):
        return self.websocket.connected

    def socket(self, port_number):
        if port_number not in self.local_ports:
            raise ValueError("Invalid port number")
        return self.local_ports[port_number].socket

    def error(self, port_number):
        if port_number not in self.local_ports:
            raise ValueError("Invalid port number")
        return self.local_ports[port_number].error

    def close(self):
        for port in self.local_ports.values():
            port.socket.close()

    class _Port:
        def __init__(self, ix, port_number):
            # The remote port number
            self.port_number = port_number
            # The websocket channel byte number for this port
            self.channel = six.int2byte(ix * 2)
            # A socket pair is created to provide a means of translating the data flow
            # between the python application and the kubernetes websocket. The self.python
            # half of the socket pair is used by the _proxy method to receive and send data
            # to the running python application.
            s, self.python = socket.socketpair()
            # The self.socket half of the pair is used by the python application to send
            # and receive data to the eventual pod port. It is wrapped in the _Socket class
            # because a socket pair is an AF_UNIX socket, not a AF_INET socket. This allows
            # intercepting setting AF_INET socket options that would error against an AF_UNIX
            # socket.
            self.socket = self._Socket(s)
            # Data accumulated from the websocket to be sent to the python application.
            self.data = b''
            # All data sent from kubernetes on the port error channel.
            self.error = None

        class _Socket:
            def __init__(self, socket):
                self._socket = socket

            def __getattr__(self, name):
                return getattr(self._socket, name)

            def setsockopt(self, level, optname, value):
                # The following socket option is not valid with a socket created from socketpair,
                # and is set by the http.client.HTTPConnection.connect method.
                if level == socket.IPPROTO_TCP and optname == socket.TCP_NODELAY:
                    return
                self._socket.setsockopt(level, optname, value)

    # Proxy all socket data between the python code and the kubernetes websocket.
    def _proxy(self):
        channel_ports = []
        channel_initialized = []
        local_ports = {}
        for port in self.local_ports.values():
            # Setup the data channel for this port number
            channel_ports.append(port)
            channel_initialized.append(False)
            # Setup the error channel for this port number
            channel_ports.append(port)
            channel_initialized.append(False)
            port.python.setblocking(True)
            local_ports[port.python] = port
        # The data to send on the websocket socket
        kubernetes_data = b''
        while True:
            rlist = [] # List of sockets to read from
            wlist = [] # List of sockets to write to
            if self.websocket.connected:
                rlist.append(self.websocket)
                if kubernetes_data:
                    wlist.append(self.websocket)
            local_all_closed = True
            for port in self.local_ports.values():
                if port.python.fileno() != -1:
                    if self.websocket.connected:
                        rlist.append(port.python)
                        if port.data:
                            wlist.append(port.python)
                        local_all_closed = False
                    else:
                        if port.data:
                            wlist.append(port.python)
                            local_all_closed = False
                        else:
                            port.python.close()
            if local_all_closed and not (self.websocket.connected and kubernetes_data):
                self.websocket.close()
                return
            r, w, _ = select.select(rlist, wlist, [])
            for sock in r:
                if sock == self.websocket:
                    pending = True
                    while pending:
                        try:
                            opcode, frame = self.websocket.recv_data_frame(True)
                        except WebSocketConnectionClosedException:
                            for port in self.local_ports.values():
                                port.python.close()
                            return
                        if opcode == ABNF.OPCODE_BINARY:
                            if not frame.data:
                                raise RuntimeError("Unexpected frame data size")
                            channel = six.byte2int(frame.data)
                            if channel >= len(channel_ports):
                                raise RuntimeError("Unexpected channel number: %s" % channel)
                            port = channel_ports[channel]
                            if channel_initialized[channel]:
                                if channel % 2:
                                    if port.error is None:
                                        port.error = ''
                                    port.error += frame.data[1:].decode()
                                    port.python.close()
                                else:
                                    port.data += frame.data[1:]
                            else:
                                if len(frame.data) != 3:
                                    raise RuntimeError(
                                        "Unexpected initial channel frame data size"
                                    )
                                port_number = six.byte2int(frame.data[1:2]) + (six.byte2int(frame.data[2:3]) * 256)
                                if port_number != port.port_number:
                                    raise RuntimeError(
                                        "Unexpected port number in initial channel frame: %s" % port_number
                                    )
                                channel_initialized[channel] = True
                        elif opcode not in (ABNF.OPCODE_PING, ABNF.OPCODE_PONG, ABNF.OPCODE_CLOSE):
                            raise RuntimeError("Unexpected websocket opcode: %s" % opcode)
                        if not (isinstance(self.websocket.sock, ssl.SSLSocket) and self.websocket.sock.pending()):
                            pending = False
                else:
                    port = local_ports[sock]
                    if port.python.fileno() != -1:
                        data = port.python.recv(1024 * 1024)
                        if data:
                            kubernetes_data += ABNF.create_frame(
                                port.channel + data,
                                ABNF.OPCODE_BINARY,
                            ).format()
                        else:
                            port.python.close()
            for sock in w:
                if sock == self.websocket:
                    sent = self.websocket.sock.send(kubernetes_data)
                    kubernetes_data = kubernetes_data[sent:]
                else:
                    port = local_ports[sock]
                    if port.python.fileno() != -1:
                        sent = port.python.send(port.data)
                        port.data = port.data[sent:]


def get_websocket_url(url, query_params=None):
    parsed_url = urlparse(url)
    parts = list(parsed_url)
    if parsed_url.scheme == 'http':
        parts[0] = 'ws'
    elif parsed_url.scheme == 'https':
        parts[0] = 'wss'
    if query_params:
        query = []
        for key, value in query_params:
            if key == 'command' and isinstance(value, list):
                for command in value:
                    query.append((key, command))
            else:
                query.append((key, value))
        if query:
            parts[4] = urlencode(query)
    return urlunparse(parts)


def create_websocket(configuration, url, headers=None):
    enableTrace(False)

    # We just need to pass the Authorization, ignore all the other
    # http headers we get from the generated code
    header = []
    if headers and 'authorization' in headers:
            header.append("authorization: %s" % headers['authorization'])
    if headers and 'sec-websocket-protocol' in headers:
        header.append("sec-websocket-protocol: %s" %
                      headers['sec-websocket-protocol'])
    else:
        header.append("sec-websocket-protocol: v4.channel.k8s.io")

    if url.startswith('wss://') and configuration.verify_ssl:
        ssl_opts = {
            'cert_reqs': ssl.CERT_REQUIRED,
            'ca_certs': configuration.ssl_ca_cert or certifi.where(),
        }
        if configuration.assert_hostname is not None:
            ssl_opts['check_hostname'] = configuration.assert_hostname
    else:
        ssl_opts = {'cert_reqs': ssl.CERT_NONE}

    if configuration.cert_file:
        ssl_opts['certfile'] = configuration.cert_file
    if configuration.key_file:
        ssl_opts['keyfile'] = configuration.key_file
    if configuration.tls_server_name:
        ssl_opts['server_hostname'] = configuration.tls_server_name

    websocket = WebSocket(sslopt=ssl_opts, skip_utf8_validation=False)
    connect_opt = {
         'header': header
    }

    if configuration.proxy or configuration.proxy_headers:
        connect_opt = websocket_proxycare(connect_opt, configuration, url, headers)

    websocket.connect(url, **connect_opt)
    return websocket

def websocket_proxycare(connect_opt, configuration, url, headers):
    """ An internal function to be called in api-client when a websocket
        create is requested.
    """
    if configuration.no_proxy:
        connect_opt.update({ 'http_no_proxy': configuration.no_proxy.split(',') })

    if configuration.proxy:
        proxy_url = urlparse(configuration.proxy)
        connect_opt.update({'http_proxy_host': proxy_url.hostname, 'http_proxy_port': proxy_url.port})
    if configuration.proxy_headers:
        for key,value in configuration.proxy_headers.items():
            if key == 'proxy-authorization' and value.startswith('Basic'):
                b64value = value.split()[1]
                auth = urlsafe_b64decode(b64value).decode().split(':')
                connect_opt.update({'http_proxy_auth': (auth[0], auth[1]) })
    return(connect_opt)


def websocket_call(configuration, _method, url, **kwargs):
    """An internal function to be called in api-client when a websocket
    connection is required. method, url, and kwargs are the parameters of
    apiClient.request method."""

    url = get_websocket_url(url, kwargs.get("query_params"))
    headers = kwargs.get("headers")
    _request_timeout = kwargs.get("_request_timeout", 60)
    _preload_content = kwargs.get("_preload_content", True)
    capture_all = kwargs.get("capture_all", True)
    binary = kwargs.get('binary', False)
    try:
        client = WSClient(configuration, url, headers, capture_all, binary=binary)
        if not _preload_content:
            return client
        client.run_forever(timeout=_request_timeout)
        all = client.read_all()
        if binary:
            return WSResponse(all)
        else:
            return WSResponse('%s' % ''.join(all))
    except (Exception, KeyboardInterrupt, SystemExit) as e:
        raise ApiException(status=0, reason=str(e))


def portforward_call(configuration, _method, url, **kwargs):
    """An internal function to be called in api-client when a websocket
    connection is required for port forwarding. args and kwargs are the
    parameters of apiClient.request method."""

    query_params = kwargs.get("query_params")

    ports = []
    for param, value in query_params:
        if param == 'ports':
            for port in value.split(','):
                try:
                    port_number = int(port)
                except ValueError:
                    raise ApiValueError("Invalid port number: %s" % port)
                if not (0 < port_number < 65536):
                    raise ApiValueError("Port number must be between 0 and 65536: %s" % port)
                if port_number in ports:
                    raise ApiValueError("Duplicate port numbers: %s" % port)
                ports.append(port_number)
    if not ports:
        raise ApiValueError("Missing required parameter `ports`")

    url = get_websocket_url(url, query_params)
    headers = kwargs.get("headers")

    try:
        websocket = create_websocket(configuration, url, headers)
        return PortForward(websocket, ports)
    except (Exception, KeyboardInterrupt, SystemExit) as e:
        raise ApiException(status=0, reason=str(e))
