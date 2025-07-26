# event/legacy.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Routines to handle adaption of legacy call signatures,
generation of deprecation notes and docstrings.

"""
from __future__ import annotations

import typing
from typing import Any
from typing import Callable
from typing import List
from typing import Optional
from typing import Tuple
from typing import Type

from .registry import _ET
from .registry import _ListenerFnType
from .. import util
from ..util.compat import FullArgSpec

if typing.TYPE_CHECKING:
    from .attr import _ClsLevelDispatch
    from .base import _HasEventsDispatch


_LegacySignatureType = Tuple[str, List[str], Optional[Callable[..., Any]]]


def _legacy_signature(
    since: str,
    argnames: List[str],
    converter: Optional[Callable[..., Any]] = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """legacy sig decorator


    :param since: string version for deprecation warning
    :param argnames: list of strings, which is *all* arguments that the legacy
     version accepted, including arguments that are still there
    :param converter: lambda that will accept tuple of this full arg signature
     and return tuple of new arg signature.

    """

    def leg(fn: Callable[..., Any]) -> Callable[..., Any]:
        if not hasattr(fn, "_legacy_signatures"):
            fn._legacy_signatures = []  # type: ignore[attr-defined]
        fn._legacy_signatures.append((since, argnames, converter))  # type: ignore[attr-defined] # noqa: E501
        return fn

    return leg


def _wrap_fn_for_legacy(
    dispatch_collection: _ClsLevelDispatch[_ET],
    fn: _ListenerFnType,
    argspec: FullArgSpec,
) -> _ListenerFnType:
    for since, argnames, conv in dispatch_collection.legacy_signatures:
        if argnames[-1] == "**kw":
            has_kw = True
            argnames = argnames[0:-1]
        else:
            has_kw = False

        if len(argnames) == len(argspec.args) and has_kw is bool(
            argspec.varkw
        ):
            formatted_def = "def %s(%s%s)" % (
                dispatch_collection.name,
                ", ".join(dispatch_collection.arg_names),
                ", **kw" if has_kw else "",
            )
            warning_txt = (
                'The argument signature for the "%s.%s" event listener '
                "has changed as of version %s, and conversion for "
                "the old argument signature will be removed in a "
                'future release.  The new signature is "%s"'
                % (
                    dispatch_collection.clsname,
                    dispatch_collection.name,
                    since,
                    formatted_def,
                )
            )

            if conv is not None:
                assert not has_kw

                def wrap_leg(*args: Any, **kw: Any) -> Any:
                    util.warn_deprecated(warning_txt, version=since)
                    assert conv is not None
                    return fn(*conv(*args))

            else:

                def wrap_leg(*args: Any, **kw: Any) -> Any:
                    util.warn_deprecated(warning_txt, version=since)
                    argdict = dict(zip(dispatch_collection.arg_names, args))
                    args_from_dict = [argdict[name] for name in argnames]
                    if has_kw:
                        return fn(*args_from_dict, **kw)
                    else:
                        return fn(*args_from_dict)

            return wrap_leg
    else:
        return fn


def _indent(text: str, indent: str) -> str:
    return "\n".join(indent + line for line in text.split("\n"))


def _standard_listen_example(
    dispatch_collection: _ClsLevelDispatch[_ET],
    sample_target: Any,
    fn: _ListenerFnType,
) -> str:
    example_kw_arg = _indent(
        "\n".join(
            "%(arg)s = kw['%(arg)s']" % {"arg": arg}
            for arg in dispatch_collection.arg_names[0:2]
        ),
        "    ",
    )
    if dispatch_collection.legacy_signatures:
        current_since = max(
            since
            for since, args, conv in dispatch_collection.legacy_signatures
        )
    else:
        current_since = None
    text = (
        "from sqlalchemy import event\n\n\n"
        "@event.listens_for(%(sample_target)s, '%(event_name)s')\n"
        "def receive_%(event_name)s("
        "%(named_event_arguments)s%(has_kw_arguments)s):\n"
        "    \"listen for the '%(event_name)s' event\"\n"
        "\n    # ... (event handling logic) ...\n"
    )

    text %= {
        "current_since": " (arguments as of %s)" % current_since
        if current_since
        else "",
        "event_name": fn.__name__,
        "has_kw_arguments": ", **kw" if dispatch_collection.has_kw else "",
        "named_event_arguments": ", ".join(dispatch_collection.arg_names),
        "example_kw_arg": example_kw_arg,
        "sample_target": sample_target,
    }
    return text


def _legacy_listen_examples(
    dispatch_collection: _ClsLevelDispatch[_ET],
    sample_target: str,
    fn: _ListenerFnType,
) -> str:
    text = ""
    for since, args, conv in dispatch_collection.legacy_signatures:
        text += (
            "\n# DEPRECATED calling style (pre-%(since)s, "
            "will be removed in a future release)\n"
            "@event.listens_for(%(sample_target)s, '%(event_name)s')\n"
            "def receive_%(event_name)s("
            "%(named_event_arguments)s%(has_kw_arguments)s):\n"
            "    \"listen for the '%(event_name)s' event\"\n"
            "\n    # ... (event handling logic) ...\n"
            % {
                "since": since,
                "event_name": fn.__name__,
                "has_kw_arguments": " **kw"
                if dispatch_collection.has_kw
                else "",
                "named_event_arguments": ", ".join(args),
                "sample_target": sample_target,
            }
        )
    return text


def _version_signature_changes(
    parent_dispatch_cls: Type[_HasEventsDispatch[_ET]],
    dispatch_collection: _ClsLevelDispatch[_ET],
) -> str:
    since, args, conv = dispatch_collection.legacy_signatures[0]
    return (
        "\n.. versionchanged:: %(since)s\n"
        "    The :meth:`.%(clsname)s.%(event_name)s` event now accepts the \n"
        "    arguments %(named_event_arguments)s%(has_kw_arguments)s.\n"
        "    Support for listener functions which accept the previous \n"
        '    argument signature(s) listed above as "deprecated" will be \n'
        "    removed in a future release."
        % {
            "since": since,
            "clsname": parent_dispatch_cls.__name__,
            "event_name": dispatch_collection.name,
            "named_event_arguments": ", ".join(
                ":paramref:`.%(clsname)s.%(event_name)s.%(param_name)s`"
                % {
                    "clsname": parent_dispatch_cls.__name__,
                    "event_name": dispatch_collection.name,
                    "param_name": param_name,
                }
                for param_name in dispatch_collection.arg_names
            ),
            "has_kw_arguments": ", **kw" if dispatch_collection.has_kw else "",
        }
    )


def _augment_fn_docs(
    dispatch_collection: _ClsLevelDispatch[_ET],
    parent_dispatch_cls: Type[_HasEventsDispatch[_ET]],
    fn: _ListenerFnType,
) -> str:
    header = (
        ".. container:: event_signatures\n\n"
        "     Example argument forms::\n"
        "\n"
    )

    sample_target = getattr(parent_dispatch_cls, "_target_class_doc", "obj")
    text = header + _indent(
        _standard_listen_example(dispatch_collection, sample_target, fn),
        " " * 8,
    )
    if dispatch_collection.legacy_signatures:
        text += _indent(
            _legacy_listen_examples(dispatch_collection, sample_target, fn),
            " " * 8,
        )

        text += _version_signature_changes(
            parent_dispatch_cls, dispatch_collection
        )

    return util.inject_docstring_text(fn.__doc__, text, 1)
