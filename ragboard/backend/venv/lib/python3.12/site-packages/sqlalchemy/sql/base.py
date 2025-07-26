# sql/base.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Foundational utilities common to many sql modules.

"""


from __future__ import annotations

import collections
from enum import Enum
import itertools
from itertools import zip_longest
import operator
import re
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import FrozenSet
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import MutableMapping
from typing import NamedTuple
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import roles
from . import visitors
from .cache_key import HasCacheKey  # noqa
from .cache_key import MemoizedHasCacheKey  # noqa
from .traversals import HasCopyInternals  # noqa
from .visitors import ClauseVisitor
from .visitors import ExtendedInternalTraversal
from .visitors import ExternallyTraversible
from .visitors import InternalTraversal
from .. import event
from .. import exc
from .. import util
from ..util import HasMemoized as HasMemoized
from ..util import hybridmethod
from ..util import typing as compat_typing
from ..util.typing import Protocol
from ..util.typing import Self
from ..util.typing import TypeGuard

if TYPE_CHECKING:
    from . import coercions
    from . import elements
    from . import type_api
    from ._orm_types import DMLStrategyArgument
    from ._orm_types import SynchronizeSessionArgument
    from ._typing import _CLE
    from .elements import BindParameter
    from .elements import ClauseList
    from .elements import ColumnClause  # noqa
    from .elements import ColumnElement
    from .elements import KeyedColumnElement
    from .elements import NamedColumn
    from .elements import SQLCoreOperations
    from .elements import TextClause
    from .schema import Column
    from .schema import DefaultGenerator
    from .selectable import _JoinTargetElement
    from .selectable import _SelectIterable
    from .selectable import FromClause
    from ..engine import Connection
    from ..engine import CursorResult
    from ..engine.interfaces import _CoreMultiExecuteParams
    from ..engine.interfaces import _ExecuteOptions
    from ..engine.interfaces import _ImmutableExecuteOptions
    from ..engine.interfaces import CacheStats
    from ..engine.interfaces import Compiled
    from ..engine.interfaces import CompiledCacheType
    from ..engine.interfaces import CoreExecuteOptionsParameter
    from ..engine.interfaces import Dialect
    from ..engine.interfaces import IsolationLevel
    from ..engine.interfaces import SchemaTranslateMapType
    from ..event import dispatcher

if not TYPE_CHECKING:
    coercions = None  # noqa
    elements = None  # noqa
    type_api = None  # noqa


class _NoArg(Enum):
    NO_ARG = 0

    def __repr__(self):
        return f"_NoArg.{self.name}"


NO_ARG = _NoArg.NO_ARG


class _NoneName(Enum):
    NONE_NAME = 0
    """indicate a 'deferred' name that was ultimately the value None."""


_NONE_NAME = _NoneName.NONE_NAME

_T = TypeVar("_T", bound=Any)

_Fn = TypeVar("_Fn", bound=Callable[..., Any])

_AmbiguousTableNameMap = MutableMapping[str, str]


class _DefaultDescriptionTuple(NamedTuple):
    arg: Any
    is_scalar: Optional[bool]
    is_callable: Optional[bool]
    is_sentinel: Optional[bool]

    @classmethod
    def _from_column_default(
        cls, default: Optional[DefaultGenerator]
    ) -> _DefaultDescriptionTuple:
        return (
            _DefaultDescriptionTuple(
                default.arg,  # type: ignore
                default.is_scalar,
                default.is_callable,
                default.is_sentinel,
            )
            if default
            and (
                default.has_arg
                or (not default.for_update and default.is_sentinel)
            )
            else _DefaultDescriptionTuple(None, None, None, None)
        )


_never_select_column = operator.attrgetter("_omit_from_statements")


class _EntityNamespace(Protocol):
    def __getattr__(self, key: str) -> SQLCoreOperations[Any]:
        ...


class _HasEntityNamespace(Protocol):
    @util.ro_non_memoized_property
    def entity_namespace(self) -> _EntityNamespace:
        ...


def _is_has_entity_namespace(element: Any) -> TypeGuard[_HasEntityNamespace]:
    return hasattr(element, "entity_namespace")


# Remove when https://github.com/python/mypy/issues/14640 will be fixed
_Self = TypeVar("_Self", bound=Any)


class Immutable:
    """mark a ClauseElement as 'immutable' when expressions are cloned.

    "immutable" objects refers to the "mutability" of an object in the
    context of SQL DQL and DML generation.   Such as, in DQL, one can
    compose a SELECT or subquery of varied forms, but one cannot modify
    the structure of a specific table or column within DQL.
    :class:`.Immutable` is mostly intended to follow this concept, and as
    such the primary "immutable" objects are :class:`.ColumnClause`,
    :class:`.Column`, :class:`.TableClause`, :class:`.Table`.

    """

    __slots__ = ()

    _is_immutable = True

    def unique_params(self, *optionaldict, **kwargs):
        raise NotImplementedError("Immutable objects do not support copying")

    def params(self, *optionaldict, **kwargs):
        raise NotImplementedError("Immutable objects do not support copying")

    def _clone(self: _Self, **kw: Any) -> _Self:
        return self

    def _copy_internals(
        self, *, omit_attrs: Iterable[str] = (), **kw: Any
    ) -> None:
        pass


class SingletonConstant(Immutable):
    """Represent SQL constants like NULL, TRUE, FALSE"""

    _is_singleton_constant = True

    _singleton: SingletonConstant

    def __new__(cls: _T, *arg: Any, **kw: Any) -> _T:
        return cast(_T, cls._singleton)

    @util.non_memoized_property
    def proxy_set(self) -> FrozenSet[ColumnElement[Any]]:
        raise NotImplementedError()

    @classmethod
    def _create_singleton(cls):
        obj = object.__new__(cls)
        obj.__init__()  # type: ignore

        # for a long time this was an empty frozenset, meaning
        # a SingletonConstant would never be a "corresponding column" in
        # a statement.  This referred to #6259.  However, in #7154 we see
        # that we do in fact need "correspondence" to work when matching cols
        # in result sets, so the non-correspondence was moved to a more
        # specific level when we are actually adapting expressions for SQL
        # render only.
        obj.proxy_set = frozenset([obj])
        cls._singleton = obj


def _from_objects(
    *elements: Union[
        ColumnElement[Any], FromClause, TextClause, _JoinTargetElement
    ]
) -> Iterator[FromClause]:
    return itertools.chain.from_iterable(
        [element._from_objects for element in elements]
    )


def _select_iterables(
    elements: Iterable[roles.ColumnsClauseRole],
) -> _SelectIterable:
    """expand tables into individual columns in the
    given list of column expressions.

    """
    return itertools.chain.from_iterable(
        [c._select_iterable for c in elements]
    )


_SelfGenerativeType = TypeVar("_SelfGenerativeType", bound="_GenerativeType")


class _GenerativeType(compat_typing.Protocol):
    def _generate(self) -> Self:
        ...


def _generative(fn: _Fn) -> _Fn:
    """non-caching _generative() decorator.

    This is basically the legacy decorator that copies the object and
    runs a method on the new copy.

    """

    @util.decorator
    def _generative(
        fn: _Fn, self: _SelfGenerativeType, *args: Any, **kw: Any
    ) -> _SelfGenerativeType:
        """Mark a method as generative."""

        self = self._generate()
        x = fn(self, *args, **kw)
        assert x is self, "generative methods must return self"
        return self

    decorated = _generative(fn)
    decorated.non_generative = fn  # type: ignore
    return decorated


def _exclusive_against(*names: str, **kw: Any) -> Callable[[_Fn], _Fn]:
    msgs = kw.pop("msgs", {})

    defaults = kw.pop("defaults", {})

    getters = [
        (name, operator.attrgetter(name), defaults.get(name, None))
        for name in names
    ]

    @util.decorator
    def check(fn, *args, **kw):
        # make pylance happy by not including "self" in the argument
        # list
        self = args[0]
        args = args[1:]
        for name, getter, default_ in getters:
            if getter(self) is not default_:
                msg = msgs.get(
                    name,
                    "Method %s() has already been invoked on this %s construct"
                    % (fn.__name__, self.__class__),
                )
                raise exc.InvalidRequestError(msg)
        return fn(self, *args, **kw)

    return check


def _clone(element, **kw):
    return element._clone(**kw)


def _expand_cloned(
    elements: Iterable[_CLE],
) -> Iterable[_CLE]:
    """expand the given set of ClauseElements to be the set of all 'cloned'
    predecessors.

    """
    # TODO: cython candidate
    return itertools.chain(*[x._cloned_set for x in elements])


def _de_clone(
    elements: Iterable[_CLE],
) -> Iterable[_CLE]:
    for x in elements:
        while x._is_clone_of is not None:
            x = x._is_clone_of
        yield x


def _cloned_intersection(a: Iterable[_CLE], b: Iterable[_CLE]) -> Set[_CLE]:
    """return the intersection of sets a and b, counting
    any overlap between 'cloned' predecessors.

    The returned set is in terms of the entities present within 'a'.

    """
    all_overlap = set(_expand_cloned(a)).intersection(_expand_cloned(b))
    return {elem for elem in a if all_overlap.intersection(elem._cloned_set)}


def _cloned_difference(a: Iterable[_CLE], b: Iterable[_CLE]) -> Set[_CLE]:
    all_overlap = set(_expand_cloned(a)).intersection(_expand_cloned(b))
    return {
        elem for elem in a if not all_overlap.intersection(elem._cloned_set)
    }


class _DialectArgView(MutableMapping[str, Any]):
    """A dictionary view of dialect-level arguments in the form
    <dialectname>_<argument_name>.

    """

    def __init__(self, obj):
        self.obj = obj

    def _key(self, key):
        try:
            dialect, value_key = key.split("_", 1)
        except ValueError as err:
            raise KeyError(key) from err
        else:
            return dialect, value_key

    def __getitem__(self, key):
        dialect, value_key = self._key(key)

        try:
            opt = self.obj.dialect_options[dialect]
        except exc.NoSuchModuleError as err:
            raise KeyError(key) from err
        else:
            return opt[value_key]

    def __setitem__(self, key, value):
        try:
            dialect, value_key = self._key(key)
        except KeyError as err:
            raise exc.ArgumentError(
                "Keys must be of the form <dialectname>_<argname>"
            ) from err
        else:
            self.obj.dialect_options[dialect][value_key] = value

    def __delitem__(self, key):
        dialect, value_key = self._key(key)
        del self.obj.dialect_options[dialect][value_key]

    def __len__(self):
        return sum(
            len(args._non_defaults)
            for args in self.obj.dialect_options.values()
        )

    def __iter__(self):
        return (
            "%s_%s" % (dialect_name, value_name)
            for dialect_name in self.obj.dialect_options
            for value_name in self.obj.dialect_options[
                dialect_name
            ]._non_defaults
        )


class _DialectArgDict(MutableMapping[str, Any]):
    """A dictionary view of dialect-level arguments for a specific
    dialect.

    Maintains a separate collection of user-specified arguments
    and dialect-specified default arguments.

    """

    def __init__(self):
        self._non_defaults = {}
        self._defaults = {}

    def __len__(self):
        return len(set(self._non_defaults).union(self._defaults))

    def __iter__(self):
        return iter(set(self._non_defaults).union(self._defaults))

    def __getitem__(self, key):
        if key in self._non_defaults:
            return self._non_defaults[key]
        else:
            return self._defaults[key]

    def __setitem__(self, key, value):
        self._non_defaults[key] = value

    def __delitem__(self, key):
        del self._non_defaults[key]


@util.preload_module("sqlalchemy.dialects")
def _kw_reg_for_dialect(dialect_name):
    dialect_cls = util.preloaded.dialects.registry.load(dialect_name)
    if dialect_cls.construct_arguments is None:
        return None
    return dict(dialect_cls.construct_arguments)


class DialectKWArgs:
    """Establish the ability for a class to have dialect-specific arguments
    with defaults and constructor validation.

    The :class:`.DialectKWArgs` interacts with the
    :attr:`.DefaultDialect.construct_arguments` present on a dialect.

    .. seealso::

        :attr:`.DefaultDialect.construct_arguments`

    """

    __slots__ = ()

    _dialect_kwargs_traverse_internals = [
        ("dialect_options", InternalTraversal.dp_dialect_options)
    ]

    @classmethod
    def argument_for(cls, dialect_name, argument_name, default):
        """Add a new kind of dialect-specific keyword argument for this class.

        E.g.::

            Index.argument_for("mydialect", "length", None)

            some_index = Index('a', 'b', mydialect_length=5)

        The :meth:`.DialectKWArgs.argument_for` method is a per-argument
        way adding extra arguments to the
        :attr:`.DefaultDialect.construct_arguments` dictionary. This
        dictionary provides a list of argument names accepted by various
        schema-level constructs on behalf of a dialect.

        New dialects should typically specify this dictionary all at once as a
        data member of the dialect class.  The use case for ad-hoc addition of
        argument names is typically for end-user code that is also using
        a custom compilation scheme which consumes the additional arguments.

        :param dialect_name: name of a dialect.  The dialect must be
         locatable, else a :class:`.NoSuchModuleError` is raised.   The
         dialect must also include an existing
         :attr:`.DefaultDialect.construct_arguments` collection, indicating
         that it participates in the keyword-argument validation and default
         system, else :class:`.ArgumentError` is raised.  If the dialect does
         not include this collection, then any keyword argument can be
         specified on behalf of this dialect already.  All dialects packaged
         within SQLAlchemy include this collection, however for third party
         dialects, support may vary.

        :param argument_name: name of the parameter.

        :param default: default value of the parameter.

        """

        construct_arg_dictionary = DialectKWArgs._kw_registry[dialect_name]
        if construct_arg_dictionary is None:
            raise exc.ArgumentError(
                "Dialect '%s' does have keyword-argument "
                "validation and defaults enabled configured" % dialect_name
            )
        if cls not in construct_arg_dictionary:
            construct_arg_dictionary[cls] = {}
        construct_arg_dictionary[cls][argument_name] = default

    @util.memoized_property
    def dialect_kwargs(self):
        """A collection of keyword arguments specified as dialect-specific
        options to this construct.

        The arguments are present here in their original ``<dialect>_<kwarg>``
        format.  Only arguments that were actually passed are included;
        unlike the :attr:`.DialectKWArgs.dialect_options` collection, which
        contains all options known by this dialect including defaults.

        The collection is also writable; keys are accepted of the
        form ``<dialect>_<kwarg>`` where the value will be assembled
        into the list of options.

        .. seealso::

            :attr:`.DialectKWArgs.dialect_options` - nested dictionary form

        """
        return _DialectArgView(self)

    @property
    def kwargs(self):
        """A synonym for :attr:`.DialectKWArgs.dialect_kwargs`."""
        return self.dialect_kwargs

    _kw_registry = util.PopulateDict(_kw_reg_for_dialect)

    def _kw_reg_for_dialect_cls(self, dialect_name):
        construct_arg_dictionary = DialectKWArgs._kw_registry[dialect_name]
        d = _DialectArgDict()

        if construct_arg_dictionary is None:
            d._defaults.update({"*": None})
        else:
            for cls in reversed(self.__class__.__mro__):
                if cls in construct_arg_dictionary:
                    d._defaults.update(construct_arg_dictionary[cls])
        return d

    @util.memoized_property
    def dialect_options(self):
        """A collection of keyword arguments specified as dialect-specific
        options to this construct.

        This is a two-level nested registry, keyed to ``<dialect_name>``
        and ``<argument_name>``.  For example, the ``postgresql_where``
        argument would be locatable as::

            arg = my_object.dialect_options['postgresql']['where']

        .. versionadded:: 0.9.2

        .. seealso::

            :attr:`.DialectKWArgs.dialect_kwargs` - flat dictionary form

        """

        return util.PopulateDict(
            util.portable_instancemethod(self._kw_reg_for_dialect_cls)
        )

    def _validate_dialect_kwargs(self, kwargs: Dict[str, Any]) -> None:
        # validate remaining kwargs that they all specify DB prefixes

        if not kwargs:
            return

        for k in kwargs:
            m = re.match("^(.+?)_(.+)$", k)
            if not m:
                raise TypeError(
                    "Additional arguments should be "
                    "named <dialectname>_<argument>, got '%s'" % k
                )
            dialect_name, arg_name = m.group(1, 2)

            try:
                construct_arg_dictionary = self.dialect_options[dialect_name]
            except exc.NoSuchModuleError:
                util.warn(
                    "Can't validate argument %r; can't "
                    "locate any SQLAlchemy dialect named %r"
                    % (k, dialect_name)
                )
                self.dialect_options[dialect_name] = d = _DialectArgDict()
                d._defaults.update({"*": None})
                d._non_defaults[arg_name] = kwargs[k]
            else:
                if (
                    "*" not in construct_arg_dictionary
                    and arg_name not in construct_arg_dictionary
                ):
                    raise exc.ArgumentError(
                        "Argument %r is not accepted by "
                        "dialect %r on behalf of %r"
                        % (k, dialect_name, self.__class__)
                    )
                else:
                    construct_arg_dictionary[arg_name] = kwargs[k]


class CompileState:
    """Produces additional object state necessary for a statement to be
    compiled.

    the :class:`.CompileState` class is at the base of classes that assemble
    state for a particular statement object that is then used by the
    compiler.   This process is essentially an extension of the process that
    the SQLCompiler.visit_XYZ() method takes, however there is an emphasis
    on converting raw user intent into more organized structures rather than
    producing string output.   The top-level :class:`.CompileState` for the
    statement being executed is also accessible when the execution context
    works with invoking the statement and collecting results.

    The production of :class:`.CompileState` is specific to the compiler,  such
    as within the :meth:`.SQLCompiler.visit_insert`,
    :meth:`.SQLCompiler.visit_select` etc. methods.  These methods are also
    responsible for associating the :class:`.CompileState` with the
    :class:`.SQLCompiler` itself, if the statement is the "toplevel" statement,
    i.e. the outermost SQL statement that's actually being executed.
    There can be other :class:`.CompileState` objects that are not the
    toplevel, such as when a SELECT subquery or CTE-nested
    INSERT/UPDATE/DELETE is generated.

    .. versionadded:: 1.4

    """

    __slots__ = ("statement", "_ambiguous_table_name_map")

    plugins: Dict[Tuple[str, str], Type[CompileState]] = {}

    _ambiguous_table_name_map: Optional[_AmbiguousTableNameMap]

    @classmethod
    def create_for_statement(cls, statement, compiler, **kw):
        # factory construction.

        if statement._propagate_attrs:
            plugin_name = statement._propagate_attrs.get(
                "compile_state_plugin", "default"
            )
            klass = cls.plugins.get(
                (plugin_name, statement._effective_plugin_target), None
            )
            if klass is None:
                klass = cls.plugins[
                    ("default", statement._effective_plugin_target)
                ]

        else:
            klass = cls.plugins[
                ("default", statement._effective_plugin_target)
            ]

        if klass is cls:
            return cls(statement, compiler, **kw)
        else:
            return klass.create_for_statement(statement, compiler, **kw)

    def __init__(self, statement, compiler, **kw):
        self.statement = statement

    @classmethod
    def get_plugin_class(
        cls, statement: Executable
    ) -> Optional[Type[CompileState]]:
        plugin_name = statement._propagate_attrs.get(
            "compile_state_plugin", None
        )

        if plugin_name:
            key = (plugin_name, statement._effective_plugin_target)
            if key in cls.plugins:
                return cls.plugins[key]

        # there's no case where we call upon get_plugin_class() and want
        # to get None back, there should always be a default.  return that
        # if there was no plugin-specific class  (e.g. Insert with "orm"
        # plugin)
        try:
            return cls.plugins[("default", statement._effective_plugin_target)]
        except KeyError:
            return None

    @classmethod
    def _get_plugin_class_for_plugin(
        cls, statement: Executable, plugin_name: str
    ) -> Optional[Type[CompileState]]:
        try:
            return cls.plugins[
                (plugin_name, statement._effective_plugin_target)
            ]
        except KeyError:
            return None

    @classmethod
    def plugin_for(
        cls, plugin_name: str, visit_name: str
    ) -> Callable[[_Fn], _Fn]:
        def decorate(cls_to_decorate):
            cls.plugins[(plugin_name, visit_name)] = cls_to_decorate
            return cls_to_decorate

        return decorate


class Generative(HasMemoized):
    """Provide a method-chaining pattern in conjunction with the
    @_generative decorator."""

    def _generate(self) -> Self:
        skip = self._memoized_keys
        cls = self.__class__
        s = cls.__new__(cls)
        if skip:
            # ensure this iteration remains atomic
            s.__dict__ = {
                k: v for k, v in self.__dict__.copy().items() if k not in skip
            }
        else:
            s.__dict__ = self.__dict__.copy()
        return s


class InPlaceGenerative(HasMemoized):
    """Provide a method-chaining pattern in conjunction with the
    @_generative decorator that mutates in place."""

    __slots__ = ()

    def _generate(self):
        skip = self._memoized_keys
        # note __dict__ needs to be in __slots__ if this is used
        for k in skip:
            self.__dict__.pop(k, None)
        return self


class HasCompileState(Generative):
    """A class that has a :class:`.CompileState` associated with it."""

    _compile_state_plugin: Optional[Type[CompileState]] = None

    _attributes: util.immutabledict[str, Any] = util.EMPTY_DICT

    _compile_state_factory = CompileState.create_for_statement


class _MetaOptions(type):
    """metaclass for the Options class.

    This metaclass is actually necessary despite the availability of the
    ``__init_subclass__()`` hook as this type also provides custom class-level
    behavior for the ``__add__()`` method.

    """

    _cache_attrs: Tuple[str, ...]

    def __add__(self, other):
        o1 = self()

        if set(other).difference(self._cache_attrs):
            raise TypeError(
                "dictionary contains attributes not covered by "
                "Options class %s: %r"
                % (self, set(other).difference(self._cache_attrs))
            )

        o1.__dict__.update(other)
        return o1

    if TYPE_CHECKING:

        def __getattr__(self, key: str) -> Any:
            ...

        def __setattr__(self, key: str, value: Any) -> None:
            ...

        def __delattr__(self, key: str) -> None:
            ...


class Options(metaclass=_MetaOptions):
    """A cacheable option dictionary with defaults."""

    __slots__ = ()

    _cache_attrs: Tuple[str, ...]

    def __init_subclass__(cls) -> None:
        dict_ = cls.__dict__
        cls._cache_attrs = tuple(
            sorted(
                d
                for d in dict_
                if not d.startswith("__")
                and d not in ("_cache_key_traversal",)
            )
        )
        super().__init_subclass__()

    def __init__(self, **kw):
        self.__dict__.update(kw)

    def __add__(self, other):
        o1 = self.__class__.__new__(self.__class__)
        o1.__dict__.update(self.__dict__)

        if set(other).difference(self._cache_attrs):
            raise TypeError(
                "dictionary contains attributes not covered by "
                "Options class %s: %r"
                % (self, set(other).difference(self._cache_attrs))
            )

        o1.__dict__.update(other)
        return o1

    def __eq__(self, other):
        # TODO: very inefficient.  This is used only in test suites
        # right now.
        for a, b in zip_longest(self._cache_attrs, other._cache_attrs):
            if getattr(self, a) != getattr(other, b):
                return False
        return True

    def __repr__(self):
        # TODO: fairly inefficient, used only in debugging right now.

        return "%s(%s)" % (
            self.__class__.__name__,
            ", ".join(
                "%s=%r" % (k, self.__dict__[k])
                for k in self._cache_attrs
                if k in self.__dict__
            ),
        )

    @classmethod
    def isinstance(cls, klass: Type[Any]) -> bool:
        return issubclass(cls, klass)

    @hybridmethod
    def add_to_element(self, name, value):
        return self + {name: getattr(self, name) + value}

    @hybridmethod
    def _state_dict_inst(self) -> Mapping[str, Any]:
        return self.__dict__

    _state_dict_const: util.immutabledict[str, Any] = util.EMPTY_DICT

    @_state_dict_inst.classlevel
    def _state_dict(cls) -> Mapping[str, Any]:
        return cls._state_dict_const

    @classmethod
    def safe_merge(cls, other):
        d = other._state_dict()

        # only support a merge with another object of our class
        # and which does not have attrs that we don't.   otherwise
        # we risk having state that might not be part of our cache
        # key strategy

        if (
            cls is not other.__class__
            and other._cache_attrs
            and set(other._cache_attrs).difference(cls._cache_attrs)
        ):
            raise TypeError(
                "other element %r is not empty, is not of type %s, "
                "and contains attributes not covered here %r"
                % (
                    other,
                    cls,
                    set(other._cache_attrs).difference(cls._cache_attrs),
                )
            )
        return cls + d

    @classmethod
    def from_execution_options(
        cls, key, attrs, exec_options, statement_exec_options
    ):
        """process Options argument in terms of execution options.


        e.g.::

            (
                load_options,
                execution_options,
            ) = QueryContext.default_load_options.from_execution_options(
                "_sa_orm_load_options",
                {
                    "populate_existing",
                    "autoflush",
                    "yield_per"
                },
                execution_options,
                statement._execution_options,
            )

        get back the Options and refresh "_sa_orm_load_options" in the
        exec options dict w/ the Options as well

        """

        # common case is that no options we are looking for are
        # in either dictionary, so cancel for that first
        check_argnames = attrs.intersection(
            set(exec_options).union(statement_exec_options)
        )

        existing_options = exec_options.get(key, cls)

        if check_argnames:
            result = {}
            for argname in check_argnames:
                local = "_" + argname
                if argname in exec_options:
                    result[local] = exec_options[argname]
                elif argname in statement_exec_options:
                    result[local] = statement_exec_options[argname]

            new_options = existing_options + result
            exec_options = util.immutabledict().merge_with(
                exec_options, {key: new_options}
            )
            return new_options, exec_options

        else:
            return existing_options, exec_options

    if TYPE_CHECKING:

        def __getattr__(self, key: str) -> Any:
            ...

        def __setattr__(self, key: str, value: Any) -> None:
            ...

        def __delattr__(self, key: str) -> None:
            ...


class CacheableOptions(Options, HasCacheKey):
    __slots__ = ()

    @hybridmethod
    def _gen_cache_key_inst(self, anon_map, bindparams):
        return HasCacheKey._gen_cache_key(self, anon_map, bindparams)

    @_gen_cache_key_inst.classlevel
    def _gen_cache_key(cls, anon_map, bindparams):
        return (cls, ())

    @hybridmethod
    def _generate_cache_key(self):
        return HasCacheKey._generate_cache_key_for_object(self)


class ExecutableOption(HasCopyInternals):
    __slots__ = ()

    _annotations = util.EMPTY_DICT

    __visit_name__ = "executable_option"

    _is_has_cache_key = False

    _is_core = True

    def _clone(self, **kw):
        """Create a shallow copy of this ExecutableOption."""
        c = self.__class__.__new__(self.__class__)
        c.__dict__ = dict(self.__dict__)  # type: ignore
        return c


class Executable(roles.StatementRole):
    """Mark a :class:`_expression.ClauseElement` as supporting execution.

    :class:`.Executable` is a superclass for all "statement" types
    of objects, including :func:`select`, :func:`delete`, :func:`update`,
    :func:`insert`, :func:`text`.

    """

    supports_execution: bool = True
    _execution_options: _ImmutableExecuteOptions = util.EMPTY_DICT
    _is_default_generator = False
    _with_options: Tuple[ExecutableOption, ...] = ()
    _with_context_options: Tuple[
        Tuple[Callable[[CompileState], None], Any], ...
    ] = ()
    _compile_options: Optional[Union[Type[CacheableOptions], CacheableOptions]]

    _executable_traverse_internals = [
        ("_with_options", InternalTraversal.dp_executable_options),
        (
            "_with_context_options",
            ExtendedInternalTraversal.dp_with_context_options,
        ),
        ("_propagate_attrs", ExtendedInternalTraversal.dp_propagate_attrs),
    ]

    is_select = False
    is_update = False
    is_insert = False
    is_text = False
    is_delete = False
    is_dml = False

    if TYPE_CHECKING:
        __visit_name__: str

        def _compile_w_cache(
            self,
            dialect: Dialect,
            *,
            compiled_cache: Optional[CompiledCacheType],
            column_keys: List[str],
            for_executemany: bool = False,
            schema_translate_map: Optional[SchemaTranslateMapType] = None,
            **kw: Any,
        ) -> Tuple[
            Compiled, Optional[Sequence[BindParameter[Any]]], CacheStats
        ]:
            ...

        def _execute_on_connection(
            self,
            connection: Connection,
            distilled_params: _CoreMultiExecuteParams,
            execution_options: CoreExecuteOptionsParameter,
        ) -> CursorResult[Any]:
            ...

        def _execute_on_scalar(
            self,
            connection: Connection,
            distilled_params: _CoreMultiExecuteParams,
            execution_options: CoreExecuteOptionsParameter,
        ) -> Any:
            ...

    @util.ro_non_memoized_property
    def _all_selected_columns(self):
        raise NotImplementedError()

    @property
    def _effective_plugin_target(self) -> str:
        return self.__visit_name__

    @_generative
    def options(self, *options: ExecutableOption) -> Self:
        """Apply options to this statement.

        In the general sense, options are any kind of Python object
        that can be interpreted by the SQL compiler for the statement.
        These options can be consumed by specific dialects or specific kinds
        of compilers.

        The most commonly known kind of option are the ORM level options
        that apply "eager load" and other loading behaviors to an ORM
        query.   However, options can theoretically be used for many other
        purposes.

        For background on specific kinds of options for specific kinds of
        statements, refer to the documentation for those option objects.

        .. versionchanged:: 1.4 - added :meth:`.Executable.options` to
           Core statement objects towards the goal of allowing unified
           Core / ORM querying capabilities.

        .. seealso::

            :ref:`loading_columns` - refers to options specific to the usage
            of ORM queries

            :ref:`relationship_loader_options` - refers to options specific
            to the usage of ORM queries

        """
        self._with_options += tuple(
            coercions.expect(roles.ExecutableOptionRole, opt)
            for opt in options
        )
        return self

    @_generative
    def _set_compile_options(self, compile_options: CacheableOptions) -> Self:
        """Assign the compile options to a new value.

        :param compile_options: appropriate CacheableOptions structure

        """

        self._compile_options = compile_options
        return self

    @_generative
    def _update_compile_options(self, options: CacheableOptions) -> Self:
        """update the _compile_options with new keys."""

        assert self._compile_options is not None
        self._compile_options += options
        return self

    @_generative
    def _add_context_option(
        self,
        callable_: Callable[[CompileState], None],
        cache_args: Any,
    ) -> Self:
        """Add a context option to this statement.

        These are callable functions that will
        be given the CompileState object upon compilation.

        A second argument cache_args is required, which will be combined with
        the ``__code__`` identity of the function itself in order to produce a
        cache key.

        """
        self._with_context_options += ((callable_, cache_args),)
        return self

    @overload
    def execution_options(
        self,
        *,
        compiled_cache: Optional[CompiledCacheType] = ...,
        logging_token: str = ...,
        isolation_level: IsolationLevel = ...,
        no_parameters: bool = False,
        stream_results: bool = False,
        max_row_buffer: int = ...,
        yield_per: int = ...,
        insertmanyvalues_page_size: int = ...,
        schema_translate_map: Optional[SchemaTranslateMapType] = ...,
        populate_existing: bool = False,
        autoflush: bool = False,
        synchronize_session: SynchronizeSessionArgument = ...,
        dml_strategy: DMLStrategyArgument = ...,
        render_nulls: bool = ...,
        is_delete_using: bool = ...,
        is_update_from: bool = ...,
        **opt: Any,
    ) -> Self:
        ...

    @overload
    def execution_options(self, **opt: Any) -> Self:
        ...

    @_generative
    def execution_options(self, **kw: Any) -> Self:
        """Set non-SQL options for the statement which take effect during
        execution.

        Execution options can be set at many scopes, including per-statement,
        per-connection, or per execution, using methods such as
        :meth:`_engine.Connection.execution_options` and parameters which
        accept a dictionary of options such as
        :paramref:`_engine.Connection.execute.execution_options` and
        :paramref:`_orm.Session.execute.execution_options`.

        The primary characteristic of an execution option, as opposed to
        other kinds of options such as ORM loader options, is that
        **execution options never affect the compiled SQL of a query, only
        things that affect how the SQL statement itself is invoked or how
        results are fetched**.  That is, execution options are not part of
        what's accommodated by SQL compilation nor are they considered part of
        the cached state of a statement.

        The :meth:`_sql.Executable.execution_options` method is
        :term:`generative`, as
        is the case for the method as applied to the :class:`_engine.Engine`
        and :class:`_orm.Query` objects, which means when the method is called,
        a copy of the object is returned, which applies the given parameters to
        that new copy, but leaves the original unchanged::

            statement = select(table.c.x, table.c.y)
            new_statement = statement.execution_options(my_option=True)

        An exception to this behavior is the :class:`_engine.Connection`
        object, where the :meth:`_engine.Connection.execution_options` method
        is explicitly **not** generative.

        The kinds of options that may be passed to
        :meth:`_sql.Executable.execution_options` and other related methods and
        parameter dictionaries include parameters that are explicitly consumed
        by SQLAlchemy Core or ORM, as well as arbitrary keyword arguments not
        defined by SQLAlchemy, which means the methods and/or parameter
        dictionaries may be used for user-defined parameters that interact with
        custom code, which may access the parameters using methods such as
        :meth:`_sql.Executable.get_execution_options` and
        :meth:`_engine.Connection.get_execution_options`, or within selected
        event hooks using a dedicated ``execution_options`` event parameter
        such as
        :paramref:`_events.ConnectionEvents.before_execute.execution_options`
        or :attr:`_orm.ORMExecuteState.execution_options`, e.g.::

             from sqlalchemy import event

             @event.listens_for(some_engine, "before_execute")
             def _process_opt(conn, statement, multiparams, params, execution_options):
                 "run a SQL function before invoking a statement"

                 if execution_options.get("do_special_thing", False):
                     conn.exec_driver_sql("run_special_function()")

        Within the scope of options that are explicitly recognized by
        SQLAlchemy, most apply to specific classes of objects and not others.
        The most common execution options include:

        * :paramref:`_engine.Connection.execution_options.isolation_level` -
          sets the isolation level for a connection or a class of connections
          via an :class:`_engine.Engine`.  This option is accepted only
          by :class:`_engine.Connection` or :class:`_engine.Engine`.

        * :paramref:`_engine.Connection.execution_options.stream_results` -
          indicates results should be fetched using a server side cursor;
          this option is accepted by :class:`_engine.Connection`, by the
          :paramref:`_engine.Connection.execute.execution_options` parameter
          on :meth:`_engine.Connection.execute`, and additionally by
          :meth:`_sql.Executable.execution_options` on a SQL statement object,
          as well as by ORM constructs like :meth:`_orm.Session.execute`.

        * :paramref:`_engine.Connection.execution_options.compiled_cache` -
          indicates a dictionary that will serve as the
          :ref:`SQL compilation cache <sql_caching>`
          for a :class:`_engine.Connection` or :class:`_engine.Engine`, as
          well as for ORM methods like :meth:`_orm.Session.execute`.
          Can be passed as ``None`` to disable caching for statements.
          This option is not accepted by
          :meth:`_sql.Executable.execution_options` as it is inadvisable to
          carry along a compilation cache within a statement object.

        * :paramref:`_engine.Connection.execution_options.schema_translate_map`
          - a mapping of schema names used by the
          :ref:`Schema Translate Map <schema_translating>` feature, accepted
          by :class:`_engine.Connection`, :class:`_engine.Engine`,
          :class:`_sql.Executable`, as well as by ORM constructs
          like :meth:`_orm.Session.execute`.

        .. seealso::

            :meth:`_engine.Connection.execution_options`

            :paramref:`_engine.Connection.execute.execution_options`

            :paramref:`_orm.Session.execute.execution_options`

            :ref:`orm_queryguide_execution_options` - documentation on all
            ORM-specific execution options

        """  # noqa: E501
        if "isolation_level" in kw:
            raise exc.ArgumentError(
                "'isolation_level' execution option may only be specified "
                "on Connection.execution_options(), or "
                "per-engine using the isolation_level "
                "argument to create_engine()."
            )
        if "compiled_cache" in kw:
            raise exc.ArgumentError(
                "'compiled_cache' execution option may only be specified "
                "on Connection.execution_options(), not per statement."
            )
        self._execution_options = self._execution_options.union(kw)
        return self

    def get_execution_options(self) -> _ExecuteOptions:
        """Get the non-SQL options which will take effect during execution.

        .. versionadded:: 1.3

        .. seealso::

            :meth:`.Executable.execution_options`
        """
        return self._execution_options


class SchemaEventTarget(event.EventTarget):
    """Base class for elements that are the targets of :class:`.DDLEvents`
    events.

    This includes :class:`.SchemaItem` as well as :class:`.SchemaType`.

    """

    dispatch: dispatcher[SchemaEventTarget]

    def _set_parent(self, parent: SchemaEventTarget, **kw: Any) -> None:
        """Associate with this SchemaEvent's parent object."""

    def _set_parent_with_dispatch(
        self, parent: SchemaEventTarget, **kw: Any
    ) -> None:
        self.dispatch.before_parent_attach(self, parent)
        self._set_parent(parent, **kw)
        self.dispatch.after_parent_attach(self, parent)


