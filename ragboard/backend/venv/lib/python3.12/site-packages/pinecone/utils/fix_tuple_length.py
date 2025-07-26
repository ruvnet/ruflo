def fix_tuple_length(t, n):
    """Extend tuple t to length n by adding None items at the end of the tuple. Return the new tuple."""
    return t + ((None,) * (n - len(t))) if len(t) < n else t