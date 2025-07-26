# exc.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Exceptions used with SQLAlchemy.

The base exception class is :exc:`.SQLAlchemyError`.  Exceptions which are
raised as a result of DBAPI exceptions are all subclasses of
:exc:`.DBAPIError`.

"""
from __future__ import annotations

import typing
from typing import Any
from typing import List
from typing import Optional
from typing import overload
from typing import Tuple
from typing import Type
from typing import Union

from .util import compat
from .util import preloaded as _preloaded

if typing.TYPE_CHECKING:
    from .engine.interfaces import _AnyExecuteParams
    from .engine.interfaces import Dialect
    from .sql.compiler import Compiled
    from .sql.compiler import TypeCompiler
    from .sql.elements import ClauseElement

if typing.TYPE_CHECKING:
    _version_token: str
else:
    # set by __init__.py
    _version_token = None


class HasDescriptionCode:
    """helper which adds 'code' as an attribute and '_code_str' as a method"""

    code: Optional[str] = None

    def __init__(self, *arg: Any, **kw: Any):
        code = kw.pop("code", None)
        if code is not None:
            self.code = code
        super().__init__(*arg, **kw)

    _what_are_we = "error"

    def _code_str(self) -> str:
        if not self.code:
            return ""
        else:
            return (
                f"(Background on this {self._what_are_we} at: "
                f"https://sqlalche.me/e/{_version_token}/{self.code})"
            )

    def __str__(self) -> str:
        message = super().__str__()
        if self.code:
            message = "%s %s" % (message, self._code_str())
        return message


class SQLAlchemyError(HasDescriptionCode, Exception):
    """Generic error class."""

    def _message(self) -> str:
        # rules:
        #
        # 1. single arg string will usually be a unicode
        # object, but since __str__() must return unicode, check for
        # bytestring just in case
        #
        # 2. for multiple self.args, this is not a case in current
        # SQLAlchemy though this is happening in at least one known external
        # library, call str() which does a repr().
        #
        text: str

        if len(self.args) == 1:
            arg_text = self.args[0]

            if isinstance(arg_text, bytes):
                text = compat.decode_backslashreplace(arg_text, "utf-8")
            # This is for when the argument is not a string of any sort.
            # Otherwise, converting this exception to string would fail for
            # non-string arguments.
            else:
                text = str(arg_text)

            return text
        else:
            # this is not a normal case within SQLAlchemy but is here for
            # compatibility with Exception.args - the str() comes out as
            # a repr() of the tuple
            return str(self.args)

    def _sql_message(self) -> str:
        message = self._message()

        if self.code:
            message = "%s %s" % (message, self._code_str())

        return message

    def __str__(self) -> str:
        return self._sql_message()


class ArgumentError(SQLAlchemyError):
    """Raised when an invalid or conflicting function argument is supplied.

    This error generally corresponds to construction time state errors.

    """


class DuplicateColumnError(ArgumentError):
    """a Column is being added to a Table that would replace another
    Column, without appropriate parameters to allow this in place.

    .. versionadded:: 2.0.0b4

    """


class ObjectNotExecutableError(ArgumentError):
    """Raised when an object is passed to .execute() that can't be
    executed as SQL.

    """

    def __init__(self, target: Any):
        super().__init__("Not an executable object: %r" % target)
        self.target = target

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return self.__class__, (self.target,)


class NoSuchModuleError(ArgumentError):
    """Raised when a dynamically-loaded module (usually a database dialect)
    of a particular name cannot be located."""


class NoForeignKeysError(ArgumentError):
    """Raised when no foreign keys can be located between two selectables
    during a join."""


class AmbiguousForeignKeysError(ArgumentError):
    """Raised when more than one foreign key matching can be located
    between two selectables during a join."""


class ConstraintColumnNotFoundError(ArgumentError):
    """raised when a constraint refers to a string column name that
    is not present in the table being constrained.

    .. versionadded:: 2.0

    """


class CircularDependencyError(SQLAlchemyError):
    """Raised by topological sorts when a circular dependency is detected.

    There are two scenarios where this error occurs:

    * In a Session flush operation, if two objects are mutually dependent
      on each other, they can not be inserted or deleted via INSERT or
      DELETE statements alone; an UPDATE will be needed to post-associate
      or pre-deassociate one of the foreign key constrained values.
      The ``post_update`` flag described at :ref:`post_update` can resolve
      this cycle.
    * In a :attr:`_schema.MetaData.sorted_tables` operation, two
      :class:`_schema.ForeignKey`
      or :class:`_schema.ForeignKeyConstraint` objects mutually refer to each
      other.  Apply the ``use_alter=True`` flag to one or both,
      see :ref:`use_alter`.

    """

    def __init__(
        self,
        message: str,
        cycles: Any,
        edges: Any,
        msg: Optional[str] = None,
        code: Optional[str] = None,
    ):
        if msg is None:
            message += " (%s)" % ", ".join(repr(s) for s in cycles)
        else:
            message = msg
        SQLAlchemyError.__init__(self, message, code=code)
        self.cycles = cycles
        self.edges = edges

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return (
            self.__class__,
            (None, self.cycles, self.edges, self.args[0]),
            {"code": self.code} if self.code is not None else {},
        )


class CompileError(SQLAlchemyError):
    """Raised when an error occurs during SQL compilation"""


class UnsupportedCompilationError(CompileError):
    """Raised when an operation is not supported by the given compiler.

    .. seealso::

        :ref:`faq_sql_expression_string`

        :ref:`error_l7de`
    """

    code = "l7de"

    def __init__(
        self,
        compiler: Union[Compiled, TypeCompiler],
        element_type: Type[ClauseElement],
        message: Optional[str] = None,
    ):
        super().__init__(
            "Compiler %r can't render element of type %s%s"
            % (compiler, element_type, ": %s" % message if message else "")
        )
        self.compiler = compiler
        self.element_type = element_type
        self.message = message

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return self.__class__, (self.compiler, self.element_type, self.message)


class IdentifierError(SQLAlchemyError):
    """Raised when a schema name is beyond the max character limit"""


class DisconnectionError(SQLAlchemyError):
    """A disconnect is detected on a raw DB-API connection.

    This error is raised and consumed internally by a connection pool.  It can
    be raised by the :meth:`_events.PoolEvents.checkout`
    event so that the host pool
    forces a retry; the exception will be caught three times in a row before
    the pool gives up and raises :class:`~sqlalchemy.exc.InvalidRequestError`
    regarding the connection attempt.

    """

    invalidate_pool: bool = False


class InvalidatePoolError(DisconnectionError):
    """Raised when the connection pool should invalidate all stale connections.

    A subclass of :class:`_exc.DisconnectionError` that indicates that the
    disconnect situation encountered on the connection probably means the
    entire pool should be invalidated, as the database has been restarted.

    This exception will be handled otherwise the same way as
    :class:`_exc.DisconnectionError`, allowing three attempts to reconnect
    before giving up.

    .. versionadded:: 1.2

    """

    invalidate_pool: bool = True


class TimeoutError(SQLAlchemyError):  # noqa
    """Raised when a connection pool times out on getting a connection."""


class InvalidRequestError(SQLAlchemyError):
    """SQLAlchemy was asked to do something it can't do.

    This error generally corresponds to runtime state errors.

    """


class IllegalStateChangeError(InvalidRequestError):
    """An object that tracks state encountered an illegal state change
    of some kind.

    .. versionadded:: 2.0

    """


class NoInspectionAvailable(InvalidRequestError):
    """A subject passed to :func:`sqlalchemy.inspection.inspect` produced
    no context for inspection."""


class PendingRollbackError(InvalidRequestError):
    """A transaction has failed and needs to be rolled back before
    continuing.

    .. versionadded:: 1.4

    """


class ResourceClosedError(InvalidRequestError):
    """An operation was requested from a connection, cursor, or other
    object that's in a closed state."""