class SchemaVisitor(ClauseVisitor):
    """Define the visiting for ``SchemaItem`` objects."""

    __traverse_options__ = {"schema_visitor": True}


class _SentinelDefaultCharacterization(Enum):
    NONE = "none"
    UNKNOWN = "unknown"
    CLIENTSIDE = "clientside"
    SENTINEL_DEFAULT = "sentinel_default"
    SERVERSIDE = "serverside"
    IDENTITY = "identity"
    SEQUENCE = "sequence"


class _SentinelColumnCharacterization(NamedTuple):
    columns: Optional[Sequence[Column[Any]]] = None
    is_explicit: bool = False
    is_autoinc: bool = False
    default_characterization: _SentinelDefaultCharacterization = (
        _SentinelDefaultCharacterization.NONE
    )


_COLKEY = TypeVar("_COLKEY", Union[None, str], str)

_COL_co = TypeVar("_COL_co", bound="ColumnElement[Any]", covariant=True)
_COL = TypeVar("_COL", bound="KeyedColumnElement[Any]")


class _ColumnMetrics(Generic[_COL_co]):
    __slots__ = ("column",)

    column: _COL_co

    def __init__(
        self, collection: ColumnCollection[Any, _COL_co], col: _COL_co
    ):
        self.column = col

        # proxy_index being non-empty means it was initialized.
        # so we need to update it
        pi = collection._proxy_index
        if pi:
            for eps_col in col._expanded_proxy_set:
                pi[eps_col].add(self)

    def get_expanded_proxy_set(self):
        return self.column._expanded_proxy_set

    def dispose(self, collection):
        pi = collection._proxy_index
        if not pi:
            return
        for col in self.column._expanded_proxy_set:
            colset = pi.get(col, None)
            if colset:
                colset.discard(self)
            if colset is not None and not colset:
                del pi[col]

    def embedded(
        self,
        target_set: Union[
            Set[ColumnElement[Any]], FrozenSet[ColumnElement[Any]]
        ],
    ) -> bool:
        expanded_proxy_set = self.column._expanded_proxy_set
        for t in target_set.difference(expanded_proxy_set):
            if not expanded_proxy_set.intersection(_expand_cloned([t])):
                return False
        return True


