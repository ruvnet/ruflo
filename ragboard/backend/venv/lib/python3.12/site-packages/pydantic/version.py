"""The `version` module holds the version information for Pydantic."""
from __future__ import annotations as _annotations

__all__ = 'VERSION', 'version_info'

VERSION = '2.5.3'
"""The version of Pydantic."""


def version_short() -> str:
    """Return the `major.minor` part of Pydantic version.

    It returns '2.1' if Pydantic version is '2.1.1'.
    """
    return '.'.join(VERSION.split('.')[:2])


def version_info() -> str:
    """Return complete version information for Pydantic and its dependencies."""
    import platform
    import sys
    from pathlib import Path

    import pydantic_core._pydantic_core as pdc

    if sys.version_info >= (3, 8):
        import importlib.metadata as importlib_metadata
    else:
        import importlib_metadata

    # get data about packages that are closely related to pydantic, use pydantic or often conflict with pydantic
    package_names = {
        'email-validator',
        'fastapi',
        'mypy',
        'pydantic-extra-types',
        'pydantic-settings',
        'pyright',
        'typing_extensions',
    }
    related_packages = []

    for dist in importlib_metadata.distributions():
        name = dist.metadata['Name']
        if name in package_names:
            related_packages.append(f'{name}-{dist.version}')

    info = {
        'pydantic version': VERSION,
        'pydantic-core version': pdc.__version__,
        'pydantic-core build': getattr(pdc, 'build_info', None) or pdc.build_profile,
        'install path': Path(__file__).resolve().parent,
        'python version': sys.version,
        'platform': platform.platform(),
        'related packages': ' '.join(related_packages),
    }
    return '\n'.join('{:>30} {}'.format(k + ':', str(v).replace('\n', ' ')) for k, v in info.items())


def parse_mypy_version(version: str) -> tuple[int, ...]:
    """Parse mypy string version to tuple of ints.

    This function is included here rather than the mypy plugin file because the mypy plugin file cannot be imported
    outside a mypy run.

    It parses normal version like `0.930` and dev version
    like `0.940+dev.04cac4b5d911c4f9529e6ce86a27b44f28846f5d.dirty`.

    Args:
        version: The mypy version string.

    Returns:
        A tuple of ints. e.g. (0, 930).
    """
    return tuple(map(int, version.partition('+')[0].split('.')))
