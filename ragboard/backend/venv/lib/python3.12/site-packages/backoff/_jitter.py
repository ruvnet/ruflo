# coding:utf-8

import random


def random_jitter(value: float) -> float:
    """Jitter the value a random number of milliseconds.

    This adds up to 1 second of additional time to the original value.
    Prior to backoff version 1.2 this was the default jitter behavior.

    Args:
        value: The unadulterated backoff value.
    """
    return value + random.random()


def full_jitter(value: float) -> float:
    """Jitter the value across the full range (0 to value).

    This corresponds to the "Full Jitter" algorithm specified in the
    AWS blog's post on the performance of various jitter algorithms.
    (http://www.awsarchitectureblog.com/2015/03/backoff.html)

    Args:
        value: The unadulterated backoff value.
    """
    return random.uniform(0, value)
