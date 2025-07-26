from __future__ import annotations as _annotations

import inspect
from dataclasses import dataclass
from functools import partial
from typing import Any, Awaitable, Callable

import pydantic_core

from ..config import ConfigDict
from ..plugin._schema_validator import create_schema_validator
from . import _generate_schema, _typing_extra
from ._config import ConfigWrapper


@dataclass
class CallMarker:
    function: Callable[..., Any]
    validate_return: bool


class ValidateCallWrapper:
    """This is a wrapper around a function that validates the arguments passed to it, and optionally the return value.

    It's partially inspired by `wraps` which in turn uses `partial`, but extended to be a descriptor so
    these functions can be applied to instance methods, class methods, static methods, as well as normal functions.
    """

    __slots__ = (
        'raw_function',
        '_config',
        '_validate_return',
        '__pydantic_core_schema__',
        '__pydantic_validator__',
        '__signature__',
        '__name__',
        '__qualname__',
        '__annotations__',
        '__dict__',  # required for __module__
    )

    def __init__(self, function: Callable[..., Any], config: ConfigDict | None, validate_return: bool):
        self.raw_function = function
        self._config = config
        self._validate_return = validate_return
        self.__signature__ = inspect.signature(function)
        if isinstance(function, partial):
            func = function.func
            schema_type = func
            self.__name__ = f'partial({func.__name__})'
            self.__qualname__ = f'partial({func.__qualname__})'
            self.__annotations__ = func.__annotations__
            self.__module__ = func.__module__
            self.__doc__ = func.__doc__
        else:
            schema_type = function
            self.__name__ = function.__name__
            self.__qualname__ = function.__qualname__
            self.__annotations__ = function.__annotations__
            self.__module__ = function.__module__
            self.__doc__ = function.__doc__

        namespace = _typing_extra.add_module_globals(function, None)
        config_wrapper = ConfigWrapper(config)
        gen_schema = _generate_schema.GenerateSchema(config_wrapper, namespace)
        schema = gen_schema.clean_schema(gen_schema.generate_schema(function))
        self.__pydantic_core_schema__ = schema
        core_config = config_wrapper.core_config(self)

        self.__pydantic_validator__ = create_schema_validator(
            schema,
            schema_type,
            self.__module__,
            self.__qualname__,
            'validate_call',
            core_config,
            config_wrapper.plugin_settings,
        )

        if self._validate_return:
            return_type = (
                self.__signature__.return_annotation
                if self.__signature__.return_annotation is not self.__signature__.empty
                else Any
            )
            gen_schema = _generate_schema.GenerateSchema(config_wrapper, namespace)
            schema = gen_schema.clean_schema(gen_schema.generate_schema(return_type))
            self.__return_pydantic_core_schema__ = schema
            validator = create_schema_validator(
                schema,
                schema_type,
                self.__module__,
                self.__qualname__,
                'validate_call',
                core_config,
                config_wrapper.plugin_settings,
            )
            if inspect.iscoroutinefunction(self.raw_function):

                async def return_val_wrapper(aw: Awaitable[Any]) -> None:
                    return validator.validate_python(await aw)

                self.__return_pydantic_validator__ = return_val_wrapper
            else:
                self.__return_pydantic_validator__ = validator.validate_python
        else:
            self.__return_pydantic_core_schema__ = None
            self.__return_pydantic_validator__ = None

        self._name: str | None = None  # set by __get__, used to set the instance attribute when decorating methods

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        res = self.__pydantic_validator__.validate_python(pydantic_core.ArgsKwargs(args, kwargs))
        if self.__return_pydantic_validator__:
            return self.__return_pydantic_validator__(res)
        return res

    def __get__(self, obj: Any, objtype: type[Any] | None = None) -> ValidateCallWrapper:
        """Bind the raw function and return another ValidateCallWrapper wrapping that."""
        if obj is None:
            try:
                # Handle the case where a method is accessed as a class attribute
                return objtype.__getattribute__(objtype, self._name)  # type: ignore
            except AttributeError:
                # This will happen the first time the attribute is accessed
                pass

        bound_function = self.raw_function.__get__(obj, objtype)
        result = self.__class__(bound_function, self._config, self._validate_return)

        # skip binding to instance when obj or objtype has __slots__ attribute
        if hasattr(obj, '__slots__') or hasattr(objtype, '__slots__'):
            return result

        if self._name is not None:
            if obj is not None:
                object.__setattr__(obj, self._name, result)
            else:
                object.__setattr__(objtype, self._name, result)
        return result

    def __set_name__(self, owner: Any, name: str) -> None:
        self._name = name

    def __repr__(self) -> str:
        return f'ValidateCallWrapper({self.raw_function})'

    def __eq__(self, other) -> bool:
        return (
            (self.raw_function == other.raw_function)
            and (self._config == other._config)
            and (self._validate_return == other._validate_return)
        )

    def __hash__(self):
        return hash(self.raw_function)
