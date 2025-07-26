# Copyright (c) 2012-2013 Mitch Garnaat http://garnaat.org/
# Copyright 2012-2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.

import datetime
import logging
import os
import threading
import time
import uuid

from botocore import parsers
from botocore.awsrequest import create_request_object
from botocore.exceptions import HTTPClientError
from botocore.history import get_global_history_recorder
from botocore.hooks import first_non_none_response
from botocore.httpchecksum import handle_checksum_body
from botocore.httpsession import URLLib3Session
from botocore.response import StreamingBody
from botocore.utils import (
    get_environ_proxies,
    is_valid_endpoint_url,
    is_valid_ipv6_endpoint_url,
)

logger = logging.getLogger(__name__)
history_recorder = get_global_history_recorder()
DEFAULT_TIMEOUT = 60
MAX_POOL_CONNECTIONS = 10


def convert_to_response_dict(http_response, operation_model):
    """Convert an HTTP response object to a request dict.

    This converts the requests library's HTTP response object to
    a dictionary.

    :type http_response: botocore.vendored.requests.model.Response
    :param http_response: The HTTP response from an AWS service request.

    :rtype: dict
    :return: A response dictionary which will contain the following keys:
        * headers (dict)
        * status_code (int)
        * body (string or file-like object)

    """
    response_dict = {
        'headers': http_response.headers,
        'status_code': http_response.status_code,
        'context': {
            'operation_name': operation_model.name,
        },
    }
    if response_dict['status_code'] >= 300:
        response_dict['body'] = http_response.content
    elif operation_model.has_event_stream_output:
        response_dict['body'] = http_response.raw
    elif operation_model.has_streaming_output:
        length = response_dict['headers'].get('content-length')
        response_dict['body'] = StreamingBody(http_response.raw, length)
    else:
        response_dict['body'] = http_response.content
    return response_dict


