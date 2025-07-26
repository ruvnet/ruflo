# testing/warnings.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from __future__ import annotations

import warnings

from . import assertions
from .. import exc
from .. import exc as sa_exc
from ..exc import SATestSuiteWarning
from ..util.langhelpers import _warnings_warn


def warn_test_suite(message):
    _warnings_warn(message, category=SATestSuiteWarning)


def setup_filters():
    """hook for setting up warnings filters.

    SQLAlchemy-specific classes must only be here and not in pytest config,
    as we need to delay importing SQLAlchemy until conftest.py has been
    processed.

    NOTE: filters on subclasses of DeprecationWarning or
    PendingDeprecationWarning have no effect if added here, since pytest
    will add at each test the following filters
    ``always::PendingDeprecationWarning`` and ``always::DeprecationWarning``
    that will take precedence over any added here.

    """
    warnings.filterwarnings("error", category=exc.SAWarning)
    warnings.filterwarnings("always", category=exc.SATestSuiteWarning)


def assert_warnings(fn, warning_msgs, regex=False):
    """Assert that each of the given warnings are emitted by fn.

    Deprecated.  Please use assertions.expect_warnings().

    """

    with assertions._expect_warnings(
        sa_exc.SAWarning, warning_msgs, regex=regex
    ):
        return fn()
