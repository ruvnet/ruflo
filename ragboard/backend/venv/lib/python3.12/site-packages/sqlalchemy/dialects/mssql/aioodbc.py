# dialects/mssql/aioodbc.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
r"""
.. dialect:: mssql+aioodbc
    :name: aioodbc
    :dbapi: aioodbc
    :connectstring: mssql+aioodbc://<username>:<password>@<dsnname>
    :url: https://pypi.org/project/aioodbc/


Support for the SQL Server database in asyncio style, using the aioodbc
driver which itself is a thread-wrapper around pyodbc.

.. versionadded:: 2.0.23  Added the mssql+aioodbc dialect which builds
   on top of the pyodbc and general aio* dialect architecture.

Using a special asyncio mediation layer, the aioodbc dialect is usable
as the backend for the :ref:`SQLAlchemy asyncio <asyncio_toplevel>`
extension package.

Most behaviors and caveats for this driver are the same as that of the
pyodbc dialect used on SQL Server; see :ref:`mssql_pyodbc` for general
background.

This dialect should normally be used only with the
:func:`_asyncio.create_async_engine` engine creation function; connection
styles are otherwise equivalent to those documented in the pyodbc section::

    from sqlalchemy.ext.asyncio import create_async_engine
    engine = create_async_engine(
        "mssql+aioodbc://scott:tiger@mssql2017:1433/test?"
        "driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes"
    )



"""

from __future__ import annotations

from .pyodbc import MSDialect_pyodbc
from .pyodbc import MSExecutionContext_pyodbc
from ...connectors.aioodbc import aiodbcConnector


class MSExecutionContext_aioodbc(MSExecutionContext_pyodbc):
    def create_server_side_cursor(self):
        return self._dbapi_connection.cursor(server_side=True)


class MSDialectAsync_aioodbc(aiodbcConnector, MSDialect_pyodbc):
    driver = "aioodbc"

    supports_statement_cache = True

    execution_ctx_cls = MSExecutionContext_aioodbc


dialect = MSDialectAsync_aioodbc
