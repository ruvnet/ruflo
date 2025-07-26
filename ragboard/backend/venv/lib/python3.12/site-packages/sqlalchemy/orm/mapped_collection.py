# orm/mapped_collection.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import operator
from typing import Any
from typing import Callable
from typing import Dict
from typing import Generic
from typing import List
from typing import Optional
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import base
from .collections import collection
from .collections import collection_adapter
from .. import exc as sa_exc
from .. import util
from ..sql import coercions
from ..sql import expression
from ..sql import roles
from ..util.typing import Literal

if TYPE_CHECKING:
    from . import AttributeEventToken
    from . import Mapper
    from .collections import CollectionAdapter
    from ..sql.elements import ColumnElement

_KT = TypeVar("_KT", bound=Any)
_VT = TypeVar("_VT", bound=Any)

_F = TypeVar("_F", bound=Callable[[Any], Any])


class _PlainColumnGetter(Generic[_KT]):
    """Plain column getter, stores collection of Column objects
    directly.

    Serializes to a :class:`._SerializableColumnGetterV2`
    which has more expensive __call__() performance
    and some rare caveats.

    """

    __slots__ = ("cols", "composite")

    def __init__(self, cols: Sequence[ColumnElement[_KT]]) -> None:
        self.cols = cols
        self.composite = len(cols) > 1

    def __reduce__(
        self,
    ) -> Tuple[
        Type[_SerializableColumnGetterV2[_KT]],
        Tuple[Sequence[Tuple[Optional[str], Optional[str]]]],
    ]:
        return _SerializableColumnGetterV2._reduce_from_cols(self.cols)

    def _cols(self, mapper: Mapper[_KT]) -> Sequence[ColumnElement[_KT]]:
        return self.cols

    def __call__(self, value: _KT) -> Union[_KT, Tuple[_KT, ...]]:
        state = base.instance_state(value)
        m = base._state_mapper(state)

        key: List[_KT] = [
            m._get_state_attr_by_column(state, state.dict, col)
            for col in self._cols(m)
        ]
        if self.composite:
            return tuple(key)
        else:
            obj = key[0]
            if obj is None:
                return _UNMAPPED_AMBIGUOUS_NONE
            else:
                return obj


class _SerializableColumnGetterV2(_PlainColumnGetter[_KT]):
    """Updated serializable getter which deals with
    multi-table mapped classes.

    Two extremely unusual cases are not supported.
    Mappings which have tables across multiple metadata
    objects, or which are mapped to non-Table selectables
    linked across inheriting mappers may fail to function
    here.

    """

    __slots__ = ("colkeys",)

    def __init__(
        self, colkeys: Sequence[Tuple[Optional[str], Optional[str]]]
    ) -> None:
        self.colkeys = colkeys
        self.composite = len(colkeys) > 1

    def __reduce__(
        self,
    ) -> Tuple[
        Type[_SerializableColumnGetterV2[_KT]],
        Tuple[Sequence[Tuple[Optional[str], Optional[str]]]],
    ]:
        return self.__class__, (self.colkeys,)

    @classmethod
    def _reduce_from_cols(
        cls, cols: Sequence[ColumnElement[_KT]]
    ) -> Tuple[
        Type[_SerializableColumnGetterV2[_KT]],
        Tuple[Sequence[Tuple[Optional[str], Optional[str]]]],
    ]:
        def _table_key(c: ColumnElement[_KT]) -> Optional[str]:
            if not isinstance(c.table, expression.TableClause):
                return None
            else:
                return c.table.key  # type: ignore

        colkeys = [(c.key, _table_key(c)) for c in cols]
        return _SerializableColumnGetterV2, (colkeys,)

    def _cols(self, mapper: Mapper[_KT]) -> Sequence[ColumnElement[_KT]]:
        cols: List[ColumnElement[_KT]] = []
        metadata = getattr(mapper.local_table, "metadata", None)
        for ckey, tkey in self.colkeys:
            if tkey is None or metadata is None or tkey not in metadata:
                cols.append(mapper.local_table.c[ckey])  # type: ignore
            else:
                cols.append(metadata.tables[tkey].c[ckey])
        return cols


