"""Standard retry behavior.

This contains the default standard retry behavior.
It provides consistent behavior with other AWS SDKs.

The key base classes uses for retries:

    * ``BaseRetryableChecker`` - Use to check a specific condition that
    indicates a retry should happen.  This can include things like
    max attempts, HTTP status code checks, error code checks etc.
    * ``RetryBackoff`` - Use to determine how long we should backoff until
    we retry a request.  This is the class that will implement delay such
    as exponential backoff.
    * ``RetryPolicy`` - Main class that determines if a retry should
    happen.  It can combine data from a various BaseRetryableCheckers
    to make a final call as to whether or not a retry should happen.
    It then uses a ``BaseRetryBackoff`` to determine how long to delay.
    * ``RetryHandler`` - The bridge between botocore's event system
    used by endpoint.py to manage retries and the interfaces defined
    in this module.

This allows us to define an API that has minimal coupling to the event
based API used by botocore.

"""

import logging
import random

from botocore.exceptions import (
    ConnectionError,
    ConnectTimeoutError,
    HTTPClientError,
    ReadTimeoutError,
)
from botocore.retries import quota, special
from botocore.retries.base import BaseRetryableChecker, BaseRetryBackoff

DEFAULT_MAX_ATTEMPTS = 3
logger = logging.getLogger(__name__)


def register_retry_handler(client, max_attempts=DEFAULT_MAX_ATTEMPTS):
    retry_quota = RetryQuotaChecker(quota.RetryQuota())

    service_id = client.meta.service_model.service_id
    service_event_name = service_id.hyphenize()
    client.meta.events.register(
        f'after-call.{service_event_name}', retry_quota.release_retry_quota
    )

    handler = RetryHandler(
        retry_policy=RetryPolicy(
            retry_checker=StandardRetryConditions(max_attempts=max_attempts),
            retry_backoff=ExponentialBackoff(),
        ),
        retry_event_adapter=RetryEventAdapter(),
        retry_quota=retry_quota,
    )

    unique_id = f'retry-config-{service_event_name}'
    client.meta.events.register(
        f'needs-retry.{service_event_name}',
        handler.needs_retry,
        unique_id=unique_id,
    )
    return handler


class RetryHandler:
    """Bridge between botocore's event system and this module.

    This class is intended to be hooked to botocore's event system
    as an event handler.
    """

    def __init__(self, retry_policy, retry_event_adapter, retry_quota):
        self._retry_policy = retry_policy
        self._retry_event_adapter = retry_event_adapter
        self._retry_quota = retry_quota

    def needs_retry(self, **kwargs):
        """Connect as a handler to the needs-retry event."""
        retry_delay = None
        context = self._retry_event_adapter.create_retry_context(**kwargs)
        if self._retry_policy.should_retry(context):
            # Before we can retry we need to ensure we have sufficient
            # capacity in our retry quota.
            if self._retry_quota.acquire_retry_quota(context):
                retry_delay = self._retry_policy.compute_retry_delay(context)
                logger.debug(
                    "Retry needed, retrying request after delay of: %s",
                    retry_delay,
                )
            else:
                logger.debug(
                    "Retry needed but retry quota reached, "
                    "not retrying request."
                )
        else:
            logger.debug("Not retrying request.")
        self._retry_event_adapter.adapt_retry_response_from_context(context)
        return retry_delay


class RetryEventAdapter:
    """Adapter to existing retry interface used in the endpoints layer.

    This existing interface for determining if a retry needs to happen
    is event based and used in ``botocore.endpoint``.  The interface has
    grown organically over the years and could use some cleanup.  This
    adapter converts that interface into the interface used by the
    new retry strategies.

    """

    def create_retry_context(self, **kwargs):
        """Create context based on needs-retry kwargs."""
        response = kwargs['response']
        if response is None:
            # If response is None it means that an exception was raised
            # because we never received a response from the service.  This
            # could be something like a ConnectionError we get from our
            # http layer.
            http_response = None
            parsed_response = None
        else:
            http_response, parsed_response = response
        # This provides isolation between the kwargs emitted in the
        # needs-retry event, and what this module uses to check for
        # retries.
        context = RetryContext(
            attempt_number=kwargs['attempts'],
            operation_model=kwargs['operation'],
            http_response=http_response,
            parsed_response=parsed_response,
            caught_exception=kwargs['caught_exception'],
            request_context=kwargs['request_dict']['context'],
        )
        return context

    def adapt_retry_response_from_context(self, context):
        """Modify response back to user back from context."""
        # This will mutate attributes that are returned back to the end
        # user.  We do it this way so that all the various retry classes
        # don't mutate any input parameters from the needs-retry event.
        metadata = context.get_retry_metadata()
        if context.parsed_response is not None:
            context.parsed_response.setdefault('ResponseMetadata', {}).update(
                metadata
            )


