import sys

__all__ = ['ZipPath']


if sys.version_info >= (3, 10):
    from zipfile import Path as ZipPath
else:
    from zipp import Path as ZipPath
