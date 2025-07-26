"""
Read resources contained within a package.

This codebase is shared between importlib.resources in the stdlib
and importlib_resources in PyPI. See
https://github.com/python/importlib_metadata/wiki/Development-Methodology
for more detail.
"""

from ._common import (
    Anchor,
    Package,
    as_file,
    files,
)
from ._functional import (
    contents,
    is_resource,
    open_binary,
    open_text,
    path,
    read_binary,
    read_text,
)
from .abc import ResourceReader

__all__ = [
    'Package',
    'Anchor',
    'ResourceReader',
    'as_file',
    'files',
    'contents',
    'is_resource',
    'open_binary',
    'open_text',
    'path',
    'read_binary',
    'read_text',
]