# Implementation note: this is meant to encapsulate all the misc stuff
# that gets sent in the needs-retry event.  This is mapped so that params
# are more clear and explicit.
class RetryContext:
    """Normalize a response that we use to check if a retry should occur.

    This class smoothes over the different types of responses we may get
    from a service including:

        * A modeled error response from the service that contains a service
          code and error message.
        * A raw HTTP response that doesn't contain service protocol specific
          error keys.
        * An exception received while attempting to retrieve a response.
          This could be a ConnectionError we receive from our HTTP layer which
          could represent that we weren't able to receive a response from
          the service.

    This class guarantees that at least one of the above attributes will be
    non None.

    This class is meant to provide a read-only view into the properties
    associated with a possible retryable response.  None of the properties
    are meant to be modified directly.

    """

    def __init__(
        self,
        attempt_number,
        operation_model=None,
        parsed_response=None,
        http_response=None,
        caught_exception=None,
        request_context=None,
    ):
        # 1-based attempt number.
        self.attempt_number = attempt_number
        self.operation_model = operation_model
        # This is the parsed response dictionary we get from parsing
        # the HTTP response from the service.
        self.parsed_response = parsed_response
        # This is an instance of botocore.awsrequest.AWSResponse.
        self.http_response = http_response
        # This is a subclass of Exception that will be non None if
        # an exception was raised when retrying to retrieve a response.
        self.caught_exception = caught_exception
        # This is the request context dictionary that's added to the
        # request dict.  This is used to story any additional state
        # about the request.  We use this for storing retry quota
        # capacity.
        if request_context is None:
            request_context = {}
        self.request_context = request_context
        self._retry_metadata = {}

    # These are misc helper methods to avoid duplication in the various
    # checkers.
    def get_error_code(self):
        """Check if there was a parsed response with an error code.

        If we could not find any error codes, ``None`` is returned.

        """
        if self.parsed_response is None:
            return
        error = self.parsed_response.get('Error', {})
        if not isinstance(error, dict):
            return
        return error.get('Code')

    def add_retry_metadata(self, **kwargs):
        """Add key/value pairs to the retry metadata.

        This allows any objects during the retry process to add
        metadata about any checks/validations that happened.

        This gets added to the response metadata in the retry handler.

        """
        self._retry_metadata.update(**kwargs)

    def get_retry_metadata(self):
        return self._retry_metadata.copy()


class RetryPolicy:
    def __init__(self, retry_checker, retry_backoff):
        self._retry_checker = retry_checker
        self._retry_backoff = retry_backoff

    def should_retry(self, context):
        return self._retry_checker.is_retryable(context)

    def compute_retry_delay(self, context):
        return self._retry_backoff.delay_amount(context)


class ExponentialBackoff(BaseRetryBackoff):
    _BASE = 2
    _MAX_BACKOFF = 20

    def __init__(self, max_backoff=20, random=random.random):
        self._base = self._BASE
        self._max_backoff = max_backoff
        self._random = random

    def delay_amount(self, context):
        """Calculates delay based on exponential backoff.

        This class implements truncated binary exponential backoff
        with jitter::

            t_i = rand(0, 1) * min(2 ** attempt, MAX_BACKOFF)

        where ``i`` is the request attempt (0 based).

        """
        # The context.attempt_number is a 1-based value, but we have
        # to calculate the delay based on i based a 0-based value.  We
        # want the first delay to just be ``rand(0, 1)``.
        return self._random() * min(
            (self._base ** (context.attempt_number - 1)),
            self._max_backoff,
        )


