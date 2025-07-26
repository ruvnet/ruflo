"""The default loader used when no custom app has been initialized."""
import os
import warnings

from celery.exceptions import NotConfigured
from celery.utils.collections import DictAttribute
from celery.utils.serialization import strtobool

from .base import BaseLoader

__all__ = ('Loader', 'DEFAULT_CONFIG_MODULE')

DEFAULT_CONFIG_MODULE = 'celeryconfig'

#: Warns if configuration file is missing if :envvar:`C_WNOCONF` is set.
C_WNOCONF = strtobool(os.environ.get('C_WNOCONF', False))


class Loader(BaseLoader):
    """The loader used by the default app."""

    def setup_settings(self, settingsdict):
        return DictAttribute(settingsdict)

    def read_configuration(self, fail_silently=True):
        """Read configuration from :file:`celeryconfig.py`."""
        configname = os.environ.get('CELERY_CONFIG_MODULE',
                                    DEFAULT_CONFIG_MODULE)
        try:
            usercfg = self._import_config_module(configname)
        except ImportError:
            if not fail_silently:
                raise
            # billiard sets this if forked using execv
            if C_WNOCONF and not os.environ.get('FORKED_BY_MULTIPROCESSING'):
                warnings.warn(NotConfigured(
                    'No {module} module found! Please make sure it exists and '
                    'is available to Python.'.format(module=configname)))
            return self.setup_settings({})
        else:
            self.configured = True
            return self.setup_settings(usercfg)
