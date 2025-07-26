# testing/fixtures/base.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


from __future__ import annotations

import sqlalchemy as sa
from .. import assertions
from .. import config
from ..assertions import eq_
from ..util import drop_all_tables_from_metadata
from ... import Column
from ... import func
from ... import Integer
from ... import select
from ... import Table
from ...orm import DeclarativeBase
from ...orm import MappedAsDataclass
from ...orm import registry


@config.mark_base_test_class()
class TestBase:
    # A sequence of requirement names matching testing.requires decorators
    __requires__ = ()

    # A sequence of dialect names to exclude from the test class.
    __unsupported_on__ = ()

    # If present, test class is only runnable for the *single* specified
    # dialect.  If you need multiple, use __unsupported_on__ and invert.
    __only_on__ = None

    # A sequence of no-arg callables. If any are True, the entire testcase is
    # skipped.
    __skip_if__ = None

    # if True, the testing reaper will not attempt to touch connection
    # state after a test is completed and before the outer teardown
    # starts
    __leave_connections_for_teardown__ = False

    def assert_(self, val, msg=None):
        assert val, msg

    @config.fixture()
    def nocache(self):
        _cache = config.db._compiled_cache
        config.db._compiled_cache = None
        yield
        config.db._compiled_cache = _cache

    @config.fixture()
    def connection_no_trans(self):
        eng = getattr(self, "bind", None) or config.db

        with eng.connect() as conn:
            yield conn

    @config.fixture()
    def connection(self):
        global _connection_fixture_connection

        eng = getattr(self, "bind", None) or config.db

        conn = eng.connect()
        trans = conn.begin()

        _connection_fixture_connection = conn
        yield conn

        _connection_fixture_connection = None

        if trans.is_active:
            trans.rollback()
        # trans would not be active here if the test is using
        # the legacy @provide_metadata decorator still, as it will
        # run a close all connections.
        conn.close()

    @config.fixture()
    def close_result_when_finished(self):
        to_close = []
        to_consume = []

        def go(result, consume=False):
            to_close.append(result)
            if consume:
                to_consume.append(result)

        yield go
        for r in to_consume:
            try:
                r.all()
            except:
                pass
        for r in to_close:
            try:
                r.close()
            except:
                pass

    @config.fixture()
    def registry(self, metadata):
        reg = registry(
            metadata=metadata,
            type_annotation_map={
                str: sa.String().with_variant(
                    sa.String(50), "mysql", "mariadb", "oracle"
                )
            },
        )
        yield reg
        reg.dispose()

    @config.fixture
    def decl_base(self, metadata):
        _md = metadata

        class Base(DeclarativeBase):
            metadata = _md
            type_annotation_map = {
                str: sa.String().with_variant(
                    sa.String(50), "mysql", "mariadb", "oracle"
                )
            }

        yield Base
        Base.registry.dispose()

    @config.fixture
    def dc_decl_base(self, metadata):
        _md = metadata

        class Base(MappedAsDataclass, DeclarativeBase):
            metadata = _md
            type_annotation_map = {
                str: sa.String().with_variant(
                    sa.String(50), "mysql", "mariadb"
                )
            }

        yield Base
        Base.registry.dispose()

    @config.fixture()
    def future_connection(self, future_engine, connection):
        # integrate the future_engine and connection fixtures so
        # that users of the "connection" fixture will get at the
        # "future" connection
        yield connection

    @config.fixture()
    def future_engine(self):
        yield

    @config.fixture()
    def testing_engine(self):
        from .. import engines

        def gen_testing_engine(
            url=None,
            options=None,
            future=None,
            asyncio=False,
            transfer_staticpool=False,
            share_pool=False,
        ):
            if options is None:
                options = {}
            options["scope"] = "fixture"
            return engines.testing_engine(
                url=url,
                options=options,
                asyncio=asyncio,
                transfer_staticpool=transfer_staticpool,
                share_pool=share_pool,
            )

        yield gen_testing_engine

        engines.testing_reaper._drop_testing_engines("fixture")

    @config.fixture()
    def async_testing_engine(self, testing_engine):
        def go(**kw):
            kw["asyncio"] = True
            return testing_engine(**kw)

        return go

    @config.fixture()
    def metadata(self, request):
        """Provide bound MetaData for a single test, dropping afterwards."""

        from ...sql import schema

        metadata = schema.MetaData()
        request.instance.metadata = metadata
        yield metadata
        del request.instance.metadata

        if (
            _connection_fixture_connection
            and _connection_fixture_connection.in_transaction()
        ):
            trans = _connection_fixture_connection.get_transaction()
            trans.rollback()
            with _connection_fixture_connection.begin():
                drop_all_tables_from_metadata(
                    metadata, _connection_fixture_connection
                )
        else:
            drop_all_tables_from_metadata(metadata, config.db)

    @config.fixture(
        params=[
            (rollback, second_operation, begin_nested)
            for rollback in (True, False)
            for second_operation in ("none", "execute", "begin")
            for begin_nested in (
                True,
                False,
            )
        ]
    )
    def trans_ctx_manager_fixture(self, request, metadata):
        rollback, second_operation, begin_nested = request.param

        t = Table("test", metadata, Column("data", Integer))
        eng = getattr(self, "bind", None) or config.db

        t.create(eng)

        def run_test(subject, trans_on_subject, execute_on_subject):
            with subject.begin() as trans:
                if begin_nested:
                    if not config.requirements.savepoints.enabled:
                        config.skip_test("savepoints not enabled")
                    if execute_on_subject:
                        nested_trans = subject.begin_nested()
                    else:
                        nested_trans = trans.begin_nested()

                    with nested_trans:
                        if execute_on_subject:
                            subject.execute(t.insert(), {"data": 10})
                        else:
                            trans.execute(t.insert(), {"data": 10})

                        # for nested trans, we always commit/rollback on the
                        # "nested trans" object itself.
                        # only Session(future=False) will affect savepoint
                        # transaction for session.commit/rollback

                        if rollback:
                            nested_trans.rollback()
                        else:
                            nested_trans.commit()

                        if second_operation != "none":
                            with assertions.expect_raises_message(
                                sa.exc.InvalidRequestError,
                                "Can't operate on closed transaction "
                                "inside context "
                                "manager.  Please complete the context "
                                "manager "
                                "before emitting further commands.",
                            ):
                                if second_operation == "execute":
                                    if execute_on_subject:
                                        subject.execute(
                                            t.insert(), {"data": 12}
                                        )
                                    else:
                                        trans.execute(t.insert(), {"data": 12})
                                elif second_operation == "begin":
                                    if execute_on_subject:
                                        subject.begin_nested()
                                    else:
                                        trans.begin_nested()

                    # outside the nested trans block, but still inside the
                    # transaction block, we can run SQL, and it will be
                    # committed
                    if execute_on_subject:
                        subject.execute(t.insert(), {"data": 14})
                    else:
                        trans.execute(t.insert(), {"data": 14})

                else:
                    if execute_on_subject:
                        subject.execute(t.insert(), {"data": 10})
                    else:
                        trans.execute(t.insert(), {"data": 10})

                    if trans_on_subject:
                        if rollback:
                            subject.rollback()
                        else:
                            subject.commit()
                    else:
                        if rollback:
                            trans.rollback()
                        else:
                            trans.commit()

                    if second_operation != "none":
                        with assertions.expect_raises_message(
                            sa.exc.InvalidRequestError,
                            "Can't operate on closed transaction inside "
                            "context "
                            "manager.  Please complete the context manager "
                            "before emitting further commands.",
                        ):
                            if second_operation == "execute":
                                if execute_on_subject:
                                    subject.execute(t.insert(), {"data": 12})
                                else:
                                    trans.execute(t.insert(), {"data": 12})
                            elif second_operation == "begin":
                                if hasattr(trans, "begin"):
                                    trans.begin()
                                else:
                                    subject.begin()
                            elif second_operation == "begin_nested":
                                if execute_on_subject:
                                    subject.begin_nested()
                                else:
                                    trans.begin_nested()

            expected_committed = 0
            if begin_nested:
                # begin_nested variant, we inserted a row after the nested
                # block
                expected_committed += 1
            if not rollback:
                # not rollback variant, our row inserted in the target
                # block itself would be committed
                expected_committed += 1

            if execute_on_subject:
                eq_(
                    subject.scalar(select(func.count()).select_from(t)),
                    expected_committed,
                )
            else:
                with subject.connect() as conn:
                    eq_(
                        conn.scalar(select(func.count()).select_from(t)),
                        expected_committed,
                    )

        return run_test


_connection_fixture_connection = None


class FutureEngineMixin:
    """alembic's suite still using this"""
