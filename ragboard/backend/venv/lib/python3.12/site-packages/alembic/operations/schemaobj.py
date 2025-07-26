# mypy: allow-untyped-defs, allow-incomplete-defs, allow-untyped-calls
# mypy: no-warn-return-any, allow-any-generics

from __future__ import annotations

from typing import Any
from typing import Dict
from typing import List
from typing import Optional
from typing import Sequence
from typing import Tuple
from typing import TYPE_CHECKING
from typing import Union

from sqlalchemy import schema as sa_schema
from sqlalchemy.sql.schema import Column
from sqlalchemy.sql.schema import Constraint
from sqlalchemy.sql.schema import Index
from sqlalchemy.types import Integer
from sqlalchemy.types import NULLTYPE

from .. import util
from ..util import sqla_compat

if TYPE_CHECKING:
    from sqlalchemy.sql.elements import ColumnElement
    from sqlalchemy.sql.elements import TextClause
    from sqlalchemy.sql.schema import CheckConstraint
    from sqlalchemy.sql.schema import ForeignKey
    from sqlalchemy.sql.schema import ForeignKeyConstraint
    from sqlalchemy.sql.schema import MetaData
    from sqlalchemy.sql.schema import PrimaryKeyConstraint
    from sqlalchemy.sql.schema import Table
    from sqlalchemy.sql.schema import UniqueConstraint
    from sqlalchemy.sql.type_api import TypeEngine

    from ..runtime.migration import MigrationContext


