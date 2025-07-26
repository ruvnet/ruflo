# util/__init__.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php


from collections import defaultdict as defaultdict
from functools import partial as partial
from functools import update_wrapper as update_wrapper
from typing import TYPE_CHECKING

from . import preloaded as preloaded
from ._collections import coerce_generator_arg as coerce_generator_arg
from ._collections import coerce_to_immutabledict as coerce_to_immutabledict
from ._collections import column_dict as column_dict
from ._collections import column_set as column_set
from ._collections import EMPTY_DICT as EMPTY_DICT
from ._collections import EMPTY_SET as EMPTY_SET
from ._collections import FacadeDict as FacadeDict
from ._collections import flatten_iterator as flatten_iterator
from ._collections import has_dupes as has_dupes
from ._collections import has_intersection as has_intersection
from ._collections import IdentitySet as IdentitySet
from ._collections import immutabledict as immutabledict
from ._collections import LRUCache as LRUCache
from ._collections import merge_lists_w_ordering as merge_lists_w_ordering
from ._collections import NONE_SET as NONE_SET
from ._collections import ordered_column_set as ordered_column_set
from ._collections import OrderedDict as OrderedDict
from ._collections import OrderedIdentitySet as OrderedIdentitySet
from ._collections import OrderedProperties as OrderedProperties
from ._collections import OrderedSet as OrderedSet
from ._collections import PopulateDict as PopulateDict
from ._collections import Properties as Properties
from ._collections import ReadOnlyContainer as ReadOnlyContainer
from ._collections import ReadOnlyProperties as ReadOnlyProperties
from ._collections import ScopedRegistry as ScopedRegistry
from ._collections import sort_dictionary as sort_dictionary
from ._collections import ThreadLocalRegistry as ThreadLocalRegistry
from ._collections import to_column_set as to_column_set
from ._collections import to_list as to_list
from ._collections import to_set as to_set
from ._collections import unique_list as unique_list
from ._collections import UniqueAppender as UniqueAppender
from ._collections import update_copy as update_copy
from ._collections import WeakPopulateDict as WeakPopulateDict
from ._collections import WeakSequence as WeakSequence
from .compat import anext_ as anext_
from .compat import arm as arm
from .compat import b as b
from .compat import b64decode as b64decode
from .compat import b64encode as b64encode
from .compat import cmp as cmp
from .compat import cpython as cpython
from .compat import dataclass_fields as dataclass_fields
from .compat import decode_backslashreplace as decode_backslashreplace
from .compat import dottedgetter as dottedgetter
from .compat import has_refcount_gc as has_refcount_gc
from .compat import inspect_getfullargspec as inspect_getfullargspec
from .compat import is64bit as is64bit
from .compat import local_dataclass_fields as local_dataclass_fields
from .compat import osx as osx
from .compat import py310 as py310
from .compat import py311 as py311
from .compat import py312 as py312
from .compat import py38 as py38
from .compat import py39 as py39
from .compat import pypy as pypy
from .compat import win32 as win32
from .concurrency import await_fallback as await_fallback
from .concurrency import await_only as await_only
from .concurrency import greenlet_spawn as greenlet_spawn
from .concurrency import is_exit_exception as is_exit_exception
from .deprecations import became_legacy_20 as became_legacy_20
from .deprecations import deprecated as deprecated
from .deprecations import deprecated_cls as deprecated_cls
from .deprecations import deprecated_params as deprecated_params
from .deprecations import moved_20 as moved_20
from .deprecations import warn_deprecated as warn_deprecated
from .langhelpers import add_parameter_text as add_parameter_text
from .langhelpers import as_interface as as_interface
from .langhelpers import asbool as asbool
from .langhelpers import asint as asint
from .langhelpers import assert_arg_type as assert_arg_type
from .langhelpers import attrsetter as attrsetter
from .langhelpers import bool_or_str as bool_or_str
from .langhelpers import chop_traceback as chop_traceback
from .langhelpers import class_hierarchy as class_hierarchy
from .langhelpers import classproperty as classproperty
from .langhelpers import clsname_as_plain_name as clsname_as_plain_name
from .langhelpers import coerce_kw_type as coerce_kw_type
from .langhelpers import constructor_copy as constructor_copy
from .langhelpers import constructor_key as constructor_key
from .langhelpers import counter as counter
from .langhelpers import create_proxy_methods as create_proxy_methods
from .langhelpers import decode_slice as decode_slice
from .langhelpers import decorator as decorator
from .langhelpers import dictlike_iteritems as dictlike_iteritems
from .langhelpers import duck_type_collection as duck_type_collection
from .langhelpers import ellipses_string as ellipses_string
from .langhelpers import EnsureKWArg as EnsureKWArg
from .langhelpers import FastIntFlag as FastIntFlag
from .langhelpers import format_argspec_init as format_argspec_init
from .langhelpers import format_argspec_plus as format_argspec_plus
from .langhelpers import generic_fn_descriptor as generic_fn_descriptor
from .langhelpers import generic_repr as generic_repr
from .langhelpers import get_annotations as get_annotations
from .langhelpers import get_callable_argspec as get_callable_argspec
from .langhelpers import get_cls_kwargs as get_cls_kwargs
from .langhelpers import get_func_kwargs as get_func_kwargs
from .langhelpers import getargspec_init as getargspec_init
from .langhelpers import has_compiled_ext as has_compiled_ext
from .langhelpers import HasMemoized as HasMemoized
from .langhelpers import (
    HasMemoized_ro_memoized_attribute as HasMemoized_ro_memoized_attribute,
)
from .langhelpers import hybridmethod as hybridmethod
from .langhelpers import hybridproperty as hybridproperty
from .langhelpers import inject_docstring_text as inject_docstring_text
from .langhelpers import iterate_attributes as iterate_attributes
from .langhelpers import map_bits as map_bits
from .langhelpers import md5_hex as md5_hex
from .langhelpers import memoized_instancemethod as memoized_instancemethod
from .langhelpers import memoized_property as memoized_property
from .langhelpers import MemoizedSlots as MemoizedSlots
from .langhelpers import method_is_overridden as method_is_overridden
from .langhelpers import methods_equivalent as methods_equivalent
from .langhelpers import (
    monkeypatch_proxied_specials as monkeypatch_proxied_specials,
)
from .langhelpers import non_memoized_property as non_memoized_property
from .langhelpers import NoneType as NoneType
from .langhelpers import only_once as only_once
from .langhelpers import (
    parse_user_argument_for_enum as parse_user_argument_for_enum,
)
from .langhelpers import PluginLoader as PluginLoader
from .langhelpers import portable_instancemethod as portable_instancemethod
from .langhelpers import quoted_token_parser as quoted_token_parser
from .langhelpers import ro_memoized_property as ro_memoized_property
from .langhelpers import ro_non_memoized_property as ro_non_memoized_property
from .langhelpers import rw_hybridproperty as rw_hybridproperty
from .langhelpers import safe_reraise as safe_reraise
from .langhelpers import set_creation_order as set_creation_order
from .langhelpers import string_or_unprintable as string_or_unprintable
from .langhelpers import symbol as symbol
from .langhelpers import TypingOnly as TypingOnly
from .langhelpers import (
    unbound_method_to_callable as unbound_method_to_callable,
)
from .langhelpers import walk_subclasses as walk_subclasses
from .langhelpers import warn as warn
from .langhelpers import warn_exception as warn_exception
from .langhelpers import warn_limited as warn_limited
from .langhelpers import wrap_callable as wrap_callable
from .preloaded import preload_module as preload_module
from .typing import is_non_string_iterable as is_non_string_iterable
