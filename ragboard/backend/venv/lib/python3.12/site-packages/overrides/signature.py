import inspect
from inspect import Parameter
from types import FunctionType
from typing import Callable, Dict, Optional, Tuple, Type, TypeVar, Union, get_type_hints

from .typing_utils import get_args, issubtype

_WrappedMethod = TypeVar("_WrappedMethod", bound=Union[FunctionType, Callable])
_WrappedMethod2 = TypeVar("_WrappedMethod2", bound=Union[FunctionType, Callable])


def _contains_unbound_typevar(t: Type) -> bool:
    """Recursively check if `t` or any types contained by `t` is a `TypeVar`.

    Examples where we return `True`: `T`, `Optional[T]`, `Tuple[Optional[T], ...]`, ...
    Examples where we return `False`: `int`, `Optional[str]`, ...

    :param t: Type to evaluate.
    :return: `True` if the input type contains an unbound `TypeVar`, `False` otherwise.
    """

    # Check self
    if isinstance(t, TypeVar):
        return True

    # Check children
    for arg in get_args(t):
        if _contains_unbound_typevar(arg):
            return True

    return False


def _issubtype(left, right):
    if _contains_unbound_typevar(left):
        return True
    if right is None:
        return True
    if _contains_unbound_typevar(right):
        return True
    try:
        return issubtype(left, right)
    except TypeError:
        # Ignore all broken cases
        return True


def _get_type_hints(callable) -> Optional[Dict]:
    try:
        return get_type_hints(callable)
    except (NameError, TypeError):
        return None


def _is_same_module(callable1: _WrappedMethod, callable2: _WrappedMethod2) -> bool:
    mod1 = callable1.__module__.split(".")[0]
    # "__module__" attribute may be missing in CPython or it can be None
    # in PyPy: https://github.com/mkorpela/overrides/issues/118
    mod2 = getattr(callable2, "__module__", None)
    if mod2 is None:
        return False
    mod2 = mod2.split(".")[0]
    return mod1 == mod2


def ensure_signature_is_compatible(
    super_callable: _WrappedMethod,
    sub_callable: _WrappedMethod2,
    is_static: bool = False,
) -> None:
    """Ensure that the signature of `sub_callable` is compatible with the signature of `super_callable`.

    Guarantees that any call to `super_callable` will work on `sub_callable` by checking the following criteria:

    1. The return type of `sub_callable` is a subtype of the return type of `super_callable`.
    2. All parameters of `super_callable` are present in `sub_callable`, unless `sub_callable`
       declares `*args` or `**kwargs`.
    3. All positional parameters of `super_callable` appear in the same order in `sub_callable`.
    4. All parameters of `super_callable` are a subtype of the corresponding parameters of `sub_callable`.
    5. All required parameters of `sub_callable` are present in `super_callable`, unless `super_callable`
       declares `*args` or `**kwargs`.

    :param super_callable: Function to check compatibility with.
    :param sub_callable: Function to check compatibility of.
    :param is_static: True if staticmethod and should check first argument.
    """
    super_callable = _unbound_func(super_callable)
    sub_callable = _unbound_func(sub_callable)

    try:
        super_sig = inspect.signature(super_callable)
    except ValueError:
        return

    super_type_hints = _get_type_hints(super_callable)
    sub_sig = inspect.signature(sub_callable)
    sub_type_hints = _get_type_hints(sub_callable)

    method_name = sub_callable.__qualname__
    same_main_module = _is_same_module(sub_callable, super_callable)

    if super_type_hints is not None and sub_type_hints is not None:
        ensure_return_type_compatibility(super_type_hints, sub_type_hints, method_name)
        ensure_all_kwargs_defined_in_sub(
            super_sig, sub_sig, super_type_hints, sub_type_hints, is_static, method_name
        )
        ensure_all_positional_args_defined_in_sub(
            super_sig,
            sub_sig,
            super_type_hints,
            sub_type_hints,
            is_static,
            same_main_module,
            method_name,
        )
    ensure_no_extra_args_in_sub(super_sig, sub_sig, is_static, method_name)


