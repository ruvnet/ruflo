import warnings
from functools import wraps
from inspect import Parameter, signature
from typing import Iterable, Optional


def _deprecate_positional_args(*, version: str):
    """Decorator for methods that issues warnings for positional arguments.
    Using the keyword-only argument syntax in pep 3102, arguments after the
    * will issue a warning when passed as a positional argument.

    Args:
        version (`str`):
            The version when positional arguments will result in error.
    """

    def _inner_deprecate_positional_args(f):
        sig = signature(f)
        kwonly_args = []
        all_args = []
        for name, param in sig.parameters.items():
            if param.kind == Parameter.POSITIONAL_OR_KEYWORD:
                all_args.append(name)
            elif param.kind == Parameter.KEYWORD_ONLY:
                kwonly_args.append(name)

        @wraps(f)
        def inner_f(*args, **kwargs):
            extra_args = len(args) - len(all_args)
            if extra_args <= 0:
                return f(*args, **kwargs)
            # extra_args > 0
            args_msg = [
                f"{name}='{arg}'" if isinstance(arg, str) else f"{name}={arg}"
                for name, arg in zip(kwonly_args[:extra_args], args[-extra_args:])
            ]
            args_msg = ", ".join(args_msg)
            warnings.warn(
                f"Deprecated positional argument(s) used in '{f.__name__}': pass"
                f" {args_msg} as keyword args. From version {version} passing these"
                " as positional arguments will result in an error,",
                FutureWarning,
            )
            kwargs.update(zip(sig.parameters, args))
            return f(**kwargs)

        return inner_f

    return _inner_deprecate_positional_args


def _deprecate_arguments(
    *,
    version: str,
    deprecated_args: Iterable[str],
    custom_message: Optional[str] = None,
):
    """Decorator to issue warnings when using deprecated arguments.

    TODO: could be useful to be able to set a custom error message.

    Args:
        version (`str`):
            The version when deprecated arguments will result in error.
        deprecated_args (`List[str]`):
            List of the arguments to be deprecated.
        custom_message (`str`, *optional*):
            Warning message that is raised. If not passed, a default warning message
            will be created.
    """

    def _inner_deprecate_positional_args(f):
        sig = signature(f)

        @wraps(f)
        def inner_f(*args, **kwargs):
            # Check for used deprecated arguments
            used_deprecated_args = []
            for _, parameter in zip(args, sig.parameters.values()):
                if parameter.name in deprecated_args:
                    used_deprecated_args.append(parameter.name)
            for kwarg_name, kwarg_value in kwargs.items():
                if (
                    # If argument is deprecated but still used
                    kwarg_name in deprecated_args
                    # And then the value is not the default value
                    and kwarg_value != sig.parameters[kwarg_name].default
                ):
                    used_deprecated_args.append(kwarg_name)

            # Warn and proceed
            if len(used_deprecated_args) > 0:
                message = (
                    f"Deprecated argument(s) used in '{f.__name__}':"
                    f" {', '.join(used_deprecated_args)}. Will not be supported from"
                    f" version '{version}'."
                )
                if custom_message is not None:
                    message += "\n\n" + custom_message
                warnings.warn(message, FutureWarning)
            return f(*args, **kwargs)

        return inner_f

    return _inner_deprecate_positional_args


def _deprecate_method(*, version: str, message: Optional[str] = None):
    """Decorator to issue warnings when using a deprecated method.

    Args:
        version (`str`):
            The version when deprecated arguments will result in error.
        message (`str`, *optional*):
            Warning message that is raised. If not passed, a default warning message
            will be created.
    """

    def _inner_deprecate_method(f):
        name = f.__name__
        if name == "__init__":
            name = f.__qualname__.split(".")[0]  # class name instead of method name

        @wraps(f)
        def inner_f(*args, **kwargs):
            warning_message = (
                f"'{name}' (from '{f.__module__}') is deprecated and will be removed from version '{version}'."
            )
            if message is not None:
                warning_message += " " + message
            warnings.warn(warning_message, FutureWarning)
            return f(*args, **kwargs)

        return inner_f

    return _inner_deprecate_method
