# orm/clsregistry.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Routines to handle the string class registry used by declarative.

This system allows specification of classes and expressions used in
:func:`_orm.relationship` using strings.

"""

from __future__ import annotations

import re
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import Generator
from typing import Iterable
from typing import List
from typing import Mapping
from typing import MutableMapping
from typing import NoReturn
from typing import Optional
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import weakref

from . import attributes
from . import interfaces
from .descriptor_props import SynonymProperty
from .properties import ColumnProperty
from .util import class_mapper
from .. import exc
from .. import inspection
from .. import util
from ..sql.schema import _get_table_key
from ..util.typing import CallableReference

if TYPE_CHECKING:
    from .relationships import RelationshipProperty
    from ..sql.schema import MetaData
    from ..sql.schema import Table

_T = TypeVar("_T", bound=Any)

_ClsRegistryType = MutableMapping[str, Union[type, "ClsRegistryToken"]]

# strong references to registries which we place in
# the _decl_class_registry, which is usually weak referencing.
# the internal registries here link to classes with weakrefs and remove
# themselves when all references to contained classes are removed.
_registries: Set[ClsRegistryToken] = set()


def add_class(
    classname: str, cls: Type[_T], decl_class_registry: _ClsRegistryType
) -> None:
    """Add a class to the _decl_class_registry associated with the
    given declarative class.

    """
    if classname in decl_class_registry:
        # class already exists.
        existing = decl_class_registry[classname]
        if not isinstance(existing, _MultipleClassMarker):
            existing = decl_class_registry[classname] = _MultipleClassMarker(
                [cls, cast("Type[Any]", existing)]
            )
    else:
        decl_class_registry[classname] = cls

    try:
        root_module = cast(
            _ModuleMarker, decl_class_registry["_sa_module_registry"]
        )
    except KeyError:
        decl_class_registry[
            "_sa_module_registry"
        ] = root_module = _ModuleMarker("_sa_module_registry", None)

    tokens = cls.__module__.split(".")

    # build up a tree like this:
    # modulename:  myapp.snacks.nuts
    #
    # myapp->snack->nuts->(classes)
    # snack->nuts->(classes)
    # nuts->(classes)
    #
    # this allows partial token paths to be used.
    while tokens:
        token = tokens.pop(0)
        module = root_module.get_module(token)
        for token in tokens:
            module = module.get_module(token)

        try:
            module.add_class(classname, cls)
        except AttributeError as ae:
            if not isinstance(module, _ModuleMarker):
                raise exc.InvalidRequestError(
                    f'name "{classname}" matches both a '
                    "class name and a module name"
                ) from ae
            else:
                raise


def remove_class(
    classname: str, cls: Type[Any], decl_class_registry: _ClsRegistryType
) -> None:
    if classname in decl_class_registry:
        existing = decl_class_registry[classname]
        if isinstance(existing, _MultipleClassMarker):
            existing.remove_item(cls)
        else:
            del decl_class_registry[classname]

    try:
        root_module = cast(
            _ModuleMarker, decl_class_registry["_sa_module_registry"]
        )
    except KeyError:
        return

    tokens = cls.__module__.split(".")

    while tokens:
        token = tokens.pop(0)
        module = root_module.get_module(token)
        for token in tokens:
            module = module.get_module(token)
        try:
            module.remove_class(classname, cls)
        except AttributeError:
            if not isinstance(module, _ModuleMarker):
                pass
            else:
                raise


def _key_is_empty(
    key: str,
    decl_class_registry: _ClsRegistryType,
    test: Callable[[Any], bool],
) -> bool:
    """test if a key is empty of a certain object.

    used for unit tests against the registry to see if garbage collection
    is working.

    "test" is a callable that will be passed an object should return True
    if the given object is the one we were looking for.

    We can't pass the actual object itself b.c. this is for testing garbage
    collection; the caller will have to have removed references to the
    object itself.

    """
    if key not in decl_class_registry:
        return True

    thing = decl_class_registry[key]
    if isinstance(thing, _MultipleClassMarker):
        for sub_thing in thing.contents:
            if test(sub_thing):
                return False
        else:
            raise NotImplementedError("unknown codepath")
    else:
        return not test(thing)


class ClsRegistryToken:
    """an object that can be in the registry._class_registry as a value."""

    __slots__ = ()


class _MultipleClassMarker(ClsRegistryToken):
    """refers to multiple classes of the same name
    within _decl_class_registry.

    """

    __slots__ = "on_remove", "contents", "__weakref__"

    contents: Set[weakref.ref[Type[Any]]]
    on_remove: CallableReference[Optional[Callable[[], None]]]

    def __init__(
        self,
        classes: Iterable[Type[Any]],
        on_remove: Optional[Callable[[], None]] = None,
    ):
        self.on_remove = on_remove
        self.contents = {
            weakref.ref(item, self._remove_item) for item in classes
        }
        _registries.add(self)

    def remove_item(self, cls: Type[Any]) -> None:
        self._remove_item(weakref.ref(cls))

    def __iter__(self) -> Generator[Optional[Type[Any]], None, None]:
        return (ref() for ref in self.contents)

    def attempt_get(self, path: List[str], key: str) -> Type[Any]:
        if len(self.contents) > 1:
            raise exc.InvalidRequestError(
                'Multiple classes found for path "%s" '
                "in the registry of this declarative "
                "base. Please use a fully module-qualified path."
                % (".".join(path + [key]))
            )
        else:
            ref = list(self.contents)[0]
            cls = ref()
            if cls is None:
                raise NameError(key)
            return cls

    def _remove_item(self, ref: weakref.ref[Type[Any]]) -> None:
        self.contents.discard(ref)
        if not self.contents:
            _registries.discard(self)
            if self.on_remove:
                self.on_remove()

    def add_item(self, item: Type[Any]) -> None:
        # protect against class registration race condition against
        # asynchronous garbage collection calling _remove_item,
        # [ticket:3208] and [ticket:10782]
        modules = {
            cls.__module__
            for cls in [ref() for ref in list(self.contents)]
            if cls is not None
        }
        if item.__module__ in modules:
            util.warn(
                "This declarative base already contains a class with the "
                "same class name and module name as %s.%s, and will "
                "be replaced in the string-lookup table."
                % (item.__module__, item.__name__)
            )
        self.contents.add(weakref.ref(item, self._remove_item))


class _ModuleMarker(ClsRegistryToken):
    """Refers to a module name within
    _decl_class_registry.

    """

    __slots__ = "parent", "name", "contents", "mod_ns", "path", "__weakref__"

    parent: Optional[_ModuleMarker]
    contents: Dict[str, Union[_ModuleMarker, _MultipleClassMarker]]
    mod_ns: _ModNS
    path: List[str]

    def __init__(self, name: str, parent: Optional[_ModuleMarker]):
        self.parent = parent
        self.name = name
        self.contents = {}
        self.mod_ns = _ModNS(self)
        if self.parent:
            self.path = self.parent.path + [self.name]
        else:
            self.path = []
        _registries.add(self)

    def __contains__(self, name: str) -> bool:
        return name in self.contents

    def __getitem__(self, name: str) -> ClsRegistryToken:
        return self.contents[name]

    def _remove_item(self, name: str) -> None:
        self.contents.pop(name, None)
        if not self.contents and self.parent is not None:
            self.parent._remove_item(self.name)
            _registries.discard(self)

    def resolve_attr(self, key: str) -> Union[_ModNS, Type[Any]]:
        return self.mod_ns.__getattr__(key)

    def get_module(self, name: str) -> _ModuleMarker:
        if name not in self.contents:
            marker = _ModuleMarker(name, self)
            self.contents[name] = marker
        else:
            marker = cast(_ModuleMarker, self.contents[name])
        return marker

    def add_class(self, name: str, cls: Type[Any]) -> None:
        if name in self.contents:
            existing = cast(_MultipleClassMarker, self.contents[name])
            try:
                existing.add_item(cls)
            except AttributeError as ae:
                if not isinstance(existing, _MultipleClassMarker):
                    raise exc.InvalidRequestError(
                        f'name "{name}" matches both a '
                        "class name and a module name"
                    ) from ae
                else:
                    raise
        else:
            existing = self.contents[name] = _MultipleClassMarker(
                [cls], on_remove=lambda: self._remove_item(name)
            )

    def remove_class(self, name: str, cls: Type[Any]) -> None:
        if name in self.contents:
            existing = cast(_MultipleClassMarker, self.contents[name])
            existing.remove_item(cls)


class _ModNS:
    __slots__ = ("__parent",)

    __parent: _ModuleMarker

    def __init__(self, parent: _ModuleMarker):
        self.__parent = parent

    def __getattr__(self, key: str) -> Union[_ModNS, Type[Any]]:
        try:
            value = self.__parent.contents[key]
        except KeyError:
            pass
        else:
            if value is not None:
                if isinstance(value, _ModuleMarker):
                    return value.mod_ns
                else:
                    assert isinstance(value, _MultipleClassMarker)
                    return value.attempt_get(self.__parent.path, key)
        raise NameError(
            "Module %r has no mapped classes "
            "registered under the name %r" % (self.__parent.name, key)
        )


class _GetColumns:
    __slots__ = ("cls",)

    cls: Type[Any]

    def __init__(self, cls: Type[Any]):
        self.cls = cls

    def __getattr__(self, key: str) -> Any:
        mp = class_mapper(self.cls, configure=False)
        if mp:
            if key not in mp.all_orm_descriptors:
                raise AttributeError(
                    "Class %r does not have a mapped column named %r"
                    % (self.cls, key)
                )

            desc = mp.all_orm_descriptors[key]
            if desc.extension_type is interfaces.NotExtension.NOT_EXTENSION:
                assert isinstance(desc, attributes.QueryableAttribute)
                prop = desc.property
                if isinstance(prop, SynonymProperty):
                    key = prop.name
                elif not isinstance(prop, ColumnProperty):
                    raise exc.InvalidRequestError(
                        "Property %r is not an instance of"
                        " ColumnProperty (i.e. does not correspond"
                        " directly to a Column)." % key
                    )
        return getattr(self.cls, key)


inspection._inspects(_GetColumns)(
    lambda target: inspection.inspect(target.cls)
)


class _GetTable:
    __slots__ = "key", "metadata"

    key: str
    metadata: MetaData

    def __init__(self, key: str, metadata: MetaData):
        self.key = key
        self.metadata = metadata

    def __getattr__(self, key: str) -> Table:
        return self.metadata.tables[_get_table_key(key, self.key)]


def _determine_container(key: str, value: Any) -> _GetColumns:
    if isinstance(value, _MultipleClassMarker):
        value = value.attempt_get([], key)
    return _GetColumns(value)


class _class_resolver:
    __slots__ = (
        "cls",
        "prop",
        "arg",
        "fallback",
        "_dict",
        "_resolvers",
        "favor_tables",
    )

    cls: Type[Any]
    prop: RelationshipProperty[Any]
    fallback: Mapping[str, Any]
    arg: str
    favor_tables: bool
    _resolvers: Tuple[Callable[[str], Any], ...]

    def __init__(
        self,
        cls: Type[Any],
        prop: RelationshipProperty[Any],
        fallback: Mapping[str, Any],
        arg: str,
        favor_tables: bool = False,
    ):
        self.cls = cls
        self.prop = prop
        self.arg = arg
        self.fallback = fallback
        self._dict = util.PopulateDict(self._access_cls)
        self._resolvers = ()
        self.favor_tables = favor_tables

    def _access_cls(self, key: str) -> Any:
        cls = self.cls

        manager = attributes.manager_of_class(cls)
        decl_base = manager.registry
        assert decl_base is not None
        decl_class_registry = decl_base._class_registry
        metadata = decl_base.metadata

        if self.favor_tables:
            if key in metadata.tables:
                return metadata.tables[key]
            elif key in metadata._schemas:
                return _GetTable(key, getattr(cls, "metadata", metadata))

        if key in decl_class_registry:
            return _determine_container(key, decl_class_registry[key])

        if not self.favor_tables:
            if key in metadata.tables:
                return metadata.tables[key]
            elif key in metadata._schemas:
                return _GetTable(key, getattr(cls, "metadata", metadata))

        if "_sa_module_registry" in decl_class_registry and key in cast(
            _ModuleMarker, decl_class_registry["_sa_module_registry"]
        ):
            registry = cast(
                _ModuleMarker, decl_class_registry["_sa_module_registry"]
            )
            return registry.resolve_attr(key)
        elif self._resolvers:
            for resolv in self._resolvers:
                value = resolv(key)
                if value is not None:
                    return value

        return self.fallback[key]

    def _raise_for_name(self, name: str, err: Exception) -> NoReturn:
        generic_match = re.match(r"(.+)\[(.+)\]", name)

        if generic_match:
            clsarg = generic_match.group(2).strip("'")
            raise exc.InvalidRequestError(
                f"When initializing mapper {self.prop.parent}, "
                f'expression "relationship({self.arg!r})" seems to be '
                "using a generic class as the argument to relationship(); "
                "please state the generic argument "
                "using an annotation, e.g. "
                f'"{self.prop.key}: Mapped[{generic_match.group(1)}'
                f"['{clsarg}']] = relationship()\""
            ) from err
        else:
            raise exc.InvalidRequestError(
                "When initializing mapper %s, expression %r failed to "
                "locate a name (%r). If this is a class name, consider "
                "adding this relationship() to the %r class after "
                "both dependent classes have been defined."
                % (self.prop.parent, self.arg, name, self.cls)
            ) from err

    def _resolve_name(self) -> Union[Table, Type[Any], _ModNS]:
        name = self.arg
        d = self._dict
        rval = None
        try:
            for token in name.split("."):
                if rval is None:
                    rval = d[token]
                else:
                    rval = getattr(rval, token)
        except KeyError as err:
            self._raise_for_name(name, err)
        except NameError as n:
            self._raise_for_name(n.args[0], n)
        else:
            if isinstance(rval, _GetColumns):
                return rval.cls
            else:
                if TYPE_CHECKING:
                    assert isinstance(rval, (type, Table, _ModNS))
                return rval

    def __call__(self) -> Any:
        try:
            x = eval(self.arg, globals(), self._dict)

            if isinstance(x, _GetColumns):
                return x.cls
            else:
                return x
        except NameError as n:
            self._raise_for_name(n.args[0], n)


_fallback_dict: Mapping[str, Any] = None  # type: ignore


def _resolver(
    cls: Type[Any], prop: RelationshipProperty[Any]
) -> Tuple[
    Callable[[str], Callable[[], Union[Type[Any], Table, _ModNS]]],
    Callable[[str, bool], _class_resolver],
]:
    global _fallback_dict

    if _fallback_dict is None:
        import sqlalchemy
        from . import foreign
        from . import remote

        _fallback_dict = util.immutabledict(sqlalchemy.__dict__).union(
            {"foreign": foreign, "remote": remote}
        )

    def resolve_arg(arg: str, favor_tables: bool = False) -> _class_resolver:
        return _class_resolver(
            cls, prop, _fallback_dict, arg, favor_tables=favor_tables
        )

    def resolve_name(
        arg: str,
    ) -> Callable[[], Union[Type[Any], Table, _ModNS]]:
        return _class_resolver(cls, prop, _fallback_dict, arg)._resolve_name

    return resolve_name, resolve_arg
