from enum import Enum
from typing import Any

__author__ = "Timothy Heys"
__email__ = "theys@kayak.com"


class Arithmetic(Enum):
    add = "+"
    sub = "-"
    mul = "*"
    div = "/"
    lshift = "<<"
    rshift = ">>"


class Comparator(Enum):
    pass


class Equality(Comparator):
    eq = "="
    ne = "<>"
    gt = ">"
    gte = ">="
    lt = "<"
    lte = "<="


class Matching(Comparator):
    not_like = " NOT LIKE "
    like = " LIKE "
    not_ilike = " NOT ILIKE "
    ilike = " ILIKE "
    rlike = " RLIKE "
    regex = " REGEX "
    regexp = " REGEXP "
    bin_regex = " REGEX BINARY "
    as_of = " AS OF "
    glob = " GLOB "


class Boolean(Comparator):
    and_ = "AND"
    or_ = "OR"
    xor_ = "XOR"
    true = "TRUE"
    false = "FALSE"


class Order(Enum):
    asc = "ASC"
    desc = "DESC"


class JoinType(Enum):
    inner = ""
    left = "LEFT"
    right = "RIGHT"
    outer = "FULL OUTER"
    left_outer = "LEFT OUTER"
    right_outer = "RIGHT OUTER"
    full_outer = "FULL OUTER"
    cross = "CROSS"
    hash = "HASH"


class ReferenceOption(Enum):
    cascade = "CASCADE"
    no_action = "NO ACTION"
    restrict = "RESTRICT"
    set_null = "SET NULL"
    set_default = "SET DEFAULT"


class SetOperation(Enum):
    union = "UNION"
    union_all = "UNION ALL"
    intersect = "INTERSECT"
    except_of = "EXCEPT"
    minus = "MINUS"


class DatePart(Enum):
    year = "YEAR"
    quarter = "QUARTER"
    month = "MONTH"
    week = "WEEK"
    day = "DAY"
    hour = "HOUR"
    minute = "MINUTE"
    second = "SECOND"
    microsecond = "MICROSECOND"


class SqlType:
    def __init__(self, name: str) -> None:
        self.name = name

    def __call__(self, length: int) -> "SqlTypeLength":
        return SqlTypeLength(self.name, length)

    def get_sql(self, **kwargs: Any) -> str:
        return "{name}".format(name=self.name)


class SqlTypeLength:
    def __init__(self, name: str, length: int) -> None:
        self.name = name
        self.length = length

    def get_sql(self, **kwargs: Any) -> str:
        return "{name}({length})".format(name=self.name, length=self.length)


class SqlTypes:
    BOOLEAN = "BOOLEAN"
    INTEGER = "INTEGER"
    FLOAT = "FLOAT"
    NUMERIC = "NUMERIC"
    SIGNED = "SIGNED"
    UNSIGNED = "UNSIGNED"

    DATE = "DATE"
    TIME = "TIME"
    TIMESTAMP = "TIMESTAMP"

    CHAR = SqlType("CHAR")
    VARCHAR = SqlType("VARCHAR")
    LONG_VARCHAR = SqlType("LONG VARCHAR")
    BINARY = SqlType("BINARY")
    VARBINARY = SqlType("VARBINARY")
    LONG_VARBINARY = SqlType("LONG VARBINARY")


class Dialects(Enum):
    VERTICA = "vertica"
    CLICKHOUSE = "clickhouse"
    ORACLE = "oracle"
    MSSQL = "mssql"
    MYSQL = "mysql"
    POSTGRESQL = "postgressql"
    REDSHIFT = "redshift"
    SQLLITE = "sqllite"
    SNOWFLAKE = "snowflake"


class JSONOperators(Enum):
    HAS_KEY = "?"
    CONTAINS = "@>"
    CONTAINED_BY = "<@"
    HAS_KEYS = "?&"
    HAS_ANY_KEYS = "?|"
    GET_JSON_VALUE = "->"
    GET_TEXT_VALUE = "->>"
    GET_PATH_JSON_VALUE = "#>"
    GET_PATH_TEXT_VALUE = "#>>"
