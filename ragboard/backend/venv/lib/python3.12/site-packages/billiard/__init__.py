"""Python multiprocessing fork with improvements and bugfixes"""
#
# Package analogous to 'threading.py' but using processes
#
# multiprocessing/__init__.py
#
# This package is intended to duplicate the functionality (and much of
# the API) of threading.py but uses processes instead of threads.  A
# subpackage 'multiprocessing.dummy' has the same API but is a simple
# wrapper for 'threading'.
#
# Try calling `multiprocessing.doc.main()` to read the html
# documentation in a webbrowser.
#
#
# Copyright (c) 2006-2008, R Oudkerk
# Licensed to PSF under a Contributor Agreement.
#


import sys

from . import context

VERSION = (4, 2, 1)
__version__ = '.'.join(map(str, VERSION[0:4])) + "".join(VERSION[4:])
__author__ = 'R Oudkerk / Python Software Foundation'
__author_email__ = 'python-dev@python.org'
__maintainer__ = 'Asif Saif Uddin'
__contact__ = "auvipy@gmail.com"
__homepage__ = "https://github.com/celery/billiard"
__docformat__ = "restructuredtext"

# -eof meta-

#
# Copy stuff from default context
#

globals().update((name, getattr(context._default_context, name))
                 for name in context._default_context.__all__)
__all__ = context._default_context.__all__

#
# XXX These should not really be documented or public.
#

SUBDEBUG = 5
SUBWARNING = 25

#
# Alias for main module -- will be reset by bootstrapping child processes
#

if '__main__' in sys.modules:
    sys.modules['__mp_main__'] = sys.modules['__main__']


def ensure_multiprocessing():
    from ._ext import ensure_multiprocessing
    return ensure_multiprocessing()
