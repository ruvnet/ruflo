# dialects/postgresql/pg_catalog.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from .array import ARRAY
from .types import OID
from .types import REGCLASS
from ... import Column
from ... import func
from ... import MetaData
from ... import Table
from ...types import BigInteger
from ...types import Boolean
from ...types import CHAR
from ...types import Float
from ...types import Integer
from ...types import SmallInteger
from ...types import String
from ...types import Text
from ...types import TypeDecorator


# types
class NAME(TypeDecorator):
    impl = String(64, collation="C")
    cache_ok = True


class PG_NODE_TREE(TypeDecorator):
    impl = Text(collation="C")
    cache_ok = True


class INT2VECTOR(TypeDecorator):
    impl = ARRAY(SmallInteger)
    cache_ok = True


class OIDVECTOR(TypeDecorator):
    impl = ARRAY(OID)
    cache_ok = True


class _SpaceVector:
    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return value
            return [int(p) for p in value.split(" ")]

        return process


REGPROC = REGCLASS  # seems an alias

# functions
_pg_cat = func.pg_catalog
quote_ident = _pg_cat.quote_ident
pg_table_is_visible = _pg_cat.pg_table_is_visible
pg_type_is_visible = _pg_cat.pg_type_is_visible
pg_get_viewdef = _pg_cat.pg_get_viewdef
pg_get_serial_sequence = _pg_cat.pg_get_serial_sequence
format_type = _pg_cat.format_type
pg_get_expr = _pg_cat.pg_get_expr
pg_get_constraintdef = _pg_cat.pg_get_constraintdef
pg_get_indexdef = _pg_cat.pg_get_indexdef

# constants
RELKINDS_TABLE_NO_FOREIGN = ("r", "p")
RELKINDS_TABLE = RELKINDS_TABLE_NO_FOREIGN + ("f",)
RELKINDS_VIEW = ("v",)
RELKINDS_MAT_VIEW = ("m",)
RELKINDS_ALL_TABLE_LIKE = RELKINDS_TABLE + RELKINDS_VIEW + RELKINDS_MAT_VIEW

# tables
pg_catalog_meta = MetaData()

pg_namespace = Table(
    "pg_namespace",
    pg_catalog_meta,
    Column("oid", OID),
    Column("nspname", NAME),
    Column("nspowner", OID),
    schema="pg_catalog",
)

pg_class = Table(
    "pg_class",
    pg_catalog_meta,
    Column("oid", OID, info={"server_version": (9, 3)}),
    Column("relname", NAME),
    Column("relnamespace", OID),
    Column("reltype", OID),
    Column("reloftype", OID),
    Column("relowner", OID),
    Column("relam", OID),
    Column("relfilenode", OID),
    Column("reltablespace", OID),
    Column("relpages", Integer),
    Column("reltuples", Float),
    Column("relallvisible", Integer, info={"server_version": (9, 2)}),
    Column("reltoastrelid", OID),
    Column("relhasindex", Boolean),
    Column("relisshared", Boolean),
    Column("relpersistence", CHAR, info={"server_version": (9, 1)}),
    Column("relkind", CHAR),
    Column("relnatts", SmallInteger),
    Column("relchecks", SmallInteger),
    Column("relhasrules", Boolean),
    Column("relhastriggers", Boolean),
    Column("relhassubclass", Boolean),
    Column("relrowsecurity", Boolean),
    Column("relforcerowsecurity", Boolean, info={"server_version": (9, 5)}),
    Column("relispopulated", Boolean, info={"server_version": (9, 3)}),
    Column("relreplident", CHAR, info={"server_version": (9, 4)}),
    Column("relispartition", Boolean, info={"server_version": (10,)}),
    Column("relrewrite", OID, info={"server_version": (11,)}),
    Column("reloptions", ARRAY(Text)),
    schema="pg_catalog",
)

pg_type = Table(
    "pg_type",
    pg_catalog_meta,
    Column("oid", OID, info={"server_version": (9, 3)}),
    Column("typname", NAME),
    Column("typnamespace", OID),
    Column("typowner", OID),
    Column("typlen", SmallInteger),
    Column("typbyval", Boolean),
    Column("typtype", CHAR),
    Column("typcategory", CHAR),
    Column("typispreferred", Boolean),
    Column("typisdefined", Boolean),
    Column("typdelim", CHAR),
    Column("typrelid", OID),
    Column("typelem", OID),
    Column("typarray", OID),
    Column("typinput", REGPROC),
    Column("typoutput", REGPROC),
    Column("typreceive", REGPROC),
    Column("typsend", REGPROC),
    Column("typmodin", REGPROC),
    Column("typmodout", REGPROC),
    Column("typanalyze", REGPROC),
    Column("typalign", CHAR),
    Column("typstorage", CHAR),
    Column("typnotnull", Boolean),
    Column("typbasetype", OID),
    Column("typtypmod", Integer),
    Column("typndims", Integer),
    Column("typcollation", OID, info={"server_version": (9, 1)}),
    Column("typdefault", Text),
    schema="pg_catalog",
)

