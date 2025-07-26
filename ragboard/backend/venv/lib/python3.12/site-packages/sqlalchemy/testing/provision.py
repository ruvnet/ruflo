# testing/provision.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from __future__ import annotations

import collections
import logging

from . import config
from . import engines
from . import util
from .. import exc
from .. import inspect
from ..engine import url as sa_url
from ..sql import ddl
from ..sql import schema


log = logging.getLogger(__name__)

FOLLOWER_IDENT = None


class register:
    def __init__(self, decorator=None):
        self.fns = {}
        self.decorator = decorator

    @classmethod
    def init(cls, fn):
        return register().for_db("*")(fn)

    @classmethod
    def init_decorator(cls, decorator):
        return register(decorator).for_db("*")

    def for_db(self, *dbnames):
        def decorate(fn):
            if self.decorator:
                fn = self.decorator(fn)
            for dbname in dbnames:
                self.fns[dbname] = fn
            return self

        return decorate

    def __call__(self, cfg, *arg, **kw):
        if isinstance(cfg, str):
            url = sa_url.make_url(cfg)
        elif isinstance(cfg, sa_url.URL):
            url = cfg
        else:
            url = cfg.db.url
        backend = url.get_backend_name()
        if backend in self.fns:
            return self.fns[backend](cfg, *arg, **kw)
        else:
            return self.fns["*"](cfg, *arg, **kw)


def create_follower_db(follower_ident):
    for cfg in _configs_for_db_operation():
        log.info("CREATE database %s, URI %r", follower_ident, cfg.db.url)
        create_db(cfg, cfg.db, follower_ident)


def setup_config(db_url, options, file_config, follower_ident):
    # load the dialect, which should also have it set up its provision
    # hooks

    dialect = sa_url.make_url(db_url).get_dialect()

    dialect.load_provisioning()

    if follower_ident:
        db_url = follower_url_from_main(db_url, follower_ident)
    db_opts = {}
    update_db_opts(db_url, db_opts, options)
    db_opts["scope"] = "global"
    eng = engines.testing_engine(db_url, db_opts)
    post_configure_engine(db_url, eng, follower_ident)
    eng.connect().close()

    cfg = config.Config.register(eng, db_opts, options, file_config)

    # a symbolic name that tests can use if they need to disambiguate
    # names across databases
    if follower_ident:
        config.ident = follower_ident

    if follower_ident:
        configure_follower(cfg, follower_ident)
    return cfg


def drop_follower_db(follower_ident):
    for cfg in _configs_for_db_operation():
        log.info("DROP database %s, URI %r", follower_ident, cfg.db.url)
        drop_db(cfg, cfg.db, follower_ident)


def generate_db_urls(db_urls, extra_drivers):
    """Generate a set of URLs to test given configured URLs plus additional
    driver names.

    Given::

        --dburi postgresql://db1  \
        --dburi postgresql://db2  \
        --dburi postgresql://db2  \
        --dbdriver=psycopg2 --dbdriver=asyncpg?async_fallback=true

    Noting that the default postgresql driver is psycopg2,  the output
    would be::

        postgresql+psycopg2://db1
        postgresql+asyncpg://db1
        postgresql+psycopg2://db2
        postgresql+psycopg2://db3

    That is, for the driver in a --dburi, we want to keep that and use that
    driver for each URL it's part of .   For a driver that is only
    in --dbdrivers, we want to use it just once for one of the URLs.
    for a driver that is both coming from --dburi as well as --dbdrivers,
    we want to keep it in that dburi.

    Driver specific query options can be specified by added them to the
    driver name. For example, to enable the async fallback option for
    asyncpg::

        --dburi postgresql://db1  \
        --dbdriver=asyncpg?async_fallback=true

    """
    urls = set()

    backend_to_driver_we_already_have = collections.defaultdict(set)

    urls_plus_dialects = [
        (url_obj, url_obj.get_dialect())
        for url_obj in [sa_url.make_url(db_url) for db_url in db_urls]
    ]

    for url_obj, dialect in urls_plus_dialects:
        # use get_driver_name instead of dialect.driver to account for
        # "_async" virtual drivers like oracledb and psycopg
        driver_name = url_obj.get_driver_name()
        backend_to_driver_we_already_have[dialect.name].add(driver_name)

    backend_to_driver_we_need = {}

    for url_obj, dialect in urls_plus_dialects:
        backend = dialect.name
        dialect.load_provisioning()

        if backend not in backend_to_driver_we_need:
            backend_to_driver_we_need[backend] = extra_per_backend = set(
                extra_drivers
            ).difference(backend_to_driver_we_already_have[backend])
        else:
            extra_per_backend = backend_to_driver_we_need[backend]

        for driver_url in _generate_driver_urls(url_obj, extra_per_backend):
            if driver_url in urls:
                continue
            urls.add(driver_url)
            yield driver_url