class Endpoint:
    """
    Represents an endpoint for a particular service in a specific
    region.  Only an endpoint can make requests.

    :ivar service: The Service object that describes this endpoints
        service.
    :ivar host: The fully qualified endpoint hostname.
    :ivar session: The session object.
    """

    def __init__(
        self,
        host,
        endpoint_prefix,
        event_emitter,
        response_parser_factory=None,
        http_session=None,
    ):
        self._endpoint_prefix = endpoint_prefix
        self._event_emitter = event_emitter
        self.host = host
        self._lock = threading.Lock()
        if response_parser_factory is None:
            response_parser_factory = parsers.ResponseParserFactory()
        self._response_parser_factory = response_parser_factory
        self.http_session = http_session
        if self.http_session is None:
            self.http_session = URLLib3Session()

    def __repr__(self):
        return f'{self._endpoint_prefix}({self.host})'

    def close(self):
        self.http_session.close()

    def make_request(self, operation_model, request_dict):
        logger.debug(
            "Making request for %s with params: %s",
            operation_model,
            request_dict,
        )
        return self._send_request(request_dict, operation_model)

    def create_request(self, params, operation_model=None):
        request = create_request_object(params)
        if operation_model:
            request.stream_output = any(
                [
                    operation_model.has_streaming_output,
                    operation_model.has_event_stream_output,
                ]
            )
            service_id = operation_model.service_model.service_id.hyphenize()
            event_name = f'request-created.{service_id}.{operation_model.name}'
            self._event_emitter.emit(
                event_name,
                request=request,
                operation_name=operation_model.name,
            )
        prepared_request = self.prepare_request(request)
        return prepared_request

    def _encode_headers(self, headers):
        # In place encoding of headers to utf-8 if they are unicode.
        for key, value in headers.items():
            if isinstance(value, str):
                headers[key] = value.encode('utf-8')

    def prepare_request(self, request):
        self._encode_headers(request.headers)
        return request.prepare()

    def _calculate_ttl(
        self, response_received_timestamp, date_header, read_timeout
    ):
        local_timestamp = datetime.datetime.utcnow()
        date_conversion = datetime.datetime.strptime(
            date_header, "%a, %d %b %Y %H:%M:%S %Z"
        )
        estimated_skew = date_conversion - response_received_timestamp
        ttl = (
            local_timestamp
            + datetime.timedelta(seconds=read_timeout)
            + estimated_skew
        )
        return ttl.strftime('%Y%m%dT%H%M%SZ')

    def _set_ttl(self, retries_context, read_timeout, success_response):
        response_date_header = success_response[0].headers.get('Date')
        has_streaming_input = retries_context.get('has_streaming_input')
        if response_date_header and not has_streaming_input:
            try:
                response_received_timestamp = datetime.datetime.utcnow()
                retries_context['ttl'] = self._calculate_ttl(
                    response_received_timestamp,
                    response_date_header,
                    read_timeout,
                )
            except Exception:
                logger.debug(
                    "Exception received when updating retries context with TTL",
                    exc_info=True,
                )

    def _update_retries_context(self, context, attempt, success_response=None):
        retries_context = context.setdefault('retries', {})
        retries_context['attempt'] = attempt
        if 'invocation-id' not in retries_context:
            retries_context['invocation-id'] = str(uuid.uuid4())

        if success_response:
            read_timeout = context['client_config'].read_timeout
            self._set_ttl(retries_context, read_timeout, success_response)

    def _send_request(self, request_dict, operation_model):
        attempts = 1
        context = request_dict['context']
        self._update_retries_context(context, attempts)
        request = self.create_request(request_dict, operation_model)
        success_response, exception = self._get_response(
            request, operation_model, context
        )
        while self._needs_retry(
            attempts,
            operation_model,
            request_dict,
            success_response,
            exception,
        ):
            attempts += 1
            self._update_retries_context(context, attempts, success_response)
            # If there is a stream associated with the request, we need
            # to reset it before attempting to send the request again.
            # This will ensure that we resend the entire contents of the
            # body.
            request.reset_stream()
            # Create a new request when retried (including a new signature).
            request = self.create_request(request_dict, operation_model)
            success_response, exception = self._get_response(
                request, operation_model, context
            )
        if (
            success_response is not None
            and 'ResponseMetadata' in success_response[1]
        ):
            # We want to share num retries, not num attempts.
            total_retries = attempts - 1
            success_response[1]['ResponseMetadata']['RetryAttempts'] = (
                total_retries
            )
        if exception is not None:
            raise exception
        else:
            return success_response

    def _get_response(self, request, operation_model, context):
        # This will return a tuple of (success_response, exception)
        # and success_response is itself a tuple of
        # (http_response, parsed_dict).
        # If an exception occurs then the success_response is None.
        # If no exception occurs then exception is None.
        success_response, exception = self._do_get_response(
            request, operation_model, context
        )
        kwargs_to_emit = {
            'response_dict': None,
            'parsed_response': None,
            'context': context,
            'exception': exception,
        }
        if success_response is not None:
            http_response, parsed_response = success_response
            kwargs_to_emit['parsed_response'] = parsed_response
            kwargs_to_emit['response_dict'] = convert_to_response_dict(
                http_response, operation_model
            )
        service_id = operation_model.service_model.service_id.hyphenize()
        self._event_emitter.emit(
            f"response-received.{service_id}.{operation_model.name}",
            **kwargs_to_emit,
        )
        return success_response, exception

    def _do_get_response(self, request, operation_model, context):
        try:
            logger.debug("Sending http request: %s", request)
            history_recorder.record(
                'HTTP_REQUEST',
                {
                    'method': request.method,
                    'headers': request.headers,
                    'streaming': operation_model.has_streaming_input,
                    'url': request.url,
                    'body': request.body,
                },
            )
            service_id = operation_model.service_model.service_id.hyphenize()
            event_name = f"before-send.{service_id}.{operation_model.name}"
            responses = self._event_emitter.emit(event_name, request=request)
            http_response = first_non_none_response(responses)
            if http_response is None:
                http_response = self._send(request)
        except HTTPClientError as e:
            return (None, e)
        except Exception as e:
            logger.debug(
                "Exception received when sending HTTP request.", exc_info=True
            )
            return (None, e)
        # This returns the http_response and the parsed_data.
        response_dict = convert_to_response_dict(
            http_response, operation_model
        )
        handle_checksum_body(
            http_response,
            response_dict,
            context,
            operation_model,
        )

        http_response_record_dict = response_dict.copy()
        http_response_record_dict['streaming'] = (
            operation_model.has_streaming_output
        )
        history_recorder.record('HTTP_RESPONSE', http_response_record_dict)

        protocol = operation_model.metadata['protocol']
        parser = self._response_parser_factory.create_parser(protocol)
        parsed_response = parser.parse(
            response_dict, operation_model.output_shape
        )
        # Do a second parsing pass to pick up on any modeled error fields
        # NOTE: Ideally, we would push this down into the parser classes but
        # they currently have no reference to the operation or service model
        # The parsers should probably take the operation model instead of
        # output shape but we can't change that now
        if http_response.status_code >= 300:
            self._add_modeled_error_fields(
                response_dict,
                parsed_response,
                operation_model,
                parser,
            )
        history_recorder.record('PARSED_RESPONSE', parsed_response)
        return (http_response, parsed_response), None

    def _add_modeled_error_fields(
        self,
        response_dict,
        parsed_response,
        operation_model,
        parser,
    ):
        error_code = parsed_response.get("Error", {}).get("Code")
        if error_code is None:
            return
        service_model = operation_model.service_model
        error_shape = service_model.shape_for_error_code(error_code)
        if error_shape is None:
            return
        modeled_parse = parser.parse(response_dict, error_shape)
        # TODO: avoid naming conflicts with ResponseMetadata and Error
        parsed_response.update(modeled_parse)

    def _needs_retry(
        self,
        attempts,
        operation_model,
        request_dict,
        response=None,
        caught_exception=None,
    ):
        service_id = operation_model.service_model.service_id.hyphenize()
        event_name = f"needs-retry.{service_id}.{operation_model.name}"
        responses = self._event_emitter.emit(
            event_name,
            response=response,
            endpoint=self,
            operation=operation_model,
            attempts=attempts,
            caught_exception=caught_exception,
            request_dict=request_dict,
        )
        handler_response = first_non_none_response(responses)
        if handler_response is None:
            return False
        else:
            # Request needs to be retried, and we need to sleep
            # for the specified number of times.
            logger.debug(
                "Response received to retry, sleeping for %s seconds",
                handler_response,
            )
            time.sleep(handler_response)
            return True

    def _send(self, request):
        return self.http_session.send(request)


