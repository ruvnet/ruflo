# testing/plugin/bootstrap.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

"""
Bootstrapper for test framework plugins.

The entire rationale for this system is to get the modules in plugin/
imported without importing all of the supporting library, so that we can
set up things for testing before coverage starts.

The rationale for all of plugin/ being *in* the supporting library in the
first place is so that the testing and plugin suite is available to other
libraries, mainly external SQLAlchemy and Alembic dialects, to make use
of the same test environment and standard suites available to
SQLAlchemy/Alembic themselves without the need to ship/install a separate
package outside of SQLAlchemy.


"""

import importlib.util
import os
import sys


bootstrap_file = locals()["bootstrap_file"]
to_bootstrap = locals()["to_bootstrap"]


def load_file_as_module(name):
    path = os.path.join(os.path.dirname(bootstrap_file), "%s.py" % name)

    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


if to_bootstrap == "pytest":
    sys.modules["sqla_plugin_base"] = load_file_as_module("plugin_base")
    sys.modules["sqla_plugin_base"].bootstrapped_as_sqlalchemy = True
    sys.modules["sqla_pytestplugin"] = load_file_as_module("pytestplugin")
else:
    raise Exception("unknown bootstrap: %s" % to_bootstrap)  # noqa
