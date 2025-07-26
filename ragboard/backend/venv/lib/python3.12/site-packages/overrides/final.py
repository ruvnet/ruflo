#
#  Copyright 2016 Keunhong Lee
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
#
from types import FunctionType
from typing import Callable, TypeVar, Union

_WrappedMethod = TypeVar("_WrappedMethod", bound=Union[FunctionType, Callable])


def final(method: _WrappedMethod) -> _WrappedMethod:
    """Decorator to indicate that the decorated method is finalized and cannot be overridden.
    The decorator code is executed while loading class. Using this method
    should have minimal runtime performance implications.
    Currently, only methods with @override are checked.

    How to use:
    from overrides import final

    class SuperClass(object):
        @final
        def method(self):
          return 2

    class SubClass(SuperClass):
        @override
        def method(self): #causes an error
            return 1

    :raises AssertionError: if there exists a match in sub classes for the method name
    :return: method
    """
    setattr(method, "__final__", True)
    return method