def _generate_driver_urls(url, extra_drivers):
    main_driver = url.get_driver_name()
    extra_drivers.discard(main_driver)

    url = generate_driver_url(url, main_driver, "")
    yield url

    for drv in list(extra_drivers):
        if "?" in drv:
            driver_only, query_str = drv.split("?", 1)

        else:
            driver_only = drv
            query_str = None

        new_url = generate_driver_url(url, driver_only, query_str)
        if new_url:
            extra_drivers.remove(drv)

            yield new_url


@register.init
def generate_driver_url(url, driver, query_str):
    backend = url.get_backend_name()

    new_url = url.set(
        drivername="%s+%s" % (backend, driver),
    )
    if query_str:
        new_url = new_url.update_query_string(query_str)

    try:
        new_url.get_dialect()
    except exc.NoSuchModuleError:
        return None
    else:
        return new_url


def _configs_for_db_operation():
    hosts = set()

    for cfg in config.Config.all_configs():
        cfg.db.dispose()

    for cfg in config.Config.all_configs():
        url = cfg.db.url
        backend = url.get_backend_name()
        host_conf = (backend, url.username, url.host, url.database)

        if host_conf not in hosts:
            yield cfg
            hosts.add(host_conf)

    for cfg in config.Config.all_configs():
        cfg.db.dispose()


@register.init
def drop_all_schema_objects_pre_tables(cfg, eng):
    pass


@register.init
def drop_all_schema_objects_post_tables(cfg, eng):
    pass


def drop_all_schema_objects(cfg, eng):
    drop_all_schema_objects_pre_tables(cfg, eng)

    drop_views(cfg, eng)

    if config.requirements.materialized_views.enabled:
        drop_materialized_views(cfg, eng)

    inspector = inspect(eng)

    consider_schemas = (None,)
    if config.requirements.schemas.enabled_for_config(cfg):
        consider_schemas += (cfg.test_schema, cfg.test_schema_2)
    util.drop_all_tables(eng, inspector, consider_schemas=consider_schemas)

    drop_all_schema_objects_post_tables(cfg, eng)

    if config.requirements.sequences.enabled_for_config(cfg):
        with eng.begin() as conn:
            for seq in inspector.get_sequence_names():
                conn.execute(ddl.DropSequence(schema.Sequence(seq)))
            if config.requirements.schemas.enabled_for_config(cfg):
                for schema_name in [cfg.test_schema, cfg.test_schema_2]:
                    for seq in inspector.get_sequence_names(
                        schema=schema_name
                    ):
                        conn.execute(
                            ddl.DropSequence(
                                schema.Sequence(seq, schema=schema_name)
                            )
                        )


def drop_views(cfg, eng):
    inspector = inspect(eng)

    try:
        view_names = inspector.get_view_names()
    except NotImplementedError:
        pass
    else:
        with eng.begin() as conn:
            for vname in view_names:
                conn.execute(
                    ddl._DropView(schema.Table(vname, schema.MetaData()))
                )

    if config.requirements.schemas.enabled_for_config(cfg):
        try:
            view_names = inspector.get_view_names(schema=cfg.test_schema)
        except NotImplementedError:
            pass
        else:
            with eng.begin() as conn:
                for vname in view_names:
                    conn.execute(
                        ddl._DropView(
                            schema.Table(
                                vname,
                                schema.MetaData(),
                                schema=cfg.test_schema,
                            )
                        )
                    )


def drop_materialized_views(cfg, eng):
    inspector = inspect(eng)

    mview_names = inspector.get_materialized_view_names()

    with eng.begin() as conn:
        for vname in mview_names:
            conn.exec_driver_sql(f"DROP MATERIALIZED VIEW {vname}")

    if config.requirements.schemas.enabled_for_config(cfg):
        mview_names = inspector.get_materialized_view_names(
            schema=cfg.test_schema
        )
        with eng.begin() as conn:
            for vname in mview_names:
                conn.exec_driver_sql(
                    f"DROP MATERIALIZED VIEW {cfg.test_schema}.{vname}"
                )


