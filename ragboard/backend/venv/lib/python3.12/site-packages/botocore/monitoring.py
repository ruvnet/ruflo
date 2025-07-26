# Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
#     http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
import json
import logging
import re
import time

from botocore.compat import ensure_bytes, ensure_unicode, urlparse
from botocore.retryhandler import EXCEPTION_MAP as RETRYABLE_EXCEPTIONS

logger = logging.getLogger(__name__)


class Monitor:
    _EVENTS_TO_REGISTER = [
        'before-parameter-build',
        'request-created',
        'response-received',
        'after-call',
        'after-call-error',
    ]

    def __init__(self, adapter, publisher):
        """Abstraction for monitoring clients API calls

        :param adapter: An adapter that takes event emitter events
            and produces monitor events

        :param publisher: A publisher for generated monitor events
        """
        self._adapter = adapter
        self._publisher = publisher

    def register(self, event_emitter):
        """Register an event emitter to the monitor"""
        for event_to_register in self._EVENTS_TO_REGISTER:
            event_emitter.register_last(event_to_register, self.capture)

    def capture(self, event_name, **payload):
        """Captures an incoming event from the event emitter

        It will feed an event emitter event to the monitor's adaptor to create
        a monitor event and then publish that event to the monitor's publisher.
        """
        try:
            monitor_event = self._adapter.feed(event_name, payload)
            if monitor_event:
                self._publisher.publish(monitor_event)
        except Exception as e:
            logger.debug(
                'Exception %s raised by client monitor in handling event %s',
                e,
                event_name,
                exc_info=True,
            )


class MonitorEventAdapter:
    def __init__(self, time=time.time):
        """Adapts event emitter events to produce monitor events

        :type time: callable
        :param time: A callable that produces the current time
        """
        self._time = time

    def feed(self, emitter_event_name, emitter_payload):
        """Feed an event emitter event to generate a monitor event

        :type emitter_event_name: str
        :param emitter_event_name: The name of the event emitted

        :type emitter_payload: dict
        :param emitter_payload: The payload to associated to the event
            emitted

        :rtype: BaseMonitorEvent
        :returns: A monitor event based on the event emitter events
            fired
        """
        return self._get_handler(emitter_event_name)(**emitter_payload)

    def _get_handler(self, event_name):
        return getattr(
            self, '_handle_' + event_name.split('.')[0].replace('-', '_')
        )

    def _handle_before_parameter_build(self, model, context, **kwargs):
        context['current_api_call_event'] = APICallEvent(
            service=model.service_model.service_id,
            operation=model.wire_name,
            timestamp=self._get_current_time(),
        )

    def _handle_request_created(self, request, **kwargs):
        context = request.context
        new_attempt_event = context[
            'current_api_call_event'
        ].new_api_call_attempt(timestamp=self._get_current_time())
        new_attempt_event.request_headers = request.headers
        new_attempt_event.url = request.url
        context['current_api_call_attempt_event'] = new_attempt_event

    def _handle_response_received(
        self, parsed_response, context, exception, **kwargs
    ):
        attempt_event = context.pop('current_api_call_attempt_event')
        attempt_event.latency = self._get_latency(attempt_event)
        if parsed_response is not None:
            attempt_event.http_status_code = parsed_response[
                'ResponseMetadata'
            ]['HTTPStatusCode']
            attempt_event.response_headers = parsed_response[
                'ResponseMetadata'
            ]['HTTPHeaders']
            attempt_event.parsed_error = parsed_response.get('Error')
        else:
            attempt_event.wire_exception = exception
        return attempt_event

    def _handle_after_call(self, context, parsed, **kwargs):
        context['current_api_call_event'].retries_exceeded = parsed[
            'ResponseMetadata'
        ].get('MaxAttemptsReached', False)
        return self._complete_api_call(context)

    def _handle_after_call_error(self, context, exception, **kwargs):
        # If the after-call-error was emitted and the error being raised
        # was a retryable connection error, then the retries must have exceeded
        # for that exception as this event gets emitted **after** retries
        # happen.
        context[
            'current_api_call_event'
        ].retries_exceeded = self._is_retryable_exception(exception)
        return self._complete_api_call(context)

    def _is_retryable_exception(self, exception):
        return isinstance(
            exception, tuple(RETRYABLE_EXCEPTIONS['GENERAL_CONNECTION_ERROR'])
        )

    def _complete_api_call(self, context):
        call_event = context.pop('current_api_call_event')
        call_event.latency = self._get_latency(call_event)
        return call_event

    def _get_latency(self, event):
        return self._get_current_time() - event.timestamp

    def _get_current_time(self):
        return int(self._time() * 1000)