class EndpointCreator:
    def __init__(self, event_emitter):
        self._event_emitter = event_emitter

    def create_endpoint(
        self,
        service_model,
        region_name,
        endpoint_url,
        verify=None,
        response_parser_factory=None,
        timeout=DEFAULT_TIMEOUT,
        max_pool_connections=MAX_POOL_CONNECTIONS,
        http_session_cls=URLLib3Session,
        proxies=None,
        socket_options=None,
        client_cert=None,
        proxies_config=None,
    ):
        if not is_valid_endpoint_url(
            endpoint_url
        ) and not is_valid_ipv6_endpoint_url(endpoint_url):
            raise ValueError(f"Invalid endpoint: {endpoint_url}")

        if proxies is None:
            proxies = self._get_proxies(endpoint_url)
        endpoint_prefix = service_model.endpoint_prefix

        logger.debug('Setting %s timeout as %s', endpoint_prefix, timeout)
        http_session = http_session_cls(
            timeout=timeout,
            proxies=proxies,
            verify=self._get_verify_value(verify),
            max_pool_connections=max_pool_connections,
            socket_options=socket_options,
            client_cert=client_cert,
            proxies_config=proxies_config,
        )

        return Endpoint(
            endpoint_url,
            endpoint_prefix=endpoint_prefix,
            event_emitter=self._event_emitter,
            response_parser_factory=response_parser_factory,
            http_session=http_session,
        )

    def _get_proxies(self, url):
        # We could also support getting proxies from a config file,
        # but for now proxy support is taken from the environment.
        return get_environ_proxies(url)

    def _get_verify_value(self, verify):
        # This is to account for:
        # https://github.com/kennethreitz/requests/issues/1436
        # where we need to honor REQUESTS_CA_BUNDLE because we're creating our
        # own request objects.
        # First, if verify is not None, then the user explicitly specified
        # a value so this automatically wins.
        if verify is not None:
            return verify
        # Otherwise use the value from REQUESTS_CA_BUNDLE, or default to
        # True if the env var does not exist.
        return os.environ.get('REQUESTS_CA_BUNDLE', True)
