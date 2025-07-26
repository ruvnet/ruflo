"""Amazon AWS Connection."""

from __future__ import annotations

from email import message_from_bytes
from email.mime.message import MIMEMessage

from vine import promise, transform

from kombu.asynchronous.aws.ext import AWSRequest, get_cert_path, get_response
from kombu.asynchronous.http import Headers, Request, get_client


def message_from_headers(hdr):
    bs = "\r\n".join("{}: {}".format(*h) for h in hdr)
    return message_from_bytes(bs.encode())


__all__ = (
    'AsyncHTTPSConnection', 'AsyncConnection',
)


class AsyncHTTPResponse:
    """Async HTTP Response."""

    def __init__(self, response):
        self.response = response
        self._msg = None
        self.version = 10

    def read(self, *args, **kwargs):
        return self.response.body

    def getheader(self, name, default=None):
        return self.response.headers.get(name, default)

    def getheaders(self):
        return list(self.response.headers.items())

    @property
    def msg(self):
        if self._msg is None:
            self._msg = MIMEMessage(message_from_headers(self.getheaders()))
        return self._msg

    @property
    def status(self):
        return self.response.code

    @property
    def reason(self):
        if self.response.error:
            return self.response.error.message
        return ''

    def __repr__(self):
        return repr(self.response)


class AsyncHTTPSConnection:
    """Async HTTP Connection."""

    Request = Request
    Response = AsyncHTTPResponse

    method = 'GET'
    path = '/'
    body = None
    default_ports = {'http': 80, 'https': 443}

    def __init__(self, strict=None, timeout=20.0, http_client=None):
        self.headers = []
        self.timeout = timeout
        self.strict = strict
        self.http_client = http_client or get_client()

    def request(self, method, path, body=None, headers=None):
        self.path = path
        self.method = method
        if body is not None:
            try:
                read = body.read
            except AttributeError:
                self.body = body
            else:
                self.body = read()
        if headers is not None:
            self.headers.extend(list(headers.items()))

    def getrequest(self):
        headers = Headers(self.headers)
        return self.Request(self.path, method=self.method, headers=headers,
                            body=self.body, connect_timeout=self.timeout,
                            request_timeout=self.timeout,
                            validate_cert=True, ca_certs=get_cert_path(True))

    def getresponse(self, callback=None):
        request = self.getrequest()
        request.then(transform(self.Response, callback))
        return self.http_client.add_request(request)

    def set_debuglevel(self, level):
        pass

    def connect(self):
        pass

    def close(self):
        pass

    def putrequest(self, method, path):
        self.method = method
        self.path = path

    def putheader(self, header, value):
        self.headers.append((header, value))

    def endheaders(self):
        pass

    def send(self, data):
        if self.body:
            self.body += data
        else:
            self.body = data

    def __repr__(self):
        return f'<AsyncHTTPConnection: {self.getrequest()!r}>'


class AsyncConnection:
    """Async AWS Connection."""

    def __init__(self, sqs_connection, http_client=None, **kwargs):
        self.sqs_connection = sqs_connection
        self._httpclient = http_client or get_client()

    def get_http_connection(self):
        return AsyncHTTPSConnection(http_client=self._httpclient)

    def _mexe(self, request, sender=None, callback=None):
        callback = callback or promise()
        conn = self.get_http_connection()

        if callable(sender):
            sender(conn, request.method, request.path, request.body,
                   request.headers, callback)
        else:
            conn.request(request.method, request.url,
                         request.body, request.headers)
            conn.getresponse(callback=callback)
        return callback


