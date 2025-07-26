"""URL Utilities."""
# flake8: noqa


from __future__ import annotations

from collections.abc import Mapping
from functools import partial
from typing import NamedTuple
from urllib.parse import parse_qsl, quote, unquote, urlparse

try:
    import ssl
    ssl_available = True
except ImportError:  # pragma: no cover
    ssl_available = False

from ..log import get_logger

safequote = partial(quote, safe='')
logger = get_logger(__name__)

class urlparts(NamedTuple):
    """Named tuple representing parts of the URL."""

    scheme: str
    hostname: str
    port: int
    username: str
    password: str
    path: str
    query: Mapping


def parse_url(url):
    # type: (str) -> Dict
    """Parse URL into mapping of components."""
    scheme, host, port, user, password, path, query = _parse_url(url)
    if query:
        keys = [key for key in query.keys() if key.startswith('ssl_')]
        for key in keys:
            if key == "ssl_check_hostname":
                query[key] = query[key].lower() != 'false'
            elif key == 'ssl_cert_reqs':
                query[key] = parse_ssl_cert_reqs(query[key])
                if query[key] is None:
                    logger.warning('Defaulting to insecure SSL behaviour.')

            if 'ssl' not in query:
                query['ssl'] = {}

            query['ssl'][key] = query[key]
            del query[key]

    return dict(transport=scheme, hostname=host,
                port=port, userid=user,
                password=password, virtual_host=path, **query)


def url_to_parts(url):
    # type: (str) -> urlparts
    """Parse URL into :class:`urlparts` tuple of components."""
    scheme = urlparse(url).scheme
    schemeless = url[len(scheme) + 3:]
    # parse with HTTP URL semantics
    parts = urlparse('http://' + schemeless)
    path = parts.path or ''
    path = path[1:] if path and path[0] == '/' else path
    return urlparts(
        scheme,
        unquote(parts.hostname or '') or None,
        parts.port,
        unquote(parts.username or '') or None,
        unquote(parts.password or '') or None,
        unquote(path or '') or None,
        dict(parse_qsl(parts.query)),
    )


_parse_url = url_to_parts


def as_url(scheme, host=None, port=None, user=None, password=None,
           path=None, query=None, sanitize=False, mask='**'):
    # type: (str, str, int, str, str, str, str, bool, str) -> str
    """Generate URL from component parts."""
    parts = [f'{scheme}://']
    if user or password:
        if user:
            parts.append(safequote(user))
        if password:
            if sanitize:
                parts.extend([':', mask] if mask else [':'])
            else:
                parts.extend([':', safequote(password)])
        parts.append('@')
    parts.append(safequote(host) if host else '')
    if port:
        parts.extend([':', port])
    parts.extend(['/', path])
    return ''.join(str(part) for part in parts if part)


def sanitize_url(url, mask='**'):
    # type: (str, str) -> str
    """Return copy of URL with password removed."""
    return as_url(*_parse_url(url), sanitize=True, mask=mask)


def maybe_sanitize_url(url, mask='**'):
    # type: (Any, str) -> Any
    """Sanitize url, or do nothing if url undefined."""
    if isinstance(url, str) and '://' in url:
        return sanitize_url(url, mask)
    return url


def parse_ssl_cert_reqs(query_value):
    # type: (str) -> Any
    """Given the query parameter for ssl_cert_reqs, return the SSL constant or None."""
    if ssl_available:
        query_value_to_constant = {
            'CERT_REQUIRED': ssl.CERT_REQUIRED,
            'CERT_OPTIONAL': ssl.CERT_OPTIONAL,
            'CERT_NONE': ssl.CERT_NONE,
            'required': ssl.CERT_REQUIRED,
            'optional': ssl.CERT_OPTIONAL,
            'none': ssl.CERT_NONE,
        }
        return query_value_to_constant[query_value]
    else:
        return None
