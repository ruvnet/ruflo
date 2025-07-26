#
#  Copyright 2019 Mikko Korpela
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

import dis
import functools
import inspect
import sys
from types import FrameType, FunctionType
from typing import Callable, List, Optional, Tuple, TypeVar, Union, overload

__VERSION__ = "7.7.0"

from overrides.signature import ensure_signature_is_compatible

_WrappedMethod = TypeVar("_WrappedMethod", bound=Union[FunctionType, Callable])
_DecoratorMethod = Callable[[_WrappedMethod], _WrappedMethod]


@overload
def overrides(
    method: None = None,
    *,
    check_signature: bool = True,
    check_at_runtime: bool = False,
) -> _DecoratorMethod:
    ...


@overload
def overrides(
    method: _WrappedMethod,
    *,
    check_signature: bool = True,
    check_at_runtime: bool = False,
) -> _WrappedMethod:
    ...


def overrides(
    method: Optional[_WrappedMethod] = None,
    *,
    check_signature: bool = True,
    check_at_runtime: bool = False,
) -> Union[_DecoratorMethod, _WrappedMethod]:
    """Decorator to indicate that the decorated method overrides a method in
    superclass.
    The decorator code is executed while loading class. Using this method
    should have minimal runtime performance implications.

    How to use:
    from overrides import overrides

    class SuperClass(object):
        def method(self):
          return 2

    class SubClass(SuperClass):

        @overrides
        def method(self):
            return 1

    :param check_signature: Whether or not to check the signature of the overridden method.
    :param check_at_runtime: Whether or not to check the overridden method at runtime.
    :raises AssertionError: if no match in super classes for the method name
    :return: method with possibly added (if the method doesn't have one)
        docstring from super class
    """
    if method is not None:
        return _overrides(method, check_signature, check_at_runtime)
    else:
        return functools.partial(
            overrides,
            check_signature=check_signature,
            check_at_runtime=check_at_runtime,
        )


@overload
def override(
    method: None = None,
    *,
    check_signature: bool = True,
    check_at_runtime: bool = False,
) -> _DecoratorMethod:
    ...


@overload
def override(
    method: _WrappedMethod,
    *,
    check_signature: bool = True,
    check_at_runtime: bool = False,
) -> _WrappedMethod:
    ...


def override(
    method: Optional[_WrappedMethod] = None,
    *,
    check_signature: bool = True,
    check_at_runtime: bool = False,
) -> Union[_DecoratorMethod, _WrappedMethod]:
    """Decorator to indicate that the decorated method overrides a method in
    superclass.
    The decorator code is executed while loading class. Using this method
    should have minimal runtime performance implications.

    How to use:
    from overrides import override

    class SuperClass(object):
        def method(self):
          return 2

    class SubClass(SuperClass):

        @override
        def method(self):
            return 1

    :param check_signature: Whether or not to check the signature of the overridden method.
    :param check_at_runtime: Whether or not to check the overridden method at runtime.
    :raises AssertionError: if no match in super classes for the method name
    :return: method with possibly added (if the method doesn't have one)
        docstring from super class
    """
    if method is not None:
        return _overrides(method, check_signature, check_at_runtime)
    else:
        return functools.partial(
            overrides,
            check_signature=check_signature,
            check_at_runtime=check_at_runtime,
        )


def _overrides(
    method: _WrappedMethod,
    check_signature: bool,
    check_at_runtime: bool,
) -> _WrappedMethod:
    setattr(method, "__override__", True)
    global_vars = getattr(method, "__globals__", None)
    if global_vars is None:
        global_vars = vars(sys.modules[method.__module__])
    for super_class in _get_base_classes(sys._getframe(3), global_vars):
        if hasattr(super_class, method.__name__):
            if check_at_runtime:

                @functools.wraps(method)
                def wrapper(*args, **kwargs):
                    _validate_method(method, super_class, check_signature)
                    return method(*args, **kwargs)

                return wrapper  # type: ignore
            else:
                _validate_method(method, super_class, check_signature)
                return method
    raise TypeError(f"{method.__qualname__}: No super class method found")


def _validate_method(method, super_class, check_signature):
    super_method = getattr(super_class, method.__name__)
    is_static = isinstance(
        inspect.getattr_static(super_class, method.__name__), staticmethod
    )
    if getattr(super_method, "__final__", False):
        raise TypeError(f"{method.__name__}: is finalized in {super_class}")
    if not method.__doc__:
        method.__doc__ = super_method.__doc__
    if (
        check_signature
        and not method.__name__.startswith("__")
        and not isinstance(super_method, property)
    ):
        ensure_signature_is_compatible(super_method, method, is_static)


def _get_base_classes(frame, namespace):
    return [
        _get_base_class(class_name_components, namespace)
        for class_name_components in _get_base_class_names(frame)
    ]


def _get_base_class_names(frame: FrameType) -> List[List[str]]:
    """Get baseclass names from the code object"""
    current_item: List[str] = []
    items: List[List[str]] = []
    add_last_step = True

    for instruction in dis.get_instructions(frame.f_code):
        if instruction.offset > frame.f_lasti:
            break
        if instruction.opcode not in dis.hasname:
            continue
        if not add_last_step:
            items = []
            add_last_step = True

        # Combine LOAD_NAME and LOAD_GLOBAL as they have similar functionality
        if instruction.opname in ["LOAD_NAME", "LOAD_GLOBAL"]:
            if current_item:
                items.append(current_item)
            current_item = [instruction.argval]

        elif instruction.opname == "LOAD_ATTR" and current_item:
            current_item.append(instruction.argval)

        # Reset on other instructions
        else:
            if current_item:
                items.append(current_item)
            current_item = []
            add_last_step = False

    if current_item:
        items.append(current_item)
    return items


def _get_base_class(components, namespace):
    try:
        obj = namespace[components[0]]
    except KeyError:
        if isinstance(namespace["__builtins__"], dict):
            obj = namespace["__builtins__"][components[0]]
        else:
            obj = getattr(namespace["__builtins__"], components[0])
    for component in components[1:]:
        if hasattr(obj, component):
            obj = getattr(obj, component)
    return obj