class NoSuchColumnError(InvalidRequestError, KeyError):
    """A nonexistent column is requested from a ``Row``."""


class NoResultFound(InvalidRequestError):
    """A database result was required but none was found.


    .. versionchanged:: 1.4  This exception is now part of the
       ``sqlalchemy.exc`` module in Core, moved from the ORM.  The symbol
       remains importable from ``sqlalchemy.orm.exc``.


    """


class MultipleResultsFound(InvalidRequestError):
    """A single database result was required but more than one were found.

    .. versionchanged:: 1.4  This exception is now part of the
       ``sqlalchemy.exc`` module in Core, moved from the ORM.  The symbol
       remains importable from ``sqlalchemy.orm.exc``.


    """


class NoReferenceError(InvalidRequestError):
    """Raised by ``ForeignKey`` to indicate a reference cannot be resolved."""

    table_name: str


class AwaitRequired(InvalidRequestError):
    """Error raised by the async greenlet spawn if no async operation
    was awaited when it required one.

    """

    code = "xd1r"


class MissingGreenlet(InvalidRequestError):
    r"""Error raised by the async greenlet await\_ if called while not inside
    the greenlet spawn context.

    """

    code = "xd2s"


class NoReferencedTableError(NoReferenceError):
    """Raised by ``ForeignKey`` when the referred ``Table`` cannot be
    located.

    """

    def __init__(self, message: str, tname: str):
        NoReferenceError.__init__(self, message)
        self.table_name = tname

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return self.__class__, (self.args[0], self.table_name)


