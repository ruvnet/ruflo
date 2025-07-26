import itertools
from copy import copy
from typing import Any, Optional, Union, Tuple as TypedTuple

from pypika.enums import Dialects
from pypika.queries import (
    CreateQueryBuilder,
    Database,
    DropQueryBuilder,
    Selectable,
    Table,
    Query,
    QueryBuilder,
)
from pypika.terms import ArithmeticExpression, Criterion, EmptyCriterion, Field, Function, Star, Term, ValueWrapper
from pypika.utils import QueryException, builder, format_quotes


class SnowflakeQuery(Query):
    """
    Defines a query class for use with Snowflake.
    """

    @classmethod
    def _builder(cls, **kwargs: Any) -> "SnowflakeQueryBuilder":
        return SnowflakeQueryBuilder(**kwargs)

    @classmethod
    def create_table(cls, table: Union[str, Table]) -> "SnowflakeCreateQueryBuilder":
        return SnowflakeCreateQueryBuilder().create_table(table)

    @classmethod
    def drop_table(cls, table: Union[str, Table]) -> "SnowflakeDropQueryBuilder":
        return SnowflakeDropQueryBuilder().drop_table(table)


class SnowflakeQueryBuilder(QueryBuilder):
    QUOTE_CHAR = None
    ALIAS_QUOTE_CHAR = '"'
    QUERY_ALIAS_QUOTE_CHAR = ''
    QUERY_CLS = SnowflakeQuery

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(dialect=Dialects.SNOWFLAKE, **kwargs)


class SnowflakeCreateQueryBuilder(CreateQueryBuilder):
    QUOTE_CHAR = None
    QUERY_CLS = SnowflakeQuery

    def __init__(self) -> None:
        super().__init__(dialect=Dialects.SNOWFLAKE)


class SnowflakeDropQueryBuilder(DropQueryBuilder):
    QUOTE_CHAR = None
    QUERY_CLS = SnowflakeQuery

    def __init__(self) -> None:
        super().__init__(dialect=Dialects.SNOWFLAKE)


class MySQLQuery(Query):
    """
    Defines a query class for use with MySQL.
    """

    @classmethod
    def _builder(cls, **kwargs: Any) -> "MySQLQueryBuilder":
        return MySQLQueryBuilder(**kwargs)

    @classmethod
    def load(cls, fp: str) -> "MySQLLoadQueryBuilder":
        return MySQLLoadQueryBuilder().load(fp)

    @classmethod
    def create_table(cls, table: Union[str, Table]) -> "MySQLCreateQueryBuilder":
        return MySQLCreateQueryBuilder().create_table(table)

    @classmethod
    def drop_table(cls, table: Union[str, Table]) -> "MySQLDropQueryBuilder":
        return MySQLDropQueryBuilder().drop_table(table)


