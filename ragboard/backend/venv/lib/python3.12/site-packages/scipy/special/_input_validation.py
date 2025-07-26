import math
import operator

def _nonneg_int_or_fail(n, var_name, strict=True):
    try:
        if strict:
            # Raises an exception if float
            n = operator.index(n)
        elif n == math.floor(n):
            n = int(n)
        else:
            raise ValueError()
        if n < 0:
            raise ValueError()
    except (ValueError, TypeError) as err:
        raise err.__class__(f"{var_name} must be a non-negative integer") from err
    return n
