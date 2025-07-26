"""Text encoding utilities.

Utilities to encode text, and to safely emit text from running
applications without crashing from the infamous
:exc:`UnicodeDecodeError` exception.
"""

from __future__ import annotations

import sys
import traceback

#: safe_str takes encoding from this file by default.
#: :func:`set_default_encoding_file` can used to set the
#: default output file.
default_encoding_file = None


def set_default_encoding_file(file):
    """Set file used to get codec information."""
    global default_encoding_file
    default_encoding_file = file


def get_default_encoding_file():
    """Get file used to get codec information."""
    return default_encoding_file


if sys.platform.startswith('java'):  # pragma: no cover

    def default_encoding(file=None):
        """Get default encoding."""
        return 'utf-8'
else:

    def default_encoding(file=None):
        """Get default encoding."""
        file = file or get_default_encoding_file()
        return getattr(file, 'encoding', None) or sys.getfilesystemencoding()


def str_to_bytes(s):
    """Convert str to bytes."""
    if isinstance(s, str):
        return s.encode()
    return s


def bytes_to_str(s):
    """Convert bytes to str."""
    if isinstance(s, bytes):
        return s.decode(errors='replace')
    return s


def from_utf8(s, *args, **kwargs):
    """Get str from utf-8 encoding."""
    return s


def ensure_bytes(s):
    """Ensure s is bytes, not str."""
    if not isinstance(s, bytes):
        return str_to_bytes(s)
    return s


def default_encode(obj):
    """Encode using default encoding."""
    return obj


def safe_str(s, errors='replace'):
    """Safe form of str(), void of unicode errors."""
    s = bytes_to_str(s)
    if not isinstance(s, (str, bytes)):
        return safe_repr(s, errors)
    return _safe_str(s, errors)


def _safe_str(s, errors='replace', file=None):
    if isinstance(s, str):
        return s
    try:
        return str(s)
    except Exception as exc:
        return '<Unrepresentable {!r}: {!r} {!r}>'.format(
            type(s), exc, '\n'.join(traceback.format_stack()))


def safe_repr(o, errors='replace'):
    """Safe form of repr, void of Unicode errors."""
    try:
        return repr(o)
    except Exception:
        return _safe_str(o, errors)