class MySQLQueryBuilder(QueryBuilder):
    QUOTE_CHAR = "`"
    QUERY_CLS = MySQLQuery

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(dialect=Dialects.MYSQL, wrap_set_operation_queries=False, **kwargs)
        self._duplicate_updates = []
        self._ignore_duplicates = False
        self._modifiers = []

        self._for_update_nowait = False
        self._for_update_skip_locked = False
        self._for_update_of = set()

    def __copy__(self) -> "MySQLQueryBuilder":
        newone = super().__copy__()
        newone._duplicate_updates = copy(self._duplicate_updates)
        newone._ignore_duplicates = copy(self._ignore_duplicates)
        return newone

    @builder
    def for_update(
        self, nowait: bool = False, skip_locked: bool = False, of: TypedTuple[str, ...] = ()
    ) -> "QueryBuilder":
        self._for_update = True
        self._for_update_skip_locked = skip_locked
        self._for_update_nowait = nowait
        self._for_update_of = set(of)

    @builder
    def on_duplicate_key_update(self, field: Union[Field, str], value: Any) -> "MySQLQueryBuilder":
        if self._ignore_duplicates:
            raise QueryException("Can not have two conflict handlers")

        field = Field(field) if not isinstance(field, Field) else field
        self._duplicate_updates.append((field, ValueWrapper(value)))

    @builder
    def on_duplicate_key_ignore(self) -> "MySQLQueryBuilder":
        if self._duplicate_updates:
            raise QueryException("Can not have two conflict handlers")

        self._ignore_duplicates = True

    def get_sql(self, **kwargs: Any) -> str:
        self._set_kwargs_defaults(kwargs)
        querystring = super(MySQLQueryBuilder, self).get_sql(**kwargs)
        if querystring:
            if self._duplicate_updates:
                querystring += self._on_duplicate_key_update_sql(**kwargs)
            elif self._ignore_duplicates:
                querystring += self._on_duplicate_key_ignore_sql()
        return querystring

    def _for_update_sql(self, **kwargs) -> str:
        if self._for_update:
            for_update = ' FOR UPDATE'
            if self._for_update_of:
                for_update += f' OF {", ".join([Table(item).get_sql(**kwargs) for item in self._for_update_of])}'
            if self._for_update_nowait:
                for_update += ' NOWAIT'
            elif self._for_update_skip_locked:
                for_update += ' SKIP LOCKED'
        else:
            for_update = ''

        return for_update

    def _on_duplicate_key_update_sql(self, **kwargs: Any) -> str:
        return " ON DUPLICATE KEY UPDATE {updates}".format(
            updates=",".join(
                "{field}={value}".format(field=field.get_sql(**kwargs), value=value.get_sql(**kwargs))
                for field, value in self._duplicate_updates
            )
        )

    def _on_duplicate_key_ignore_sql(self) -> str:
        return " ON DUPLICATE KEY IGNORE"

    @builder
    def modifier(self, value: str) -> "MySQLQueryBuilder":
        """
        Adds a modifier such as SQL_CALC_FOUND_ROWS to the query.
        https://dev.mysql.com/doc/refman/5.7/en/select.html

        :param value: The modifier value e.g. SQL_CALC_FOUND_ROWS
        """
        self._modifiers.append(value)

    def _select_sql(self, **kwargs: Any) -> str:
        """
        Overridden function to generate the SELECT part of the SQL statement,
        with the addition of the a modifier if present.
        """
        return "SELECT {distinct}{modifier}{select}".format(
            distinct="DISTINCT " if self._distinct else "",
            modifier="{} ".format(" ".join(self._modifiers)) if self._modifiers else "",
            select=",".join(term.get_sql(with_alias=True, subquery=True, **kwargs) for term in self._selects),
        )


class MySQLLoadQueryBuilder:
    QUERY_CLS = MySQLQuery

    def __init__(self) -> None:
        self._load_file = None
        self._into_table = None

    @builder
    def load(self, fp: str) -> "MySQLLoadQueryBuilder":
        self._load_file = fp

    @builder
    def into(self, table: Union[str, Table]) -> "MySQLLoadQueryBuilder":
        self._into_table = table if isinstance(table, Table) else Table(table)

    def get_sql(self, *args: Any, **kwargs: Any) -> str:
        querystring = ""
        if self._load_file and self._into_table:
            querystring += self._load_file_sql(**kwargs)
            querystring += self._into_table_sql(**kwargs)
            querystring += self._options_sql(**kwargs)

        return querystring

    def _load_file_sql(self, **kwargs: Any) -> str:
        return "LOAD DATA LOCAL INFILE '{}'".format(self._load_file)

    def _into_table_sql(self, **kwargs: Any) -> str:
        return " INTO TABLE `{}`".format(self._into_table.get_sql(**kwargs))

    def _options_sql(self, **kwargs: Any) -> str:
        return " FIELDS TERMINATED BY ','"

    def __str__(self) -> str:
        return self.get_sql()


class MySQLCreateQueryBuilder(CreateQueryBuilder):
    QUOTE_CHAR = "`"


class MySQLDropQueryBuilder(DropQueryBuilder):
    QUOTE_CHAR = "`"


class VerticaQuery(Query):
    """
    Defines a query class for use with Vertica.
    """

    @classmethod
    def _builder(cls, **kwargs) -> "VerticaQueryBuilder":
        return VerticaQueryBuilder(**kwargs)

    @classmethod
    def from_file(cls, fp: str) -> "VerticaCopyQueryBuilder":
        return VerticaCopyQueryBuilder().from_file(fp)

    @classmethod
    def create_table(cls, table: Union[str, Table]) -> "VerticaCreateQueryBuilder":
        return VerticaCreateQueryBuilder().create_table(table)


