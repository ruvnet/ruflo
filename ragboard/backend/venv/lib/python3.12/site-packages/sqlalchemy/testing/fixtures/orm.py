# testing/fixtures/orm.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from .base import TestBase
from .sql import TablesTest
from .. import assertions
from .. import config
from .. import schema
from ..entities import BasicEntity
from ..entities import ComparableEntity
from ..util import adict
from ... import orm
from ...orm import DeclarativeBase
from ...orm import events as orm_events
from ...orm import registry


class ORMTest(TestBase):
    @config.fixture
    def fixture_session(self):
        return fixture_session()


class MappedTest(ORMTest, TablesTest, assertions.AssertsExecutionResults):
    # 'once', 'each', None
    run_setup_classes = "once"

    # 'once', 'each', None
    run_setup_mappers = "each"

    classes: Any = None

    @config.fixture(autouse=True, scope="class")
    def _setup_tables_test_class(self):
        cls = self.__class__
        cls._init_class()

        if cls.classes is None:
            cls.classes = adict()

        cls._setup_once_tables()
        cls._setup_once_classes()
        cls._setup_once_mappers()
        cls._setup_once_inserts()

        yield

        cls._teardown_once_class()
        cls._teardown_once_metadata_bind()

    @config.fixture(autouse=True, scope="function")
    def _setup_tables_test_instance(self):
        self._setup_each_tables()
        self._setup_each_classes()
        self._setup_each_mappers()
        self._setup_each_inserts()

        yield

        orm.session.close_all_sessions()
        self._teardown_each_mappers()
        self._teardown_each_classes()
        self._teardown_each_tables()

    @classmethod
    def _teardown_once_class(cls):
        cls.classes.clear()

    @classmethod
    def _setup_once_classes(cls):
        if cls.run_setup_classes == "once":
            cls._with_register_classes(cls.setup_classes)

    @classmethod
    def _setup_once_mappers(cls):
        if cls.run_setup_mappers == "once":
            cls.mapper_registry, cls.mapper = cls._generate_registry()
            cls._with_register_classes(cls.setup_mappers)

    def _setup_each_mappers(self):
        if self.run_setup_mappers != "once":
            (
                self.__class__.mapper_registry,
                self.__class__.mapper,
            ) = self._generate_registry()

        if self.run_setup_mappers == "each":
            self._with_register_classes(self.setup_mappers)

    def _setup_each_classes(self):
        if self.run_setup_classes == "each":
            self._with_register_classes(self.setup_classes)

    @classmethod
    def _generate_registry(cls):
        decl = registry(metadata=cls._tables_metadata)
        return decl, decl.map_imperatively

    @classmethod
    def _with_register_classes(cls, fn):
        """Run a setup method, framing the operation with a Base class
        that will catch new subclasses to be established within
        the "classes" registry.

        """
        cls_registry = cls.classes

        class _Base:
            def __init_subclass__(cls) -> None:
                assert cls_registry is not None
                cls_registry[cls.__name__] = cls
                super().__init_subclass__()

        class Basic(BasicEntity, _Base):
            pass

        class Comparable(ComparableEntity, _Base):
            pass

        cls.Basic = Basic
        cls.Comparable = Comparable
        fn()

    def _teardown_each_mappers(self):
        # some tests create mappers in the test bodies
        # and will define setup_mappers as None -
        # clear mappers in any case
        if self.run_setup_mappers != "once":
            orm.clear_mappers()

    def _teardown_each_classes(self):
        if self.run_setup_classes != "once":
            self.classes.clear()

    @classmethod
    def setup_classes(cls):
        pass

    @classmethod
    def setup_mappers(cls):
        pass


class DeclarativeMappedTest(MappedTest):
    run_setup_classes = "once"
    run_setup_mappers = "once"

    @classmethod
    def _setup_once_tables(cls):
        pass

    @classmethod
    def _with_register_classes(cls, fn):
        cls_registry = cls.classes

        class _DeclBase(DeclarativeBase):
            __table_cls__ = schema.Table
            metadata = cls._tables_metadata
            type_annotation_map = {
                str: sa.String().with_variant(
                    sa.String(50), "mysql", "mariadb", "oracle"
                )
            }

            def __init_subclass__(cls, **kw) -> None:
                assert cls_registry is not None
                cls_registry[cls.__name__] = cls
                super().__init_subclass__(**kw)

        cls.DeclarativeBasic = _DeclBase

        # sets up cls.Basic which is helpful for things like composite
        # classes
        super()._with_register_classes(fn)

        if cls._tables_metadata.tables and cls.run_create_tables:
            cls._tables_metadata.create_all(config.db)


class RemoveORMEventsGlobally:
    @config.fixture(autouse=True)
    def _remove_listeners(self):
        yield
        orm_events.MapperEvents._clear()
        orm_events.InstanceEvents._clear()
        orm_events.SessionEvents._clear()
        orm_events.InstrumentationEvents._clear()
        orm_events.QueryEvents._clear()


_fixture_sessions = set()


def fixture_session(**kw):
    kw.setdefault("autoflush", True)
    kw.setdefault("expire_on_commit", True)

    bind = kw.pop("bind", config.db)

    sess = orm.Session(bind, **kw)
    _fixture_sessions.add(sess)
    return sess


def close_all_sessions():
    # will close all still-referenced sessions
    orm.close_all_sessions()
    _fixture_sessions.clear()


def stop_test_class_inside_fixtures(cls):
    close_all_sessions()
    orm.clear_mappers()


def after_test():
    if _fixture_sessions:
        close_all_sessions()