class NoReferencedColumnError(NoReferenceError):
    """Raised by ``ForeignKey`` when the referred ``Column`` cannot be
    located.

    """

    def __init__(self, message: str, tname: str, cname: str):
        NoReferenceError.__init__(self, message)
        self.table_name = tname
        self.column_name = cname

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return (
            self.__class__,
            (self.args[0], self.table_name, self.column_name),
        )


class NoSuchTableError(InvalidRequestError):
    """Table does not exist or is not visible to a connection."""


class UnreflectableTableError(InvalidRequestError):
    """Table exists but can't be reflected for some reason.

    .. versionadded:: 1.2

    """


class UnboundExecutionError(InvalidRequestError):
    """SQL was attempted without a database connection to execute it on."""


class DontWrapMixin:
    """A mixin class which, when applied to a user-defined Exception class,
    will not be wrapped inside of :exc:`.StatementError` if the error is
    emitted within the process of executing a statement.

    E.g.::

        from sqlalchemy.exc import DontWrapMixin

        class MyCustomException(Exception, DontWrapMixin):
            pass

        class MySpecialType(TypeDecorator):
            impl = String

            def process_bind_param(self, value, dialect):
                if value == 'invalid':
                    raise MyCustomException("invalid!")

    """


class StatementError(SQLAlchemyError):
    """An error occurred during execution of a SQL statement.

    :class:`StatementError` wraps the exception raised
    during execution, and features :attr:`.statement`
    and :attr:`.params` attributes which supply context regarding
    the specifics of the statement which had an issue.

    The wrapped exception object is available in
    the :attr:`.orig` attribute.

    """

    statement: Optional[str] = None
    """The string SQL statement being invoked when this exception occurred."""

    params: Optional[_AnyExecuteParams] = None
    """The parameter list being used when this exception occurred."""

    orig: Optional[BaseException] = None
    """The original exception that was thrown.

    """

    ismulti: Optional[bool] = None
    """multi parameter passed to repr_params().  None is meaningful."""

    connection_invalidated: bool = False

    def __init__(
        self,
        message: str,
        statement: Optional[str],
        params: Optional[_AnyExecuteParams],
        orig: Optional[BaseException],
        hide_parameters: bool = False,
        code: Optional[str] = None,
        ismulti: Optional[bool] = None,
    ):
        SQLAlchemyError.__init__(self, message, code=code)
        self.statement = statement
        self.params = params
        self.orig = orig
        self.ismulti = ismulti
        self.hide_parameters = hide_parameters
        self.detail: List[str] = []

    def add_detail(self, msg: str) -> None:
        self.detail.append(msg)

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return (
            self.__class__,
            (
                self.args[0],
                self.statement,
                self.params,
                self.orig,
                self.hide_parameters,
                self.__dict__.get("code"),
                self.ismulti,
            ),
            {"detail": self.detail},
        )

    @_preloaded.preload_module("sqlalchemy.sql.util")
    def _sql_message(self) -> str:
        util = _preloaded.sql_util

        details = [self._message()]
        if self.statement:
            stmt_detail = "[SQL: %s]" % self.statement
            details.append(stmt_detail)
            if self.params:
                if self.hide_parameters:
                    details.append(
                        "[SQL parameters hidden due to hide_parameters=True]"
                    )
                else:
                    params_repr = util._repr_params(
                        self.params, 10, ismulti=self.ismulti
                    )
                    details.append("[parameters: %r]" % params_repr)
        code_str = self._code_str()
        if code_str:
            details.append(code_str)
        return "\n".join(["(%s)" % det for det in self.detail] + details)