class MaxAttemptsChecker(BaseRetryableChecker):
    def __init__(self, max_attempts):
        self._max_attempts = max_attempts

    def is_retryable(self, context):
        under_max_attempts = context.attempt_number < self._max_attempts
        retries_context = context.request_context.get('retries')
        if retries_context:
            retries_context['max'] = max(
                retries_context.get('max', 0), self._max_attempts
            )
        if not under_max_attempts:
            logger.debug("Max attempts of %s reached.", self._max_attempts)
            context.add_retry_metadata(MaxAttemptsReached=True)
        return under_max_attempts


class TransientRetryableChecker(BaseRetryableChecker):
    _TRANSIENT_ERROR_CODES = [
        'RequestTimeout',
        'RequestTimeoutException',
        'PriorRequestNotComplete',
    ]
    _TRANSIENT_STATUS_CODES = [500, 502, 503, 504]
    _TRANSIENT_EXCEPTION_CLS = (
        ConnectionError,
        HTTPClientError,
    )

    def __init__(
        self,
        transient_error_codes=None,
        transient_status_codes=None,
        transient_exception_cls=None,
    ):
        if transient_error_codes is None:
            transient_error_codes = self._TRANSIENT_ERROR_CODES[:]
        if transient_status_codes is None:
            transient_status_codes = self._TRANSIENT_STATUS_CODES[:]
        if transient_exception_cls is None:
            transient_exception_cls = self._TRANSIENT_EXCEPTION_CLS
        self._transient_error_codes = transient_error_codes
        self._transient_status_codes = transient_status_codes
        self._transient_exception_cls = transient_exception_cls

    def is_retryable(self, context):
        if context.get_error_code() in self._transient_error_codes:
            return True
        if context.http_response is not None:
            if (
                context.http_response.status_code
                in self._transient_status_codes
            ):
                return True
        if context.caught_exception is not None:
            return isinstance(
                context.caught_exception, self._transient_exception_cls
            )
        return False


class ThrottledRetryableChecker(BaseRetryableChecker):
    # This is the union of all error codes we've seen that represent
    # a throttled error.
    _THROTTLED_ERROR_CODES = [
        'Throttling',
        'ThrottlingException',
        'ThrottledException',
        'RequestThrottledException',
        'TooManyRequestsException',
        'ProvisionedThroughputExceededException',
        'TransactionInProgressException',
        'RequestLimitExceeded',
        'BandwidthLimitExceeded',
        'LimitExceededException',
        'RequestThrottled',
        'SlowDown',
        'PriorRequestNotComplete',
        'EC2ThrottledException',
    ]

    def __init__(self, throttled_error_codes=None):
        if throttled_error_codes is None:
            throttled_error_codes = self._THROTTLED_ERROR_CODES[:]
        self._throttled_error_codes = throttled_error_codes

    def is_retryable(self, context):
        # Only the error code from a parsed service response is used
        # to determine if the response is a throttled response.
        return context.get_error_code() in self._throttled_error_codes


class ModeledRetryableChecker(BaseRetryableChecker):
    """Check if an error has been modeled as retryable."""

    def __init__(self):
        self._error_detector = ModeledRetryErrorDetector()

    def is_retryable(self, context):
        error_code = context.get_error_code()
        if error_code is None:
            return False
        return self._error_detector.detect_error_type(context) is not None


class ModeledRetryErrorDetector:
    """Checks whether or not an error is a modeled retryable error."""

    # There are return values from the detect_error_type() method.
    TRANSIENT_ERROR = 'TRANSIENT_ERROR'
    THROTTLING_ERROR = 'THROTTLING_ERROR'
    # This class is lower level than ModeledRetryableChecker, which
    # implements BaseRetryableChecker.  This object allows you to distinguish
    # between the various types of retryable errors.

    def detect_error_type(self, context):
        """Detect the error type associated with an error code and model.

        This will either return:

            * ``self.TRANSIENT_ERROR`` - If the error is a transient error
            * ``self.THROTTLING_ERROR`` - If the error is a throttling error
            * ``None`` - If the error is neither type of error.

        """
        error_code = context.get_error_code()
        op_model = context.operation_model
        if op_model is None or not op_model.error_shapes:
            return
        for shape in op_model.error_shapes:
            if shape.metadata.get('retryable') is not None:
                # Check if this error code matches the shape.  This can
                # be either by name or by a modeled error code.
                error_code_to_check = (
                    shape.metadata.get('error', {}).get('code') or shape.name
                )
                if error_code == error_code_to_check:
                    if shape.metadata['retryable'].get('throttling'):
                        return self.THROTTLING_ERROR
                    return self.TRANSIENT_ERROR


