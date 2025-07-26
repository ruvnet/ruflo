"""Private logic related to fields (the `Field()` function and `FieldInfo` class), and arguments to `Annotated`."""
from __future__ import annotations as _annotations

import dataclasses
import sys
import warnings
from copy import copy
from functools import lru_cache
from typing import TYPE_CHECKING, Any

from pydantic_core import PydanticUndefined

from . import _typing_extra
from ._config import ConfigWrapper
from ._repr import Representation
from ._typing_extra import get_cls_type_hints_lenient, get_type_hints, is_classvar, is_finalvar

if TYPE_CHECKING:
    from annotated_types import BaseMetadata

    from ..fields import FieldInfo
    from ..main import BaseModel
    from ._dataclasses import StandardDataclass
    from ._decorators import DecoratorInfos


def get_type_hints_infer_globalns(
    obj: Any,
    localns: dict[str, Any] | None = None,
    include_extras: bool = False,
) -> dict[str, Any]:
    """Gets type hints for an object by inferring the global namespace.

    It uses the `typing.get_type_hints`, The only thing that we do here is fetching
    global namespace from `obj.__module__` if it is not `None`.

    Args:
        obj: The object to get its type hints.
        localns: The local namespaces.
        include_extras: Whether to recursively include annotation metadata.

    Returns:
        The object type hints.
    """
    module_name = getattr(obj, '__module__', None)
    globalns: dict[str, Any] | None = None
    if module_name:
        try:
            globalns = sys.modules[module_name].__dict__
        except KeyError:
            # happens occasionally, see https://github.com/pydantic/pydantic/issues/2363
            pass
    return get_type_hints(obj, globalns=globalns, localns=localns, include_extras=include_extras)


class PydanticMetadata(Representation):
    """Base class for annotation markers like `Strict`."""

    __slots__ = ()


def pydantic_general_metadata(**metadata: Any) -> BaseMetadata:
    """Create a new `_PydanticGeneralMetadata` class with the given metadata.

    Args:
        **metadata: The metadata to add.

    Returns:
        The new `_PydanticGeneralMetadata` class.
    """
    return _general_metadata_cls()(metadata)  # type: ignore


@lru_cache(maxsize=None)
def _general_metadata_cls() -> type[BaseMetadata]:
    """Do it this way to avoid importing `annotated_types` at import time."""
    from annotated_types import BaseMetadata

    class _PydanticGeneralMetadata(PydanticMetadata, BaseMetadata):
        """Pydantic general metadata like `max_digits`."""

        def __init__(self, metadata: Any):
            self.__dict__ = metadata

    return _PydanticGeneralMetadata  # type: ignore