class ColumnCollection(Generic[_COLKEY, _COL_co]):
    """Collection of :class:`_expression.ColumnElement` instances,
    typically for
    :class:`_sql.FromClause` objects.

    The :class:`_sql.ColumnCollection` object is most commonly available
    as the :attr:`_schema.Table.c` or :attr:`_schema.Table.columns` collection
    on the :class:`_schema.Table` object, introduced at
    :ref:`metadata_tables_and_columns`.

    The :class:`_expression.ColumnCollection` has both mapping- and sequence-
    like behaviors. A :class:`_expression.ColumnCollection` usually stores
    :class:`_schema.Column` objects, which are then accessible both via mapping
    style access as well as attribute access style.

    To access :class:`_schema.Column` objects using ordinary attribute-style
    access, specify the name like any other object attribute, such as below
    a column named ``employee_name`` is accessed::

        >>> employee_table.c.employee_name

    To access columns that have names with special characters or spaces,
    index-style access is used, such as below which illustrates a column named
    ``employee ' payment`` is accessed::

        >>> employee_table.c["employee ' payment"]

    As the :class:`_sql.ColumnCollection` object provides a Python dictionary
    interface, common dictionary method names like
    :meth:`_sql.ColumnCollection.keys`, :meth:`_sql.ColumnCollection.values`,
    and :meth:`_sql.ColumnCollection.items` are available, which means that
    database columns that are keyed under these names also need to use indexed
    access::

        >>> employee_table.c["values"]


    The name for which a :class:`_schema.Column` would be present is normally
    that of the :paramref:`_schema.Column.key` parameter.  In some contexts,
    such as a :class:`_sql.Select` object that uses a label style set
    using the :meth:`_sql.Select.set_label_style` method, a column of a certain
    key may instead be represented under a particular label name such
    as ``tablename_columnname``::

        >>> from sqlalchemy import select, column, table
        >>> from sqlalchemy import LABEL_STYLE_TABLENAME_PLUS_COL
        >>> t = table("t", column("c"))
        >>> stmt = select(t).set_label_style(LABEL_STYLE_TABLENAME_PLUS_COL)
        >>> subq = stmt.subquery()
        >>> subq.c.t_c
        <sqlalchemy.sql.elements.ColumnClause at 0x7f59dcf04fa0; t_c>

    :class:`.ColumnCollection` also indexes the columns in order and allows
    them to be accessible by their integer position::

        >>> cc[0]
        Column('x', Integer(), table=None)
        >>> cc[1]
        Column('y', Integer(), table=None)

    .. versionadded:: 1.4 :class:`_expression.ColumnCollection`
       allows integer-based
       index access to the collection.

    Iterating the collection yields the column expressions in order::

        >>> list(cc)
        [Column('x', Integer(), table=None),
         Column('y', Integer(), table=None)]

    The base :class:`_expression.ColumnCollection` object can store
    duplicates, which can
    mean either two columns with the same key, in which case the column
    returned by key  access is **arbitrary**::

        >>> x1, x2 = Column('x', Integer), Column('x', Integer)
        >>> cc = ColumnCollection(columns=[(x1.name, x1), (x2.name, x2)])
        >>> list(cc)
        [Column('x', Integer(), table=None),
         Column('x', Integer(), table=None)]
        >>> cc['x'] is x1
        False
        >>> cc['x'] is x2
        True

    Or it can also mean the same column multiple times.   These cases are
    supported as :class:`_expression.ColumnCollection`
    is used to represent the columns in
    a SELECT statement which may include duplicates.

    A special subclass :class:`.DedupeColumnCollection` exists which instead
    maintains SQLAlchemy's older behavior of not allowing duplicates; this
    collection is used for schema level objects like :class:`_schema.Table`
    and
    :class:`.PrimaryKeyConstraint` where this deduping is helpful.  The
    :class:`.DedupeColumnCollection` class also has additional mutation methods
    as the schema constructs have more use cases that require removal and
    replacement of columns.

    .. versionchanged:: 1.4 :class:`_expression.ColumnCollection`
       now stores duplicate
       column keys as well as the same column in multiple positions.  The
       :class:`.DedupeColumnCollection` class is added to maintain the
       former behavior in those cases where deduplication as well as
       additional replace/remove operations are needed.


    """

    __slots__ = "_collection", "_index", "_colset", "_proxy_index"

    _collection: List[Tuple[_COLKEY, _COL_co, _ColumnMetrics[_COL_co]]]
    _index: Dict[Union[None, str, int], Tuple[_COLKEY, _COL_co]]
    _proxy_index: Dict[ColumnElement[Any], Set[_ColumnMetrics[_COL_co]]]
    _colset: Set[_COL_co]

    def __init__(
        self, columns: Optional[Iterable[Tuple[_COLKEY, _COL_co]]] = None
    ):
        object.__setattr__(self, "_colset", set())
        object.__setattr__(self, "_index", {})
        object.__setattr__(
            self, "_proxy_index", collections.defaultdict(util.OrderedSet)
        )
        object.__setattr__(self, "_collection", [])
        if columns:
            self._initial_populate(columns)

    @util.preload_module("sqlalchemy.sql.elements")
    def __clause_element__(self) -> ClauseList:
        elements = util.preloaded.sql_elements

        return elements.ClauseList(
            _literal_as_text_role=roles.ColumnsClauseRole,
            group=False,
            *self._all_columns,
        )

    def _initial_populate(
        self, iter_: Iterable[Tuple[_COLKEY, _COL_co]]
    ) -> None:
        self._populate_separate_keys(iter_)

    @property
    def _all_columns(self) -> List[_COL_co]:
        return [col for (_, col, _) in self._collection]

    def keys(self) -> List[_COLKEY]:
        """Return a sequence of string key names for all columns in this
        collection."""
        return [k for (k, _, _) in self._collection]

    def values(self) -> List[_COL_co]:
        """Return a sequence of :class:`_sql.ColumnClause` or
        :class:`_schema.Column` objects for all columns in this
        collection."""
        return [col for (_, col, _) in self._collection]

    def items(self) -> List[Tuple[_COLKEY, _COL_co]]:
        """Return a sequence of (key, column) tuples for all columns in this
        collection each consisting of a string key name and a
        :class:`_sql.ColumnClause` or
        :class:`_schema.Column` object.
        """

        return [(k, col) for (k, col, _) in self._collection]

    def __bool__(self) -> bool:
        return bool(self._collection)

    def __len__(self) -> int:
        return len(self._collection)

    def __iter__(self) -> Iterator[_COL_co]:
        # turn to a list first to maintain over a course of changes
        return iter([col for _, col, _ in self._collection])

    @overload
    def __getitem__(self, key: Union[str, int]) -> _COL_co:
        ...

    @overload
    def __getitem__(
        self, key: Tuple[Union[str, int], ...]
    ) -> ReadOnlyColumnCollection[_COLKEY, _COL_co]:
        ...

    @overload
    def __getitem__(
        self, key: slice
    ) -> ReadOnlyColumnCollection[_COLKEY, _COL_co]:
        ...

    def __getitem__(
        self, key: Union[str, int, slice, Tuple[Union[str, int], ...]]
    ) -> Union[ReadOnlyColumnCollection[_COLKEY, _COL_co], _COL_co]:
        try:
            if isinstance(key, (tuple, slice)):
                if isinstance(key, slice):
                    cols = (
                        (sub_key, col)
                        for (sub_key, col, _) in self._collection[key]
                    )
                else:
                    cols = (self._index[sub_key] for sub_key in key)

                return ColumnCollection(cols).as_readonly()
            else:
                return self._index[key][1]
        except KeyError as err:
            if isinstance(err.args[0], int):
                raise IndexError(err.args[0]) from err
            else:
                raise

    def __getattr__(self, key: str) -> _COL_co:
        try:
            return self._index[key][1]
        except KeyError as err:
            raise AttributeError(key) from err

    def __contains__(self, key: str) -> bool:
        if key not in self._index:
            if not isinstance(key, str):
                raise exc.ArgumentError(
                    "__contains__ requires a string argument"
                )
            return False
        else:
            return True

    def compare(self, other: ColumnCollection[Any, Any]) -> bool:
        """Compare this :class:`_expression.ColumnCollection` to another
        based on the names of the keys"""

        for l, r in zip_longest(self, other):
            if l is not r:
                return False
        else:
            return True

    def __eq__(self, other: Any) -> bool:
        return self.compare(other)

    def get(
        self, key: str, default: Optional[_COL_co] = None
    ) -> Optional[_COL_co]:
        """Get a :class:`_sql.ColumnClause` or :class:`_schema.Column` object
        based on a string key name from this
        :class:`_expression.ColumnCollection`."""

        if key in self._index:
            return self._index[key][1]
        else:
            return default

    def __str__(self) -> str:
        return "%s(%s)" % (
            self.__class__.__name__,
            ", ".join(str(c) for c in self),
        )

    def __setitem__(self, key: str, value: Any) -> NoReturn:
        raise NotImplementedError()

    def __delitem__(self, key: str) -> NoReturn:
        raise NotImplementedError()

    def __setattr__(self, key: str, obj: Any) -> NoReturn:
        raise NotImplementedError()

    def clear(self) -> NoReturn:
        """Dictionary clear() is not implemented for
        :class:`_sql.ColumnCollection`."""
        raise NotImplementedError()

    def remove(self, column: Any) -> None:
        raise NotImplementedError()

    def update(self, iter_: Any) -> NoReturn:
        """Dictionary update() is not implemented for
        :class:`_sql.ColumnCollection`."""
        raise NotImplementedError()

    # https://github.com/python/mypy/issues/4266
    __hash__ = None  # type: ignore

    def _populate_separate_keys(
        self, iter_: Iterable[Tuple[_COLKEY, _COL_co]]
    ) -> None:
        """populate from an iterator of (key, column)"""

        self._collection[:] = collection = [
            (k, c, _ColumnMetrics(self, c)) for k, c in iter_
        ]
        self._colset.update(c._deannotate() for _, c, _ in collection)
        self._index.update(
            {idx: (k, c) for idx, (k, c, _) in enumerate(collection)}
        )
        self._index.update({k: (k, col) for k, col, _ in reversed(collection)})

    def add(
        self, column: ColumnElement[Any], key: Optional[_COLKEY] = None
    ) -> None:
        """Add a column to this :class:`_sql.ColumnCollection`.

        .. note::

            This method is **not normally used by user-facing code**, as the
            :class:`_sql.ColumnCollection` is usually part of an existing
            object such as a :class:`_schema.Table`. To add a
            :class:`_schema.Column` to an existing :class:`_schema.Table`
            object, use the :meth:`_schema.Table.append_column` method.

        """
        colkey: _COLKEY

        if key is None:
            colkey = column.key  # type: ignore
        else:
            colkey = key

        l = len(self._collection)

        # don't really know how this part is supposed to work w/ the
        # covariant thing

        _column = cast(_COL_co, column)

        self._collection.append(
            (colkey, _column, _ColumnMetrics(self, _column))
        )
        self._colset.add(_column._deannotate())
        self._index[l] = (colkey, _column)
        if colkey not in self._index:
            self._index[colkey] = (colkey, _column)

    def __getstate__(self) -> Dict[str, Any]:
        return {
            "_collection": [(k, c) for k, c, _ in self._collection],
            "_index": self._index,
        }

    def __setstate__(self, state: Dict[str, Any]) -> None:
        object.__setattr__(self, "_index", state["_index"])
        object.__setattr__(
            self, "_proxy_index", collections.defaultdict(util.OrderedSet)
        )
        object.__setattr__(
            self,
            "_collection",
            [
                (k, c, _ColumnMetrics(self, c))
                for (k, c) in state["_collection"]
            ],
        )
        object.__setattr__(
            self, "_colset", {col for k, col, _ in self._collection}
        )

    def contains_column(self, col: ColumnElement[Any]) -> bool:
        """Checks if a column object exists in this collection"""
        if col not in self._colset:
            if isinstance(col, str):
                raise exc.ArgumentError(
                    "contains_column cannot be used with string arguments. "
                    "Use ``col_name in table.c`` instead."
                )
            return False
        else:
            return True

    def as_readonly(self) -> ReadOnlyColumnCollection[_COLKEY, _COL_co]:
        """Return a "read only" form of this
        :class:`_sql.ColumnCollection`."""

        return ReadOnlyColumnCollection(self)

    def _init_proxy_index(self):
        """populate the "proxy index", if empty.

        proxy index is added in 2.0 to provide more efficient operation
        for the corresponding_column() method.

        For reasons of both time to construct new .c collections as well as
        memory conservation for large numbers of large .c collections, the
        proxy_index is only filled if corresponding_column() is called. once
        filled it stays that way, and new _ColumnMetrics objects created after
        that point will populate it with new data. Note this case would be
        unusual, if not nonexistent, as it means a .c collection is being
        mutated after corresponding_column() were used, however it is tested in
        test/base/test_utils.py.

        """
        pi = self._proxy_index
        if pi:
            return

        for _, _, metrics in self._collection:
            eps = metrics.column._expanded_proxy_set

            for eps_col in eps:
                pi[eps_col].add(metrics)

    def corresponding_column(
        self, column: _COL, require_embedded: bool = False
    ) -> Optional[Union[_COL, _COL_co]]:
        """Given a :class:`_expression.ColumnElement`, return the exported
        :class:`_expression.ColumnElement` object from this
        :class:`_expression.ColumnCollection`
        which corresponds to that original :class:`_expression.ColumnElement`
        via a common
        ancestor column.

        :param column: the target :class:`_expression.ColumnElement`
                      to be matched.

        :param require_embedded: only return corresponding columns for
         the given :class:`_expression.ColumnElement`, if the given
         :class:`_expression.ColumnElement`
         is actually present within a sub-element
         of this :class:`_expression.Selectable`.
         Normally the column will match if
         it merely shares a common ancestor with one of the exported
         columns of this :class:`_expression.Selectable`.

        .. seealso::

            :meth:`_expression.Selectable.corresponding_column`
            - invokes this method
            against the collection returned by
            :attr:`_expression.Selectable.exported_columns`.

        .. versionchanged:: 1.4 the implementation for ``corresponding_column``
           was moved onto the :class:`_expression.ColumnCollection` itself.

        """
        # TODO: cython candidate

        # don't dig around if the column is locally present
        if column in self._colset:
            return column

        selected_intersection, selected_metrics = None, None
        target_set = column.proxy_set

        pi = self._proxy_index
        if not pi:
            self._init_proxy_index()

        for current_metrics in (
            mm for ts in target_set if ts in pi for mm in pi[ts]
        ):
            if not require_embedded or current_metrics.embedded(target_set):
                if selected_metrics is None:
                    # no corresponding column yet, pick this one.
                    selected_metrics = current_metrics
                    continue

                current_intersection = target_set.intersection(
                    current_metrics.column._expanded_proxy_set
                )
                if selected_intersection is None:
                    selected_intersection = target_set.intersection(
                        selected_metrics.column._expanded_proxy_set
                    )

                if len(current_intersection) > len(selected_intersection):
                    # 'current' has a larger field of correspondence than
                    # 'selected'. i.e. selectable.c.a1_x->a1.c.x->table.c.x
                    # matches a1.c.x->table.c.x better than
                    # selectable.c.x->table.c.x does.

                    selected_metrics = current_metrics
                    selected_intersection = current_intersection
                elif current_intersection == selected_intersection:
                    # they have the same field of correspondence. see
                    # which proxy_set has fewer columns in it, which
                    # indicates a closer relationship with the root
                    # column. Also take into account the "weight"
                    # attribute which CompoundSelect() uses to give
                    # higher precedence to columns based on vertical
                    # position in the compound statement, and discard
                    # columns that have no reference to the target
                    # column (also occurs with CompoundSelect)

                    selected_col_distance = sum(
                        [
                            sc._annotations.get("weight", 1)
                            for sc in (
                                selected_metrics.column._uncached_proxy_list()
                            )
                            if sc.shares_lineage(column)
                        ],
                    )
                    current_col_distance = sum(
                        [
                            sc._annotations.get("weight", 1)
                            for sc in (
                                current_metrics.column._uncached_proxy_list()
                            )
                            if sc.shares_lineage(column)
                        ],
                    )
                    if current_col_distance < selected_col_distance:
                        selected_metrics = current_metrics
                        selected_intersection = current_intersection

        return selected_metrics.column if selected_metrics else None


