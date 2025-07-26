# dialects/oracle/types.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
from __future__ import annotations

import datetime as dt
from typing import Optional
from typing import Type
from typing import TYPE_CHECKING

from ... import exc
from ...sql import sqltypes
from ...types import NVARCHAR
from ...types import VARCHAR

if TYPE_CHECKING:
    from ...engine.interfaces import Dialect
    from ...sql.type_api import _LiteralProcessorType


class RAW(sqltypes._Binary):
    __visit_name__ = "RAW"


OracleRaw = RAW


class NCLOB(sqltypes.Text):
    __visit_name__ = "NCLOB"


class VARCHAR2(VARCHAR):
    __visit_name__ = "VARCHAR2"


NVARCHAR2 = NVARCHAR


class NUMBER(sqltypes.Numeric, sqltypes.Integer):
    __visit_name__ = "NUMBER"

    def __init__(self, precision=None, scale=None, asdecimal=None):
        if asdecimal is None:
            asdecimal = bool(scale and scale > 0)

        super().__init__(precision=precision, scale=scale, asdecimal=asdecimal)

    def adapt(self, impltype):
        ret = super().adapt(impltype)
        # leave a hint for the DBAPI handler
        ret._is_oracle_number = True
        return ret

    @property
    def _type_affinity(self):
        if bool(self.scale and self.scale > 0):
            return sqltypes.Numeric
        else:
            return sqltypes.Integer


class FLOAT(sqltypes.FLOAT):
    """Oracle FLOAT.

    This is the same as :class:`_sqltypes.FLOAT` except that
    an Oracle-specific :paramref:`_oracle.FLOAT.binary_precision`
    parameter is accepted, and
    the :paramref:`_sqltypes.Float.precision` parameter is not accepted.

    Oracle FLOAT types indicate precision in terms of "binary precision", which
    defaults to 126. For a REAL type, the value is 63. This parameter does not
    cleanly map to a specific number of decimal places but is roughly
    equivalent to the desired number of decimal places divided by 0.3103.

    .. versionadded:: 2.0

    """

    __visit_name__ = "FLOAT"

    def __init__(
        self,
        binary_precision=None,
        asdecimal=False,
        decimal_return_scale=None,
    ):
        r"""
        Construct a FLOAT

        :param binary_precision: Oracle binary precision value to be rendered
         in DDL. This may be approximated to the number of decimal characters
         using the formula "decimal precision = 0.30103 * binary precision".
         The default value used by Oracle for FLOAT / DOUBLE PRECISION is 126.

        :param asdecimal: See :paramref:`_sqltypes.Float.asdecimal`

        :param decimal_return_scale: See
         :paramref:`_sqltypes.Float.decimal_return_scale`

        """
        super().__init__(
            asdecimal=asdecimal, decimal_return_scale=decimal_return_scale
        )
        self.binary_precision = binary_precision


class BINARY_DOUBLE(sqltypes.Double):
    __visit_name__ = "BINARY_DOUBLE"


class BINARY_FLOAT(sqltypes.Float):
    __visit_name__ = "BINARY_FLOAT"


class BFILE(sqltypes.LargeBinary):
    __visit_name__ = "BFILE"


class LONG(sqltypes.Text):
    __visit_name__ = "LONG"


class _OracleDateLiteralRender:
    def _literal_processor_datetime(self, dialect):
        def process(value):
            if getattr(value, "microsecond", None):
                value = (
                    f"""TO_TIMESTAMP"""
                    f"""('{value.isoformat().replace("T", " ")}', """
                    """'YYYY-MM-DD HH24:MI:SS.FF')"""
                )
            else:
                value = (
                    f"""TO_DATE"""
                    f"""('{value.isoformat().replace("T", " ")}', """
                    """'YYYY-MM-DD HH24:MI:SS')"""
                )
            return value

        return process

    def _literal_processor_date(self, dialect):
        def process(value):
            if getattr(value, "microsecond", None):
                value = (
                    f"""TO_TIMESTAMP"""
                    f"""('{value.isoformat().split("T")[0]}', """
                    """'YYYY-MM-DD')"""
                )
            else:
                value = (
                    f"""TO_DATE"""
                    f"""('{value.isoformat().split("T")[0]}', """
                    """'YYYY-MM-DD')"""
                )
            return value

        return process


