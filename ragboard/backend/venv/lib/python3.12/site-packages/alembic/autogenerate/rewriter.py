from __future__ import annotations

from typing import Any
from typing import Callable
from typing import Iterator
from typing import List
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import Union

from .. import util
from ..operations import ops

if TYPE_CHECKING:
    from ..operations.ops import AddColumnOp
    from ..operations.ops import AlterColumnOp
    from ..operations.ops import CreateTableOp
    from ..operations.ops import DowngradeOps
    from ..operations.ops import MigrateOperation
    from ..operations.ops import MigrationScript
    from ..operations.ops import ModifyTableOps
    from ..operations.ops import OpContainer
    from ..operations.ops import UpgradeOps
    from ..runtime.migration import MigrationContext
    from ..script.revision import _GetRevArg

ProcessRevisionDirectiveFn = Callable[
    ["MigrationContext", "_GetRevArg", List["MigrationScript"]], None
]


class Rewriter:
    """A helper object that allows easy 'rewriting' of ops streams.

    The :class:`.Rewriter` object is intended to be passed along
    to the
    :paramref:`.EnvironmentContext.configure.process_revision_directives`
    parameter in an ``env.py`` script.    Once constructed, any number
    of "rewrites" functions can be associated with it, which will be given
    the opportunity to modify the structure without having to have explicit
    knowledge of the overall structure.

    The function is passed the :class:`.MigrationContext` object and
    ``revision`` tuple that are passed to the  :paramref:`.Environment
    Context.configure.process_revision_directives` function normally,
    and the third argument is an individual directive of the type
    noted in the decorator.  The function has the choice of  returning
    a single op directive, which normally can be the directive that
    was actually passed, or a new directive to replace it, or a list
    of zero or more directives to replace it.

    .. seealso::

        :ref:`autogen_rewriter` - usage example

    """

    _traverse = util.Dispatcher()

    _chained: Tuple[Union[ProcessRevisionDirectiveFn, Rewriter], ...] = ()

    def __init__(self) -> None:
        self.dispatch = util.Dispatcher()

    def chain(
        self,
        other: Union[
            ProcessRevisionDirectiveFn,
            Rewriter,
        ],
    ) -> Rewriter:
        """Produce a "chain" of this :class:`.Rewriter` to another.

        This allows two or more rewriters to operate serially on a stream,
        e.g.::

            writer1 = autogenerate.Rewriter()
            writer2 = autogenerate.Rewriter()


            @writer1.rewrites(ops.AddColumnOp)
            def add_column_nullable(context, revision, op):
                op.column.nullable = True
                return op


            @writer2.rewrites(ops.AddColumnOp)
            def add_column_idx(context, revision, op):
                idx_op = ops.CreateIndexOp(
                    "ixc", op.table_name, [op.column.name]
                )
                return [op, idx_op]

            writer = writer1.chain(writer2)

        :param other: a :class:`.Rewriter` instance
        :return: a new :class:`.Rewriter` that will run the operations
         of this writer, then the "other" writer, in succession.

        """
        wr = self.__class__.__new__(self.__class__)
        wr.__dict__.update(self.__dict__)
        wr._chained += (other,)
        return wr

    def rewrites(
        self,
        operator: Union[
            Type[AddColumnOp],
            Type[MigrateOperation],
            Type[AlterColumnOp],
            Type[CreateTableOp],
            Type[ModifyTableOps],
        ],
    ) -> Callable[..., Any]:
        """Register a function as rewriter for a given type.

        The function should receive three arguments, which are
        the :class:`.MigrationContext`, a ``revision`` tuple, and
        an op directive of the type indicated.  E.g.::

            @writer1.rewrites(ops.AddColumnOp)
            def add_column_nullable(context, revision, op):
                op.column.nullable = True
                return op

        """
        return self.dispatch.dispatch_for(operator)

    def _rewrite(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directive: MigrateOperation,
    ) -> Iterator[MigrateOperation]:
        try:
            _rewriter = self.dispatch.dispatch(directive)
        except ValueError:
            _rewriter = None
            yield directive
        else:
            if self in directive._mutations:
                yield directive
            else:
                for r_directive in util.to_list(
                    _rewriter(context, revision, directive), []
                ):
                    r_directive._mutations = r_directive._mutations.union(
                        [self]
                    )
                    yield r_directive

    def __call__(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directives: List[MigrationScript],
    ) -> None:
        self.process_revision_directives(context, revision, directives)
        for process_revision_directives in self._chained:
            process_revision_directives(context, revision, directives)

    @_traverse.dispatch_for(ops.MigrationScript)
    def _traverse_script(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directive: MigrationScript,
    ) -> None:
        upgrade_ops_list: List[UpgradeOps] = []
        for upgrade_ops in directive.upgrade_ops_list:
            ret = self._traverse_for(context, revision, upgrade_ops)
            if len(ret) != 1:
                raise ValueError(
                    "Can only return single object for UpgradeOps traverse"
                )
            upgrade_ops_list.append(ret[0])

        directive.upgrade_ops = upgrade_ops_list  # type: ignore

        downgrade_ops_list: List[DowngradeOps] = []
        for downgrade_ops in directive.downgrade_ops_list:
            ret = self._traverse_for(context, revision, downgrade_ops)
            if len(ret) != 1:
                raise ValueError(
                    "Can only return single object for DowngradeOps traverse"
                )
            downgrade_ops_list.append(ret[0])
        directive.downgrade_ops = downgrade_ops_list  # type: ignore

    @_traverse.dispatch_for(ops.OpContainer)
    def _traverse_op_container(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directive: OpContainer,
    ) -> None:
        self._traverse_list(context, revision, directive.ops)

    @_traverse.dispatch_for(ops.MigrateOperation)
    def _traverse_any_directive(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directive: MigrateOperation,
    ) -> None:
        pass

    def _traverse_for(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directive: MigrateOperation,
    ) -> Any:
        directives = list(self._rewrite(context, revision, directive))
        for directive in directives:
            traverser = self._traverse.dispatch(directive)
            traverser(self, context, revision, directive)
        return directives

    def _traverse_list(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directives: Any,
    ) -> None:
        dest = []
        for directive in directives:
            dest.extend(self._traverse_for(context, revision, directive))

        directives[:] = dest

    def process_revision_directives(
        self,
        context: MigrationContext,
        revision: _GetRevArg,
        directives: List[MigrationScript],
    ) -> None:
        self._traverse_list(context, revision, directives)
