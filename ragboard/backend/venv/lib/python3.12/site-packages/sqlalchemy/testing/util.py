# testing/util.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


from __future__ import annotations

from collections import deque
import decimal
import gc
from itertools import chain
import random
import sys
from sys import getsizeof
import types

from . import config
from . import mock
from .. import inspect
from ..engine import Connection
from ..schema import Column
from ..schema import DropConstraint
from ..schema import DropTable
from ..schema import ForeignKeyConstraint
from ..schema import MetaData
from ..schema import Table
from ..sql import schema
from ..sql.sqltypes import Integer
from ..util import decorator
from ..util import defaultdict
from ..util import has_refcount_gc
from ..util import inspect_getfullargspec


if not has_refcount_gc:

    def non_refcount_gc_collect(*args):
        gc.collect()
        gc.collect()

    gc_collect = lazy_gc = non_refcount_gc_collect
else:
    # assume CPython - straight gc.collect, lazy_gc() is a pass
    gc_collect = gc.collect

    def lazy_gc():
        pass


def picklers():
    picklers = set()
    import pickle

    picklers.add(pickle)

    # yes, this thing needs this much testing
    for pickle_ in picklers:
        for protocol in range(-2, pickle.HIGHEST_PROTOCOL + 1):
            yield pickle_.loads, lambda d: pickle_.dumps(d, protocol)


def random_choices(population, k=1):
    return random.choices(population, k=k)


def round_decimal(value, prec):
    if isinstance(value, float):
        return round(value, prec)

    # can also use shift() here but that is 2.6 only
    return (value * decimal.Decimal("1" + "0" * prec)).to_integral(
        decimal.ROUND_FLOOR
    ) / pow(10, prec)


class RandomSet(set):
    def __iter__(self):
        l = list(set.__iter__(self))
        random.shuffle(l)
        return iter(l)

    def pop(self):
        index = random.randint(0, len(self) - 1)
        item = list(set.__iter__(self))[index]
        self.remove(item)
        return item

    def union(self, other):
        return RandomSet(set.union(self, other))

    def difference(self, other):
        return RandomSet(set.difference(self, other))

    def intersection(self, other):
        return RandomSet(set.intersection(self, other))

    def copy(self):
        return RandomSet(self)


def conforms_partial_ordering(tuples, sorted_elements):
    """True if the given sorting conforms to the given partial ordering."""

    deps = defaultdict(set)
    for parent, child in tuples:
        deps[parent].add(child)
    for i, node in enumerate(sorted_elements):
        for n in sorted_elements[i:]:
            if node in deps[n]:
                return False
    else:
        return True


def all_partial_orderings(tuples, elements):
    edges = defaultdict(set)
    for parent, child in tuples:
        edges[child].add(parent)

    def _all_orderings(elements):
        if len(elements) == 1:
            yield list(elements)
        else:
            for elem in elements:
                subset = set(elements).difference([elem])
                if not subset.intersection(edges[elem]):
                    for sub_ordering in _all_orderings(subset):
                        yield [elem] + sub_ordering

    return iter(_all_orderings(elements))


def function_named(fn, name):
    """Return a function with a given __name__.

    Will assign to __name__ and return the original function if possible on
    the Python implementation, otherwise a new function will be constructed.

    This function should be phased out as much as possible
    in favor of @decorator.   Tests that "generate" many named tests
    should be modernized.

    """
    try:
        fn.__name__ = name
    except TypeError:
        fn = types.FunctionType(
            fn.__code__, fn.__globals__, name, fn.__defaults__, fn.__closure__
        )
    return fn


def run_as_contextmanager(ctx, fn, *arg, **kw):
    """Run the given function under the given contextmanager,
    simulating the behavior of 'with' to support older
    Python versions.

    This is not necessary anymore as we have placed 2.6
    as minimum Python version, however some tests are still using
    this structure.

    """

    obj = ctx.__enter__()
    try:
        result = fn(obj, *arg, **kw)
        ctx.__exit__(None, None, None)
        return result
    except:
        exc_info = sys.exc_info()
        raise_ = ctx.__exit__(*exc_info)
        if not raise_:
            raise
        else:
            return raise_


def rowset(results):
    """Converts the results of sql execution into a plain set of column tuples.

    Useful for asserting the results of an unordered query.
    """

    return {tuple(row) for row in results}


def fail(msg):
    assert False, msg


@decorator
def provide_metadata(fn, *args, **kw):
    """Provide bound MetaData for a single test, dropping afterwards.

    Legacy; use the "metadata" pytest fixture.

    """

    from . import fixtures

    metadata = schema.MetaData()
    self = args[0]
    prev_meta = getattr(self, "metadata", None)
    self.metadata = metadata
    try:
        return fn(*args, **kw)
    finally:
        # close out some things that get in the way of dropping tables.
        # when using the "metadata" fixture, there is a set ordering
        # of things that makes sure things are cleaned up in order, however
        # the simple "decorator" nature of this legacy function means
        # we have to hardcode some of that cleanup ahead of time.

        # close ORM sessions
        fixtures.close_all_sessions()

        # integrate with the "connection" fixture as there are many
        # tests where it is used along with provide_metadata
        cfc = fixtures.base._connection_fixture_connection
        if cfc:
            # TODO: this warning can be used to find all the places
            # this is used with connection fixture
            # warn("mixing legacy provide metadata with connection fixture")
            drop_all_tables_from_metadata(metadata, cfc)
            # as the provide_metadata fixture is often used with "testing.db",
            # when we do the drop we have to commit the transaction so that
            # the DB is actually updated as the CREATE would have been
            # committed
            cfc.get_transaction().commit()
        else:
            drop_all_tables_from_metadata(metadata, config.db)
        self.metadata = prev_meta


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