class BaseMonitorEvent:
    def __init__(self, service, operation, timestamp):
        """Base monitor event

        :type service: str
        :param service: A string identifying the service associated to
            the event

        :type operation: str
        :param operation: A string identifying the operation of service
            associated to the event

        :type timestamp: int
        :param timestamp: Epoch time in milliseconds from when the event began
        """
        self.service = service
        self.operation = operation
        self.timestamp = timestamp

    def __repr__(self):
        return f'{self.__class__.__name__}({self.__dict__!r})'

    def __eq__(self, other):
        if isinstance(other, self.__class__):
            return self.__dict__ == other.__dict__
        return False


class APICallEvent(BaseMonitorEvent):
    def __init__(
        self,
        service,
        operation,
        timestamp,
        latency=None,
        attempts=None,
        retries_exceeded=False,
    ):
        """Monitor event for a single API call

        This event corresponds to a single client method call, which includes
        every HTTP requests attempt made in order to complete the client call

        :type service: str
        :param service: A string identifying the service associated to
            the event

        :type operation: str
        :param operation: A string identifying the operation of service
            associated to the event

        :type timestamp: int
        :param timestamp: Epoch time in milliseconds from when the event began

        :type latency: int
        :param latency: The time in milliseconds to complete the client call

        :type attempts: list
        :param attempts: The list of APICallAttempts associated to the
            APICall

        :type retries_exceeded: bool
        :param retries_exceeded: True if API call exceeded retries. False
            otherwise
        """
        super().__init__(
            service=service, operation=operation, timestamp=timestamp
        )
        self.latency = latency
        self.attempts = attempts
        if attempts is None:
            self.attempts = []
        self.retries_exceeded = retries_exceeded

    def new_api_call_attempt(self, timestamp):
        """Instantiates APICallAttemptEvent associated to the APICallEvent

        :type timestamp: int
        :param timestamp: Epoch time in milliseconds to associate to the
            APICallAttemptEvent
        """
        attempt_event = APICallAttemptEvent(
            service=self.service, operation=self.operation, timestamp=timestamp
        )
        self.attempts.append(attempt_event)
        return attempt_event


class APICallAttemptEvent(BaseMonitorEvent):
    def __init__(
        self,
        service,
        operation,
        timestamp,
        latency=None,
        url=None,
        http_status_code=None,
        request_headers=None,
        response_headers=None,
        parsed_error=None,
        wire_exception=None,
    ):
        """Monitor event for a single API call attempt

        This event corresponds to a single HTTP request attempt in completing
        the entire client method call.

        :type service: str
        :param service: A string identifying the service associated to
            the event

        :type operation: str
        :param operation: A string identifying the operation of service
            associated to the event

        :type timestamp: int
        :param timestamp: Epoch time in milliseconds from when the HTTP request
            started

        :type latency: int
        :param latency: The time in milliseconds to complete the HTTP request
            whether it succeeded or failed

        :type url: str
        :param url: The URL the attempt was sent to

        :type http_status_code: int
        :param http_status_code: The HTTP status code of the HTTP response
            if there was a response

        :type request_headers: dict
        :param request_headers: The HTTP headers sent in making the HTTP
            request

        :type response_headers: dict
        :param response_headers: The HTTP headers returned in the HTTP response
            if there was a response

        :type parsed_error: dict
        :param parsed_error: The error parsed if the service returned an
            error back

        :type wire_exception: Exception
        :param wire_exception: The exception raised in sending the HTTP
            request (i.e. ConnectionError)
        """
        super().__init__(
            service=service, operation=operation, timestamp=timestamp
        )
        self.latency = latency
        self.url = url
        self.http_status_code = http_status_code
        self.request_headers = request_headers
        self.response_headers = response_headers
        self.parsed_error = parsed_error
        self.wire_exception = wire_exception