class SchemaObjects:
    def __init__(
        self, migration_context: Optional[MigrationContext] = None
    ) -> None:
        self.migration_context = migration_context

    def primary_key_constraint(
        self,
        name: Optional[sqla_compat._ConstraintNameDefined],
        table_name: str,
        cols: Sequence[str],
        schema: Optional[str] = None,
        **dialect_kw,
    ) -> PrimaryKeyConstraint:
        m = self.metadata()
        columns = [sa_schema.Column(n, NULLTYPE) for n in cols]
        t = sa_schema.Table(table_name, m, *columns, schema=schema)
        # SQLAlchemy primary key constraint name arg is wrongly typed on
        # the SQLAlchemy side through 2.0.5 at least
        p = sa_schema.PrimaryKeyConstraint(
            *[t.c[n] for n in cols], name=name, **dialect_kw  # type: ignore
        )
        return p

    def foreign_key_constraint(
        self,
        name: Optional[sqla_compat._ConstraintNameDefined],
        source: str,
        referent: str,
        local_cols: List[str],
        remote_cols: List[str],
        onupdate: Optional[str] = None,
        ondelete: Optional[str] = None,
        deferrable: Optional[bool] = None,
        source_schema: Optional[str] = None,
        referent_schema: Optional[str] = None,
        initially: Optional[str] = None,
        match: Optional[str] = None,
        **dialect_kw,
    ) -> ForeignKeyConstraint:
        m = self.metadata()
        if source == referent and source_schema == referent_schema:
            t1_cols = local_cols + remote_cols
        else:
            t1_cols = local_cols
            sa_schema.Table(
                referent,
                m,
                *[sa_schema.Column(n, NULLTYPE) for n in remote_cols],
                schema=referent_schema,
            )

        t1 = sa_schema.Table(
            source,
            m,
            *[
                sa_schema.Column(n, NULLTYPE)
                for n in util.unique_list(t1_cols)
            ],
            schema=source_schema,
        )

        tname = (
            "%s.%s" % (referent_schema, referent)
            if referent_schema
            else referent
        )

        dialect_kw["match"] = match

        f = sa_schema.ForeignKeyConstraint(
            local_cols,
            ["%s.%s" % (tname, n) for n in remote_cols],
            name=name,
            onupdate=onupdate,
            ondelete=ondelete,
            deferrable=deferrable,
            initially=initially,
            **dialect_kw,
        )
        t1.append_constraint(f)

        return f

    def unique_constraint(
        self,
        name: Optional[sqla_compat._ConstraintNameDefined],
        source: str,
        local_cols: Sequence[str],
        schema: Optional[str] = None,
        **kw,
    ) -> UniqueConstraint:
        t = sa_schema.Table(
            source,
            self.metadata(),
            *[sa_schema.Column(n, NULLTYPE) for n in local_cols],
            schema=schema,
        )
        kw["name"] = name
        uq = sa_schema.UniqueConstraint(*[t.c[n] for n in local_cols], **kw)
        # TODO: need event tests to ensure the event
        # is fired off here
        t.append_constraint(uq)
        return uq

    def check_constraint(
        self,
        name: Optional[sqla_compat._ConstraintNameDefined],
        source: str,
        condition: Union[str, TextClause, ColumnElement[Any]],
        schema: Optional[str] = None,
        **kw,
    ) -> Union[CheckConstraint]:
        t = sa_schema.Table(
            source,
            self.metadata(),
            sa_schema.Column("x", Integer),
            schema=schema,
        )
        ck = sa_schema.CheckConstraint(condition, name=name, **kw)
        t.append_constraint(ck)
        return ck

    def generic_constraint(
        self,
        name: Optional[sqla_compat._ConstraintNameDefined],
        table_name: str,
        type_: Optional[str],
        schema: Optional[str] = None,
        **kw,
    ) -> Any:
        t = self.table(table_name, schema=schema)
        types: Dict[Optional[str], Any] = {
            "foreignkey": lambda name: sa_schema.ForeignKeyConstraint(
                [], [], name=name
            ),
            "primary": sa_schema.PrimaryKeyConstraint,
            "unique": sa_schema.UniqueConstraint,
            "check": lambda name: sa_schema.CheckConstraint("", name=name),
            None: sa_schema.Constraint,
        }
        try:
            const = types[type_]
        except KeyError as ke:
            raise TypeError(
                "'type' can be one of %s"
                % ", ".join(sorted(repr(x) for x in types))
            ) from ke
        else:
            const = const(name=name)
            t.append_constraint(const)
            return const

    def metadata(self) -> MetaData:
        kw = {}
        if (
            self.migration_context is not None
            and "target_metadata" in self.migration_context.opts
        ):
            mt = self.migration_context.opts["target_metadata"]
            if hasattr(mt, "naming_convention"):
                kw["naming_convention"] = mt.naming_convention
        return sa_schema.MetaData(**kw)

    def table(self, name: str, *columns, **kw) -> Table:
        m = self.metadata()

        cols = [
            sqla_compat._copy(c) if c.table is not None else c
            for c in columns
            if isinstance(c, Column)
        ]
        # these flags have already added their UniqueConstraint /
        # Index objects to the table, so flip them off here.
        # SQLAlchemy tometadata() avoids this instead by preserving the
        # flags and skipping the constraints that have _type_bound on them,
        # but for a migration we'd rather list out the constraints
        # explicitly.
        _constraints_included = kw.pop("_constraints_included", False)
        if _constraints_included:
            for c in cols:
                c.unique = c.index = False

        t = sa_schema.Table(name, m, *cols, **kw)

        constraints = [
            sqla_compat._copy(elem, target_table=t)
            if getattr(elem, "parent", None) is not t
            and getattr(elem, "parent", None) is not None
            else elem
            for elem in columns
            if isinstance(elem, (Constraint, Index))
        ]

        for const in constraints:
            t.append_constraint(const)

        for f in t.foreign_keys:
            self._ensure_table_for_fk(m, f)
        return t

    def column(self, name: str, type_: TypeEngine, **kw) -> Column:
        return sa_schema.Column(name, type_, **kw)

    def index(
        self,
        name: Optional[str],
        tablename: Optional[str],
        columns: Sequence[Union[str, TextClause, ColumnElement[Any]]],
        schema: Optional[str] = None,
        **kw,
    ) -> Index:
        t = sa_schema.Table(
            tablename or "no_table",
            self.metadata(),
            schema=schema,
        )
        kw["_table"] = t
        idx = sa_schema.Index(
            name,
            *[util.sqla_compat._textual_index_column(t, n) for n in columns],
            **kw,
        )
        return idx

    def _parse_table_key(self, table_key: str) -> Tuple[Optional[str], str]:
        if "." in table_key:
            tokens = table_key.split(".")
            sname: Optional[str] = ".".join(tokens[0:-1])
            tname = tokens[-1]
        else:
            tname = table_key
            sname = None
        return (sname, tname)

    def _ensure_table_for_fk(self, metadata: MetaData, fk: ForeignKey) -> None:
        """create a placeholder Table object for the referent of a
        ForeignKey.

        """
        if isinstance(fk._colspec, str):
            table_key, cname = fk._colspec.rsplit(".", 1)
            sname, tname = self._parse_table_key(table_key)
            if table_key not in metadata.tables:
                rel_t = sa_schema.Table(tname, metadata, schema=sname)
            else:
                rel_t = metadata.tables[table_key]
            if cname not in rel_t.c:
                rel_t.append_column(sa_schema.Column(cname, NULLTYPE))
