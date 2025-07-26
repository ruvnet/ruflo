# ext/mutable.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

r"""Provide support for tracking of in-place changes to scalar values,
which are propagated into ORM change events on owning parent objects.

.. _mutable_scalars:

Establishing Mutability on Scalar Column Values
===============================================

A typical example of a "mutable" structure is a Python dictionary.
Following the example introduced in :ref:`types_toplevel`, we
begin with a custom type that marshals Python dictionaries into
JSON strings before being persisted::

    from sqlalchemy.types import TypeDecorator, VARCHAR
    import json

    class JSONEncodedDict(TypeDecorator):
        "Represents an immutable structure as a json-encoded string."

        impl = VARCHAR

        def process_bind_param(self, value, dialect):
            if value is not None:
                value = json.dumps(value)
            return value

        def process_result_value(self, value, dialect):
            if value is not None:
                value = json.loads(value)
            return value

The usage of ``json`` is only for the purposes of example. The
:mod:`sqlalchemy.ext.mutable` extension can be used
with any type whose target Python type may be mutable, including
:class:`.PickleType`, :class:`_postgresql.ARRAY`, etc.

When using the :mod:`sqlalchemy.ext.mutable` extension, the value itself
tracks all parents which reference it.  Below, we illustrate a simple
version of the :class:`.MutableDict` dictionary object, which applies
the :class:`.Mutable` mixin to a plain Python dictionary::

    from sqlalchemy.ext.mutable import Mutable

    class MutableDict(Mutable, dict):
        @classmethod
        def coerce(cls, key, value):
            "Convert plain dictionaries to MutableDict."

            if not isinstance(value, MutableDict):
                if isinstance(value, dict):
                    return MutableDict(value)

                # this call will raise ValueError
                return Mutable.coerce(key, value)
            else:
                return value

        def __setitem__(self, key, value):
            "Detect dictionary set events and emit change events."

            dict.__setitem__(self, key, value)
            self.changed()

        def __delitem__(self, key):
            "Detect dictionary del events and emit change events."

            dict.__delitem__(self, key)
            self.changed()

The above dictionary class takes the approach of subclassing the Python
built-in ``dict`` to produce a dict
subclass which routes all mutation events through ``__setitem__``.  There are
variants on this approach, such as subclassing ``UserDict.UserDict`` or
``collections.MutableMapping``; the part that's important to this example is
that the :meth:`.Mutable.changed` method is called whenever an in-place
change to the datastructure takes place.

We also redefine the :meth:`.Mutable.coerce` method which will be used to
convert any values that are not instances of ``MutableDict``, such
as the plain dictionaries returned by the ``json`` module, into the
appropriate type.  Defining this method is optional; we could just as well
created our ``JSONEncodedDict`` such that it always returns an instance
of ``MutableDict``, and additionally ensured that all calling code
uses ``MutableDict`` explicitly.  When :meth:`.Mutable.coerce` is not
overridden, any values applied to a parent object which are not instances
of the mutable type will raise a ``ValueError``.

Our new ``MutableDict`` type offers a class method
:meth:`~.Mutable.as_mutable` which we can use within column metadata
to associate with types. This method grabs the given type object or
class and associates a listener that will detect all future mappings
of this type, applying event listening instrumentation to the mapped
attribute. Such as, with classical table metadata::

    from sqlalchemy import Table, Column, Integer

    my_data = Table('my_data', metadata,
        Column('id', Integer, primary_key=True),
        Column('data', MutableDict.as_mutable(JSONEncodedDict))
    )

Above, :meth:`~.Mutable.as_mutable` returns an instance of ``JSONEncodedDict``
(if the type object was not an instance already), which will intercept any
attributes which are mapped against this type.  Below we establish a simple
mapping against the ``my_data`` table::

    from sqlalchemy.orm import DeclarativeBase
    from sqlalchemy.orm import Mapped
    from sqlalchemy.orm import mapped_column

    class Base(DeclarativeBase):
        pass

    class MyDataClass(Base):
        __tablename__ = 'my_data'
        id: Mapped[int] = mapped_column(primary_key=True)
        data: Mapped[dict[str, str]] = mapped_column(MutableDict.as_mutable(JSONEncodedDict))

The ``MyDataClass.data`` member will now be notified of in place changes
to its value.

Any in-place changes to the ``MyDataClass.data`` member
will flag the attribute as "dirty" on the parent object::

    >>> from sqlalchemy.orm import Session

    >>> sess = Session(some_engine)
    >>> m1 = MyDataClass(data={'value1':'foo'})
    >>> sess.add(m1)
    >>> sess.commit()

    >>> m1.data['value1'] = 'bar'
    >>> assert m1 in sess.dirty
    True

The ``MutableDict`` can be associated with all future instances
of ``JSONEncodedDict`` in one step, using
:meth:`~.Mutable.associate_with`.  This is similar to
:meth:`~.Mutable.as_mutable` except it will intercept all occurrences
of ``MutableDict`` in all mappings unconditionally, without
the need to declare it individually::

    from sqlalchemy.orm import DeclarativeBase
    from sqlalchemy.orm import Mapped
    from sqlalchemy.orm import mapped_column

    MutableDict.associate_with(JSONEncodedDict)

    class Base(DeclarativeBase):
        pass

    class MyDataClass(Base):
        __tablename__ = 'my_data'
        id: Mapped[int] = mapped_column(primary_key=True)
        data: Mapped[dict[str, str]] = mapped_column(JSONEncodedDict)


Supporting Pickling
--------------------

The key to the :mod:`sqlalchemy.ext.mutable` extension relies upon the
placement of a ``weakref.WeakKeyDictionary`` upon the value object, which
stores a mapping of parent mapped objects keyed to the attribute name under
which they are associated with this value. ``WeakKeyDictionary`` objects are
not picklable, due to the fact that they contain weakrefs and function
callbacks. In our case, this is a good thing, since if this dictionary were
picklable, it could lead to an excessively large pickle size for our value
objects that are pickled by themselves outside of the context of the parent.
The developer responsibility here is only to provide a ``__getstate__`` method
that excludes the :meth:`~MutableBase._parents` collection from the pickle
stream::

    class MyMutableType(Mutable):
        def __getstate__(self):
            d = self.__dict__.copy()
            d.pop('_parents', None)
            return d

With our dictionary example, we need to return the contents of the dict itself
(and also restore them on __setstate__)::

    class MutableDict(Mutable, dict):
        # ....

        def __getstate__(self):
            return dict(self)

        def __setstate__(self, state):
            self.update(state)

In the case that our mutable value object is pickled as it is attached to one
or more parent objects that are also part of the pickle, the :class:`.Mutable`
mixin will re-establish the :attr:`.Mutable._parents` collection on each value
object as the owning parents themselves are unpickled.

Receiving Events
----------------

The :meth:`.AttributeEvents.modified` event handler may be used to receive
an event when a mutable scalar emits a change event.  This event handler
is called when the :func:`.attributes.flag_modified` function is called
from within the mutable extension::

    from sqlalchemy.orm import DeclarativeBase
    from sqlalchemy.orm import Mapped
    from sqlalchemy.orm import mapped_column
    from sqlalchemy import event

    class Base(DeclarativeBase):
        pass

    class MyDataClass(Base):
        __tablename__ = 'my_data'
        id: Mapped[int] = mapped_column(primary_key=True)
        data: Mapped[dict[str, str]] = mapped_column(MutableDict.as_mutable(JSONEncodedDict))

    @event.listens_for(MyDataClass.data, "modified")
    def modified_json(instance, initiator):
        print("json value modified:", instance.data)

.. _mutable_composites:

Establishing Mutability on Composites
=====================================

Composites are a special ORM feature which allow a single scalar attribute to
be assigned an object value which represents information "composed" from one
or more columns from the underlying mapped table. The usual example is that of
a geometric "point", and is introduced in :ref:`mapper_composite`.

As is the case with :class:`.Mutable`, the user-defined composite class
subclasses :class:`.MutableComposite` as a mixin, and detects and delivers
change events to its parents via the :meth:`.MutableComposite.changed` method.
In the case of a composite class, the detection is usually via the usage of the
special Python method ``__setattr__()``. In the example below, we expand upon the ``Point``
class introduced in :ref:`mapper_composite` to include
:class:`.MutableComposite` in its bases and to route attribute set events via
``__setattr__`` to the :meth:`.MutableComposite.changed` method::

    import dataclasses
    from sqlalchemy.ext.mutable import MutableComposite

    @dataclasses.dataclass
    class Point(MutableComposite):
        x: int
        y: int

        def __setattr__(self, key, value):
            "Intercept set events"

            # set the attribute
            object.__setattr__(self, key, value)

            # alert all parents to the change
            self.changed()


The :class:`.MutableComposite` class makes use of class mapping events to
automatically establish listeners for any usage of :func:`_orm.composite` that
specifies our ``Point`` type. Below, when ``Point`` is mapped to the ``Vertex``
class, listeners are established which will route change events from ``Point``
objects to each of the ``Vertex.start`` and ``Vertex.end`` attributes::

    from sqlalchemy.orm import DeclarativeBase, Mapped
    from sqlalchemy.orm import composite, mapped_column

    class Base(DeclarativeBase):
        pass


    class Vertex(Base):
        __tablename__ = "vertices"

        id: Mapped[int] = mapped_column(primary_key=True)

        start: Mapped[Point] = composite(mapped_column("x1"), mapped_column("y1"))
        end: Mapped[Point] = composite(mapped_column("x2"), mapped_column("y2"))

        def __repr__(self):
            return f"Vertex(start={self.start}, end={self.end})"

Any in-place changes to the ``Vertex.start`` or ``Vertex.end`` members
will flag the attribute as "dirty" on the parent object:

.. sourcecode:: python+sql

    >>> from sqlalchemy.orm import Session
    >>> sess = Session(engine)
    >>> v1 = Vertex(start=Point(3, 4), end=Point(12, 15))
    >>> sess.add(v1)
    {sql}>>> sess.flush()
    BEGIN (implicit)
    INSERT INTO vertices (x1, y1, x2, y2) VALUES (?, ?, ?, ?)
    [...] (3, 4, 12, 15)

    {stop}>>> v1.end.x = 8
    >>> assert v1 in sess.dirty
    True
    {sql}>>> sess.commit()
    UPDATE vertices SET x2=? WHERE vertices.id = ?
    [...] (8, 1)
    COMMIT

Coercing Mutable Composites
---------------------------

The :meth:`.MutableBase.coerce` method is also supported on composite types.
In the case of :class:`.MutableComposite`, the :meth:`.MutableBase.coerce`
method is only called for attribute set operations, not load operations.
Overriding the :meth:`.MutableBase.coerce` method is essentially equivalent
to using a :func:`.validates` validation routine for all attributes which
make use of the custom composite type::

    @dataclasses.dataclass
    class Point(MutableComposite):
        # other Point methods
        # ...

        def coerce(cls, key, value):
            if isinstance(value, tuple):
                value = Point(*value)
            elif not isinstance(value, Point):
                raise ValueError("tuple or Point expected")
            return value

Supporting Pickling
--------------------

As is the case with :class:`.Mutable`, the :class:`.MutableComposite` helper
class uses a ``weakref.WeakKeyDictionary`` available via the
:meth:`MutableBase._parents` attribute which isn't picklable. If we need to
pickle instances of ``Point`` or its owning class ``Vertex``, we at least need
to define a ``__getstate__`` that doesn't include the ``_parents`` dictionary.
Below we define both a ``__getstate__`` and a ``__setstate__`` that package up
the minimal form of our ``Point`` class::

    @dataclasses.dataclass
    class Point(MutableComposite):
        # ...

        def __getstate__(self):
            return self.x, self.y

        def __setstate__(self, state):
            self.x, self.y = state

As with :class:`.Mutable`, the :class:`.MutableComposite` augments the
pickling process of the parent's object-relational state so that the
:meth:`MutableBase._parents` collection is restored to all ``Point`` objects.

"""  # noqa: E501

