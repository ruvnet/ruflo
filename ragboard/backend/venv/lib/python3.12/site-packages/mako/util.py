# mako/util.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php
from ast import parse
import codecs
import collections
import operator
import os
import re
import timeit

from .compat import importlib_metadata_get


def update_wrapper(decorated, fn):
    decorated.__wrapped__ = fn
    decorated.__name__ = fn.__name__
    return decorated


class PluginLoader:
    def __init__(self, group):
        self.group = group
        self.impls = {}

    def load(self, name):
        if name in self.impls:
            return self.impls[name]()

        for impl in importlib_metadata_get(self.group):
            if impl.name == name:
                self.impls[name] = impl.load
                return impl.load()

        from mako import exceptions

        raise exceptions.RuntimeException(
            "Can't load plugin %s %s" % (self.group, name)
        )

    def register(self, name, modulepath, objname):
        def load():
            mod = __import__(modulepath)
            for token in modulepath.split(".")[1:]:
                mod = getattr(mod, token)
            return getattr(mod, objname)

        self.impls[name] = load


def verify_directory(dir_):
    """create and/or verify a filesystem directory."""

    tries = 0

    while not os.path.exists(dir_):
        try:
            tries += 1
            os.makedirs(dir_, 0o755)
        except:
            if tries > 5:
                raise


def to_list(x, default=None):
    if x is None:
        return default
    if not isinstance(x, (list, tuple)):
        return [x]
    else:
        return x


class memoized_property:

    """A read-only @property that is only evaluated once."""

    def __init__(self, fget, doc=None):
        self.fget = fget
        self.__doc__ = doc or fget.__doc__
        self.__name__ = fget.__name__

    def __get__(self, obj, cls):
        if obj is None:
            return self
        obj.__dict__[self.__name__] = result = self.fget(obj)
        return result


class memoized_instancemethod:

    """Decorate a method memoize its return value.

    Best applied to no-arg methods: memoization is not sensitive to
    argument values, and will always return the same value even when
    called with different arguments.

    """

    def __init__(self, fget, doc=None):
        self.fget = fget
        self.__doc__ = doc or fget.__doc__
        self.__name__ = fget.__name__

    def __get__(self, obj, cls):
        if obj is None:
            return self

        def oneshot(*args, **kw):
            result = self.fget(obj, *args, **kw)

            def memo(*a, **kw):
                return result

            memo.__name__ = self.__name__
            memo.__doc__ = self.__doc__
            obj.__dict__[self.__name__] = memo
            return result

        oneshot.__name__ = self.__name__
        oneshot.__doc__ = self.__doc__
        return oneshot


class SetLikeDict(dict):

    """a dictionary that has some setlike methods on it"""

    def union(self, other):
        """produce a 'union' of this dict and another (at the key level).

        values in the second dict take precedence over that of the first"""
        x = SetLikeDict(**self)
        x.update(other)
        return x


class FastEncodingBuffer:

    """a very rudimentary buffer that is faster than StringIO,
    and supports unicode data."""

    def __init__(self, encoding=None, errors="strict"):
        self.data = collections.deque()
        self.encoding = encoding
        self.delim = ""
        self.errors = errors
        self.write = self.data.append

    def truncate(self):
        self.data = collections.deque()
        self.write = self.data.append

    def getvalue(self):
        if self.encoding:
            return self.delim.join(self.data).encode(
                self.encoding, self.errors
            )
        else:
            return self.delim.join(self.data)


class LRUCache(dict):

    """A dictionary-like object that stores a limited number of items,
    discarding lesser used items periodically.

    this is a rewrite of LRUCache from Myghty to use a periodic timestamp-based
    paradigm so that synchronization is not really needed.  the size management
    is inexact.
    """

    class _Item:
        def __init__(self, key, value):
            self.key = key
            self.value = value
            self.timestamp = timeit.default_timer()

        def __repr__(self):
            return repr(self.value)

    def __init__(self, capacity, threshold=0.5):
        self.capacity = capacity
        self.threshold = threshold

    def __getitem__(self, key):
        item = dict.__getitem__(self, key)
        item.timestamp = timeit.default_timer()
        return item.value

    def values(self):
        return [i.value for i in dict.values(self)]

    def setdefault(self, key, value):
        if key in self:
            return self[key]
        self[key] = value
        return value

    def __setitem__(self, key, value):
        item = dict.get(self, key)
        if item is None:
            item = self._Item(key, value)
            dict.__setitem__(self, key, item)
        else:
            item.value = value
        self._manage_size()

    def _manage_size(self):
        while len(self) > self.capacity + self.capacity * self.threshold:
            bytime = sorted(
                dict.values(self),
                key=operator.attrgetter("timestamp"),
                reverse=True,
            )
            for item in bytime[self.capacity :]:
                try:
                    del self[item.key]
                except KeyError:
                    # if we couldn't find a key, most likely some other thread
                    # broke in on us. loop around and try again
                    break


# Regexp to match python magic encoding line
_PYTHON_MAGIC_COMMENT_re = re.compile(
    r"[ \t\f]* \# .* coding[=:][ \t]*([-\w.]+)", re.VERBOSE
)


