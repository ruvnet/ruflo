"""App utilities: Compat settings, bug-report tool, pickling apps."""
import os
import platform as _platform
import re
from collections import namedtuple
from collections.abc import Mapping
from copy import deepcopy
from types import ModuleType

from kombu.utils.url import maybe_sanitize_url

from celery.exceptions import ImproperlyConfigured
from celery.platforms import pyimplementation
from celery.utils.collections import ConfigurationView
from celery.utils.imports import import_from_cwd, qualname, symbol_by_name
from celery.utils.text import pretty

from .defaults import _OLD_DEFAULTS, _OLD_SETTING_KEYS, _TO_NEW_KEY, _TO_OLD_KEY, DEFAULTS, SETTING_KEYS, find

__all__ = (
    'Settings', 'appstr', 'bugreport',
    'filter_hidden_settings', 'find_app',
)

#: Format used to generate bug-report information.
BUGREPORT_INFO = """
software -> celery:{celery_v} kombu:{kombu_v} py:{py_v}
            billiard:{billiard_v} {driver_v}
platform -> system:{system} arch:{arch}
            kernel version:{kernel_version} imp:{py_i}
loader   -> {loader}
settings -> transport:{transport} results:{results}

{human_settings}
"""

HIDDEN_SETTINGS = re.compile(
    'API|TOKEN|KEY|SECRET|PASS|PROFANITIES_LIST|SIGNATURE|DATABASE',
    re.IGNORECASE,
)

E_MIX_OLD_INTO_NEW = """

Cannot mix new and old setting keys, please rename the
following settings to the new format:

{renames}

"""

E_MIX_NEW_INTO_OLD = """

Cannot mix new setting names with old setting names, please
rename the following settings to use the old format:

{renames}

Or change all of the settings to use the new format :)

"""

FMT_REPLACE_SETTING = '{replace:<36} -> {with_}'


def appstr(app):
    """String used in __repr__ etc, to id app instances."""
    return f'{app.main or "__main__"} at {id(app):#x}'


class Settings(ConfigurationView):
    """Celery settings object.

    .. seealso:

        :ref:`configuration` for a full list of configuration keys.

    """

    def __init__(self, *args, deprecated_settings=None, **kwargs):
        super().__init__(*args, **kwargs)

        self.deprecated_settings = deprecated_settings

    @property
    def broker_read_url(self):
        return (
            os.environ.get('CELERY_BROKER_READ_URL') or
            self.get('broker_read_url') or
            self.broker_url
        )

    @property
    def broker_write_url(self):
        return (
            os.environ.get('CELERY_BROKER_WRITE_URL') or
            self.get('broker_write_url') or
            self.broker_url
        )

    @property
    def broker_url(self):
        return (
            os.environ.get('CELERY_BROKER_URL') or
            self.first('broker_url', 'broker_host')
        )

    @property
    def result_backend(self):
        return (
            os.environ.get('CELERY_RESULT_BACKEND') or
            self.first('result_backend', 'CELERY_RESULT_BACKEND')
        )

    @property
    def task_default_exchange(self):
        return self.first(
            'task_default_exchange',
            'task_default_queue',
        )

    @property
    def task_default_routing_key(self):
        return self.first(
            'task_default_routing_key',
            'task_default_queue',
        )

    @property
    def timezone(self):
        # this way we also support django's time zone.
        return self.first('timezone', 'TIME_ZONE')

    def without_defaults(self):
        """Return the current configuration, but without defaults."""
        # the last stash is the default settings, so just skip that
        return Settings({}, self.maps[:-1])

    def value_set_for(self, key):
        return key in self.without_defaults()

    def find_option(self, name, namespace=''):
        """Search for option by name.

        Example:
            >>> from proj.celery import app
            >>> app.conf.find_option('disable_rate_limits')
            ('worker', 'prefetch_multiplier',
             <Option: type->bool default->False>))

        Arguments:
            name (str): Name of option, cannot be partial.
            namespace (str): Preferred name-space (``None`` by default).
        Returns:
            Tuple: of ``(namespace, key, type)``.
        """
        return find(name, namespace)

    def find_value_for_key(self, name, namespace='celery'):
        """Shortcut to ``get_by_parts(*find_option(name)[:-1])``."""
        return self.get_by_parts(*self.find_option(name, namespace)[:-1])

    def get_by_parts(self, *parts):
        """Return the current value for setting specified as a path.

        Example:
            >>> from proj.celery import app
            >>> app.conf.get_by_parts('worker', 'disable_rate_limits')
            False
        """
        return self['_'.join(part for part in parts if part)]

    def finalize(self):
        # See PendingConfiguration in celery/app/base.py
        # first access will read actual configuration.
        try:
            self['__bogus__']
        except KeyError:
            pass
        return self

    def table(self, with_defaults=False, censored=True):
        filt = filter_hidden_settings if censored else lambda v: v
        dict_members = dir(dict)
        self.finalize()
        settings = self if with_defaults else self.without_defaults()
        return filt({
            k: v for k, v in settings.items()
            if not k.startswith('_') and k not in dict_members
        })

    def humanize(self, with_defaults=False, censored=True):
        """Return a human readable text showing configuration changes."""
        return '\n'.join(
            f'{key}: {pretty(value, width=50)}'
            for key, value in self.table(with_defaults, censored).items())

    def maybe_warn_deprecated_settings(self):
        # TODO: Remove this method in Celery 6.0
        if self.deprecated_settings:
            from celery.app.defaults import _TO_NEW_KEY
            from celery.utils import deprecated
            for setting in self.deprecated_settings:
                deprecated.warn(description=f'The {setting!r} setting',
                                removal='6.0.0',
                                alternative=f'Use the {_TO_NEW_KEY[setting]} instead')

            return True

        return False