class VerticaQueryBuilder(QueryBuilder):
    QUERY_CLS = VerticaQuery

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(dialect=Dialects.VERTICA, **kwargs)
        self._hint = None

    @builder
    def hint(self, label: str) -> "VerticaQueryBuilder":
        self._hint = label

    def get_sql(self, *args: Any, **kwargs: Any) -> str:
        sql = super().get_sql(*args, **kwargs)

        if self._hint is not None:
            sql = "".join([sql[:7], "/*+label({hint})*/".format(hint=self._hint), sql[6:]])

        return sql


class VerticaCreateQueryBuilder(CreateQueryBuilder):
    QUERY_CLS = VerticaQuery

    def __init__(self) -> None:
        super().__init__(dialect=Dialects.VERTICA)
        self._local = False
        self._preserve_rows = False

    @builder
    def local(self) -> "VerticaCreateQueryBuilder":
        if not self._temporary:
            raise AttributeError("'Query' object has no attribute temporary")

        self._local = True

    @builder
    def preserve_rows(self) -> "VerticaCreateQueryBuilder":
        if not self._temporary:
            raise AttributeError("'Query' object has no attribute temporary")

        self._preserve_rows = True

    def _create_table_sql(self, **kwargs: Any) -> str:
        return "CREATE {local}{temporary}TABLE {table}".format(
            local="LOCAL " if self._local else "",
            temporary="TEMPORARY " if self._temporary else "",
            table=self._create_table.get_sql(**kwargs),
        )

    def _table_options_sql(self, **kwargs) -> str:
        table_options = super()._table_options_sql(**kwargs)
        table_options += self._preserve_rows_sql()
        return table_options

    def _as_select_sql(self, **kwargs: Any) -> str:
        return "{preserve_rows} AS ({query})".format(
            preserve_rows=self._preserve_rows_sql(),
            query=self._as_select.get_sql(**kwargs),
        )

    def _preserve_rows_sql(self) -> str:
        return " ON COMMIT PRESERVE ROWS" if self._preserve_rows else ""


class VerticaCopyQueryBuilder:
    QUERY_CLS = VerticaQuery

    def __init__(self) -> None:
        self._copy_table = None
        self._from_file = None

    @builder
    def from_file(self, fp: str) -> "VerticaCopyQueryBuilder":
        self._from_file = fp

    @builder
    def copy_(self, table: Union[str, Table]) -> "VerticaCopyQueryBuilder":
        self._copy_table = table if isinstance(table, Table) else Table(table)

    def get_sql(self, *args: Any, **kwargs: Any) -> str:
        querystring = ""
        if self._copy_table and self._from_file:
            querystring += self._copy_table_sql(**kwargs)
            querystring += self._from_file_sql(**kwargs)
            querystring += self._options_sql(**kwargs)

        return querystring

    def _copy_table_sql(self, **kwargs: Any) -> str:
        return 'COPY "{}"'.format(self._copy_table.get_sql(**kwargs))

    def _from_file_sql(self, **kwargs: Any) -> str:
        return " FROM LOCAL '{}'".format(self._from_file)

    def _options_sql(self, **kwargs: Any) -> str:
        return " PARSER fcsvparser(header=false)"

    def __str__(self) -> str:
        return self.get_sql()


class OracleQuery(Query):
    """
    Defines a query class for use with Oracle.
    """

    @classmethod
    def _builder(cls, **kwargs: Any) -> "OracleQueryBuilder":
        return OracleQueryBuilder(**kwargs)


class OracleQueryBuilder(QueryBuilder):
    QUOTE_CHAR = None
    QUERY_CLS = OracleQuery

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(dialect=Dialects.ORACLE, **kwargs)

    def get_sql(self, *args: Any, **kwargs: Any) -> str:
        # Oracle does not support group by a field alias
        # Note: set directly in kwargs as they are re-used down the tree in the case of subqueries!
        kwargs['groupby_alias'] = False
        return super().get_sql(*args, **kwargs)


class PostgreSQLQuery(Query):
    """
    Defines a query class for use with PostgreSQL.
    """

    @classmethod
    def _builder(cls, **kwargs) -> "PostgreSQLQueryBuilder":
        return PostgreSQLQueryBuilder(**kwargs)


