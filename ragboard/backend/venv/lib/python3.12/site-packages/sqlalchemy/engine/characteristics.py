# engine/characteristics.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

import abc
import typing
from typing import Any
from typing import ClassVar

if typing.TYPE_CHECKING:
    from .interfaces import DBAPIConnection
    from .interfaces import Dialect


class ConnectionCharacteristic(abc.ABC):
    """An abstract base for an object that can set, get and reset a
    per-connection characteristic, typically one that gets reset when the
    connection is returned to the connection pool.

    transaction isolation is the canonical example, and the
    ``IsolationLevelCharacteristic`` implementation provides this for the
    ``DefaultDialect``.

    The ``ConnectionCharacteristic`` class should call upon the ``Dialect`` for
    the implementation of each method.   The object exists strictly to serve as
    a dialect visitor that can be placed into the
    ``DefaultDialect.connection_characteristics`` dictionary where it will take
    effect for calls to :meth:`_engine.Connection.execution_options` and
    related APIs.

    .. versionadded:: 1.4

    """

    __slots__ = ()

    transactional: ClassVar[bool] = False

    @abc.abstractmethod
    def reset_characteristic(
        self, dialect: Dialect, dbapi_conn: DBAPIConnection
    ) -> None:
        """Reset the characteristic on the connection to its default value."""

    @abc.abstractmethod
    def set_characteristic(
        self, dialect: Dialect, dbapi_conn: DBAPIConnection, value: Any
    ) -> None:
        """set characteristic on the connection to a given value."""

    @abc.abstractmethod
    def get_characteristic(
        self, dialect: Dialect, dbapi_conn: DBAPIConnection
    ) -> Any:
        """Given a DBAPI connection, get the current value of the
        characteristic.

        """


class IsolationLevelCharacteristic(ConnectionCharacteristic):
    transactional: ClassVar[bool] = True

    def reset_characteristic(
        self, dialect: Dialect, dbapi_conn: DBAPIConnection
    ) -> None:
        dialect.reset_isolation_level(dbapi_conn)

    def set_characteristic(
        self, dialect: Dialect, dbapi_conn: DBAPIConnection, value: Any
    ) -> None:
        dialect._assert_and_set_isolation_level(dbapi_conn, value)

    def get_characteristic(
        self, dialect: Dialect, dbapi_conn: DBAPIConnection
    ) -> Any:
        return dialect.get_isolation_level(dbapi_conn)