def _new_key_to_old(key, convert=_TO_OLD_KEY.get):
    return convert(key, key)


def _old_key_to_new(key, convert=_TO_NEW_KEY.get):
    return convert(key, key)


_settings_info_t = namedtuple('settings_info_t', (
    'defaults', 'convert', 'key_t', 'mix_error',
))

_settings_info = _settings_info_t(
    DEFAULTS, _TO_NEW_KEY, _old_key_to_new, E_MIX_OLD_INTO_NEW,
)
_old_settings_info = _settings_info_t(
    _OLD_DEFAULTS, _TO_OLD_KEY, _new_key_to_old, E_MIX_NEW_INTO_OLD,
)


def detect_settings(conf, preconf=None, ignore_keys=None, prefix=None,
                    all_keys=None, old_keys=None):
    preconf = {} if not preconf else preconf
    ignore_keys = set() if not ignore_keys else ignore_keys
    all_keys = SETTING_KEYS if not all_keys else all_keys
    old_keys = _OLD_SETTING_KEYS if not old_keys else old_keys

    source = conf
    if conf is None:
        source, conf = preconf, {}
    have = set(source.keys()) - ignore_keys
    is_in_new = have.intersection(all_keys)
    is_in_old = have.intersection(old_keys)

    info = None
    if is_in_new:
        # have new setting names
        info, left = _settings_info, is_in_old
        if is_in_old and len(is_in_old) > len(is_in_new):
            # Majority of the settings are old.
            info, left = _old_settings_info, is_in_new
    if is_in_old:
        # have old setting names, or a majority of the names are old.
        if not info:
            info, left = _old_settings_info, is_in_new
        if is_in_new and len(is_in_new) > len(is_in_old):
            # Majority of the settings are new
            info, left = _settings_info, is_in_old
    else:
        # no settings, just use new format.
        info, left = _settings_info, is_in_old

    if prefix:
        # always use new format if prefix is used.
        info, left = _settings_info, set()

    # only raise error for keys that the user didn't provide two keys
    # for (e.g., both ``result_expires`` and ``CELERY_TASK_RESULT_EXPIRES``).
    really_left = {key for key in left if info.convert[key] not in have}
    if really_left:
        # user is mixing old/new, or new/old settings, give renaming
        # suggestions.
        raise ImproperlyConfigured(info.mix_error.format(renames='\n'.join(
            FMT_REPLACE_SETTING.format(replace=key, with_=info.convert[key])
            for key in sorted(really_left)
        )))

    preconf = {info.convert.get(k, k): v for k, v in preconf.items()}
    defaults = dict(deepcopy(info.defaults), **preconf)
    return Settings(
        preconf, [conf, defaults],
        (_old_key_to_new, _new_key_to_old),
        deprecated_settings=is_in_old,
        prefix=prefix,
    )