class PostgreSQLQueryBuilder(QueryBuilder):
    ALIAS_QUOTE_CHAR = '"'
    QUERY_CLS = PostgreSQLQuery

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(dialect=Dialects.POSTGRESQL, **kwargs)
        self._returns = []
        self._return_star = False

        self._on_conflict = False
        self._on_conflict_fields = []
        self._on_conflict_do_nothing = False
        self._on_conflict_do_updates = []
        self._on_conflict_wheres = None
        self._on_conflict_do_update_wheres = None

        self._distinct_on = []

        self._for_update_nowait = False
        self._for_update_skip_locked = False
        self._for_update_of = set()

    def __copy__(self) -> "PostgreSQLQueryBuilder":
        newone = super().__copy__()
        newone._returns = copy(self._returns)
        newone._on_conflict_do_updates = copy(self._on_conflict_do_updates)
        return newone

    @builder
    def distinct_on(self, *fields: Union[str, Term]) -> "PostgreSQLQueryBuilder":
        for field in fields:
            if isinstance(field, str):
                self._distinct_on.append(Field(field))
            elif isinstance(field, Term):
                self._distinct_on.append(field)

    @builder
    def for_update(
        self, nowait: bool = False, skip_locked: bool = False, of: TypedTuple[str, ...] = ()
    ) -> "QueryBuilder":
        self._for_update = True
        self._for_update_skip_locked = skip_locked
        self._for_update_nowait = nowait
        self._for_update_of = set(of)

    @builder
    def on_conflict(self, *target_fields: Union[str, Term]) -> "PostgreSQLQueryBuilder":
        if not self._insert_table:
            raise QueryException("On conflict only applies to insert query")

        self._on_conflict = True

        for target_field in target_fields:
            if isinstance(target_field, str):
                self._on_conflict_fields.append(self._conflict_field_str(target_field))
            elif isinstance(target_field, Term):
                self._on_conflict_fields.append(target_field)

    @builder
    def do_nothing(self) -> "PostgreSQLQueryBuilder":
        if len(self._on_conflict_do_updates) > 0:
            raise QueryException("Can not have two conflict handlers")
        self._on_conflict_do_nothing = True

    @builder
    def do_update(
        self, update_field: Union[str, Field], update_value: Optional[Any] = None
    ) -> "PostgreSQLQueryBuilder":
        if self._on_conflict_do_nothing:
            raise QueryException("Can not have two conflict handlers")

        if isinstance(update_field, str):
            field = self._conflict_field_str(update_field)
        elif isinstance(update_field, Field):
            field = update_field
        else:
            raise QueryException("Unsupported update_field")

        if update_value is not None:
            self._on_conflict_do_updates.append((field, ValueWrapper(update_value)))
        else:
            self._on_conflict_do_updates.append((field, None))

    @builder
    def where(self, criterion: Criterion) -> "PostgreSQLQueryBuilder":
        if not self._on_conflict:
            return super().where(criterion)

        if isinstance(criterion, EmptyCriterion):
            return

        if self._on_conflict_do_nothing:
            raise QueryException('DO NOTHING doest not support WHERE')

        if self._on_conflict_fields and self._on_conflict_do_updates:
            if self._on_conflict_do_update_wheres:
                self._on_conflict_do_update_wheres &= criterion
            else:
                self._on_conflict_do_update_wheres = criterion
        elif self._on_conflict_fields:
            if self._on_conflict_wheres:
                self._on_conflict_wheres &= criterion
            else:
                self._on_conflict_wheres = criterion
        else:
            raise QueryException('Can not have fieldless ON CONFLICT WHERE')

    @builder
    def using(self, table: Union[Selectable, str]) -> "QueryBuilder":
        self._using.append(table)

    def _distinct_sql(self, **kwargs: Any) -> str:
        if self._distinct_on:
            return "DISTINCT ON({distinct_on}) ".format(
                distinct_on=",".join(term.get_sql(with_alias=True, **kwargs) for term in self._distinct_on)
            )
        return super()._distinct_sql(**kwargs)

    def _conflict_field_str(self, term: str) -> Optional[Field]:
        if self._insert_table:
            return Field(term, table=self._insert_table)

    def _on_conflict_sql(self, **kwargs: Any) -> str:
        if not self._on_conflict_do_nothing and len(self._on_conflict_do_updates) == 0:
            if not self._on_conflict_fields:
                return ""
            raise QueryException("No handler defined for on conflict")

        if self._on_conflict_do_updates and not self._on_conflict_fields:
            raise QueryException("Can not have fieldless on conflict do update")

        conflict_query = " ON CONFLICT"
        if self._on_conflict_fields:
            fields = [f.get_sql(with_alias=True, **kwargs) for f in self._on_conflict_fields]
            conflict_query += " (" + ', '.join(fields) + ")"

        if self._on_conflict_wheres:
            conflict_query += " WHERE {where}".format(where=self._on_conflict_wheres.get_sql(subquery=True, **kwargs))

        return conflict_query

    def _for_update_sql(self, **kwargs) -> str:
        if self._for_update:
            for_update = ' FOR UPDATE'
            if self._for_update_of:
                for_update += f' OF {", ".join([Table(item).get_sql(**kwargs) for item in self._for_update_of])}'
            if self._for_update_nowait:
                for_update += ' NOWAIT'
            elif self._for_update_skip_locked:
                for_update += ' SKIP LOCKED'
        else:
            for_update = ''

        return for_update

    def _on_conflict_action_sql(self, **kwargs: Any) -> str:
        if self._on_conflict_do_nothing:
            return " DO NOTHING"
        elif len(self._on_conflict_do_updates) > 0:
            updates = []
            for field, value in self._on_conflict_do_updates:
                if value:
                    updates.append(
                        "{field}={value}".format(
                            field=field.get_sql(**kwargs),
                            value=value.get_sql(with_namespace=True, **kwargs),
                        )
                    )
                else:
                    updates.append(
                        "{field}=EXCLUDED.{value}".format(
                            field=field.get_sql(**kwargs),
                            value=field.get_sql(**kwargs),
                        )
                    )
            action_sql = " DO UPDATE SET {updates}".format(updates=",".join(updates))

            if self._on_conflict_do_update_wheres:
                action_sql += " WHERE {where}".format(
                    where=self._on_conflict_do_update_wheres.get_sql(subquery=True, with_namespace=True, **kwargs)
                )
            return action_sql

        return ''

    @builder
    def returning(self, *terms: Any) -> "PostgreSQLQueryBuilder":
        for term in terms:
            if isinstance(term, Field):
                self._return_field(term)
            elif isinstance(term, str):
                self._return_field_str(term)
            elif isinstance(term, (Function, ArithmeticExpression)):
                if term.is_aggregate:
                    raise QueryException("Aggregate functions are not allowed in returning")
                self._return_other(term)
            else:
                self._return_other(self.wrap_constant(term, self._wrapper_cls))

    def _validate_returning_term(self, term: Term) -> None:
        for field in term.fields_():
            if not any([self._insert_table, self._update_table, self._delete_from]):
                raise QueryException("Returning can't be used in this query")

            table_is_insert_or_update_table = field.table in {self._insert_table, self._update_table}
            join_tables = set(itertools.chain.from_iterable([j.criterion.tables_ for j in self._joins]))
            join_and_base_tables = set(self._from) | join_tables
            table_not_base_or_join = bool(term.tables_ - join_and_base_tables)
            if not table_is_insert_or_update_table and table_not_base_or_join:
                raise QueryException("You can't return from other tables")

    def _set_returns_for_star(self) -> None:
        self._returns = [returning for returning in self._returns if not hasattr(returning, "table")]
        self._return_star = True

    def _return_field(self, term: Union[str, Field]) -> None:
        if self._return_star:
            # Do not add select terms after a star is selected
            return

        self._validate_returning_term(term)

        if isinstance(term, Star):
            self._set_returns_for_star()

        self._returns.append(term)

    def _return_field_str(self, term: Union[str, Field]) -> None:
        if term == "*":
            self._set_returns_for_star()
            self._returns.append(Star())
            return

        if self._insert_table:
            self._return_field(Field(term, table=self._insert_table))
        elif self._update_table:
            self._return_field(Field(term, table=self._update_table))
        elif self._delete_from:
            self._return_field(Field(term, table=self._from[0]))
        else:
            raise QueryException("Returning can't be used in this query")

    def _return_other(self, function: Term) -> None:
        self._validate_returning_term(function)
        self._returns.append(function)

    def _returning_sql(self, **kwargs: Any) -> str:
        return " RETURNING {returning}".format(
            returning=",".join(term.get_sql(with_alias=True, **kwargs) for term in self._returns),
        )

    def get_sql(self, with_alias: bool = False, subquery: bool = False, **kwargs: Any) -> str:
        self._set_kwargs_defaults(kwargs)

        querystring = super(PostgreSQLQueryBuilder, self).get_sql(with_alias, subquery, **kwargs)

        querystring += self._on_conflict_sql(**kwargs)
        querystring += self._on_conflict_action_sql(**kwargs)

        if self._returns:
            kwargs['with_namespace'] = self._update_table and self.from_
            querystring += self._returning_sql(**kwargs)
        return querystring


