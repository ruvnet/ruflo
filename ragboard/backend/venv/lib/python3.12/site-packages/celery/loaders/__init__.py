"""Get loader by name.

Loaders define how configuration is read, what happens
when workers start, when tasks are executed and so on.
"""
from celery.utils.imports import import_from_cwd, symbol_by_name

__all__ = ('get_loader_cls',)

LOADER_ALIASES = {
    'app': 'celery.loaders.app:AppLoader',
    'default': 'celery.loaders.default:Loader',
}


def get_loader_cls(loader):
    """Get loader class by name/alias."""
    return symbol_by_name(loader, LOADER_ALIASES, imp=import_from_cwd)
