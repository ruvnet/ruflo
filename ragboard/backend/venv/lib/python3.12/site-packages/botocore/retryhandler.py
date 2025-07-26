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

import functools
import logging
import random
from binascii import crc32

from botocore.exceptions import (
    ChecksumError,
    ConnectionClosedError,
    ConnectionError,
    EndpointConnectionError,
    ReadTimeoutError,
)

logger = logging.getLogger(__name__)
# The only supported error for now is GENERAL_CONNECTION_ERROR
# which maps to requests generic ConnectionError.  If we're able
# to get more specific exceptions from requests we can update
# this mapping with more specific exceptions.
EXCEPTION_MAP = {
    'GENERAL_CONNECTION_ERROR': [
        ConnectionError,
        ConnectionClosedError,
        ReadTimeoutError,
        EndpointConnectionError,
    ],
}


def delay_exponential(base, growth_factor, attempts):
    """Calculate time to sleep based on exponential function.

    The format is::

        base * growth_factor ^ (attempts - 1)

    If ``base`` is set to 'rand' then a random number between
    0 and 1 will be used as the base.
    Base must be greater than 0, otherwise a ValueError will be
    raised.

    """
    if base == 'rand':
        base = random.random()
    elif base <= 0:
        raise ValueError(
            f"The 'base' param must be greater than 0, got: {base}"
        )
    time_to_sleep = base * (growth_factor ** (attempts - 1))
    return time_to_sleep


def create_exponential_delay_function(base, growth_factor):
    """Create an exponential delay function based on the attempts.

    This is used so that you only have to pass it the attempts
    parameter to calculate the delay.

    """
    return functools.partial(
        delay_exponential, base=base, growth_factor=growth_factor
    )


def create_retry_handler(config, operation_name=None):
    checker = create_checker_from_retry_config(
        config, operation_name=operation_name
    )
    action = create_retry_action_from_config(
        config, operation_name=operation_name
    )
    return RetryHandler(checker=checker, action=action)


def create_retry_action_from_config(config, operation_name=None):
    # The spec has the possibility of supporting per policy
    # actions, but right now, we assume this comes from the
    # default section, which means that delay functions apply
    # for every policy in the retry config (per service).
    delay_config = config['__default__']['delay']
    if delay_config['type'] == 'exponential':
        return create_exponential_delay_function(
            base=delay_config['base'],
            growth_factor=delay_config['growth_factor'],
        )


def create_checker_from_retry_config(config, operation_name=None):
    checkers = []
    max_attempts = None
    retryable_exceptions = []
    if '__default__' in config:
        policies = config['__default__'].get('policies', [])
        max_attempts = config['__default__']['max_attempts']
        for key in policies:
            current_config = policies[key]
            checkers.append(_create_single_checker(current_config))
            retry_exception = _extract_retryable_exception(current_config)
            if retry_exception is not None:
                retryable_exceptions.extend(retry_exception)
    if operation_name is not None and config.get(operation_name) is not None:
        operation_policies = config[operation_name]['policies']
        for key in operation_policies:
            checkers.append(_create_single_checker(operation_policies[key]))
            retry_exception = _extract_retryable_exception(
                operation_policies[key]
            )
            if retry_exception is not None:
                retryable_exceptions.extend(retry_exception)
    if len(checkers) == 1:
        # Don't need to use a MultiChecker
        return MaxAttemptsDecorator(checkers[0], max_attempts=max_attempts)
    else:
        multi_checker = MultiChecker(checkers)
        return MaxAttemptsDecorator(
            multi_checker,
            max_attempts=max_attempts,
            retryable_exceptions=tuple(retryable_exceptions),
        )


def _create_single_checker(config):
    if 'response' in config['applies_when']:
        return _create_single_response_checker(
            config['applies_when']['response']
        )
    elif 'socket_errors' in config['applies_when']:
        return ExceptionRaiser()


def _create_single_response_checker(response):
    if 'service_error_code' in response:
        checker = ServiceErrorCodeChecker(
            status_code=response['http_status_code'],
            error_code=response['service_error_code'],
        )
    elif 'http_status_code' in response:
        checker = HTTPStatusCodeChecker(
            status_code=response['http_status_code']
        )
    elif 'crc32body' in response:
        checker = CRC32Checker(header=response['crc32body'])
    else:
        # TODO: send a signal.
        raise ValueError("Unknown retry policy")
    return checker


def _extract_retryable_exception(config):
    applies_when = config['applies_when']
    if 'crc32body' in applies_when.get('response', {}):
        return [ChecksumError]
    elif 'socket_errors' in applies_when:
        exceptions = []
        for name in applies_when['socket_errors']:
            exceptions.extend(EXCEPTION_MAP[name])
        return exceptions


class RetryHandler:
    """Retry handler.

    The retry handler takes two params, ``checker`` object
    and an ``action`` object.

    The ``checker`` object must be a callable object and based on a response
    and an attempt number, determines whether or not sufficient criteria for
    a retry has been met.  If this is the case then the ``action`` object
    (which also is a callable) determines what needs to happen in the event
    of a retry.

    """

    def __init__(self, checker, action):
        self._checker = checker
        self._action = action

    def __call__(self, attempts, response, caught_exception, **kwargs):
        """Handler for a retry.

        Intended to be hooked up to an event handler (hence the **kwargs),
        this will process retries appropriately.

        """
        checker_kwargs = {
            'attempt_number': attempts,
            'response': response,
            'caught_exception': caught_exception,
        }
        if isinstance(self._checker, MaxAttemptsDecorator):
            retries_context = kwargs['request_dict']['context'].get('retries')
            checker_kwargs.update({'retries_context': retries_context})

        if self._checker(**checker_kwargs):
            result = self._action(attempts=attempts)
            logger.debug("Retry needed, action of: %s", result)
            return result
        logger.debug("No retry needed.")


