from typing import Any, Callable, TypeVar, Union

from attr import attrib, field

class UnsupportedSubclassing(Exception): ...

_T = TypeVar("_T")

def __dataclass_transform__(
    *,
    frozen_default: bool = False,
    field_descriptors: tuple[Union[type, Callable[..., Any]], ...] = ...,
) -> Callable[[_T], _T]: ...
@__dataclass_transform__(field_descriptors=(attrib, field))
def define(cls: type[_T]) -> type[_T]: ...
@__dataclass_transform__(
    frozen_default=True,
    field_descriptors=(attrib, field),
)
def frozen(cls: type[_T]) -> type[_T]: ...
