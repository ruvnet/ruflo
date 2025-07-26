"""
Package for SQL analytic functions wrappers
"""
from pypika.terms import (
    AnalyticFunction,
    WindowFrameAnalyticFunction,
    IgnoreNullsAnalyticFunction,
)

__author__ = "Timothy Heys"
__email__ = "theys@kayak.com"


class Preceding(WindowFrameAnalyticFunction.Edge):
    modifier = "PRECEDING"


class Following(WindowFrameAnalyticFunction.Edge):
    modifier = "FOLLOWING"


CURRENT_ROW = "CURRENT ROW"


class Rank(AnalyticFunction):
    def __init__(self, **kwargs):
        super(Rank, self).__init__("RANK", **kwargs)


class DenseRank(AnalyticFunction):
    def __init__(self, **kwargs):
        super(DenseRank, self).__init__("DENSE_RANK", **kwargs)


class RowNumber(AnalyticFunction):
    def __init__(self, **kwargs):
        super(RowNumber, self).__init__("ROW_NUMBER", **kwargs)


class NTile(AnalyticFunction):
    def __init__(self, term, **kwargs):
        super(NTile, self).__init__("NTILE", term, **kwargs)


class FirstValue(WindowFrameAnalyticFunction, IgnoreNullsAnalyticFunction):
    def __init__(self, *terms, **kwargs):
        super(FirstValue, self).__init__("FIRST_VALUE", *terms, **kwargs)


class LastValue(WindowFrameAnalyticFunction, IgnoreNullsAnalyticFunction):
    def __init__(self, *terms, **kwargs):
        super(LastValue, self).__init__("LAST_VALUE", *terms, **kwargs)


class Median(AnalyticFunction):
    def __init__(self, term, **kwargs):
        super(Median, self).__init__("MEDIAN", term, **kwargs)


class Avg(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(Avg, self).__init__("AVG", term, **kwargs)


class StdDev(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(StdDev, self).__init__("STDDEV", term, **kwargs)


class StdDevPop(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(StdDevPop, self).__init__("STDDEV_POP", term, **kwargs)


class StdDevSamp(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(StdDevSamp, self).__init__("STDDEV_SAMP", term, **kwargs)


class Variance(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(Variance, self).__init__("VARIANCE", term, **kwargs)


class VarPop(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(VarPop, self).__init__("VAR_POP", term, **kwargs)


class VarSamp(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(VarSamp, self).__init__("VAR_SAMP", term, **kwargs)


class Count(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(Count, self).__init__("COUNT", term, **kwargs)


class Sum(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(Sum, self).__init__("SUM", term, **kwargs)


class Max(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(Max, self).__init__("MAX", term, **kwargs)


class Min(WindowFrameAnalyticFunction):
    def __init__(self, term, **kwargs):
        super(Min, self).__init__("MIN", term, **kwargs)


class Lag(AnalyticFunction):
    def __init__(self, *args, **kwargs):
        super(Lag, self).__init__("LAG", *args, **kwargs)


class Lead(AnalyticFunction):
    def __init__(self, *args, **kwargs):
        super(Lead, self).__init__("LEAD", *args, **kwargs)
