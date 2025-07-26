import functools
import uuid

cimport cython
cimport cpython

from libc.stdint cimport uint8_t, int8_t
from libc.string cimport memcpy, memcmp


cdef extern from "Python.h":
    int PyUnicode_1BYTE_KIND
    const char* PyUnicode_AsUTF8AndSize(
        object unicode, Py_ssize_t *size) except NULL
    object PyUnicode_FromKindAndData(
        int kind, const void *buffer, Py_ssize_t size)


cdef extern from "./tohex.h":
    cdef void uuid_to_str(const char *source, char *dest)
    cdef void uuid_to_hex(const char *source, char *dest)


# A more efficient UUID type implementation
# (6-7x faster than the starndard uuid.UUID):
#
# -= Benchmark results (less is better): =-
#
# std_UUID(bytes):      1.2368
# c_UUID(bytes):      * 0.1645 (7.52x)
# object():             0.1483
#
# std_UUID(str):        1.8038
# c_UUID(str):        * 0.2313 (7.80x)
#
# str(std_UUID()):      1.4625
# str(c_UUID()):      * 0.2681 (5.46x)
# str(object()):        0.5975
#
# std_UUID().bytes:     0.3508
# c_UUID().bytes:     * 0.1068 (3.28x)
#
# std_UUID().int:       0.0871
# c_UUID().int:       * 0.0856
#
# std_UUID().hex:       0.4871
# c_UUID().hex:       * 0.1405
#
# hash(std_UUID()):     0.3635
# hash(c_UUID()):     * 0.1564 (2.32x)
#
# dct[std_UUID()]:      0.3319
# dct[c_UUID()]:      * 0.1570 (2.11x)
#
# std_UUID() ==:        0.3478
# c_UUID() ==:        * 0.0915 (3.80x)


cdef char _hextable[256]
_hextable[:] = [
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1, 0,1,2,3,4,5,6,7,8,9,-1,-1,-1,-1,-1,-1,-1,10,11,12,13,14,15,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,10,11,12,13,14,15,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1
]


cdef std_UUID = uuid.UUID


cdef pg_uuid_bytes_from_str(str u, char *out):
    cdef:
        const char *orig_buf
        Py_ssize_t size
        unsigned char ch
        uint8_t acc, part, acc_set
        int i, j

    orig_buf = PyUnicode_AsUTF8AndSize(u, &size)
    if size > 36 or size < 32:
        raise ValueError(
            f'invalid UUID {u!r}: '
            f'length must be between 32..36 characters, got {size}')

    acc_set = 0
    j = 0
    for i in range(size):
        ch = <unsigned char>orig_buf[i]
        if ch == <unsigned char>b'-':
            continue

        part = <uint8_t><int8_t>_hextable[ch]
        if part == <uint8_t>-1:
            if ch >= 0x20 and ch <= 0x7e:
                raise ValueError(
                    f'invalid UUID {u!r}: unexpected character {chr(ch)!r}')
            else:
                raise ValueError('invalid UUID {u!r}: unexpected character')

        if acc_set:
            acc |= part
            out[j] = <char>acc
            acc_set = 0
            j += 1
        else:
            acc = <uint8_t>(part << 4)
            acc_set = 1

        if j > 16 or (j == 16 and acc_set):
            raise ValueError(
                f'invalid UUID {u!r}: decodes to more than 16 bytes')

    if j != 16:
        raise ValueError(
            f'invalid UUID {u!r}: decodes to less than 16 bytes')


cdef class __UUIDReplaceMe:
    pass


cdef pg_uuid_from_buf(const char *buf):
    cdef:
        UUID u = UUID.__new__(UUID)
    memcpy(u._data, buf, 16)
    return u