def _unbound_func(callable: _WrappedMethod) -> _WrappedMethod:
    if hasattr(callable, "__self__") and hasattr(callable, "__func__"):
        return callable.__func__  # type: ignore
    return callable


def ensure_all_kwargs_defined_in_sub(
    super_sig: inspect.Signature,
    sub_sig: inspect.Signature,
    super_type_hints: Dict,
    sub_type_hints: Dict,
    check_first_parameter: bool,
    method_name: str,
):
    sub_has_var_kwargs = any(
        p.kind == Parameter.VAR_KEYWORD for p in sub_sig.parameters.values()
    )
    for super_index, (name, super_param) in enumerate(super_sig.parameters.items()):
        if super_index == 0 and not check_first_parameter:
            continue
        if super_param.kind == Parameter.VAR_POSITIONAL:
            continue
        if super_param.kind == Parameter.POSITIONAL_ONLY:
            continue
        if not is_param_defined_in_sub(
            name, True, sub_has_var_kwargs, sub_sig, super_param
        ):
            raise TypeError(f"{method_name}: `{name}` is not present.")
        elif name in sub_sig.parameters and super_param.kind != Parameter.VAR_KEYWORD:
            sub_index = list(sub_sig.parameters.keys()).index(name)
            sub_param = sub_sig.parameters[name]

            if super_param.kind != sub_param.kind and not (
                super_param.kind == Parameter.KEYWORD_ONLY
                and sub_param.kind == Parameter.POSITIONAL_OR_KEYWORD
            ):
                raise TypeError(f"{method_name}: `{name}` is not `{super_param.kind}`")
            elif super_index > sub_index and super_param.kind != Parameter.KEYWORD_ONLY:
                raise TypeError(
                    f"{method_name}: `{name}` is not parameter at index `{super_index}`"
                )
            elif (
                name in super_type_hints
                and name in sub_type_hints
                and not _issubtype(super_type_hints[name], sub_type_hints[name])
            ):
                raise TypeError(
                    f"`{method_name}: {name} must be a supertype of `{super_param.annotation}` but is `{sub_param.annotation}`"
                )


def ensure_all_positional_args_defined_in_sub(
    super_sig: inspect.Signature,
    sub_sig: inspect.Signature,
    super_type_hints: Dict,
    sub_type_hints: Dict,
    check_first_parameter: bool,
    is_same_main_module: bool,
    method_name: str,
):
    sub_parameter_values = [
        v
        for v in sub_sig.parameters.values()
        if v.kind not in (Parameter.KEYWORD_ONLY, Parameter.VAR_KEYWORD)
    ]
    super_parameter_values = [
        v
        for v in super_sig.parameters.values()
        if v.kind not in (Parameter.KEYWORD_ONLY, Parameter.VAR_KEYWORD)
    ]
    sub_has_var_args = any(
        p.kind == Parameter.VAR_POSITIONAL for p in sub_parameter_values
    )
    super_has_var_args = any(
        p.kind == Parameter.VAR_POSITIONAL for p in super_parameter_values
    )
    if not sub_has_var_args and len(sub_parameter_values) < len(super_parameter_values):
        raise TypeError(f"{method_name}: parameter list too short")
    super_shift = 0
    for index, sub_param in enumerate(sub_parameter_values):
        if index == 0 and not check_first_parameter:
            continue
        if index + super_shift >= len(super_parameter_values):
            if sub_param.kind == Parameter.VAR_POSITIONAL:
                continue
            if (
                sub_param.kind == Parameter.POSITIONAL_ONLY
                and sub_param.default != Parameter.empty
            ):
                continue
            if sub_param.kind == Parameter.POSITIONAL_OR_KEYWORD:
                continue  # Assume use as keyword
            raise TypeError(
                f"{method_name}: `{sub_param.name}` positionally required in subclass but not in supertype"
            )
        if sub_param.kind == Parameter.VAR_POSITIONAL:
            return
        super_param = super_parameter_values[index + super_shift]
        if super_param.kind == Parameter.VAR_POSITIONAL:
            super_shift -= 1
        if super_param.kind == Parameter.VAR_POSITIONAL:
            if not sub_has_var_args:
                raise TypeError(f"{method_name}: `{super_param.name}` must be present")
            continue
        if (
            super_param.kind != sub_param.kind
            and not (
                super_param.kind == Parameter.POSITIONAL_ONLY
                and sub_param.kind == Parameter.POSITIONAL_OR_KEYWORD
            )
            and not (sub_param.kind == Parameter.POSITIONAL_ONLY and super_has_var_args)
        ):
            raise TypeError(
                f"{method_name}: `{sub_param.name}` is not `{super_param.kind}` and is `{sub_param.kind}`"
            )
        elif (
            super_param.name in super_type_hints or is_same_main_module
        ) and not _issubtype(
            super_type_hints.get(super_param.name, None),
            sub_type_hints.get(sub_param.name, None),
        ):
            raise TypeError(
                f"`{method_name}: {sub_param.name} overriding must be a supertype of `{super_param.annotation}` but is `{sub_param.annotation}`"
            )