class ThrottlingErrorDetector:
    def __init__(self, retry_event_adapter):
        self._modeled_error_detector = ModeledRetryErrorDetector()
        self._fixed_error_code_detector = ThrottledRetryableChecker()
        self._retry_event_adapter = retry_event_adapter

    # This expects the kwargs from needs-retry to be passed through.
    def is_throttling_error(self, **kwargs):
        context = self._retry_event_adapter.create_retry_context(**kwargs)
        if self._fixed_error_code_detector.is_retryable(context):
            return True
        error_type = self._modeled_error_detector.detect_error_type(context)
        return error_type == self._modeled_error_detector.THROTTLING_ERROR


class StandardRetryConditions(BaseRetryableChecker):
    """Concrete class that implements the standard retry policy checks.

    Specifically:

        not max_attempts and (transient or throttled or modeled_retry)

    """

    def __init__(self, max_attempts=DEFAULT_MAX_ATTEMPTS):
        # Note: This class is for convenience so you can have the
        # standard retry condition in a single class.
        self._max_attempts_checker = MaxAttemptsChecker(max_attempts)
        self._additional_checkers = OrRetryChecker(
            [
                TransientRetryableChecker(),
                ThrottledRetryableChecker(),
                ModeledRetryableChecker(),
                OrRetryChecker(
                    [
                        special.RetryIDPCommunicationError(),
                        special.RetryDDBChecksumError(),
                    ]
                ),
            ]
        )

    def is_retryable(self, context):
        return self._max_attempts_checker.is_retryable(
            context
        ) and self._additional_checkers.is_retryable(context)


class OrRetryChecker(BaseRetryableChecker):
    def __init__(self, checkers):
        self._checkers = checkers

    def is_retryable(self, context):
        return any(checker.is_retryable(context) for checker in self._checkers)


class RetryQuotaChecker:
    _RETRY_COST = 5
    _NO_RETRY_INCREMENT = 1
    _TIMEOUT_RETRY_REQUEST = 10
    _TIMEOUT_EXCEPTIONS = (ConnectTimeoutError, ReadTimeoutError)

    # Implementation note:  We're not making this a BaseRetryableChecker
    # because this isn't just a check if we can retry.  This also changes
    # state so we have to careful when/how we call this.  Making it
    # a BaseRetryableChecker implies you can call .is_retryable(context)
    # as many times as you want and not affect anything.

    def __init__(self, quota):
        self._quota = quota
        # This tracks the last amount
        self._last_amount_acquired = None

    def acquire_retry_quota(self, context):
        if self._is_timeout_error(context):
            capacity_amount = self._TIMEOUT_RETRY_REQUEST
        else:
            capacity_amount = self._RETRY_COST
        success = self._quota.acquire(capacity_amount)
        if success:
            # We add the capacity amount to the request context so we know
            # how much to release later.  The capacity amount can vary based
            # on the error.
            context.request_context['retry_quota_capacity'] = capacity_amount
            return True
        context.add_retry_metadata(RetryQuotaReached=True)
        return False

    def _is_timeout_error(self, context):
        return isinstance(context.caught_exception, self._TIMEOUT_EXCEPTIONS)

    # This is intended to be hooked up to ``after-call``.
    def release_retry_quota(self, context, http_response, **kwargs):
        # There's three possible options.
        # 1. The HTTP response did not have a 2xx response.  In that case we
        #    give no quota back.
        # 2. The HTTP request was successful and was never retried.  In
        #    that case we give _NO_RETRY_INCREMENT back.
        # 3. The API call had retries, and we eventually receive an HTTP
        #    response with a 2xx status code.  In that case we give back
        #    whatever quota was associated with the last acquisition.
        if http_response is None:
            return
        status_code = http_response.status_code
        if 200 <= status_code < 300:
            if 'retry_quota_capacity' not in context:
                self._quota.release(self._NO_RETRY_INCREMENT)
            else:
                capacity_amount = context['retry_quota_capacity']
                self._quota.release(capacity_amount)
