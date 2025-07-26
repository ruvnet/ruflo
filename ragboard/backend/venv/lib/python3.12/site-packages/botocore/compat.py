# Copyright 2012-2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.

import copy
import datetime
import sys
import inspect
import warnings
import hashlib
from http.client import HTTPMessage
import logging
import shlex
import re
import os
from collections import OrderedDict
from collections.abc import MutableMapping
from math import floor

from botocore.vendored import six
from botocore.exceptions import MD5UnavailableError
from dateutil.tz import tzlocal
from urllib3 import exceptions

logger = logging.getLogger(__name__)


class HTTPHeaders(HTTPMessage):
    pass

from urllib.parse import (
    quote,
    urlencode,
    unquote,
    unquote_plus,
    urlparse,
    urlsplit,
    urlunsplit,
    urljoin,
    parse_qsl,
    parse_qs,
)
from http.client import HTTPResponse
from io import IOBase as _IOBase
from base64 import encodebytes
from email.utils import formatdate
from itertools import zip_longest
file_type = _IOBase
zip = zip

# In python3, unquote takes a str() object, url decodes it,
# then takes the bytestring and decodes it to utf-8.
unquote_str = unquote_plus

def set_socket_timeout(http_response, timeout):
    """Set the timeout of the socket from an HTTPResponse.

    :param http_response: An instance of ``httplib.HTTPResponse``

    """
    http_response._fp.fp.raw._sock.settimeout(timeout)

def accepts_kwargs(func):
    # In python3.4.1, there's backwards incompatible
    # changes when using getargspec with functools.partials.
    return inspect.getfullargspec(func)[2]

def ensure_unicode(s, encoding=None, errors=None):
    # NOOP in Python 3, because every string is already unicode
    return s

def ensure_bytes(s, encoding='utf-8', errors='strict'):
    if isinstance(s, str):
        return s.encode(encoding, errors)
    if isinstance(s, bytes):
        return s
    raise ValueError(f"Expected str or bytes, received {type(s)}.")


try:
    import xml.etree.cElementTree as ETree
except ImportError:
    # cElementTree does not exist from Python3.9+
    import xml.etree.ElementTree as ETree
XMLParseError = ETree.ParseError
import json


def filter_ssl_warnings():
    # Ignore warnings related to SNI as it is not being used in validations.
    warnings.filterwarnings(
        'ignore',
        message="A true SSLContext object is not available.*",
        category=exceptions.InsecurePlatformWarning,
        module=r".*urllib3\.util\.ssl_",
    )


@classmethod
def from_dict(cls, d):
    new_instance = cls()
    for key, value in d.items():
        new_instance[key] = value
    return new_instance


@classmethod
def from_pairs(cls, pairs):
    new_instance = cls()
    for key, value in pairs:
        new_instance[key] = value
    return new_instance


HTTPHeaders.from_dict = from_dict
HTTPHeaders.from_pairs = from_pairs


def copy_kwargs(kwargs):
    """
    This used to be a compat shim for 2.6 but is now just an alias.
    """
    copy_kwargs = copy.copy(kwargs)
    return copy_kwargs


def total_seconds(delta):
    """
    Returns the total seconds in a ``datetime.timedelta``.

    This used to be a compat shim for 2.6 but is now just an alias.

    :param delta: The timedelta object
    :type delta: ``datetime.timedelta``
    """
    return delta.total_seconds()


# Checks to see if md5 is available on this system. A given system might not
# have access to it for various reasons, such as FIPS mode being enabled.
try:
    hashlib.md5()
    MD5_AVAILABLE = True
except ValueError:
    MD5_AVAILABLE = False


def get_md5(*args, **kwargs):
    """
    Attempts to get an md5 hashing object.

    :param args: Args to pass to the MD5 constructor
    :param kwargs: Key word arguments to pass to the MD5 constructor
    :return: An MD5 hashing object if available. If it is unavailable, None
        is returned if raise_error_if_unavailable is set to False.
    """
    if MD5_AVAILABLE:
        return hashlib.md5(*args, **kwargs)
    else:
        raise MD5UnavailableError()


def compat_shell_split(s, platform=None):
    if platform is None:
        platform = sys.platform

    if platform == "win32":
        return _windows_shell_split(s)
    else:
        return shlex.split(s)