class RedshiftQuery(Query):
    """
    Defines a query class for use with Amazon Redshift.
    """

    @classmethod
    def _builder(cls, **kwargs: Any) -> "RedShiftQueryBuilder":
        return RedShiftQueryBuilder(dialect=Dialects.REDSHIFT, **kwargs)


class RedShiftQueryBuilder(QueryBuilder):
    QUERY_CLS = RedshiftQuery


class MSSQLQuery(Query):
    """
    Defines a query class for use with Microsoft SQL Server.
    """

    @classmethod
    def _builder(cls, **kwargs: Any) -> "MSSQLQueryBuilder":
        return MSSQLQueryBuilder(**kwargs)


class MSSQLQueryBuilder(QueryBuilder):
    QUERY_CLS = MSSQLQuery

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(dialect=Dialects.MSSQL, **kwargs)
        self._top: Union[int, None] = None
        self._top_with_ties: bool = False
        self._top_percent: bool = False

    @builder
    def top(self, value: Union[str, int], percent: bool = False, with_ties: bool = False) -> "MSSQLQueryBuilder":
        """
        Implements support for simple TOP clauses.
        https://docs.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql?view=sql-server-2017
        """
        try:
            self._top = int(value)
        except ValueError:
            raise QueryException("TOP value must be an integer")

        if percent and not (0 <= int(value) <= 100):
            raise QueryException("TOP value must be between 0 and 100 when `percent`" " is specified")
        self._top_percent: bool = percent
        self._top_with_ties: bool = with_ties

    @builder
    def fetch_next(self, limit: int) -> "MSSQLQueryBuilder":
        # Overridden to provide a more domain-specific API for T-SQL users
        self._limit = limit

    def _offset_sql(self) -> str:
        return " OFFSET {offset} ROWS".format(offset=self._offset or 0)

    def _limit_sql(self) -> str:
        return " FETCH NEXT {limit} ROWS ONLY".format(limit=self._limit)

    def _apply_pagination(self, querystring: str) -> str:
        # Note: Overridden as MSSQL specifies offset before the fetch next limit
        if self._limit is not None or self._offset:
            # Offset has to be present if fetch next is specified in a MSSQL query
            querystring += self._offset_sql()

        if self._limit is not None:
            querystring += self._limit_sql()

        return querystring

    def get_sql(self, *args: Any, **kwargs: Any) -> str:
        # MSSQL does not support group by a field alias.
        # Note: set directly in kwargs as they are re-used down the tree in the case of subqueries!
        kwargs['groupby_alias'] = False
        return super().get_sql(*args, **kwargs)

    def _top_sql(self) -> str:
        _top_statement: str = ""
        if self._top:
            _top_statement = f"TOP ({self._top}) "
            if self._top_percent:
                _top_statement = f"{_top_statement}PERCENT "
            if self._top_with_ties:
                _top_statement = f"{_top_statement}WITH TIES "

        return _top_statement

    def _select_sql(self, **kwargs: Any) -> str:
        return "SELECT {distinct}{top}{select}".format(
            top=self._top_sql(),
            distinct="DISTINCT " if self._distinct else "",
            select=",".join(term.get_sql(with_alias=True, subquery=True, **kwargs) for term in self._selects),
        )


