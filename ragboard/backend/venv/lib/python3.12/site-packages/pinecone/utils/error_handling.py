import inspect
from functools import wraps

from urllib3.exceptions import MaxRetryError, ProtocolError

def validate_and_convert_errors(func):
    @wraps(func)
    def inner_func(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except MaxRetryError as e:
            if isinstance(e.reason, ProtocolError):
                raise ProtocolError(f"Failed to connect to {e.url}; did you specify the correct index name?") from e
            else:
                raise
        except ProtocolError as e:
            raise ProtocolError(f"Failed to connect; did you specify the correct index name?") from e

    # Override signature
    sig = inspect.signature(func)
    inner_func.__signature__ = sig
    return inner_func
