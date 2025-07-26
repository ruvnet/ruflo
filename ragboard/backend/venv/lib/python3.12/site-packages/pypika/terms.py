import inspect
import re
import uuid
from datetime import date
from enum import Enum
from typing import TYPE_CHECKING, Any, Iterable, Iterator, List, Optional, Sequence, Set, Type, TypeVar, Union

from pypika.enums import Arithmetic, Boolean, Comparator, Dialects, Equality, JSONOperators, Matching, Order
from pypika.utils import (
    CaseException,
    FunctionException,
    builder,
    format_alias_sql,
    format_quotes,
    ignore_copy,
    resolve_is_aggregate,
)

if TYPE_CHECKING:
    from pypika.queries import QueryBuilder, Selectable, Table


__author__ = "Timothy Heys"
__email__ = "theys@kayak.com"


NodeT = TypeVar("NodeT", bound="Node")


class Node:
    is_aggregate = None

    def nodes_(self) -> Iterator[NodeT]:
        yield self

    def find_(self, type: Type[NodeT]) -> List[NodeT]:
        return [node for node in self.nodes_() if isinstance(node, type)]


class Term(Node):
    is_aggregate = False

    def __init__(self, alias: Optional[str] = None) -> None:
        self.alias = alias

    @builder
    def as_(self, alias: str) -> "Term":
        self.alias = alias

    @property
    def tables_(self) -> Set["Table"]:
        from pypika import Table

        return set(self.find_(Table))

    def fields_(self) -> Set["Field"]:
        return set(self.find_(Field))

    @staticmethod
    def wrap_constant(
        val, wrapper_cls: Optional[Type["Term"]] = None
    ) -> Union[ValueError, NodeT, "LiteralValue", "Array", "Tuple", "ValueWrapper"]:
        """
        Used for wrapping raw inputs such as numbers in Criterions and Operator.

        For example, the expression F('abc')+1 stores the integer part in a ValueWrapper object.

        :param val:
            Any value.
        :param wrapper_cls:
            A pypika class which wraps a constant value so it can be handled as a component of the query.
        :return:
            Raw string, number, or decimal values will be returned in a ValueWrapper.  Fields and other parts of the
            querybuilder will be returned as inputted.

        """

        if isinstance(val, Node):
            return val
        if val is None:
            return NullValue()
        if isinstance(val, list):
            return Array(*val)
        if isinstance(val, tuple):
            return Tuple(*val)

        # Need to default here to avoid the recursion. ValueWrapper extends this class.
        wrapper_cls = wrapper_cls or ValueWrapper
        return wrapper_cls(val)

    @staticmethod
    def wrap_json(
        val: Union["Term", "QueryBuilder", "Interval", None, str, int, bool], wrapper_cls=None
    ) -> Union["Term", "QueryBuilder", "Interval", "NullValue", "ValueWrapper", "JSON"]:
        from .queries import QueryBuilder

        if isinstance(val, (Term, QueryBuilder, Interval)):
            return val
        if val is None:
            return NullValue()
        if isinstance(val, (str, int, bool)):
            wrapper_cls = wrapper_cls or ValueWrapper
            return wrapper_cls(val)

        return JSON(val)

    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "Term":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.
        The base implementation returns self because not all terms have a table property.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            Self.
        """
        return self

    def eq(self, other: Any) -> "BasicCriterion":
        return self == other

    def isnull(self) -> "NullCriterion":
        return NullCriterion(self)

    def notnull(self) -> "Not":
        return self.isnull().negate()

    def isnotnull(self) -> 'NotNullCriterion':
        return NotNullCriterion(self)

    def bitwiseand(self, value: int) -> "BitwiseAndCriterion":
        return BitwiseAndCriterion(self, self.wrap_constant(value))

    def gt(self, other: Any) -> "BasicCriterion":
        return self > other

    def gte(self, other: Any) -> "BasicCriterion":
        return self >= other

    def lt(self, other: Any) -> "BasicCriterion":
        return self < other

    def lte(self, other: Any) -> "BasicCriterion":
        return self <= other

    def ne(self, other: Any) -> "BasicCriterion":
        return self != other

    def glob(self, expr: str) -> "BasicCriterion":
        return BasicCriterion(Matching.glob, self, self.wrap_constant(expr))

    def like(self, expr: str) -> "BasicCriterion":
        return BasicCriterion(Matching.like, self, self.wrap_constant(expr))

    def not_like(self, expr: str) -> "BasicCriterion":
        return BasicCriterion(Matching.not_like, self, self.wrap_constant(expr))

    def ilike(self, expr: str) -> "BasicCriterion":
        return BasicCriterion(Matching.ilike, self, self.wrap_constant(expr))

    def not_ilike(self, expr: str) -> "BasicCriterion":
        return BasicCriterion(Matching.not_ilike, self, self.wrap_constant(expr))

    def rlike(self, expr: str) -> "BasicCriterion":
        return BasicCriterion(Matching.rlike, self, self.wrap_constant(expr))

    def regex(self, pattern: str) -> "BasicCriterion":
        return BasicCriterion(Matching.regex, self, self.wrap_constant(pattern))

    def regexp(self, pattern: str) -> "BasicCriterion":
        return BasicCriterion(Matching.regexp, self, self.wrap_constant(pattern))

    def between(self, lower: Any, upper: Any) -> "BetweenCriterion":
        return BetweenCriterion(self, self.wrap_constant(lower), self.wrap_constant(upper))

    def from_to(self, start: Any, end: Any) -> "PeriodCriterion":
        return PeriodCriterion(self, self.wrap_constant(start), self.wrap_constant(end))

    def as_of(self, expr: str) -> "BasicCriterion":
        return BasicCriterion(Matching.as_of, self, self.wrap_constant(expr))

    def all_(self) -> "All":
        return All(self)

    def isin(self, arg: Union[list, tuple, set, "Term"]) -> "ContainsCriterion":
        if isinstance(arg, (list, tuple, set)):
            return ContainsCriterion(self, Tuple(*[self.wrap_constant(value) for value in arg]))
        return ContainsCriterion(self, arg)

    def notin(self, arg: Union[list, tuple, set, "Term"]) -> "ContainsCriterion":
        return self.isin(arg).negate()

    def bin_regex(self, pattern: str) -> "BasicCriterion":
        return BasicCriterion(Matching.bin_regex, self, self.wrap_constant(pattern))

    def negate(self) -> "Not":
        return Not(self)

    def lshift(self, other: Any) -> "ArithmeticExpression":
        return self << other

    def rshift(self, other: Any) -> "ArithmeticExpression":
        return self >> other

    def __invert__(self) -> "Not":
        return Not(self)

    def __pos__(self) -> "Term":
        return self

    def __neg__(self) -> "Negative":
        return Negative(self)

    def __add__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.add, self, self.wrap_constant(other))

    def __sub__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.sub, self, self.wrap_constant(other))

    def __mul__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.mul, self, self.wrap_constant(other))

    def __truediv__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.div, self, self.wrap_constant(other))

    def __pow__(self, other: Any) -> "Pow":
        return Pow(self, other)

    def __mod__(self, other: Any) -> "Mod":
        return Mod(self, other)

    def __radd__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.add, self.wrap_constant(other), self)

    def __rsub__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.sub, self.wrap_constant(other), self)

    def __rmul__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.mul, self.wrap_constant(other), self)

    def __rtruediv__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.div, self.wrap_constant(other), self)

    def __lshift__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.lshift, self, self.wrap_constant(other))

    def __rshift__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.rshift, self, self.wrap_constant(other))

    def __rlshift__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.lshift, self.wrap_constant(other), self)

    def __rrshift__(self, other: Any) -> "ArithmeticExpression":
        return ArithmeticExpression(Arithmetic.rshift, self.wrap_constant(other), self)

    def __eq__(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(Equality.eq, self, self.wrap_constant(other))

    def __ne__(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(Equality.ne, self, self.wrap_constant(other))

    def __gt__(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(Equality.gt, self, self.wrap_constant(other))

    def __ge__(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(Equality.gte, self, self.wrap_constant(other))

    def __lt__(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(Equality.lt, self, self.wrap_constant(other))

    def __le__(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(Equality.lte, self, self.wrap_constant(other))

    def __getitem__(self, item: slice) -> "BetweenCriterion":
        if not isinstance(item, slice):
            raise TypeError("Field' object is not subscriptable")
        return self.between(item.start, item.stop)

    def __str__(self) -> str:
        return self.get_sql(quote_char='"', secondary_quote_char="'")

    def __hash__(self) -> int:
        return hash(self.get_sql(with_alias=True, with_namespace=True))

    def get_sql(self, **kwargs: Any) -> str:
        raise NotImplementedError()


class Parameter(Term):
    is_aggregate = None

    def __init__(self, placeholder: Union[str, int]) -> None:
        super().__init__()
        self.placeholder = placeholder

    def get_sql(self, **kwargs: Any) -> str:
        return str(self.placeholder)


class QmarkParameter(Parameter):
    """Question mark style, e.g. ...WHERE name=?"""

    def __init__(self) -> None:
        pass

    def get_sql(self, **kwargs: Any) -> str:
        return "?"


class NumericParameter(Parameter):
    """Numeric, positional style, e.g. ...WHERE name=:1"""

    def get_sql(self, **kwargs: Any) -> str:
        return ":{placeholder}".format(placeholder=self.placeholder)


class NamedParameter(Parameter):
    """Named style, e.g. ...WHERE name=:name"""

    def get_sql(self, **kwargs: Any) -> str:
        return ":{placeholder}".format(placeholder=self.placeholder)


class FormatParameter(Parameter):
    """ANSI C printf format codes, e.g. ...WHERE name=%s"""

    def __init__(self) -> None:
        pass

    def get_sql(self, **kwargs: Any) -> str:
        return "%s"


class PyformatParameter(Parameter):
    """Python extended format codes, e.g. ...WHERE name=%(name)s"""

    def get_sql(self, **kwargs: Any) -> str:
        return "%({placeholder})s".format(placeholder=self.placeholder)


class Negative(Term):
    def __init__(self, term: Term) -> None:
        super().__init__()
        self.term = term

    @property
    def is_aggregate(self) -> Optional[bool]:
        return self.term.is_aggregate

    def get_sql(self, **kwargs: Any) -> str:
        return "-{term}".format(term=self.term.get_sql(**kwargs))


class ValueWrapper(Term):
    is_aggregate = None

    def __init__(self, value: Any, alias: Optional[str] = None) -> None:
        super().__init__(alias)
        self.value = value

    def get_value_sql(self, **kwargs: Any) -> str:
        return self.get_formatted_value(self.value, **kwargs)

    @classmethod
    def get_formatted_value(cls, value: Any, **kwargs):
        quote_char = kwargs.get("secondary_quote_char") or ""

        # FIXME escape values
        if isinstance(value, Term):
            return value.get_sql(**kwargs)
        if isinstance(value, Enum):
            return cls.get_formatted_value(value.value, **kwargs)
        if isinstance(value, date):
            return cls.get_formatted_value(value.isoformat(), **kwargs)
        if isinstance(value, str):
            value = value.replace(quote_char, quote_char * 2)
            return format_quotes(value, quote_char)
        if isinstance(value, bool):
            return str.lower(str(value))
        if isinstance(value, uuid.UUID):
            return cls.get_formatted_value(str(value), **kwargs)
        if value is None:
            return "null"
        return str(value)

    def get_sql(self, quote_char: Optional[str] = None, secondary_quote_char: str = "'", **kwargs: Any) -> str:
        sql = self.get_value_sql(quote_char=quote_char, secondary_quote_char=secondary_quote_char, **kwargs)
        return format_alias_sql(sql, self.alias, quote_char=quote_char, **kwargs)


class JSON(Term):
    table = None

    def __init__(self, value: Any = None, alias: Optional[str] = None) -> None:
        super().__init__(alias)
        self.value = value

    def _recursive_get_sql(self, value: Any, **kwargs: Any) -> str:
        if isinstance(value, dict):
            return self._get_dict_sql(value, **kwargs)
        if isinstance(value, list):
            return self._get_list_sql(value, **kwargs)
        if isinstance(value, str):
            return self._get_str_sql(value, **kwargs)
        return str(value)

    def _get_dict_sql(self, value: dict, **kwargs: Any) -> str:
        pairs = [
            "{key}:{value}".format(
                key=self._recursive_get_sql(k, **kwargs),
                value=self._recursive_get_sql(v, **kwargs),
            )
            for k, v in value.items()
        ]
        return "".join(["{", ",".join(pairs), "}"])

    def _get_list_sql(self, value: list, **kwargs: Any) -> str:
        pairs = [self._recursive_get_sql(v, **kwargs) for v in value]
        return "".join(["[", ",".join(pairs), "]"])

    @staticmethod
    def _get_str_sql(value: str, quote_char: str = '"', **kwargs: Any) -> str:
        return format_quotes(value, quote_char)

    def get_sql(self, secondary_quote_char: str = "'", **kwargs: Any) -> str:
        sql = format_quotes(self._recursive_get_sql(self.value), secondary_quote_char)
        return format_alias_sql(sql, self.alias, **kwargs)

    def get_json_value(self, key_or_index: Union[str, int]) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.GET_JSON_VALUE, self, self.wrap_constant(key_or_index))

    def get_text_value(self, key_or_index: Union[str, int]) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.GET_TEXT_VALUE, self, self.wrap_constant(key_or_index))

    def get_path_json_value(self, path_json: str) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.GET_PATH_JSON_VALUE, self, self.wrap_json(path_json))

    def get_path_text_value(self, path_json: str) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.GET_PATH_TEXT_VALUE, self, self.wrap_json(path_json))

    def has_key(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.HAS_KEY, self, self.wrap_json(other))

    def contains(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.CONTAINS, self, self.wrap_json(other))

    def contained_by(self, other: Any) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.CONTAINED_BY, self, self.wrap_json(other))

    def has_keys(self, other: Iterable) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.HAS_KEYS, self, Array(*other))

    def has_any_keys(self, other: Iterable) -> "BasicCriterion":
        return BasicCriterion(JSONOperators.HAS_ANY_KEYS, self, Array(*other))


class Values(Term):
    def __init__(self, field: Union[str, "Field"]) -> None:
        super().__init__(None)
        self.field = Field(field) if not isinstance(field, Field) else field

    def get_sql(self, quote_char: Optional[str] = None, **kwargs: Any) -> str:
        return "VALUES({value})".format(value=self.field.get_sql(quote_char=quote_char, **kwargs))


class LiteralValue(Term):
    def __init__(self, value, alias: Optional[str] = None) -> None:
        super().__init__(alias)
        self._value = value

    def get_sql(self, **kwargs: Any) -> str:
        return format_alias_sql(self._value, self.alias, **kwargs)


class NullValue(LiteralValue):
    def __init__(self, alias: Optional[str] = None) -> None:
        super().__init__("NULL", alias)


class SystemTimeValue(LiteralValue):
    def __init__(self, alias: Optional[str] = None) -> None:
        super().__init__("SYSTEM_TIME", alias)


class Criterion(Term):
    def __and__(self, other: Any) -> "ComplexCriterion":
        return ComplexCriterion(Boolean.and_, self, other)

    def __or__(self, other: Any) -> "ComplexCriterion":
        return ComplexCriterion(Boolean.or_, self, other)

    def __xor__(self, other: Any) -> "ComplexCriterion":
        return ComplexCriterion(Boolean.xor_, self, other)

    @staticmethod
    def any(terms: Iterable[Term] = ()) -> "EmptyCriterion":
        crit = EmptyCriterion()

        for term in terms:
            crit |= term

        return crit

    @staticmethod
    def all(terms: Iterable[Any] = ()) -> "EmptyCriterion":
        crit = EmptyCriterion()

        for term in terms:
            crit &= term

        return crit

    def get_sql(self) -> str:
        raise NotImplementedError()


class EmptyCriterion(Criterion):
    is_aggregate = None
    tables_ = set()

    def fields_(self) -> Set["Field"]:
        return set()

    def __and__(self, other: Any) -> Any:
        return other

    def __or__(self, other: Any) -> Any:
        return other

    def __xor__(self, other: Any) -> Any:
        return other


class Field(Criterion, JSON):
    def __init__(
        self, name: str, alias: Optional[str] = None, table: Optional[Union[str, "Selectable"]] = None
    ) -> None:
        super().__init__(alias=alias)
        self.name = name
        self.table = table

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        if self.table is not None:
            yield from self.table.nodes_()

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "Field":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the field with the tables replaced.
        """
        self.table = new_table if self.table == current_table else self.table

    def get_sql(self, **kwargs: Any) -> str:
        with_alias = kwargs.pop("with_alias", False)
        with_namespace = kwargs.pop("with_namespace", False)
        quote_char = kwargs.pop("quote_char", None)

        field_sql = format_quotes(self.name, quote_char)

        # Need to add namespace if the table has an alias
        if self.table and (with_namespace or self.table.alias):
            table_name = self.table.get_table_name()
            field_sql = "{namespace}.{name}".format(
                namespace=format_quotes(table_name, quote_char),
                name=field_sql,
            )

        field_alias = getattr(self, "alias", None)
        if with_alias:
            return format_alias_sql(field_sql, field_alias, quote_char=quote_char, **kwargs)
        return field_sql