_NAMEDCOL = TypeVar("_NAMEDCOL", bound="NamedColumn[Any]")


class DedupeColumnCollection(ColumnCollection[str, _NAMEDCOL]):
    """A :class:`_expression.ColumnCollection`
    that maintains deduplicating behavior.

    This is useful by schema level objects such as :class:`_schema.Table` and
    :class:`.PrimaryKeyConstraint`.    The collection includes more
    sophisticated mutator methods as well to suit schema objects which
    require mutable column collections.

    .. versionadded:: 1.4

    """

    def add(
        self, column: ColumnElement[Any], key: Optional[str] = None
    ) -> None:
        named_column = cast(_NAMEDCOL, column)
        if key is not None and named_column.key != key:
            raise exc.ArgumentError(
                "DedupeColumnCollection requires columns be under "
                "the same key as their .key"
            )
        key = named_column.key

        if key is None:
            raise exc.ArgumentError(
                "Can't add unnamed column to column collection"
            )

        if key in self._index:
            existing = self._index[key][1]

            if existing is named_column:
                return

            self.replace(named_column)

            # pop out memoized proxy_set as this
            # operation may very well be occurring
            # in a _make_proxy operation
            util.memoized_property.reset(named_column, "proxy_set")
        else:
            self._append_new_column(key, named_column)

    def _append_new_column(self, key: str, named_column: _NAMEDCOL) -> None:
        l = len(self._collection)
        self._collection.append(
            (key, named_column, _ColumnMetrics(self, named_column))
        )
        self._colset.add(named_column._deannotate())
        self._index[l] = (key, named_column)
        self._index[key] = (key, named_column)

    def _populate_separate_keys(
        self, iter_: Iterable[Tuple[str, _NAMEDCOL]]
    ) -> None:
        """populate from an iterator of (key, column)"""
        cols = list(iter_)

        replace_col = []
        for k, col in cols:
            if col.key != k:
                raise exc.ArgumentError(
                    "DedupeColumnCollection requires columns be under "
                    "the same key as their .key"
                )
            if col.name in self._index and col.key != col.name:
                replace_col.append(col)
            elif col.key in self._index:
                replace_col.append(col)
            else:
                self._index[k] = (k, col)
                self._collection.append((k, col, _ColumnMetrics(self, col)))
        self._colset.update(c._deannotate() for (k, c, _) in self._collection)

        self._index.update(
            (idx, (k, c)) for idx, (k, c, _) in enumerate(self._collection)
        )
        for col in replace_col:
            self.replace(col)

    def extend(self, iter_: Iterable[_NAMEDCOL]) -> None:
        self._populate_separate_keys((col.key, col) for col in iter_)

    def remove(self, column: _NAMEDCOL) -> None:
        if column not in self._colset:
            raise ValueError(
                "Can't remove column %r; column is not in this collection"
                % column
            )
        del self._index[column.key]
        self._colset.remove(column)
        self._collection[:] = [
            (k, c, metrics)
            for (k, c, metrics) in self._collection
            if c is not column
        ]
        for metrics in self._proxy_index.get(column, ()):
            metrics.dispose(self)

        self._index.update(
            {idx: (k, col) for idx, (k, col, _) in enumerate(self._collection)}
        )
        # delete higher index
        del self._index[len(self._collection)]

    def replace(
        self,
        column: _NAMEDCOL,
        extra_remove: Optional[Iterable[_NAMEDCOL]] = None,
    ) -> None:
        """add the given column to this collection, removing unaliased
        versions of this column  as well as existing columns with the
        same key.

        e.g.::

            t = Table('sometable', metadata, Column('col1', Integer))
            t.columns.replace(Column('col1', Integer, key='columnone'))

        will remove the original 'col1' from the collection, and add
        the new column under the name 'columnname'.

        Used by schema.Column to override columns during table reflection.

        """

        if extra_remove:
            remove_col = set(extra_remove)
        else:
            remove_col = set()
        # remove up to two columns based on matches of name as well as key
        if column.name in self._index and column.key != column.name:
            other = self._index[column.name][1]
            if other.name == other.key:
                remove_col.add(other)

        if column.key in self._index:
            remove_col.add(self._index[column.key][1])

        if not remove_col:
            self._append_new_column(column.key, column)
            return
        new_cols: List[Tuple[str, _NAMEDCOL, _ColumnMetrics[_NAMEDCOL]]] = []
        replaced = False
        for k, col, metrics in self._collection:
            if col in remove_col:
                if not replaced:
                    replaced = True
                    new_cols.append(
                        (column.key, column, _ColumnMetrics(self, column))
                    )
            else:
                new_cols.append((k, col, metrics))

        if remove_col:
            self._colset.difference_update(remove_col)

            for rc in remove_col:
                for metrics in self._proxy_index.get(rc, ()):
                    metrics.dispose(self)

        if not replaced:
            new_cols.append((column.key, column, _ColumnMetrics(self, column)))

        self._colset.add(column._deannotate())
        self._collection[:] = new_cols

        self._index.clear()

        self._index.update(
            {idx: (k, col) for idx, (k, col, _) in enumerate(self._collection)}
        )
        self._index.update({k: (k, col) for (k, col, _) in self._collection})


