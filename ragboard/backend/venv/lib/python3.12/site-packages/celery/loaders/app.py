"""The default loader used with custom app instances."""
from .base import BaseLoader

__all__ = ('AppLoader',)


class AppLoader(BaseLoader):
    """Default loader used when an app is specified."""