@register.init
def create_db(cfg, eng, ident):
    """Dynamically create a database for testing.

    Used when a test run will employ multiple processes, e.g., when run
    via `tox` or `pytest -n4`.
    """
    raise NotImplementedError(
        "no DB creation routine for cfg: %s" % (eng.url,)
    )


@register.init
def drop_db(cfg, eng, ident):
    """Drop a database that we dynamically created for testing."""
    raise NotImplementedError("no DB drop routine for cfg: %s" % (eng.url,))


def _adapt_update_db_opts(fn):
    insp = util.inspect_getfullargspec(fn)
    if len(insp.args) == 3:
        return fn
    else:
        return lambda db_url, db_opts, _options: fn(db_url, db_opts)


@register.init_decorator(_adapt_update_db_opts)
def update_db_opts(db_url, db_opts, options):
    """Set database options (db_opts) for a test database that we created."""


@register.init
def post_configure_engine(url, engine, follower_ident):
    """Perform extra steps after configuring an engine for testing.

    (For the internal dialects, currently only used by sqlite, oracle)
    """


@register.init
def follower_url_from_main(url, ident):
    """Create a connection URL for a dynamically-created test database.

    :param url: the connection URL specified when the test run was invoked
    :param ident: the pytest-xdist "worker identifier" to be used as the
                  database name
    """
    url = sa_url.make_url(url)
    return url.set(database=ident)


@register.init
def configure_follower(cfg, ident):
    """Create dialect-specific config settings for a follower database."""
    pass


@register.init
def run_reap_dbs(url, ident):
    """Remove databases that were created during the test process, after the
    process has ended.

    This is an optional step that is invoked for certain backends that do not
    reliably release locks on the database as long as a process is still in
    use. For the internal dialects, this is currently only necessary for
    mssql and oracle.
    """


def reap_dbs(idents_file):
    log.info("Reaping databases...")

    urls = collections.defaultdict(set)
    idents = collections.defaultdict(set)
    dialects = {}

    with open(idents_file) as file_:
        for line in file_:
            line = line.strip()
            db_name, db_url = line.split(" ")
            url_obj = sa_url.make_url(db_url)
            if db_name not in dialects:
                dialects[db_name] = url_obj.get_dialect()
                dialects[db_name].load_provisioning()
            url_key = (url_obj.get_backend_name(), url_obj.host)
            urls[url_key].add(db_url)
            idents[url_key].add(db_name)

    for url_key in urls:
        url = list(urls[url_key])[0]
        ident = idents[url_key]
        run_reap_dbs(url, ident)


@register.init
def temp_table_keyword_args(cfg, eng):
    """Specify keyword arguments for creating a temporary Table.

    Dialect-specific implementations of this method will return the
    kwargs that are passed to the Table method when creating a temporary
    table for testing, e.g., in the define_temp_tables method of the
    ComponentReflectionTest class in suite/test_reflection.py
    """
    raise NotImplementedError(
        "no temp table keyword args routine for cfg: %s" % (eng.url,)
    )


@register.init
def prepare_for_drop_tables(config, connection):
    pass


@register.init
def stop_test_class_outside_fixtures(config, db, testcls):
    pass


@register.init
def get_temp_table_name(cfg, eng, base_name):
    """Specify table name for creating a temporary Table.

    Dialect-specific implementations of this method will return the
    name to use when creating a temporary table for testing,
    e.g., in the define_temp_tables method of the
    ComponentReflectionTest class in suite/test_reflection.py

    Default to just the base name since that's what most dialects will
    use. The mssql dialect's implementation will need a "#" prepended.
    """
    return base_name


@register.init
def set_default_schema_on_connection(cfg, dbapi_connection, schema_name):
    raise NotImplementedError(
        "backend does not implement a schema name set function: %s"
        % (cfg.db.url,)
    )


@register.init
def upsert(
    cfg, table, returning, *, set_lambda=None, sort_by_parameter_order=False
):
    """return the backends insert..on conflict / on dupe etc. construct.

    while we should add a backend-neutral upsert construct as well, such as
    insert().upsert(), it's important that we continue to test the
    backend-specific insert() constructs since if we do implement
    insert().upsert(), that would be using a different codepath for the things
    we need to test like insertmanyvalues, etc.

    """
    raise NotImplementedError(
        f"backend does not include an upsert implementation: {cfg.db.url}"
    )


@register.init
def normalize_sequence(cfg, sequence):
    """Normalize sequence parameters for dialect that don't start with 1
    by default.

    The default implementation does nothing
    """
    return sequence