from __future__ import annotations

from collections import defaultdict
from typing import AbstractSet
from typing import Any
from typing import Dict
from typing import Iterable
from typing import List
from typing import Optional
from typing import overload
from typing import Set
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import weakref
from weakref import WeakKeyDictionary

from .. import event
from .. import inspect
from .. import types
from .. import util
from ..orm import Mapper
from ..orm._typing import _ExternalEntityType
from ..orm._typing import _O
from ..orm._typing import _T
from ..orm.attributes import AttributeEventToken
from ..orm.attributes import flag_modified
from ..orm.attributes import InstrumentedAttribute
from ..orm.attributes import QueryableAttribute
from ..orm.context import QueryContext
from ..orm.decl_api import DeclarativeAttributeIntercept
from ..orm.state import InstanceState
from ..orm.unitofwork import UOWTransaction
from ..sql.base import SchemaEventTarget
from ..sql.schema import Column
from ..sql.type_api import TypeEngine
from ..util import memoized_property
from ..util.typing import SupportsIndex
from ..util.typing import TypeGuard

_KT = TypeVar("_KT")  # Key type.
_VT = TypeVar("_VT")  # Value type.


class MutableBase:
    """Common base class to :class:`.Mutable`
    and :class:`.MutableComposite`.

    """

    @memoized_property
    def _parents(self) -> WeakKeyDictionary[Any, Any]:
        """Dictionary of parent object's :class:`.InstanceState`->attribute
        name on the parent.

        This attribute is a so-called "memoized" property.  It initializes
        itself with a new ``weakref.WeakKeyDictionary`` the first time
        it is accessed, returning the same object upon subsequent access.

        .. versionchanged:: 1.4 the :class:`.InstanceState` is now used
           as the key in the weak dictionary rather than the instance
           itself.

        """

        return weakref.WeakKeyDictionary()

    @classmethod
    def coerce(cls, key: str, value: Any) -> Optional[Any]:
        """Given a value, coerce it into the target type.

        Can be overridden by custom subclasses to coerce incoming
        data into a particular type.

        By default, raises ``ValueError``.

        This method is called in different scenarios depending on if
        the parent class is of type :class:`.Mutable` or of type
        :class:`.MutableComposite`.  In the case of the former, it is called
        for both attribute-set operations as well as during ORM loading
        operations.  For the latter, it is only called during attribute-set
        operations; the mechanics of the :func:`.composite` construct
        handle coercion during load operations.


        :param key: string name of the ORM-mapped attribute being set.
        :param value: the incoming value.
        :return: the method should return the coerced value, or raise
         ``ValueError`` if the coercion cannot be completed.

        """
        if value is None:
            return None
        msg = "Attribute '%s' does not accept objects of type %s"
        raise ValueError(msg % (key, type(value)))

    @classmethod
    def _get_listen_keys(cls, attribute: QueryableAttribute[Any]) -> Set[str]:
        """Given a descriptor attribute, return a ``set()`` of the attribute
        keys which indicate a change in the state of this attribute.

        This is normally just ``set([attribute.key])``, but can be overridden
        to provide for additional keys.  E.g. a :class:`.MutableComposite`
        augments this set with the attribute keys associated with the columns
        that comprise the composite value.

        This collection is consulted in the case of intercepting the
        :meth:`.InstanceEvents.refresh` and
        :meth:`.InstanceEvents.refresh_flush` events, which pass along a list
        of attribute names that have been refreshed; the list is compared
        against this set to determine if action needs to be taken.

        """
        return {attribute.key}

    @classmethod
    def _listen_on_attribute(
        cls,
        attribute: QueryableAttribute[Any],
        coerce: bool,
        parent_cls: _ExternalEntityType[Any],
    ) -> None:
        """Establish this type as a mutation listener for the given
        mapped descriptor.

        """
        key = attribute.key
        if parent_cls is not attribute.class_:
            return

        # rely on "propagate" here
        parent_cls = attribute.class_

        listen_keys = cls._get_listen_keys(attribute)

        def load(state: InstanceState[_O], *args: Any) -> None:
            """Listen for objects loaded or refreshed.

            Wrap the target data member's value with
            ``Mutable``.

            """
            val = state.dict.get(key, None)
            if val is not None:
                if coerce:
                    val = cls.coerce(key, val)
                    state.dict[key] = val
                val._parents[state] = key

        def load_attrs(
            state: InstanceState[_O],
            ctx: Union[object, QueryContext, UOWTransaction],
            attrs: Iterable[Any],
        ) -> None:
            if not attrs or listen_keys.intersection(attrs):
                load(state)

        def set_(
            target: InstanceState[_O],
            value: MutableBase | None,
            oldvalue: MutableBase | None,
            initiator: AttributeEventToken,
        ) -> MutableBase | None:
            """Listen for set/replace events on the target
            data member.

            Establish a weak reference to the parent object
            on the incoming value, remove it for the one
            outgoing.

            """
            if value is oldvalue:
                return value

            if not isinstance(value, cls):
                value = cls.coerce(key, value)
            if value is not None:
                value._parents[target] = key
            if isinstance(oldvalue, cls):
                oldvalue._parents.pop(inspect(target), None)
            return value

        def pickle(
            state: InstanceState[_O], state_dict: Dict[str, Any]
        ) -> None:
            val = state.dict.get(key, None)
            if val is not None:
                if "ext.mutable.values" not in state_dict:
                    state_dict["ext.mutable.values"] = defaultdict(list)
                state_dict["ext.mutable.values"][key].append(val)

        def unpickle(
            state: InstanceState[_O], state_dict: Dict[str, Any]
        ) -> None:
            if "ext.mutable.values" in state_dict:
                collection = state_dict["ext.mutable.values"]
                if isinstance(collection, list):
                    # legacy format
                    for val in collection:
                        val._parents[state] = key
                else:
                    for val in state_dict["ext.mutable.values"][key]:
                        val._parents[state] = key

        event.listen(
            parent_cls,
            "_sa_event_merge_wo_load",
            load,
            raw=True,
            propagate=True,
        )

        event.listen(parent_cls, "load", load, raw=True, propagate=True)
        event.listen(
            parent_cls, "refresh", load_attrs, raw=True, propagate=True
        )
        event.listen(
            parent_cls, "refresh_flush", load_attrs, raw=True, propagate=True
        )
        event.listen(
            attribute, "set", set_, raw=True, retval=True, propagate=True
        )
        event.listen(parent_cls, "pickle", pickle, raw=True, propagate=True)
        event.listen(
            parent_cls, "unpickle", unpickle, raw=True, propagate=True
        )


