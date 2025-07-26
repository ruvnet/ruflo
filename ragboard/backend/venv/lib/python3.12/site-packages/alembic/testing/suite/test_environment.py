import io

from ...migration import MigrationContext
from ...testing import assert_raises
from ...testing import config
from ...testing import eq_
from ...testing import is_
from ...testing import is_false
from ...testing import is_not_
from ...testing import is_true
from ...testing import ne_
from ...testing.fixtures import TestBase


class MigrationTransactionTest(TestBase):
    __backend__ = True

    conn = None

    def _fixture(self, opts):
        self.conn = conn = config.db.connect()

        if opts.get("as_sql", False):
            self.context = MigrationContext.configure(
                dialect=conn.dialect, opts=opts
            )
            self.context.output_buffer = (
                self.context.impl.output_buffer
            ) = io.StringIO()
        else:
            self.context = MigrationContext.configure(
                connection=conn, opts=opts
            )
        return self.context

    def teardown_method(self):
        if self.conn:
            self.conn.close()

    def test_proxy_transaction_rollback(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": True}
        )

        is_false(self.conn.in_transaction())
        proxy = context.begin_transaction(_per_migration=True)
        is_true(self.conn.in_transaction())
        proxy.rollback()
        is_false(self.conn.in_transaction())

    def test_proxy_transaction_commit(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": True}
        )
        proxy = context.begin_transaction(_per_migration=True)
        is_true(self.conn.in_transaction())
        proxy.commit()
        is_false(self.conn.in_transaction())

    def test_proxy_transaction_contextmanager_commit(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": True}
        )
        proxy = context.begin_transaction(_per_migration=True)
        is_true(self.conn.in_transaction())
        with proxy:
            pass
        is_false(self.conn.in_transaction())

    def test_proxy_transaction_contextmanager_rollback(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": True}
        )
        proxy = context.begin_transaction(_per_migration=True)
        is_true(self.conn.in_transaction())

        def go():
            with proxy:
                raise Exception("hi")

        assert_raises(Exception, go)
        is_false(self.conn.in_transaction())

    def test_proxy_transaction_contextmanager_explicit_rollback(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": True}
        )
        proxy = context.begin_transaction(_per_migration=True)
        is_true(self.conn.in_transaction())

        with proxy:
            is_true(self.conn.in_transaction())
            proxy.rollback()
            is_false(self.conn.in_transaction())

        is_false(self.conn.in_transaction())

    def test_proxy_transaction_contextmanager_explicit_commit(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": True}
        )
        proxy = context.begin_transaction(_per_migration=True)
        is_true(self.conn.in_transaction())

        with proxy:
            is_true(self.conn.in_transaction())
            proxy.commit()
            is_false(self.conn.in_transaction())

        is_false(self.conn.in_transaction())

    def test_transaction_per_migration_transactional_ddl(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": True}
        )

        is_false(self.conn.in_transaction())

        with context.begin_transaction():
            is_false(self.conn.in_transaction())
            with context.begin_transaction(_per_migration=True):
                is_true(self.conn.in_transaction())

            is_false(self.conn.in_transaction())
        is_false(self.conn.in_transaction())

    def test_transaction_per_migration_non_transactional_ddl(self):
        context = self._fixture(
            {"transaction_per_migration": True, "transactional_ddl": False}
        )

        is_false(self.conn.in_transaction())

        with context.begin_transaction():
            is_false(self.conn.in_transaction())
            with context.begin_transaction(_per_migration=True):
                is_true(self.conn.in_transaction())

            is_false(self.conn.in_transaction())
        is_false(self.conn.in_transaction())

    def test_transaction_per_all_transactional_ddl(self):
        context = self._fixture({"transactional_ddl": True})

        is_false(self.conn.in_transaction())

        with context.begin_transaction():
            is_true(self.conn.in_transaction())
            with context.begin_transaction(_per_migration=True):
                is_true(self.conn.in_transaction())

            is_true(self.conn.in_transaction())
        is_false(self.conn.in_transaction())

    def test_transaction_per_all_non_transactional_ddl(self):
        context = self._fixture({"transactional_ddl": False})

        is_false(self.conn.in_transaction())

        with context.begin_transaction():
            is_false(self.conn.in_transaction())
            with context.begin_transaction(_per_migration=True):
                is_true(self.conn.in_transaction())

            is_false(self.conn.in_transaction())
        is_false(self.conn.in_transaction())

    def test_transaction_per_all_sqlmode(self):
        context = self._fixture({"as_sql": True})

        context.execute("step 1")
        with context.begin_transaction():
            context.execute("step 2")
            with context.begin_transaction(_per_migration=True):
                context.execute("step 3")

            context.execute("step 4")
        context.execute("step 5")

        if context.impl.transactional_ddl:
            self._assert_impl_steps(
                "step 1",
                "BEGIN",
                "step 2",
                "step 3",
                "step 4",
                "COMMIT",
                "step 5",
            )
        else:
            self._assert_impl_steps(
                "step 1", "step 2", "step 3", "step 4", "step 5"
            )

    def test_transaction_per_migration_sqlmode(self):
        context = self._fixture(
            {"as_sql": True, "transaction_per_migration": True}
        )

        context.execute("step 1")
        with context.begin_transaction():
            context.execute("step 2")
            with context.begin_transaction(_per_migration=True):
                context.execute("step 3")

            context.execute("step 4")
        context.execute("step 5")

        if context.impl.transactional_ddl:
            self._assert_impl_steps(
                "step 1",
                "step 2",
                "BEGIN",
                "step 3",
                "COMMIT",
                "step 4",
                "step 5",
            )
        else:
            self._assert_impl_steps(
                "step 1", "step 2", "step 3", "step 4", "step 5"
            )

    @config.requirements.autocommit_isolation
    def test_autocommit_block(self):
        context = self._fixture({"transaction_per_migration": True})

        is_false(self.conn.in_transaction())

        with context.begin_transaction():
            is_false(self.conn.in_transaction())
            with context.begin_transaction(_per_migration=True):
                is_true(self.conn.in_transaction())

                with context.autocommit_block():
                    # in 1.x, self.conn is separate due to the
                    # execution_options call.  however for future they are the
                    # same connection and there is a "transaction" block
                    # despite autocommit
                    if self.is_sqlalchemy_future:
                        is_(context.connection, self.conn)
                    else:
                        is_not_(context.connection, self.conn)
                        is_false(self.conn.in_transaction())

                    eq_(
                        context.connection._execution_options[
                            "isolation_level"
                        ],
                        "AUTOCOMMIT",
                    )

                ne_(
                    context.connection._execution_options.get(
                        "isolation_level", None
                    ),
                    "AUTOCOMMIT",
                )
                is_true(self.conn.in_transaction())

            is_false(self.conn.in_transaction())
        is_false(self.conn.in_transaction())

    @config.requirements.autocommit_isolation
    def test_autocommit_block_no_transaction(self):
        context = self._fixture({"transaction_per_migration": True})

        is_false(self.conn.in_transaction())

        with context.autocommit_block():
            is_true(context.connection.in_transaction())

            # in 1.x, self.conn is separate due to the execution_options
            # call.  however for future they are the same connection and there
            # is a "transaction" block despite autocommit
            if self.is_sqlalchemy_future:
                is_(context.connection, self.conn)
            else:
                is_not_(context.connection, self.conn)
                is_false(self.conn.in_transaction())

            eq_(
                context.connection._execution_options["isolation_level"],
                "AUTOCOMMIT",
            )

        ne_(
            context.connection._execution_options.get("isolation_level", None),
            "AUTOCOMMIT",
        )

        is_false(self.conn.in_transaction())

    def test_autocommit_block_transactional_ddl_sqlmode(self):
        context = self._fixture(
            {
                "transaction_per_migration": True,
                "transactional_ddl": True,
                "as_sql": True,
            }
        )

        with context.begin_transaction():
            context.execute("step 1")
            with context.begin_transaction(_per_migration=True):
                context.execute("step 2")

                with context.autocommit_block():
                    context.execute("step 3")

                context.execute("step 4")

            context.execute("step 5")

        self._assert_impl_steps(
            "step 1",
            "BEGIN",
            "step 2",
            "COMMIT",
            "step 3",
            "BEGIN",
            "step 4",
            "COMMIT",
            "step 5",
        )

    def test_autocommit_block_nontransactional_ddl_sqlmode(self):
        context = self._fixture(
            {
                "transaction_per_migration": True,
                "transactional_ddl": False,
                "as_sql": True,
            }
        )

        with context.begin_transaction():
            context.execute("step 1")
            with context.begin_transaction(_per_migration=True):
                context.execute("step 2")

                with context.autocommit_block():
                    context.execute("step 3")

                context.execute("step 4")

            context.execute("step 5")

        self._assert_impl_steps(
            "step 1", "step 2", "step 3", "step 4", "step 5"
        )

    def _assert_impl_steps(self, *steps):
        to_check = self.context.output_buffer.getvalue()

        self.context.impl.output_buffer = buf = io.StringIO()
        for step in steps:
            if step == "BEGIN":
                self.context.impl.emit_begin()
            elif step == "COMMIT":
                self.context.impl.emit_commit()
            else:
                self.context.impl._exec(step)

        eq_(to_check, buf.getvalue())
