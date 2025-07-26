"""ArangoDb result store backend."""

# pylint: disable=W1202,W0703

from datetime import timedelta

from kombu.utils.objects import cached_property
from kombu.utils.url import _parse_url

from celery.exceptions import ImproperlyConfigured

from .base import KeyValueStoreBackend

try:
    from pyArango import connection as py_arango_connection
    from pyArango.theExceptions import AQLQueryError
except ImportError:
    py_arango_connection = AQLQueryError = None

__all__ = ('ArangoDbBackend',)


class ArangoDbBackend(KeyValueStoreBackend):
    """ArangoDb backend.

    Sample url
    "arangodb://username:password@host:port/database/collection"
    *arangodb_backend_settings* is where the settings are present
    (in the app.conf)
    Settings should contain the host, port, username, password, database name,
    collection name else the default will be chosen.
    Default database name and collection name is celery.

    Raises
    ------
    celery.exceptions.ImproperlyConfigured:
        if module :pypi:`pyArango` is not available.

    """

    host = '127.0.0.1'
    port = '8529'
    database = 'celery'
    collection = 'celery'
    username = None
    password = None
    # protocol is not supported in backend url (http is taken as default)
    http_protocol = 'http'
    verify = False

    # Use str as arangodb key not bytes
    key_t = str

    def __init__(self, url=None, *args, **kwargs):
        """Parse the url or load the settings from settings object."""
        super().__init__(*args, **kwargs)

        if py_arango_connection is None:
            raise ImproperlyConfigured(
                'You need to install the pyArango library to use the '
                'ArangoDb backend.',
            )

        self.url = url

        if url is None:
            host = port = database = collection = username = password = None
        else:
            (
                _schema, host, port, username, password,
                database_collection, _query
            ) = _parse_url(url)
            if database_collection is None:
                database = collection = None
            else:
                database, collection = database_collection.split('/')

        config = self.app.conf.get('arangodb_backend_settings', None)
        if config is not None:
            if not isinstance(config, dict):
                raise ImproperlyConfigured(
                    'ArangoDb backend settings should be grouped in a dict',
                )
        else:
            config = {}

        self.host = host or config.get('host', self.host)
        self.port = int(port or config.get('port', self.port))
        self.http_protocol = config.get('http_protocol', self.http_protocol)
        self.verify = config.get('verify', self.verify)
        self.database = database or config.get('database', self.database)
        self.collection = \
            collection or config.get('collection', self.collection)
        self.username = username or config.get('username', self.username)
        self.password = password or config.get('password', self.password)
        self.arangodb_url = "{http_protocol}://{host}:{port}".format(
            http_protocol=self.http_protocol, host=self.host, port=self.port
        )
        self._connection = None

    @property
    def connection(self):
        """Connect to the arangodb server."""
        if self._connection is None:
            self._connection = py_arango_connection.Connection(
                arangoURL=self.arangodb_url, username=self.username,
                password=self.password, verify=self.verify
            )
        return self._connection

    @property
    def db(self):
        """Database Object to the given database."""
        return self.connection[self.database]

    @cached_property
    def expires_delta(self):
        return timedelta(seconds=0 if self.expires is None else self.expires)

    def get(self, key):
        if key is None:
            return None
        query = self.db.AQLQuery(
            "RETURN DOCUMENT(@@collection, @key).task",
            rawResults=True,
            bindVars={
                "@collection": self.collection,
                "key": key,
            },
        )
        return next(query) if len(query) > 0 else None

    def set(self, key, value):
        self.db.AQLQuery(
            """
            UPSERT {_key: @key}
            INSERT {_key: @key, task: @value}
            UPDATE {task: @value} IN @@collection
            """,
            bindVars={
                "@collection": self.collection,
                "key": key,
                "value": value,
            },
        )

    def mget(self, keys):
        if keys is None:
            return
        query = self.db.AQLQuery(
            "FOR k IN @keys RETURN DOCUMENT(@@collection, k).task",
            rawResults=True,
            bindVars={
                "@collection": self.collection,
                "keys": keys if isinstance(keys, list) else list(keys),
            },
        )
        while True:
            yield from query
            try:
                query.nextBatch()
            except StopIteration:
                break

    def delete(self, key):
        if key is None:
            return
        self.db.AQLQuery(
            "REMOVE {_key: @key} IN @@collection",
            bindVars={
                "@collection": self.collection,
                "key": key,
            },
        )

    def cleanup(self):
        if not self.expires:
            return
        checkpoint = (self.app.now() - self.expires_delta).isoformat()
        self.db.AQLQuery(
            """
            FOR record IN @@collection
                FILTER record.task.date_done < @checkpoint
                REMOVE record IN @@collection
            """,
            bindVars={
                "@collection": self.collection,
                "checkpoint": checkpoint,
            },
        )
