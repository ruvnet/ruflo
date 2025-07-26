# sql/_orm_types.py
# Copyright (C) 2022-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""ORM types that need to present specifically for **documentation only** of
the Executable.execution_options() method, which includes options that
are meaningful to the ORM.

"""


from __future__ import annotations

from ..util.typing import Literal

SynchronizeSessionArgument = Literal[False, "auto", "evaluate", "fetch"]
DMLStrategyArgument = Literal["bulk", "raw", "orm", "auto"]
