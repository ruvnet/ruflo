"""Token bucket implementation for rate limiting."""

from __future__ import annotations

from collections import deque
from time import monotonic

__all__ = ('TokenBucket',)


class TokenBucket:
    """Token Bucket Algorithm.

    See Also
    --------
        https://en.wikipedia.org/wiki/Token_Bucket

        Most of this code was stolen from an entry in the ASPN Python Cookbook:
        https://code.activestate.com/recipes/511490/

    Warning:
    -------
        Thread Safety: This implementation is not thread safe.
        Access to a `TokenBucket` instance should occur within the critical
        section of any multithreaded code.
    """

    #: The rate in tokens/second that the bucket will be refilled.
    fill_rate = None

    #: Maximum number of tokens in the bucket.
    capacity = 1

    #: Timestamp of the last time a token was taken out of the bucket.
    timestamp = None

    def __init__(self, fill_rate, capacity=1):
        self.capacity = float(capacity)
        self._tokens = capacity
        self.fill_rate = float(fill_rate)
        self.timestamp = monotonic()
        self.contents = deque()

    def add(self, item):
        self.contents.append(item)

    def pop(self):
        return self.contents.popleft()

    def clear_pending(self):
        self.contents.clear()

    def can_consume(self, tokens=1):
        """Check if one or more tokens can be consumed.

        Returns
        -------
            bool: true if the number of tokens can be consumed
                from the bucket.  If they can be consumed, a call will also
                consume the requested number of tokens from the bucket.
                Calls will only consume `tokens` (the number requested)
                or zero tokens -- it will never consume a partial number
                of tokens.
        """
        if tokens <= self._get_tokens():
            self._tokens -= tokens
            return True
        return False

    def expected_time(self, tokens=1):
        """Return estimated time of token availability.

        Returns
        -------
            float: the time in seconds.
        """
        _tokens = self._get_tokens()
        tokens = max(tokens, _tokens)
        return (tokens - _tokens) / self.fill_rate

    def _get_tokens(self):
        if self._tokens < self.capacity:
            now = monotonic()
            delta = self.fill_rate * (now - self.timestamp)
            self._tokens = min(self.capacity, self._tokens + delta)
            self.timestamp = now
        return self._tokens
