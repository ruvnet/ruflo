# testing/util.py
# Copyright (C) 2005-2019 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

import types
from typing import Union

from sqlalchemy.util import inspect_getfullargspec

from ..util import sqla_2


def flag_combinations(*combinations):
    """A facade around @testing.combinations() oriented towards boolean
    keyword-based arguments.

    Basically generates a nice looking identifier based on the keywords
    and also sets up the argument names.

    E.g.::

        @testing.flag_combinations(
            dict(lazy=False, passive=False),
            dict(lazy=True, passive=False),
            dict(lazy=False, passive=True),
            dict(lazy=False, passive=True, raiseload=True),
        )


    would result in::

        @testing.combinations(
            ('', False, False, False),
            ('lazy', True, False, False),
            ('lazy_passive', True, True, False),
            ('lazy_passive', True, True, True),
            id_='iaaa',
            argnames='lazy,passive,raiseload'
        )

    """
    from sqlalchemy.testing import config

    keys = set()

    for d in combinations:
        keys.update(d)

    keys = sorted(keys)

    return config.combinations(
        *[
            ("_".join(k for k in keys if d.get(k, False)),)
            + tuple(d.get(k, False) for k in keys)
            for d in combinations
        ],
        id_="i" + ("a" * len(keys)),
        argnames=",".join(keys),
    )


def resolve_lambda(__fn, **kw):
    """Given a no-arg lambda and a namespace, return a new lambda that
    has all the values filled in.

    This is used so that we can have module-level fixtures that
    refer to instance-level variables using lambdas.

    """

    pos_args = inspect_getfullargspec(__fn)[0]
    pass_pos_args = {arg: kw.pop(arg) for arg in pos_args}
    glb = dict(__fn.__globals__)
    glb.update(kw)
    new_fn = types.FunctionType(__fn.__code__, glb)
    return new_fn(**pass_pos_args)


def metadata_fixture(ddl="function"):
    """Provide MetaData for a pytest fixture."""

    from sqlalchemy.testing import config
    from . import fixture_functions

    def decorate(fn):
        def run_ddl(self):
            from sqlalchemy import schema

            metadata = self.metadata = schema.MetaData()
            try:
                result = fn(self, metadata)
                metadata.create_all(config.db)
                # TODO:
                # somehow get a per-function dml erase fixture here
                yield result
            finally:
                metadata.drop_all(config.db)

        return fixture_functions.fixture(scope=ddl)(run_ddl)

    return decorate


def _safe_int(value: str) -> Union[int, str]:
    try:
        return int(value)
    except:
        return value


def testing_engine(url=None, options=None, future=False):
    from sqlalchemy.testing import config
    from sqlalchemy.testing.engines import testing_engine

    if not future:
        future = getattr(config._current.options, "future_engine", False)

    if not sqla_2:
        kw = {"future": future} if future else {}
    else:
        kw = {}
    return testing_engine(url, options, **kw)