class AppPickler:
    """Old application pickler/unpickler (< 3.1)."""

    def __call__(self, cls, *args):
        kwargs = self.build_kwargs(*args)
        app = self.construct(cls, **kwargs)
        self.prepare(app, **kwargs)
        return app

    def prepare(self, app, **kwargs):
        app.conf.update(kwargs['changes'])

    def build_kwargs(self, *args):
        return self.build_standard_kwargs(*args)

    def build_standard_kwargs(self, main, changes, loader, backend, amqp,
                              events, log, control, accept_magic_kwargs,
                              config_source=None):
        return {'main': main, 'loader': loader, 'backend': backend,
                'amqp': amqp, 'changes': changes, 'events': events,
                'log': log, 'control': control, 'set_as_current': False,
                'config_source': config_source}

    def construct(self, cls, **kwargs):
        return cls(**kwargs)


def _unpickle_app(cls, pickler, *args):
    """Rebuild app for versions 2.5+."""
    return pickler()(cls, *args)


def _unpickle_app_v2(cls, kwargs):
    """Rebuild app for versions 3.1+."""
    kwargs['set_as_current'] = False
    return cls(**kwargs)


def filter_hidden_settings(conf):
    """Filter sensitive settings."""
    def maybe_censor(key, value, mask='*' * 8):
        if isinstance(value, Mapping):
            return filter_hidden_settings(value)
        if isinstance(key, str):
            if HIDDEN_SETTINGS.search(key):
                return mask
            elif 'broker_url' in key.lower():
                from kombu import Connection
                return Connection(value).as_uri(mask=mask)
            elif 'backend' in key.lower():
                return maybe_sanitize_url(value, mask=mask)

        return value

    return {k: maybe_censor(k, v) for k, v in conf.items()}


def bugreport(app):
    """Return a string containing information useful in bug-reports."""
    import billiard
    import kombu

    import celery

    try:
        conn = app.connection()
        driver_v = '{}:{}'.format(conn.transport.driver_name,
                                  conn.transport.driver_version())
        transport = conn.transport_cls
    except Exception:  # pylint: disable=broad-except
        transport = driver_v = ''

    return BUGREPORT_INFO.format(
        system=_platform.system(),
        arch=', '.join(x for x in _platform.architecture() if x),
        kernel_version=_platform.release(),
        py_i=pyimplementation(),
        celery_v=celery.VERSION_BANNER,
        kombu_v=kombu.__version__,
        billiard_v=billiard.__version__,
        py_v=_platform.python_version(),
        driver_v=driver_v,
        transport=transport,
        results=maybe_sanitize_url(app.conf.result_backend or 'disabled'),
        human_settings=app.conf.humanize(),
        loader=qualname(app.loader.__class__),
    )


def find_app(app, symbol_by_name=symbol_by_name, imp=import_from_cwd):
    """Find app by name."""
    from .base import Celery

    try:
        sym = symbol_by_name(app, imp=imp)
    except AttributeError:
        # last part was not an attribute, but a module
        sym = imp(app)
    if isinstance(sym, ModuleType) and ':' not in app:
        try:
            found = sym.app
            if isinstance(found, ModuleType):
                raise AttributeError()
        except AttributeError:
            try:
                found = sym.celery
                if isinstance(found, ModuleType):
                    raise AttributeError(
                        "attribute 'celery' is the celery module not the instance of celery")
            except AttributeError:
                if getattr(sym, '__path__', None):
                    try:
                        return find_app(
                            f'{app}.celery',
                            symbol_by_name=symbol_by_name, imp=imp,
                        )
                    except ImportError:
                        pass
                for suspect in vars(sym).values():
                    if isinstance(suspect, Celery):
                        return suspect
                raise
            else:
                return found
        else:
            return found
    return sym
