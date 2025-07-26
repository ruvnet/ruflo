# dialects/postgresql/ranges.py
# Copyright (C) 2013-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import dataclasses
from datetime import date
from datetime import datetime
from datetime import timedelta
from decimal import Decimal
from typing import Any
from typing import cast
from typing import Generic
from typing import Optional
from typing import overload
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from .operators import ADJACENT_TO
from .operators import CONTAINED_BY
from .operators import CONTAINS
from .operators import NOT_EXTEND_LEFT_OF
from .operators import NOT_EXTEND_RIGHT_OF
from .operators import OVERLAP
from .operators import STRICTLY_LEFT_OF
from .operators import STRICTLY_RIGHT_OF
from ... import types as sqltypes
from ...sql import operators
from ...sql.type_api import TypeEngine
from ...util import py310
from ...util.typing import Literal

if TYPE_CHECKING:
    from ...sql.elements import ColumnElement
    from ...sql.type_api import _TE
    from ...sql.type_api import TypeEngineMixin

_T = TypeVar("_T", bound=Any)

_BoundsType = Literal["()", "[)", "(]", "[]"]

if py310:
    dc_slots = {"slots": True}
    dc_kwonly = {"kw_only": True}
else:
    dc_slots = {}
    dc_kwonly = {}


@dataclasses.dataclass(frozen=True, **dc_slots)
class Range(Generic[_T]):
    """Represent a PostgreSQL range.

    E.g.::

        r = Range(10, 50, bounds="()")

    The calling style is similar to that of psycopg and psycopg2, in part
    to allow easier migration from previous SQLAlchemy versions that used
    these objects directly.

    :param lower: Lower bound value, or None
    :param upper: Upper bound value, or None
    :param bounds: keyword-only, optional string value that is one of
     ``"()"``, ``"[)"``, ``"(]"``, ``"[]"``.  Defaults to ``"[)"``.
    :param empty: keyword-only, optional bool indicating this is an "empty"
     range

    .. versionadded:: 2.0

    """

    lower: Optional[_T] = None
    """the lower bound"""

    upper: Optional[_T] = None
    """the upper bound"""

    if TYPE_CHECKING:
        bounds: _BoundsType = dataclasses.field(default="[)")
        empty: bool = dataclasses.field(default=False)
    else:
        bounds: _BoundsType = dataclasses.field(default="[)", **dc_kwonly)
        empty: bool = dataclasses.field(default=False, **dc_kwonly)

    if not py310:

        def __init__(
            self,
            lower: Optional[_T] = None,
            upper: Optional[_T] = None,
            *,
            bounds: _BoundsType = "[)",
            empty: bool = False,
        ):
            # no __slots__ either so we can update dict
            self.__dict__.update(
                {
                    "lower": lower,
                    "upper": upper,
                    "bounds": bounds,
                    "empty": empty,
                }
            )

    def __bool__(self) -> bool:
        return not self.empty

    @property
    def isempty(self) -> bool:
        "A synonym for the 'empty' attribute."

        return self.empty

    @property
    def is_empty(self) -> bool:
        "A synonym for the 'empty' attribute."

        return self.empty

    @property
    def lower_inc(self) -> bool:
        """Return True if the lower bound is inclusive."""

        return self.bounds[0] == "["

    @property
    def lower_inf(self) -> bool:
        """Return True if this range is non-empty and lower bound is
        infinite."""

        return not self.empty and self.lower is None

    @property
    def upper_inc(self) -> bool:
        """Return True if the upper bound is inclusive."""

        return self.bounds[1] == "]"

    @property
    def upper_inf(self) -> bool:
        """Return True if this range is non-empty and the upper bound is
        infinite."""

        return not self.empty and self.upper is None

    @property
    def __sa_type_engine__(self) -> AbstractRange[Range[_T]]:
        return AbstractRange()

    def _contains_value(self, value: _T) -> bool:
        """Return True if this range contains the given value."""

        if self.empty:
            return False

        if self.lower is None:
            return self.upper is None or (
                value < self.upper
                if self.bounds[1] == ")"
                else value <= self.upper
            )

        if self.upper is None:
            return (  # type: ignore
                value > self.lower
                if self.bounds[0] == "("
                else value >= self.lower
            )

        return (  # type: ignore
            value > self.lower
            if self.bounds[0] == "("
            else value >= self.lower
        ) and (
            value < self.upper
            if self.bounds[1] == ")"
            else value <= self.upper
        )

    def _get_discrete_step(self) -> Any:
        "Determine the “step” for this range, if it is a discrete one."

        # See
        # https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-DISCRETE
        # for the rationale

        if isinstance(self.lower, int) or isinstance(self.upper, int):
            return 1
        elif isinstance(self.lower, datetime) or isinstance(
            self.upper, datetime
        ):
            # This is required, because a `isinstance(datetime.now(), date)`
            # is True
            return None
        elif isinstance(self.lower, date) or isinstance(self.upper, date):
            return timedelta(days=1)
        else:
            return None

    def _compare_edges(
        self,
        value1: Optional[_T],
        bound1: str,
        value2: Optional[_T],
        bound2: str,
        only_values: bool = False,
    ) -> int:
        """Compare two range bounds.

        Return -1, 0 or 1 respectively when `value1` is less than,
        equal to or greater than `value2`.

        When `only_value` is ``True``, do not consider the *inclusivity*
        of the edges, just their values.
        """

        value1_is_lower_bound = bound1 in {"[", "("}
        value2_is_lower_bound = bound2 in {"[", "("}

        # Infinite edges are equal when they are on the same side,
        # otherwise a lower edge is considered less than the upper end
        if value1 is value2 is None:
            if value1_is_lower_bound == value2_is_lower_bound:
                return 0
            else:
                return -1 if value1_is_lower_bound else 1
        elif value1 is None:
            return -1 if value1_is_lower_bound else 1
        elif value2 is None:
            return 1 if value2_is_lower_bound else -1

        # Short path for trivial case
        if bound1 == bound2 and value1 == value2:
            return 0

        value1_inc = bound1 in {"[", "]"}
        value2_inc = bound2 in {"[", "]"}
        step = self._get_discrete_step()

        if step is not None:
            # "Normalize" the two edges as '[)', to simplify successive
            # logic when the range is discrete: otherwise we would need
            # to handle the comparison between ``(0`` and ``[1`` that
            # are equal when dealing with integers while for floats the
            # former is lesser than the latter

            if value1_is_lower_bound:
                if not value1_inc:
                    value1 += step
                    value1_inc = True
            else:
                if value1_inc:
                    value1 += step
                    value1_inc = False
            if value2_is_lower_bound:
                if not value2_inc:
                    value2 += step
                    value2_inc = True
            else:
                if value2_inc:
                    value2 += step
                    value2_inc = False

        if value1 < value2:  # type: ignore
            return -1
        elif value1 > value2:  # type: ignore
            return 1
        elif only_values:
            return 0
        else:
            # Neither one is infinite but are equal, so we
            # need to consider the respective inclusive/exclusive
            # flag

            if value1_inc and value2_inc:
                return 0
            elif not value1_inc and not value2_inc:
                if value1_is_lower_bound == value2_is_lower_bound:
                    return 0
                else:
                    return 1 if value1_is_lower_bound else -1
            elif not value1_inc:
                return 1 if value1_is_lower_bound else -1
            elif not value2_inc:
                return -1 if value2_is_lower_bound else 1
            else:
                return 0

    def __eq__(self, other: Any) -> bool:
        """Compare this range to the `other` taking into account
        bounds inclusivity, returning ``True`` if they are equal.
        """

        if not isinstance(other, Range):
            return NotImplemented

        if self.empty and other.empty:
            return True
        elif self.empty != other.empty:
            return False

        slower = self.lower
        slower_b = self.bounds[0]
        olower = other.lower
        olower_b = other.bounds[0]
        supper = self.upper
        supper_b = self.bounds[1]
        oupper = other.upper
        oupper_b = other.bounds[1]

        return (
            self._compare_edges(slower, slower_b, olower, olower_b) == 0
            and self._compare_edges(supper, supper_b, oupper, oupper_b) == 0
        )

    def contained_by(self, other: Range[_T]) -> bool:
        "Determine whether this range is a contained by `other`."

        # Any range contains the empty one
        if self.empty:
            return True

        # An empty range does not contain any range except the empty one
        if other.empty:
            return False

        slower = self.lower
        slower_b = self.bounds[0]
        olower = other.lower
        olower_b = other.bounds[0]

        if self._compare_edges(slower, slower_b, olower, olower_b) < 0:
            return False

        supper = self.upper
        supper_b = self.bounds[1]
        oupper = other.upper
        oupper_b = other.bounds[1]

        if self._compare_edges(supper, supper_b, oupper, oupper_b) > 0:
            return False

        return True

    def contains(self, value: Union[_T, Range[_T]]) -> bool:
        "Determine whether this range contains `value`."

        if isinstance(value, Range):
            return value.contained_by(self)
        else:
            return self._contains_value(value)

    def overlaps(self, other: Range[_T]) -> bool:
        "Determine whether this range overlaps with `other`."

        # Empty ranges never overlap with any other range
        if self.empty or other.empty:
            return False

        slower = self.lower
        slower_b = self.bounds[0]
        supper = self.upper
        supper_b = self.bounds[1]
        olower = other.lower
        olower_b = other.bounds[0]
        oupper = other.upper
        oupper_b = other.bounds[1]

        # Check whether this lower bound is contained in the other range
        if (
            self._compare_edges(slower, slower_b, olower, olower_b) >= 0
            and self._compare_edges(slower, slower_b, oupper, oupper_b) <= 0
        ):
            return True

        # Check whether other lower bound is contained in this range
        if (
            self._compare_edges(olower, olower_b, slower, slower_b) >= 0
            and self._compare_edges(olower, olower_b, supper, supper_b) <= 0
        ):
            return True

        return False

    def strictly_left_of(self, other: Range[_T]) -> bool:
        "Determine whether this range is completely to the left of `other`."

        # Empty ranges are neither to left nor to the right of any other range
        if self.empty or other.empty:
            return False

        supper = self.upper
        supper_b = self.bounds[1]
        olower = other.lower
        olower_b = other.bounds[0]

        # Check whether this upper edge is less than other's lower end
        return self._compare_edges(supper, supper_b, olower, olower_b) < 0

    __lshift__ = strictly_left_of

    def strictly_right_of(self, other: Range[_T]) -> bool:
        "Determine whether this range is completely to the right of `other`."

        # Empty ranges are neither to left nor to the right of any other range
        if self.empty or other.empty:
            return False

        slower = self.lower
        slower_b = self.bounds[0]
        oupper = other.upper
        oupper_b = other.bounds[1]

        # Check whether this lower edge is greater than other's upper end
        return self._compare_edges(slower, slower_b, oupper, oupper_b) > 0

    __rshift__ = strictly_right_of

    def not_extend_left_of(self, other: Range[_T]) -> bool:
        "Determine whether this does not extend to the left of `other`."

        # Empty ranges are neither to left nor to the right of any other range
        if self.empty or other.empty:
            return False

        slower = self.lower
        slower_b = self.bounds[0]
        olower = other.lower
        olower_b = other.bounds[0]

        # Check whether this lower edge is not less than other's lower end
        return self._compare_edges(slower, slower_b, olower, olower_b) >= 0

    def not_extend_right_of(self, other: Range[_T]) -> bool:
        "Determine whether this does not extend to the right of `other`."

        # Empty ranges are neither to left nor to the right of any other range
        if self.empty or other.empty:
            return False

        supper = self.upper
        supper_b = self.bounds[1]
        oupper = other.upper
        oupper_b = other.bounds[1]

        # Check whether this upper edge is not greater than other's upper end
        return self._compare_edges(supper, supper_b, oupper, oupper_b) <= 0

    def _upper_edge_adjacent_to_lower(
        self,
        value1: Optional[_T],
        bound1: str,
        value2: Optional[_T],
        bound2: str,
    ) -> bool:
        """Determine whether an upper bound is immediately successive to a
        lower bound."""

        # Since we need a peculiar way to handle the bounds inclusivity,
        # just do a comparison by value here
        res = self._compare_edges(value1, bound1, value2, bound2, True)
        if res == -1:
            step = self._get_discrete_step()
            if step is None:
                return False
            if bound1 == "]":
                if bound2 == "[":
                    return value1 == value2 - step  # type: ignore
                else:
                    return value1 == value2
            else:
                if bound2 == "[":
                    return value1 == value2
                else:
                    return value1 == value2 - step  # type: ignore
        elif res == 0:
            # Cover cases like [0,0] -|- [1,] and [0,2) -|- (1,3]
            if (
                bound1 == "]"
                and bound2 == "["
                or bound1 == ")"
                and bound2 == "("
            ):
                step = self._get_discrete_step()
                if step is not None:
                    return True
            return (
                bound1 == ")"
                and bound2 == "["
                or bound1 == "]"
                and bound2 == "("
            )
        else:
            return False

    def adjacent_to(self, other: Range[_T]) -> bool:
        "Determine whether this range is adjacent to the `other`."

        # Empty ranges are not adjacent to any other range
        if self.empty or other.empty:
            return False

        slower = self.lower
        slower_b = self.bounds[0]
        supper = self.upper
        supper_b = self.bounds[1]
        olower = other.lower
        olower_b = other.bounds[0]
        oupper = other.upper
        oupper_b = other.bounds[1]

        return self._upper_edge_adjacent_to_lower(
            supper, supper_b, olower, olower_b
        ) or self._upper_edge_adjacent_to_lower(
            oupper, oupper_b, slower, slower_b
        )

    def union(self, other: Range[_T]) -> Range[_T]:
        """Compute the union of this range with the `other`.

        This raises a ``ValueError`` exception if the two ranges are
        "disjunct", that is neither adjacent nor overlapping.
        """

        # Empty ranges are "additive identities"
        if self.empty:
            return other
        if other.empty:
            return self

        if not self.overlaps(other) and not self.adjacent_to(other):
            raise ValueError(
                "Adding non-overlapping and non-adjacent"
                " ranges is not implemented"
            )

        slower = self.lower
        slower_b = self.bounds[0]
        supper = self.upper
        supper_b = self.bounds[1]
        olower = other.lower
        olower_b = other.bounds[0]
        oupper = other.upper
        oupper_b = other.bounds[1]

        if self._compare_edges(slower, slower_b, olower, olower_b) < 0:
            rlower = slower
            rlower_b = slower_b
        else:
            rlower = olower
            rlower_b = olower_b

        if self._compare_edges(supper, supper_b, oupper, oupper_b) > 0:
            rupper = supper
            rupper_b = supper_b
        else:
            rupper = oupper
            rupper_b = oupper_b

        return Range(
            rlower, rupper, bounds=cast(_BoundsType, rlower_b + rupper_b)
        )

    def __add__(self, other: Range[_T]) -> Range[_T]:
        return self.union(other)

    def difference(self, other: Range[_T]) -> Range[_T]:
        """Compute the difference between this range and the `other`.

        This raises a ``ValueError`` exception if the two ranges are
        "disjunct", that is neither adjacent nor overlapping.
        """

        # Subtracting an empty range is a no-op
        if self.empty or other.empty:
            return self

        slower = self.lower
        slower_b = self.bounds[0]
        supper = self.upper
        supper_b = self.bounds[1]
        olower = other.lower
        olower_b = other.bounds[0]
        oupper = other.upper
        oupper_b = other.bounds[1]

        sl_vs_ol = self._compare_edges(slower, slower_b, olower, olower_b)
        su_vs_ou = self._compare_edges(supper, supper_b, oupper, oupper_b)
        if sl_vs_ol < 0 and su_vs_ou > 0:
            raise ValueError(
                "Subtracting a strictly inner range is not implemented"
            )

        sl_vs_ou = self._compare_edges(slower, slower_b, oupper, oupper_b)
        su_vs_ol = self._compare_edges(supper, supper_b, olower, olower_b)

        # If the ranges do not overlap, result is simply the first
        if sl_vs_ou > 0 or su_vs_ol < 0:
            return self

        # If this range is completely contained by the other, result is empty
        if sl_vs_ol >= 0 and su_vs_ou <= 0:
            return Range(None, None, empty=True)

        # If this range extends to the left of the other and ends in its
        # middle
        if sl_vs_ol <= 0 and su_vs_ol >= 0 and su_vs_ou <= 0:
            rupper_b = ")" if olower_b == "[" else "]"
            if (
                slower_b != "["
                and rupper_b != "]"
                and self._compare_edges(slower, slower_b, olower, rupper_b)
                == 0
            ):
                return Range(None, None, empty=True)
            else:
                return Range(
                    slower,
                    olower,
                    bounds=cast(_BoundsType, slower_b + rupper_b),
                )

        # If this range starts in the middle of the other and extends to its
        # right
        if sl_vs_ol >= 0 and su_vs_ou >= 0 and sl_vs_ou <= 0:
            rlower_b = "(" if oupper_b == "]" else "["
            if (
                rlower_b != "["
                and supper_b != "]"
                and self._compare_edges(oupper, rlower_b, supper, supper_b)
                == 0
            ):
                return Range(None, None, empty=True)
            else:
                return Range(
                    oupper,
                    supper,
                    bounds=cast(_BoundsType, rlower_b + supper_b),
                )

        assert False, f"Unhandled case computing {self} - {other}"

    def __sub__(self, other: Range[_T]) -> Range[_T]:
        return self.difference(other)

    def intersection(self, other: Range[_T]) -> Range[_T]:
        """Compute the intersection of this range with the `other`.

        .. versionadded:: 2.0.10

        """
        if self.empty or other.empty or not self.overlaps(other):
            return Range(None, None, empty=True)

        slower = self.lower
        slower_b = self.bounds[0]
        supper = self.upper
        supper_b = self.bounds[1]
        olower = other.lower
        olower_b = other.bounds[0]
        oupper = other.upper
        oupper_b = other.bounds[1]

        if self._compare_edges(slower, slower_b, olower, olower_b) < 0:
            rlower = olower
            rlower_b = olower_b
        else:
            rlower = slower
            rlower_b = slower_b

        if self._compare_edges(supper, supper_b, oupper, oupper_b) > 0:
            rupper = oupper
            rupper_b = oupper_b
        else:
            rupper = supper
            rupper_b = supper_b

        return Range(
            rlower,
            rupper,
            bounds=cast(_BoundsType, rlower_b + rupper_b),
        )

    def __mul__(self, other: Range[_T]) -> Range[_T]:
        return self.intersection(other)

    def __str__(self) -> str:
        return self._stringify()

    def _stringify(self) -> str:
        if self.empty:
            return "empty"

        l, r = self.lower, self.upper
        l = "" if l is None else l  # type: ignore
        r = "" if r is None else r  # type: ignore

        b0, b1 = cast("Tuple[str, str]", self.bounds)

        return f"{b0}{l},{r}{b1}"


