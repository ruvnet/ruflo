import abc

from pypika.terms import (
    Field,
    Function,
    Term,
)
from pypika.utils import format_alias_sql


class Array(Term):
    def __init__(self, values: list, converter_cls=None, converter_options: dict = None, alias: str = None):
        super().__init__(alias)
        self._values = values
        self._converter_cls = converter_cls
        self._converter_options = converter_options or dict()

    def get_sql(self):
        if self._converter_cls:
            converted = []
            for value in self._values:
                converter = self._converter_cls(value, **self._converter_options)
                converted.append(converter.get_sql())
            sql = "".join(["[", ",".join(converted), "]"])

        else:
            sql = str(self._values)

        return format_alias_sql(sql, self.alias)


class HasAny(Function):
    def __init__(
        self,
        left_array: Array or Field,
        right_array: Array or Field,
        alias: str = None,
        schema: str = None,
    ):
        self._left_array = left_array
        self._right_array = right_array
        self.alias = alias
        self.schema = schema
        self.args = ()
        self.name = "hasAny"

    def get_sql(self, with_alias=False, with_namespace=False, quote_char=None, dialect=None, **kwargs):
        left = self._left_array.get_sql()
        right = self._right_array.get_sql()
        sql = "{name}({left},{right})".format(
            name=self.name,
            left='"%s"' % left if isinstance(self._left_array, Field) else left,
            right='"%s"' % right if isinstance(self._right_array, Field) else right,
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class _AbstractArrayFunction(Function, metaclass=abc.ABCMeta):
    def __init__(self, array: Array or Field, alias: str = None, schema: str = None):
        self.schema = schema
        self.alias = alias
        self.name = self.clickhouse_function()
        self._array = array

    def get_sql(self, with_namespace=False, quote_char=None, dialect=None, **kwargs):
        array = self._array.get_sql()
        sql = "{name}({array})".format(
            name=self.name,
            array='"%s"' % array if isinstance(self._array, Field) else array,
        )
        return format_alias_sql(sql, self.alias, **kwargs)

    @classmethod
    @abc.abstractmethod
    def clickhouse_function(cls) -> str:
        pass


class NotEmpty(_AbstractArrayFunction):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "notEmpty"


class Empty(_AbstractArrayFunction):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "empty"


class Length(_AbstractArrayFunction):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "length"
