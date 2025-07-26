class BaseRetryBackoff:
    def delay_amount(self, context):
        """Calculate how long we should delay before retrying.

        :type context: RetryContext

        """
        raise NotImplementedError("delay_amount")


class BaseRetryableChecker:
    """Base class for determining if a retry should happen.

    This base class checks for specific retryable conditions.
    A single retryable checker doesn't necessarily indicate a retry
    will happen.  It's up to the ``RetryPolicy`` to use its
    ``BaseRetryableCheckers`` to make the final decision on whether a retry
    should happen.
    """

    def is_retryable(self, context):
        """Returns True if retryable, False if not.

        :type context: RetryContext
        """
        raise NotImplementedError("is_retryable")