class AbstractRange(sqltypes.TypeEngine[Range[_T]]):
    """
    Base for PostgreSQL RANGE types.

    .. seealso::

        `PostgreSQL range functions <https://www.postgresql.org/docs/current/static/functions-range.html>`_

    """  # noqa: E501

    render_bind_cast = True

    __abstract__ = True

    @overload
    def adapt(self, cls: Type[_TE], **kw: Any) -> _TE:
        ...

    @overload
    def adapt(self, cls: Type[TypeEngineMixin], **kw: Any) -> TypeEngine[Any]:
        ...

    def adapt(
        self,
        cls: Type[Union[TypeEngine[Any], TypeEngineMixin]],
        **kw: Any,
    ) -> TypeEngine[Any]:
        """Dynamically adapt a range type to an abstract impl.

        For example ``INT4RANGE().adapt(_Psycopg2NumericRange)`` should
        produce a type that will have ``_Psycopg2NumericRange`` behaviors
        and also render as ``INT4RANGE`` in SQL and DDL.

        """
        if issubclass(cls, AbstractRangeImpl) and cls is not self.__class__:
            # two ways to do this are:  1. create a new type on the fly
            # or 2. have AbstractRangeImpl(visit_name) constructor and a
            # visit_abstract_range_impl() method in the PG compiler.
            # I'm choosing #1 as the resulting type object
            # will then make use of the same mechanics
            # as if we had made all these sub-types explicitly, and will
            # also look more obvious under pdb etc.
            # The adapt() operation here is cached per type-class-per-dialect,
            # so is not much of a performance concern
            visit_name = self.__visit_name__
            return type(  # type: ignore
                f"{visit_name}RangeImpl",
                (cls, self.__class__),
                {"__visit_name__": visit_name},
            )()
        else:
            return super().adapt(cls)

    def _resolve_for_literal(self, value: Any) -> Any:
        spec = value.lower if value.lower is not None else value.upper

        if isinstance(spec, int):
            return INT8RANGE()
        elif isinstance(spec, (Decimal, float)):
            return NUMRANGE()
        elif isinstance(spec, datetime):
            return TSRANGE() if not spec.tzinfo else TSTZRANGE()
        elif isinstance(spec, date):
            return DATERANGE()
        else:
            # empty Range, SQL datatype can't be determined here
            return sqltypes.NULLTYPE

    class comparator_factory(TypeEngine.Comparator[Range[Any]]):
        """Define comparison operations for range types."""

        def contains(self, other: Any, **kw: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the right hand operand,
            which can be an element or a range, is contained within the
            column.

            kwargs may be ignored by this operator but are required for API
            conformance.
            """
            return self.expr.operate(CONTAINS, other)

        def contained_by(self, other: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the column is contained
            within the right hand operand.
            """
            return self.expr.operate(CONTAINED_BY, other)

        def overlaps(self, other: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the column overlaps
            (has points in common with) the right hand operand.
            """
            return self.expr.operate(OVERLAP, other)

        def strictly_left_of(self, other: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the column is strictly
            left of the right hand operand.
            """
            return self.expr.operate(STRICTLY_LEFT_OF, other)

        __lshift__ = strictly_left_of

        def strictly_right_of(self, other: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the column is strictly
            right of the right hand operand.
            """
            return self.expr.operate(STRICTLY_RIGHT_OF, other)

        __rshift__ = strictly_right_of

        def not_extend_right_of(self, other: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the range in the column
            does not extend right of the range in the operand.
            """
            return self.expr.operate(NOT_EXTEND_RIGHT_OF, other)

        def not_extend_left_of(self, other: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the range in the column
            does not extend left of the range in the operand.
            """
            return self.expr.operate(NOT_EXTEND_LEFT_OF, other)

        def adjacent_to(self, other: Any) -> ColumnElement[bool]:
            """Boolean expression. Returns true if the range in the column
            is adjacent to the range in the operand.
            """
            return self.expr.operate(ADJACENT_TO, other)

        def union(self, other: Any) -> ColumnElement[bool]:
            """Range expression. Returns the union of the two ranges.
            Will raise an exception if the resulting range is not
            contiguous.
            """
            return self.expr.operate(operators.add, other)

        def difference(self, other: Any) -> ColumnElement[bool]:
            """Range expression. Returns the union of the two ranges.
            Will raise an exception if the resulting range is not
            contiguous.
            """
            return self.expr.operate(operators.sub, other)

        def intersection(self, other: Any) -> ColumnElement[Range[_T]]:
            """Range expression. Returns the intersection of the two ranges.
            Will raise an exception if the resulting range is not
            contiguous.
            """
            return self.expr.operate(operators.mul, other)


class AbstractRangeImpl(AbstractRange[Range[_T]]):
    """Marker for AbstractRange that will apply a subclass-specific
    adaptation"""


class AbstractMultiRange(AbstractRange[Range[_T]]):
    """base for PostgreSQL MULTIRANGE types"""

    __abstract__ = True


class AbstractMultiRangeImpl(
    AbstractRangeImpl[Range[_T]], AbstractMultiRange[Range[_T]]
):
    """Marker for AbstractRange that will apply a subclass-specific
    adaptation"""


class INT4RANGE(AbstractRange[Range[int]]):
    """Represent the PostgreSQL INT4RANGE type."""

    __visit_name__ = "INT4RANGE"


class INT8RANGE(AbstractRange[Range[int]]):
    """Represent the PostgreSQL INT8RANGE type."""

    __visit_name__ = "INT8RANGE"


class NUMRANGE(AbstractRange[Range[Decimal]]):
    """Represent the PostgreSQL NUMRANGE type."""

    __visit_name__ = "NUMRANGE"


class DATERANGE(AbstractRange[Range[date]]):
    """Represent the PostgreSQL DATERANGE type."""

    __visit_name__ = "DATERANGE"


class TSRANGE(AbstractRange[Range[datetime]]):
    """Represent the PostgreSQL TSRANGE type."""

    __visit_name__ = "TSRANGE"


class TSTZRANGE(AbstractRange[Range[datetime]]):
    """Represent the PostgreSQL TSTZRANGE type."""

    __visit_name__ = "TSTZRANGE"


class INT4MULTIRANGE(AbstractMultiRange[Range[int]]):
    """Represent the PostgreSQL INT4MULTIRANGE type."""

    __visit_name__ = "INT4MULTIRANGE"


class INT8MULTIRANGE(AbstractMultiRange[Range[int]]):
    """Represent the PostgreSQL INT8MULTIRANGE type."""

    __visit_name__ = "INT8MULTIRANGE"


class NUMMULTIRANGE(AbstractMultiRange[Range[Decimal]]):
    """Represent the PostgreSQL NUMMULTIRANGE type."""

    __visit_name__ = "NUMMULTIRANGE"


class DATEMULTIRANGE(AbstractMultiRange[Range[date]]):
    """Represent the PostgreSQL DATEMULTIRANGE type."""

    __visit_name__ = "DATEMULTIRANGE"


class TSMULTIRANGE(AbstractMultiRange[Range[datetime]]):
    """Represent the PostgreSQL TSRANGE type."""

    __visit_name__ = "TSMULTIRANGE"


class TSTZMULTIRANGE(AbstractMultiRange[Range[datetime]]):
    """Represent the PostgreSQL TSTZRANGE type."""

    __visit_name__ = "TSTZMULTIRANGE"
