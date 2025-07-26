"""
Package for SQL functions wrappers
"""
from pypika.enums import SqlTypes
from pypika.terms import (
    AggregateFunction,
    Function,
    LiteralValue,
    Star,
)
from pypika.utils import builder

__author__ = "Timothy Heys"
__email__ = "theys@kayak.com"


class DistinctOptionFunction(AggregateFunction):
    def __init__(self, name, *args, **kwargs):
        alias = kwargs.get("alias")
        super(DistinctOptionFunction, self).__init__(name, *args, alias=alias)
        self._distinct = False

    def get_function_sql(self, **kwargs):
        s = super(DistinctOptionFunction, self).get_function_sql(**kwargs)

        n = len(self.name) + 1
        if self._distinct:
            return s[:n] + "DISTINCT " + s[n:]
        return s

    @builder
    def distinct(self):
        self._distinct = True


class Count(DistinctOptionFunction):
    def __init__(self, param, alias=None):
        is_star = isinstance(param, str) and "*" == param
        super(Count, self).__init__("COUNT", Star() if is_star else param, alias=alias)


# Arithmetic Functions
class Sum(DistinctOptionFunction):
    def __init__(self, term, alias=None):
        super(Sum, self).__init__("SUM", term, alias=alias)


class Avg(AggregateFunction):
    def __init__(self, term, alias=None):
        super(Avg, self).__init__("AVG", term, alias=alias)


class Min(AggregateFunction):
    def __init__(self, term, alias=None):
        super(Min, self).__init__("MIN", term, alias=alias)


class Max(AggregateFunction):
    def __init__(self, term, alias=None):
        super(Max, self).__init__("MAX", term, alias=alias)


class Std(AggregateFunction):
    def __init__(self, term, alias=None):
        super(Std, self).__init__("STD", term, alias=alias)


class StdDev(AggregateFunction):
    def __init__(self, term, alias=None):
        super(StdDev, self).__init__("STDDEV", term, alias=alias)


class Abs(AggregateFunction):
    def __init__(self, term, alias=None):
        super(Abs, self).__init__("ABS", term, alias=alias)


class First(AggregateFunction):
    def __init__(self, term, alias=None):
        super(First, self).__init__("FIRST", term, alias=alias)


class Last(AggregateFunction):
    def __init__(self, term, alias=None):
        super(Last, self).__init__("LAST", term, alias=alias)


class Sqrt(Function):
    def __init__(self, term, alias=None):
        super(Sqrt, self).__init__("SQRT", term, alias=alias)


class Floor(Function):
    def __init__(self, term, alias=None):
        super(Floor, self).__init__("FLOOR", term, alias=alias)


class ApproximatePercentile(AggregateFunction):
    def __init__(self, term, percentile, alias=None):
        super(ApproximatePercentile, self).__init__("APPROXIMATE_PERCENTILE", term, alias=alias)
        self.percentile = float(percentile)

    def get_special_params_sql(self, **kwargs):
        return "USING PARAMETERS percentile={percentile}".format(percentile=self.percentile)


# Type Functions
class Cast(Function):
    def __init__(self, term, as_type, alias=None):
        super(Cast, self).__init__("CAST", term, alias=alias)
        self.as_type = as_type

    def get_special_params_sql(self, **kwargs):
        type_sql = self.as_type.get_sql(**kwargs) if hasattr(self.as_type, "get_sql") else str(self.as_type).upper()

        return "AS {type}".format(type=type_sql)


class Convert(Function):
    def __init__(self, term, encoding, alias=None):
        super(Convert, self).__init__("CONVERT", term, alias=alias)
        self.encoding = encoding

    def get_special_params_sql(self, **kwargs):
        return "USING {type}".format(type=self.encoding.value)


class ToChar(Function):
    def __init__(self, term, as_type, alias=None):
        super(ToChar, self).__init__("TO_CHAR", term, as_type, alias=alias)


class Signed(Cast):
    def __init__(self, term, alias=None):
        super(Signed, self).__init__(term, SqlTypes.SIGNED, alias=alias)


class Unsigned(Cast):
    def __init__(self, term, alias=None):
        super(Unsigned, self).__init__(term, SqlTypes.UNSIGNED, alias=alias)


class Date(Function):
    def __init__(self, term, alias=None):
        super(Date, self).__init__("DATE", term, alias=alias)


class DateDiff(Function):
    def __init__(self, interval, start_date, end_date, alias=None):
        super(DateDiff, self).__init__("DATEDIFF", interval, start_date, end_date, alias=alias)


class TimeDiff(Function):
    def __init__(self, start_time, end_time, alias=None):
        super(TimeDiff, self).__init__("TIMEDIFF", start_time, end_time, alias=alias)


class DateAdd(Function):
    def __init__(self, date_part, interval, term, alias=None):
        date_part = getattr(date_part, "value", date_part)
        super(DateAdd, self).__init__("DATE_ADD", LiteralValue(date_part), interval, term, alias=alias)