@cython.final
@cython.no_gc_clear
cdef class UUID(__UUIDReplaceMe):

    cdef:
        char _data[16]
        object _int
        object _hash
        object __weakref__

    def __cinit__(self):
        self._int = None
        self._hash = None

    def __init__(self, inp):
        cdef:
            char *buf
            Py_ssize_t size

        if cpython.PyBytes_Check(inp):
            cpython.PyBytes_AsStringAndSize(inp, &buf, &size)
            if size != 16:
                raise ValueError(f'16 bytes were expected, got {size}')
            memcpy(self._data, buf, 16)

        elif cpython.PyUnicode_Check(inp):
            pg_uuid_bytes_from_str(inp, self._data)
        else:
            raise TypeError(f'a bytes or str object expected, got {inp!r}')

    @property
    def bytes(self):
        return cpython.PyBytes_FromStringAndSize(self._data, 16)

    @property
    def int(self):
        if self._int is None:
            # The cache is important because `self.int` can be
            # used multiple times by __hash__ etc.
            self._int = int.from_bytes(self.bytes, 'big')
        return self._int

    @property
    def is_safe(self):
        return uuid.SafeUUID.unknown

    def __str__(self):
        cdef char out[36]
        uuid_to_str(self._data, out)
        return PyUnicode_FromKindAndData(PyUnicode_1BYTE_KIND, <void*>out, 36)

    @property
    def hex(self):
        cdef char out[32]
        uuid_to_hex(self._data, out)
        return PyUnicode_FromKindAndData(PyUnicode_1BYTE_KIND, <void*>out, 32)

    def __repr__(self):
        return f"UUID('{self}')"

    def __reduce__(self):
        return (type(self), (self.bytes,))

    def __eq__(self, other):
        if type(other) is UUID:
            return memcmp(self._data, (<UUID>other)._data, 16) == 0
        if isinstance(other, std_UUID):
            return self.int == other.int
        return NotImplemented

    def __ne__(self, other):
        if type(other) is UUID:
            return memcmp(self._data, (<UUID>other)._data, 16) != 0
        if isinstance(other, std_UUID):
            return self.int != other.int
        return NotImplemented

    def __lt__(self, other):
        if type(other) is UUID:
            return memcmp(self._data, (<UUID>other)._data, 16) < 0
        if isinstance(other, std_UUID):
            return self.int < other.int
        return NotImplemented

    def __gt__(self, other):
        if type(other) is UUID:
            return memcmp(self._data, (<UUID>other)._data, 16) > 0
        if isinstance(other, std_UUID):
            return self.int > other.int
        return NotImplemented

    def __le__(self, other):
        if type(other) is UUID:
            return memcmp(self._data, (<UUID>other)._data, 16) <= 0
        if isinstance(other, std_UUID):
            return self.int <= other.int
        return NotImplemented

    def __ge__(self, other):
        if type(other) is UUID:
            return memcmp(self._data, (<UUID>other)._data, 16) >= 0
        if isinstance(other, std_UUID):
            return self.int >= other.int
        return NotImplemented

    def __hash__(self):
        # In EdgeDB every schema object has a uuid and there are
        # huge hash-maps of them. We want UUID.__hash__ to be
        # as fast as possible.
        if self._hash is not None:
            return self._hash

        self._hash = hash(self.int)
        return self._hash

    def __int__(self):
        return self.int

    @property
    def bytes_le(self):
        bytes = self.bytes
        return (bytes[4-1::-1] + bytes[6-1:4-1:-1] + bytes[8-1:6-1:-1] +
                bytes[8:])

    @property
    def fields(self):
        return (self.time_low, self.time_mid, self.time_hi_version,
                self.clock_seq_hi_variant, self.clock_seq_low, self.node)

    @property
    def time_low(self):
        return self.int >> 96

    @property
    def time_mid(self):
        return (self.int >> 80) & 0xffff

    @property
    def time_hi_version(self):
        return (self.int >> 64) & 0xffff

    @property
    def clock_seq_hi_variant(self):
        return (self.int >> 56) & 0xff

    @property
    def clock_seq_low(self):
        return (self.int >> 48) & 0xff

    @property
    def time(self):
        return (((self.time_hi_version & 0x0fff) << 48) |
                (self.time_mid << 32) | self.time_low)

    @property
    def clock_seq(self):
        return (((self.clock_seq_hi_variant & 0x3f) << 8) |
                self.clock_seq_low)

    @property
    def node(self):
        return self.int & 0xffffffffffff

    @property
    def urn(self):
        return 'urn:uuid:' + str(self)

    @property
    def variant(self):
        if not self.int & (0x8000 << 48):
            return uuid.RESERVED_NCS
        elif not self.int & (0x4000 << 48):
            return uuid.RFC_4122
        elif not self.int & (0x2000 << 48):
            return uuid.RESERVED_MICROSOFT
        else:
            return uuid.RESERVED_FUTURE

    @property
    def version(self):
        # The version bits are only meaningful for RFC 4122 UUIDs.
        if self.variant == uuid.RFC_4122:
            return int((self.int >> 76) & 0xf)


# <hack>
# In order for `isinstance(pgproto.UUID, uuid.UUID)` to work,
# patch __bases__ and __mro__ by injecting `uuid.UUID`.
#
# We apply brute-force here because the following pattern stopped
# working with Python 3.8:
#
#   cdef class OurUUID:
#       ...
#
#   class UUID(OurUUID, uuid.UUID):
#       ...
#
# With Python 3.8 it now produces
#
#   "TypeError: multiple bases have instance lay-out conflict"
#
# error.  Maybe it's possible to fix this some other way, but
# the best solution possible would be to just contribute our
# faster UUID to the standard library and not have this problem
# at all.  For now this hack is pretty safe and should be
# compatible with future Pythons for long enough.
#
assert UUID.__bases__[0] is __UUIDReplaceMe
assert UUID.__mro__[1] is __UUIDReplaceMe
cpython.Py_INCREF(std_UUID)
cpython.PyTuple_SET_ITEM(UUID.__bases__, 0, std_UUID)
cpython.Py_INCREF(std_UUID)
cpython.PyTuple_SET_ITEM(UUID.__mro__, 1, std_UUID)
# </hack>


cdef pg_UUID = UUID