class BaseChecker:
    """Base class for retry checkers.

    Each class is responsible for checking a single criteria that determines
    whether or not a retry should not happen.

    """

    def __call__(self, attempt_number, response, caught_exception):
        """Determine if retry criteria matches.

        Note that either ``response`` is not None and ``caught_exception`` is
        None or ``response`` is None and ``caught_exception`` is not None.

        :type attempt_number: int
        :param attempt_number: The total number of times we've attempted
            to send the request.

        :param response: The HTTP response (if one was received).

        :type caught_exception: Exception
        :param caught_exception: Any exception that was caught while trying to
            send the HTTP response.

        :return: True, if the retry criteria matches (and therefore a retry
            should occur.  False if the criteria does not match.

        """
        # The default implementation allows subclasses to not have to check
        # whether or not response is None or not.
        if response is not None:
            return self._check_response(attempt_number, response)
        elif caught_exception is not None:
            return self._check_caught_exception(
                attempt_number, caught_exception
            )
        else:
            raise ValueError("Both response and caught_exception are None.")

    def _check_response(self, attempt_number, response):
        pass

    def _check_caught_exception(self, attempt_number, caught_exception):
        pass


class MaxAttemptsDecorator(BaseChecker):
    """Allow retries up to a maximum number of attempts.

    This will pass through calls to the decorated retry checker, provided
    that the number of attempts does not exceed max_attempts.  It will
    also catch any retryable_exceptions passed in.  Once max_attempts has
    been exceeded, then False will be returned or the retryable_exceptions
    that was previously being caught will be raised.

    """

    def __init__(self, checker, max_attempts, retryable_exceptions=None):
        self._checker = checker
        self._max_attempts = max_attempts
        self._retryable_exceptions = retryable_exceptions

    def __call__(
        self, attempt_number, response, caught_exception, retries_context
    ):
        if retries_context:
            retries_context['max'] = max(
                retries_context.get('max', 0), self._max_attempts
            )

        should_retry = self._should_retry(
            attempt_number, response, caught_exception
        )
        if should_retry:
            if attempt_number >= self._max_attempts:
                # explicitly set MaxAttemptsReached
                if response is not None and 'ResponseMetadata' in response[1]:
                    response[1]['ResponseMetadata']['MaxAttemptsReached'] = (
                        True
                    )
                logger.debug(
                    "Reached the maximum number of retry attempts: %s",
                    attempt_number,
                )
                return False
            else:
                return should_retry
        else:
            return False

    def _should_retry(self, attempt_number, response, caught_exception):
        if self._retryable_exceptions and attempt_number < self._max_attempts:
            try:
                return self._checker(
                    attempt_number, response, caught_exception
                )
            except self._retryable_exceptions as e:
                logger.debug(
                    "retry needed, retryable exception caught: %s",
                    e,
                    exc_info=True,
                )
                return True
        else:
            # If we've exceeded the max attempts we just let the exception
            # propagate if one has occurred.
            return self._checker(attempt_number, response, caught_exception)


class HTTPStatusCodeChecker(BaseChecker):
    def __init__(self, status_code):
        self._status_code = status_code

    def _check_response(self, attempt_number, response):
        if response[0].status_code == self._status_code:
            logger.debug(
                "retry needed: retryable HTTP status code received: %s",
                self._status_code,
            )
            return True
        else:
            return False


class ServiceErrorCodeChecker(BaseChecker):
    def __init__(self, status_code, error_code):
        self._status_code = status_code
        self._error_code = error_code

    def _check_response(self, attempt_number, response):
        if response[0].status_code == self._status_code:
            actual_error_code = response[1].get('Error', {}).get('Code')
            if actual_error_code == self._error_code:
                logger.debug(
                    "retry needed: matching HTTP status and error code seen: "
                    "%s, %s",
                    self._status_code,
                    self._error_code,
                )
                return True
        return False


class MultiChecker(BaseChecker):
    def __init__(self, checkers):
        self._checkers = checkers

    def __call__(self, attempt_number, response, caught_exception):
        for checker in self._checkers:
            checker_response = checker(
                attempt_number, response, caught_exception
            )
            if checker_response:
                return checker_response
        return False


class CRC32Checker(BaseChecker):
    def __init__(self, header):
        # The header where the expected crc32 is located.
        self._header_name = header

    def _check_response(self, attempt_number, response):
        http_response = response[0]
        expected_crc = http_response.headers.get(self._header_name)
        if expected_crc is None:
            logger.debug(
                "crc32 check skipped, the %s header is not "
                "in the http response.",
                self._header_name,
            )
        else:
            actual_crc32 = crc32(response[0].content) & 0xFFFFFFFF
            if not actual_crc32 == int(expected_crc):
                logger.debug(
                    "retry needed: crc32 check failed, expected != actual: "
                    "%s != %s",
                    int(expected_crc),
                    actual_crc32,
                )
                raise ChecksumError(
                    checksum_type='crc32',
                    expected_checksum=int(expected_crc),
                    actual_checksum=actual_crc32,
                )


class ExceptionRaiser(BaseChecker):
    """Raise any caught exceptions.

    This class will raise any non None ``caught_exception``.

    """

    def _check_caught_exception(self, attempt_number, caught_exception):
        # This is implementation specific, but this class is useful by
        # coordinating with the MaxAttemptsDecorator.
        # The MaxAttemptsDecorator has a list of exceptions it should catch
        # and retry, but something needs to come along and actually raise the
        # caught_exception.  That's what this class is being used for.  If
        # the MaxAttemptsDecorator is not interested in retrying the exception
        # then this exception just propagates out past the retry code.
        raise caught_exception