def lambda_combinations(lambda_arg_sets, **kw):
    args = inspect_getfullargspec(lambda_arg_sets)

    arg_sets = lambda_arg_sets(*[mock.Mock() for arg in args[0]])

    def create_fixture(pos):
        def fixture(**kw):
            return lambda_arg_sets(**kw)[pos]

        fixture.__name__ = "fixture_%3.3d" % pos
        return fixture

    return config.combinations(
        *[(create_fixture(i),) for i in range(len(arg_sets))], **kw
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

    def decorate(fn):
        def run_ddl(self):
            metadata = self.metadata = schema.MetaData()
            try:
                result = fn(self, metadata)
                metadata.create_all(config.db)
                # TODO:
                # somehow get a per-function dml erase fixture here
                yield result
            finally:
                metadata.drop_all(config.db)

        return config.fixture(scope=ddl)(run_ddl)

    return decorate


def force_drop_names(*names):
    """Force the given table names to be dropped after test complete,
    isolating for foreign key cycles

    """

    @decorator
    def go(fn, *args, **kw):
        try:
            return fn(*args, **kw)
        finally:
            drop_all_tables(config.db, inspect(config.db), include_names=names)

    return go


class adict(dict):
    """Dict keys available as attributes.  Shadows."""

    def __getattribute__(self, key):
        try:
            return self[key]
        except KeyError:
            return dict.__getattribute__(self, key)

    def __call__(self, *keys):
        return tuple([self[key] for key in keys])

    get_all = __call__


def drop_all_tables_from_metadata(metadata, engine_or_connection):
    from . import engines

    def go(connection):
        engines.testing_reaper.prepare_for_drop_tables(connection)

        if not connection.dialect.supports_alter:
            from . import assertions

            with assertions.expect_warnings(
                "Can't sort tables", assert_=False
            ):
                metadata.drop_all(connection)
        else:
            metadata.drop_all(connection)

    if not isinstance(engine_or_connection, Connection):
        with engine_or_connection.begin() as connection:
            go(connection)
    else:
        go(engine_or_connection)


def drop_all_tables(
    engine,
    inspector,
    schema=None,
    consider_schemas=(None,),
    include_names=None,
):
    if include_names is not None:
        include_names = set(include_names)

    if schema is not None:
        assert consider_schemas == (
            None,
        ), "consider_schemas and schema are mutually exclusive"
        consider_schemas = (schema,)

    with engine.begin() as conn:
        for table_key, fkcs in reversed(
            inspector.sort_tables_on_foreign_key_dependency(
                consider_schemas=consider_schemas
            )
        ):
            if table_key:
                if (
                    include_names is not None
                    and table_key[1] not in include_names
                ):
                    continue
                conn.execute(
                    DropTable(
                        Table(table_key[1], MetaData(), schema=table_key[0])
                    )
                )
            elif fkcs:
                if not engine.dialect.supports_alter:
                    continue
                for t_key, fkc in fkcs:
                    if (
                        include_names is not None
                        and t_key[1] not in include_names
                    ):
                        continue
                    tb = Table(
                        t_key[1],
                        MetaData(),
                        Column("x", Integer),
                        Column("y", Integer),
                        schema=t_key[0],
                    )
                    conn.execute(
                        DropConstraint(
                            ForeignKeyConstraint([tb.c.x], [tb.c.y], name=fkc)
                        )
                    )


def teardown_events(event_cls):
    @decorator
    def decorate(fn, *arg, **kw):
        try:
            return fn(*arg, **kw)
        finally:
            event_cls._clear()

    return decorate


def total_size(o):
    """Returns the approximate memory footprint an object and all of its
    contents.

    source: https://code.activestate.com/recipes/577504/


    """

    def dict_handler(d):
        return chain.from_iterable(d.items())

    all_handlers = {
        tuple: iter,
        list: iter,
        deque: iter,
        dict: dict_handler,
        set: iter,
        frozenset: iter,
    }
    seen = set()  # track which object id's have already been seen
    default_size = getsizeof(0)  # estimate sizeof object without __sizeof__

    def sizeof(o):
        if id(o) in seen:  # do not double count the same object
            return 0
        seen.add(id(o))
        s = getsizeof(o, default_size)

        for typ, handler in all_handlers.items():
            if isinstance(o, typ):
                s += sum(map(sizeof, handler(o)))
                break
        return s

    return sizeof(o)


def count_cache_key_tuples(tup):
    """given a cache key tuple, counts how many instances of actual
    tuples are found.

    used to alert large jumps in cache key complexity.

    """
    stack = [tup]

    sentinel = object()
    num_elements = 0

    while stack:
        elem = stack.pop(0)
        if elem is sentinel:
            num_elements += 1
        elif isinstance(elem, tuple):
            if elem:
                stack = list(elem) + [sentinel] + stack
    return num_elements
