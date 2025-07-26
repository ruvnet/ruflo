# mypy: no-warn-unused-ignores

from __future__ import annotations

from configparser import ConfigParser
import io
import os
import sys
import typing
from typing import Any
from typing import List
from typing import Optional
from typing import Sequence
from typing import Union

if True:
    # zimports hack for too-long names
    from sqlalchemy.util import (  # noqa: F401
        inspect_getfullargspec as inspect_getfullargspec,
    )
    from sqlalchemy.util.compat import (  # noqa: F401
        inspect_formatargspec as inspect_formatargspec,
    )

is_posix = os.name == "posix"

py311 = sys.version_info >= (3, 11)
py310 = sys.version_info >= (3, 10)
py39 = sys.version_info >= (3, 9)


# produce a wrapper that allows encoded text to stream
# into a given buffer, but doesn't close it.
# not sure of a more idiomatic approach to this.
class EncodedIO(io.TextIOWrapper):
    def close(self) -> None:
        pass


if py39:
    from importlib import resources as _resources

    importlib_resources = _resources
    from importlib import metadata as _metadata

    importlib_metadata = _metadata
    from importlib.metadata import EntryPoint as EntryPoint
else:
    import importlib_resources  # type:ignore # noqa
    import importlib_metadata  # type:ignore # noqa
    from importlib_metadata import EntryPoint  # type:ignore # noqa


def importlib_metadata_get(group: str) -> Sequence[EntryPoint]:
    ep = importlib_metadata.entry_points()
    if hasattr(ep, "select"):
        return ep.select(group=group)
    else:
        return ep.get(group, ())  # type: ignore


def formatannotation_fwdref(
    annotation: Any, base_module: Optional[Any] = None
) -> str:
    """vendored from python 3.7"""
    # copied over _formatannotation from sqlalchemy 2.0

    if isinstance(annotation, str):
        return annotation

    if getattr(annotation, "__module__", None) == "typing":
        return repr(annotation).replace("typing.", "").replace("~", "")
    if isinstance(annotation, type):
        if annotation.__module__ in ("builtins", base_module):
            return repr(annotation.__qualname__)
        return annotation.__module__ + "." + annotation.__qualname__
    elif isinstance(annotation, typing.TypeVar):
        return repr(annotation).replace("~", "")
    return repr(annotation).replace("~", "")


def read_config_parser(
    file_config: ConfigParser,
    file_argument: Sequence[Union[str, os.PathLike[str]]],
) -> List[str]:
    if py310:
        return file_config.read(file_argument, encoding="locale")
    else:
        return file_config.read(file_argument)
