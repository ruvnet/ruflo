"""
PyPika is divided into a couple of modules, primarily the ``queries`` and ``terms`` modules.

pypika.queries
--------------

This is where the ``Query`` class can be found which is the core class in PyPika.  Also, other top level classes such
as ``Table`` can be found here.  ``Query`` is a container that holds all of the ``Term`` types together and also
serializes the builder to a string.

pypika.terms
------------

This module contains the classes which represent individual parts of queries that extend the ``Term`` base class.

pypika.functions
----------------

Wrappers for common SQL functions are stored in this package.

pypika.enums
------------

Enumerated values are kept in this package which are used as options for Queries and Terms.


pypika.utils
------------

This contains all of the utility classes such as exceptions and decorators.

"""
# noinspection PyUnresolvedReferences
from pypika.dialects import (
    ClickHouseQuery,
    Dialects,
    MSSQLQuery,
    MySQLQuery,
    OracleQuery,
    PostgreSQLQuery,
    RedshiftQuery,
    SQLLiteQuery,
    VerticaQuery,
)

# noinspection PyUnresolvedReferences
from pypika.enums import (
    DatePart,
    JoinType,
    Order,
)

# noinspection PyUnresolvedReferences
from pypika.queries import (
    AliasedQuery,
    Query,
    Schema,
    Table,
    Column,
    Database,
    make_tables as Tables,
    make_columns as Columns,
)

# noinspection PyUnresolvedReferences
from pypika.terms import (
    Array,
    Bracket,
    Case,
    Criterion,
    EmptyCriterion,
    Field,
    Index,
    Interval,
    JSON,
    Not,
    NullValue,
    SystemTimeValue,
    Parameter,
    QmarkParameter,
    NumericParameter,
    NamedParameter,
    FormatParameter,
    PyformatParameter,
    Rollup,
    Tuple,
    CustomFunction,
)

# noinspection PyUnresolvedReferences
from pypika.utils import (
    CaseException,
    GroupingException,
    JoinException,
    QueryException,
    RollupException,
    SetOperationException,
    FunctionException,
)

__author__ = "Timothy Heys"
__email__ = "theys@kayak.com"
__version__ = "0.48.9"

NULL = NullValue()
SYSTEM_TIME = SystemTimeValue()
