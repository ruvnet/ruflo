"""Kombu transport using SQLAlchemy as the message store."""

from __future__ import annotations

import datetime

from sqlalchemy import (Boolean, Column, DateTime, ForeignKey, Index, Integer,
                        Sequence, SmallInteger, String, Text)
from sqlalchemy.orm import relationship
from sqlalchemy.schema import MetaData

try:
    from sqlalchemy.orm import declarative_base, declared_attr
except ImportError:
    # TODO: Remove this once we drop support for SQLAlchemy < 1.4.
    from sqlalchemy.ext.declarative import declarative_base, declared_attr

class_registry = {}
metadata = MetaData()
ModelBase = declarative_base(metadata=metadata, class_registry=class_registry)


class Queue:
    """The queue class."""

    __table_args__ = {'sqlite_autoincrement': True, 'mysql_engine': 'InnoDB'}

    id = Column(Integer, Sequence('queue_id_sequence'), primary_key=True,
                autoincrement=True)
    name = Column(String(200), unique=True)

    def __init__(self, name):
        self.name = name

    def __str__(self):
        return f'<Queue({self.name})>'

    @declared_attr
    def messages(cls):
        return relationship('Message', backref='queue', lazy='noload')


class Message:
    """The message class."""

    __table_args__ = (
        Index('ix_kombu_message_timestamp_id', 'timestamp', 'id'),
        {'sqlite_autoincrement': True, 'mysql_engine': 'InnoDB'}
    )

    id = Column(Integer, Sequence('message_id_sequence'),
                primary_key=True, autoincrement=True)
    visible = Column(Boolean, default=True, index=True)
    sent_at = Column('timestamp', DateTime, nullable=True, index=True,
                     onupdate=datetime.datetime.now)
    payload = Column(Text, nullable=False)
    version = Column(SmallInteger, nullable=False, default=1)

    __mapper_args__ = {'version_id_col': version}

    def __init__(self, payload, queue):
        self.payload = payload
        self.queue = queue

    def __str__(self):
        return '<Message: {0.sent_at} {0.payload} {0.queue_id}>'.format(self)

    @declared_attr
    def queue_id(self):
        return Column(
            Integer,
            ForeignKey(
                '%s.id' % class_registry['Queue'].__tablename__,
                name='FK_kombu_message_queue'
            )
        )