class DBAPIError(StatementError):
    """Raised when the execution of a database operation fails.

    Wraps exceptions raised by the DB-API underlying the
    database operation.  Driver-specific implementations of the standard
    DB-API exception types are wrapped by matching sub-types of SQLAlchemy's
    :class:`DBAPIError` when possible.  DB-API's ``Error`` type maps to
    :class:`DBAPIError` in SQLAlchemy, otherwise the names are identical.  Note
    that there is no guarantee that different DB-API implementations will
    raise the same exception type for any given error condition.

    :class:`DBAPIError` features :attr:`~.StatementError.statement`
    and :attr:`~.StatementError.params` attributes which supply context
    regarding the specifics of the statement which had an issue, for the
    typical case when the error was raised within the context of
    emitting a SQL statement.

    The wrapped exception object is available in the
    :attr:`~.StatementError.orig` attribute. Its type and properties are
    DB-API implementation specific.

    """

    code = "dbapi"

    @overload
    @classmethod
    def instance(
        cls,
        statement: Optional[str],
        params: Optional[_AnyExecuteParams],
        orig: Exception,
        dbapi_base_err: Type[Exception],
        hide_parameters: bool = False,
        connection_invalidated: bool = False,
        dialect: Optional[Dialect] = None,
        ismulti: Optional[bool] = None,
    ) -> StatementError:
        ...

    @overload
    @classmethod
    def instance(
        cls,
        statement: Optional[str],
        params: Optional[_AnyExecuteParams],
        orig: DontWrapMixin,
        dbapi_base_err: Type[Exception],
        hide_parameters: bool = False,
        connection_invalidated: bool = False,
        dialect: Optional[Dialect] = None,
        ismulti: Optional[bool] = None,
    ) -> DontWrapMixin:
        ...

    @overload
    @classmethod
    def instance(
        cls,
        statement: Optional[str],
        params: Optional[_AnyExecuteParams],
        orig: BaseException,
        dbapi_base_err: Type[Exception],
        hide_parameters: bool = False,
        connection_invalidated: bool = False,
        dialect: Optional[Dialect] = None,
        ismulti: Optional[bool] = None,
    ) -> BaseException:
        ...

    @classmethod
    def instance(
        cls,
        statement: Optional[str],
        params: Optional[_AnyExecuteParams],
        orig: Union[BaseException, DontWrapMixin],
        dbapi_base_err: Type[Exception],
        hide_parameters: bool = False,
        connection_invalidated: bool = False,
        dialect: Optional[Dialect] = None,
        ismulti: Optional[bool] = None,
    ) -> Union[BaseException, DontWrapMixin]:
        # Don't ever wrap these, just return them directly as if
        # DBAPIError didn't exist.
        if (
            isinstance(orig, BaseException) and not isinstance(orig, Exception)
        ) or isinstance(orig, DontWrapMixin):
            return orig

        if orig is not None:
            # not a DBAPI error, statement is present.
            # raise a StatementError
            if isinstance(orig, SQLAlchemyError) and statement:
                return StatementError(
                    "(%s.%s) %s"
                    % (
                        orig.__class__.__module__,
                        orig.__class__.__name__,
                        orig.args[0],
                    ),
                    statement,
                    params,
                    orig,
                    hide_parameters=hide_parameters,
                    code=orig.code,
                    ismulti=ismulti,
                )
            elif not isinstance(orig, dbapi_base_err) and statement:
                return StatementError(
                    "(%s.%s) %s"
                    % (
                        orig.__class__.__module__,
                        orig.__class__.__name__,
                        orig,
                    ),
                    statement,
                    params,
                    orig,
                    hide_parameters=hide_parameters,
                    ismulti=ismulti,
                )

            glob = globals()
            for super_ in orig.__class__.__mro__:
                name = super_.__name__
                if dialect:
                    name = dialect.dbapi_exception_translation_map.get(
                        name, name
                    )
                if name in glob and issubclass(glob[name], DBAPIError):
                    cls = glob[name]
                    break

        return cls(
            statement,
            params,
            orig,
            connection_invalidated=connection_invalidated,
            hide_parameters=hide_parameters,
            code=cls.code,
            ismulti=ismulti,
        )

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return (
            self.__class__,
            (
                self.statement,
                self.params,
                self.orig,
                self.hide_parameters,
                self.connection_invalidated,
                self.__dict__.get("code"),
                self.ismulti,
            ),
            {"detail": self.detail},
        )

    def __init__(
        self,
        statement: Optional[str],
        params: Optional[_AnyExecuteParams],
        orig: BaseException,
        hide_parameters: bool = False,
        connection_invalidated: bool = False,
        code: Optional[str] = None,
        ismulti: Optional[bool] = None,
    ):
        try:
            text = str(orig)
        except Exception as e:
            text = "Error in str() of DB-API-generated exception: " + str(e)
        StatementError.__init__(
            self,
            "(%s.%s) %s"
            % (orig.__class__.__module__, orig.__class__.__name__, text),
            statement,
            params,
            orig,
            hide_parameters,
            code=code,
            ismulti=ismulti,
        )
        self.connection_invalidated = connection_invalidated


