"""Distributed Task Queue."""
# :copyright: (c) 2017-2026 Asif Saif Uddin, celery core and individual
#                 contributors, All rights reserved.
# :copyright: (c) 2015-2016 Ask Solem.  All rights reserved.
# :copyright: (c) 2012-2014 GoPivotal, Inc., All rights reserved.
# :copyright: (c) 2009 - 2012 Ask Solem and individual contributors,
#                 All rights reserved.
# :license:   BSD (3 Clause), see LICENSE for more details.

import os
import re
import sys
from collections import namedtuple

# Lazy loading
from . import local

SERIES = 'emerald-rush'

__version__ = '5.3.4'
__author__ = 'Ask Solem'
__contact__ = 'auvipy@gmail.com'
__homepage__ = 'https://docs.celeryq.dev/'
__docformat__ = 'restructuredtext'
__keywords__ = 'task job queue distributed messaging actor'

# -eof meta-

__all__ = (
    'Celery', 'bugreport', 'shared_task', 'Task',
    'current_app', 'current_task', 'maybe_signature',
    'chain', 'chord', 'chunks', 'group', 'signature',
    'xmap', 'xstarmap', 'uuid',
)

VERSION_BANNER = f'{__version__} ({SERIES})'

version_info_t = namedtuple('version_info_t', (
    'major', 'minor', 'micro', 'releaselevel', 'serial',
))

# bumpversion can only search for {current_version}
# so we have to parse the version here.
_temp = re.match(
    r'(\d+)\.(\d+).(\d+)(.+)?', __version__).groups()
VERSION = version_info = version_info_t(
    int(_temp[0]), int(_temp[1]), int(_temp[2]), _temp[3] or '', '')
del _temp
del re

if os.environ.get('C_IMPDEBUG'):  # pragma: no cover
    import builtins

    def debug_import(name, locals=None, globals=None,
                     fromlist=None, level=-1, real_import=builtins.__import__):
        glob = globals or getattr(sys, 'emarfteg_'[::-1])(1).f_globals
        importer_name = glob and glob.get('__name__') or 'unknown'
        print(f'-- {importer_name} imports {name}')
        return real_import(name, locals, globals, fromlist, level)
    builtins.__import__ = debug_import

# This is never executed, but tricks static analyzers (PyDev, PyCharm,
# pylint, etc.) into knowing the types of these symbols, and what
# they contain.
STATICA_HACK = True
globals()['kcah_acitats'[::-1].upper()] = False
if STATICA_HACK:  # pragma: no cover
    from celery._state import current_app, current_task
    from celery.app import shared_task
    from celery.app.base import Celery
    from celery.app.task import Task
    from celery.app.utils import bugreport
    from celery.canvas import (chain, chord, chunks, group, maybe_signature, signature, subtask, xmap,  # noqa
                               xstarmap)
    from celery.utils import uuid

# Eventlet/gevent patching must happen before importing
# anything else, so these tools must be at top-level.


def _find_option_with_arg(argv, short_opts=None, long_opts=None):
    """Search argv for options specifying short and longopt alternatives.

    Returns:
        str: value for option found
    Raises:
        KeyError: if option not found.
    """
    for i, arg in enumerate(argv):
        if arg.startswith('-'):
            if long_opts and arg.startswith('--'):
                name, sep, val = arg.partition('=')
                if name in long_opts:
                    return val if sep else argv[i + 1]
            if short_opts and arg in short_opts:
                return argv[i + 1]
    raise KeyError('|'.join(short_opts or [] + long_opts or []))


def _patch_eventlet():
    import eventlet.debug

    eventlet.monkey_patch()
    blockdetect = float(os.environ.get('EVENTLET_NOBLOCK', 0))
    if blockdetect:
        eventlet.debug.hub_blocking_detection(blockdetect, blockdetect)


def _patch_gevent():
    import gevent.monkey
    import gevent.signal

    gevent.monkey.patch_all()


def maybe_patch_concurrency(argv=None, short_opts=None,
                            long_opts=None, patches=None):
    """Apply eventlet/gevent monkeypatches.

    With short and long opt alternatives that specify the command line
    option to set the pool, this makes sure that anything that needs
    to be patched is completed as early as possible.
    (e.g., eventlet/gevent monkey patches).
    """
    argv = argv if argv else sys.argv
    short_opts = short_opts if short_opts else ['-P']
    long_opts = long_opts if long_opts else ['--pool']
    patches = patches if patches else {'eventlet': _patch_eventlet,
                                       'gevent': _patch_gevent}
    try:
        pool = _find_option_with_arg(argv, short_opts, long_opts)
    except KeyError:
        pass
    else:
        try:
            patcher = patches[pool]
        except KeyError:
            pass
        else:
            patcher()

        # set up eventlet/gevent environments ASAP
        from celery import concurrency
        if pool in concurrency.get_available_pool_names():
            concurrency.get_implementation(pool)


# this just creates a new module, that imports stuff on first attribute
# access.  This makes the library faster to use.
old_module, new_module = local.recreate_module(  # pragma: no cover
    __name__,
    by_module={
        'celery.app': ['Celery', 'bugreport', 'shared_task'],
        'celery.app.task': ['Task'],
        'celery._state': ['current_app', 'current_task'],
        'celery.canvas': [
            'Signature', 'chain', 'chord', 'chunks', 'group',
            'signature', 'maybe_signature', 'subtask',
            'xmap', 'xstarmap',
        ],
        'celery.utils': ['uuid'],
    },
    __package__='celery', __file__=__file__,
    __path__=__path__, __doc__=__doc__, __version__=__version__,
    __author__=__author__, __contact__=__contact__,
    __homepage__=__homepage__, __docformat__=__docformat__, local=local,
    VERSION=VERSION, SERIES=SERIES, VERSION_BANNER=VERSION_BANNER,
    version_info_t=version_info_t,
    version_info=version_info,
    maybe_patch_concurrency=maybe_patch_concurrency,
    _find_option_with_arg=_find_option_with_arg,
)
