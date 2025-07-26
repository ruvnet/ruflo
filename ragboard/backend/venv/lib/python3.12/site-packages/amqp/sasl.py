"""SASL mechanisms for AMQP authentication."""

import socket
import warnings
from io import BytesIO

from amqp.serialization import _write_table


class SASL:
    """The base class for all amqp SASL authentication mechanisms.

    You should sub-class this if you're implementing your own authentication.
    """

    @property
    def mechanism(self):
        """Return a bytes containing the SASL mechanism name."""
        raise NotImplementedError

    def start(self, connection):
        """Return the first response to a SASL challenge as a bytes object."""
        raise NotImplementedError


class PLAIN(SASL):
    """PLAIN SASL authentication mechanism.

    See https://tools.ietf.org/html/rfc4616 for details
    """

    mechanism = b'PLAIN'

    def __init__(self, username, password):
        self.username, self.password = username, password

    __slots__ = (
        "username",
        "password",
        )

    def start(self, connection):
        if self.username is None or self.password is None:
            return NotImplemented
        login_response = BytesIO()
        login_response.write(b'\0')
        login_response.write(self.username.encode('utf-8'))
        login_response.write(b'\0')
        login_response.write(self.password.encode('utf-8'))
        return login_response.getvalue()


class AMQPLAIN(SASL):
    """AMQPLAIN SASL authentication mechanism.

    This is a non-standard mechanism used by AMQP servers.
    """

    mechanism = b'AMQPLAIN'

    def __init__(self, username, password):
        self.username, self.password = username, password

    __slots__ = (
        "username",
        "password",
        )

    def start(self, connection):
        if self.username is None or self.password is None:
            return NotImplemented
        login_response = BytesIO()
        _write_table({b'LOGIN': self.username, b'PASSWORD': self.password},
                     login_response.write, [])
        # Skip the length at the beginning
        return login_response.getvalue()[4:]


def _get_gssapi_mechanism():
    try:
        import gssapi
        import gssapi.raw.misc  # Fail if the old python-gssapi is installed
    except ImportError:
        class FakeGSSAPI(SASL):
            """A no-op SASL mechanism for when gssapi isn't available."""

            mechanism = None

            def __init__(self, client_name=None, service=b'amqp',
                         rdns=False, fail_soft=False):
                if not fail_soft:
                    raise NotImplementedError(
                        "You need to install the `gssapi` module for GSSAPI "
                        "SASL support")

            def start(self):  # pragma: no cover
                return NotImplemented
        return FakeGSSAPI
    else:
        class GSSAPI(SASL):
            """GSSAPI SASL authentication mechanism.

            See https://tools.ietf.org/html/rfc4752 for details
            """

            mechanism = b'GSSAPI'

            def __init__(self, client_name=None, service=b'amqp',
                         rdns=False, fail_soft=False):
                if client_name and not isinstance(client_name, bytes):
                    client_name = client_name.encode('ascii')
                self.client_name = client_name
                self.fail_soft = fail_soft
                self.service = service
                self.rdns = rdns

            __slots__ = (
                "client_name",
                "fail_soft",
                "service",
                "rdns"
                )

            def get_hostname(self, connection):
                sock = connection.transport.sock
                if self.rdns and sock.family in (socket.AF_INET,
                                                 socket.AF_INET6):
                    peer = sock.getpeername()
                    hostname, _, _ = socket.gethostbyaddr(peer[0])
                else:
                    hostname = connection.transport.host
                if not isinstance(hostname, bytes):
                    hostname = hostname.encode('ascii')
                return hostname

            def start(self, connection):
                try:
                    if self.client_name:
                        creds = gssapi.Credentials(
                            name=gssapi.Name(self.client_name))
                    else:
                        creds = None
                    hostname = self.get_hostname(connection)
                    name = gssapi.Name(b'@'.join([self.service, hostname]),
                                       gssapi.NameType.hostbased_service)
                    context = gssapi.SecurityContext(name=name, creds=creds)
                    return context.step(None)
                except gssapi.raw.misc.GSSError:
                    if self.fail_soft:
                        return NotImplemented
                    else:
                        raise
        return GSSAPI


GSSAPI = _get_gssapi_mechanism()


class EXTERNAL(SASL):
    """EXTERNAL SASL mechanism.

    Enables external authentication, i.e. not handled through this protocol.
    Only passes 'EXTERNAL' as authentication mechanism, but no further
    authentication data.
    """

    mechanism = b'EXTERNAL'

    def start(self, connection):
        return b''


class RAW(SASL):
    """A generic custom SASL mechanism.

    This mechanism takes a mechanism name and response to send to the server,
    so can be used for simple custom authentication schemes.
    """

    mechanism = None

    def __init__(self, mechanism, response):
        assert isinstance(mechanism, bytes)
        assert isinstance(response, bytes)
        self.mechanism, self.response = mechanism, response
        warnings.warn("Passing login_method and login_response to Connection "
                      "is deprecated. Please implement a SASL subclass "
                      "instead.", DeprecationWarning)

    def start(self, connection):
        return self.response
