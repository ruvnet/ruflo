# engine/util.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import typing
from typing import Any
from typing import Callable
from typing import Optional
from typing import TypeVar

from .. import exc
from .. import util
from ..util._has_cy import HAS_CYEXTENSION
from ..util.typing import Protocol

if typing.TYPE_CHECKING or not HAS_CYEXTENSION:
    from ._py_util import _distill_params_20 as _distill_params_20
    from ._py_util import _distill_raw_params as _distill_raw_params
else:
    from sqlalchemy.cyextension.util import (  # noqa: F401
        _distill_params_20 as _distill_params_20,
    )
    from sqlalchemy.cyextension.util import (  # noqa: F401
        _distill_raw_params as _distill_raw_params,
    )

_C = TypeVar("_C", bound=Callable[[], Any])


def connection_memoize(key: str) -> Callable[[_C], _C]:
    """Decorator, memoize a function in a connection.info stash.

    Only applicable to functions which take no arguments other than a
    connection.  The memo will be stored in ``connection.info[key]``.
    """

    @util.decorator
    def decorated(fn, self, connection):  # type: ignore
        connection = connection.connect()
        try:
            return connection.info[key]
        except KeyError:
            connection.info[key] = val = fn(self, connection)
            return val

    return decorated


class _TConsSubject(Protocol):
    _trans_context_manager: Optional[TransactionalContext]


class TransactionalContext:
    """Apply Python context manager behavior to transaction objects.

    Performs validation to ensure the subject of the transaction is not
    used if the transaction were ended prematurely.

    """

    __slots__ = ("_outer_trans_ctx", "_trans_subject", "__weakref__")

    _trans_subject: Optional[_TConsSubject]

    def _transaction_is_active(self) -> bool:
        raise NotImplementedError()

    def _transaction_is_closed(self) -> bool:
        raise NotImplementedError()

    def _rollback_can_be_called(self) -> bool:
        """indicates the object is in a state that is known to be acceptable
        for rollback() to be called.

        This does not necessarily mean rollback() will succeed or not raise
        an error, just that there is currently no state detected that indicates
        rollback() would fail or emit warnings.

        It also does not mean that there's a transaction in progress, as
        it is usually safe to call rollback() even if no transaction is
        present.

        .. versionadded:: 1.4.28

        """
        raise NotImplementedError()

    def _get_subject(self) -> _TConsSubject:
        raise NotImplementedError()

    def commit(self) -> None:
        raise NotImplementedError()

    def rollback(self) -> None:
        raise NotImplementedError()

    def close(self) -> None:
        raise NotImplementedError()

    @classmethod
    def _trans_ctx_check(cls, subject: _TConsSubject) -> None:
        trans_context = subject._trans_context_manager
        if trans_context:
            if not trans_context._transaction_is_active():
                raise exc.InvalidRequestError(
                    "Can't operate on closed transaction inside context "
                    "manager.  Please complete the context manager "
                    "before emitting further commands."
                )

    def __enter__(self) -> TransactionalContext:
        subject = self._get_subject()

        # none for outer transaction, may be non-None for nested
        # savepoint, legacy nesting cases
        trans_context = subject._trans_context_manager
        self._outer_trans_ctx = trans_context

        self._trans_subject = subject
        subject._trans_context_manager = self
        return self

    def __exit__(self, type_: Any, value: Any, traceback: Any) -> None:
        subject = getattr(self, "_trans_subject", None)

        # simplistically we could assume that
        # "subject._trans_context_manager is self".  However, any calling
        # code that is manipulating __exit__ directly would break this
        # assumption.  alembic context manager
        # is an example of partial use that just calls __exit__ and
        # not __enter__ at the moment.  it's safe to assume this is being done
        # in the wild also
        out_of_band_exit = (
            subject is None or subject._trans_context_manager is not self
        )

        if type_ is None and self._transaction_is_active():
            try:
                self.commit()
            except:
                with util.safe_reraise():
                    if self._rollback_can_be_called():
                        self.rollback()
            finally:
                if not out_of_band_exit:
                    assert subject is not None
                    subject._trans_context_manager = self._outer_trans_ctx
                self._trans_subject = self._outer_trans_ctx = None
        else:
            try:
                if not self._transaction_is_active():
                    if not self._transaction_is_closed():
                        self.close()
                else:
                    if self._rollback_can_be_called():
                        self.rollback()
            finally:
                if not out_of_band_exit:
                    assert subject is not None
                    subject._trans_context_manager = self._outer_trans_ctx
                self._trans_subject = self._outer_trans_ctx = None
