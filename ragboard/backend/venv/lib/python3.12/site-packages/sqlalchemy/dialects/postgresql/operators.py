# dialects/postgresql/operators.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
from ...sql import operators


_getitem_precedence = operators._PRECEDENCE[operators.json_getitem_op]
_eq_precedence = operators._PRECEDENCE[operators.eq]

# JSON + JSONB
ASTEXT = operators.custom_op(
    "->>",
    precedence=_getitem_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
)

JSONPATH_ASTEXT = operators.custom_op(
    "#>>",
    precedence=_getitem_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
)

# JSONB + HSTORE
HAS_KEY = operators.custom_op(
    "?",
    precedence=_eq_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
    is_comparison=True,
)

HAS_ALL = operators.custom_op(
    "?&",
    precedence=_eq_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
    is_comparison=True,
)

HAS_ANY = operators.custom_op(
    "?|",
    precedence=_eq_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
    is_comparison=True,
)

# JSONB
DELETE_PATH = operators.custom_op(
    "#-",
    precedence=_getitem_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
)

PATH_EXISTS = operators.custom_op(
    "@?",
    precedence=_eq_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
    is_comparison=True,
)

PATH_MATCH = operators.custom_op(
    "@@",
    precedence=_eq_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
    is_comparison=True,
)

# JSONB + ARRAY + HSTORE + RANGE
CONTAINS = operators.custom_op(
    "@>",
    precedence=_eq_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
    is_comparison=True,
)

CONTAINED_BY = operators.custom_op(
    "<@",
    precedence=_eq_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
    is_comparison=True,
)

# ARRAY + RANGE
OVERLAP = operators.custom_op(
    "&&",
    precedence=_eq_precedence,
    is_comparison=True,
)

# RANGE
STRICTLY_LEFT_OF = operators.custom_op(
    "<<", precedence=_eq_precedence, is_comparison=True
)

STRICTLY_RIGHT_OF = operators.custom_op(
    ">>", precedence=_eq_precedence, is_comparison=True
)

NOT_EXTEND_RIGHT_OF = operators.custom_op(
    "&<", precedence=_eq_precedence, is_comparison=True
)

NOT_EXTEND_LEFT_OF = operators.custom_op(
    "&>", precedence=_eq_precedence, is_comparison=True
)

ADJACENT_TO = operators.custom_op(
    "-|-", precedence=_eq_precedence, is_comparison=True
)

# HSTORE
GETITEM = operators.custom_op(
    "->",
    precedence=_getitem_precedence,
    natural_self_precedent=True,
    eager_grouping=True,
)