def column_keyed_dict(
    mapping_spec: Union[Type[_KT], Callable[[_KT], _VT]],
    *,
    ignore_unpopulated_attribute: bool = False,
) -> Type[KeyFuncDict[_KT, _KT]]:
    """A dictionary-based collection type with column-based keying.

    .. versionchanged:: 2.0 Renamed :data:`.column_mapped_collection` to
       :class:`.column_keyed_dict`.

    Returns a :class:`.KeyFuncDict` factory which will produce new
    dictionary keys based on the value of a particular :class:`.Column`-mapped
    attribute on ORM mapped instances to be added to the dictionary.

    .. note:: the value of the target attribute must be assigned with its
       value at the time that the object is being added to the
       dictionary collection.   Additionally, changes to the key attribute
       are **not tracked**, which means the key in the dictionary is not
       automatically synchronized with the key value on the target object
       itself.  See :ref:`key_collections_mutations` for further details.

    .. seealso::

        :ref:`orm_dictionary_collection` - background on use

    :param mapping_spec: a :class:`_schema.Column` object that is expected
     to be mapped by the target mapper to a particular attribute on the
     mapped class, the value of which on a particular instance is to be used
     as the key for a new dictionary entry for that instance.
    :param ignore_unpopulated_attribute:  if True, and the mapped attribute
     indicated by the given :class:`_schema.Column` target attribute
     on an object is not populated at all, the operation will be silently
     skipped.  By default, an error is raised.

     .. versionadded:: 2.0 an error is raised by default if the attribute
        being used for the dictionary key is determined that it was never
        populated with any value.  The
        :paramref:`_orm.column_keyed_dict.ignore_unpopulated_attribute`
        parameter may be set which will instead indicate that this condition
        should be ignored, and the append operation silently skipped.
        This is in contrast to the behavior of the 1.x series which would
        erroneously populate the value in the dictionary with an arbitrary key
        value of ``None``.


    """
    cols = [
        coercions.expect(roles.ColumnArgumentRole, q, argname="mapping_spec")
        for q in util.to_list(mapping_spec)
    ]
    keyfunc = _PlainColumnGetter(cols)
    return _mapped_collection_cls(
        keyfunc,
        ignore_unpopulated_attribute=ignore_unpopulated_attribute,
    )


_UNMAPPED_AMBIGUOUS_NONE = object()


class _AttrGetter:
    __slots__ = ("attr_name", "getter")

    def __init__(self, attr_name: str):
        self.attr_name = attr_name
        self.getter = operator.attrgetter(attr_name)

    def __call__(self, mapped_object: Any) -> Any:
        obj = self.getter(mapped_object)
        if obj is None:
            state = base.instance_state(mapped_object)
            mp = state.mapper
            if self.attr_name in mp.attrs:
                dict_ = state.dict
                obj = dict_.get(self.attr_name, base.NO_VALUE)
                if obj is None:
                    return _UNMAPPED_AMBIGUOUS_NONE
            else:
                return _UNMAPPED_AMBIGUOUS_NONE

        return obj

    def __reduce__(self) -> Tuple[Type[_AttrGetter], Tuple[str]]:
        return _AttrGetter, (self.attr_name,)


def attribute_keyed_dict(
    attr_name: str, *, ignore_unpopulated_attribute: bool = False
) -> Type[KeyFuncDict[Any, Any]]:
    """A dictionary-based collection type with attribute-based keying.

    .. versionchanged:: 2.0 Renamed :data:`.attribute_mapped_collection` to
       :func:`.attribute_keyed_dict`.

    Returns a :class:`.KeyFuncDict` factory which will produce new
    dictionary keys based on the value of a particular named attribute on
    ORM mapped instances to be added to the dictionary.

    .. note:: the value of the target attribute must be assigned with its
       value at the time that the object is being added to the
       dictionary collection.   Additionally, changes to the key attribute
       are **not tracked**, which means the key in the dictionary is not
       automatically synchronized with the key value on the target object
       itself.  See :ref:`key_collections_mutations` for further details.

    .. seealso::

        :ref:`orm_dictionary_collection` - background on use

    :param attr_name: string name of an ORM-mapped attribute
     on the mapped class, the value of which on a particular instance
     is to be used as the key for a new dictionary entry for that instance.
    :param ignore_unpopulated_attribute:  if True, and the target attribute
     on an object is not populated at all, the operation will be silently
     skipped.  By default, an error is raised.

     .. versionadded:: 2.0 an error is raised by default if the attribute
        being used for the dictionary key is determined that it was never
        populated with any value.  The
        :paramref:`_orm.attribute_keyed_dict.ignore_unpopulated_attribute`
        parameter may be set which will instead indicate that this condition
        should be ignored, and the append operation silently skipped.
        This is in contrast to the behavior of the 1.x series which would
        erroneously populate the value in the dictionary with an arbitrary key
        value of ``None``.


    """

    return _mapped_collection_cls(
        _AttrGetter(attr_name),
        ignore_unpopulated_attribute=ignore_unpopulated_attribute,
    )