class ClickHouseQuery(Query):
    """
    Defines a query class for use with Yandex ClickHouse.
    """

    @classmethod
    def _builder(cls, **kwargs: Any) -> "ClickHouseQueryBuilder":
        return ClickHouseQueryBuilder(
            dialect=Dialects.CLICKHOUSE, wrap_set_operation_queries=False, as_keyword=True, **kwargs
        )

    @classmethod
    def drop_database(self, database: Union[Database, str]) -> "ClickHouseDropQueryBuilder":
        return ClickHouseDropQueryBuilder().drop_database(database)

    @classmethod
    def drop_table(self, table: Union[Table, str]) -> "ClickHouseDropQueryBuilder":
        return ClickHouseDropQueryBuilder().drop_table(table)

    @classmethod
    def drop_dictionary(self, dictionary: str) -> "ClickHouseDropQueryBuilder":
        return ClickHouseDropQueryBuilder().drop_dictionary(dictionary)

    @classmethod
    def drop_quota(self, quota: str) -> "ClickHouseDropQueryBuilder":
        return ClickHouseDropQueryBuilder().drop_quota(quota)

    @classmethod
    def drop_user(self, user: str) -> "ClickHouseDropQueryBuilder":
        return ClickHouseDropQueryBuilder().drop_user(user)

    @classmethod
    def drop_view(self, view: str) -> "ClickHouseDropQueryBuilder":
        return ClickHouseDropQueryBuilder().drop_view(view)