def is_param_defined_in_sub(
    name: str,
    sub_has_var_args: bool,
    sub_has_var_kwargs: bool,
    sub_sig: inspect.Signature,
    super_param: inspect.Parameter,
) -> bool:
    return (
        name in sub_sig.parameters
        or (super_param.kind == Parameter.VAR_POSITIONAL and sub_has_var_args)
        or (super_param.kind == Parameter.VAR_KEYWORD and sub_has_var_kwargs)
        or (super_param.kind == Parameter.POSITIONAL_ONLY and sub_has_var_args)
        or (
            super_param.kind == Parameter.POSITIONAL_OR_KEYWORD
            and sub_has_var_args
            and sub_has_var_kwargs
        )
        or (super_param.kind == Parameter.KEYWORD_ONLY and sub_has_var_kwargs)
    )


def ensure_no_extra_args_in_sub(
    super_sig: inspect.Signature,
    sub_sig: inspect.Signature,
    check_first_parameter: bool,
    method_name: str,
) -> None:
    super_params = super_sig.parameters.values()
    super_var_args = any(p.kind == Parameter.VAR_POSITIONAL for p in super_params)
    super_var_kwargs = any(p.kind == Parameter.VAR_KEYWORD for p in super_params)
    for sub_index, (name, sub_param) in enumerate(sub_sig.parameters.items()):
        if (
            sub_param.kind == Parameter.POSITIONAL_ONLY
            and len(super_params) > sub_index
            and list(super_params)[sub_index].kind == Parameter.POSITIONAL_ONLY
        ):
            continue
        if (
            name not in super_sig.parameters
            and sub_param.default == Parameter.empty
            and sub_param.kind != Parameter.VAR_POSITIONAL
            and sub_param.kind != Parameter.VAR_KEYWORD
            and not (sub_param.kind == Parameter.KEYWORD_ONLY and super_var_kwargs)
            and not (sub_param.kind == Parameter.POSITIONAL_ONLY and super_var_args)
            and not (
                sub_param.kind == Parameter.POSITIONAL_OR_KEYWORD and super_var_args
            )
            and (sub_index > 0 or check_first_parameter)
        ):
            raise TypeError(f"{method_name}: `{name}` is not a valid parameter.")


def ensure_return_type_compatibility(
    super_type_hints: Dict, sub_type_hints: Dict, method_name: str
):
    super_return = super_type_hints.get("return", None)
    sub_return = sub_type_hints.get("return", None)
    if not _issubtype(sub_return, super_return) and super_return is not None:
        raise TypeError(
            f"{method_name}: return type `{sub_return}` is not a `{super_return}`."
        )