def keyfunc_mapping(
    keyfunc: _F,
    *,
    ignore_unpopulated_attribute: bool = False,
) -> Type[KeyFuncDict[_KT, Any]]:
    """A dictionary-based collection type with arbitrary keying.

    .. versionchanged:: 2.0 Renamed :data:`.mapped_collection` to
       :func:`.keyfunc_mapping`.

    Returns a :class:`.KeyFuncDict` factory with a keying function
    generated from keyfunc, a callable that takes an entity and returns a
    key value.

    .. note:: the given keyfunc is called only once at the time that the
       target object is being added to the collection.   Changes to the
       effective value returned by the function are not tracked.


    .. seealso::

        :ref:`orm_dictionary_collection` - background on use

    :param keyfunc: a callable that will be passed the ORM-mapped instance
     which should then generate a new key to use in the dictionary.
     If the value returned is :attr:`.LoaderCallableStatus.NO_VALUE`, an error
     is raised.
    :param ignore_unpopulated_attribute:  if True, and the callable returns
     :attr:`.LoaderCallableStatus.NO_VALUE` for a particular instance, the
     operation will be silently skipped.  By default, an error is raised.

     .. versionadded:: 2.0 an error is raised by default if the callable
        being used for the dictionary key returns
        :attr:`.LoaderCallableStatus.NO_VALUE`, which in an ORM attribute
        context indicates an attribute that was never populated with any value.
        The :paramref:`_orm.mapped_collection.ignore_unpopulated_attribute`
        parameter may be set which will instead indicate that this condition
        should be ignored, and the append operation silently skipped. This is
        in contrast to the behavior of the 1.x series which would erroneously
        populate the value in the dictionary with an arbitrary key value of
        ``None``.


    """
    return _mapped_collection_cls(
        keyfunc, ignore_unpopulated_attribute=ignore_unpopulated_attribute
    )


