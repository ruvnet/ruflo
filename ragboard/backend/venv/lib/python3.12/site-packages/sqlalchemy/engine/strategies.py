# engine/strategies.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Deprecated mock engine strategy used by Alembic.


"""

from __future__ import annotations

from .mock import MockConnection  # noqa


class MockEngineStrategy:
    MockConnection = MockConnection
