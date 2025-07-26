"""
oauthlib.utils
~~~~~~~~~~~~~~

This module contains utility methods used by various parts of the OAuth
spec.
"""
import urllib.request as urllib2

from oauthlib.common import quote, unquote

UNICODE_ASCII_CHARACTER_SET = ('abcdefghijklmnopqrstuvwxyz'
                               'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                               '0123456789')


def filter_params(target):
    """Decorator which filters params to remove non-oauth_* parameters

    Assumes the decorated method takes a params dict or list of tuples as its
    first argument.
    """
    def wrapper(params, *args, **kwargs):
        params = filter_oauth_params(params)
        return target(params, *args, **kwargs)

    wrapper.__doc__ = target.__doc__
    return wrapper


def filter_oauth_params(params):
    """Removes all non oauth parameters from a dict or a list of params."""
    def is_oauth(kv):
        return kv[0].startswith('oauth_')
    if isinstance(params, dict):
        return list(filter(is_oauth, list(params.items())))
    else:
        return list(filter(is_oauth, params))


def escape(u):
    """Escape a unicode string in an OAuth-compatible fashion.

    Per `section 3.6`_ of the spec.

    .. _`section 3.6`: https://tools.ietf.org/html/rfc5849#section-3.6

    """
    if not isinstance(u, str):
        raise ValueError('Only unicode objects are escapable. ' +
                         'Got {!r} of type {}.'.format(u, type(u)))
    # Letters, digits, and the characters '_.-' are already treated as safe
    # by urllib.quote(). We need to add '~' to fully support rfc5849.
    return quote(u, safe=b'~')


def unescape(u):
    if not isinstance(u, str):
        raise ValueError('Only unicode objects are unescapable.')
    return unquote(u)


def parse_keqv_list(l):  # noqa: E741
    """A unicode-safe version of urllib2.parse_keqv_list"""
    # With Python 2.6, parse_http_list handles unicode fine
    return urllib2.parse_keqv_list(l)


def parse_http_list(u):
    """A unicode-safe version of urllib2.parse_http_list"""
    # With Python 2.6, parse_http_list handles unicode fine
    return urllib2.parse_http_list(u)


def parse_authorization_header(authorization_header):
    """Parse an OAuth authorization header into a list of 2-tuples"""
    auth_scheme = 'OAuth '.lower()
    if authorization_header[:len(auth_scheme)].lower().startswith(auth_scheme):
        items = parse_http_list(authorization_header[len(auth_scheme):])
        try:
            return list(parse_keqv_list(items).items())
        except (IndexError, ValueError):
            pass
    raise ValueError('Malformed authorization header')
