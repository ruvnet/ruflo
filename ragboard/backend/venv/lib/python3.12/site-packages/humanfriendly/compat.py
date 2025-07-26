# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: September 17, 2021
# URL: https://humanfriendly.readthedocs.io

"""
Compatibility with Python 2 and 3.

This module exposes aliases and functions that make it easier to write Python
code that is compatible with Python 2 and Python 3.

.. data:: basestring

   Alias for :func:`python2:basestring` (in Python 2) or :class:`python3:str`
   (in Python 3). See also :func:`is_string()`.

.. data:: HTMLParser

   Alias for :class:`python2:HTMLParser.HTMLParser` (in Python 2) or
   :class:`python3:html.parser.HTMLParser` (in Python 3).

.. data:: interactive_prompt

   Alias for :func:`python2:raw_input()` (in Python 2) or
   :func:`python3:input()` (in Python 3).

.. data:: StringIO

   Alias for :class:`python2:StringIO.StringIO` (in Python 2) or
   :class:`python3:io.StringIO` (in Python 3).

.. data:: unicode

   Alias for :func:`python2:unicode` (in Python 2) or :class:`python3:str` (in
   Python 3). See also :func:`coerce_string()`.

.. data:: monotonic

   Alias for :func:`python3:time.monotonic()` (in Python 3.3 and higher) or
   `monotonic.monotonic()` (a `conditional dependency
   <https://pypi.org/project/monotonic/>`_ on older Python versions).
"""

__all__ = (
    'HTMLParser',
    'StringIO',
    'basestring',
    'coerce_string',
    'interactive_prompt',
    'is_string',
    'is_unicode',
    'monotonic',
    'name2codepoint',
    'on_macos',
    'on_windows',
    'unichr',
    'unicode',
    'which',
)

# Standard library modules.
import sys

# Differences between Python 2 and 3.
try:
    # Python 2.
    unicode = unicode
    unichr = unichr
    basestring = basestring
    interactive_prompt = raw_input
    from distutils.spawn import find_executable as which
    from HTMLParser import HTMLParser
    from StringIO import StringIO
    from htmlentitydefs import name2codepoint
except (ImportError, NameError):
    # Python 3.
    unicode = str
    unichr = chr
    basestring = str
    interactive_prompt = input
    from shutil import which
    from html.parser import HTMLParser
    from io import StringIO
    from html.entities import name2codepoint

try:
    # Python 3.3 and higher.
    from time import monotonic
except ImportError:
    # A replacement for older Python versions:
    # https://pypi.org/project/monotonic/
    try:
        from monotonic import monotonic
    except (ImportError, RuntimeError):
        # We fall back to the old behavior of using time.time() instead of
        # failing when {time,monotonic}.monotonic() are both missing.
        from time import time as monotonic


def coerce_string(value):
    """
    Coerce any value to a Unicode string (:func:`python2:unicode` in Python 2 and :class:`python3:str` in Python 3).

    :param value: The value to coerce.
    :returns: The value coerced to a Unicode string.
    """
    return value if is_string(value) else unicode(value)


def is_string(value):
    """
    Check if a value is a :func:`python2:basestring` (in Python 2) or :class:`python3:str` (in Python 3) object.

    :param value: The value to check.
    :returns: :data:`True` if the value is a string, :data:`False` otherwise.
    """
    return isinstance(value, basestring)


def is_unicode(value):
    """
    Check if a value is a :func:`python2:unicode` (in Python 2) or :class:`python2:str` (in Python 3) object.

    :param value: The value to check.
    :returns: :data:`True` if the value is a Unicode string, :data:`False` otherwise.
    """
    return isinstance(value, unicode)


def on_macos():
    """
    Check if we're running on Apple MacOS.

    :returns: :data:`True` if running MacOS, :data:`False` otherwise.
    """
    return sys.platform.startswith('darwin')


def on_windows():
    """
    Check if we're running on the Microsoft Windows OS.

    :returns: :data:`True` if running Windows, :data:`False` otherwise.
    """
    return sys.platform.startswith('win')