class ReadOnlyColumnCollection(
    util.ReadOnlyContainer, ColumnCollection[_COLKEY, _COL_co]
):
    __slots__ = ("_parent",)

    def __init__(self, collection):
        object.__setattr__(self, "_parent", collection)
        object.__setattr__(self, "_colset", collection._colset)
        object.__setattr__(self, "_index", collection._index)
        object.__setattr__(self, "_collection", collection._collection)
        object.__setattr__(self, "_proxy_index", collection._proxy_index)

    def __getstate__(self):
        return {"_parent": self._parent}

    def __setstate__(self, state):
        parent = state["_parent"]
        self.__init__(parent)  # type: ignore

    def add(self, column: Any, key: Any = ...) -> Any:
        self._readonly()

    def extend(self, elements: Any) -> NoReturn:
        self._readonly()

    def remove(self, item: Any) -> NoReturn:
        self._readonly()


class ColumnSet(util.OrderedSet["ColumnClause[Any]"]):
    def contains_column(self, col):
        return col in self

    def extend(self, cols):
        for col in cols:
            self.add(col)

    def __eq__(self, other):
        l = []
        for c in other:
            for local in self:
                if c.shares_lineage(local):
                    l.append(c == local)
        return elements.and_(*l)

    def __hash__(self):
        return hash(tuple(x for x in self))


def _entity_namespace(
    entity: Union[_HasEntityNamespace, ExternallyTraversible]
) -> _EntityNamespace:
    """Return the nearest .entity_namespace for the given entity.

    If not immediately available, does an iterate to find a sub-element
    that has one, if any.

    """
    try:
        return cast(_HasEntityNamespace, entity).entity_namespace
    except AttributeError:
        for elem in visitors.iterate(cast(ExternallyTraversible, entity)):
            if _is_has_entity_namespace(elem):
                return elem.entity_namespace
        else:
            raise


def _entity_namespace_key(
    entity: Union[_HasEntityNamespace, ExternallyTraversible],
    key: str,
    default: Union[SQLCoreOperations[Any], _NoArg] = NO_ARG,
) -> SQLCoreOperations[Any]:
    """Return an entry from an entity_namespace.


    Raises :class:`_exc.InvalidRequestError` rather than attribute error
    on not found.

    """

    try:
        ns = _entity_namespace(entity)
        if default is not NO_ARG:
            return getattr(ns, key, default)
        else:
            return getattr(ns, key)  # type: ignore
    except AttributeError as err:
        raise exc.InvalidRequestError(
            'Entity namespace for "%s" has no property "%s"' % (entity, key)
        ) from err
