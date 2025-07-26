# pool/__init__.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php


"""Connection pooling for DB-API connections.

Provides a number of connection pool implementations for a variety of
usage scenarios and thread behavior requirements imposed by the
application, DB-API or database itself.

Also provides a DB-API 2.0 connection proxying mechanism allowing
regular DB-API connect() methods to be transparently managed by a
SQLAlchemy connection pool.
"""

from . import events
from .base import _AdhocProxiedConnection as _AdhocProxiedConnection
from .base import _ConnectionFairy as _ConnectionFairy
from .base import _ConnectionRecord
from .base import _CreatorFnType as _CreatorFnType
from .base import _CreatorWRecFnType as _CreatorWRecFnType
from .base import _finalize_fairy
from .base import _ResetStyleArgType as _ResetStyleArgType
from .base import ConnectionPoolEntry as ConnectionPoolEntry
from .base import ManagesConnection as ManagesConnection
from .base import Pool as Pool
from .base import PoolProxiedConnection as PoolProxiedConnection
from .base import PoolResetState as PoolResetState
from .base import reset_commit as reset_commit
from .base import reset_none as reset_none
from .base import reset_rollback as reset_rollback
from .impl import AssertionPool as AssertionPool
from .impl import AsyncAdaptedQueuePool as AsyncAdaptedQueuePool
from .impl import (
    FallbackAsyncAdaptedQueuePool as FallbackAsyncAdaptedQueuePool,
)
from .impl import NullPool as NullPool
from .impl import QueuePool as QueuePool
from .impl import SingletonThreadPool as SingletonThreadPool
from .impl import StaticPool as StaticPool
