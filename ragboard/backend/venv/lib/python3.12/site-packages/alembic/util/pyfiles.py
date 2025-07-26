from __future__ import annotations

import atexit
from contextlib import ExitStack
import importlib
import importlib.machinery
import importlib.util
import os
import re
import tempfile
from types import ModuleType
from typing import Any
from typing import Optional

from mako import exceptions
from mako.template import Template

from . import compat
from .exc import CommandError


def template_to_file(
    template_file: str, dest: str, output_encoding: str, **kw: Any
) -> None:
    template = Template(filename=template_file)
    try:
        output = template.render_unicode(**kw).encode(output_encoding)
    except:
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as ntf:
            ntf.write(
                exceptions.text_error_template()
                .render_unicode()
                .encode(output_encoding)
            )
            fname = ntf.name
        raise CommandError(
            "Template rendering failed; see %s for a "
            "template-oriented traceback." % fname
        )
    else:
        with open(dest, "wb") as f:
            f.write(output)


def coerce_resource_to_filename(fname: str) -> str:
    """Interpret a filename as either a filesystem location or as a package
    resource.

    Names that are non absolute paths and contain a colon
    are interpreted as resources and coerced to a file location.

    """
    if not os.path.isabs(fname) and ":" in fname:
        tokens = fname.split(":")

        # from https://importlib-resources.readthedocs.io/en/latest/migration.html#pkg-resources-resource-filename  # noqa E501

        file_manager = ExitStack()
        atexit.register(file_manager.close)

        ref = compat.importlib_resources.files(tokens[0])
        for tok in tokens[1:]:
            ref = ref / tok
        fname = file_manager.enter_context(  # type: ignore[assignment]
            compat.importlib_resources.as_file(ref)
        )
    return fname


def pyc_file_from_path(path: str) -> Optional[str]:
    """Given a python source path, locate the .pyc."""

    candidate = importlib.util.cache_from_source(path)
    if os.path.exists(candidate):
        return candidate

    # even for pep3147, fall back to the old way of finding .pyc files,
    # to support sourceless operation
    filepath, ext = os.path.splitext(path)
    for ext in importlib.machinery.BYTECODE_SUFFIXES:
        if os.path.exists(filepath + ext):
            return filepath + ext
    else:
        return None


def load_python_file(dir_: str, filename: str) -> ModuleType:
    """Load a file from the given path as a Python module."""

    module_id = re.sub(r"\W", "_", filename)
    path = os.path.join(dir_, filename)
    _, ext = os.path.splitext(filename)
    if ext == ".py":
        if os.path.exists(path):
            module = load_module_py(module_id, path)
        else:
            pyc_path = pyc_file_from_path(path)
            if pyc_path is None:
                raise ImportError("Can't find Python file %s" % path)
            else:
                module = load_module_py(module_id, pyc_path)
    elif ext in (".pyc", ".pyo"):
        module = load_module_py(module_id, path)
    else:
        assert False
    return module


def load_module_py(module_id: str, path: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_id, path)
    assert spec
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore
    return module