class DATE(_OracleDateLiteralRender, sqltypes.DateTime):
    """Provide the oracle DATE type.

    This type has no special Python behavior, except that it subclasses
    :class:`_types.DateTime`; this is to suit the fact that the Oracle
    ``DATE`` type supports a time value.

    """

    __visit_name__ = "DATE"

    def literal_processor(self, dialect):
        return self._literal_processor_datetime(dialect)

    def _compare_type_affinity(self, other):
        return other._type_affinity in (sqltypes.DateTime, sqltypes.Date)


class _OracleDate(_OracleDateLiteralRender, sqltypes.Date):
    def literal_processor(self, dialect):
        return self._literal_processor_date(dialect)


class INTERVAL(sqltypes.NativeForEmulated, sqltypes._AbstractInterval):
    __visit_name__ = "INTERVAL"

    def __init__(self, day_precision=None, second_precision=None):
        """Construct an INTERVAL.

        Note that only DAY TO SECOND intervals are currently supported.
        This is due to a lack of support for YEAR TO MONTH intervals
        within available DBAPIs.

        :param day_precision: the day precision value.  this is the number of
          digits to store for the day field.  Defaults to "2"
        :param second_precision: the second precision value.  this is the
          number of digits to store for the fractional seconds field.
          Defaults to "6".

        """
        self.day_precision = day_precision
        self.second_precision = second_precision

    @classmethod
    def _adapt_from_generic_interval(cls, interval):
        return INTERVAL(
            day_precision=interval.day_precision,
            second_precision=interval.second_precision,
        )

    @classmethod
    def adapt_emulated_to_native(
        cls, interval: sqltypes.Interval, **kw  # type: ignore[override]
    ):
        return INTERVAL(
            day_precision=interval.day_precision,
            second_precision=interval.second_precision,
        )

    @property
    def _type_affinity(self):
        return sqltypes.Interval

    def as_generic(self, allow_nulltype=False):
        return sqltypes.Interval(
            native=True,
            second_precision=self.second_precision,
            day_precision=self.day_precision,
        )

    @property
    def python_type(self) -> Type[dt.timedelta]:
        return dt.timedelta

    def literal_processor(
        self, dialect: Dialect
    ) -> Optional[_LiteralProcessorType[dt.timedelta]]:
        def process(value: dt.timedelta) -> str:
            return f"NUMTODSINTERVAL({value.total_seconds()}, 'SECOND')"

        return process


class TIMESTAMP(sqltypes.TIMESTAMP):
    """Oracle implementation of ``TIMESTAMP``, which supports additional
    Oracle-specific modes

    .. versionadded:: 2.0

    """

    def __init__(self, timezone: bool = False, local_timezone: bool = False):
        """Construct a new :class:`_oracle.TIMESTAMP`.

        :param timezone: boolean.  Indicates that the TIMESTAMP type should
         use Oracle's ``TIMESTAMP WITH TIME ZONE`` datatype.

        :param local_timezone: boolean.  Indicates that the TIMESTAMP type
         should use Oracle's ``TIMESTAMP WITH LOCAL TIME ZONE`` datatype.


        """
        if timezone and local_timezone:
            raise exc.ArgumentError(
                "timezone and local_timezone are mutually exclusive"
            )
        super().__init__(timezone=timezone)
        self.local_timezone = local_timezone


class ROWID(sqltypes.TypeEngine):
    """Oracle ROWID type.

    When used in a cast() or similar, generates ROWID.

    """

    __visit_name__ = "ROWID"


class _OracleBoolean(sqltypes.Boolean):
    def get_dbapi_type(self, dbapi):
        return dbapi.NUMBER
