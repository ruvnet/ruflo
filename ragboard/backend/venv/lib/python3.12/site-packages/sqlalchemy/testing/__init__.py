# testing/__init__.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


from unittest import mock

from . import config
from .assertions import assert_raises
from .assertions import assert_raises_context_ok
from .assertions import assert_raises_message
from .assertions import assert_raises_message_context_ok
from .assertions import assert_warns
from .assertions import assert_warns_message
from .assertions import AssertsCompiledSQL
from .assertions import AssertsExecutionResults
from .assertions import ComparesIndexes
from .assertions import ComparesTables
from .assertions import emits_warning
from .assertions import emits_warning_on
from .assertions import eq_
from .assertions import eq_ignore_whitespace
from .assertions import eq_regex
from .assertions import expect_deprecated
from .assertions import expect_deprecated_20
from .assertions import expect_raises
from .assertions import expect_raises_message
from .assertions import expect_warnings
from .assertions import in_
from .assertions import int_within_variance
from .assertions import is_
from .assertions import is_false
from .assertions import is_instance_of
from .assertions import is_none
from .assertions import is_not
from .assertions import is_not_
from .assertions import is_not_none
from .assertions import is_true
from .assertions import le_
from .assertions import ne_
from .assertions import not_in
from .assertions import not_in_
from .assertions import startswith_
from .assertions import uses_deprecated
from .config import add_to_marker
from .config import async_test
from .config import combinations
from .config import combinations_list
from .config import db
from .config import fixture
from .config import requirements as requires
from .config import skip_test
from .config import Variation
from .config import variation
from .config import variation_fixture
from .exclusions import _is_excluded
from .exclusions import _server_version
from .exclusions import against as _against
from .exclusions import db_spec
from .exclusions import exclude
from .exclusions import fails
from .exclusions import fails_if
from .exclusions import fails_on
from .exclusions import fails_on_everything_except
from .exclusions import future
from .exclusions import only_if
from .exclusions import only_on
from .exclusions import skip
from .exclusions import skip_if
from .schema import eq_clause_element
from .schema import eq_type_affinity
from .util import adict
from .util import fail
from .util import flag_combinations
from .util import force_drop_names
from .util import lambda_combinations
from .util import metadata_fixture
from .util import provide_metadata
from .util import resolve_lambda
from .util import rowset
from .util import run_as_contextmanager
from .util import teardown_events
from .warnings import assert_warnings
from .warnings import warn_test_suite


def against(*queries):
    return _against(config._current, *queries)


crashes = skip