class Mutable(MutableBase):
    """Mixin that defines transparent propagation of change
    events to a parent object.

    See the example in :ref:`mutable_scalars` for usage information.

    """

    def changed(self) -> None:
        """Subclasses should call this method whenever change events occur."""

        for parent, key in self._parents.items():
            flag_modified(parent.obj(), key)

    @classmethod
    def associate_with_attribute(
        cls, attribute: InstrumentedAttribute[_O]
    ) -> None:
        """Establish this type as a mutation listener for the given
        mapped descriptor.

        """
        cls._listen_on_attribute(attribute, True, attribute.class_)

    @classmethod
    def associate_with(cls, sqltype: type) -> None:
        """Associate this wrapper with all future mapped columns
        of the given type.

        This is a convenience method that calls
        ``associate_with_attribute`` automatically.

        .. warning::

           The listeners established by this method are *global*
           to all mappers, and are *not* garbage collected.   Only use
           :meth:`.associate_with` for types that are permanent to an
           application, not with ad-hoc types else this will cause unbounded
           growth in memory usage.

        """

        def listen_for_type(mapper: Mapper[_O], class_: type) -> None:
            if mapper.non_primary:
                return
            for prop in mapper.column_attrs:
                if isinstance(prop.columns[0].type, sqltype):
                    cls.associate_with_attribute(getattr(class_, prop.key))

        event.listen(Mapper, "mapper_configured", listen_for_type)

    @classmethod
    def as_mutable(cls, sqltype: TypeEngine[_T]) -> TypeEngine[_T]:
        """Associate a SQL type with this mutable Python type.

        This establishes listeners that will detect ORM mappings against
        the given type, adding mutation event trackers to those mappings.

        The type is returned, unconditionally as an instance, so that
        :meth:`.as_mutable` can be used inline::

            Table('mytable', metadata,
                Column('id', Integer, primary_key=True),
                Column('data', MyMutableType.as_mutable(PickleType))
            )

        Note that the returned type is always an instance, even if a class
        is given, and that only columns which are declared specifically with
        that type instance receive additional instrumentation.

        To associate a particular mutable type with all occurrences of a
        particular type, use the :meth:`.Mutable.associate_with` classmethod
        of the particular :class:`.Mutable` subclass to establish a global
        association.

        .. warning::

           The listeners established by this method are *global*
           to all mappers, and are *not* garbage collected.   Only use
           :meth:`.as_mutable` for types that are permanent to an application,
           not with ad-hoc types else this will cause unbounded growth
           in memory usage.

        """
        sqltype = types.to_instance(sqltype)

        # a SchemaType will be copied when the Column is copied,
        # and we'll lose our ability to link that type back to the original.
        # so track our original type w/ columns
        if isinstance(sqltype, SchemaEventTarget):

            @event.listens_for(sqltype, "before_parent_attach")
            def _add_column_memo(
                sqltyp: TypeEngine[Any],
                parent: Column[_T],
            ) -> None:
                parent.info["_ext_mutable_orig_type"] = sqltyp

            schema_event_check = True
        else:
            schema_event_check = False

        def listen_for_type(
            mapper: Mapper[_T],
            class_: Union[DeclarativeAttributeIntercept, type],
        ) -> None:
            if mapper.non_primary:
                return
            _APPLIED_KEY = "_ext_mutable_listener_applied"

            for prop in mapper.column_attrs:
                if (
                    # all Mutable types refer to a Column that's mapped,
                    # since this is the only kind of Core target the ORM can
                    # "mutate"
                    isinstance(prop.expression, Column)
                    and (
                        (
                            schema_event_check
                            and prop.expression.info.get(
                                "_ext_mutable_orig_type"
                            )
                            is sqltype
                        )
                        or prop.expression.type is sqltype
                    )
                ):
                    if not prop.expression.info.get(_APPLIED_KEY, False):
                        prop.expression.info[_APPLIED_KEY] = True
                        cls.associate_with_attribute(getattr(class_, prop.key))

        event.listen(Mapper, "mapper_configured", listen_for_type)

        return sqltype


