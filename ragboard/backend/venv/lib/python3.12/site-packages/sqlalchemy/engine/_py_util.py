# engine/_py_util.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

import typing
from typing import Any
from typing import Mapping
from typing import Optional
from typing import Tuple

from .. import exc

if typing.TYPE_CHECKING:
    from .interfaces import _CoreAnyExecuteParams
    from .interfaces import _CoreMultiExecuteParams
    from .interfaces import _DBAPIAnyExecuteParams
    from .interfaces import _DBAPIMultiExecuteParams


_no_tuple: Tuple[Any, ...] = ()


def _distill_params_20(
    params: Optional[_CoreAnyExecuteParams],
) -> _CoreMultiExecuteParams:
    if params is None:
        return _no_tuple
    # Assume list is more likely than tuple
    elif isinstance(params, list) or isinstance(params, tuple):
        # collections_abc.MutableSequence): # avoid abc.__instancecheck__
        if params and not isinstance(params[0], (tuple, Mapping)):
            raise exc.ArgumentError(
                "List argument must consist only of tuples or dictionaries"
            )

        return params
    elif isinstance(params, dict) or isinstance(
        # only do immutabledict or abc.__instancecheck__ for Mapping after
        # we've checked for plain dictionaries and would otherwise raise
        params,
        Mapping,
    ):
        return [params]
    else:
        raise exc.ArgumentError("mapping or list expected for parameters")


def _distill_raw_params(
    params: Optional[_DBAPIAnyExecuteParams],
) -> _DBAPIMultiExecuteParams:
    if params is None:
        return _no_tuple
    elif isinstance(params, list):
        # collections_abc.MutableSequence): # avoid abc.__instancecheck__
        if params and not isinstance(params[0], (tuple, Mapping)):
            raise exc.ArgumentError(
                "List argument must consist only of tuples or dictionaries"
            )

        return params
    elif isinstance(params, (tuple, dict)) or isinstance(
        # only do abc.__instancecheck__ for Mapping after we've checked
        # for plain dictionaries and would otherwise raise
        params,
        Mapping,
    ):
        # cast("Union[List[Mapping[str, Any]], Tuple[Any, ...]]", [params])
        return [params]  # type: ignore
    else:
        raise exc.ArgumentError("mapping or sequence expected for parameters")
