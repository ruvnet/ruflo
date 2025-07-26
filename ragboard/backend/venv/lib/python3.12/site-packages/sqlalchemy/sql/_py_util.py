# sql/_py_util.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import typing
from typing import Any
from typing import Dict
from typing import Tuple
from typing import Union

from ..util.typing import Literal

if typing.TYPE_CHECKING:
    from .cache_key import CacheConst


class prefix_anon_map(Dict[str, str]):
    """A map that creates new keys for missing key access.

    Considers keys of the form "<ident> <name>" to produce
    new symbols "<name>_<index>", where "index" is an incrementing integer
    corresponding to <name>.

    Inlines the approach taken by :class:`sqlalchemy.util.PopulateDict` which
    is otherwise usually used for this type of operation.

    """

    def __missing__(self, key: str) -> str:
        (ident, derived) = key.split(" ", 1)
        anonymous_counter = self.get(derived, 1)
        self[derived] = anonymous_counter + 1  # type: ignore
        value = f"{derived}_{anonymous_counter}"
        self[key] = value
        return value


class cache_anon_map(
    Dict[Union[int, "Literal[CacheConst.NO_CACHE]"], Union[Literal[True], str]]
):
    """A map that creates new keys for missing key access.

    Produces an incrementing sequence given a series of unique keys.

    This is similar to the compiler prefix_anon_map class although simpler.

    Inlines the approach taken by :class:`sqlalchemy.util.PopulateDict` which
    is otherwise usually used for this type of operation.

    """

    _index = 0

    def get_anon(self, object_: Any) -> Tuple[str, bool]:
        idself = id(object_)
        if idself in self:
            s_val = self[idself]
            assert s_val is not True
            return s_val, True
        else:
            # inline of __missing__
            self[idself] = id_ = str(self._index)
            self._index += 1

            return id_, False

    def __missing__(self, key: int) -> str:
        self[key] = val = str(self._index)
        self._index += 1
        return val