class MutableComposite(MutableBase):
    """Mixin that defines transparent propagation of change
    events on a SQLAlchemy "composite" object to its
    owning parent or parents.

    See the example in :ref:`mutable_composites` for usage information.

    """

    @classmethod
    def _get_listen_keys(cls, attribute: QueryableAttribute[_O]) -> Set[str]:
        return {attribute.key}.union(attribute.property._attribute_keys)

    def changed(self) -> None:
        """Subclasses should call this method whenever change events occur."""

        for parent, key in self._parents.items():
            prop = parent.mapper.get_property(key)
            for value, attr_name in zip(
                prop._composite_values_from_instance(self),
                prop._attribute_keys,
            ):
                setattr(parent.obj(), attr_name, value)


def _setup_composite_listener() -> None:
    def _listen_for_type(mapper: Mapper[_T], class_: type) -> None:
        for prop in mapper.iterate_properties:
            if (
                hasattr(prop, "composite_class")
                and isinstance(prop.composite_class, type)
                and issubclass(prop.composite_class, MutableComposite)
            ):
                prop.composite_class._listen_on_attribute(
                    getattr(class_, prop.key), False, class_
                )

    if not event.contains(Mapper, "mapper_configured", _listen_for_type):
        event.listen(Mapper, "mapper_configured", _listen_for_type)


