# sql/sqltypes.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""SQL specific types.

"""
from __future__ import annotations

import collections.abc as collections_abc
import datetime as dt
import decimal
import enum
import json
import pickle
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import List
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
from uuid import UUID as _python_UUID

from . import coercions
from . import elements
from . import operators
from . import roles
from . import type_api
from .base import _NONE_NAME
from .base import NO_ARG
from .base import SchemaEventTarget
from .cache_key import HasCacheKey
from .elements import quoted_name
from .elements import Slice
from .elements import TypeCoerce as type_coerce  # noqa
from .type_api import Emulated
from .type_api import NativeForEmulated  # noqa
from .type_api import to_instance as to_instance
from .type_api import TypeDecorator as TypeDecorator
from .type_api import TypeEngine as TypeEngine
from .type_api import TypeEngineMixin
from .type_api import Variant  # noqa
from .visitors import InternalTraversal
from .. import event
from .. import exc
from .. import inspection
from .. import util
from ..engine import processors
from ..util import langhelpers
from ..util import OrderedDict
from ..util.typing import is_literal
from ..util.typing import Literal
from ..util.typing import typing_get_args

if TYPE_CHECKING:
    from ._typing import _ColumnExpressionArgument
    from ._typing import _TypeEngineArgument
    from .operators import OperatorType
    from .schema import MetaData
    from .type_api import _BindProcessorType
    from .type_api import _ComparatorFactory
    from .type_api import _MatchedOnType
    from .type_api import _ResultProcessorType
    from ..engine.interfaces import Dialect

_T = TypeVar("_T", bound="Any")
_CT = TypeVar("_CT", bound=Any)
_TE = TypeVar("_TE", bound="TypeEngine[Any]")


class HasExpressionLookup(TypeEngineMixin):

    """Mixin expression adaptations based on lookup tables.

    These rules are currently used by the numeric, integer and date types
    which have detailed cross-expression coercion rules.

    """

    @property
    def _expression_adaptations(self):
        raise NotImplementedError()

    class Comparator(TypeEngine.Comparator[_CT]):
        __slots__ = ()

        _blank_dict = util.EMPTY_DICT

        def _adapt_expression(
            self,
            op: OperatorType,
            other_comparator: TypeEngine.Comparator[Any],
        ) -> Tuple[OperatorType, TypeEngine[Any]]:
            othertype = other_comparator.type._type_affinity
            if TYPE_CHECKING:
                assert isinstance(self.type, HasExpressionLookup)
            lookup = self.type._expression_adaptations.get(
                op, self._blank_dict
            ).get(othertype, self.type)
            if lookup is othertype:
                return (op, other_comparator.type)
            elif lookup is self.type._type_affinity:
                return (op, self.type)
            else:
                return (op, to_instance(lookup))

    comparator_factory: _ComparatorFactory[Any] = Comparator


class Concatenable(TypeEngineMixin):

    """A mixin that marks a type as supporting 'concatenation',
    typically strings."""

    class Comparator(TypeEngine.Comparator[_T]):
        __slots__ = ()

        def _adapt_expression(
            self,
            op: OperatorType,
            other_comparator: TypeEngine.Comparator[Any],
        ) -> Tuple[OperatorType, TypeEngine[Any]]:
            if op is operators.add and isinstance(
                other_comparator,
                (Concatenable.Comparator, NullType.Comparator),
            ):
                return operators.concat_op, self.expr.type
            else:
                return super()._adapt_expression(op, other_comparator)

    comparator_factory: _ComparatorFactory[Any] = Comparator


class Indexable(TypeEngineMixin):
    """A mixin that marks a type as supporting indexing operations,
    such as array or JSON structures.

    """

    class Comparator(TypeEngine.Comparator[_T]):
        __slots__ = ()

        def _setup_getitem(self, index):
            raise NotImplementedError()

        def __getitem__(self, index):
            (
                adjusted_op,
                adjusted_right_expr,
                result_type,
            ) = self._setup_getitem(index)
            return self.operate(
                adjusted_op, adjusted_right_expr, result_type=result_type
            )

    comparator_factory: _ComparatorFactory[Any] = Comparator


class String(Concatenable, TypeEngine[str]):

    """The base for all string and character types.

    In SQL, corresponds to VARCHAR.

    The `length` field is usually required when the `String` type is
    used within a CREATE TABLE statement, as VARCHAR requires a length
    on most databases.

    """

    __visit_name__ = "string"

    def __init__(
        self,
        length: Optional[int] = None,
        collation: Optional[str] = None,
    ):
        """
        Create a string-holding type.

        :param length: optional, a length for the column for use in
          DDL and CAST expressions.  May be safely omitted if no ``CREATE
          TABLE`` will be issued.  Certain databases may require a
          ``length`` for use in DDL, and will raise an exception when
          the ``CREATE TABLE`` DDL is issued if a ``VARCHAR``
          with no length is included.  Whether the value is
          interpreted as bytes or characters is database specific.

        :param collation: Optional, a column-level collation for
          use in DDL and CAST expressions.  Renders using the
          COLLATE keyword supported by SQLite, MySQL, and PostgreSQL.
          E.g.:

          .. sourcecode:: pycon+sql

            >>> from sqlalchemy import cast, select, String
            >>> print(select(cast('some string', String(collation='utf8'))))
            {printsql}SELECT CAST(:param_1 AS VARCHAR COLLATE utf8) AS anon_1

          .. note::

            In most cases, the :class:`.Unicode` or :class:`.UnicodeText`
            datatypes should be used for a :class:`_schema.Column` that expects
            to store non-ascii data. These datatypes will ensure that the
            correct types are used on the database.

        """

        self.length = length
        self.collation = collation

    def _resolve_for_literal(self, value):
        # I was SO PROUD of my regex trick, but we dont need it.
        # re.search(r"[^\u0000-\u007F]", value)

        if value.isascii():
            return _STRING
        else:
            return _UNICODE

    def literal_processor(self, dialect):
        def process(value):
            value = value.replace("'", "''")

            if dialect.identifier_preparer._double_percents:
                value = value.replace("%", "%%")

            return "'%s'" % value

        return process

    def bind_processor(self, dialect):
        return None

    def result_processor(self, dialect, coltype):
        return None

    @property
    def python_type(self):
        return str

    def get_dbapi_type(self, dbapi):
        return dbapi.STRING


class Text(String):

    """A variably sized string type.

    In SQL, usually corresponds to CLOB or TEXT.  In general, TEXT objects
    do not have a length; while some databases will accept a length
    argument here, it will be rejected by others.

    """

    __visit_name__ = "text"


class Unicode(String):

    """A variable length Unicode string type.

    The :class:`.Unicode` type is a :class:`.String` subclass that assumes
    input and output strings that may contain non-ASCII characters, and for
    some backends implies an underlying column type that is explicitly
    supporting of non-ASCII data, such as ``NVARCHAR`` on Oracle and SQL
    Server.  This will impact the output of ``CREATE TABLE`` statements and
    ``CAST`` functions at the dialect level.

    The character encoding used by the :class:`.Unicode` type that is used to
    transmit and receive data to the database is usually determined by the
    DBAPI itself. All modern DBAPIs accommodate non-ASCII strings but may have
    different methods of managing database encodings; if necessary, this
    encoding should be configured as detailed in the notes for the target DBAPI
    in the :ref:`dialect_toplevel` section.

    In modern SQLAlchemy, use of the :class:`.Unicode` datatype does not
    imply any encoding/decoding behavior within SQLAlchemy itself.  In Python
    3, all string objects are inherently Unicode capable, and SQLAlchemy
    does not produce bytestring objects nor does it accommodate a DBAPI that
    does not return Python Unicode objects in result sets for string values.

    .. warning:: Some database backends, particularly SQL Server with pyodbc,
       are known to have undesirable behaviors regarding data that is noted
       as being of ``NVARCHAR`` type as opposed to ``VARCHAR``, including
       datatype mismatch errors and non-use of indexes.  See the section
       on :meth:`.DialectEvents.do_setinputsizes` for background on working
       around unicode character issues for backends like SQL Server with
       pyodbc as well as cx_Oracle.

    .. seealso::

        :class:`.UnicodeText` - unlengthed textual counterpart
        to :class:`.Unicode`.

        :meth:`.DialectEvents.do_setinputsizes`


    """

    __visit_name__ = "unicode"

    def __init__(self, length=None, **kwargs):
        """
        Create a :class:`.Unicode` object.

        Parameters are the same as that of :class:`.String`.

        """
        super().__init__(length=length, **kwargs)


class UnicodeText(Text):

    """An unbounded-length Unicode string type.

    See :class:`.Unicode` for details on the unicode
    behavior of this object.

    Like :class:`.Unicode`, usage the :class:`.UnicodeText` type implies a
    unicode-capable type being used on the backend, such as
    ``NCLOB``, ``NTEXT``.

    """

    __visit_name__ = "unicode_text"

    def __init__(self, length=None, **kwargs):
        """
        Create a Unicode-converting Text type.

        Parameters are the same as that of :class:`_expression.TextClause`.

        """
        super().__init__(length=length, **kwargs)


class Integer(HasExpressionLookup, TypeEngine[int]):

    """A type for ``int`` integers."""

    __visit_name__ = "integer"

    if TYPE_CHECKING:

        @util.ro_memoized_property
        def _type_affinity(self) -> Type[Integer]:
            ...

    def get_dbapi_type(self, dbapi):
        return dbapi.NUMBER

    @property
    def python_type(self):
        return int

    def _resolve_for_literal(self, value):
        if value.bit_length() >= 32:
            return _BIGINTEGER
        else:
            return self

    def literal_processor(self, dialect):
        def process(value):
            return str(int(value))

        return process

    @util.memoized_property
    def _expression_adaptations(self):
        return {
            operators.add: {
                Date: Date,
                Integer: self.__class__,
                Numeric: Numeric,
            },
            operators.mul: {
                Interval: Interval,
                Integer: self.__class__,
                Numeric: Numeric,
            },
            operators.truediv: {Integer: Numeric, Numeric: Numeric},
            operators.floordiv: {Integer: self.__class__, Numeric: Numeric},
            operators.sub: {Integer: self.__class__, Numeric: Numeric},
        }


class SmallInteger(Integer):

    """A type for smaller ``int`` integers.

    Typically generates a ``SMALLINT`` in DDL, and otherwise acts like
    a normal :class:`.Integer` on the Python side.

    """

    __visit_name__ = "small_integer"


class BigInteger(Integer):

    """A type for bigger ``int`` integers.

    Typically generates a ``BIGINT`` in DDL, and otherwise acts like
    a normal :class:`.Integer` on the Python side.

    """

    __visit_name__ = "big_integer"


_N = TypeVar("_N", bound=Union[decimal.Decimal, float])


class Numeric(HasExpressionLookup, TypeEngine[_N]):

    """Base for non-integer numeric types, such as
    ``NUMERIC``, ``FLOAT``, ``DECIMAL``, and other variants.

    The :class:`.Numeric` datatype when used directly will render DDL
    corresponding to precision numerics if available, such as
    ``NUMERIC(precision, scale)``.  The :class:`.Float` subclass will
    attempt to render a floating-point datatype such as ``FLOAT(precision)``.

    :class:`.Numeric` returns Python ``decimal.Decimal`` objects by default,
    based on the default value of ``True`` for the
    :paramref:`.Numeric.asdecimal` parameter.  If this parameter is set to
    False, returned values are coerced to Python ``float`` objects.

    The :class:`.Float` subtype, being more specific to floating point,
    defaults the :paramref:`.Float.asdecimal` flag to False so that the
    default Python datatype is ``float``.

    .. note::

        When using a :class:`.Numeric` datatype against a database type that
        returns Python floating point values to the driver, the accuracy of the
        decimal conversion indicated by :paramref:`.Numeric.asdecimal` may be
        limited.   The behavior of specific numeric/floating point datatypes
        is a product of the SQL datatype in use, the Python :term:`DBAPI`
        in use, as well as strategies that may be present within
        the SQLAlchemy dialect in use.   Users requiring specific precision/
        scale are encouraged to experiment with the available datatypes
        in order to determine the best results.

    """

    __visit_name__ = "numeric"

    if TYPE_CHECKING:

        @util.ro_memoized_property
        def _type_affinity(self) -> Type[Numeric[_N]]:
            ...

    _default_decimal_return_scale = 10

    @overload
    def __init__(
        self: Numeric[decimal.Decimal],
        precision: Optional[int] = ...,
        scale: Optional[int] = ...,
        decimal_return_scale: Optional[int] = ...,
        asdecimal: Literal[True] = ...,
    ):
        ...

    @overload
    def __init__(
        self: Numeric[float],
        precision: Optional[int] = ...,
        scale: Optional[int] = ...,
        decimal_return_scale: Optional[int] = ...,
        asdecimal: Literal[False] = ...,
    ):
        ...

    def __init__(
        self,
        precision: Optional[int] = None,
        scale: Optional[int] = None,
        decimal_return_scale: Optional[int] = None,
        asdecimal: bool = True,
    ):
        """
        Construct a Numeric.

        :param precision: the numeric precision for use in DDL ``CREATE
          TABLE``.

        :param scale: the numeric scale for use in DDL ``CREATE TABLE``.

        :param asdecimal: default True.  Return whether or not
          values should be sent as Python Decimal objects, or
          as floats.   Different DBAPIs send one or the other based on
          datatypes - the Numeric type will ensure that return values
          are one or the other across DBAPIs consistently.

        :param decimal_return_scale: Default scale to use when converting
         from floats to Python decimals.  Floating point values will typically
         be much longer due to decimal inaccuracy, and most floating point
         database types don't have a notion of "scale", so by default the
         float type looks for the first ten decimal places when converting.
         Specifying this value will override that length.  Types which
         do include an explicit ".scale" value, such as the base
         :class:`.Numeric` as well as the MySQL float types, will use the
         value of ".scale" as the default for decimal_return_scale, if not
         otherwise specified.

        When using the ``Numeric`` type, care should be taken to ensure
        that the asdecimal setting is appropriate for the DBAPI in use -
        when Numeric applies a conversion from Decimal->float or float->
        Decimal, this conversion incurs an additional performance overhead
        for all result columns received.

        DBAPIs that return Decimal natively (e.g. psycopg2) will have
        better accuracy and higher performance with a setting of ``True``,
        as the native translation to Decimal reduces the amount of floating-
        point issues at play, and the Numeric type itself doesn't need
        to apply any further conversions.  However, another DBAPI which
        returns floats natively *will* incur an additional conversion
        overhead, and is still subject to floating point data loss - in
        which case ``asdecimal=False`` will at least remove the extra
        conversion overhead.

        """
        self.precision = precision
        self.scale = scale
        self.decimal_return_scale = decimal_return_scale
        self.asdecimal = asdecimal

    @property
    def _effective_decimal_return_scale(self):
        if self.decimal_return_scale is not None:
            return self.decimal_return_scale
        elif getattr(self, "scale", None) is not None:
            return self.scale
        else:
            return self._default_decimal_return_scale

    def get_dbapi_type(self, dbapi):
        return dbapi.NUMBER

    def literal_processor(self, dialect):
        def process(value):
            return str(value)

        return process

    @property
    def python_type(self):
        if self.asdecimal:
            return decimal.Decimal
        else:
            return float

    def bind_processor(self, dialect):
        if dialect.supports_native_decimal:
            return None
        else:
            return processors.to_float

    def result_processor(self, dialect, coltype):
        if self.asdecimal:
            if dialect.supports_native_decimal:
                # we're a "numeric", DBAPI will give us Decimal directly
                return None
            else:
                # we're a "numeric", DBAPI returns floats, convert.
                return processors.to_decimal_processor_factory(
                    decimal.Decimal,
                    self.scale
                    if self.scale is not None
                    else self._default_decimal_return_scale,
                )
        else:
            if dialect.supports_native_decimal:
                return processors.to_float
            else:
                return None

    @util.memoized_property
    def _expression_adaptations(self):
        return {
            operators.mul: {
                Interval: Interval,
                Numeric: self.__class__,
                Integer: self.__class__,
            },
            operators.truediv: {
                Numeric: self.__class__,
                Integer: self.__class__,
            },
            operators.add: {Numeric: self.__class__, Integer: self.__class__},
            operators.sub: {Numeric: self.__class__, Integer: self.__class__},
        }


class Float(Numeric[_N]):
    """Type representing floating point types, such as ``FLOAT`` or ``REAL``.

    This type returns Python ``float`` objects by default, unless the
    :paramref:`.Float.asdecimal` flag is set to ``True``, in which case they
    are coerced to ``decimal.Decimal`` objects.

    When a :paramref:`.Float.precision` is not provided in a
    :class:`_types.Float` type some backend may compile this type as
    an 8 bytes / 64 bit float datatype. To use a 4 bytes / 32 bit float
    datatype a precision <= 24 can usually be provided or the
    :class:`_types.REAL` type can be used.
    This is known to be the case in the PostgreSQL and MSSQL dialects
    that render the type as ``FLOAT`` that's in both an alias of
    ``DOUBLE PRECISION``. Other third party dialects may have similar
    behavior.
    """

    __visit_name__ = "float"

    scale = None

    @overload
    def __init__(
        self: Float[float],
        precision: Optional[int] = ...,
        asdecimal: Literal[False] = ...,
        decimal_return_scale: Optional[int] = ...,
    ):
        ...

    @overload
    def __init__(
        self: Float[decimal.Decimal],
        precision: Optional[int] = ...,
        asdecimal: Literal[True] = ...,
        decimal_return_scale: Optional[int] = ...,
    ):
        ...

    def __init__(
        self: Float[_N],
        precision: Optional[int] = None,
        asdecimal: bool = False,
        decimal_return_scale: Optional[int] = None,
    ):
        r"""
        Construct a Float.

        :param precision: the numeric precision for use in DDL ``CREATE
           TABLE``. Backends **should** attempt to ensure this precision
           indicates a number of digits for the generic
           :class:`_sqltypes.Float` datatype.

           .. note:: For the Oracle backend, the
              :paramref:`_sqltypes.Float.precision` parameter is not accepted
              when rendering DDL, as Oracle does not support float precision
              specified as a number of decimal places. Instead, use the
              Oracle-specific :class:`_oracle.FLOAT` datatype and specify the
              :paramref:`_oracle.FLOAT.binary_precision` parameter. This is new
              in version 2.0 of SQLAlchemy.

              To create a database agnostic :class:`_types.Float` that
              separately specifies binary precision for Oracle, use
              :meth:`_types.TypeEngine.with_variant` as follows::

                    from sqlalchemy import Column
                    from sqlalchemy import Float
                    from sqlalchemy.dialects import oracle

                    Column(
                        "float_data",
                        Float(5).with_variant(oracle.FLOAT(binary_precision=16), "oracle")
                    )

        :param asdecimal: the same flag as that of :class:`.Numeric`, but
          defaults to ``False``.   Note that setting this flag to ``True``
          results in floating point conversion.

        :param decimal_return_scale: Default scale to use when converting
         from floats to Python decimals.  Floating point values will typically
         be much longer due to decimal inaccuracy, and most floating point
         database types don't have a notion of "scale", so by default the
         float type looks for the first ten decimal places when converting.
         Specifying this value will override that length.  Note that the
         MySQL float types, which do include "scale", will use "scale"
         as the default for decimal_return_scale, if not otherwise specified.

        """  # noqa: E501
        self.precision = precision
        self.asdecimal = asdecimal
        self.decimal_return_scale = decimal_return_scale

    def result_processor(self, dialect, coltype):
        if self.asdecimal:
            return processors.to_decimal_processor_factory(
                decimal.Decimal, self._effective_decimal_return_scale
            )
        elif dialect.supports_native_decimal:
            return processors.to_float
        else:
            return None


class Double(Float[_N]):
    """A type for double ``FLOAT`` floating point types.

    Typically generates a ``DOUBLE`` or ``DOUBLE_PRECISION`` in DDL,
    and otherwise acts like a normal :class:`.Float` on the Python
    side.

    .. versionadded:: 2.0

    """

    __visit_name__ = "double"


class _RenderISO8601NoT:
    def _literal_processor_datetime(self, dialect):
        return self._literal_processor_portion(dialect, None)

    def _literal_processor_date(self, dialect):
        return self._literal_processor_portion(dialect, 0)

    def _literal_processor_time(self, dialect):
        return self._literal_processor_portion(dialect, -1)

    def _literal_processor_portion(self, dialect, _portion=None):
        assert _portion in (None, 0, -1)
        if _portion is not None:

            def process(value):
                return f"""'{value.isoformat().split("T")[_portion]}'"""

        else:

            def process(value):
                return f"""'{value.isoformat().replace("T", " ")}'"""

        return process


class DateTime(
    _RenderISO8601NoT, HasExpressionLookup, TypeEngine[dt.datetime]
):

    """A type for ``datetime.datetime()`` objects.

    Date and time types return objects from the Python ``datetime``
    module.  Most DBAPIs have built in support for the datetime
    module, with the noted exception of SQLite.  In the case of
    SQLite, date and time types are stored as strings which are then
    converted back to datetime objects when rows are returned.

    For the time representation within the datetime type, some
    backends include additional options, such as timezone support and
    fractional seconds support.  For fractional seconds, use the
    dialect-specific datatype, such as :class:`.mysql.TIME`.  For
    timezone support, use at least the :class:`_types.TIMESTAMP` datatype,
    if not the dialect-specific datatype object.

    """

    __visit_name__ = "datetime"

    def __init__(self, timezone: bool = False):
        """Construct a new :class:`.DateTime`.

        :param timezone: boolean.  Indicates that the datetime type should
         enable timezone support, if available on the
         **base date/time-holding type only**.   It is recommended
         to make use of the :class:`_types.TIMESTAMP` datatype directly when
         using this flag, as some databases include separate generic
         date/time-holding types distinct from the timezone-capable
         TIMESTAMP datatype, such as Oracle.


        """
        self.timezone = timezone

    def get_dbapi_type(self, dbapi):
        return dbapi.DATETIME

    def _resolve_for_literal(self, value):
        with_timezone = value.tzinfo is not None
        if with_timezone and not self.timezone:
            return DATETIME_TIMEZONE
        else:
            return self

    def literal_processor(self, dialect):
        return self._literal_processor_datetime(dialect)

    @property
    def python_type(self):
        return dt.datetime

    @util.memoized_property
    def _expression_adaptations(self):
        # Based on
        # https://www.postgresql.org/docs/current/static/functions-datetime.html.

        return {
            operators.add: {Interval: self.__class__},
            operators.sub: {Interval: self.__class__, DateTime: Interval},
        }


class Date(_RenderISO8601NoT, HasExpressionLookup, TypeEngine[dt.date]):

    """A type for ``datetime.date()`` objects."""

    __visit_name__ = "date"

    def get_dbapi_type(self, dbapi):
        return dbapi.DATETIME

    @property
    def python_type(self):
        return dt.date

    def literal_processor(self, dialect):
        return self._literal_processor_date(dialect)

    @util.memoized_property
    def _expression_adaptations(self):
        # Based on
        # https://www.postgresql.org/docs/current/static/functions-datetime.html.

        return {
            operators.add: {
                Integer: self.__class__,
                Interval: DateTime,
                Time: DateTime,
            },
            operators.sub: {
                # date - integer = date
                Integer: self.__class__,
                # date - date = integer.
                Date: Integer,
                Interval: DateTime,
                # date - datetime = interval,
                # this one is not in the PG docs
                # but works
                DateTime: Interval,
            },
        }


class Time(_RenderISO8601NoT, HasExpressionLookup, TypeEngine[dt.time]):

    """A type for ``datetime.time()`` objects."""

    __visit_name__ = "time"

    def __init__(self, timezone: bool = False):
        self.timezone = timezone

    def get_dbapi_type(self, dbapi):
        return dbapi.DATETIME

    @property
    def python_type(self):
        return dt.time

    def _resolve_for_literal(self, value):
        with_timezone = value.tzinfo is not None
        if with_timezone and not self.timezone:
            return TIME_TIMEZONE
        else:
            return self

    @util.memoized_property
    def _expression_adaptations(self):
        # Based on
        # https://www.postgresql.org/docs/current/static/functions-datetime.html.

        return {
            operators.add: {Date: DateTime, Interval: self.__class__},
            operators.sub: {Time: Interval, Interval: self.__class__},
        }

    def literal_processor(self, dialect):
        return self._literal_processor_time(dialect)


class _Binary(TypeEngine[bytes]):

    """Define base behavior for binary types."""

    def __init__(self, length: Optional[int] = None):
        self.length = length

    def literal_processor(self, dialect):
        def process(value):
            # TODO: this is useless for real world scenarios; implement
            # real binary literals
            value = value.decode(
                dialect._legacy_binary_type_literal_encoding
            ).replace("'", "''")
            return "'%s'" % value

        return process

    @property
    def python_type(self):
        return bytes

    # Python 3 - sqlite3 doesn't need the `Binary` conversion
    # here, though pg8000 does to indicate "bytea"
    def bind_processor(self, dialect):
        if dialect.dbapi is None:
            return None

        DBAPIBinary = dialect.dbapi.Binary

        def process(value):
            if value is not None:
                return DBAPIBinary(value)
            else:
                return None

        return process

    # Python 3 has native bytes() type
    # both sqlite3 and pg8000 seem to return it,
    # psycopg2 as of 2.5 returns 'memoryview'
    def result_processor(self, dialect, coltype):
        if dialect.returns_native_bytes:
            return None

        def process(value):
            if value is not None:
                value = bytes(value)
            return value

        return process

    def coerce_compared_value(self, op, value):
        """See :meth:`.TypeEngine.coerce_compared_value` for a description."""

        if isinstance(value, str):
            return self
        else:
            return super().coerce_compared_value(op, value)

    def get_dbapi_type(self, dbapi):
        return dbapi.BINARY


class LargeBinary(_Binary):

    """A type for large binary byte data.

    The :class:`.LargeBinary` type corresponds to a large and/or unlengthed
    binary type for the target platform, such as BLOB on MySQL and BYTEA for
    PostgreSQL.  It also handles the necessary conversions for the DBAPI.

    """

    __visit_name__ = "large_binary"

    def __init__(self, length: Optional[int] = None):
        """
        Construct a LargeBinary type.

        :param length: optional, a length for the column for use in
          DDL statements, for those binary types that accept a length,
          such as the MySQL BLOB type.

        """
        _Binary.__init__(self, length=length)


class SchemaType(SchemaEventTarget, TypeEngineMixin):

    """Add capabilities to a type which allow for schema-level DDL to be
    associated with a type.

    Supports types that must be explicitly created/dropped (i.e. PG ENUM type)
    as well as types that are complimented by table or schema level
    constraints, triggers, and other rules.

    :class:`.SchemaType` classes can also be targets for the
    :meth:`.DDLEvents.before_parent_attach` and
    :meth:`.DDLEvents.after_parent_attach` events, where the events fire off
    surrounding the association of the type object with a parent
    :class:`_schema.Column`.

    .. seealso::

        :class:`.Enum`

        :class:`.Boolean`


    """

    _use_schema_map = True

    name: Optional[str]

    def __init__(
        self,
        name: Optional[str] = None,
        schema: Optional[str] = None,
        metadata: Optional[MetaData] = None,
        inherit_schema: bool = False,
        quote: Optional[bool] = None,
        _create_events: bool = True,
        _adapted_from: Optional[SchemaType] = None,
    ):
        if name is not None:
            self.name = quoted_name(name, quote)
        else:
            self.name = None
        self.schema = schema
        self.metadata = metadata
        self.inherit_schema = inherit_schema
        self._create_events = _create_events

        if _create_events and self.metadata:
            event.listen(
                self.metadata,
                "before_create",
                util.portable_instancemethod(self._on_metadata_create),
            )
            event.listen(
                self.metadata,
                "after_drop",
                util.portable_instancemethod(self._on_metadata_drop),
            )

        if _adapted_from:
            self.dispatch = self.dispatch._join(_adapted_from.dispatch)

    def _set_parent(self, column, **kw):
        # set parent hook is when this type is associated with a column.
        # Column calls it for all SchemaEventTarget instances, either the
        # base type and/or variants in _variant_mapping.

        # we want to register a second hook to trigger when that column is
        # associated with a table.  in that event, we and all of our variants
        # may want to set up some state on the table such as a CheckConstraint
        # that will conditionally render at DDL render time.

        # the base SchemaType also sets up events for
        # on_table/metadata_create/drop in this method, which is used by
        # "native" types with a separate CREATE/DROP e.g. Postgresql.ENUM

        column._on_table_attach(util.portable_instancemethod(self._set_table))

    def _variant_mapping_for_set_table(self, column):
        if column.type._variant_mapping:
            variant_mapping = dict(column.type._variant_mapping)
            variant_mapping["_default"] = column.type
        else:
            variant_mapping = None
        return variant_mapping

    def _set_table(self, column, table):
        if self.inherit_schema:
            self.schema = table.schema
        elif self.metadata and self.schema is None and self.metadata.schema:
            self.schema = self.metadata.schema

        if not self._create_events:
            return

        variant_mapping = self._variant_mapping_for_set_table(column)

        event.listen(
            table,
            "before_create",
            util.portable_instancemethod(
                self._on_table_create, {"variant_mapping": variant_mapping}
            ),
        )
        event.listen(
            table,
            "after_drop",
            util.portable_instancemethod(
                self._on_table_drop, {"variant_mapping": variant_mapping}
            ),
        )
        if self.metadata is None:
            # if SchemaType were created w/ a metadata argument, these
            # events would already have been associated with that metadata
            # and would preclude an association with table.metadata
            event.listen(
                table.metadata,
                "before_create",
                util.portable_instancemethod(
                    self._on_metadata_create,
                    {"variant_mapping": variant_mapping},
                ),
            )
            event.listen(
                table.metadata,
                "after_drop",
                util.portable_instancemethod(
                    self._on_metadata_drop,
                    {"variant_mapping": variant_mapping},
                ),
            )

    def copy(self, **kw):
        return self.adapt(
            cast("Type[TypeEngine[Any]]", self.__class__),
            _create_events=True,
        )

    @overload
    def adapt(self, cls: Type[_TE], **kw: Any) -> _TE:
        ...

    @overload
    def adapt(self, cls: Type[TypeEngineMixin], **kw: Any) -> TypeEngine[Any]:
        ...

    def adapt(
        self, cls: Type[Union[TypeEngine[Any], TypeEngineMixin]], **kw: Any
    ) -> TypeEngine[Any]:
        kw.setdefault("_create_events", False)
        kw.setdefault("_adapted_from", self)
        return super().adapt(cls, **kw)

    def create(self, bind, checkfirst=False):
        """Issue CREATE DDL for this type, if applicable."""

        t = self.dialect_impl(bind.dialect)
        if isinstance(t, SchemaType) and t.__class__ is not self.__class__:
            t.create(bind, checkfirst=checkfirst)

    def drop(self, bind, checkfirst=False):
        """Issue DROP DDL for this type, if applicable."""

        t = self.dialect_impl(bind.dialect)
        if isinstance(t, SchemaType) and t.__class__ is not self.__class__:
            t.drop(bind, checkfirst=checkfirst)

    def _on_table_create(self, target, bind, **kw):
        if not self._is_impl_for_variant(bind.dialect, kw):
            return

        t = self.dialect_impl(bind.dialect)
        if isinstance(t, SchemaType) and t.__class__ is not self.__class__:
            t._on_table_create(target, bind, **kw)

    def _on_table_drop(self, target, bind, **kw):
        if not self._is_impl_for_variant(bind.dialect, kw):
            return

        t = self.dialect_impl(bind.dialect)
        if isinstance(t, SchemaType) and t.__class__ is not self.__class__:
            t._on_table_drop(target, bind, **kw)

    def _on_metadata_create(self, target, bind, **kw):
        if not self._is_impl_for_variant(bind.dialect, kw):
            return

        t = self.dialect_impl(bind.dialect)
        if isinstance(t, SchemaType) and t.__class__ is not self.__class__:
            t._on_metadata_create(target, bind, **kw)

    def _on_metadata_drop(self, target, bind, **kw):
        if not self._is_impl_for_variant(bind.dialect, kw):
            return

        t = self.dialect_impl(bind.dialect)
        if isinstance(t, SchemaType) and t.__class__ is not self.__class__:
            t._on_metadata_drop(target, bind, **kw)

    def _is_impl_for_variant(self, dialect, kw):
        variant_mapping = kw.pop("variant_mapping", None)

        if not variant_mapping:
            return True

        # for types that have _variant_mapping, all the impls in the map
        # that are SchemaEventTarget subclasses get set up as event holders.
        # this is so that constructs that need
        # to be associated with the Table at dialect-agnostic time etc. like
        # CheckConstraints can be set up with that table.  they then add
        # to these constraints a DDL check_rule that among other things
        # will check this _is_impl_for_variant() method to determine when
        # the dialect is known that we are part of the table's DDL sequence.

        # since PostgreSQL is the only DB that has ARRAY this can only
        # be integration tested by PG-specific tests
        def _we_are_the_impl(typ):
            return (
                typ is self
                or isinstance(typ, ARRAY)
                and typ.item_type is self  # type: ignore[comparison-overlap]
            )

        if dialect.name in variant_mapping and _we_are_the_impl(
            variant_mapping[dialect.name]
        ):
            return True
        elif dialect.name not in variant_mapping:
            return _we_are_the_impl(variant_mapping["_default"])


class Enum(String, SchemaType, Emulated, TypeEngine[Union[str, enum.Enum]]):
    """Generic Enum Type.

    The :class:`.Enum` type provides a set of possible string values
    which the column is constrained towards.

    The :class:`.Enum` type will make use of the backend's native "ENUM"
    type if one is available; otherwise, it uses a VARCHAR datatype.
    An option also exists to automatically produce a CHECK constraint
    when the VARCHAR (so called "non-native") variant is produced;
    see the  :paramref:`.Enum.create_constraint` flag.

    The :class:`.Enum` type also provides in-Python validation of string
    values during both read and write operations.  When reading a value
    from the database in a result set, the string value is always checked
    against the list of possible values and a ``LookupError`` is raised
    if no match is found.  When passing a value to the database as a
    plain string within a SQL statement, if the
    :paramref:`.Enum.validate_strings` parameter is
    set to True, a ``LookupError`` is raised for any string value that's
    not located in the given list of possible values; note that this
    impacts usage of LIKE expressions with enumerated values (an unusual
    use case).

    The source of enumerated values may be a list of string values, or
    alternatively a PEP-435-compliant enumerated class.  For the purposes
    of the :class:`.Enum` datatype, this class need only provide a
    ``__members__`` method.

    When using an enumerated class, the enumerated objects are used
    both for input and output, rather than strings as is the case with
    a plain-string enumerated type::

        import enum
        from sqlalchemy import Enum

        class MyEnum(enum.Enum):
            one = 1
            two = 2
            three = 3

        t = Table(
            'data', MetaData(),
            Column('value', Enum(MyEnum))
        )

        connection.execute(t.insert(), {"value": MyEnum.two})
        assert connection.scalar(t.select()) is MyEnum.two

    Above, the string names of each element, e.g. "one", "two", "three",
    are persisted to the database; the values of the Python Enum, here
    indicated as integers, are **not** used; the value of each enum can
    therefore be any kind of Python object whether or not it is persistable.

    In order to persist the values and not the names, the
    :paramref:`.Enum.values_callable` parameter may be used.   The value of
    this parameter is a user-supplied callable, which  is intended to be used
    with a PEP-435-compliant enumerated class and  returns a list of string
    values to be persisted.   For a simple enumeration that uses string values,
    a callable such as  ``lambda x: [e.value for e in x]`` is sufficient.

    .. seealso::

        :ref:`orm_declarative_mapped_column_enums` - background on using
        the :class:`_sqltypes.Enum` datatype with the ORM's
        :ref:`ORM Annotated Declarative <orm_declarative_mapped_column>`
        feature.

        :class:`_postgresql.ENUM` - PostgreSQL-specific type,
        which has additional functionality.

        :class:`.mysql.ENUM` - MySQL-specific type

    """

    __visit_name__ = "enum"

    def __init__(self, *enums: object, **kw: Any):
        r"""Construct an enum.

        Keyword arguments which don't apply to a specific backend are ignored
        by that backend.

        :param \*enums: either exactly one PEP-435 compliant enumerated type
           or one or more string labels.

        :param create_constraint: defaults to False.  When creating a
           non-native enumerated type, also build a CHECK constraint on the
           database against the valid values.

           .. note:: it is strongly recommended that the CHECK constraint
              have an explicit name in order to support schema-management
              concerns.  This can be established either by setting the
              :paramref:`.Enum.name` parameter or by setting up an
              appropriate naming convention; see
              :ref:`constraint_naming_conventions` for background.

           .. versionchanged:: 1.4 - this flag now defaults to False, meaning
              no CHECK constraint is generated for a non-native enumerated
              type.

        :param metadata: Associate this type directly with a ``MetaData``
           object. For types that exist on the target database as an
           independent schema construct (PostgreSQL), this type will be
           created and dropped within ``create_all()`` and ``drop_all()``
           operations. If the type is not associated with any ``MetaData``
           object, it will associate itself with each ``Table`` in which it is
           used, and will be created when any of those individual tables are
           created, after a check is performed for its existence. The type is
           only dropped when ``drop_all()`` is called for that ``Table``
           object's metadata, however.

           The value of the :paramref:`_schema.MetaData.schema` parameter of
           the :class:`_schema.MetaData` object, if set, will be used as the
           default value of the :paramref:`_types.Enum.schema` on this object
           if an explicit value is not otherwise supplied.

           .. versionchanged:: 1.4.12 :class:`_types.Enum` inherits the
              :paramref:`_schema.MetaData.schema` parameter of the
              :class:`_schema.MetaData` object if present, when passed using
              the :paramref:`_types.Enum.metadata` parameter.

        :param name: The name of this type. This is required for PostgreSQL
           and any future supported database which requires an explicitly
           named type, or an explicitly named constraint in order to generate
           the type and/or a table that uses it. If a PEP-435 enumerated
           class was used, its name (converted to lower case) is used by
           default.

        :param native_enum: Use the database's native ENUM type when
           available. Defaults to True. When False, uses VARCHAR + check
           constraint for all backends. When False, the VARCHAR length can be
           controlled with :paramref:`.Enum.length`; currently "length" is
           ignored if native_enum=True.

        :param length: Allows specifying a custom length for the VARCHAR
           when a non-native enumeration datatype is used.  By default it uses
           the length of the longest value.

           .. versionchanged:: 2.0.0 The :paramref:`.Enum.length` parameter
              is used unconditionally for ``VARCHAR`` rendering regardless of
              the :paramref:`.Enum.native_enum` parameter, for those backends
              where ``VARCHAR`` is used for enumerated datatypes.


        :param schema: Schema name of this type. For types that exist on the
           target database as an independent schema construct (PostgreSQL),
           this parameter specifies the named schema in which the type is
           present.

           If not present, the schema name will be taken from the
           :class:`_schema.MetaData` collection if passed as
           :paramref:`_types.Enum.metadata`, for a :class:`_schema.MetaData`
           that includes the :paramref:`_schema.MetaData.schema` parameter.

           .. versionchanged:: 1.4.12 :class:`_types.Enum` inherits the
              :paramref:`_schema.MetaData.schema` parameter of the
              :class:`_schema.MetaData` object if present, when passed using
              the :paramref:`_types.Enum.metadata` parameter.

           Otherwise, if the :paramref:`_types.Enum.inherit_schema` flag is set
           to ``True``, the schema will be inherited from the associated
           :class:`_schema.Table` object if any; when
           :paramref:`_types.Enum.inherit_schema` is at its default of
           ``False``, the owning table's schema is **not** used.


        :param quote: Set explicit quoting preferences for the type's name.

        :param inherit_schema: When ``True``, the "schema" from the owning
           :class:`_schema.Table`
           will be copied to the "schema" attribute of this
           :class:`.Enum`, replacing whatever value was passed for the
           ``schema`` attribute.   This also takes effect when using the
           :meth:`_schema.Table.to_metadata` operation.

        :param validate_strings: when True, string values that are being
           passed to the database in a SQL statement will be checked
           for validity against the list of enumerated values.  Unrecognized
           values will result in a ``LookupError`` being raised.

        :param values_callable: A callable which will be passed the PEP-435
           compliant enumerated type, which should then return a list of string
           values to be persisted. This allows for alternate usages such as
           using the string value of an enum to be persisted to the database
           instead of its name. The callable must return the values to be
           persisted in the same order as iterating through the Enum's
           ``__member__`` attribute. For example
           ``lambda x: [i.value for i in x]``.

           .. versionadded:: 1.2.3

        :param sort_key_function: a Python callable which may be used as the
           "key" argument in the Python ``sorted()`` built-in.   The SQLAlchemy
           ORM requires that primary key columns which are mapped must
           be sortable in some way.  When using an unsortable enumeration
           object such as a Python 3 ``Enum`` object, this parameter may be
           used to set a default sort key function for the objects.  By
           default, the database value of the enumeration is used as the
           sorting function.

           .. versionadded:: 1.3.8

        :param omit_aliases: A boolean that when true will remove aliases from
           pep 435 enums. defaults to ``True``.

           .. versionchanged:: 2.0 This parameter now defaults to True.

        """
        self._enum_init(enums, kw)

    @property
    def _enums_argument(self):
        if self.enum_class is not None:
            return [self.enum_class]
        else:
            return self.enums

    def _enum_init(self, enums, kw):
        """internal init for :class:`.Enum` and subclasses.

        friendly init helper used by subclasses to remove
        all the Enum-specific keyword arguments from kw.  Allows all
        other arguments in kw to pass through.

        """
        self.native_enum = kw.pop("native_enum", True)
        self.create_constraint = kw.pop("create_constraint", False)
        self.values_callable = kw.pop("values_callable", None)
        self._sort_key_function = kw.pop("sort_key_function", NO_ARG)
        length_arg = kw.pop("length", NO_ARG)
        self._omit_aliases = kw.pop("omit_aliases", True)
        _disable_warnings = kw.pop("_disable_warnings", False)
        values, objects = self._parse_into_values(enums, kw)
        self._setup_for_values(values, objects, kw)

        self.validate_strings = kw.pop("validate_strings", False)

        if self.enums:
            self._default_length = length = max(len(x) for x in self.enums)
        else:
            self._default_length = length = 0

        if length_arg is not NO_ARG:
            if (
                not _disable_warnings
                and length_arg is not None
                and length_arg < length
            ):
                raise ValueError(
                    "When provided, length must be larger or equal"
                    " than the length of the longest enum value. %s < %s"
                    % (length_arg, length)
                )
            length = length_arg

        self._valid_lookup[None] = self._object_lookup[None] = None

        super().__init__(length=length)

        # assign name to the given enum class if no other name, and this
        # enum is not an "empty" enum.  if the enum is "empty" we assume
        # this is a template enum that will be used to generate
        # new Enum classes.
        if self.enum_class and values:
            kw.setdefault("name", self.enum_class.__name__.lower())
        SchemaType.__init__(
            self,
            name=kw.pop("name", None),
            schema=kw.pop("schema", None),
            metadata=kw.pop("metadata", None),
            inherit_schema=kw.pop("inherit_schema", False),
            quote=kw.pop("quote", None),
            _create_events=kw.pop("_create_events", True),
            _adapted_from=kw.pop("_adapted_from", None),
        )

    def _parse_into_values(self, enums, kw):
        if not enums and "_enums" in kw:
            enums = kw.pop("_enums")

        if len(enums) == 1 and hasattr(enums[0], "__members__"):
            self.enum_class = enums[0]

            _members = self.enum_class.__members__

            if self._omit_aliases is True:
                # remove aliases
                members = OrderedDict(
                    (n, v) for n, v in _members.items() if v.name == n
                )
            else:
                members = _members
            if self.values_callable:
                values = self.values_callable(self.enum_class)
            else:
                values = list(members)
            objects = [members[k] for k in members]
            return values, objects
        else:
            self.enum_class = None
            return enums, enums

    def _resolve_for_literal(self, value: Any) -> Enum:
        tv = type(value)
        typ = self._resolve_for_python_type(tv, tv, tv)
        assert typ is not None
        return typ

    def _resolve_for_python_type(
        self,
        python_type: Type[Any],
        matched_on: _MatchedOnType,
        matched_on_flattened: Type[Any],
    ) -> Optional[Enum]:
        # "generic form" indicates we were placed in a type map
        # as ``sqlalchemy.Enum(enum.Enum)`` which indicates we need to
        # get enumerated values from the datatype
        we_are_generic_form = self._enums_argument == [enum.Enum]

        native_enum = None

        if not we_are_generic_form and python_type is matched_on:
            # if we have enumerated values, and the incoming python
            # type is exactly the one that matched in the type map,
            # then we use these enumerated values and dont try to parse
            # what's incoming
            enum_args = self._enums_argument

        elif is_literal(python_type):
            # for a literal, where we need to get its contents, parse it out.
            enum_args = typing_get_args(python_type)
            bad_args = [arg for arg in enum_args if not isinstance(arg, str)]
            if bad_args:
                raise exc.ArgumentError(
                    f"Can't create string-based Enum datatype from non-string "
                    f"values: {', '.join(repr(x) for x in bad_args)}.  Please "
                    f"provide an explicit Enum datatype for this Python type"
                )
            native_enum = False
        elif isinstance(python_type, type) and issubclass(
            python_type, enum.Enum
        ):
            # same for an enum.Enum
            enum_args = [python_type]

        else:
            enum_args = self._enums_argument

        # make a new Enum that looks like this one.
        # arguments or other rules
        kw = self._make_enum_kw({})

        if native_enum is False:
            kw["native_enum"] = False

        kw["length"] = NO_ARG if self.length == 0 else self.length
        return cast(
            Enum,
            self._generic_type_affinity(_enums=enum_args, **kw),  # type: ignore  # noqa: E501
        )

    def _setup_for_values(self, values, objects, kw):
        self.enums = list(values)

        self._valid_lookup = dict(zip(reversed(objects), reversed(values)))

        self._object_lookup = dict(zip(values, objects))

        self._valid_lookup.update(
            [
                (value, self._valid_lookup[self._object_lookup[value]])
                for value in values
            ]
        )

    @property
    def sort_key_function(self):
        if self._sort_key_function is NO_ARG:
            return self._db_value_for_elem
        else:
            return self._sort_key_function

    @property
    def native(self):
        return self.native_enum

    def _db_value_for_elem(self, elem):
        try:
            return self._valid_lookup[elem]
        except KeyError as err:
            # for unknown string values, we return as is.  While we can
            # validate these if we wanted, that does not allow for lesser-used
            # end-user use cases, such as using a LIKE comparison with an enum,
            # or for an application that wishes to apply string tests to an
            # ENUM (see [ticket:3725]).  While we can decide to differentiate
            # here between an INSERT statement and a criteria used in a SELECT,
            # for now we're staying conservative w/ behavioral changes (perhaps
            # someone has a trigger that handles strings on INSERT)
            if not self.validate_strings and isinstance(elem, str):
                return elem
            else:
                raise LookupError(
                    "'%s' is not among the defined enum values. "
                    "Enum name: %s. Possible values: %s"
                    % (
                        elem,
                        self.name,
                        langhelpers.repr_tuple_names(self.enums),
                    )
                ) from err

    class Comparator(String.Comparator[str]):
        __slots__ = ()

        type: String

        def _adapt_expression(
            self,
            op: OperatorType,
            other_comparator: TypeEngine.Comparator[Any],
        ) -> Tuple[OperatorType, TypeEngine[Any]]:
            op, typ = super()._adapt_expression(op, other_comparator)
            if op is operators.concat_op:
                typ = String(self.type.length)
            return op, typ

    comparator_factory = Comparator

    def _object_value_for_elem(self, elem):
        try:
            return self._object_lookup[elem]
        except KeyError as err:
            raise LookupError(
                "'%s' is not among the defined enum values. "
                "Enum name: %s. Possible values: %s"
                % (
                    elem,
                    self.name,
                    langhelpers.repr_tuple_names(self.enums),
                )
            ) from err

    def __repr__(self):
        return util.generic_repr(
            self,
            additional_kw=[
                ("native_enum", True),
                ("create_constraint", False),
                ("length", self._default_length),
            ],
            to_inspect=[Enum, SchemaType],
        )

    def as_generic(self, allow_nulltype=False):
        try:
            args = self.enums
        except AttributeError:
            raise NotImplementedError(
                "TypeEngine.as_generic() heuristic "
                "is undefined for types that inherit Enum but do not have "
                "an `enums` attribute."
            ) from None

        return util.constructor_copy(
            self, self._generic_type_affinity, *args, _disable_warnings=True
        )

    def _make_enum_kw(self, kw):
        kw.setdefault("validate_strings", self.validate_strings)
        if self.name:
            kw.setdefault("name", self.name)
        kw.setdefault("schema", self.schema)
        kw.setdefault("inherit_schema", self.inherit_schema)
        kw.setdefault("metadata", self.metadata)
        kw.setdefault("native_enum", self.native_enum)
        kw.setdefault("values_callable", self.values_callable)
        kw.setdefault("create_constraint", self.create_constraint)
        kw.setdefault("length", self.length)
        kw.setdefault("omit_aliases", self._omit_aliases)
        return kw

    def adapt_to_emulated(self, impltype, **kw):
        self._make_enum_kw(kw)
        kw["_disable_warnings"] = True
        kw.setdefault("_create_events", False)
        assert "_enums" in kw
        return impltype(**kw)

    def adapt(self, impltype, **kw):
        kw["_enums"] = self._enums_argument
        kw["_disable_warnings"] = True
        return super().adapt(impltype, **kw)

    def _should_create_constraint(self, compiler, **kw):
        if not self._is_impl_for_variant(compiler.dialect, kw):
            return False
        return (
            not self.native_enum or not compiler.dialect.supports_native_enum
        )

    @util.preload_module("sqlalchemy.sql.schema")
    def _set_table(self, column, table):
        schema = util.preloaded.sql_schema
        SchemaType._set_table(self, column, table)

        if not self.create_constraint:
            return

        variant_mapping = self._variant_mapping_for_set_table(column)

        e = schema.CheckConstraint(
            type_coerce(column, String()).in_(self.enums),
            name=_NONE_NAME if self.name is None else self.name,
            _create_rule=util.portable_instancemethod(
                self._should_create_constraint,
                {"variant_mapping": variant_mapping},
            ),
            _type_bound=True,
        )
        assert e.table is table

    def literal_processor(self, dialect):
        parent_processor = super().literal_processor(dialect)

        def process(value):
            value = self._db_value_for_elem(value)
            if parent_processor:
                value = parent_processor(value)
            return value

        return process

    def bind_processor(self, dialect):
        parent_processor = super().bind_processor(dialect)

        def process(value):
            value = self._db_value_for_elem(value)
            if parent_processor:
                value = parent_processor(value)
            return value

        return process

    def result_processor(self, dialect, coltype):
        parent_processor = super().result_processor(dialect, coltype)

        def process(value):
            if parent_processor:
                value = parent_processor(value)

            value = self._object_value_for_elem(value)
            return value

        return process

    def copy(self, **kw):
        return SchemaType.copy(self, **kw)

    @property
    def python_type(self):
        if self.enum_class:
            return self.enum_class
        else:
            return super().python_type


class PickleType(TypeDecorator[object]):
    """Holds Python objects, which are serialized using pickle.

    PickleType builds upon the Binary type to apply Python's
    ``pickle.dumps()`` to incoming objects, and ``pickle.loads()`` on
    the way out, allowing any pickleable Python object to be stored as
    a serialized binary field.

    To allow ORM change events to propagate for elements associated
    with :class:`.PickleType`, see :ref:`mutable_toplevel`.

    """

    impl = LargeBinary
    cache_ok = True

    def __init__(
        self,
        protocol: int = pickle.HIGHEST_PROTOCOL,
        pickler: Any = None,
        comparator: Optional[Callable[[Any, Any], bool]] = None,
        impl: Optional[_TypeEngineArgument[Any]] = None,
    ):
        """
        Construct a PickleType.

        :param protocol: defaults to ``pickle.HIGHEST_PROTOCOL``.

        :param pickler: defaults to pickle.  May be any object with
          pickle-compatible ``dumps`` and ``loads`` methods.

        :param comparator: a 2-arg callable predicate used
          to compare values of this type.  If left as ``None``,
          the Python "equals" operator is used to compare values.

        :param impl: A binary-storing :class:`_types.TypeEngine` class or
          instance to use in place of the default :class:`_types.LargeBinary`.
          For example the :class: `_mysql.LONGBLOB` class may be more effective
          when using MySQL.

          .. versionadded:: 1.4.20

        """
        self.protocol = protocol
        self.pickler = pickler or pickle
        self.comparator = comparator
        super().__init__()

        if impl:
            # custom impl is not necessarily a LargeBinary subclass.
            # make an exception to typing for this
            self.impl = to_instance(impl)  # type: ignore

    def __reduce__(self):
        return PickleType, (self.protocol, None, self.comparator)

    def bind_processor(self, dialect):
        impl_processor = self.impl_instance.bind_processor(dialect)
        dumps = self.pickler.dumps
        protocol = self.protocol
        if impl_processor:
            fixed_impl_processor = impl_processor

            def process(value):
                if value is not None:
                    value = dumps(value, protocol)
                return fixed_impl_processor(value)

        else:

            def process(value):
                if value is not None:
                    value = dumps(value, protocol)
                return value

        return process

    def result_processor(self, dialect, coltype):
        impl_processor = self.impl_instance.result_processor(dialect, coltype)
        loads = self.pickler.loads
        if impl_processor:
            fixed_impl_processor = impl_processor

            def process(value):
                value = fixed_impl_processor(value)
                if value is None:
                    return None
                return loads(value)

        else:

            def process(value):
                if value is None:
                    return None
                return loads(value)

        return process

    def compare_values(self, x, y):
        if self.comparator:
            return self.comparator(x, y)
        else:
            return x == y


class Boolean(SchemaType, Emulated, TypeEngine[bool]):

    """A bool datatype.

    :class:`.Boolean` typically uses BOOLEAN or SMALLINT on the DDL side,
    and on the Python side deals in ``True`` or ``False``.

    The :class:`.Boolean` datatype currently has two levels of assertion
    that the values persisted are simple true/false values.  For all
    backends, only the Python values ``None``, ``True``, ``False``, ``1``
    or ``0`` are accepted as parameter values.   For those backends that
    don't support a "native boolean" datatype, an option exists to
    also create a CHECK constraint on the target column

    .. versionchanged:: 1.2 the :class:`.Boolean` datatype now asserts that
       incoming Python values are already in pure boolean form.


    """

    __visit_name__ = "boolean"
    native = True

    def __init__(
        self,
        create_constraint: bool = False,
        name: Optional[str] = None,
        _create_events: bool = True,
        _adapted_from: Optional[SchemaType] = None,
    ):
        """Construct a Boolean.

        :param create_constraint: defaults to False.  If the boolean
          is generated as an int/smallint, also create a CHECK constraint
          on the table that ensures 1 or 0 as a value.

          .. note:: it is strongly recommended that the CHECK constraint
             have an explicit name in order to support schema-management
             concerns.  This can be established either by setting the
             :paramref:`.Boolean.name` parameter or by setting up an
             appropriate naming convention; see
             :ref:`constraint_naming_conventions` for background.

          .. versionchanged:: 1.4 - this flag now defaults to False, meaning
             no CHECK constraint is generated for a non-native enumerated
             type.

        :param name: if a CHECK constraint is generated, specify
          the name of the constraint.

        """
        self.create_constraint = create_constraint
        self.name = name
        self._create_events = _create_events
        if _adapted_from:
            self.dispatch = self.dispatch._join(_adapted_from.dispatch)

    def _should_create_constraint(self, compiler, **kw):
        if not self._is_impl_for_variant(compiler.dialect, kw):
            return False
        return (
            not compiler.dialect.supports_native_boolean
            and compiler.dialect.non_native_boolean_check_constraint
        )

    @util.preload_module("sqlalchemy.sql.schema")
    def _set_table(self, column, table):
        schema = util.preloaded.sql_schema
        if not self.create_constraint:
            return

        variant_mapping = self._variant_mapping_for_set_table(column)

        e = schema.CheckConstraint(
            type_coerce(column, self).in_([0, 1]),
            name=_NONE_NAME if self.name is None else self.name,
            _create_rule=util.portable_instancemethod(
                self._should_create_constraint,
                {"variant_mapping": variant_mapping},
            ),
            _type_bound=True,
        )
        assert e.table is table

    @property
    def python_type(self):
        return bool

    _strict_bools = frozenset([None, True, False])

    def _strict_as_bool(self, value):
        if value not in self._strict_bools:
            if not isinstance(value, int):
                raise TypeError("Not a boolean value: %r" % (value,))
            else:
                raise ValueError(
                    "Value %r is not None, True, or False" % (value,)
                )
        return value

    def literal_processor(self, dialect):
        compiler = dialect.statement_compiler(dialect, None)
        true = compiler.visit_true(None)
        false = compiler.visit_false(None)

        def process(value):
            return true if self._strict_as_bool(value) else false

        return process

    def bind_processor(self, dialect):
        _strict_as_bool = self._strict_as_bool

        _coerce: Union[Type[bool], Type[int]]

        if dialect.supports_native_boolean:
            _coerce = bool
        else:
            _coerce = int

        def process(value):
            value = _strict_as_bool(value)
            if value is not None:
                value = _coerce(value)
            return value

        return process

    def result_processor(self, dialect, coltype):
        if dialect.supports_native_boolean:
            return None
        else:
            return processors.int_to_boolean


class _AbstractInterval(HasExpressionLookup, TypeEngine[dt.timedelta]):
    @util.memoized_property
    def _expression_adaptations(self):
        # Based on
        # https://www.postgresql.org/docs/current/static/functions-datetime.html.

        return {
            operators.add: {
                Date: DateTime,
                Interval: self.__class__,
                DateTime: DateTime,
                Time: Time,
            },
            operators.sub: {Interval: self.__class__},
            operators.mul: {Numeric: self.__class__},
            operators.truediv: {Numeric: self.__class__},
        }

    @util.ro_non_memoized_property
    def _type_affinity(self) -> Type[Interval]:
        return Interval


class Interval(Emulated, _AbstractInterval, TypeDecorator[dt.timedelta]):

    """A type for ``datetime.timedelta()`` objects.

    The Interval type deals with ``datetime.timedelta`` objects.  In
    PostgreSQL and Oracle, the native ``INTERVAL`` type is used; for others,
    the value is stored as a date which is relative to the "epoch"
    (Jan. 1, 1970).

    Note that the ``Interval`` type does not currently provide date arithmetic
    operations on platforms which do not support interval types natively. Such
    operations usually require transformation of both sides of the expression
    (such as, conversion of both sides into integer epoch values first) which
    currently is a manual procedure (such as via
    :attr:`~sqlalchemy.sql.expression.func`).

    """

    impl = DateTime
    epoch = dt.datetime.fromtimestamp(0, dt.timezone.utc).replace(tzinfo=None)
    cache_ok = True

    def __init__(
        self,
        native: bool = True,
        second_precision: Optional[int] = None,
        day_precision: Optional[int] = None,
    ):
        """Construct an Interval object.

        :param native: when True, use the actual
          INTERVAL type provided by the database, if
          supported (currently PostgreSQL, Oracle).
          Otherwise, represent the interval data as
          an epoch value regardless.

        :param second_precision: For native interval types
          which support a "fractional seconds precision" parameter,
          i.e. Oracle and PostgreSQL

        :param day_precision: for native interval types which
          support a "day precision" parameter, i.e. Oracle.

        """
        super().__init__()
        self.native = native
        self.second_precision = second_precision
        self.day_precision = day_precision

    class Comparator(
        TypeDecorator.Comparator[_CT],
        _AbstractInterval.Comparator[_CT],
    ):
        __slots__ = ()

    comparator_factory = Comparator

    @property
    def python_type(self):
        return dt.timedelta

    def adapt_to_emulated(self, impltype, **kw):
        return _AbstractInterval.adapt(self, impltype, **kw)

    def coerce_compared_value(self, op, value):
        return self.impl_instance.coerce_compared_value(op, value)

    def bind_processor(
        self, dialect: Dialect
    ) -> _BindProcessorType[dt.timedelta]:
        if TYPE_CHECKING:
            assert isinstance(self.impl_instance, DateTime)
        impl_processor = self.impl_instance.bind_processor(dialect)
        epoch = self.epoch
        if impl_processor:
            fixed_impl_processor = impl_processor

            def process(
                value: Optional[dt.timedelta],
            ) -> Any:
                if value is not None:
                    dt_value = epoch + value
                else:
                    dt_value = None
                return fixed_impl_processor(dt_value)

        else:

            def process(
                value: Optional[dt.timedelta],
            ) -> Any:
                if value is not None:
                    dt_value = epoch + value
                else:
                    dt_value = None
                return dt_value

        return process

    def result_processor(
        self, dialect: Dialect, coltype: Any
    ) -> _ResultProcessorType[dt.timedelta]:
        if TYPE_CHECKING:
            assert isinstance(self.impl_instance, DateTime)
        impl_processor = self.impl_instance.result_processor(dialect, coltype)
        epoch = self.epoch
        if impl_processor:
            fixed_impl_processor = impl_processor

            def process(value: Any) -> Optional[dt.timedelta]:
                dt_value = fixed_impl_processor(value)
                if dt_value is None:
                    return None
                return dt_value - epoch

        else:

            def process(value: Any) -> Optional[dt.timedelta]:
                if value is None:
                    return None
                return value - epoch  # type: ignore

        return process


class JSON(Indexable, TypeEngine[Any]):
    """Represent a SQL JSON type.

    .. note::  :class:`_types.JSON`
       is provided as a facade for vendor-specific
       JSON types.  Since it supports JSON SQL operations, it only
       works on backends that have an actual JSON type, currently:

       * PostgreSQL - see :class:`sqlalchemy.dialects.postgresql.JSON` and
         :class:`sqlalchemy.dialects.postgresql.JSONB` for backend-specific
         notes

       * MySQL - see
         :class:`sqlalchemy.dialects.mysql.JSON` for backend-specific notes

       * SQLite as of version 3.9 - see
         :class:`sqlalchemy.dialects.sqlite.JSON` for backend-specific notes

       * Microsoft SQL Server 2016 and later - see
         :class:`sqlalchemy.dialects.mssql.JSON` for backend-specific notes

    :class:`_types.JSON` is part of the Core in support of the growing
    popularity of native JSON datatypes.

    The :class:`_types.JSON` type stores arbitrary JSON format data, e.g.::

        data_table = Table('data_table', metadata,
            Column('id', Integer, primary_key=True),
            Column('data', JSON)
        )

        with engine.connect() as conn:
            conn.execute(
                data_table.insert(),
                {"data": {"key1": "value1", "key2": "value2"}}
            )

    **JSON-Specific Expression Operators**

    The :class:`_types.JSON`
    datatype provides these additional SQL operations:

    * Keyed index operations::

        data_table.c.data['some key']

    * Integer index operations::

        data_table.c.data[3]

    * Path index operations::

        data_table.c.data[('key_1', 'key_2', 5, ..., 'key_n')]

    * Data casters for specific JSON element types, subsequent to an index
      or path operation being invoked::

        data_table.c.data["some key"].as_integer()

      .. versionadded:: 1.3.11

    Additional operations may be available from the dialect-specific versions
    of :class:`_types.JSON`, such as
    :class:`sqlalchemy.dialects.postgresql.JSON` and
    :class:`sqlalchemy.dialects.postgresql.JSONB` which both offer additional
    PostgreSQL-specific operations.

    **Casting JSON Elements to Other Types**

    Index operations, i.e. those invoked by calling upon the expression using
    the Python bracket operator as in ``some_column['some key']``, return an
    expression object whose type defaults to :class:`_types.JSON` by default,
    so that
    further JSON-oriented instructions may be called upon the result type.
    However, it is likely more common that an index operation is expected
    to return a specific scalar element, such as a string or integer.  In
    order to provide access to these elements in a backend-agnostic way,
    a series of data casters are provided:

    * :meth:`.JSON.Comparator.as_string` - return the element as a string

    * :meth:`.JSON.Comparator.as_boolean` - return the element as a boolean

    * :meth:`.JSON.Comparator.as_float` - return the element as a float

    * :meth:`.JSON.Comparator.as_integer` - return the element as an integer

    These data casters are implemented by supporting dialects in order to
    assure that comparisons to the above types will work as expected, such as::

        # integer comparison
        data_table.c.data["some_integer_key"].as_integer() == 5

        # boolean comparison
        data_table.c.data["some_boolean"].as_boolean() == True

    .. versionadded:: 1.3.11 Added type-specific casters for the basic JSON
       data element types.

    .. note::

        The data caster functions are new in version 1.3.11, and supersede
        the previous documented approaches of using CAST; for reference,
        this looked like::

           from sqlalchemy import cast, type_coerce
           from sqlalchemy import String, JSON
           cast(
               data_table.c.data['some_key'], String
           ) == type_coerce(55, JSON)

        The above case now works directly as::

            data_table.c.data['some_key'].as_integer() == 5

        For details on the previous comparison approach within the 1.3.x
        series, see the documentation for SQLAlchemy 1.2 or the included HTML
        files in the doc/ directory of the version's distribution.

    **Detecting Changes in JSON columns when using the ORM**

    The :class:`_types.JSON` type, when used with the SQLAlchemy ORM, does not
    detect in-place mutations to the structure.  In order to detect these, the
    :mod:`sqlalchemy.ext.mutable` extension must be used, most typically
    using the :class:`.MutableDict` class.  This extension will
    allow "in-place" changes to the datastructure to produce events which
    will be detected by the unit of work.  See the example at :class:`.HSTORE`
    for a simple example involving a dictionary.

    Alternatively, assigning a JSON structure to an ORM element that
    replaces the old one will always trigger a change event.

    **Support for JSON null vs. SQL NULL**

    When working with NULL values, the :class:`_types.JSON` type recommends the
    use of two specific constants in order to differentiate between a column
    that evaluates to SQL NULL, e.g. no value, vs. the JSON-encoded string of
    ``"null"``. To insert or select against a value that is SQL NULL, use the
    constant :func:`.null`. This symbol may be passed as a parameter value
    specifically when using the :class:`_types.JSON` datatype, which contains
    special logic that interprets this symbol to mean that the column value
    should be SQL NULL as opposed to JSON ``"null"``::

        from sqlalchemy import null
        conn.execute(table.insert(), {"json_value": null()})

    To insert or select against a value that is JSON ``"null"``, use the
    constant :attr:`_types.JSON.NULL`::

        conn.execute(table.insert(), {"json_value": JSON.NULL})

    The :class:`_types.JSON` type supports a flag
    :paramref:`_types.JSON.none_as_null` which when set to True will result
    in the Python constant ``None`` evaluating to the value of SQL
    NULL, and when set to False results in the Python constant
    ``None`` evaluating to the value of JSON ``"null"``.    The Python
    value ``None`` may be used in conjunction with either
    :attr:`_types.JSON.NULL` and :func:`.null` in order to indicate NULL
    values, but care must be taken as to the value of the
    :paramref:`_types.JSON.none_as_null` in these cases.

    **Customizing the JSON Serializer**

    The JSON serializer and deserializer used by :class:`_types.JSON`
    defaults to
    Python's ``json.dumps`` and ``json.loads`` functions; in the case of the
    psycopg2 dialect, psycopg2 may be using its own custom loader function.

    In order to affect the serializer / deserializer, they are currently
    configurable at the :func:`_sa.create_engine` level via the
    :paramref:`_sa.create_engine.json_serializer` and
    :paramref:`_sa.create_engine.json_deserializer` parameters.  For example,
    to turn off ``ensure_ascii``::

        engine = create_engine(
            "sqlite://",
            json_serializer=lambda obj: json.dumps(obj, ensure_ascii=False))

    .. versionchanged:: 1.3.7

        SQLite dialect's ``json_serializer`` and ``json_deserializer``
        parameters renamed from ``_json_serializer`` and
        ``_json_deserializer``.

    .. seealso::

        :class:`sqlalchemy.dialects.postgresql.JSON`

        :class:`sqlalchemy.dialects.postgresql.JSONB`

        :class:`sqlalchemy.dialects.mysql.JSON`

        :class:`sqlalchemy.dialects.sqlite.JSON`

    """

    __visit_name__ = "JSON"

    hashable = False
    NULL = util.symbol("JSON_NULL")
    """Describe the json value of NULL.

    This value is used to force the JSON value of ``"null"`` to be
    used as the value.   A value of Python ``None`` will be recognized
    either as SQL NULL or JSON ``"null"``, based on the setting
    of the :paramref:`_types.JSON.none_as_null` flag; the
    :attr:`_types.JSON.NULL`
    constant can be used to always resolve to JSON ``"null"`` regardless
    of this setting.  This is in contrast to the :func:`_expression.null`
    construct,
    which always resolves to SQL NULL.  E.g.::

        from sqlalchemy import null
        from sqlalchemy.dialects.postgresql import JSON

        # will *always* insert SQL NULL
        obj1 = MyObject(json_value=null())

        # will *always* insert JSON string "null"
        obj2 = MyObject(json_value=JSON.NULL)

        session.add_all([obj1, obj2])
        session.commit()

    In order to set JSON NULL as a default value for a column, the most
    transparent method is to use :func:`_expression.text`::

        Table(
            'my_table', metadata,
            Column('json_data', JSON, default=text("'null'"))
        )

    While it is possible to use :attr:`_types.JSON.NULL` in this context, the
    :attr:`_types.JSON.NULL` value will be returned as the value of the
    column,
    which in the context of the ORM or other repurposing of the default
    value, may not be desirable.  Using a SQL expression means the value
    will be re-fetched from the database within the context of retrieving
    generated defaults.


    """

    def __init__(self, none_as_null: bool = False):
        """Construct a :class:`_types.JSON` type.

        :param none_as_null=False: if True, persist the value ``None`` as a
         SQL NULL value, not the JSON encoding of ``null``. Note that when this
         flag is False, the :func:`.null` construct can still be used to
         persist a NULL value, which may be passed directly as a parameter
         value that is specially interpreted by the :class:`_types.JSON` type
         as SQL NULL::

             from sqlalchemy import null
             conn.execute(table.insert(), {"data": null()})

         .. note::

              :paramref:`_types.JSON.none_as_null` does **not** apply to the
              values passed to :paramref:`_schema.Column.default` and
              :paramref:`_schema.Column.server_default`; a value of ``None``
              passed for these parameters means "no default present".

              Additionally, when used in SQL comparison expressions, the
              Python value ``None`` continues to refer to SQL null, and not
              JSON NULL.  The :paramref:`_types.JSON.none_as_null` flag refers
              explicitly to the **persistence** of the value within an
              INSERT or UPDATE statement.   The :attr:`_types.JSON.NULL`
              value should be used for SQL expressions that wish to compare to
              JSON null.

         .. seealso::

              :attr:`.types.JSON.NULL`

        """
        self.none_as_null = none_as_null

    class JSONElementType(TypeEngine[Any]):
        """Common function for index / path elements in a JSON expression."""

        _integer = Integer()
        _string = String()

        def string_bind_processor(self, dialect):
            return self._string._cached_bind_processor(dialect)

        def string_literal_processor(self, dialect):
            return self._string._cached_literal_processor(dialect)

        def bind_processor(self, dialect):
            int_processor = self._integer._cached_bind_processor(dialect)
            string_processor = self.string_bind_processor(dialect)

            def process(value):
                if int_processor and isinstance(value, int):
                    value = int_processor(value)
                elif string_processor and isinstance(value, str):
                    value = string_processor(value)
                return value

            return process

        def literal_processor(self, dialect):
            int_processor = self._integer._cached_literal_processor(dialect)
            string_processor = self.string_literal_processor(dialect)

            def process(value):
                if int_processor and isinstance(value, int):
                    value = int_processor(value)
                elif string_processor and isinstance(value, str):
                    value = string_processor(value)
                else:
                    raise NotImplementedError()

                return value

            return process

    class JSONIndexType(JSONElementType):
        """Placeholder for the datatype of a JSON index value.

        This allows execution-time processing of JSON index values
        for special syntaxes.

        """

    class JSONIntIndexType(JSONIndexType):
        """Placeholder for the datatype of a JSON index value.

        This allows execution-time processing of JSON index values
        for special syntaxes.

        """

    class JSONStrIndexType(JSONIndexType):
        """Placeholder for the datatype of a JSON index value.

        This allows execution-time processing of JSON index values
        for special syntaxes.

        """

    class JSONPathType(JSONElementType):
        """Placeholder type for JSON path operations.

        This allows execution-time processing of a path-based
        index value into a specific SQL syntax.

        """

        __visit_name__ = "json_path"

    class Comparator(Indexable.Comparator[_T], Concatenable.Comparator[_T]):
        """Define comparison operations for :class:`_types.JSON`."""

        __slots__ = ()

        def _setup_getitem(self, index):
            if not isinstance(index, str) and isinstance(
                index, collections_abc.Sequence
            ):
                index = coercions.expect(
                    roles.BinaryElementRole,
                    index,
                    expr=self.expr,
                    operator=operators.json_path_getitem_op,
                    bindparam_type=JSON.JSONPathType,
                )

                operator = operators.json_path_getitem_op
            else:
                index = coercions.expect(
                    roles.BinaryElementRole,
                    index,
                    expr=self.expr,
                    operator=operators.json_getitem_op,
                    bindparam_type=JSON.JSONIntIndexType
                    if isinstance(index, int)
                    else JSON.JSONStrIndexType,
                )
                operator = operators.json_getitem_op

            return operator, index, self.type

        def as_boolean(self):
            """Cast an indexed value as boolean.

            e.g.::

                stmt = select(
                    mytable.c.json_column['some_data'].as_boolean()
                ).where(
                    mytable.c.json_column['some_data'].as_boolean() == True
                )

            .. versionadded:: 1.3.11

            """
            return self._binary_w_type(Boolean(), "as_boolean")

        def as_string(self):
            """Cast an indexed value as string.

            e.g.::

                stmt = select(
                    mytable.c.json_column['some_data'].as_string()
                ).where(
                    mytable.c.json_column['some_data'].as_string() ==
                    'some string'
                )

            .. versionadded:: 1.3.11

            """
            return self._binary_w_type(Unicode(), "as_string")

        def as_integer(self):
            """Cast an indexed value as integer.

            e.g.::

                stmt = select(
                    mytable.c.json_column['some_data'].as_integer()
                ).where(
                    mytable.c.json_column['some_data'].as_integer() == 5
                )

            .. versionadded:: 1.3.11

            """
            return self._binary_w_type(Integer(), "as_integer")

        def as_float(self):
            """Cast an indexed value as float.

            e.g.::

                stmt = select(
                    mytable.c.json_column['some_data'].as_float()
                ).where(
                    mytable.c.json_column['some_data'].as_float() == 29.75
                )

            .. versionadded:: 1.3.11

            """
            return self._binary_w_type(Float(), "as_float")

        def as_numeric(self, precision, scale, asdecimal=True):
            """Cast an indexed value as numeric/decimal.

            e.g.::

                stmt = select(
                    mytable.c.json_column['some_data'].as_numeric(10, 6)
                ).where(
                    mytable.c.
                    json_column['some_data'].as_numeric(10, 6) == 29.75
                )

            .. versionadded:: 1.4.0b2

            """
            return self._binary_w_type(
                Numeric(precision, scale, asdecimal=asdecimal), "as_numeric"
            )

        def as_json(self):
            """Cast an indexed value as JSON.

            e.g.::

                stmt = select(mytable.c.json_column['some_data'].as_json())

            This is typically the default behavior of indexed elements in any
            case.

            Note that comparison of full JSON structures may not be
            supported by all backends.

            .. versionadded:: 1.3.11

            """
            return self.expr

        def _binary_w_type(self, typ, method_name):
            if not isinstance(
                self.expr, elements.BinaryExpression
            ) or self.expr.operator not in (
                operators.json_getitem_op,
                operators.json_path_getitem_op,
            ):
                raise exc.InvalidRequestError(
                    "The JSON cast operator JSON.%s() only works with a JSON "
                    "index expression e.g. col['q'].%s()"
                    % (method_name, method_name)
                )
            expr = self.expr._clone()
            expr.type = typ
            return expr

    comparator_factory = Comparator

    @property
    def python_type(self):
        return dict

    @property  # type: ignore  # mypy property bug
    def should_evaluate_none(self):
        """Alias of :attr:`_types.JSON.none_as_null`"""
        return not self.none_as_null

    @should_evaluate_none.setter
    def should_evaluate_none(self, value):
        self.none_as_null = not value

    @util.memoized_property
    def _str_impl(self):
        return String()

    def _make_bind_processor(self, string_process, json_serializer):
        if string_process:

            def process(value):
                if value is self.NULL:
                    value = None
                elif isinstance(value, elements.Null) or (
                    value is None and self.none_as_null
                ):
                    return None

                serialized = json_serializer(value)
                return string_process(serialized)

        else:

            def process(value):
                if value is self.NULL:
                    value = None
                elif isinstance(value, elements.Null) or (
                    value is None and self.none_as_null
                ):
                    return None

                return json_serializer(value)

        return process

    def bind_processor(self, dialect):
        string_process = self._str_impl.bind_processor(dialect)
        json_serializer = dialect._json_serializer or json.dumps

        return self._make_bind_processor(string_process, json_serializer)

    def result_processor(self, dialect, coltype):
        string_process = self._str_impl.result_processor(dialect, coltype)
        json_deserializer = dialect._json_deserializer or json.loads

        def process(value):
            if value is None:
                return None
            if string_process:
                value = string_process(value)
            return json_deserializer(value)

        return process


class ARRAY(
    SchemaEventTarget, Indexable, Concatenable, TypeEngine[Sequence[Any]]
):
    """Represent a SQL Array type.

    .. note::  This type serves as the basis for all ARRAY operations.
       However, currently **only the PostgreSQL backend has support for SQL
       arrays in SQLAlchemy**. It is recommended to use the PostgreSQL-specific
       :class:`sqlalchemy.dialects.postgresql.ARRAY` type directly when using
       ARRAY types with PostgreSQL, as it provides additional operators
       specific to that backend.

    :class:`_types.ARRAY` is part of the Core in support of various SQL
    standard functions such as :class:`_functions.array_agg`
    which explicitly involve
    arrays; however, with the exception of the PostgreSQL backend and possibly
    some third-party dialects, no other SQLAlchemy built-in dialect has support
    for this type.

    An :class:`_types.ARRAY` type is constructed given the "type"
    of element::

        mytable = Table("mytable", metadata,
                Column("data", ARRAY(Integer))
            )

    The above type represents an N-dimensional array,
    meaning a supporting backend such as PostgreSQL will interpret values
    with any number of dimensions automatically.   To produce an INSERT
    construct that passes in a 1-dimensional array of integers::

        connection.execute(
                mytable.insert(),
                {"data": [1,2,3]}
        )

    The :class:`_types.ARRAY` type can be constructed given a fixed number
    of dimensions::

        mytable = Table("mytable", metadata,
                Column("data", ARRAY(Integer, dimensions=2))
            )

    Sending a number of dimensions is optional, but recommended if the
    datatype is to represent arrays of more than one dimension.  This number
    is used:

    * When emitting the type declaration itself to the database, e.g.
      ``INTEGER[][]``

    * When translating Python values to database values, and vice versa, e.g.
      an ARRAY of :class:`.Unicode` objects uses this number to efficiently
      access the string values inside of array structures without resorting
      to per-row type inspection

    * When used with the Python ``getitem`` accessor, the number of dimensions
      serves to define the kind of type that the ``[]`` operator should
      return, e.g. for an ARRAY of INTEGER with two dimensions::

          >>> expr = table.c.column[5]  # returns ARRAY(Integer, dimensions=1)
          >>> expr = expr[6]  # returns Integer

    For 1-dimensional arrays, an :class:`_types.ARRAY` instance with no
    dimension parameter will generally assume single-dimensional behaviors.

    SQL expressions of type :class:`_types.ARRAY` have support for "index" and
    "slice" behavior.  The Python ``[]`` operator works normally here, given
    integer indexes or slices.  Arrays default to 1-based indexing.
    The operator produces binary expression
    constructs which will produce the appropriate SQL, both for
    SELECT statements::

        select(mytable.c.data[5], mytable.c.data[2:7])

    as well as UPDATE statements when the :meth:`_expression.Update.values`
    method
    is used::

        mytable.update().values({
            mytable.c.data[5]: 7,
            mytable.c.data[2:7]: [1, 2, 3]
        })

    The :class:`_types.ARRAY` type also provides for the operators
    :meth:`.types.ARRAY.Comparator.any` and
    :meth:`.types.ARRAY.Comparator.all`. The PostgreSQL-specific version of
    :class:`_types.ARRAY` also provides additional operators.

    .. container:: topic

        **Detecting Changes in ARRAY columns when using the ORM**

        The :class:`_sqltypes.ARRAY` type, when used with the SQLAlchemy ORM,
        does not detect in-place mutations to the array. In order to detect
        these, the :mod:`sqlalchemy.ext.mutable` extension must be used, using
        the :class:`.MutableList` class::

            from sqlalchemy import ARRAY
            from sqlalchemy.ext.mutable import MutableList

            class SomeOrmClass(Base):
                # ...

                data = Column(MutableList.as_mutable(ARRAY(Integer)))

        This extension will allow "in-place" changes such to the array
        such as ``.append()`` to produce events which will be detected by the
        unit of work.  Note that changes to elements **inside** the array,
        including subarrays that are mutated in place, are **not** detected.

        Alternatively, assigning a new array value to an ORM element that
        replaces the old one will always trigger a change event.

    .. seealso::

        :class:`sqlalchemy.dialects.postgresql.ARRAY`

    """

    __visit_name__ = "ARRAY"

    _is_array = True

    zero_indexes = False
    """If True, Python zero-based indexes should be interpreted as one-based
    on the SQL expression side."""

    class Comparator(
        Indexable.Comparator[Sequence[Any]],
        Concatenable.Comparator[Sequence[Any]],
    ):

        """Define comparison operations for :class:`_types.ARRAY`.

        More operators are available on the dialect-specific form
        of this type.  See :class:`.postgresql.ARRAY.Comparator`.

        """

        __slots__ = ()

        type: ARRAY

        def _setup_getitem(self, index):
            arr_type = self.type

            return_type: TypeEngine[Any]

            if isinstance(index, slice):
                return_type = arr_type
                if arr_type.zero_indexes:
                    index = slice(index.start + 1, index.stop + 1, index.step)
                slice_ = Slice(
                    index.start, index.stop, index.step, _name=self.expr.key
                )
                return operators.getitem, slice_, return_type
            else:
                if arr_type.zero_indexes:
                    index += 1
                if arr_type.dimensions is None or arr_type.dimensions == 1:
                    return_type = arr_type.item_type
                else:
                    adapt_kw = {"dimensions": arr_type.dimensions - 1}
                    return_type = arr_type.adapt(
                        arr_type.__class__, **adapt_kw
                    )

                return operators.getitem, index, return_type

        def contains(self, *arg, **kw):
            """``ARRAY.contains()`` not implemented for the base ARRAY type.
            Use the dialect-specific ARRAY type.

            .. seealso::

                :class:`_postgresql.ARRAY` - PostgreSQL specific version.
            """
            raise NotImplementedError(
                "ARRAY.contains() not implemented for the base "
                "ARRAY type; please use the dialect-specific ARRAY type"
            )

        @util.preload_module("sqlalchemy.sql.elements")
        def any(self, other, operator=None):
            """Return ``other operator ANY (array)`` clause.

            .. legacy:: This method is an :class:`_types.ARRAY` - specific
                construct that is now superseded by the :func:`_sql.any_`
                function, which features a different calling style. The
                :func:`_sql.any_` function is also mirrored at the method level
                via the :meth:`_sql.ColumnOperators.any_` method.

            Usage of array-specific :meth:`_types.ARRAY.Comparator.any`
            is as follows::

                from sqlalchemy.sql import operators

                conn.execute(
                    select(table.c.data).where(
                            table.c.data.any(7, operator=operators.lt)
                        )
                )

            :param other: expression to be compared
            :param operator: an operator object from the
             :mod:`sqlalchemy.sql.operators`
             package, defaults to :func:`.operators.eq`.

            .. seealso::

                :func:`_expression.any_`

                :meth:`.types.ARRAY.Comparator.all`

            """
            elements = util.preloaded.sql_elements
            operator = operator if operator else operators.eq

            arr_type = self.type

            return elements.CollectionAggregate._create_any(self.expr).operate(
                operators.mirror(operator),
                coercions.expect(
                    roles.BinaryElementRole,
                    element=other,
                    operator=operator,
                    expr=self.expr,
                    bindparam_type=arr_type.item_type,
                ),
            )

        @util.preload_module("sqlalchemy.sql.elements")
        def all(self, other, operator=None):
            """Return ``other operator ALL (array)`` clause.

            .. legacy:: This method is an :class:`_types.ARRAY` - specific
                construct that is now superseded by the :func:`_sql.all_`
                function, which features a different calling style. The
                :func:`_sql.all_` function is also mirrored at the method level
                via the :meth:`_sql.ColumnOperators.all_` method.

            Usage of array-specific :meth:`_types.ARRAY.Comparator.all`
            is as follows::

                from sqlalchemy.sql import operators

                conn.execute(
                    select(table.c.data).where(
                            table.c.data.all(7, operator=operators.lt)
                        )
                )

            :param other: expression to be compared
            :param operator: an operator object from the
             :mod:`sqlalchemy.sql.operators`
             package, defaults to :func:`.operators.eq`.

            .. seealso::

                :func:`_expression.all_`

                :meth:`.types.ARRAY.Comparator.any`

            """
            elements = util.preloaded.sql_elements
            operator = operator if operator else operators.eq

            arr_type = self.type

            return elements.CollectionAggregate._create_all(self.expr).operate(
                operators.mirror(operator),
                coercions.expect(
                    roles.BinaryElementRole,
                    element=other,
                    operator=operator,
                    expr=self.expr,
                    bindparam_type=arr_type.item_type,
                ),
            )

    comparator_factory = Comparator

    def __init__(
        self,
        item_type: _TypeEngineArgument[Any],
        as_tuple: bool = False,
        dimensions: Optional[int] = None,
        zero_indexes: bool = False,
    ):
        """Construct an :class:`_types.ARRAY`.

        E.g.::

          Column('myarray', ARRAY(Integer))

        Arguments are:

        :param item_type: The data type of items of this array. Note that
          dimensionality is irrelevant here, so multi-dimensional arrays like
          ``INTEGER[][]``, are constructed as ``ARRAY(Integer)``, not as
          ``ARRAY(ARRAY(Integer))`` or such.

        :param as_tuple=False: Specify whether return results
          should be converted to tuples from lists.  This parameter is
          not generally needed as a Python list corresponds well
          to a SQL array.

        :param dimensions: if non-None, the ARRAY will assume a fixed
         number of dimensions.   This impacts how the array is declared
         on the database, how it goes about interpreting Python and
         result values, as well as how expression behavior in conjunction
         with the "getitem" operator works.  See the description at
         :class:`_types.ARRAY` for additional detail.

        :param zero_indexes=False: when True, index values will be converted
         between Python zero-based and SQL one-based indexes, e.g.
         a value of one will be added to all index values before passing
         to the database.

        """
        if isinstance(item_type, ARRAY):
            raise ValueError(
                "Do not nest ARRAY types; ARRAY(basetype) "
                "handles multi-dimensional arrays of basetype"
            )
        if isinstance(item_type, type):
            item_type = item_type()
        self.item_type = item_type
        self.as_tuple = as_tuple
        self.dimensions = dimensions
        self.zero_indexes = zero_indexes

    @property
    def hashable(self):
        return self.as_tuple

    @property
    def python_type(self):
        return list

    def compare_values(self, x, y):
        return x == y

    def _set_parent(self, column, outer=False, **kw):
        """Support SchemaEventTarget"""

        if not outer and isinstance(self.item_type, SchemaEventTarget):
            self.item_type._set_parent(column, **kw)

    def _set_parent_with_dispatch(self, parent):
        """Support SchemaEventTarget"""

        super()._set_parent_with_dispatch(parent, outer=True)

        if isinstance(self.item_type, SchemaEventTarget):
            self.item_type._set_parent_with_dispatch(parent)

    def literal_processor(self, dialect):
        item_proc = self.item_type.dialect_impl(dialect).literal_processor(
            dialect
        )
        if item_proc is None:
            return None

        def to_str(elements):
            return f"[{', '.join(elements)}]"

        def process(value):
            inner = self._apply_item_processor(
                value, item_proc, self.dimensions, to_str
            )
            return inner

        return process

    def _apply_item_processor(self, arr, itemproc, dim, collection_callable):
        """Helper method that can be used by bind_processor(),
        literal_processor(), etc. to apply an item processor to elements of
        an array value, taking into account the 'dimensions' for this
        array type.

        See the Postgresql ARRAY datatype for usage examples.

        .. versionadded:: 2.0

        """

        if dim is None:
            arr = list(arr)
        if (
            dim == 1
            or dim is None
            and (
                # this has to be (list, tuple), or at least
                # not hasattr('__iter__'), since Py3K strings
                # etc. have __iter__
                not arr
                or not isinstance(arr[0], (list, tuple))
            )
        ):
            if itemproc:
                return collection_callable(itemproc(x) for x in arr)
            else:
                return collection_callable(arr)
        else:
            return collection_callable(
                self._apply_item_processor(
                    x,
                    itemproc,
                    dim - 1 if dim is not None else None,
                    collection_callable,
                )
                if x is not None
                else None
                for x in arr
            )


class TupleType(TypeEngine[Tuple[Any, ...]]):
    """represent the composite type of a Tuple."""

    _is_tuple_type = True

    types: List[TypeEngine[Any]]

    def __init__(self, *types: _TypeEngineArgument[Any]):
        self._fully_typed = NULLTYPE not in types
        self.types = [
            item_type() if isinstance(item_type, type) else item_type
            for item_type in types
        ]

    def coerce_compared_value(
        self, op: Optional[OperatorType], value: Any
    ) -> TypeEngine[Any]:
        if value is type_api._NO_VALUE_IN_LIST:
            return super().coerce_compared_value(op, value)
        else:
            return TupleType(
                *[
                    typ.coerce_compared_value(op, elem)
                    for typ, elem in zip(self.types, value)
                ]
            )

    def _resolve_values_to_types(self, value: Any) -> TupleType:
        if self._fully_typed:
            return self
        else:
            return TupleType(
                *[
                    _resolve_value_to_type(elem) if typ is NULLTYPE else typ
                    for typ, elem in zip(self.types, value)
                ]
            )

    def result_processor(self, dialect, coltype):
        raise NotImplementedError(
            "The tuple type does not support being fetched "
            "as a column in a result row."
        )


class REAL(Float[_N]):

    """The SQL REAL type.

    .. seealso::

        :class:`_types.Float` - documentation for the base type.

    """

    __visit_name__ = "REAL"


class FLOAT(Float[_N]):

    """The SQL FLOAT type.

    .. seealso::

        :class:`_types.Float` - documentation for the base type.

    """

    __visit_name__ = "FLOAT"


class DOUBLE(Double[_N]):
    """The SQL DOUBLE type.

    .. versionadded:: 2.0

    .. seealso::

        :class:`_types.Double` - documentation for the base type.

    """

    __visit_name__ = "DOUBLE"


class DOUBLE_PRECISION(Double[_N]):
    """The SQL DOUBLE PRECISION type.

    .. versionadded:: 2.0

    .. seealso::

        :class:`_types.Double` - documentation for the base type.

    """

    __visit_name__ = "DOUBLE_PRECISION"


class NUMERIC(Numeric[_N]):

    """The SQL NUMERIC type.

    .. seealso::

        :class:`_types.Numeric` - documentation for the base type.

    """

    __visit_name__ = "NUMERIC"


class DECIMAL(Numeric[_N]):

    """The SQL DECIMAL type.

    .. seealso::

        :class:`_types.Numeric` - documentation for the base type.

    """

    __visit_name__ = "DECIMAL"


class INTEGER(Integer):

    """The SQL INT or INTEGER type.

    .. seealso::

        :class:`_types.Integer` - documentation for the base type.

    """

    __visit_name__ = "INTEGER"


INT = INTEGER


class SMALLINT(SmallInteger):

    """The SQL SMALLINT type.

    .. seealso::

        :class:`_types.SmallInteger` - documentation for the base type.

    """

    __visit_name__ = "SMALLINT"


class BIGINT(BigInteger):

    """The SQL BIGINT type.

    .. seealso::

        :class:`_types.BigInteger` - documentation for the base type.

    """

    __visit_name__ = "BIGINT"


class TIMESTAMP(DateTime):

    """The SQL TIMESTAMP type.

    :class:`_types.TIMESTAMP` datatypes have support for timezone
    storage on some backends, such as PostgreSQL and Oracle.  Use the
    :paramref:`~types.TIMESTAMP.timezone` argument in order to enable
    "TIMESTAMP WITH TIMEZONE" for these backends.

    """

    __visit_name__ = "TIMESTAMP"

    def __init__(self, timezone: bool = False):
        """Construct a new :class:`_types.TIMESTAMP`.

        :param timezone: boolean.  Indicates that the TIMESTAMP type should
         enable timezone support, if available on the target database.
         On a per-dialect basis is similar to "TIMESTAMP WITH TIMEZONE".
         If the target database does not support timezones, this flag is
         ignored.


        """
        super().__init__(timezone=timezone)

    def get_dbapi_type(self, dbapi):
        return dbapi.TIMESTAMP


class DATETIME(DateTime):

    """The SQL DATETIME type."""

    __visit_name__ = "DATETIME"


class DATE(Date):

    """The SQL DATE type."""

    __visit_name__ = "DATE"


class TIME(Time):

    """The SQL TIME type."""

    __visit_name__ = "TIME"


class TEXT(Text):

    """The SQL TEXT type."""

    __visit_name__ = "TEXT"


class CLOB(Text):

    """The CLOB type.

    This type is found in Oracle and Informix.
    """

    __visit_name__ = "CLOB"


class VARCHAR(String):

    """The SQL VARCHAR type."""

    __visit_name__ = "VARCHAR"


class NVARCHAR(Unicode):

    """The SQL NVARCHAR type."""

    __visit_name__ = "NVARCHAR"


class CHAR(String):

    """The SQL CHAR type."""

    __visit_name__ = "CHAR"


class NCHAR(Unicode):

    """The SQL NCHAR type."""

    __visit_name__ = "NCHAR"


class BLOB(LargeBinary):

    """The SQL BLOB type."""

    __visit_name__ = "BLOB"


class BINARY(_Binary):

    """The SQL BINARY type."""

    __visit_name__ = "BINARY"


class VARBINARY(_Binary):

    """The SQL VARBINARY type."""

    __visit_name__ = "VARBINARY"


class BOOLEAN(Boolean):

    """The SQL BOOLEAN type."""

    __visit_name__ = "BOOLEAN"


class NullType(TypeEngine[None]):

    """An unknown type.

    :class:`.NullType` is used as a default type for those cases where
    a type cannot be determined, including:

    * During table reflection, when the type of a column is not recognized
      by the :class:`.Dialect`
    * When constructing SQL expressions using plain Python objects of
      unknown types (e.g. ``somecolumn == my_special_object``)
    * When a new :class:`_schema.Column` is created,
      and the given type is passed
      as ``None`` or is not passed at all.

    The :class:`.NullType` can be used within SQL expression invocation
    without issue, it just has no behavior either at the expression
    construction level or at the bind-parameter/result processing level.
    :class:`.NullType` will result in a :exc:`.CompileError` if the compiler
    is asked to render the type itself, such as if it is used in a
    :func:`.cast` operation or within a schema creation operation such as that
    invoked by :meth:`_schema.MetaData.create_all` or the
    :class:`.CreateTable`
    construct.

    """

    __visit_name__ = "null"

    _isnull = True

    def literal_processor(self, dialect):
        return None

    class Comparator(TypeEngine.Comparator[_T]):
        __slots__ = ()

        def _adapt_expression(
            self,
            op: OperatorType,
            other_comparator: TypeEngine.Comparator[Any],
        ) -> Tuple[OperatorType, TypeEngine[Any]]:
            if isinstance(
                other_comparator, NullType.Comparator
            ) or not operators.is_commutative(op):
                return op, self.expr.type
            else:
                return other_comparator._adapt_expression(op, self)

    comparator_factory = Comparator


class TableValueType(HasCacheKey, TypeEngine[Any]):
    """Refers to a table value type."""

    _is_table_value = True

    _traverse_internals = [
        ("_elements", InternalTraversal.dp_clauseelement_list),
    ]

    def __init__(self, *elements: Union[str, _ColumnExpressionArgument[Any]]):
        self._elements = [
            coercions.expect(roles.StrAsPlainColumnRole, elem)
            for elem in elements
        ]


class MatchType(Boolean):
    """Refers to the return type of the MATCH operator.

    As the :meth:`.ColumnOperators.match` is probably the most open-ended
    operator in generic SQLAlchemy Core, we can't assume the return type
    at SQL evaluation time, as MySQL returns a floating point, not a boolean,
    and other backends might do something different.    So this type
    acts as a placeholder, currently subclassing :class:`.Boolean`.
    The type allows dialects to inject result-processing functionality
    if needed, and on MySQL will return floating-point values.

    """


_UUID_RETURN = TypeVar("_UUID_RETURN", str, _python_UUID)


class Uuid(Emulated, TypeEngine[_UUID_RETURN]):

    """Represent a database agnostic UUID datatype.

    For backends that have no "native" UUID datatype, the value will
    make use of ``CHAR(32)`` and store the UUID as a 32-character alphanumeric
    hex string.

    For backends which are known to support ``UUID`` directly or a similar
    uuid-storing datatype such as SQL Server's ``UNIQUEIDENTIFIER``, a
    "native" mode enabled by default allows these types will be used on those
    backends.

    In its default mode of use, the :class:`_sqltypes.Uuid` datatype expects
    **Python uuid objects**, from the Python
    `uuid <https://docs.python.org/3/library/uuid.html>`_
    module::

        import uuid

        from sqlalchemy import Uuid
        from sqlalchemy import Table, Column, MetaData, String


        metadata_obj = MetaData()

        t = Table(
            "t",
            metadata_obj,
            Column('uuid_data', Uuid, primary_key=True),
            Column("other_data", String)
        )

        with engine.begin() as conn:
            conn.execute(
                t.insert(),
                {"uuid_data": uuid.uuid4(), "other_data", "some data"}
            )

    To have the :class:`_sqltypes.Uuid` datatype work with string-based
    Uuids (e.g. 32 character hexadecimal strings), pass the
    :paramref:`_sqltypes.Uuid.as_uuid` parameter with the value ``False``.

    .. versionadded:: 2.0

    .. seealso::

        :class:`_sqltypes.UUID` - represents exactly the ``UUID`` datatype
        without any backend-agnostic behaviors.

    """

    __visit_name__ = "uuid"

    collation: Optional[str] = None

    @overload
    def __init__(
        self: Uuid[_python_UUID],
        as_uuid: Literal[True] = ...,
        native_uuid: bool = ...,
    ):
        ...

    @overload
    def __init__(
        self: Uuid[str],
        as_uuid: Literal[False] = ...,
        native_uuid: bool = ...,
    ):
        ...

    def __init__(self, as_uuid: bool = True, native_uuid: bool = True):
        """Construct a :class:`_sqltypes.Uuid` type.

        :param as_uuid=True: if True, values will be interpreted
         as Python uuid objects, converting to/from string via the
         DBAPI.

         .. versionchanged: 2.0 ``as_uuid`` now defaults to ``True``.

        :param native_uuid=True: if True, backends that support either the
         ``UUID`` datatype directly, or a UUID-storing value
         (such as SQL Server's ``UNIQUEIDENTIFIER`` will be used by those
         backends.   If False, a ``CHAR(32)`` datatype will be used for
         all backends regardless of native support.

        """
        self.as_uuid = as_uuid
        self.native_uuid = native_uuid

    @property
    def python_type(self):
        return _python_UUID if self.as_uuid else str

    @property
    def native(self):
        return self.native_uuid

    def coerce_compared_value(self, op, value):
        """See :meth:`.TypeEngine.coerce_compared_value` for a description."""

        if isinstance(value, str):
            return self
        else:
            return super().coerce_compared_value(op, value)

    def bind_processor(self, dialect):
        character_based_uuid = (
            not dialect.supports_native_uuid or not self.native_uuid
        )

        if character_based_uuid:
            if self.as_uuid:

                def process(value):
                    if value is not None:
                        value = value.hex
                    return value

                return process
            else:

                def process(value):
                    if value is not None:
                        value = value.replace("-", "")
                    return value

                return process
        else:
            return None

    def result_processor(self, dialect, coltype):
        character_based_uuid = (
            not dialect.supports_native_uuid or not self.native_uuid
        )

        if character_based_uuid:
            if self.as_uuid:

                def process(value):
                    if value is not None:
                        value = _python_UUID(value)
                    return value

                return process
            else:

                def process(value):
                    if value is not None:
                        value = str(_python_UUID(value))
                    return value

                return process
        else:
            if not self.as_uuid:

                def process(value):
                    if value is not None:
                        value = str(value)
                    return value

                return process
            else:
                return None

    def literal_processor(self, dialect):
        character_based_uuid = (
            not dialect.supports_native_uuid or not self.native_uuid
        )

        if not self.as_uuid:

            def process(value):
                return f"""'{value.replace("-", "").replace("'", "''")}'"""

            return process
        else:
            if character_based_uuid:

                def process(value):
                    return f"""'{value.hex}'"""

                return process
            else:

                def process(value):
                    return f"""'{str(value).replace("'", "''")}'"""

                return process


class UUID(Uuid[_UUID_RETURN], type_api.NativeForEmulated):

    """Represent the SQL UUID type.

    This is the SQL-native form of the :class:`_types.Uuid` database agnostic
    datatype, and is backwards compatible with the previous PostgreSQL-only
    version of ``UUID``.

    The :class:`_sqltypes.UUID` datatype only works on databases that have a
    SQL datatype named ``UUID``. It will not function for backends which don't
    have this exact-named type, including SQL Server. For backend-agnostic UUID
    values with native support, including for SQL Server's ``UNIQUEIDENTIFIER``
    datatype, use the :class:`_sqltypes.Uuid` datatype.

    .. versionadded:: 2.0

    .. seealso::

        :class:`_sqltypes.Uuid`

    """

    __visit_name__ = "UUID"

    @overload
    def __init__(self: UUID[_python_UUID], as_uuid: Literal[True] = ...):
        ...

    @overload
    def __init__(self: UUID[str], as_uuid: Literal[False] = ...):
        ...

    def __init__(self, as_uuid: bool = True):
        """Construct a :class:`_sqltypes.UUID` type.


        :param as_uuid=True: if True, values will be interpreted
         as Python uuid objects, converting to/from string via the
         DBAPI.

         .. versionchanged: 2.0 ``as_uuid`` now defaults to ``True``.

        """
        self.as_uuid = as_uuid
        self.native_uuid = True

    @classmethod
    def adapt_emulated_to_native(cls, impl, **kw):
        kw.setdefault("as_uuid", impl.as_uuid)
        return cls(**kw)


NULLTYPE = NullType()
BOOLEANTYPE = Boolean()
STRINGTYPE = String()
INTEGERTYPE = Integer()
NUMERICTYPE: Numeric[decimal.Decimal] = Numeric()
MATCHTYPE = MatchType()
TABLEVALUE = TableValueType()
DATETIME_TIMEZONE = DateTime(timezone=True)
TIME_TIMEZONE = Time(timezone=True)
_BIGINTEGER = BigInteger()
_DATETIME = DateTime()
_TIME = Time()
_STRING = String()
_UNICODE = Unicode()

_type_map: Dict[Type[Any], TypeEngine[Any]] = {
    int: Integer(),
    float: Float(),
    bool: BOOLEANTYPE,
    _python_UUID: Uuid(),
    decimal.Decimal: Numeric(),
    dt.date: Date(),
    dt.datetime: _DATETIME,
    dt.time: _TIME,
    dt.timedelta: Interval(),
    type(None): NULLTYPE,
    bytes: LargeBinary(),
    str: _STRING,
    enum.Enum: Enum(enum.Enum),
    Literal: Enum(enum.Enum),  # type: ignore[dict-item]
}


_type_map_get = _type_map.get


def _resolve_value_to_type(value: Any) -> TypeEngine[Any]:
    _result_type = _type_map_get(type(value), False)

    if _result_type is False:
        _result_type = getattr(value, "__sa_type_engine__", False)

    if _result_type is False:
        # use inspect() to detect SQLAlchemy built-in
        # objects.
        insp = inspection.inspect(value, False)
        if (
            insp is not None
            and
            # foil mock.Mock() and other impostors by ensuring
            # the inspection target itself self-inspects
            insp.__class__ in inspection._registrars
        ):
            raise exc.ArgumentError(
                "Object %r is not legal as a SQL literal value" % (value,)
            )
        return NULLTYPE
    else:
        return _result_type._resolve_for_literal(  # type: ignore [union-attr]
            value
        )


# back-assign to type_api
type_api.BOOLEANTYPE = BOOLEANTYPE
type_api.STRINGTYPE = STRINGTYPE
type_api.INTEGERTYPE = INTEGERTYPE
type_api.NULLTYPE = NULLTYPE
type_api.NUMERICTYPE = NUMERICTYPE
type_api.MATCHTYPE = MATCHTYPE
type_api.INDEXABLE = INDEXABLE = Indexable
type_api.TABLEVALUE = TABLEVALUE
type_api._resolve_value_to_type = _resolve_value_to_type
