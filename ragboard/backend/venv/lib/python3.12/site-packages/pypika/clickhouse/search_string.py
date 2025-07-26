import abc

from pypika.terms import Function
from pypika.utils import format_alias_sql


class _AbstractSearchString(Function, metaclass=abc.ABCMeta):
    def __init__(self, name, pattern: str, alias: str = None):
        super(_AbstractSearchString, self).__init__(self.clickhouse_function(), name, alias=alias)

        self._pattern = pattern

    @classmethod
    @abc.abstractmethod
    def clickhouse_function(cls) -> str:
        pass

    def get_sql(self, with_alias=False, with_namespace=False, quote_char=None, dialect=None, **kwargs):
        args = []
        for p in self.args:
            if hasattr(p, "get_sql"):
                args.append('toString("{arg}")'.format(arg=p.get_sql(with_alias=False, **kwargs)))
            else:
                args.append(str(p))

        sql = "{name}({args},'{pattern}')".format(
            name=self.name,
            args=",".join(args),
            pattern=self._pattern,
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class Match(_AbstractSearchString):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "match"


class Like(_AbstractSearchString):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "like"


class NotLike(_AbstractSearchString):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "notLike"


class _AbstractMultiSearchString(Function, metaclass=abc.ABCMeta):
    def __init__(self, name, patterns: list, alias: str = None):
        super(_AbstractMultiSearchString, self).__init__(self.clickhouse_function(), name, alias=alias)

        self._patterns = patterns

    @classmethod
    @abc.abstractmethod
    def clickhouse_function(cls) -> str:
        pass

    def get_sql(self, with_alias=False, with_namespace=False, quote_char=None, dialect=None, **kwargs):
        args = []
        for p in self.args:
            if hasattr(p, "get_sql"):
                args.append('toString("{arg}")'.format(arg=p.get_sql(with_alias=False, **kwargs)))
            else:
                args.append(str(p))

        sql = "{name}({args},[{patterns}])".format(
            name=self.name,
            args=",".join(args),
            patterns=",".join(["'%s'" % i for i in self._patterns]),
        )
        return format_alias_sql(sql, self.alias, **kwargs)


class MultiSearchAny(_AbstractMultiSearchString):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "multiSearchAny"


class MultiMatchAny(_AbstractMultiSearchString):
    @classmethod
    def clickhouse_function(cls) -> str:
        return "multiMatchAny"