class KeyFuncDict(Dict[_KT, _VT]):
    """Base for ORM mapped dictionary classes.

    Extends the ``dict`` type with additional methods needed by SQLAlchemy ORM
    collection classes. Use of :class:`_orm.KeyFuncDict` is most directly
    by using the :func:`.attribute_keyed_dict` or
    :func:`.column_keyed_dict` class factories.
    :class:`_orm.KeyFuncDict` may also serve as the base for user-defined
    custom dictionary classes.

    .. versionchanged:: 2.0 Renamed :class:`.MappedCollection` to
       :class:`.KeyFuncDict`.

    .. seealso::

        :func:`_orm.attribute_keyed_dict`

        :func:`_orm.column_keyed_dict`

        :ref:`orm_dictionary_collection`

        :ref:`orm_custom_collection`


    """

    def __init__(
        self,
        keyfunc: _F,
        *dict_args: Any,
        ignore_unpopulated_attribute: bool = False,
    ) -> None:
        """Create a new collection with keying provided by keyfunc.

        keyfunc may be any callable that takes an object and returns an object
        for use as a dictionary key.

        The keyfunc will be called every time the ORM needs to add a member by
        value-only (such as when loading instances from the database) or
        remove a member.  The usual cautions about dictionary keying apply-
        ``keyfunc(object)`` should return the same output for the life of the
        collection.  Keying based on mutable properties can result in
        unreachable instances "lost" in the collection.

        """
        self.keyfunc = keyfunc
        self.ignore_unpopulated_attribute = ignore_unpopulated_attribute
        super().__init__(*dict_args)

    @classmethod
    def _unreduce(
        cls,
        keyfunc: _F,
        values: Dict[_KT, _KT],
        adapter: Optional[CollectionAdapter] = None,
    ) -> "KeyFuncDict[_KT, _KT]":
        mp: KeyFuncDict[_KT, _KT] = KeyFuncDict(keyfunc)
        mp.update(values)
        # note that the adapter sets itself up onto this collection
        # when its `__setstate__` method is called
        return mp

    def __reduce__(
        self,
    ) -> Tuple[
        Callable[[_KT, _KT], KeyFuncDict[_KT, _KT]],
        Tuple[Any, Union[Dict[_KT, _KT], Dict[_KT, _KT]], CollectionAdapter],
    ]:
        return (
            KeyFuncDict._unreduce,
            (
                self.keyfunc,
                dict(self),
                collection_adapter(self),
            ),
        )

    @util.preload_module("sqlalchemy.orm.attributes")
    def _raise_for_unpopulated(
        self,
        value: _KT,
        initiator: Union[AttributeEventToken, Literal[None, False]] = None,
        *,
        warn_only: bool,
    ) -> None:
        mapper = base.instance_state(value).mapper

        attributes = util.preloaded.orm_attributes

        if not isinstance(initiator, attributes.AttributeEventToken):
            relationship = "unknown relationship"
        elif initiator.key in mapper.attrs:
            relationship = f"{mapper.attrs[initiator.key]}"
        else:
            relationship = initiator.key

        if warn_only:
            util.warn(
                f"Attribute keyed dictionary value for "
                f"attribute '{relationship}' was None; this will raise "
                "in a future release. "
                f"To skip this assignment entirely, "
                f'Set the "ignore_unpopulated_attribute=True" '
                f"parameter on the mapped collection factory."
            )
        else:
            raise sa_exc.InvalidRequestError(
                "In event triggered from population of "
                f"attribute '{relationship}' "
                "(potentially from a backref), "
                f"can't populate value in KeyFuncDict; "
                "dictionary key "
                f"derived from {base.instance_str(value)} is not "
                f"populated. Ensure appropriate state is set up on "
                f"the {base.instance_str(value)} object "
                f"before assigning to the {relationship} attribute. "
                f"To skip this assignment entirely, "
                f'Set the "ignore_unpopulated_attribute=True" '
                f"parameter on the mapped collection factory."
            )

    @collection.appender  # type: ignore[misc]
    @collection.internally_instrumented  # type: ignore[misc]
    def set(
        self,
        value: _KT,
        _sa_initiator: Union[AttributeEventToken, Literal[None, False]] = None,
    ) -> None:
        """Add an item by value, consulting the keyfunc for the key."""

        key = self.keyfunc(value)

        if key is base.NO_VALUE:
            if not self.ignore_unpopulated_attribute:
                self._raise_for_unpopulated(
                    value, _sa_initiator, warn_only=False
                )
            else:
                return
        elif key is _UNMAPPED_AMBIGUOUS_NONE:
            if not self.ignore_unpopulated_attribute:
                self._raise_for_unpopulated(
                    value, _sa_initiator, warn_only=True
                )
                key = None
            else:
                return

        self.__setitem__(key, value, _sa_initiator)  # type: ignore[call-arg]

    @collection.remover  # type: ignore[misc]
    @collection.internally_instrumented  # type: ignore[misc]
    def remove(
        self,
        value: _KT,
        _sa_initiator: Union[AttributeEventToken, Literal[None, False]] = None,
    ) -> None:
        """Remove an item by value, consulting the keyfunc for the key."""

        key = self.keyfunc(value)

        if key is base.NO_VALUE:
            if not self.ignore_unpopulated_attribute:
                self._raise_for_unpopulated(
                    value, _sa_initiator, warn_only=False
                )
            return
        elif key is _UNMAPPED_AMBIGUOUS_NONE:
            if not self.ignore_unpopulated_attribute:
                self._raise_for_unpopulated(
                    value, _sa_initiator, warn_only=True
                )
                key = None
            else:
                return

        # Let self[key] raise if key is not in this collection
        # testlib.pragma exempt:__ne__
        if self[key] != value:
            raise sa_exc.InvalidRequestError(
                "Can not remove '%s': collection holds '%s' for key '%s'. "
                "Possible cause: is the KeyFuncDict key function "
                "based on mutable properties or properties that only obtain "
                "values after flush?" % (value, self[key], key)
            )
        self.__delitem__(key, _sa_initiator)  # type: ignore[call-arg]


def _mapped_collection_cls(
    keyfunc: _F, ignore_unpopulated_attribute: bool
) -> Type[KeyFuncDict[_KT, _KT]]:
    class _MKeyfuncMapped(KeyFuncDict[_KT, _KT]):
        def __init__(self, *dict_args: Any) -> None:
            super().__init__(
                keyfunc,
                *dict_args,
                ignore_unpopulated_attribute=ignore_unpopulated_attribute,
            )

    return _MKeyfuncMapped


MappedCollection = KeyFuncDict
"""A synonym for :class:`.KeyFuncDict`.

.. versionchanged:: 2.0 Renamed :class:`.MappedCollection` to
   :class:`.KeyFuncDict`.

"""

mapped_collection = keyfunc_mapping
"""A synonym for :func:`_orm.keyfunc_mapping`.

.. versionchanged:: 2.0 Renamed :data:`.mapped_collection` to
   :func:`_orm.keyfunc_mapping`

"""

attribute_mapped_collection = attribute_keyed_dict
"""A synonym for :func:`_orm.attribute_keyed_dict`.

.. versionchanged:: 2.0 Renamed :data:`.attribute_mapped_collection` to
   :func:`_orm.attribute_keyed_dict`

"""

column_mapped_collection = column_keyed_dict
"""A synonym for :func:`_orm.column_keyed_dict.

.. versionchanged:: 2.0 Renamed :func:`.column_mapped_collection` to
   :func:`_orm.column_keyed_dict`

"""