class ClickHouseQueryBuilder(QueryBuilder):
    QUERY_CLS = ClickHouseQuery

    @staticmethod
    def _delete_sql(**kwargs: Any) -> str:
        return 'ALTER TABLE'

    def _update_sql(self, **kwargs: Any) -> str:
        return "ALTER TABLE {table}".format(table=self._update_table.get_sql(**kwargs))

    def _from_sql(self, with_namespace: bool = False, **kwargs: Any) -> str:
        selectable = ",".join(clause.get_sql(subquery=True, with_alias=True, **kwargs) for clause in self._from)
        if self._delete_from:
            return " {selectable} DELETE".format(selectable=selectable)
        return " FROM {selectable}".format(selectable=selectable)

    def _set_sql(self, **kwargs: Any) -> str:
        return " UPDATE {set}".format(
            set=",".join(
                "{field}={value}".format(
                    field=field.get_sql(**dict(kwargs, with_namespace=False)), value=value.get_sql(**kwargs)
                )
                for field, value in self._updates
            )
        )


class ClickHouseDropQueryBuilder(DropQueryBuilder):
    QUERY_CLS = ClickHouseQuery

    def __init__(self):
        super().__init__(dialect=Dialects.CLICKHOUSE)
        self._cluster_name = None

    @builder
    def drop_dictionary(self, dictionary: str) -> "ClickHouseDropQueryBuilder":
        super()._set_target('DICTIONARY', dictionary)

    @builder
    def drop_quota(self, quota: str) -> "ClickHouseDropQueryBuilder":
        super()._set_target('QUOTA', quota)

    @builder
    def on_cluster(self, cluster: str) -> "ClickHouseDropQueryBuilder":
        if self._cluster_name:
            raise AttributeError("'DropQuery' object already has attribute cluster_name")
        self._cluster_name = cluster

    def get_sql(self, **kwargs: Any) -> str:
        query = super().get_sql(**kwargs)

        if self._drop_target_kind != "DICTIONARY" and self._cluster_name is not None:
            query += " ON CLUSTER " + format_quotes(self._cluster_name, super().QUOTE_CHAR)

        return query


class SQLLiteValueWrapper(ValueWrapper):
    def get_value_sql(self, **kwargs: Any) -> str:
        if isinstance(self.value, bool):
            return "1" if self.value else "0"
        return super().get_value_sql(**kwargs)


class SQLLiteQuery(Query):
    """
    Defines a query class for use with Microsoft SQL Server.
    """

    @classmethod
    def _builder(cls, **kwargs: Any) -> "SQLLiteQueryBuilder":
        return SQLLiteQueryBuilder(**kwargs)


class SQLLiteQueryBuilder(QueryBuilder):
    QUERY_CLS = SQLLiteQuery

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(dialect=Dialects.SQLLITE, wrapper_cls=SQLLiteValueWrapper, **kwargs)
        self._insert_or_replace = False

    @builder
    def insert_or_replace(self, *terms: Any) -> "SQLLiteQueryBuilder":
        self._apply_terms(*terms)
        self._replace = True
        self._insert_or_replace = True

    def _replace_sql(self, **kwargs: Any) -> str:
        prefix = "INSERT OR " if self._insert_or_replace else ""
        return prefix + super()._replace_sql(**kwargs)