def collect_model_fields(  # noqa: C901
    cls: type[BaseModel],
    bases: tuple[type[Any], ...],
    config_wrapper: ConfigWrapper,
    types_namespace: dict[str, Any] | None,
    *,
    typevars_map: dict[Any, Any] | None = None,
) -> tuple[dict[str, FieldInfo], set[str]]:
    """Collect the fields of a nascent pydantic model.

    Also collect the names of any ClassVars present in the type hints.

    The returned value is a tuple of two items: the fields dict, and the set of ClassVar names.

    Args:
        cls: BaseModel or dataclass.
        bases: Parents of the class, generally `cls.__bases__`.
        config_wrapper: The config wrapper instance.
        types_namespace: Optional extra namespace to look for types in.
        typevars_map: A dictionary mapping type variables to their concrete types.

    Returns:
        A tuple contains fields and class variables.

    Raises:
        NameError:
            - If there is a conflict between a field name and protected namespaces.
            - If there is a field other than `root` in `RootModel`.
            - If a field shadows an attribute in the parent model.
    """
    from ..fields import FieldInfo

    type_hints = get_cls_type_hints_lenient(cls, types_namespace)

    # https://docs.python.org/3/howto/annotations.html#accessing-the-annotations-dict-of-an-object-in-python-3-9-and-older
    # annotations is only used for finding fields in parent classes
    annotations = cls.__dict__.get('__annotations__', {})
    fields: dict[str, FieldInfo] = {}

    class_vars: set[str] = set()
    for ann_name, ann_type in type_hints.items():
        if ann_name == 'model_config':
            # We never want to treat `model_config` as a field
            # Note: we may need to change this logic if/when we introduce a `BareModel` class with no
            # protected namespaces (where `model_config` might be allowed as a field name)
            continue
        for protected_namespace in config_wrapper.protected_namespaces:
            if ann_name.startswith(protected_namespace):
                for b in bases:
                    if hasattr(b, ann_name):
                        from ..main import BaseModel

                        if not (issubclass(b, BaseModel) and ann_name in b.model_fields):
                            raise NameError(
                                f'Field "{ann_name}" conflicts with member {getattr(b, ann_name)}'
                                f' of protected namespace "{protected_namespace}".'
                            )
                else:
                    valid_namespaces = tuple(
                        x for x in config_wrapper.protected_namespaces if not ann_name.startswith(x)
                    )
                    warnings.warn(
                        f'Field "{ann_name}" has conflict with protected namespace "{protected_namespace}".'
                        '\n\nYou may be able to resolve this warning by setting'
                        f" `model_config['protected_namespaces'] = {valid_namespaces}`.",
                        UserWarning,
                    )
        if is_classvar(ann_type):
            class_vars.add(ann_name)
            continue
        if _is_finalvar_with_default_val(ann_type, getattr(cls, ann_name, PydanticUndefined)):
            class_vars.add(ann_name)
            continue
        if not is_valid_field_name(ann_name):
            continue
        if cls.__pydantic_root_model__ and ann_name != 'root':
            raise NameError(
                f"Unexpected field with name {ann_name!r}; only 'root' is allowed as a field of a `RootModel`"
            )

        # when building a generic model with `MyModel[int]`, the generic_origin check makes sure we don't get
        # "... shadows an attribute" errors
        generic_origin = getattr(cls, '__pydantic_generic_metadata__', {}).get('origin')
        for base in bases:
            dataclass_fields = {
                field.name for field in (dataclasses.fields(base) if dataclasses.is_dataclass(base) else ())
            }
            if hasattr(base, ann_name):
                if base is generic_origin:
                    # Don't error when "shadowing" of attributes in parametrized generics
                    continue

                if ann_name in dataclass_fields:
                    # Don't error when inheriting stdlib dataclasses whose fields are "shadowed" by defaults being set
                    # on the class instance.
                    continue
                warnings.warn(
                    f'Field name "{ann_name}" shadows an attribute in parent "{base.__qualname__}"; ',
                    UserWarning,
                )

        try:
            default = getattr(cls, ann_name, PydanticUndefined)
            if default is PydanticUndefined:
                raise AttributeError
        except AttributeError:
            if ann_name in annotations:
                field_info = FieldInfo.from_annotation(ann_type)
            else:
                # if field has no default value and is not in __annotations__ this means that it is
                # defined in a base class and we can take it from there
                model_fields_lookup: dict[str, FieldInfo] = {}
                for x in cls.__bases__[::-1]:
                    model_fields_lookup.update(getattr(x, 'model_fields', {}))
                if ann_name in model_fields_lookup:
                    # The field was present on one of the (possibly multiple) base classes
                    # copy the field to make sure typevar substitutions don't cause issues with the base classes
                    field_info = copy(model_fields_lookup[ann_name])
                else:
                    # The field was not found on any base classes; this seems to be caused by fields not getting
                    # generated thanks to models not being fully defined while initializing recursive models.
                    # Nothing stops us from just creating a new FieldInfo for this type hint, so we do this.
                    field_info = FieldInfo.from_annotation(ann_type)
        else:
            field_info = FieldInfo.from_annotated_attribute(ann_type, default)
            # attributes which are fields are removed from the class namespace:
            # 1. To match the behaviour of annotation-only fields
            # 2. To avoid false positives in the NameError check above
            try:
                delattr(cls, ann_name)
            except AttributeError:
                pass  # indicates the attribute was on a parent class

        # Use cls.__dict__['__pydantic_decorators__'] instead of cls.__pydantic_decorators__
        # to make sure the decorators have already been built for this exact class
        decorators: DecoratorInfos = cls.__dict__['__pydantic_decorators__']
        if ann_name in decorators.computed_fields:
            raise ValueError("you can't override a field with a computed field")
        fields[ann_name] = field_info

    if typevars_map:
        for field in fields.values():
            field.apply_typevars_map(typevars_map, types_namespace)

    return fields, class_vars


def _is_finalvar_with_default_val(type_: type[Any], val: Any) -> bool:
    from ..fields import FieldInfo

    if not is_finalvar(type_):
        return False
    elif val is PydanticUndefined:
        return False
    elif isinstance(val, FieldInfo) and (val.default is PydanticUndefined and val.default_factory is None):
        return False
    else:
        return True


def collect_dataclass_fields(
    cls: type[StandardDataclass], types_namespace: dict[str, Any] | None, *, typevars_map: dict[Any, Any] | None = None
) -> dict[str, FieldInfo]:
    """Collect the fields of a dataclass.

    Args:
        cls: dataclass.
        types_namespace: Optional extra namespace to look for types in.
        typevars_map: A dictionary mapping type variables to their concrete types.

    Returns:
        The dataclass fields.
    """
    from ..fields import FieldInfo

    fields: dict[str, FieldInfo] = {}
    dataclass_fields: dict[str, dataclasses.Field] = cls.__dataclass_fields__
    cls_localns = dict(vars(cls))  # this matches get_cls_type_hints_lenient, but all tests pass with `= None` instead

    for ann_name, dataclass_field in dataclass_fields.items():
        ann_type = _typing_extra.eval_type_lenient(dataclass_field.type, types_namespace, cls_localns)
        if is_classvar(ann_type):
            continue

        if (
            not dataclass_field.init
            and dataclass_field.default == dataclasses.MISSING
            and dataclass_field.default_factory == dataclasses.MISSING
        ):
            # TODO: We should probably do something with this so that validate_assignment behaves properly
            #   Issue: https://github.com/pydantic/pydantic/issues/5470
            continue

        if isinstance(dataclass_field.default, FieldInfo):
            if dataclass_field.default.init_var:
                # TODO: same note as above
                continue
            field_info = FieldInfo.from_annotated_attribute(ann_type, dataclass_field.default)
        else:
            field_info = FieldInfo.from_annotated_attribute(ann_type, dataclass_field)
        fields[ann_name] = field_info

        if field_info.default is not PydanticUndefined and isinstance(getattr(cls, ann_name, field_info), FieldInfo):
            # We need this to fix the default when the "default" from __dataclass_fields__ is a pydantic.FieldInfo
            setattr(cls, ann_name, field_info.default)

    if typevars_map:
        for field in fields.values():
            field.apply_typevars_map(typevars_map, types_namespace)

    return fields


def is_valid_field_name(name: str) -> bool:
    return not name.startswith('_')


def is_valid_privateattr_name(name: str) -> bool:
    return name.startswith('_') and not name.startswith('__')