_setup_composite_listener()


class MutableDict(Mutable, Dict[_KT, _VT]):
    """A dictionary type that implements :class:`.Mutable`.

    The :class:`.MutableDict` object implements a dictionary that will
    emit change events to the underlying mapping when the contents of
    the dictionary are altered, including when values are added or removed.

    Note that :class:`.MutableDict` does **not** apply mutable tracking to  the
    *values themselves* inside the dictionary. Therefore it is not a sufficient
    solution for the use case of tracking deep changes to a *recursive*
    dictionary structure, such as a JSON structure.  To support this use case,
    build a subclass of  :class:`.MutableDict` that provides appropriate
    coercion to the values placed in the dictionary so that they too are
    "mutable", and emit events up to their parent structure.

    .. seealso::

        :class:`.MutableList`

        :class:`.MutableSet`

    """

    def __setitem__(self, key: _KT, value: _VT) -> None:
        """Detect dictionary set events and emit change events."""
        super().__setitem__(key, value)
        self.changed()

    if TYPE_CHECKING:
        # from https://github.com/python/mypy/issues/14858

        @overload
        def setdefault(
            self: MutableDict[_KT, Optional[_T]], key: _KT, value: None = None
        ) -> Optional[_T]:
            ...

        @overload
        def setdefault(self, key: _KT, value: _VT) -> _VT:
            ...

        def setdefault(self, key: _KT, value: object = None) -> object:
            ...

    else:

        def setdefault(self, *arg):  # noqa: F811
            result = super().setdefault(*arg)
            self.changed()
            return result

    def __delitem__(self, key: _KT) -> None:
        """Detect dictionary del events and emit change events."""
        super().__delitem__(key)
        self.changed()

    def update(self, *a: Any, **kw: _VT) -> None:
        super().update(*a, **kw)
        self.changed()

    if TYPE_CHECKING:

        @overload
        def pop(self, __key: _KT) -> _VT:
            ...

        @overload
        def pop(self, __key: _KT, __default: _VT | _T) -> _VT | _T:
            ...

        def pop(
            self, __key: _KT, __default: _VT | _T | None = None
        ) -> _VT | _T:
            ...

    else:

        def pop(self, *arg):  # noqa: F811
            result = super().pop(*arg)
            self.changed()
            return result

    def popitem(self) -> Tuple[_KT, _VT]:
        result = super().popitem()
        self.changed()
        return result

    def clear(self) -> None:
        super().clear()
        self.changed()

    @classmethod
    def coerce(cls, key: str, value: Any) -> MutableDict[_KT, _VT] | None:
        """Convert plain dictionary to instance of this class."""
        if not isinstance(value, cls):
            if isinstance(value, dict):
                return cls(value)
            return Mutable.coerce(key, value)
        else:
            return value

    def __getstate__(self) -> Dict[_KT, _VT]:
        return dict(self)

    def __setstate__(
        self, state: Union[Dict[str, int], Dict[str, str]]
    ) -> None:
        self.update(state)


