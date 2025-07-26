# mypy: allow-untyped-defs, allow-incomplete-defs, allow-untyped-calls
# mypy: no-warn-return-any, allow-any-generics

from __future__ import annotations

from typing import Any
from typing import ClassVar
from typing import Dict
from typing import Generic
from typing import NamedTuple
from typing import Optional
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from sqlalchemy.sql.schema import Constraint
from sqlalchemy.sql.schema import ForeignKeyConstraint
from sqlalchemy.sql.schema import Index
from sqlalchemy.sql.schema import UniqueConstraint
from typing_extensions import TypeGuard

from .. import util
from ..util import sqla_compat

if TYPE_CHECKING:
    from typing import Literal

    from alembic.autogenerate.api import AutogenContext
    from alembic.ddl.impl import DefaultImpl

CompareConstraintType = Union[Constraint, Index]

_C = TypeVar("_C", bound=CompareConstraintType)

_clsreg: Dict[str, Type[_constraint_sig]] = {}


class ComparisonResult(NamedTuple):
    status: Literal["equal", "different", "skip"]
    message: str

    @property
    def is_equal(self) -> bool:
        return self.status == "equal"

    @property
    def is_different(self) -> bool:
        return self.status == "different"

    @property
    def is_skip(self) -> bool:
        return self.status == "skip"

    @classmethod
    def Equal(cls) -> ComparisonResult:
        """the constraints are equal."""
        return cls("equal", "The two constraints are equal")

    @classmethod
    def Different(cls, reason: Union[str, Sequence[str]]) -> ComparisonResult:
        """the constraints are different for the provided reason(s)."""
        return cls("different", ", ".join(util.to_list(reason)))

    @classmethod
    def Skip(cls, reason: Union[str, Sequence[str]]) -> ComparisonResult:
        """the constraint cannot be compared for the provided reason(s).

        The message is logged, but the constraints will be otherwise
        considered equal, meaning that no migration command will be
        generated.
        """
        return cls("skip", ", ".join(util.to_list(reason)))


class _constraint_sig(Generic[_C]):
    const: _C

    _sig: Tuple[Any, ...]
    name: Optional[sqla_compat._ConstraintNameDefined]

    impl: DefaultImpl

    _is_index: ClassVar[bool] = False
    _is_fk: ClassVar[bool] = False
    _is_uq: ClassVar[bool] = False

    _is_metadata: bool

    def __init_subclass__(cls) -> None:
        cls._register()

    @classmethod
    def _register(cls):
        raise NotImplementedError()

    def __init__(
        self, is_metadata: bool, impl: DefaultImpl, const: _C
    ) -> None:
        raise NotImplementedError()

    def compare_to_reflected(
        self, other: _constraint_sig[Any]
    ) -> ComparisonResult:
        assert self.impl is other.impl
        assert self._is_metadata
        assert not other._is_metadata

        return self._compare_to_reflected(other)

    def _compare_to_reflected(
        self, other: _constraint_sig[_C]
    ) -> ComparisonResult:
        raise NotImplementedError()

    @classmethod
    def from_constraint(
        cls, is_metadata: bool, impl: DefaultImpl, constraint: _C
    ) -> _constraint_sig[_C]:
        # these could be cached by constraint/impl, however, if the
        # constraint is modified in place, then the sig is wrong.  the mysql
        # impl currently does this, and if we fixed that we can't be sure
        # someone else might do it too, so play it safe.
        sig = _clsreg[constraint.__visit_name__](is_metadata, impl, constraint)
        return sig

    def md_name_to_sql_name(self, context: AutogenContext) -> Optional[str]:
        return sqla_compat._get_constraint_final_name(
            self.const, context.dialect
        )

    @util.memoized_property
    def is_named(self):
        return sqla_compat._constraint_is_named(self.const, self.impl.dialect)

    @util.memoized_property
    def unnamed(self) -> Tuple[Any, ...]:
        return self._sig

    @util.memoized_property
    def unnamed_no_options(self) -> Tuple[Any, ...]:
        raise NotImplementedError()

    @util.memoized_property
    def _full_sig(self) -> Tuple[Any, ...]:
        return (self.name,) + self.unnamed

    def __eq__(self, other) -> bool:
        return self._full_sig == other._full_sig

    def __ne__(self, other) -> bool:
        return self._full_sig != other._full_sig

    def __hash__(self) -> int:
        return hash(self._full_sig)


