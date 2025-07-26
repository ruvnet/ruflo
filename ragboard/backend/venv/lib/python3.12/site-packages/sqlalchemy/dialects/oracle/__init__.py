# dialects/oracle/__init__.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
from types import ModuleType

from . import base  # noqa
from . import cx_oracle  # noqa
from . import oracledb  # noqa
from .base import BFILE
from .base import BINARY_DOUBLE
from .base import BINARY_FLOAT
from .base import BLOB
from .base import CHAR
from .base import CLOB
from .base import DATE
from .base import DOUBLE_PRECISION
from .base import FLOAT
from .base import INTERVAL
from .base import LONG
from .base import NCHAR
from .base import NCLOB
from .base import NUMBER
from .base import NVARCHAR
from .base import NVARCHAR2
from .base import RAW
from .base import REAL
from .base import ROWID
from .base import TIMESTAMP
from .base import VARCHAR
from .base import VARCHAR2

# Alias oracledb also as oracledb_async
oracledb_async = type(
    "oracledb_async", (ModuleType,), {"dialect": oracledb.dialect_async}
)

base.dialect = dialect = cx_oracle.dialect

__all__ = (
    "VARCHAR",
    "NVARCHAR",
    "CHAR",
    "NCHAR",
    "DATE",
    "NUMBER",
    "BLOB",
    "BFILE",
    "CLOB",
    "NCLOB",
    "TIMESTAMP",
    "RAW",
    "FLOAT",
    "DOUBLE_PRECISION",
    "BINARY_DOUBLE",
    "BINARY_FLOAT",
    "LONG",
    "dialect",
    "INTERVAL",
    "VARCHAR2",
    "NVARCHAR2",
    "ROWID",
    "REAL",
)