class Index(Term):
    def __init__(self, name: str, alias: Optional[str] = None) -> None:
        super().__init__(alias)
        self.name = name

    def get_sql(self, quote_char: Optional[str] = None, **kwargs: Any) -> str:
        return format_quotes(self.name, quote_char)


class Star(Field):
    def __init__(self, table: Optional[Union[str, "Selectable"]] = None) -> None:
        super().__init__("*", table=table)

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        if self.table is not None:
            yield from self.table.nodes_()

    def get_sql(
        self, with_alias: bool = False, with_namespace: bool = False, quote_char: Optional[str] = None, **kwargs: Any
    ) -> str:
        if self.table and (with_namespace or self.table.alias):
            namespace = self.table.alias or getattr(self.table, "_table_name")
            return "{}.*".format(format_quotes(namespace, quote_char))

        return "*"


class Tuple(Criterion):
    def __init__(self, *values: Any) -> None:
        super().__init__()
        self.values = [self.wrap_constant(value) for value in values]

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        for value in self.values:
            yield from value.nodes_()

    def get_sql(self, **kwargs: Any) -> str:
        sql = "({})".format(",".join(term.get_sql(**kwargs) for term in self.values))
        return format_alias_sql(sql, self.alias, **kwargs)

    @property
    def is_aggregate(self) -> bool:
        return resolve_is_aggregate([val.is_aggregate for val in self.values])

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "Tuple":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the field with the tables replaced.
        """
        self.values = [value.replace_table(current_table, new_table) for value in self.values]


class Array(Tuple):
    def get_sql(self, **kwargs: Any) -> str:
        dialect = kwargs.get("dialect", None)
        values = ",".join(term.get_sql(**kwargs) for term in self.values)

        sql = "[{}]".format(values)
        if dialect in (Dialects.POSTGRESQL, Dialects.REDSHIFT):
            sql = "ARRAY[{}]".format(values) if len(values) > 0 else "'{}'"

        return format_alias_sql(sql, self.alias, **kwargs)


class Bracket(Tuple):
    def __init__(self, term: Any) -> None:
        super().__init__(term)


class NestedCriterion(Criterion):
    def __init__(
        self,
        comparator: Comparator,
        nested_comparator: "ComplexCriterion",
        left: Any,
        right: Any,
        nested: Any,
        alias: Optional[str] = None,
    ) -> None:
        super().__init__(alias)
        self.left = left
        self.comparator = comparator
        self.nested_comparator = nested_comparator
        self.right = right
        self.nested = nested

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.right.nodes_()
        yield from self.left.nodes_()
        yield from self.nested.nodes_()

    @property
    def is_aggregate(self) -> Optional[bool]:
        return resolve_is_aggregate([term.is_aggregate for term in [self.left, self.right, self.nested]])

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "NestedCriterion":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.left = self.left.replace_table(current_table, new_table)
        self.right = self.right.replace_table(current_table, new_table)
        self.nested = self.right.replace_table(current_table, new_table)

    def get_sql(self, with_alias: bool = False, **kwargs: Any) -> str:
        sql = "{left}{comparator}{right}{nested_comparator}{nested}".format(
            left=self.left.get_sql(**kwargs),
            comparator=self.comparator.value,
            right=self.right.get_sql(**kwargs),
            nested_comparator=self.nested_comparator.value,
            nested=self.nested.get_sql(**kwargs),
        )

        if with_alias:
            return format_alias_sql(sql=sql, alias=self.alias, **kwargs)

        return sql


class BasicCriterion(Criterion):
    def __init__(self, comparator: Comparator, left: Term, right: Term, alias: Optional[str] = None) -> None:
        """
        A wrapper for a basic criterion such as equality or inequality. This wraps three parts, a left and right term
        and a comparator which defines the type of comparison.


        :param comparator:
            Type: Comparator
            This defines the type of comparison, such as {quote}={quote} or {quote}>{quote}.
        :param left:
            The term on the left side of the expression.
        :param right:
            The term on the right side of the expression.
        """
        super().__init__(alias)
        self.comparator = comparator
        self.left = left
        self.right = right

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.right.nodes_()
        yield from self.left.nodes_()

    @property
    def is_aggregate(self) -> Optional[bool]:
        return resolve_is_aggregate([term.is_aggregate for term in [self.left, self.right]])

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "BasicCriterion":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.left = self.left.replace_table(current_table, new_table)
        self.right = self.right.replace_table(current_table, new_table)

    def get_sql(self, quote_char: str = '"', with_alias: bool = False, **kwargs: Any) -> str:
        sql = "{left}{comparator}{right}".format(
            comparator=self.comparator.value,
            left=self.left.get_sql(quote_char=quote_char, **kwargs),
            right=self.right.get_sql(quote_char=quote_char, **kwargs),
        )
        if with_alias:
            return format_alias_sql(sql, self.alias, **kwargs)
        return sql


class ContainsCriterion(Criterion):
    def __init__(self, term: Any, container: Term, alias: Optional[str] = None) -> None:
        """
        A wrapper for a "IN" criterion.  This wraps two parts, a term and a container.  The term is the part of the
        expression that is checked for membership in the container.  The container can either be a list or a subquery.


        :param term:
            The term to assert membership for within the container.
        :param container:
            A list or subquery.
        """
        super().__init__(alias)
        self.term = term
        self.container = container
        self._is_negated = False

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.term.nodes_()
        yield from self.container.nodes_()

    @property
    def is_aggregate(self) -> Optional[bool]:
        return self.term.is_aggregate

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "ContainsCriterion":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.term = self.term.replace_table(current_table, new_table)

    def get_sql(self, subquery: Any = None, **kwargs: Any) -> str:
        sql = "{term} {not_}IN {container}".format(
            term=self.term.get_sql(**kwargs),
            container=self.container.get_sql(subquery=True, **kwargs),
            not_="NOT " if self._is_negated else "",
        )
        return format_alias_sql(sql, self.alias, **kwargs)

    @builder
    def negate(self) -> "ContainsCriterion":
        self._is_negated = True


class ExistsCriterion(Criterion):
    def __init__(self, container, alias=None):
        super(ExistsCriterion, self).__init__(alias)
        self.container = container
        self._is_negated = False

    def get_sql(self, **kwargs):
        # FIXME escape
        return "{not_}EXISTS {container}".format(
            container=self.container.get_sql(**kwargs), not_='NOT ' if self._is_negated else ''
        )

    def negate(self):
        self._is_negated = True
        return self


class RangeCriterion(Criterion):
    def __init__(self, term: Term, start: Any, end: Any, alias: Optional[str] = None) -> str:
        super().__init__(alias)
        self.term = term
        self.start = start
        self.end = end

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.term.nodes_()
        yield from self.start.nodes_()
        yield from self.end.nodes_()

    @property
    def is_aggregate(self) -> Optional[bool]:
        return self.term.is_aggregate


class BetweenCriterion(RangeCriterion):
    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "BetweenCriterion":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.term = self.term.replace_table(current_table, new_table)

    def get_sql(self, **kwargs: Any) -> str:
        # FIXME escape
        sql = "{term} BETWEEN {start} AND {end}".format(
            term=self.term.get_sql(**kwargs),
            start=self.start.get_sql(**kwargs),
            end=self.end.get_sql(**kwargs),
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class PeriodCriterion(RangeCriterion):
    def get_sql(self, **kwargs: Any) -> str:
        sql = "{term} FROM {start} TO {end}".format(
            term=self.term.get_sql(**kwargs),
            start=self.start.get_sql(**kwargs),
            end=self.end.get_sql(**kwargs),
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class BitwiseAndCriterion(Criterion):
    def __init__(self, term: Term, value: Any, alias: Optional[str] = None) -> None:
        super().__init__(alias)
        self.term = term
        self.value = value

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.term.nodes_()
        yield from self.value.nodes_()

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "BitwiseAndCriterion":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.term = self.term.replace_table(current_table, new_table)

    def get_sql(self, **kwargs: Any) -> str:
        sql = "({term} & {value})".format(
            term=self.term.get_sql(**kwargs),
            value=self.value,
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class NullCriterion(Criterion):
    def __init__(self, term: Term, alias: Optional[str] = None) -> None:
        super().__init__(alias)
        self.term = term

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.term.nodes_()

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "NullCriterion":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.term = self.term.replace_table(current_table, new_table)

    def get_sql(self, with_alias: bool = False, **kwargs: Any) -> str:
        sql = "{term} IS NULL".format(
            term=self.term.get_sql(**kwargs),
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class NotNullCriterion(NullCriterion):
    def get_sql(self, with_alias: bool = False, **kwargs: Any) -> str:
        sql = "{term} IS NOT NULL".format(
            term=self.term.get_sql(**kwargs),
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class ComplexCriterion(BasicCriterion):
    def get_sql(self, subcriterion: bool = False, **kwargs: Any) -> str:
        sql = "{left} {comparator} {right}".format(
            comparator=self.comparator.value,
            left=self.left.get_sql(subcriterion=self.needs_brackets(self.left), **kwargs),
            right=self.right.get_sql(subcriterion=self.needs_brackets(self.right), **kwargs),
        )

        if subcriterion:
            return "({criterion})".format(criterion=sql)

        return sql

    def needs_brackets(self, term: Term) -> bool:
        return isinstance(term, ComplexCriterion) and not term.comparator == self.comparator


class ArithmeticExpression(Term):
    """
    Wrapper for an arithmetic function.  Can be simple with two terms or complex with nested terms. Order of operations
    are also preserved.
    """

    add_order = [Arithmetic.add, Arithmetic.sub]

    def __init__(self, operator: Arithmetic, left: Any, right: Any, alias: Optional[str] = None) -> None:
        """
        Wrapper for an arithmetic expression.

        :param operator:
            Type: Arithmetic
            An operator for the expression such as {quote}+{quote} or {quote}/{quote}

        :param left:
            The term on the left side of the expression.
        :param right:
            The term on the right side of the expression.
        :param alias:
            (Optional) an alias for the term which can be used inside a select statement.
        :return:
        """
        super().__init__(alias)
        self.operator = operator
        self.left = left
        self.right = right

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.left.nodes_()
        yield from self.right.nodes_()

    @property
    def is_aggregate(self) -> Optional[bool]:
        # True if both left and right terms are True or None. None if both terms are None. Otherwise, False
        return resolve_is_aggregate([self.left.is_aggregate, self.right.is_aggregate])

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "ArithmeticExpression":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the term with the tables replaced.
        """
        self.left = self.left.replace_table(current_table, new_table)
        self.right = self.right.replace_table(current_table, new_table)

    def left_needs_parens(self, curr_op, left_op) -> bool:
        """
        Returns true if the expression on the left of the current operator needs to be enclosed in parentheses.

        :param current_op:
            The current operator.
        :param left_op:
            The highest level operator of the left expression.
        """
        if left_op is None:
            # If the left expression is a single item.
            return False
        if curr_op in self.add_order:
            # If the current operator is '+' or '-'.
            return False
        # The current operator is '*' or '/'. If the left operator is '+' or '-', we need to add parentheses:
        # e.g. (A + B) / ..., (A - B) / ...
        # Otherwise, no parentheses are necessary:
        # e.g. A * B / ..., A / B / ...
        return left_op in self.add_order

    def right_needs_parens(self, curr_op, right_op) -> bool:
        """
        Returns true if the expression on the right of the current operator needs to be enclosed in parentheses.

        :param current_op:
            The current operator.
        :param right_op:
            The highest level operator of the right expression.
        """
        if right_op is None:
            # If the right expression is a single item.
            return False
        if curr_op == Arithmetic.add:
            return False
        if curr_op == Arithmetic.div:
            return True
        # The current operator is '*' or '-. If the right operator is '+' or '-', we need to add parentheses:
        # e.g. ... - (A + B), ... - (A - B)
        # Otherwise, no parentheses are necessary:
        # e.g. ... - A / B, ... - A * B
        return right_op in self.add_order

    def get_sql(self, with_alias: bool = False, **kwargs: Any) -> str:
        left_op, right_op = [getattr(side, "operator", None) for side in [self.left, self.right]]

        arithmetic_sql = "{left}{operator}{right}".format(
            operator=self.operator.value,
            left=("({})" if self.left_needs_parens(self.operator, left_op) else "{}").format(
                self.left.get_sql(**kwargs)
            ),
            right=("({})" if self.right_needs_parens(self.operator, right_op) else "{}").format(
                self.right.get_sql(**kwargs)
            ),
        )

        if with_alias:
            return format_alias_sql(arithmetic_sql, self.alias, **kwargs)

        return arithmetic_sql