class _uq_constraint_sig(_constraint_sig[UniqueConstraint]):
    _is_uq = True

    @classmethod
    def _register(cls) -> None:
        _clsreg["unique_constraint"] = cls

    is_unique = True

    def __init__(
        self,
        is_metadata: bool,
        impl: DefaultImpl,
        const: UniqueConstraint,
    ) -> None:
        self.impl = impl
        self.const = const
        self.name = sqla_compat.constraint_name_or_none(const.name)
        self._sig = tuple(sorted([col.name for col in const.columns]))
        self._is_metadata = is_metadata

    @property
    def column_names(self) -> Tuple[str, ...]:
        return tuple([col.name for col in self.const.columns])

    def _compare_to_reflected(
        self, other: _constraint_sig[_C]
    ) -> ComparisonResult:
        assert self._is_metadata
        metadata_obj = self
        conn_obj = other

        assert is_uq_sig(conn_obj)
        return self.impl.compare_unique_constraint(
            metadata_obj.const, conn_obj.const
        )


class _ix_constraint_sig(_constraint_sig[Index]):
    _is_index = True

    name: sqla_compat._ConstraintName

    @classmethod
    def _register(cls) -> None:
        _clsreg["index"] = cls

    def __init__(
        self, is_metadata: bool, impl: DefaultImpl, const: Index
    ) -> None:
        self.impl = impl
        self.const = const
        self.name = const.name
        self.is_unique = bool(const.unique)
        self._is_metadata = is_metadata

    def _compare_to_reflected(
        self, other: _constraint_sig[_C]
    ) -> ComparisonResult:
        assert self._is_metadata
        metadata_obj = self
        conn_obj = other

        assert is_index_sig(conn_obj)
        return self.impl.compare_indexes(metadata_obj.const, conn_obj.const)

    @util.memoized_property
    def has_expressions(self):
        return sqla_compat.is_expression_index(self.const)

    @util.memoized_property
    def column_names(self) -> Tuple[str, ...]:
        return tuple([col.name for col in self.const.columns])

    @util.memoized_property
    def column_names_optional(self) -> Tuple[Optional[str], ...]:
        return tuple(
            [getattr(col, "name", None) for col in self.const.expressions]
        )

    @util.memoized_property
    def is_named(self):
        return True

    @util.memoized_property
    def unnamed(self):
        return (self.is_unique,) + self.column_names_optional


class _fk_constraint_sig(_constraint_sig[ForeignKeyConstraint]):
    _is_fk = True

    @classmethod
    def _register(cls) -> None:
        _clsreg["foreign_key_constraint"] = cls

    def __init__(
        self,
        is_metadata: bool,
        impl: DefaultImpl,
        const: ForeignKeyConstraint,
    ) -> None:
        self._is_metadata = is_metadata

        self.impl = impl
        self.const = const

        self.name = sqla_compat.constraint_name_or_none(const.name)

        (
            self.source_schema,
            self.source_table,
            self.source_columns,
            self.target_schema,
            self.target_table,
            self.target_columns,
            onupdate,
            ondelete,
            deferrable,
            initially,
        ) = sqla_compat._fk_spec(const)

        self._sig: Tuple[Any, ...] = (
            self.source_schema,
            self.source_table,
            tuple(self.source_columns),
            self.target_schema,
            self.target_table,
            tuple(self.target_columns),
        ) + (
            (None if onupdate.lower() == "no action" else onupdate.lower())
            if onupdate
            else None,
            (None if ondelete.lower() == "no action" else ondelete.lower())
            if ondelete
            else None,
            # convert initially + deferrable into one three-state value
            "initially_deferrable"
            if initially and initially.lower() == "deferred"
            else "deferrable"
            if deferrable
            else "not deferrable",
        )

    @util.memoized_property
    def unnamed_no_options(self):
        return (
            self.source_schema,
            self.source_table,
            tuple(self.source_columns),
            self.target_schema,
            self.target_table,
            tuple(self.target_columns),
        )


def is_index_sig(sig: _constraint_sig) -> TypeGuard[_ix_constraint_sig]:
    return sig._is_index


def is_uq_sig(sig: _constraint_sig) -> TypeGuard[_uq_constraint_sig]:
    return sig._is_uq


def is_fk_sig(sig: _constraint_sig) -> TypeGuard[_fk_constraint_sig]:
    return sig._is_fk
