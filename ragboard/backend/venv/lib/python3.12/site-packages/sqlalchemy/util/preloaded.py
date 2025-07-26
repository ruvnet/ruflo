# util/preloaded.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""supplies the "preloaded" registry to resolve circular module imports at
runtime.

"""
from __future__ import annotations

import sys
from typing import Any
from typing import Callable
from typing import TYPE_CHECKING
from typing import TypeVar

_FN = TypeVar("_FN", bound=Callable[..., Any])


if TYPE_CHECKING:
    from sqlalchemy import dialects as _dialects
    from sqlalchemy import orm as _orm
    from sqlalchemy.engine import cursor as _engine_cursor
    from sqlalchemy.engine import default as _engine_default
    from sqlalchemy.engine import reflection as _engine_reflection
    from sqlalchemy.engine import result as _engine_result
    from sqlalchemy.engine import url as _engine_url
    from sqlalchemy.orm import attributes as _orm_attributes
    from sqlalchemy.orm import base as _orm_base
    from sqlalchemy.orm import clsregistry as _orm_clsregistry
    from sqlalchemy.orm import decl_api as _orm_decl_api
    from sqlalchemy.orm import decl_base as _orm_decl_base
    from sqlalchemy.orm import dependency as _orm_dependency
    from sqlalchemy.orm import descriptor_props as _orm_descriptor_props
    from sqlalchemy.orm import mapperlib as _orm_mapper
    from sqlalchemy.orm import properties as _orm_properties
    from sqlalchemy.orm import relationships as _orm_relationships
    from sqlalchemy.orm import session as _orm_session
    from sqlalchemy.orm import state as _orm_state
    from sqlalchemy.orm import strategies as _orm_strategies
    from sqlalchemy.orm import strategy_options as _orm_strategy_options
    from sqlalchemy.orm import util as _orm_util
    from sqlalchemy.sql import default_comparator as _sql_default_comparator
    from sqlalchemy.sql import dml as _sql_dml
    from sqlalchemy.sql import elements as _sql_elements
    from sqlalchemy.sql import functions as _sql_functions
    from sqlalchemy.sql import naming as _sql_naming
    from sqlalchemy.sql import schema as _sql_schema
    from sqlalchemy.sql import selectable as _sql_selectable
    from sqlalchemy.sql import sqltypes as _sql_sqltypes
    from sqlalchemy.sql import traversals as _sql_traversals
    from sqlalchemy.sql import util as _sql_util

    # sigh, appease mypy 0.971 which does not accept imports as instance
    # variables of a module
    dialects = _dialects
    engine_cursor = _engine_cursor
    engine_default = _engine_default
    engine_reflection = _engine_reflection
    engine_result = _engine_result
    engine_url = _engine_url
    orm_clsregistry = _orm_clsregistry
    orm_base = _orm_base
    orm = _orm
    orm_attributes = _orm_attributes
    orm_decl_api = _orm_decl_api
    orm_decl_base = _orm_decl_base
    orm_descriptor_props = _orm_descriptor_props
    orm_dependency = _orm_dependency
    orm_mapper = _orm_mapper
    orm_properties = _orm_properties
    orm_relationships = _orm_relationships
    orm_session = _orm_session
    orm_strategies = _orm_strategies
    orm_strategy_options = _orm_strategy_options
    orm_state = _orm_state
    orm_util = _orm_util
    sql_default_comparator = _sql_default_comparator
    sql_dml = _sql_dml
    sql_elements = _sql_elements
    sql_functions = _sql_functions
    sql_naming = _sql_naming
    sql_selectable = _sql_selectable
    sql_traversals = _sql_traversals
    sql_schema = _sql_schema
    sql_sqltypes = _sql_sqltypes
    sql_util = _sql_util


class _ModuleRegistry:
    """Registry of modules to load in a package init file.

    To avoid potential thread safety issues for imports that are deferred
    in a function, like https://bugs.python.org/issue38884, these modules
    are added to the system module cache by importing them after the packages
    has finished initialization.

    A global instance is provided under the name :attr:`.preloaded`. Use
    the function :func:`.preload_module` to register modules to load and
    :meth:`.import_prefix` to load all the modules that start with the
    given path.

    While the modules are loaded in the global module cache, it's advisable
    to access them using :attr:`.preloaded` to ensure that it was actually
    registered. Each registered module is added to the instance ``__dict__``
    in the form `<package>_<module>`, omitting ``sqlalchemy`` from the package
    name. Example: ``sqlalchemy.sql.util`` becomes ``preloaded.sql_util``.
    """

    def __init__(self, prefix="sqlalchemy."):
        self.module_registry = set()
        self.prefix = prefix

    def preload_module(self, *deps: str) -> Callable[[_FN], _FN]:
        """Adds the specified modules to the list to load.

        This method can be used both as a normal function and as a decorator.
        No change is performed to the decorated object.
        """
        self.module_registry.update(deps)
        return lambda fn: fn

    def import_prefix(self, path: str) -> None:
        """Resolve all the modules in the registry that start with the
        specified path.
        """
        for module in self.module_registry:
            if self.prefix:
                key = module.split(self.prefix)[-1].replace(".", "_")
            else:
                key = module
            if (
                not path or module.startswith(path)
            ) and key not in self.__dict__:
                __import__(module, globals(), locals())
                self.__dict__[key] = globals()[key] = sys.modules[module]


_reg = _ModuleRegistry()
preload_module = _reg.preload_module
import_prefix = _reg.import_prefix

# this appears to do absolutely nothing for any version of mypy
# if TYPE_CHECKING:
#    def __getattr__(key: str) -> ModuleType:
#        ...