class Case(Criterion):
    def __init__(self, alias: Optional[str] = None) -> None:
        super().__init__(alias=alias)
        self._cases = []
        self._else = None

    def nodes_(self) -> Iterator[NodeT]:
        yield self

        for criterion, term in self._cases:
            yield from criterion.nodes_()
            yield from term.nodes_()

        if self._else is not None:
            yield from self._else.nodes_()

    @property
    def is_aggregate(self) -> Optional[bool]:
        # True if all criterions/cases are True or None. None all cases are None. Otherwise, False
        return resolve_is_aggregate(
            [criterion.is_aggregate or term.is_aggregate for criterion, term in self._cases]
            + [self._else.is_aggregate if self._else else None]
        )

    @builder
    def when(self, criterion: Any, term: Any) -> "Case":
        self._cases.append((criterion, self.wrap_constant(term)))

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "Case":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the term with the tables replaced.
        """
        self._cases = [
            [
                criterion.replace_table(current_table, new_table),
                term.replace_table(current_table, new_table),
            ]
            for criterion, term in self._cases
        ]
        self._else = self._else.replace_table(current_table, new_table) if self._else else None

    @builder
    def else_(self, term: Any) -> "Case":
        self._else = self.wrap_constant(term)
        return self

    def get_sql(self, with_alias: bool = False, **kwargs: Any) -> str:
        if not self._cases:
            raise CaseException("At least one 'when' case is required for a CASE statement.")

        cases = " ".join(
            "WHEN {when} THEN {then}".format(when=criterion.get_sql(**kwargs), then=term.get_sql(**kwargs))
            for criterion, term in self._cases
        )
        else_ = " ELSE {}".format(self._else.get_sql(**kwargs)) if self._else else ""

        case_sql = "CASE {cases}{else_} END".format(cases=cases, else_=else_)

        if with_alias:
            return format_alias_sql(case_sql, self.alias, **kwargs)

        return case_sql


class Not(Criterion):
    def __init__(self, term: Any, alias: Optional[str] = None) -> None:
        super().__init__(alias=alias)
        self.term = term

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.term.nodes_()

    def get_sql(self, **kwargs: Any) -> str:
        kwargs["subcriterion"] = True
        sql = "NOT {term}".format(term=self.term.get_sql(**kwargs))
        return format_alias_sql(sql, self.alias, **kwargs)

    @ignore_copy
    def __getattr__(self, name: str) -> Any:
        """
        Delegate method calls to the class wrapped by Not().
        Re-wrap methods on child classes of Term (e.g. isin, eg...) to retain 'NOT <term>' output.
        """
        item_func = getattr(self.term, name)

        if not inspect.ismethod(item_func):
            return item_func

        def inner(inner_self, *args, **kwargs):
            result = item_func(inner_self, *args, **kwargs)
            if isinstance(result, (Term,)):
                return Not(result)
            return result

        return inner

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "Not":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.term = self.term.replace_table(current_table, new_table)


class All(Criterion):
    def __init__(self, term: Any, alias: Optional[str] = None) -> None:
        super().__init__(alias=alias)
        self.term = term

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        yield from self.term.nodes_()

    def get_sql(self, **kwargs: Any) -> str:
        sql = "{term} ALL".format(term=self.term.get_sql(**kwargs))
        return format_alias_sql(sql, self.alias, **kwargs)


class CustomFunction:
    def __init__(self, name: str, params: Optional[Sequence] = None) -> None:
        self.name = name
        self.params = params

    def __call__(self, *args: Any, **kwargs: Any) -> "Function":
        if not self._has_params():
            return Function(self.name, alias=kwargs.get("alias"))

        if not self._is_valid_function_call(*args):
            raise FunctionException(
                "Function {name} require these arguments ({params}), ({args}) passed".format(
                    name=self.name,
                    params=", ".join(str(p) for p in self.params),
                    args=", ".join(str(p) for p in args),
                )
            )

        return Function(self.name, *args, alias=kwargs.get("alias"))

    def _has_params(self):
        return self.params is not None

    def _is_valid_function_call(self, *args):
        return len(args) == len(self.params)


class Function(Criterion):
    def __init__(self, name: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(kwargs.get("alias"))
        self.name = name
        self.args = [self.wrap_constant(param) for param in args]
        self.schema = kwargs.get("schema")

    def nodes_(self) -> Iterator[NodeT]:
        yield self
        for arg in self.args:
            yield from arg.nodes_()

    @property
    def is_aggregate(self) -> Optional[bool]:
        """
        This is a shortcut that assumes if a function has a single argument and that argument is aggregated, then this
        function is also aggregated. A more sophisticated approach is needed, however it is unclear how that might work.
        :returns:
            True if the function accepts one argument and that argument is aggregate.
        """
        return resolve_is_aggregate([arg.is_aggregate for arg in self.args])

    @builder
    def replace_table(self, current_table: Optional["Table"], new_table: Optional["Table"]) -> "Function":
        """
        Replaces all occurrences of the specified table with the new table. Useful when reusing fields across queries.

        :param current_table:
            The table to be replaced.
        :param new_table:
            The table to replace with.
        :return:
            A copy of the criterion with the tables replaced.
        """
        self.args = [param.replace_table(current_table, new_table) for param in self.args]

    def get_special_params_sql(self, **kwargs: Any) -> Any:
        pass

    @staticmethod
    def get_arg_sql(arg, **kwargs):
        return arg.get_sql(with_alias=False, **kwargs) if hasattr(arg, "get_sql") else str(arg)

    def get_function_sql(self, **kwargs: Any) -> str:
        special_params_sql = self.get_special_params_sql(**kwargs)

        return "{name}({args}{special})".format(
            name=self.name,
            args=",".join(
                p.get_sql(with_alias=False, subquery=True, **kwargs)
                if hasattr(p, "get_sql")
                else self.get_arg_sql(p, **kwargs)
                for p in self.args
            ),
            special=(" " + special_params_sql) if special_params_sql else "",
        )

    def get_sql(self, **kwargs: Any) -> str:
        with_alias = kwargs.pop("with_alias", False)
        with_namespace = kwargs.pop("with_namespace", False)
        quote_char = kwargs.pop("quote_char", None)
        dialect = kwargs.pop("dialect", None)

        # FIXME escape
        function_sql = self.get_function_sql(with_namespace=with_namespace, quote_char=quote_char, dialect=dialect)

        if self.schema is not None:
            function_sql = "{schema}.{function}".format(
                schema=self.schema.get_sql(quote_char=quote_char, dialect=dialect, **kwargs),
                function=function_sql,
            )

        if with_alias:
            return format_alias_sql(function_sql, self.alias, quote_char=quote_char, **kwargs)

        return function_sql


class AggregateFunction(Function):
    is_aggregate = True

    def __init__(self, name, *args, **kwargs):
        super(AggregateFunction, self).__init__(name, *args, **kwargs)

        self._filters = []
        self._include_filter = False

    @builder
    def filter(self, *filters: Any) -> "AnalyticFunction":
        self._include_filter = True
        self._filters += filters

    def get_filter_sql(self, **kwargs: Any) -> str:
        if self._include_filter:
            return "WHERE {criterions}".format(criterions=Criterion.all(self._filters).get_sql(**kwargs))

    def get_function_sql(self, **kwargs: Any):
        sql = super(AggregateFunction, self).get_function_sql(**kwargs)
        filter_sql = self.get_filter_sql(**kwargs)

        if self._include_filter:
            sql += " FILTER({filter_sql})".format(filter_sql=filter_sql)

        return sql


class AnalyticFunction(AggregateFunction):
    is_aggregate = False
    is_analytic = True

    def __init__(self, name: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(name, *args, **kwargs)
        self._filters = []
        self._partition = []
        self._orderbys = []
        self._include_filter = False
        self._include_over = False

    @builder
    def over(self, *terms: Any) -> "AnalyticFunction":
        self._include_over = True
        self._partition += terms

    @builder
    def orderby(self, *terms: Any, **kwargs: Any) -> "AnalyticFunction":
        self._include_over = True
        self._orderbys += [(term, kwargs.get("order")) for term in terms]

    def _orderby_field(self, field: Field, orient: Optional[Order], **kwargs: Any) -> str:
        if orient is None:
            return field.get_sql(**kwargs)

        return "{field} {orient}".format(
            field=field.get_sql(**kwargs),
            orient=orient.value,
        )

    def get_partition_sql(self, **kwargs: Any) -> str:
        terms = []
        if self._partition:
            terms.append(
                "PARTITION BY {args}".format(
                    args=",".join(p.get_sql(**kwargs) if hasattr(p, "get_sql") else str(p) for p in self._partition)
                )
            )

        if self._orderbys:
            terms.append(
                "ORDER BY {orderby}".format(
                    orderby=",".join(self._orderby_field(field, orient, **kwargs) for field, orient in self._orderbys)
                )
            )

        return " ".join(terms)

    def get_function_sql(self, **kwargs: Any) -> str:
        function_sql = super(AnalyticFunction, self).get_function_sql(**kwargs)
        partition_sql = self.get_partition_sql(**kwargs)

        sql = function_sql
        if self._include_over:
            sql += " OVER({partition_sql})".format(partition_sql=partition_sql)

        return sql


EdgeT = TypeVar("EdgeT", bound="WindowFrameAnalyticFunction.Edge")


class WindowFrameAnalyticFunction(AnalyticFunction):
    class Edge:
        def __init__(self, value: Optional[Union[str, int]] = None) -> None:
            self.value = value

        def __str__(self) -> str:
            return "{value} {modifier}".format(
                value=self.value or "UNBOUNDED",
                modifier=self.modifier,
            )

    def __init__(self, name: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(name, *args, **kwargs)
        self.frame = None
        self.bound = None

    def _set_frame_and_bounds(self, frame: str, bound: str, and_bound: Optional[EdgeT]) -> None:
        if self.frame or self.bound:
            raise AttributeError()

        self.frame = frame
        self.bound = (bound, and_bound) if and_bound else bound

    @builder
    def rows(self, bound: Union[str, EdgeT], and_bound: Optional[EdgeT] = None) -> "WindowFrameAnalyticFunction":
        self._set_frame_and_bounds("ROWS", bound, and_bound)

    @builder
    def range(self, bound: Union[str, EdgeT], and_bound: Optional[EdgeT] = None) -> "WindowFrameAnalyticFunction":
        self._set_frame_and_bounds("RANGE", bound, and_bound)

    def get_frame_sql(self) -> str:
        if not isinstance(self.bound, tuple):
            return "{frame} {bound}".format(frame=self.frame, bound=self.bound)

        lower, upper = self.bound
        return "{frame} BETWEEN {lower} AND {upper}".format(
            frame=self.frame,
            lower=lower,
            upper=upper,
        )

    def get_partition_sql(self, **kwargs: Any) -> str:
        partition_sql = super(WindowFrameAnalyticFunction, self).get_partition_sql(**kwargs)

        if not self.frame and not self.bound:
            return partition_sql

        return "{over} {frame}".format(over=partition_sql, frame=self.get_frame_sql())


class IgnoreNullsAnalyticFunction(AnalyticFunction):
    def __init__(self, name: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(name, *args, **kwargs)
        self._ignore_nulls = False

    @builder
    def ignore_nulls(self) -> "IgnoreNullsAnalyticFunction":
        self._ignore_nulls = True

    def get_special_params_sql(self, **kwargs: Any) -> Optional[str]:
        if self._ignore_nulls:
            return "IGNORE NULLS"

        # No special params unless ignoring nulls
        return None


class Interval(Node):
    templates = {
        # PostgreSQL, Redshift and Vertica require quotes around the expr and unit e.g. INTERVAL '1 week'
        Dialects.POSTGRESQL: "INTERVAL '{expr} {unit}'",
        Dialects.REDSHIFT: "INTERVAL '{expr} {unit}'",
        Dialects.VERTICA: "INTERVAL '{expr} {unit}'",
        # Oracle and MySQL requires just single quotes around the expr
        Dialects.ORACLE: "INTERVAL '{expr}' {unit}",
        Dialects.MYSQL: "INTERVAL '{expr}' {unit}",
    }

    units = ["years", "months", "days", "hours", "minutes", "seconds", "microseconds"]
    labels = ["YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND", "MICROSECOND"]

    trim_pattern = re.compile(r"(^0+\.)|(\.0+$)|(^[0\-.: ]+[\-: ])|([\-:. ][0\-.: ]+$)")

    def __init__(
        self,
        years: int = 0,
        months: int = 0,
        days: int = 0,
        hours: int = 0,
        minutes: int = 0,
        seconds: int = 0,
        microseconds: int = 0,
        quarters: int = 0,
        weeks: int = 0,
        dialect: Optional[Dialects] = None,
    ):
        self.dialect = dialect
        self.largest = None
        self.smallest = None
        self.is_negative = False

        if quarters:
            self.quarters = quarters
            return

        if weeks:
            self.weeks = weeks
            return

        for unit, label, value in zip(
            self.units,
            self.labels,
            [years, months, days, hours, minutes, seconds, microseconds],
        ):
            if value:
                int_value = int(value)
                setattr(self, unit, abs(int_value))
                if self.largest is None:
                    self.largest = label
                    self.is_negative = int_value < 0
                self.smallest = label

    def __str__(self) -> str:
        return self.get_sql()

    def get_sql(self, **kwargs: Any) -> str:
        dialect = self.dialect or kwargs.get("dialect")

        if self.largest == "MICROSECOND":
            expr = getattr(self, "microseconds")
            unit = "MICROSECOND"

        elif hasattr(self, "quarters"):
            expr = getattr(self, "quarters")
            unit = "QUARTER"

        elif hasattr(self, "weeks"):
            expr = getattr(self, "weeks")
            unit = "WEEK"

        else:
            # Create the whole expression but trim out the unnecessary fields
            expr = "{years}-{months}-{days} {hours}:{minutes}:{seconds}.{microseconds}".format(
                years=getattr(self, "years", 0),
                months=getattr(self, "months", 0),
                days=getattr(self, "days", 0),
                hours=getattr(self, "hours", 0),
                minutes=getattr(self, "minutes", 0),
                seconds=getattr(self, "seconds", 0),
                microseconds=getattr(self, "microseconds", 0),
            )
            expr = self.trim_pattern.sub("", expr)
            if self.is_negative:
                expr = "-" + expr

            unit = (
                "{largest}_{smallest}".format(
                    largest=self.largest,
                    smallest=self.smallest,
                )
                if self.largest != self.smallest
                else self.largest
            )

            # Set default unit with DAY
            if unit is None:
                unit = "DAY"

        return self.templates.get(dialect, "INTERVAL '{expr} {unit}'").format(expr=expr, unit=unit)


class Pow(Function):
    def __init__(self, term: Term, exponent: float, alias: Optional[str] = None) -> None:
        super().__init__("POW", term, exponent, alias=alias)


class Mod(Function):
    def __init__(self, term: Term, modulus: float, alias: Optional[str] = None) -> None:
        super().__init__("MOD", term, modulus, alias=alias)


class Rollup(Function):
    def __init__(self, *terms: Any) -> None:
        super().__init__("ROLLUP", *terms)


class PseudoColumn(Term):
    """
    Represents a pseudo column (a "column" which yields a value when selected
    but is not actually a real table column).
    """

    def __init__(self, name: str) -> None:
        super().__init__(alias=None)
        self.name = name

    def get_sql(self, **kwargs: Any) -> str:
        return self.name


class AtTimezone(Term):
    """
    Generates AT TIME ZONE SQL.
    Examples:
        AT TIME ZONE 'US/Eastern'
        AT TIME ZONE INTERVAL '-06:00'
    """

    is_aggregate = None

    def __init__(self, field, zone, interval=False, alias=None):
        super().__init__(alias)
        self.field = Field(field) if not isinstance(field, Field) else field
        self.zone = zone
        self.interval = interval

    def get_sql(self, **kwargs):
        sql = '{name} AT TIME ZONE {interval}\'{zone}\''.format(
            name=self.field.get_sql(**kwargs),
            interval='INTERVAL ' if self.interval else '',
            zone=self.zone,
        )
        return format_alias_sql(sql, self.alias, **kwargs)
