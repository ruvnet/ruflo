# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: April 19, 2020
# URL: https://humanfriendly.readthedocs.io

"""
Simple case insensitive dictionaries.

The :class:`CaseInsensitiveDict` class is a dictionary whose string keys
are case insensitive. It works by automatically coercing string keys to
:class:`CaseInsensitiveKey` objects. Keys that are not strings are
supported as well, just without case insensitivity.

At its core this module works by normalizing strings to lowercase before
comparing or hashing them. It doesn't support proper case folding nor
does it support Unicode normalization, hence the word "simple".
"""

# Standard library modules.
import collections

try:
    # Python >= 3.3.
    from collections.abc import Iterable, Mapping
except ImportError:
    # Python 2.7.
    from collections import Iterable, Mapping

# Modules included in our package.
from humanfriendly.compat import basestring, unicode

# Public identifiers that require documentation.
__all__ = ("CaseInsensitiveDict", "CaseInsensitiveKey")


class CaseInsensitiveDict(collections.OrderedDict):

    """
    Simple case insensitive dictionary implementation (that remembers insertion order).

    This class works by overriding methods that deal with dictionary keys to
    coerce string keys to :class:`CaseInsensitiveKey` objects before calling
    down to the regular dictionary handling methods. While intended to be
    complete this class has not been extensively tested yet.
    """

    def __init__(self, other=None, **kw):
        """Initialize a :class:`CaseInsensitiveDict` object."""
        # Initialize our superclass.
        super(CaseInsensitiveDict, self).__init__()
        # Handle the initializer arguments.
        self.update(other, **kw)

    def coerce_key(self, key):
        """
        Coerce string keys to :class:`CaseInsensitiveKey` objects.

        :param key: The value to coerce (any type).
        :returns: If `key` is a string then a :class:`CaseInsensitiveKey`
                  object is returned, otherwise the value of `key` is
                  returned unmodified.
        """
        if isinstance(key, basestring):
            key = CaseInsensitiveKey(key)
        return key

    @classmethod
    def fromkeys(cls, iterable, value=None):
        """Create a case insensitive dictionary with keys from `iterable` and values set to `value`."""
        return cls((k, value) for k in iterable)

    def get(self, key, default=None):
        """Get the value of an existing item."""
        return super(CaseInsensitiveDict, self).get(self.coerce_key(key), default)

    def pop(self, key, default=None):
        """Remove an item from a case insensitive dictionary."""
        return super(CaseInsensitiveDict, self).pop(self.coerce_key(key), default)

    def setdefault(self, key, default=None):
        """Get the value of an existing item or add a new item."""
        return super(CaseInsensitiveDict, self).setdefault(self.coerce_key(key), default)

    def update(self, other=None, **kw):
        """Update a case insensitive dictionary with new items."""
        if isinstance(other, Mapping):
            # Copy the items from the given mapping.
            for key, value in other.items():
                self[key] = value
        elif isinstance(other, Iterable):
            # Copy the items from the given iterable.
            for key, value in other:
                self[key] = value
        elif other is not None:
            # Complain about unsupported values.
            msg = "'%s' object is not iterable"
            type_name = type(value).__name__
            raise TypeError(msg % type_name)
        # Copy the keyword arguments (if any).
        for key, value in kw.items():
            self[key] = value

    def __contains__(self, key):
        """Check if a case insensitive dictionary contains the given key."""
        return super(CaseInsensitiveDict, self).__contains__(self.coerce_key(key))

    def __delitem__(self, key):
        """Delete an item in a case insensitive dictionary."""
        return super(CaseInsensitiveDict, self).__delitem__(self.coerce_key(key))

    def __getitem__(self, key):
        """Get the value of an item in a case insensitive dictionary."""
        return super(CaseInsensitiveDict, self).__getitem__(self.coerce_key(key))

    def __setitem__(self, key, value):
        """Set the value of an item in a case insensitive dictionary."""
        return super(CaseInsensitiveDict, self).__setitem__(self.coerce_key(key), value)


class CaseInsensitiveKey(unicode):

    """
    Simple case insensitive dictionary key implementation.

    The :class:`CaseInsensitiveKey` class provides an intentionally simple
    implementation of case insensitive strings to be used as dictionary keys.

    If you need features like Unicode normalization or proper case folding
    please consider using a more advanced implementation like the :pypi:`istr`
    package instead.
    """

    def __new__(cls, value):
        """Create a :class:`CaseInsensitiveKey` object."""
        # Delegate string object creation to our superclass.
        obj = unicode.__new__(cls, value)
        # Store the lowercased string and its hash value.
        normalized = obj.lower()
        obj._normalized = normalized
        obj._hash_value = hash(normalized)
        return obj

    def __hash__(self):
        """Get the hash value of the lowercased string."""
        return self._hash_value

    def __eq__(self, other):
        """Compare two strings as lowercase."""
        if isinstance(other, CaseInsensitiveKey):
            # Fast path (and the most common case): Comparison with same type.
            return self._normalized == other._normalized
        elif isinstance(other, unicode):
            # Slow path: Comparison with strings that need lowercasing.
            return self._normalized == other.lower()
        else:
            return NotImplemented
