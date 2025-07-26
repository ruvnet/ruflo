import logging
import pkgutil
import sys
import unittest


def all_names():
    for _, modname, _ in pkgutil.iter_modules(__path__):
        yield "posthog.test." + modname


def all():
    logging.basicConfig(stream=sys.stderr)
    return unittest.defaultTestLoader.loadTestsFromNames(all_names())
