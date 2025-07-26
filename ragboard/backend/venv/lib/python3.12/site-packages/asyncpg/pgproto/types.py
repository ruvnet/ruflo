# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import builtins
import sys
import typing

if sys.version_info >= (3, 8):
    from typing import Literal, SupportsIndex
else:
    from typing_extensions import Literal, SupportsIndex


__all__ = (
    'BitString', 'Point', 'Path', 'Polygon',
    'Box', 'Line', 'LineSegment', 'Circle',
)

_BitString = typing.TypeVar('_BitString', bound='BitString')
_BitOrderType = Literal['big', 'little']


class BitString:
    """Immutable representation of PostgreSQL `bit` and `varbit` types."""

    __slots__ = '_bytes', '_bitlength'

    def __init__(self,
                 bitstring: typing.Optional[builtins.bytes] = None) -> None:
        if not bitstring:
            self._bytes = bytes()
            self._bitlength = 0
        else:
            bytelen = len(bitstring) // 8 + 1
            bytes_ = bytearray(bytelen)
            byte = 0
            byte_pos = 0
            bit_pos = 0

            for i, bit in enumerate(bitstring):
                if bit == ' ':  # type: ignore
                    continue
                bit = int(bit)
                if bit != 0 and bit != 1:
                    raise ValueError(
                        'invalid bit value at position {}'.format(i))

                byte |= bit << (8 - bit_pos - 1)
                bit_pos += 1
                if bit_pos == 8:
                    bytes_[byte_pos] = byte
                    byte = 0
                    byte_pos += 1
                    bit_pos = 0

            if bit_pos != 0:
                bytes_[byte_pos] = byte

            bitlen = byte_pos * 8 + bit_pos
            bytelen = byte_pos + (1 if bit_pos else 0)

            self._bytes = bytes(bytes_[:bytelen])
            self._bitlength = bitlen

    @classmethod
    def frombytes(cls: typing.Type[_BitString],
                  bytes_: typing.Optional[builtins.bytes] = None,
                  bitlength: typing.Optional[int] = None) -> _BitString:
        if bitlength is None:
            if bytes_ is None:
                bytes_ = bytes()
                bitlength = 0
            else:
                bitlength = len(bytes_) * 8
        else:
            if bytes_ is None:
                bytes_ = bytes(bitlength // 8 + 1)
                bitlength = bitlength
            else:
                bytes_len = len(bytes_) * 8

                if bytes_len == 0 and bitlength != 0:
                    raise ValueError('invalid bit length specified')

                if bytes_len != 0 and bitlength == 0:
                    raise ValueError('invalid bit length specified')

                if bitlength < bytes_len - 8:
                    raise ValueError('invalid bit length specified')

                if bitlength > bytes_len:
                    raise ValueError('invalid bit length specified')

        result = cls()
        result._bytes = bytes_
        result._bitlength = bitlength

        return result

    @property
    def bytes(self) -> builtins.bytes:
        return self._bytes

    def as_string(self) -> str:
        s = ''

        for i in range(self._bitlength):
            s += str(self._getitem(i))
            if i % 4 == 3:
                s += ' '

        return s.strip()

    def to_int(self, bitorder: _BitOrderType = 'big',
               *, signed: bool = False) -> int:
        """Interpret the BitString as a Python int.
        Acts similarly to int.from_bytes.

        :param bitorder:
            Determines the bit order used to interpret the BitString. By
            default, this function uses Postgres conventions for casting bits
            to ints. If bitorder is 'big', the most significant bit is at the
            start of the string (this is the same as the default). If bitorder
            is 'little', the most significant bit is at the end of the string.

        :param bool signed:
            Determines whether two's complement is used to interpret the
            BitString. If signed is False, the returned value is always
            non-negative.

        :return int: An integer representing the BitString. Information about
                     the BitString's exact length is lost.

        .. versionadded:: 0.18.0
        """
        x = int.from_bytes(self._bytes, byteorder='big')
        x >>= -self._bitlength % 8
        if bitorder == 'big':
            pass
        elif bitorder == 'little':
            x = int(bin(x)[:1:-1].ljust(self._bitlength, '0'), 2)
        else:
            raise ValueError("bitorder must be either 'big' or 'little'")

        if signed and self._bitlength > 0 and x & (1 << (self._bitlength - 1)):
            x -= 1 << self._bitlength
        return x

    @classmethod
    def from_int(cls: typing.Type[_BitString], x: int, length: int,
                 bitorder: _BitOrderType = 'big', *, signed: bool = False) \
            -> _BitString:
        """Represent the Python int x as a BitString.
        Acts similarly to int.to_bytes.

        :param int x:
            An integer to represent. Negative integers are represented in two's
            complement form, unless the argument signed is False, in which case
            negative integers raise an OverflowError.

        :param int length:
            The length of the resulting BitString. An OverflowError is raised
            if the integer is not representable in this many bits.

        :param bitorder:
            Determines the bit order used in the BitString representation. By
            default, this function uses Postgres conventions for casting ints
            to bits. If bitorder is 'big', the most significant bit is at the
            start of the string (this is the same as the default). If bitorder
            is 'little', the most significant bit is at the end of the string.

        :param bool signed:
            Determines whether two's complement is used in the BitString
            representation. If signed is False and a negative integer is given,
            an OverflowError is raised.

        :return BitString: A BitString representing the input integer, in the
                           form specified by the other input args.

        .. versionadded:: 0.18.0
        """
        # Exception types are by analogy to int.to_bytes
        if length < 0:
            raise ValueError("length argument must be non-negative")
        elif length < x.bit_length():
            raise OverflowError("int too big to convert")

        if x < 0:
            if not signed:
                raise OverflowError("can't convert negative int to unsigned")
            x &= (1 << length) - 1

        if bitorder == 'big':
            pass
        elif bitorder == 'little':
            x = int(bin(x)[:1:-1].ljust(length, '0'), 2)
        else:
            raise ValueError("bitorder must be either 'big' or 'little'")

        x <<= (-length % 8)
        bytes_ = x.to_bytes((length + 7) // 8, byteorder='big')
        return cls.frombytes(bytes_, length)

    def __repr__(self) -> str:
        return '<BitString {}>'.format(self.as_string())

    __str__: typing.Callable[['BitString'], str] = __repr__

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, BitString):
            return NotImplemented

        return (self._bytes == other._bytes and
                self._bitlength == other._bitlength)

    def __hash__(self) -> int:
        return hash((self._bytes, self._bitlength))

    def _getitem(self, i: int) -> int:
        byte = self._bytes[i // 8]
        shift = 8 - i % 8 - 1
        return (byte >> shift) & 0x1

    def __getitem__(self, i: int) -> int:
        if isinstance(i, slice):
            raise NotImplementedError('BitString does not support slices')

        if i >= self._bitlength:
            raise IndexError('index out of range')

        return self._getitem(i)

    def __len__(self) -> int:
        return self._bitlength


class Point(typing.Tuple[float, float]):
    """Immutable representation of PostgreSQL `point` type."""

    __slots__ = ()

    def __new__(cls,
                x: typing.Union[typing.SupportsFloat,
                                SupportsIndex,
                                typing.Text,
                                builtins.bytes,
                                builtins.bytearray],
                y: typing.Union[typing.SupportsFloat,
                                SupportsIndex,
                                typing.Text,
                                builtins.bytes,
                                builtins.bytearray]) -> 'Point':
        return super().__new__(cls,
                               typing.cast(typing.Any, (float(x), float(y))))

    def __repr__(self) -> str:
        return '{}.{}({})'.format(
            type(self).__module__,
            type(self).__name__,
            tuple.__repr__(self)
        )

    @property
    def x(self) -> float:
        return self[0]

    @property
    def y(self) -> float:
        return self[1]


class Box(typing.Tuple[Point, Point]):
    """Immutable representation of PostgreSQL `box` type."""

    __slots__ = ()

    def __new__(cls, high: typing.Sequence[float],
                low: typing.Sequence[float]) -> 'Box':
        return super().__new__(cls,
                               typing.cast(typing.Any, (Point(*high),
                                                        Point(*low))))

    def __repr__(self) -> str:
        return '{}.{}({})'.format(
            type(self).__module__,
            type(self).__name__,
            tuple.__repr__(self)
        )

    @property
    def high(self) -> Point:
        return self[0]

    @property
    def low(self) -> Point:
        return self[1]


class Line(typing.Tuple[float, float, float]):
    """Immutable representation of PostgreSQL `line` type."""

    __slots__ = ()

    def __new__(cls, A: float, B: float, C: float) -> 'Line':
        return super().__new__(cls, typing.cast(typing.Any, (A, B, C)))

    @property
    def A(self) -> float:
        return self[0]

    @property
    def B(self) -> float:
        return self[1]

    @property
    def C(self) -> float:
        return self[2]


class LineSegment(typing.Tuple[Point, Point]):
    """Immutable representation of PostgreSQL `lseg` type."""

    __slots__ = ()

    def __new__(cls, p1: typing.Sequence[float],
                p2: typing.Sequence[float]) -> 'LineSegment':
        return super().__new__(cls,
                               typing.cast(typing.Any, (Point(*p1),
                                                        Point(*p2))))

    def __repr__(self) -> str:
        return '{}.{}({})'.format(
            type(self).__module__,
            type(self).__name__,
            tuple.__repr__(self)
        )

    @property
    def p1(self) -> Point:
        return self[0]

    @property
    def p2(self) -> Point:
        return self[1]


class Path:
    """Immutable representation of PostgreSQL `path` type."""

    __slots__ = '_is_closed', 'points'

    points: typing.Tuple[Point, ...]

    def __init__(self, *points: typing.Sequence[float],
                 is_closed: bool = False) -> None:
        self.points = tuple(Point(*p) for p in points)
        self._is_closed = is_closed

    @property
    def is_closed(self) -> bool:
        return self._is_closed

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Path):
            return NotImplemented

        return (self.points == other.points and
                self._is_closed == other._is_closed)

    def __hash__(self) -> int:
        return hash((self.points, self.is_closed))

    def __iter__(self) -> typing.Iterator[Point]:
        return iter(self.points)

    def __len__(self) -> int:
        return len(self.points)

    @typing.overload
    def __getitem__(self, i: int) -> Point:
        ...

    @typing.overload
    def __getitem__(self, i: slice) -> typing.Tuple[Point, ...]:
        ...

    def __getitem__(self, i: typing.Union[int, slice]) \
            -> typing.Union[Point, typing.Tuple[Point, ...]]:
        return self.points[i]

    def __contains__(self, point: object) -> bool:
        return point in self.points


class Polygon(Path):
    """Immutable representation of PostgreSQL `polygon` type."""

    __slots__ = ()

    def __init__(self, *points: typing.Sequence[float]) -> None:
        # polygon is always closed
        super().__init__(*points, is_closed=True)


class Circle(typing.Tuple[Point, float]):
    """Immutable representation of PostgreSQL `circle` type."""

    __slots__ = ()

    def __new__(cls, center: Point, radius: float) -> 'Circle':
        return super().__new__(cls, typing.cast(typing.Any, (center, radius)))

    @property
    def center(self) -> Point:
        return self[0]

    @property
    def radius(self) -> float:
        return self[1]
