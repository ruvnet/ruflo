# testing/schema.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from __future__ import annotations

import sys

from . import config
from . import exclusions
from .. import event
from .. import schema
from .. import types as sqltypes
from ..orm import mapped_column as _orm_mapped_column
from ..util import OrderedDict

__all__ = ["Table", "Column"]

table_options = {}


def Table(*args, **kw) -> schema.Table:
    """A schema.Table wrapper/hook for dialect-specific tweaks."""

    test_opts = {k: kw.pop(k) for k in list(kw) if k.startswith("test_")}

    kw.update(table_options)

    if exclusions.against(config._current, "mysql"):
        if (
            "mysql_engine" not in kw
            and "mysql_type" not in kw
            and "autoload_with" not in kw
        ):
            if "test_needs_fk" in test_opts or "test_needs_acid" in test_opts:
                kw["mysql_engine"] = "InnoDB"
            else:
                # there are in fact test fixtures that rely upon MyISAM,
                # due to MySQL / MariaDB having poor FK behavior under innodb,
                # such as a self-referential table can't be deleted from at
                # once without attending to per-row dependencies.  We'd need to
                # add special steps to some fixtures if we want to not
                # explicitly state MyISAM here
                kw["mysql_engine"] = "MyISAM"
    elif exclusions.against(config._current, "mariadb"):
        if (
            "mariadb_engine" not in kw
            and "mariadb_type" not in kw
            and "autoload_with" not in kw
        ):
            if "test_needs_fk" in test_opts or "test_needs_acid" in test_opts:
                kw["mariadb_engine"] = "InnoDB"
            else:
                kw["mariadb_engine"] = "MyISAM"

    return schema.Table(*args, **kw)


def mapped_column(*args, **kw):
    """An orm.mapped_column wrapper/hook for dialect-specific tweaks."""

    return _schema_column(_orm_mapped_column, args, kw)


def Column(*args, **kw):
    """A schema.Column wrapper/hook for dialect-specific tweaks."""

    return _schema_column(schema.Column, args, kw)


def _schema_column(factory, args, kw):
    test_opts = {k: kw.pop(k) for k in list(kw) if k.startswith("test_")}

    if not config.requirements.foreign_key_ddl.enabled_for_config(config):
        args = [arg for arg in args if not isinstance(arg, schema.ForeignKey)]

    construct = factory(*args, **kw)

    if factory is schema.Column:
        col = construct
    else:
        col = construct.column

    if test_opts.get("test_needs_autoincrement", False) and kw.get(
        "primary_key", False
    ):
        if col.default is None and col.server_default is None:
            col.autoincrement = True

        # allow any test suite to pick up on this
        col.info["test_needs_autoincrement"] = True

        # hardcoded rule for oracle; this should
        # be moved out
        if exclusions.against(config._current, "oracle"):

            def add_seq(c, tbl):
                c._init_items(
                    schema.Sequence(
                        _truncate_name(
                            config.db.dialect, tbl.name + "_" + c.name + "_seq"
                        ),
                        optional=True,
                    )
                )

            event.listen(col, "after_parent_attach", add_seq, propagate=True)
    return construct


class eq_type_affinity:
    """Helper to compare types inside of datastructures based on affinity.

    E.g.::

        eq_(
            inspect(connection).get_columns("foo"),
            [
                {
                    "name": "id",
                    "type": testing.eq_type_affinity(sqltypes.INTEGER),
                    "nullable": False,
                    "default": None,
                    "autoincrement": False,
                },
                {
                    "name": "data",
                    "type": testing.eq_type_affinity(sqltypes.NullType),
                    "nullable": True,
                    "default": None,
                    "autoincrement": False,
                },
            ],
        )

    """

    def __init__(self, target):
        self.target = sqltypes.to_instance(target)

    def __eq__(self, other):
        return self.target._type_affinity is other._type_affinity

    def __ne__(self, other):
        return self.target._type_affinity is not other._type_affinity


class eq_compile_type:
    """similar to eq_type_affinity but uses compile"""

    def __init__(self, target):
        self.target = target

    def __eq__(self, other):
        return self.target == other.compile()

    def __ne__(self, other):
        return self.target != other.compile()


class eq_clause_element:
    """Helper to compare SQL structures based on compare()"""

    def __init__(self, target):
        self.target = target

    def __eq__(self, other):
        return self.target.compare(other)

    def __ne__(self, other):
        return not self.target.compare(other)


def _truncate_name(dialect, name):
    if len(name) > dialect.max_identifier_length:
        return (
            name[0 : max(dialect.max_identifier_length - 6, 0)]
            + "_"
            + hex(hash(name) % 64)[2:]
        )
    else:
        return name


def pep435_enum(name):
    # Implements PEP 435 in the minimal fashion needed by SQLAlchemy
    __members__ = OrderedDict()

    def __init__(self, name, value, alias=None):
        self.name = name
        self.value = value
        self.__members__[name] = self
        value_to_member[value] = self
        setattr(self.__class__, name, self)
        if alias:
            self.__members__[alias] = self
            setattr(self.__class__, alias, self)

    value_to_member = {}

    @classmethod
    def get(cls, value):
        return value_to_member[value]

    someenum = type(
        name,
        (object,),
        {"__members__": __members__, "__init__": __init__, "get": get},
    )

    # getframe() trick for pickling I don't understand courtesy
    # Python namedtuple()
    try:
        module = sys._getframe(1).f_globals.get("__name__", "__main__")
    except (AttributeError, ValueError):
        pass
    if module is not None:
        someenum.__module__ = module

    return someenum
