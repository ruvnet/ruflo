# mypy: allow-untyped-defs, allow-incomplete-defs, allow-untyped-calls
# mypy: no-warn-return-any, allow-any-generics

from __future__ import annotations

import shlex
import subprocess
import sys
from typing import Any
from typing import Callable
from typing import Dict
from typing import List
from typing import Mapping
from typing import Optional
from typing import Union

from .. import util
from ..util import compat


REVISION_SCRIPT_TOKEN = "REVISION_SCRIPT_FILENAME"

_registry: dict = {}


def register(name: str) -> Callable:
    """A function decorator that will register that function as a write hook.

    See the documentation linked below for an example.

    .. seealso::

        :ref:`post_write_hooks_custom`


    """

    def decorate(fn):
        _registry[name] = fn
        return fn

    return decorate


def _invoke(
    name: str, revision: str, options: Mapping[str, Union[str, int]]
) -> Any:
    """Invokes the formatter registered for the given name.

    :param name: The name of a formatter in the registry
    :param revision: A :class:`.MigrationRevision` instance
    :param options: A dict containing kwargs passed to the
        specified formatter.
    :raises: :class:`alembic.util.CommandError`
    """
    try:
        hook = _registry[name]
    except KeyError as ke:
        raise util.CommandError(
            f"No formatter with name '{name}' registered"
        ) from ke
    else:
        return hook(revision, options)


def _run_hooks(path: str, hook_config: Mapping[str, str]) -> None:
    """Invoke hooks for a generated revision."""

    from .base import _split_on_space_comma

    names = _split_on_space_comma.split(hook_config.get("hooks", ""))

    for name in names:
        if not name:
            continue
        opts = {
            key[len(name) + 1 :]: hook_config[key]
            for key in hook_config
            if key.startswith(name + ".")
        }
        opts["_hook_name"] = name
        try:
            type_ = opts["type"]
        except KeyError as ke:
            raise util.CommandError(
                f"Key {name}.type is required for post write hook {name!r}"
            ) from ke
        else:
            with util.status(
                f"Running post write hook {name!r}", newline=True
            ):
                _invoke(type_, path, opts)


def _parse_cmdline_options(cmdline_options_str: str, path: str) -> List[str]:
    """Parse options from a string into a list.

    Also substitutes the revision script token with the actual filename of
    the revision script.

    If the revision script token doesn't occur in the options string, it is
    automatically prepended.
    """
    if REVISION_SCRIPT_TOKEN not in cmdline_options_str:
        cmdline_options_str = REVISION_SCRIPT_TOKEN + " " + cmdline_options_str
    cmdline_options_list = shlex.split(
        cmdline_options_str, posix=compat.is_posix
    )
    cmdline_options_list = [
        option.replace(REVISION_SCRIPT_TOKEN, path)
        for option in cmdline_options_list
    ]
    return cmdline_options_list


@register("console_scripts")
def console_scripts(
    path: str, options: dict, ignore_output: bool = False
) -> None:
    try:
        entrypoint_name = options["entrypoint"]
    except KeyError as ke:
        raise util.CommandError(
            f"Key {options['_hook_name']}.entrypoint is required for post "
            f"write hook {options['_hook_name']!r}"
        ) from ke
    for entry in compat.importlib_metadata_get("console_scripts"):
        if entry.name == entrypoint_name:
            impl: Any = entry
            break
    else:
        raise util.CommandError(
            f"Could not find entrypoint console_scripts.{entrypoint_name}"
        )
    cwd: Optional[str] = options.get("cwd", None)
    cmdline_options_str = options.get("options", "")
    cmdline_options_list = _parse_cmdline_options(cmdline_options_str, path)

    kw: Dict[str, Any] = {}
    if ignore_output:
        kw["stdout"] = kw["stderr"] = subprocess.DEVNULL

    subprocess.run(
        [
            sys.executable,
            "-c",
            f"import {impl.module}; {impl.module}.{impl.attr}()",
        ]
        + cmdline_options_list,
        cwd=cwd,
        **kw,
    )


@register("exec")
def exec_(path: str, options: dict, ignore_output: bool = False) -> None:
    try:
        executable = options["executable"]
    except KeyError as ke:
        raise util.CommandError(
            f"Key {options['_hook_name']}.executable is required for post "
            f"write hook {options['_hook_name']!r}"
        ) from ke
    cwd: Optional[str] = options.get("cwd", None)
    cmdline_options_str = options.get("options", "")
    cmdline_options_list = _parse_cmdline_options(cmdline_options_str, path)

    kw: Dict[str, Any] = {}
    if ignore_output:
        kw["stdout"] = kw["stderr"] = subprocess.DEVNULL

    subprocess.run(
        [
            executable,
            *cmdline_options_list,
        ],
        cwd=cwd,
        **kw,
    )