pg_index = Table(
    "pg_index",
    pg_catalog_meta,
    Column("indexrelid", OID),
    Column("indrelid", OID),
    Column("indnatts", SmallInteger),
    Column("indnkeyatts", SmallInteger, info={"server_version": (11,)}),
    Column("indisunique", Boolean),
    Column("indnullsnotdistinct", Boolean, info={"server_version": (15,)}),
    Column("indisprimary", Boolean),
    Column("indisexclusion", Boolean, info={"server_version": (9, 1)}),
    Column("indimmediate", Boolean),
    Column("indisclustered", Boolean),
    Column("indisvalid", Boolean),
    Column("indcheckxmin", Boolean),
    Column("indisready", Boolean),
    Column("indislive", Boolean, info={"server_version": (9, 3)}),  # 9.3
    Column("indisreplident", Boolean),
    Column("indkey", INT2VECTOR),
    Column("indcollation", OIDVECTOR, info={"server_version": (9, 1)}),  # 9.1
    Column("indclass", OIDVECTOR),
    Column("indoption", INT2VECTOR),
    Column("indexprs", PG_NODE_TREE),
    Column("indpred", PG_NODE_TREE),
    schema="pg_catalog",
)

pg_attribute = Table(
    "pg_attribute",
    pg_catalog_meta,
    Column("attrelid", OID),
    Column("attname", NAME),
    Column("atttypid", OID),
    Column("attstattarget", Integer),
    Column("attlen", SmallInteger),
    Column("attnum", SmallInteger),
    Column("attndims", Integer),
    Column("attcacheoff", Integer),
    Column("atttypmod", Integer),
    Column("attbyval", Boolean),
    Column("attstorage", CHAR),
    Column("attalign", CHAR),
    Column("attnotnull", Boolean),
    Column("atthasdef", Boolean),
    Column("atthasmissing", Boolean, info={"server_version": (11,)}),
    Column("attidentity", CHAR, info={"server_version": (10,)}),
    Column("attgenerated", CHAR, info={"server_version": (12,)}),
    Column("attisdropped", Boolean),
    Column("attislocal", Boolean),
    Column("attinhcount", Integer),
    Column("attcollation", OID, info={"server_version": (9, 1)}),
    schema="pg_catalog",
)

pg_constraint = Table(
    "pg_constraint",
    pg_catalog_meta,
    Column("oid", OID),  # 9.3
    Column("conname", NAME),
    Column("connamespace", OID),
    Column("contype", CHAR),
    Column("condeferrable", Boolean),
    Column("condeferred", Boolean),
    Column("convalidated", Boolean, info={"server_version": (9, 1)}),
    Column("conrelid", OID),
    Column("contypid", OID),
    Column("conindid", OID),
    Column("conparentid", OID, info={"server_version": (11,)}),
    Column("confrelid", OID),
    Column("confupdtype", CHAR),
    Column("confdeltype", CHAR),
    Column("confmatchtype", CHAR),
    Column("conislocal", Boolean),
    Column("coninhcount", Integer),
    Column("connoinherit", Boolean, info={"server_version": (9, 2)}),
    Column("conkey", ARRAY(SmallInteger)),
    Column("confkey", ARRAY(SmallInteger)),
    schema="pg_catalog",
)

pg_sequence = Table(
    "pg_sequence",
    pg_catalog_meta,
    Column("seqrelid", OID),
    Column("seqtypid", OID),
    Column("seqstart", BigInteger),
    Column("seqincrement", BigInteger),
    Column("seqmax", BigInteger),
    Column("seqmin", BigInteger),
    Column("seqcache", BigInteger),
    Column("seqcycle", Boolean),
    schema="pg_catalog",
    info={"server_version": (10,)},
)

pg_attrdef = Table(
    "pg_attrdef",
    pg_catalog_meta,
    Column("oid", OID, info={"server_version": (9, 3)}),
    Column("adrelid", OID),
    Column("adnum", SmallInteger),
    Column("adbin", PG_NODE_TREE),
    schema="pg_catalog",
)

pg_description = Table(
    "pg_description",
    pg_catalog_meta,
    Column("objoid", OID),
    Column("classoid", OID),
    Column("objsubid", Integer),
    Column("description", Text(collation="C")),
    schema="pg_catalog",
)

pg_enum = Table(
    "pg_enum",
    pg_catalog_meta,
    Column("oid", OID, info={"server_version": (9, 3)}),
    Column("enumtypid", OID),
    Column("enumsortorder", Float(), info={"server_version": (9, 1)}),
    Column("enumlabel", NAME),
    schema="pg_catalog",
)

pg_am = Table(
    "pg_am",
    pg_catalog_meta,
    Column("oid", OID, info={"server_version": (9, 3)}),
    Column("amname", NAME),
    Column("amhandler", REGPROC, info={"server_version": (9, 6)}),
    Column("amtype", CHAR, info={"server_version": (9, 6)}),
    schema="pg_catalog",
)