class AsyncAWSQueryConnection(AsyncConnection):
    """Async AWS Query Connection."""

    STATUS_CODE_OK = 200
    STATUS_CODE_REQUEST_TIMEOUT = 408
    STATUS_CODE_NETWORK_CONNECT_TIMEOUT_ERROR = 599
    STATUS_CODE_INTERNAL_ERROR = 500
    STATUS_CODE_BAD_GATEWAY = 502
    STATUS_CODE_SERVICE_UNAVAILABLE_ERROR = 503
    STATUS_CODE_GATEWAY_TIMEOUT = 504

    STATUS_CODES_SERVER_ERRORS = (
        STATUS_CODE_INTERNAL_ERROR,
        STATUS_CODE_BAD_GATEWAY,
        STATUS_CODE_SERVICE_UNAVAILABLE_ERROR
    )

    STATUS_CODES_TIMEOUT = (
        STATUS_CODE_REQUEST_TIMEOUT,
        STATUS_CODE_NETWORK_CONNECT_TIMEOUT_ERROR,
        STATUS_CODE_GATEWAY_TIMEOUT
    )

    def __init__(self, sqs_connection, http_client=None,
                 http_client_params=None, **kwargs):
        if not http_client_params:
            http_client_params = {}
        super().__init__(sqs_connection, http_client,
                         **http_client_params)

    def make_request(self, operation, params_, path, verb, callback=None, protocol_params=None):
        params = params_.copy()
        params.update((protocol_params or {}).get('query', {}))
        if operation:
            params['Action'] = operation
        signer = self.sqs_connection._request_signer

        # defaults for non-get
        signing_type = 'standard'
        param_payload = {'data': params}
        if verb.lower() == 'get':
            # query-based opts
            signing_type = 'presign-url'
            param_payload = {'params': params}

        request = AWSRequest(method=verb, url=path, **param_payload)
        signer.sign(operation, request, signing_type=signing_type)
        prepared_request = request.prepare()

        return self._mexe(prepared_request, callback=callback)

    def get_list(self, operation, params, markers, path='/', parent=None, verb='POST', callback=None,
                 protocol_params=None):
        return self.make_request(
            operation, params, path, verb,
            callback=transform(
                self._on_list_ready, callback, parent or self, markers,
                operation
            ),
            protocol_params=protocol_params,
        )

    def get_object(self, operation, params, path='/', parent=None, verb='GET', callback=None, protocol_params=None):
        return self.make_request(
            operation, params, path, verb,
            callback=transform(
                self._on_obj_ready, callback, parent or self, operation
            ),
            protocol_params=protocol_params,
        )

    def get_status(self, operation, params, path='/', parent=None, verb='GET', callback=None, protocol_params=None):
        return self.make_request(
            operation, params, path, verb,
            callback=transform(
                self._on_status_ready, callback, parent or self, operation
            ),
            protocol_params=protocol_params,
        )

    def _on_list_ready(self, parent, markers, operation, response):
        service_model = self.sqs_connection.meta.service_model
        if response.status == self.STATUS_CODE_OK:
            _, parsed = get_response(
                service_model.operation_model(operation), response.response
            )
            return parsed
        elif (
            response.status in self.STATUS_CODES_TIMEOUT or
            response.status in self.STATUS_CODES_SERVER_ERRORS
        ):
            # When the server returns a timeout or 50X server error,
            # the response is interpreted as an empty list.
            # This prevents hanging the Celery worker.
            return []
        else:
            raise self._for_status(response, response.read())

    def _on_obj_ready(self, parent, operation, response):
        service_model = self.sqs_connection.meta.service_model
        if response.status == self.STATUS_CODE_OK:
            _, parsed = get_response(
                service_model.operation_model(operation), response.response
            )
            return parsed
        else:
            raise self._for_status(response, response.read())

    def _on_status_ready(self, parent, operation, response):
        service_model = self.sqs_connection.meta.service_model
        if response.status == self.STATUS_CODE_OK:
            httpres, _ = get_response(
                service_model.operation_model(operation), response.response
            )
            return httpres.code
        else:
            raise self._for_status(response, response.read())

    def _for_status(self, response, body):
        context = 'Empty body' if not body else 'HTTP Error'
        return Exception("Request {}  HTTP {}  {} ({})".format(
            context, response.status, response.reason, body
        ))