def _windows_shell_split(s):
    """Splits up a windows command as the built-in command parser would.

    Windows has potentially bizarre rules depending on where you look. When
    spawning a process via the Windows C runtime (which is what python does
    when you call popen) the rules are as follows:

    https://docs.microsoft.com/en-us/cpp/cpp/parsing-cpp-command-line-arguments

    To summarize:

    * Only space and tab are valid delimiters
    * Double quotes are the only valid quotes
    * Backslash is interpreted literally unless it is part of a chain that
      leads up to a double quote. Then the backslashes escape the backslashes,
      and if there is an odd number the final backslash escapes the quote.

    :param s: The command string to split up into parts.
    :return: A list of command components.
    """
    if not s:
        return []

    components = []
    buff = []
    is_quoted = False
    num_backslashes = 0
    for character in s:
        if character == '\\':
            # We can't simply append backslashes because we don't know if
            # they are being used as escape characters or not. Instead we
            # keep track of how many we've encountered and handle them when
            # we encounter a different character.
            num_backslashes += 1
        elif character == '"':
            if num_backslashes > 0:
                # The backslashes are in a chain leading up to a double
                # quote, so they are escaping each other.
                buff.append('\\' * int(floor(num_backslashes / 2)))
                remainder = num_backslashes % 2
                num_backslashes = 0
                if remainder == 1:
                    # The number of backslashes is uneven, so they are also
                    # escaping the double quote, so it needs to be added to
                    # the current component buffer.
                    buff.append('"')
                    continue

            # We've encountered a double quote that is not escaped,
            # so we toggle is_quoted.
            is_quoted = not is_quoted

            # If there are quotes, then we may want an empty string. To be
            # safe, we add an empty string to the buffer so that we make
            # sure it sticks around if there's nothing else between quotes.
            # If there is other stuff between quotes, the empty string will
            # disappear during the joining process.
            buff.append('')
        elif character in [' ', '\t'] and not is_quoted:
            # Since the backslashes aren't leading up to a quote, we put in
            # the exact number of backslashes.
            if num_backslashes > 0:
                buff.append('\\' * num_backslashes)
                num_backslashes = 0

            # Excess whitespace is ignored, so only add the components list
            # if there is anything in the buffer.
            if buff:
                components.append(''.join(buff))
                buff = []
        else:
            # Since the backslashes aren't leading up to a quote, we put in
            # the exact number of backslashes.
            if num_backslashes > 0:
                buff.append('\\' * num_backslashes)
                num_backslashes = 0
            buff.append(character)

    # Quotes must be terminated.
    if is_quoted:
        raise ValueError(f"No closing quotation in string: {s}")

    # There may be some leftover backslashes, so we need to add them in.
    # There's no quote so we add the exact number.
    if num_backslashes > 0:
        buff.append('\\' * num_backslashes)

    # Add the final component in if there is anything in the buffer.
    if buff:
        components.append(''.join(buff))

    return components


def get_tzinfo_options():
    # Due to dateutil/dateutil#197, Windows may fail to parse times in the past
    # with the system clock. We can alternatively fallback to tzwininfo when
    # this happens, which will get time info from the Windows registry.
    if sys.platform == 'win32':
        from dateutil.tz import tzwinlocal

        return (tzlocal, tzwinlocal)
    else:
        return (tzlocal,)


# Detect if CRT is available for use
try:
    import awscrt.auth

    # Allow user opt-out if needed
    disabled = os.environ.get('BOTO_DISABLE_CRT', "false")
    HAS_CRT = not disabled.lower() == 'true'
except ImportError:
    HAS_CRT = False


########################################################
#              urllib3 compat backports                #
########################################################

# Vendoring IPv6 validation regex patterns from urllib3
# https://github.com/urllib3/urllib3/blob/7e856c0/src/urllib3/util/url.py
IPV4_PAT = r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}"
IPV4_RE = re.compile("^" + IPV4_PAT + "$")
HEX_PAT = "[0-9A-Fa-f]{1,4}"
LS32_PAT = "(?:{hex}:{hex}|{ipv4})".format(hex=HEX_PAT, ipv4=IPV4_PAT)
_subs = {"hex": HEX_PAT, "ls32": LS32_PAT}
_variations = [
    #                            6( h16 ":" ) ls32
    "(?:%(hex)s:){6}%(ls32)s",
    #                       "::" 5( h16 ":" ) ls32
    "::(?:%(hex)s:){5}%(ls32)s",
    # [               h16 ] "::" 4( h16 ":" ) ls32
    "(?:%(hex)s)?::(?:%(hex)s:){4}%(ls32)s",
    # [ *1( h16 ":" ) h16 ] "::" 3( h16 ":" ) ls32
    "(?:(?:%(hex)s:)?%(hex)s)?::(?:%(hex)s:){3}%(ls32)s",
    # [ *2( h16 ":" ) h16 ] "::" 2( h16 ":" ) ls32
    "(?:(?:%(hex)s:){0,2}%(hex)s)?::(?:%(hex)s:){2}%(ls32)s",
    # [ *3( h16 ":" ) h16 ] "::"    h16 ":"   ls32
    "(?:(?:%(hex)s:){0,3}%(hex)s)?::%(hex)s:%(ls32)s",
    # [ *4( h16 ":" ) h16 ] "::"              ls32
    "(?:(?:%(hex)s:){0,4}%(hex)s)?::%(ls32)s",
    # [ *5( h16 ":" ) h16 ] "::"              h16
    "(?:(?:%(hex)s:){0,5}%(hex)s)?::%(hex)s",
    # [ *6( h16 ":" ) h16 ] "::"
    "(?:(?:%(hex)s:){0,6}%(hex)s)?::",
]

UNRESERVED_PAT = (
    r"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._!\-~"
)
IPV6_PAT = "(?:" + "|".join([x % _subs for x in _variations]) + ")"
ZONE_ID_PAT = "(?:%25|%)(?:[" + UNRESERVED_PAT + "]|%[a-fA-F0-9]{2})+"
IPV6_ADDRZ_PAT = r"\[" + IPV6_PAT + r"(?:" + ZONE_ID_PAT + r")?\]"
IPV6_ADDRZ_RE = re.compile("^" + IPV6_ADDRZ_PAT + "$")

# These are the characters that are stripped by post-bpo-43882 urlparse().
UNSAFE_URL_CHARS = frozenset('\t\r\n')

# Detect if gzip is available for use
try:
    import gzip
    HAS_GZIP = True
except ImportError:
    HAS_GZIP = False
