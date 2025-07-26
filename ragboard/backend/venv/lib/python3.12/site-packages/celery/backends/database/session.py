"""SQLAlchemy session."""
import time

from kombu.utils.compat import register_after_fork
from sqlalchemy import create_engine
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from celery.utils.time import get_exponential_backoff_interval

try:
    from sqlalchemy.orm import declarative_base
except ImportError:
    # TODO: Remove this once we drop support for SQLAlchemy < 1.4.
    from sqlalchemy.ext.declarative import declarative_base

ResultModelBase = declarative_base()

__all__ = ('SessionManager',)

PREPARE_MODELS_MAX_RETRIES = 10


def _after_fork_cleanup_session(session):
    session._after_fork()


class SessionManager:
    """Manage SQLAlchemy sessions."""

    def __init__(self):
        self._engines = {}
        self._sessions = {}
        self.forked = False
        self.prepared = False
        if register_after_fork is not None:
            register_after_fork(self, _after_fork_cleanup_session)

    def _after_fork(self):
        self.forked = True

    def get_engine(self, dburi, **kwargs):
        if self.forked:
            try:
                return self._engines[dburi]
            except KeyError:
                engine = self._engines[dburi] = create_engine(dburi, **kwargs)
                return engine
        else:
            kwargs = {k: v for k, v in kwargs.items() if
                      not k.startswith('pool')}
            return create_engine(dburi, poolclass=NullPool, **kwargs)

    def create_session(self, dburi, short_lived_sessions=False, **kwargs):
        engine = self.get_engine(dburi, **kwargs)
        if self.forked:
            if short_lived_sessions or dburi not in self._sessions:
                self._sessions[dburi] = sessionmaker(bind=engine)
            return engine, self._sessions[dburi]
        return engine, sessionmaker(bind=engine)

    def prepare_models(self, engine):
        if not self.prepared:
            # SQLAlchemy will check if the items exist before trying to
            # create them, which is a race condition. If it raises an error
            # in one iteration, the next may pass all the existence checks
            # and the call will succeed.
            retries = 0
            while True:
                try:
                    ResultModelBase.metadata.create_all(engine)
                except DatabaseError:
                    if retries < PREPARE_MODELS_MAX_RETRIES:
                        sleep_amount_ms = get_exponential_backoff_interval(
                            10, retries, 1000, True
                        )
                        time.sleep(sleep_amount_ms / 1000)
                        retries += 1
                    else:
                        raise
                else:
                    break
            self.prepared = True

    def session_factory(self, dburi, **kwargs):
        engine, session = self.create_session(dburi, **kwargs)
        self.prepare_models(engine)
        return session()
