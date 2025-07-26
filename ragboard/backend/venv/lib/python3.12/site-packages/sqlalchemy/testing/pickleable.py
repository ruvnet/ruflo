# testing/pickleable.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


"""Classes used in pickling tests, need to be at the module level for
unpickling.
"""

from __future__ import annotations

from .entities import ComparableEntity
from ..schema import Column
from ..types import String


class User(ComparableEntity):
    pass


class Order(ComparableEntity):
    pass


class Dingaling(ComparableEntity):
    pass


class EmailUser(User):
    pass


class Address(ComparableEntity):
    pass


# TODO: these are kind of arbitrary....
class Child1(ComparableEntity):
    pass


class Child2(ComparableEntity):
    pass


class Parent(ComparableEntity):
    pass


class Screen:
    def __init__(self, obj, parent=None):
        self.obj = obj
        self.parent = parent


class Mixin:
    email_address = Column(String)


class AddressWMixin(Mixin, ComparableEntity):
    pass


class Foo:
    def __init__(self, moredata, stuff="im stuff"):
        self.data = "im data"
        self.stuff = stuff
        self.moredata = moredata

    __hash__ = object.__hash__

    def __eq__(self, other):
        return (
            other.data == self.data
            and other.stuff == self.stuff
            and other.moredata == self.moredata
        )


class Bar:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    __hash__ = object.__hash__

    def __eq__(self, other):
        return (
            other.__class__ is self.__class__
            and other.x == self.x
            and other.y == self.y
        )

    def __str__(self):
        return "Bar(%d, %d)" % (self.x, self.y)


class OldSchool:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __eq__(self, other):
        return (
            other.__class__ is self.__class__
            and other.x == self.x
            and other.y == self.y
        )


class OldSchoolWithoutCompare:
    def __init__(self, x, y):
        self.x = x
        self.y = y


class BarWithoutCompare:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return "Bar(%d, %d)" % (self.x, self.y)


class NotComparable:
    def __init__(self, data):
        self.data = data

    def __hash__(self):
        return id(self)

    def __eq__(self, other):
        return NotImplemented

    def __ne__(self, other):
        return NotImplemented


class BrokenComparable:
    def __init__(self, data):
        self.data = data

    def __hash__(self):
        return id(self)

    def __eq__(self, other):
        raise NotImplementedError

    def __ne__(self, other):
        raise NotImplementedError
