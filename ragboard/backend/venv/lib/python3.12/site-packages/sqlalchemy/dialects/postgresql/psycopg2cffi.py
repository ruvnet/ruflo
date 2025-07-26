# dialects/postgresql/psycopg2cffi.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

r"""
.. dialect:: postgresql+psycopg2cffi
    :name: psycopg2cffi
    :dbapi: psycopg2cffi
    :connectstring: postgresql+psycopg2cffi://user:password@host:port/dbname[?key=value&key=value...]
    :url: https://pypi.org/project/psycopg2cffi/

``psycopg2cffi`` is an adaptation of ``psycopg2``, using CFFI for the C
layer. This makes it suitable for use in e.g. PyPy. Documentation
is as per ``psycopg2``.

.. seealso::

    :mod:`sqlalchemy.dialects.postgresql.psycopg2`

"""  # noqa
from .psycopg2 import PGDialect_psycopg2
from ... import util


class PGDialect_psycopg2cffi(PGDialect_psycopg2):
    driver = "psycopg2cffi"
    supports_unicode_statements = True
    supports_statement_cache = True

    # psycopg2cffi's first release is 2.5.0, but reports
    # __version__ as 2.4.4.  Subsequent releases seem to have
    # fixed this.

    FEATURE_VERSION_MAP = dict(
        native_json=(2, 4, 4),
        native_jsonb=(2, 7, 1),
        sane_multi_rowcount=(2, 4, 4),
        array_oid=(2, 4, 4),
        hstore_adapter=(2, 4, 4),
    )

    @classmethod
    def import_dbapi(cls):
        return __import__("psycopg2cffi")

    @util.memoized_property
    def _psycopg2_extensions(cls):
        root = __import__("psycopg2cffi", fromlist=["extensions"])
        return root.extensions

    @util.memoized_property
    def _psycopg2_extras(cls):
        root = __import__("psycopg2cffi", fromlist=["extras"])
        return root.extras


dialect = PGDialect_psycopg2cffi