class CSMSerializer:
    _MAX_CLIENT_ID_LENGTH = 255
    _MAX_EXCEPTION_CLASS_LENGTH = 128
    _MAX_ERROR_CODE_LENGTH = 128
    _MAX_USER_AGENT_LENGTH = 256
    _MAX_MESSAGE_LENGTH = 512
    _RESPONSE_HEADERS_TO_EVENT_ENTRIES = {
        'x-amzn-requestid': 'XAmznRequestId',
        'x-amz-request-id': 'XAmzRequestId',
        'x-amz-id-2': 'XAmzId2',
    }
    _AUTH_REGEXS = {
        'v4': re.compile(
            r'AWS4-HMAC-SHA256 '
            r'Credential=(?P<access_key>\w+)/\d+/'
            r'(?P<signing_region>[a-z0-9-]+)/'
        ),
        's3': re.compile(r'AWS (?P<access_key>\w+):'),
    }
    _SERIALIZEABLE_EVENT_PROPERTIES = [
        'service',
        'operation',
        'timestamp',
        'attempts',
        'latency',
        'retries_exceeded',
        'url',
        'request_headers',
        'http_status_code',
        'response_headers',
        'parsed_error',
        'wire_exception',
    ]

    def __init__(self, csm_client_id):
        """Serializes monitor events to CSM (Client Side Monitoring) format

        :type csm_client_id: str
        :param csm_client_id: The application identifier to associate
            to the serialized events
        """
        self._validate_client_id(csm_client_id)
        self.csm_client_id = csm_client_id

    def _validate_client_id(self, csm_client_id):
        if len(csm_client_id) > self._MAX_CLIENT_ID_LENGTH:
            raise ValueError(
                f'The value provided for csm_client_id: {csm_client_id} exceeds '
                f'the maximum length of {self._MAX_CLIENT_ID_LENGTH} characters'
            )

    def serialize(self, event):
        """Serializes a monitor event to the CSM format

        :type event: BaseMonitorEvent
        :param event: The event to serialize to bytes

        :rtype: bytes
        :returns: The CSM serialized form of the event
        """
        event_dict = self._get_base_event_dict(event)
        event_type = self._get_event_type(event)
        event_dict['Type'] = event_type
        for attr in self._SERIALIZEABLE_EVENT_PROPERTIES:
            value = getattr(event, attr, None)
            if value is not None:
                getattr(self, '_serialize_' + attr)(
                    value, event_dict, event_type=event_type
                )
        return ensure_bytes(json.dumps(event_dict, separators=(',', ':')))

    def _get_base_event_dict(self, event):
        return {
            'Version': 1,
            'ClientId': self.csm_client_id,
        }

    def _serialize_service(self, service, event_dict, **kwargs):
        event_dict['Service'] = service

    def _serialize_operation(self, operation, event_dict, **kwargs):
        event_dict['Api'] = operation

    def _serialize_timestamp(self, timestamp, event_dict, **kwargs):
        event_dict['Timestamp'] = timestamp

    def _serialize_attempts(self, attempts, event_dict, **kwargs):
        event_dict['AttemptCount'] = len(attempts)
        if attempts:
            self._add_fields_from_last_attempt(event_dict, attempts[-1])

    def _add_fields_from_last_attempt(self, event_dict, last_attempt):
        if last_attempt.request_headers:
            # It does not matter which attempt to use to grab the region
            # for the ApiCall event, but SDKs typically do the last one.
            region = self._get_region(last_attempt.request_headers)
            if region is not None:
                event_dict['Region'] = region
            event_dict['UserAgent'] = self._get_user_agent(
                last_attempt.request_headers
            )
        if last_attempt.http_status_code is not None:
            event_dict['FinalHttpStatusCode'] = last_attempt.http_status_code
        if last_attempt.parsed_error is not None:
            self._serialize_parsed_error(
                last_attempt.parsed_error, event_dict, 'ApiCall'
            )
        if last_attempt.wire_exception is not None:
            self._serialize_wire_exception(
                last_attempt.wire_exception, event_dict, 'ApiCall'
            )

    def _serialize_latency(self, latency, event_dict, event_type):
        if event_type == 'ApiCall':
            event_dict['Latency'] = latency
        elif event_type == 'ApiCallAttempt':
            event_dict['AttemptLatency'] = latency

    def _serialize_retries_exceeded(
        self, retries_exceeded, event_dict, **kwargs
    ):
        event_dict['MaxRetriesExceeded'] = 1 if retries_exceeded else 0

    def _serialize_url(self, url, event_dict, **kwargs):
        event_dict['Fqdn'] = urlparse(url).netloc

    def _serialize_request_headers(
        self, request_headers, event_dict, **kwargs
    ):
        event_dict['UserAgent'] = self._get_user_agent(request_headers)
        if self._is_signed(request_headers):
            event_dict['AccessKey'] = self._get_access_key(request_headers)
        region = self._get_region(request_headers)
        if region is not None:
            event_dict['Region'] = region
        if 'X-Amz-Security-Token' in request_headers:
            event_dict['SessionToken'] = request_headers[
                'X-Amz-Security-Token'
            ]

    def _serialize_http_status_code(
        self, http_status_code, event_dict, **kwargs
    ):
        event_dict['HttpStatusCode'] = http_status_code

    def _serialize_response_headers(
        self, response_headers, event_dict, **kwargs
    ):
        for header, entry in self._RESPONSE_HEADERS_TO_EVENT_ENTRIES.items():
            if header in response_headers:
                event_dict[entry] = response_headers[header]

    def _serialize_parsed_error(
        self, parsed_error, event_dict, event_type, **kwargs
    ):
        field_prefix = 'Final' if event_type == 'ApiCall' else ''
        event_dict[field_prefix + 'AwsException'] = self._truncate(
            parsed_error['Code'], self._MAX_ERROR_CODE_LENGTH
        )
        event_dict[field_prefix + 'AwsExceptionMessage'] = self._truncate(
            parsed_error['Message'], self._MAX_MESSAGE_LENGTH
        )

    def _serialize_wire_exception(
        self, wire_exception, event_dict, event_type, **kwargs
    ):
        field_prefix = 'Final' if event_type == 'ApiCall' else ''
        event_dict[field_prefix + 'SdkException'] = self._truncate(
            wire_exception.__class__.__name__, self._MAX_EXCEPTION_CLASS_LENGTH
        )
        event_dict[field_prefix + 'SdkExceptionMessage'] = self._truncate(
            str(wire_exception), self._MAX_MESSAGE_LENGTH
        )

    def _get_event_type(self, event):
        if isinstance(event, APICallEvent):
            return 'ApiCall'
        elif isinstance(event, APICallAttemptEvent):
            return 'ApiCallAttempt'

    def _get_access_key(self, request_headers):
        auth_val = self._get_auth_value(request_headers)
        _, auth_match = self._get_auth_match(auth_val)
        return auth_match.group('access_key')

    def _get_region(self, request_headers):
        if not self._is_signed(request_headers):
            return None
        auth_val = self._get_auth_value(request_headers)
        signature_version, auth_match = self._get_auth_match(auth_val)
        if signature_version != 'v4':
            return None
        return auth_match.group('signing_region')

    def _get_user_agent(self, request_headers):
        return self._truncate(
            ensure_unicode(request_headers.get('User-Agent', '')),
            self._MAX_USER_AGENT_LENGTH,
        )

    def _is_signed(self, request_headers):
        return 'Authorization' in request_headers

    def _get_auth_value(self, request_headers):
        return ensure_unicode(request_headers['Authorization'])

    def _get_auth_match(self, auth_val):
        for signature_version, regex in self._AUTH_REGEXS.items():
            match = regex.match(auth_val)
            if match:
                return signature_version, match
        return None, None

    def _truncate(self, text, max_length):
        if len(text) > max_length:
            logger.debug(
                'Truncating following value to maximum length of ' '%s: %s',
                text,
                max_length,
            )
            return text[:max_length]
        return text


class SocketPublisher:
    _MAX_MONITOR_EVENT_LENGTH = 8 * 1024

    def __init__(self, socket, host, port, serializer):
        """Publishes monitor events to a socket

        :type socket: socket.socket
        :param socket: The socket object to use to publish events

        :type host: string
        :param host: The host to send events to

        :type port: integer
        :param port: The port on the host to send events to

        :param serializer: The serializer to use to serialize the event
            to a form that can be published to the socket. This must
            have a `serialize()` method that accepts a monitor event
            and return bytes
        """
        self._socket = socket
        self._address = (host, port)
        self._serializer = serializer

    def publish(self, event):
        """Publishes a specified monitor event

        :type event: BaseMonitorEvent
        :param event: The monitor event to be sent
            over the publisher's socket to the desired address.
        """
        serialized_event = self._serializer.serialize(event)
        if len(serialized_event) > self._MAX_MONITOR_EVENT_LENGTH:
            logger.debug(
                'Serialized event of size %s exceeds the maximum length '
                'allowed: %s. Not sending event to socket.',
                len(serialized_event),
                self._MAX_MONITOR_EVENT_LENGTH,
            )
            return
        self._socket.sendto(serialized_event, self._address)
