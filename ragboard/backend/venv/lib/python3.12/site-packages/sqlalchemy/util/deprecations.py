# util/deprecations.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Helpers related to deprecation of functions, methods, classes, other
functionality."""

from __future__ import annotations

import re
from typing import Any
from typing import Callable
from typing import Dict
from typing import Match
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TypeVar
from typing import Union

from . import compat
from .langhelpers import _hash_limit_string
from .langhelpers import _warnings_warn
from .langhelpers import decorator
from .langhelpers import inject_docstring_text
from .langhelpers import inject_param_text
from .. import exc

_T = TypeVar("_T", bound=Any)


# https://mypy.readthedocs.io/en/stable/generics.html#declaring-decorators
_F = TypeVar("_F", bound="Callable[..., Any]")


def _warn_with_version(
    msg: str,
    version: str,
    type_: Type[exc.SADeprecationWarning],
    stacklevel: int,
    code: Optional[str] = None,
) -> None:
    warn = type_(msg, code=code)
    warn.deprecated_since = version

    _warnings_warn(warn, stacklevel=stacklevel + 1)


def warn_deprecated(
    msg: str, version: str, stacklevel: int = 3, code: Optional[str] = None
) -> None:
    _warn_with_version(
        msg, version, exc.SADeprecationWarning, stacklevel, code=code
    )


def warn_deprecated_limited(
    msg: str,
    args: Sequence[Any],
    version: str,
    stacklevel: int = 3,
    code: Optional[str] = None,
) -> None:
    """Issue a deprecation warning with a parameterized string,
    limiting the number of registrations.

    """
    if args:
        msg = _hash_limit_string(msg, 10, args)
    _warn_with_version(
        msg, version, exc.SADeprecationWarning, stacklevel, code=code
    )


def deprecated_cls(
    version: str, message: str, constructor: Optional[str] = "__init__"
) -> Callable[[Type[_T]], Type[_T]]:
    header = ".. deprecated:: %s %s" % (version, (message or ""))

    def decorate(cls: Type[_T]) -> Type[_T]:
        return _decorate_cls_with_warning(
            cls,
            constructor,
            exc.SADeprecationWarning,
            message % dict(func=constructor),
            version,
            header,
        )

    return decorate


def deprecated(
    version: str,
    message: Optional[str] = None,
    add_deprecation_to_docstring: bool = True,
    warning: Optional[Type[exc.SADeprecationWarning]] = None,
    enable_warnings: bool = True,
) -> Callable[[_F], _F]:
    """Decorates a function and issues a deprecation warning on use.

    :param version:
      Issue version in the warning.

    :param message:
      If provided, issue message in the warning.  A sensible default
      is used if not provided.

    :param add_deprecation_to_docstring:
      Default True.  If False, the wrapped function's __doc__ is left
      as-is.  If True, the 'message' is prepended to the docs if
      provided, or sensible default if message is omitted.

    """

    if add_deprecation_to_docstring:
        header = ".. deprecated:: %s %s" % (
            version,
            (message or ""),
        )
    else:
        header = None

    if message is None:
        message = "Call to deprecated function %(func)s"

    if warning is None:
        warning = exc.SADeprecationWarning

    message += " (deprecated since: %s)" % version

    def decorate(fn: _F) -> _F:
        assert message is not None
        assert warning is not None
        return _decorate_with_warning(
            fn,
            warning,
            message % dict(func=fn.__name__),
            version,
            header,
            enable_warnings=enable_warnings,
        )

    return decorate


def moved_20(
    message: str, **kw: Any
) -> Callable[[Callable[..., _T]], Callable[..., _T]]:
    return deprecated(
        "2.0", message=message, warning=exc.MovedIn20Warning, **kw
    )


def became_legacy_20(
    api_name: str, alternative: Optional[str] = None, **kw: Any
) -> Callable[[_F], _F]:
    type_reg = re.match("^:(attr|func|meth):", api_name)
    if type_reg:
        type_ = {"attr": "attribute", "func": "function", "meth": "method"}[
            type_reg.group(1)
        ]
    else:
        type_ = "construct"
    message = (
        "The %s %s is considered legacy as of the "
        "1.x series of SQLAlchemy and %s in 2.0."
        % (
            api_name,
            type_,
            "becomes a legacy construct",
        )
    )

    if ":attr:" in api_name:
        attribute_ok = kw.pop("warn_on_attribute_access", False)
        if not attribute_ok:
            assert kw.get("enable_warnings") is False, (
                "attribute %s will emit a warning on read access.  "
                "If you *really* want this, "
                "add warn_on_attribute_access=True.  Otherwise please add "
                "enable_warnings=False." % api_name
            )

    if alternative:
        message += " " + alternative

    warning_cls = exc.LegacyAPIWarning

    return deprecated("2.0", message=message, warning=warning_cls, **kw)


def deprecated_params(**specs: Tuple[str, str]) -> Callable[[_F], _F]:
    """Decorates a function to warn on use of certain parameters.

    e.g. ::

        @deprecated_params(
            weak_identity_map=(
                "0.7",
                "the :paramref:`.Session.weak_identity_map parameter "
                "is deprecated."
            )

        )

    """

    messages: Dict[str, str] = {}
    versions: Dict[str, str] = {}
    version_warnings: Dict[str, Type[exc.SADeprecationWarning]] = {}

    for param, (version, message) in specs.items():
        versions[param] = version
        messages[param] = _sanitize_restructured_text(message)
        version_warnings[param] = exc.SADeprecationWarning

    def decorate(fn: _F) -> _F:
        spec = compat.inspect_getfullargspec(fn)

        check_defaults: Union[Set[str], Tuple[()]]
        if spec.defaults is not None:
            defaults = dict(
                zip(
                    spec.args[(len(spec.args) - len(spec.defaults)) :],
                    spec.defaults,
                )
            )
            check_defaults = set(defaults).intersection(messages)
            check_kw = set(messages).difference(defaults)
        elif spec.kwonlydefaults is not None:
            defaults = spec.kwonlydefaults
            check_defaults = set(defaults).intersection(messages)
            check_kw = set(messages).difference(defaults)
        else:
            check_defaults = ()
            check_kw = set(messages)

        check_any_kw = spec.varkw

        # latest mypy has opinions here, not sure if they implemented
        # Concatenate or something
        @decorator
        def warned(fn: _F, *args: Any, **kwargs: Any) -> _F:
            for m in check_defaults:
                if (defaults[m] is None and kwargs[m] is not None) or (
                    defaults[m] is not None and kwargs[m] != defaults[m]
                ):
                    _warn_with_version(
                        messages[m],
                        versions[m],
                        version_warnings[m],
                        stacklevel=3,
                    )

            if check_any_kw in messages and set(kwargs).difference(
                check_defaults
            ):
                assert check_any_kw is not None
                _warn_with_version(
                    messages[check_any_kw],
                    versions[check_any_kw],
                    version_warnings[check_any_kw],
                    stacklevel=3,
                )

            for m in check_kw:
                if m in kwargs:
                    _warn_with_version(
                        messages[m],
                        versions[m],
                        version_warnings[m],
                        stacklevel=3,
                    )
            return fn(*args, **kwargs)  # type: ignore[no-any-return]

        doc = fn.__doc__ is not None and fn.__doc__ or ""
        if doc:
            doc = inject_param_text(
                doc,
                {
                    param: ".. deprecated:: %s %s"
                    % ("1.4" if version == "2.0" else version, (message or ""))
                    for param, (version, message) in specs.items()
                },
            )
        decorated = warned(fn)
        decorated.__doc__ = doc
        return decorated

    return decorate


def _sanitize_restructured_text(text: str) -> str:
    def repl(m: Match[str]) -> str:
        type_, name = m.group(1, 2)
        if type_ in ("func", "meth"):
            name += "()"
        return name

    text = re.sub(r":ref:`(.+) <.*>`", lambda m: '"%s"' % m.group(1), text)
    return re.sub(r"\:(\w+)\:`~?(?:_\w+)?\.?(.+?)`", repl, text)


def _decorate_cls_with_warning(
    cls: Type[_T],
    constructor: Optional[str],
    wtype: Type[exc.SADeprecationWarning],
    message: str,
    version: str,
    docstring_header: Optional[str] = None,
) -> Type[_T]:
    doc = cls.__doc__ is not None and cls.__doc__ or ""
    if docstring_header is not None:
        if constructor is not None:
            docstring_header %= dict(func=constructor)

        if issubclass(wtype, exc.Base20DeprecationWarning):
            docstring_header += (
                " (Background on SQLAlchemy 2.0 at: "
                ":ref:`migration_20_toplevel`)"
            )
        doc = inject_docstring_text(doc, docstring_header, 1)

        constructor_fn = None
        if type(cls) is type:
            clsdict = dict(cls.__dict__)
            clsdict["__doc__"] = doc
            clsdict.pop("__dict__", None)
            clsdict.pop("__weakref__", None)
            cls = type(cls.__name__, cls.__bases__, clsdict)
            if constructor is not None:
                constructor_fn = clsdict[constructor]

        else:
            cls.__doc__ = doc
            if constructor is not None:
                constructor_fn = getattr(cls, constructor)

        if constructor is not None:
            assert constructor_fn is not None
            assert wtype is not None
            setattr(
                cls,
                constructor,
                _decorate_with_warning(
                    constructor_fn, wtype, message, version, None
                ),
            )
    return cls


def _decorate_with_warning(
    func: _F,
    wtype: Type[exc.SADeprecationWarning],
    message: str,
    version: str,
    docstring_header: Optional[str] = None,
    enable_warnings: bool = True,
) -> _F:
    """Wrap a function with a warnings.warn and augmented docstring."""

    message = _sanitize_restructured_text(message)

    if issubclass(wtype, exc.Base20DeprecationWarning):
        doc_only = (
            " (Background on SQLAlchemy 2.0 at: "
            ":ref:`migration_20_toplevel`)"
        )
    else:
        doc_only = ""

    @decorator
    def warned(fn: _F, *args: Any, **kwargs: Any) -> _F:
        skip_warning = not enable_warnings or kwargs.pop(
            "_sa_skip_warning", False
        )
        if not skip_warning:
            _warn_with_version(message, version, wtype, stacklevel=3)
        return fn(*args, **kwargs)  # type: ignore[no-any-return]

    doc = func.__doc__ is not None and func.__doc__ or ""
    if docstring_header is not None:
        docstring_header %= dict(func=func.__name__)

        docstring_header += doc_only

        doc = inject_docstring_text(doc, docstring_header, 1)

    decorated = warned(func)
    decorated.__doc__ = doc
    decorated._sa_warn = lambda: _warn_with_version(  # type: ignore
        message, version, wtype, stacklevel=3
    )
    return decorated