class InterfaceError(DBAPIError):
    """Wraps a DB-API InterfaceError."""

    code = "rvf5"


class DatabaseError(DBAPIError):
    """Wraps a DB-API DatabaseError."""

    code = "4xp6"


class DataError(DatabaseError):
    """Wraps a DB-API DataError."""

    code = "9h9h"


class OperationalError(DatabaseError):
    """Wraps a DB-API OperationalError."""

    code = "e3q8"


class IntegrityError(DatabaseError):
    """Wraps a DB-API IntegrityError."""

    code = "gkpj"


class InternalError(DatabaseError):
    """Wraps a DB-API InternalError."""

    code = "2j85"


class ProgrammingError(DatabaseError):
    """Wraps a DB-API ProgrammingError."""

    code = "f405"


class NotSupportedError(DatabaseError):
    """Wraps a DB-API NotSupportedError."""

    code = "tw8g"


# Warnings


class SATestSuiteWarning(Warning):
    """warning for a condition detected during tests that is non-fatal

    Currently outside of SAWarning so that we can work around tools like
    Alembic doing the wrong thing with warnings.

    """


class SADeprecationWarning(HasDescriptionCode, DeprecationWarning):
    """Issued for usage of deprecated APIs."""

    deprecated_since: Optional[str] = None
    "Indicates the version that started raising this deprecation warning"


class Base20DeprecationWarning(SADeprecationWarning):
    """Issued for usage of APIs specifically deprecated or legacy in
    SQLAlchemy 2.0.

    .. seealso::

        :ref:`error_b8d9`.

        :ref:`deprecation_20_mode`

    """

    deprecated_since: Optional[str] = "1.4"
    "Indicates the version that started raising this deprecation warning"

    def __str__(self) -> str:
        return (
            super().__str__()
            + " (Background on SQLAlchemy 2.0 at: https://sqlalche.me/e/b8d9)"
        )


class LegacyAPIWarning(Base20DeprecationWarning):
    """indicates an API that is in 'legacy' status, a long term deprecation."""


class MovedIn20Warning(Base20DeprecationWarning):
    """Subtype of RemovedIn20Warning to indicate an API that moved only."""


class SAPendingDeprecationWarning(PendingDeprecationWarning):
    """A similar warning as :class:`_exc.SADeprecationWarning`, this warning
    is not used in modern versions of SQLAlchemy.

    """

    deprecated_since: Optional[str] = None
    "Indicates the version that started raising this deprecation warning"


class SAWarning(HasDescriptionCode, RuntimeWarning):
    """Issued at runtime."""

    _what_are_we = "warning"
