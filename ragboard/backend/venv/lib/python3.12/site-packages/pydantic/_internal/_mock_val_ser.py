from __future__ import annotations

from typing import TYPE_CHECKING, Callable, Generic, TypeVar

from pydantic_core import SchemaSerializer, SchemaValidator
from typing_extensions import Literal

from ..errors import PydanticErrorCodes, PydanticUserError

if TYPE_CHECKING:
    from ..dataclasses import PydanticDataclass
    from ..main import BaseModel


ValSer = TypeVar('ValSer', SchemaValidator, SchemaSerializer)


class MockValSer(Generic[ValSer]):
    """Mocker for `pydantic_core.SchemaValidator` or `pydantic_core.SchemaSerializer` which optionally attempts to
    rebuild the thing it's mocking when one of its methods is accessed and raises an error if that fails.
    """

    __slots__ = '_error_message', '_code', '_val_or_ser', '_attempt_rebuild'

    def __init__(
        self,
        error_message: str,
        *,
        code: PydanticErrorCodes,
        val_or_ser: Literal['validator', 'serializer'],
        attempt_rebuild: Callable[[], ValSer | None] | None = None,
    ) -> None:
        self._error_message = error_message
        self._val_or_ser = SchemaValidator if val_or_ser == 'validator' else SchemaSerializer
        self._code: PydanticErrorCodes = code
        self._attempt_rebuild = attempt_rebuild

    def __getattr__(self, item: str) -> None:
        __tracebackhide__ = True
        if self._attempt_rebuild:
            val_ser = self._attempt_rebuild()
            if val_ser is not None:
                return getattr(val_ser, item)

        # raise an AttributeError if `item` doesn't exist
        getattr(self._val_or_ser, item)
        raise PydanticUserError(self._error_message, code=self._code)

    def rebuild(self) -> ValSer | None:
        if self._attempt_rebuild:
            val_ser = self._attempt_rebuild()
            if val_ser is not None:
                return val_ser
            else:
                raise PydanticUserError(self._error_message, code=self._code)
        return None


def set_model_mocks(cls: type[BaseModel], cls_name: str, undefined_name: str = 'all referenced types') -> None:
    """Set `__pydantic_validator__` and `__pydantic_serializer__` to `MockValSer`s on a model.

    Args:
        cls: The model class to set the mocks on
        cls_name: Name of the model class, used in error messages
        undefined_name: Name of the undefined thing, used in error messages
    """
    undefined_type_error_message = (
        f'`{cls_name}` is not fully defined; you should define {undefined_name},'
        f' then call `{cls_name}.model_rebuild()`.'
    )

    def attempt_rebuild_validator() -> SchemaValidator | None:
        if cls.model_rebuild(raise_errors=False, _parent_namespace_depth=5) is not False:
            return cls.__pydantic_validator__
        else:
            return None

    cls.__pydantic_validator__ = MockValSer(  # type: ignore[assignment]
        undefined_type_error_message,
        code='class-not-fully-defined',
        val_or_ser='validator',
        attempt_rebuild=attempt_rebuild_validator,
    )

    def attempt_rebuild_serializer() -> SchemaSerializer | None:
        if cls.model_rebuild(raise_errors=False, _parent_namespace_depth=5) is not False:
            return cls.__pydantic_serializer__
        else:
            return None

    cls.__pydantic_serializer__ = MockValSer(  # type: ignore[assignment]
        undefined_type_error_message,
        code='class-not-fully-defined',
        val_or_ser='serializer',
        attempt_rebuild=attempt_rebuild_serializer,
    )


def set_dataclass_mocks(
    cls: type[PydanticDataclass], cls_name: str, undefined_name: str = 'all referenced types'
) -> None:
    """Set `__pydantic_validator__` and `__pydantic_serializer__` to `MockValSer`s on a dataclass.

    Args:
        cls: The model class to set the mocks on
        cls_name: Name of the model class, used in error messages
        undefined_name: Name of the undefined thing, used in error messages
    """
    from ..dataclasses import rebuild_dataclass

    undefined_type_error_message = (
        f'`{cls_name}` is not fully defined; you should define {undefined_name},'
        f' then call `pydantic.dataclasses.rebuild_dataclass({cls_name})`.'
    )

    def attempt_rebuild_validator() -> SchemaValidator | None:
        if rebuild_dataclass(cls, raise_errors=False, _parent_namespace_depth=5) is not False:
            return cls.__pydantic_validator__
        else:
            return None

    cls.__pydantic_validator__ = MockValSer(  # type: ignore[assignment]
        undefined_type_error_message,
        code='class-not-fully-defined',
        val_or_ser='validator',
        attempt_rebuild=attempt_rebuild_validator,
    )

    def attempt_rebuild_serializer() -> SchemaSerializer | None:
        if rebuild_dataclass(cls, raise_errors=False, _parent_namespace_depth=5) is not False:
            return cls.__pydantic_serializer__
        else:
            return None

    cls.__pydantic_serializer__ = MockValSer(  # type: ignore[assignment]
        undefined_type_error_message,
        code='class-not-fully-defined',
        val_or_ser='validator',
        attempt_rebuild=attempt_rebuild_serializer,
    )
