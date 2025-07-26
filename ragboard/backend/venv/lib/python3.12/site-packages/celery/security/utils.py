"""Utilities used by the message signing serializer."""
import sys
from contextlib import contextmanager

import cryptography.exceptions
from cryptography.hazmat.primitives import hashes

from celery.exceptions import SecurityError, reraise

__all__ = ('get_digest_algorithm', 'reraise_errors',)


def get_digest_algorithm(digest='sha256'):
    """Convert string to hash object of cryptography library."""
    assert digest is not None
    return getattr(hashes, digest.upper())()


@contextmanager
def reraise_errors(msg='{0!r}', errors=None):
    """Context reraising crypto errors as :exc:`SecurityError`."""
    errors = (cryptography.exceptions,) if errors is None else errors
    try:
        yield
    except errors as exc:
        reraise(SecurityError,
                SecurityError(msg.format(exc)),
                sys.exc_info()[2])
