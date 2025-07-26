from __future__ import annotations

import os
from os.path import exists
from os.path import join
from os.path import splitext
from subprocess import check_call
from typing import Dict
from typing import List
from typing import Mapping
from typing import Optional

from .compat import is_posix
from .exc import CommandError


def open_in_editor(
    filename: str, environ: Optional[Dict[str, str]] = None
) -> None:
    """
    Opens the given file in a text editor. If the environment variable
    ``EDITOR`` is set, this is taken as preference.

    Otherwise, a list of commonly installed editors is tried.

    If no editor matches, an :py:exc:`OSError` is raised.

    :param filename: The filename to open. Will be passed  verbatim to the
        editor command.
    :param environ: An optional drop-in replacement for ``os.environ``. Used
        mainly for testing.
    """
    env = os.environ if environ is None else environ
    try:
        editor = _find_editor(env)
        check_call([editor, filename])
    except Exception as exc:
        raise CommandError("Error executing editor (%s)" % (exc,)) from exc


def _find_editor(environ: Mapping[str, str]) -> str:
    candidates = _default_editors()
    for i, var in enumerate(("EDITOR", "VISUAL")):
        if var in environ:
            user_choice = environ[var]
            if exists(user_choice):
                return user_choice
            if os.sep not in user_choice:
                candidates.insert(i, user_choice)

    for candidate in candidates:
        path = _find_executable(candidate, environ)
        if path is not None:
            return path
    raise OSError(
        "No suitable editor found. Please set the "
        '"EDITOR" or "VISUAL" environment variables'
    )


def _find_executable(
    candidate: str, environ: Mapping[str, str]
) -> Optional[str]:
    # Assuming this is on the PATH, we need to determine it's absolute
    # location. Otherwise, ``check_call`` will fail
    if not is_posix and splitext(candidate)[1] != ".exe":
        candidate += ".exe"
    for path in environ.get("PATH", "").split(os.pathsep):
        value = join(path, candidate)
        if exists(value):
            return value
    return None


def _default_editors() -> List[str]:
    # Look for an editor. Prefer the user's choice by env-var, fall back to
    # most commonly installed editor (nano/vim)
    if is_posix:
        return ["sensible-editor", "editor", "nano", "vim", "code"]
    else:
        return ["code.exe", "notepad++.exe", "notepad.exe"]