class MutableList(Mutable, List[_T]):
    """A list type that implements :class:`.Mutable`.

    The :class:`.MutableList` object implements a list that will
    emit change events to the underlying mapping when the contents of
    the list are altered, including when values are added or removed.

    Note that :class:`.MutableList` does **not** apply mutable tracking to  the
    *values themselves* inside the list. Therefore it is not a sufficient
    solution for the use case of tracking deep changes to a *recursive*
    mutable structure, such as a JSON structure.  To support this use case,
    build a subclass of  :class:`.MutableList` that provides appropriate
    coercion to the values placed in the dictionary so that they too are
    "mutable", and emit events up to their parent structure.

    .. seealso::

        :class:`.MutableDict`

        :class:`.MutableSet`

    """

    def __reduce_ex__(
        self, proto: SupportsIndex
    ) -> Tuple[type, Tuple[List[int]]]:
        return (self.__class__, (list(self),))

    # needed for backwards compatibility with
    # older pickles
    def __setstate__(self, state: Iterable[_T]) -> None:
        self[:] = state

    def is_scalar(self, value: _T | Iterable[_T]) -> TypeGuard[_T]:
        return not util.is_non_string_iterable(value)

    def is_iterable(self, value: _T | Iterable[_T]) -> TypeGuard[Iterable[_T]]:
        return util.is_non_string_iterable(value)

    def __setitem__(
        self, index: SupportsIndex | slice, value: _T | Iterable[_T]
    ) -> None:
        """Detect list set events and emit change events."""
        if isinstance(index, SupportsIndex) and self.is_scalar(value):
            super().__setitem__(index, value)
        elif isinstance(index, slice) and self.is_iterable(value):
            super().__setitem__(index, value)
        self.changed()

    def __delitem__(self, index: SupportsIndex | slice) -> None:
        """Detect list del events and emit change events."""
        super().__delitem__(index)
        self.changed()

    def pop(self, *arg: SupportsIndex) -> _T:
        result = super().pop(*arg)
        self.changed()
        return result

    def append(self, x: _T) -> None:
        super().append(x)
        self.changed()

    def extend(self, x: Iterable[_T]) -> None:
        super().extend(x)
        self.changed()

    def __iadd__(self, x: Iterable[_T]) -> MutableList[_T]:  # type: ignore[override,misc] # noqa: E501
        self.extend(x)
        return self

    def insert(self, i: SupportsIndex, x: _T) -> None:
        super().insert(i, x)
        self.changed()

    def remove(self, i: _T) -> None:
        super().remove(i)
        self.changed()

    def clear(self) -> None:
        super().clear()
        self.changed()

    def sort(self, **kw: Any) -> None:
        super().sort(**kw)
        self.changed()

    def reverse(self) -> None:
        super().reverse()
        self.changed()

    @classmethod
    def coerce(
        cls, key: str, value: MutableList[_T] | _T
    ) -> Optional[MutableList[_T]]:
        """Convert plain list to instance of this class."""
        if not isinstance(value, cls):
            if isinstance(value, list):
                return cls(value)
            return Mutable.coerce(key, value)
        else:
            return value


