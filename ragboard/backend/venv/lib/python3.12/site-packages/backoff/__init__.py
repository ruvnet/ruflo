# coding:utf-8
"""
Function decoration for backoff and retry

This module provides function decorators which can be used to wrap a
function such that it will be retried until some condition is met. It
is meant to be of use when accessing unreliable resources with the
potential for intermittent failures i.e. network resources and external
APIs. Somewhat more generally, it may also be of use for dynamically
polling resources for externally generated content.

For examples and full documentation see the README at
https://github.com/litl/backoff
"""
from backoff._decorator import on_exception, on_predicate
from backoff._jitter import full_jitter, random_jitter
from backoff._wait_gen import constant, expo, fibo, runtime

__all__ = [
    'on_predicate',
    'on_exception',
    'constant',
    'expo',
    'fibo',
    'runtime',
    'full_jitter',
    'random_jitter',
]

__version__ = "2.2.1"