def parse_encoding(fp):
    """Deduce the encoding of a Python source file (binary mode) from magic
    comment.

    It does this in the same way as the `Python interpreter`__

    .. __: http://docs.python.org/ref/encodings.html

    The ``fp`` argument should be a seekable file object in binary mode.
    """
    pos = fp.tell()
    fp.seek(0)
    try:
        line1 = fp.readline()
        has_bom = line1.startswith(codecs.BOM_UTF8)
        if has_bom:
            line1 = line1[len(codecs.BOM_UTF8) :]

        m = _PYTHON_MAGIC_COMMENT_re.match(line1.decode("ascii", "ignore"))
        if not m:
            try:
                parse(line1.decode("ascii", "ignore"))
            except (ImportError, SyntaxError):
                # Either it's a real syntax error, in which case the source
                # is not valid python source, or line2 is a continuation of
                # line1, in which case we don't want to scan line2 for a magic
                # comment.
                pass
            else:
                line2 = fp.readline()
                m = _PYTHON_MAGIC_COMMENT_re.match(
                    line2.decode("ascii", "ignore")
                )

        if has_bom:
            if m:
                raise SyntaxError(
                    "python refuses to compile code with both a UTF8"
                    " byte-order-mark and a magic encoding comment"
                )
            return "utf_8"
        elif m:
            return m.group(1)
        else:
            return None
    finally:
        fp.seek(pos)


def sorted_dict_repr(d):
    """repr() a dictionary with the keys in order.

    Used by the lexer unit test to compare parse trees based on strings.

    """
    keys = list(d.keys())
    keys.sort()
    return "{" + ", ".join("%r: %r" % (k, d[k]) for k in keys) + "}"


def restore__ast(_ast):
    """Attempt to restore the required classes to the _ast module if it
    appears to be missing them
    """
    if hasattr(_ast, "AST"):
        return
    _ast.PyCF_ONLY_AST = 2 << 9
    m = compile(
        """\
def foo(): pass
class Bar: pass
if False: pass
baz = 'mako'
1 + 2 - 3 * 4 / 5
6 // 7 % 8 << 9 >> 10
11 & 12 ^ 13 | 14
15 and 16 or 17
-baz + (not +18) - ~17
baz and 'foo' or 'bar'
(mako is baz == baz) is not baz != mako
mako > baz < mako >= baz <= mako
mako in baz not in mako""",
        "<unknown>",
        "exec",
        _ast.PyCF_ONLY_AST,
    )
    _ast.Module = type(m)

    for cls in _ast.Module.__mro__:
        if cls.__name__ == "mod":
            _ast.mod = cls
        elif cls.__name__ == "AST":
            _ast.AST = cls

    _ast.FunctionDef = type(m.body[0])
    _ast.ClassDef = type(m.body[1])
    _ast.If = type(m.body[2])

    _ast.Name = type(m.body[3].targets[0])
    _ast.Store = type(m.body[3].targets[0].ctx)
    _ast.Str = type(m.body[3].value)

    _ast.Sub = type(m.body[4].value.op)
    _ast.Add = type(m.body[4].value.left.op)
    _ast.Div = type(m.body[4].value.right.op)
    _ast.Mult = type(m.body[4].value.right.left.op)

    _ast.RShift = type(m.body[5].value.op)
    _ast.LShift = type(m.body[5].value.left.op)
    _ast.Mod = type(m.body[5].value.left.left.op)
    _ast.FloorDiv = type(m.body[5].value.left.left.left.op)

    _ast.BitOr = type(m.body[6].value.op)
    _ast.BitXor = type(m.body[6].value.left.op)
    _ast.BitAnd = type(m.body[6].value.left.left.op)

    _ast.Or = type(m.body[7].value.op)
    _ast.And = type(m.body[7].value.values[0].op)

    _ast.Invert = type(m.body[8].value.right.op)
    _ast.Not = type(m.body[8].value.left.right.op)
    _ast.UAdd = type(m.body[8].value.left.right.operand.op)
    _ast.USub = type(m.body[8].value.left.left.op)

    _ast.Or = type(m.body[9].value.op)
    _ast.And = type(m.body[9].value.values[0].op)

    _ast.IsNot = type(m.body[10].value.ops[0])
    _ast.NotEq = type(m.body[10].value.ops[1])
    _ast.Is = type(m.body[10].value.left.ops[0])
    _ast.Eq = type(m.body[10].value.left.ops[1])

    _ast.Gt = type(m.body[11].value.ops[0])
    _ast.Lt = type(m.body[11].value.ops[1])
    _ast.GtE = type(m.body[11].value.ops[2])
    _ast.LtE = type(m.body[11].value.ops[3])

    _ast.In = type(m.body[12].value.ops[0])
    _ast.NotIn = type(m.body[12].value.ops[1])


def read_file(path, mode="rb"):
    with open(path, mode) as fp:
        return fp.read()


def read_python_file(path):
    fp = open(path, "rb")
    try:
        encoding = parse_encoding(fp)
        data = fp.read()
        if encoding:
            data = data.decode(encoding)
        return data
    finally:
        fp.close()