class MutableSet(Mutable, Set[_T]):
    """A set type that implements :class:`.Mutable`.

    The :class:`.MutableSet` object implements a set that will
    emit change events to the underlying mapping when the contents of
    the set are altered, including when values are added or removed.

    Note that :class:`.MutableSet` does **not** apply mutable tracking to  the
    *values themselves* inside the set. Therefore it is not a sufficient
    solution for the use case of tracking deep changes to a *recursive*
    mutable structure.  To support this use case,
    build a subclass of  :class:`.MutableSet` that provides appropriate
    coercion to the values placed in the dictionary so that they too are
    "mutable", and emit events up to their parent structure.

    .. seealso::

        :class:`.MutableDict`

        :class:`.MutableList`


    """

    def update(self, *arg: Iterable[_T]) -> None:
        super().update(*arg)
        self.changed()

    def intersection_update(self, *arg: Iterable[Any]) -> None:
        super().intersection_update(*arg)
        self.changed()

    def difference_update(self, *arg: Iterable[Any]) -> None:
        super().difference_update(*arg)
        self.changed()

    def symmetric_difference_update(self, *arg: Iterable[_T]) -> None:
        super().symmetric_difference_update(*arg)
        self.changed()

    def __ior__(self, other: AbstractSet[_T]) -> MutableSet[_T]:  # type: ignore[override,misc] # noqa: E501
        self.update(other)
        return self

    def __iand__(self, other: AbstractSet[object]) -> MutableSet[_T]:
        self.intersection_update(other)
        return self

    def __ixor__(self, other: AbstractSet[_T]) -> MutableSet[_T]:  # type: ignore[override,misc] # noqa: E501
        self.symmetric_difference_update(other)
        return self

    def __isub__(self, other: AbstractSet[object]) -> MutableSet[_T]:  # type: ignore[misc] # noqa: E501
        self.difference_update(other)
        return self

    def add(self, elem: _T) -> None:
        super().add(elem)
        self.changed()

    def remove(self, elem: _T) -> None:
        super().remove(elem)
        self.changed()

    def discard(self, elem: _T) -> None:
        super().discard(elem)
        self.changed()

    def pop(self, *arg: Any) -> _T:
        result = super().pop(*arg)
        self.changed()
        return result

    def clear(self) -> None:
        super().clear()
        self.changed()

    @classmethod
    def coerce(cls, index: str, value: Any) -> Optional[MutableSet[_T]]:
        """Convert plain set to instance of this class."""
        if not isinstance(value, cls):
            if isinstance(value, set):
                return cls(value)
            return Mutable.coerce(index, value)
        else:
            return value

    def __getstate__(self) -> Set[_T]:
        return set(self)

    def __setstate__(self, state: Iterable[_T]) -> None:
        self.update(state)

    def __reduce_ex__(
        self, proto: SupportsIndex
    ) -> Tuple[type, Tuple[List[int]]]:
        return (self.__class__, (list(self),))
