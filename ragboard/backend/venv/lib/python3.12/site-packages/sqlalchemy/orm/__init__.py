# orm/__init__.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""
Functional constructs for ORM configuration.

See the SQLAlchemy object relational tutorial and mapper configuration
documentation for an overview of how this module is used.

"""

from __future__ import annotations

from typing import Any

from . import exc as exc
from . import mapper as mapperlib
from . import strategy_options as strategy_options
from ._orm_constructors import _mapper_fn as mapper
from ._orm_constructors import aliased as aliased
from ._orm_constructors import backref as backref
from ._orm_constructors import clear_mappers as clear_mappers
from ._orm_constructors import column_property as column_property
from ._orm_constructors import composite as composite
from ._orm_constructors import contains_alias as contains_alias
from ._orm_constructors import create_session as create_session
from ._orm_constructors import deferred as deferred
from ._orm_constructors import dynamic_loader as dynamic_loader
from ._orm_constructors import join as join
from ._orm_constructors import mapped_column as mapped_column
from ._orm_constructors import orm_insert_sentinel as orm_insert_sentinel
from ._orm_constructors import outerjoin as outerjoin
from ._orm_constructors import query_expression as query_expression
from ._orm_constructors import relationship as relationship
from ._orm_constructors import synonym as synonym
from ._orm_constructors import with_loader_criteria as with_loader_criteria
from ._orm_constructors import with_polymorphic as with_polymorphic
from .attributes import AttributeEventToken as AttributeEventToken
from .attributes import InstrumentedAttribute as InstrumentedAttribute
from .attributes import QueryableAttribute as QueryableAttribute
from .base import class_mapper as class_mapper
from .base import DynamicMapped as DynamicMapped
from .base import InspectionAttrExtensionType as InspectionAttrExtensionType
from .base import LoaderCallableStatus as LoaderCallableStatus
from .base import Mapped as Mapped
from .base import NotExtension as NotExtension
from .base import ORMDescriptor as ORMDescriptor
from .base import PassiveFlag as PassiveFlag
from .base import SQLORMExpression as SQLORMExpression
from .base import WriteOnlyMapped as WriteOnlyMapped
from .context import FromStatement as FromStatement
from .context import QueryContext as QueryContext
from .decl_api import add_mapped_attribute as add_mapped_attribute
from .decl_api import as_declarative as as_declarative
from .decl_api import declarative_base as declarative_base
from .decl_api import declarative_mixin as declarative_mixin
from .decl_api import DeclarativeBase as DeclarativeBase
from .decl_api import DeclarativeBaseNoMeta as DeclarativeBaseNoMeta
from .decl_api import DeclarativeMeta as DeclarativeMeta
from .decl_api import declared_attr as declared_attr
from .decl_api import has_inherited_table as has_inherited_table
from .decl_api import MappedAsDataclass as MappedAsDataclass
from .decl_api import registry as registry
from .decl_api import synonym_for as synonym_for
from .decl_base import MappedClassProtocol as MappedClassProtocol
from .descriptor_props import Composite as Composite
from .descriptor_props import CompositeProperty as CompositeProperty
from .descriptor_props import Synonym as Synonym
from .descriptor_props import SynonymProperty as SynonymProperty
from .dynamic import AppenderQuery as AppenderQuery
from .events import AttributeEvents as AttributeEvents
from .events import InstanceEvents as InstanceEvents
from .events import InstrumentationEvents as InstrumentationEvents
from .events import MapperEvents as MapperEvents
from .events import QueryEvents as QueryEvents
from .events import SessionEvents as SessionEvents
from .identity import IdentityMap as IdentityMap
from .instrumentation import ClassManager as ClassManager
from .interfaces import EXT_CONTINUE as EXT_CONTINUE
from .interfaces import EXT_SKIP as EXT_SKIP
from .interfaces import EXT_STOP as EXT_STOP
from .interfaces import InspectionAttr as InspectionAttr
from .interfaces import InspectionAttrInfo as InspectionAttrInfo
from .interfaces import MANYTOMANY as MANYTOMANY
from .interfaces import MANYTOONE as MANYTOONE
from .interfaces import MapperProperty as MapperProperty
from .interfaces import NO_KEY as NO_KEY
from .interfaces import NO_VALUE as NO_VALUE
from .interfaces import ONETOMANY as ONETOMANY
from .interfaces import PropComparator as PropComparator
from .interfaces import RelationshipDirection as RelationshipDirection
from .interfaces import UserDefinedOption as UserDefinedOption
from .loading import merge_frozen_result as merge_frozen_result
from .loading import merge_result as merge_result
from .mapped_collection import attribute_keyed_dict as attribute_keyed_dict
from .mapped_collection import (
    attribute_mapped_collection as attribute_mapped_collection,
)
from .mapped_collection import column_keyed_dict as column_keyed_dict
from .mapped_collection import (
    column_mapped_collection as column_mapped_collection,
)
from .mapped_collection import keyfunc_mapping as keyfunc_mapping
from .mapped_collection import KeyFuncDict as KeyFuncDict
from .mapped_collection import mapped_collection as mapped_collection
from .mapped_collection import MappedCollection as MappedCollection
from .mapper import configure_mappers as configure_mappers
from .mapper import Mapper as Mapper
from .mapper import reconstructor as reconstructor
from .mapper import validates as validates
from .properties import ColumnProperty as ColumnProperty
from .properties import MappedColumn as MappedColumn
from .properties import MappedSQLExpression as MappedSQLExpression
from .query import AliasOption as AliasOption
from .query import Query as Query
from .relationships import foreign as foreign
from .relationships import Relationship as Relationship
from .relationships import RelationshipProperty as RelationshipProperty
from .relationships import remote as remote
from .scoping import QueryPropertyDescriptor as QueryPropertyDescriptor
from .scoping import scoped_session as scoped_session
from .session import close_all_sessions as close_all_sessions
from .session import make_transient as make_transient
from .session import make_transient_to_detached as make_transient_to_detached
from .session import object_session as object_session
from .session import ORMExecuteState as ORMExecuteState
from .session import Session as Session
from .session import sessionmaker as sessionmaker
from .session import SessionTransaction as SessionTransaction
from .session import SessionTransactionOrigin as SessionTransactionOrigin
from .state import AttributeState as AttributeState
from .state import InstanceState as InstanceState
from .strategy_options import contains_eager as contains_eager
from .strategy_options import defaultload as defaultload
from .strategy_options import defer as defer
from .strategy_options import immediateload as immediateload
from .strategy_options import joinedload as joinedload
from .strategy_options import lazyload as lazyload
from .strategy_options import Load as Load
from .strategy_options import load_only as load_only
from .strategy_options import noload as noload
from .strategy_options import raiseload as raiseload
from .strategy_options import selectin_polymorphic as selectin_polymorphic
from .strategy_options import selectinload as selectinload
from .strategy_options import subqueryload as subqueryload
from .strategy_options import undefer as undefer
from .strategy_options import undefer_group as undefer_group
from .strategy_options import with_expression as with_expression
from .unitofwork import UOWTransaction as UOWTransaction
from .util import Bundle as Bundle
from .util import CascadeOptions as CascadeOptions
from .util import LoaderCriteriaOption as LoaderCriteriaOption
from .util import object_mapper as object_mapper
from .util import polymorphic_union as polymorphic_union
from .util import was_deleted as was_deleted
from .util import with_parent as with_parent
from .writeonly import WriteOnlyCollection as WriteOnlyCollection
from .. import util as _sa_util


def __go(lcls: Any) -> None:
    _sa_util.preloaded.import_prefix("sqlalchemy.orm")
    _sa_util.preloaded.import_prefix("sqlalchemy.ext")


__go(locals())