class ToDate(Function):
    def __init__(self, value, format_mask, alias=None):
        super(ToDate, self).__init__("TO_DATE", value, format_mask, alias=alias)


class Timestamp(Function):
    def __init__(self, term, alias=None):
        super(Timestamp, self).__init__("TIMESTAMP", term, alias=alias)


class TimestampAdd(Function):
    def __init__(self, date_part, interval, term, alias=None):
        date_part = getattr(date_part, 'value', date_part)
        super(TimestampAdd, self).__init__("TIMESTAMPADD", LiteralValue(date_part), interval, term, alias=alias)


# String Functions
class Ascii(Function):
    def __init__(self, term, alias=None):
        super(Ascii, self).__init__("ASCII", term, alias=alias)


class NullIf(Function):
    def __init__(self, term, condition, **kwargs):
        super(NullIf, self).__init__("NULLIF", term, condition, **kwargs)


class Bin(Function):
    def __init__(self, term, alias=None):
        super(Bin, self).__init__("BIN", term, alias=alias)


class Concat(Function):
    def __init__(self, *terms, **kwargs):
        super(Concat, self).__init__("CONCAT", *terms, **kwargs)


class Insert(Function):
    def __init__(self, term, start, stop, subterm, alias=None):
        term, start, stop, subterm = [term for term in [term, start, stop, subterm]]
        super(Insert, self).__init__("INSERT", term, start, stop, subterm, alias=alias)


class Length(Function):
    def __init__(self, term, alias=None):
        super(Length, self).__init__("LENGTH", term, alias=alias)


class Upper(Function):
    def __init__(self, term, alias=None):
        super(Upper, self).__init__("UPPER", term, alias=alias)


class Lower(Function):
    def __init__(self, term, alias=None):
        super(Lower, self).__init__("LOWER", term, alias=alias)


class Substring(Function):
    def __init__(self, term, start, stop, alias=None):
        super(Substring, self).__init__("SUBSTRING", term, start, stop, alias=alias)


class Reverse(Function):
    def __init__(self, term, alias=None):
        super(Reverse, self).__init__("REVERSE", term, alias=alias)


class Trim(Function):
    def __init__(self, term, alias=None):
        super(Trim, self).__init__("TRIM", term, alias=alias)


class SplitPart(Function):
    def __init__(self, term, delimiter, index, alias=None):
        super(SplitPart, self).__init__("SPLIT_PART", term, delimiter, index, alias=alias)


class RegexpMatches(Function):
    def __init__(self, term, pattern, modifiers=None, alias=None):
        super(RegexpMatches, self).__init__("REGEXP_MATCHES", term, pattern, modifiers, alias=alias)


class RegexpLike(Function):
    def __init__(self, term, pattern, modifiers=None, alias=None):
        super(RegexpLike, self).__init__("REGEXP_LIKE", term, pattern, modifiers, alias=alias)


class Replace(Function):
    def __init__(self, term, find_string, replace_with, alias=None):
        super(Replace, self).__init__("REPLACE", term, find_string, replace_with, alias=alias)


# Date/Time Functions
class Now(Function):
    def __init__(self, alias=None):
        super(Now, self).__init__("NOW", alias=alias)


class UtcTimestamp(Function):
    def __init__(self, alias=None):
        super(UtcTimestamp, self).__init__("UTC_TIMESTAMP", alias=alias)


class CurTimestamp(Function):
    def __init__(self, alias=None):
        super(CurTimestamp, self).__init__("CURRENT_TIMESTAMP", alias=alias)

    def get_function_sql(self, **kwargs):
        # CURRENT_TIMESTAMP takes no arguments, so the SQL to generate is quite
        # simple.  Note that empty parentheses have been omitted intentionally.
        return "CURRENT_TIMESTAMP"


class CurDate(Function):
    def __init__(self, alias=None):
        super(CurDate, self).__init__("CURRENT_DATE", alias=alias)


class CurTime(Function):
    def __init__(self, alias=None):
        super(CurTime, self).__init__("CURRENT_TIME", alias=alias)


class Extract(Function):
    def __init__(self, date_part, field, alias=None):
        date_part = getattr(date_part, "value", date_part)
        super(Extract, self).__init__("EXTRACT", LiteralValue(date_part), alias=alias)
        self.field = field

    def get_special_params_sql(self, **kwargs):
        return "FROM {field}".format(field=self.field.get_sql(**kwargs))


# Null Functions
class IsNull(Function):
    def __init__(self, term, alias=None):
        super(IsNull, self).__init__("ISNULL", term, alias=alias)


class Coalesce(Function):
    def __init__(self, term, *default_values, **kwargs):
        super(Coalesce, self).__init__("COALESCE", term, *default_values, **kwargs)


class IfNull(Function):
    def __init__(self, condition, term, **kwargs):
        super(IfNull, self).__init__("IFNULL", condition, term, **kwargs)


class NVL(Function):
    def __init__(self, condition, term, alias=None):
        super(NVL, self).__init__("NVL", condition, term, alias=alias)
