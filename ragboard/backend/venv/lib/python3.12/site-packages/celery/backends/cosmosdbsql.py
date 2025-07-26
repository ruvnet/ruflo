"""The CosmosDB/SQL backend for Celery (experimental)."""
from kombu.utils import cached_property
from kombu.utils.encoding import bytes_to_str
from kombu.utils.url import _parse_url

from celery.exceptions import ImproperlyConfigured
from celery.utils.log import get_logger

from .base import KeyValueStoreBackend

try:
    import pydocumentdb
    from pydocumentdb.document_client import DocumentClient
    from pydocumentdb.documents import ConnectionPolicy, ConsistencyLevel, PartitionKind
    from pydocumentdb.errors import HTTPFailure
    from pydocumentdb.retry_options import RetryOptions
except ImportError:
    pydocumentdb = DocumentClient = ConsistencyLevel = PartitionKind = \
        HTTPFailure = ConnectionPolicy = RetryOptions = None

__all__ = ("CosmosDBSQLBackend",)


ERROR_NOT_FOUND = 404
ERROR_EXISTS = 409

LOGGER = get_logger(__name__)


class CosmosDBSQLBackend(KeyValueStoreBackend):
    """CosmosDB/SQL backend for Celery."""

    def __init__(self,
                 url=None,
                 database_name=None,
                 collection_name=None,
                 consistency_level=None,
                 max_retry_attempts=None,
                 max_retry_wait_time=None,
                 *args,
                 **kwargs):
        super().__init__(*args, **kwargs)

        if pydocumentdb is None:
            raise ImproperlyConfigured(
                "You need to install the pydocumentdb library to use the "
                "CosmosDB backend.")

        conf = self.app.conf

        self._endpoint, self._key = self._parse_url(url)

        self._database_name = (
            database_name or
            conf["cosmosdbsql_database_name"])

        self._collection_name = (
            collection_name or
            conf["cosmosdbsql_collection_name"])

        try:
            self._consistency_level = getattr(
                ConsistencyLevel,
                consistency_level or
                conf["cosmosdbsql_consistency_level"])
        except AttributeError:
            raise ImproperlyConfigured("Unknown CosmosDB consistency level")

        self._max_retry_attempts = (
            max_retry_attempts or
            conf["cosmosdbsql_max_retry_attempts"])

        self._max_retry_wait_time = (
            max_retry_wait_time or
            conf["cosmosdbsql_max_retry_wait_time"])

    @classmethod
    def _parse_url(cls, url):
        _, host, port, _, password, _, _ = _parse_url(url)

        if not host or not password:
            raise ImproperlyConfigured("Invalid URL")

        if not port:
            port = 443

        scheme = "https" if port == 443 else "http"
        endpoint = f"{scheme}://{host}:{port}"
        return endpoint, password

    @cached_property
    def _client(self):
        """Return the CosmosDB/SQL client.

        If this is the first call to the property, the client is created and
        the database and collection are initialized if they don't yet exist.

        """
        connection_policy = ConnectionPolicy()
        connection_policy.RetryOptions = RetryOptions(
            max_retry_attempt_count=self._max_retry_attempts,
            max_wait_time_in_seconds=self._max_retry_wait_time)

        client = DocumentClient(
            self._endpoint,
            {"masterKey": self._key},
            connection_policy=connection_policy,
            consistency_level=self._consistency_level)

        self._create_database_if_not_exists(client)
        self._create_collection_if_not_exists(client)

        return client

    def _create_database_if_not_exists(self, client):
        try:
            client.CreateDatabase({"id": self._database_name})
        except HTTPFailure as ex:
            if ex.status_code != ERROR_EXISTS:
                raise
        else:
            LOGGER.info("Created CosmosDB database %s",
                        self._database_name)

    def _create_collection_if_not_exists(self, client):
        try:
            client.CreateCollection(
                self._database_link,
                {"id": self._collection_name,
                 "partitionKey": {"paths": ["/id"],
                                  "kind": PartitionKind.Hash}})
        except HTTPFailure as ex:
            if ex.status_code != ERROR_EXISTS:
                raise
        else:
            LOGGER.info("Created CosmosDB collection %s/%s",
                        self._database_name, self._collection_name)

    @cached_property
    def _database_link(self):
        return "dbs/" + self._database_name

    @cached_property
    def _collection_link(self):
        return self._database_link + "/colls/" + self._collection_name

    def _get_document_link(self, key):
        return self._collection_link + "/docs/" + key

    @classmethod
    def _get_partition_key(cls, key):
        if not key or key.isspace():
            raise ValueError("Key cannot be none, empty or whitespace.")

        return {"partitionKey": key}

    def get(self, key):
        """Read the value stored at the given key.

        Args:
              key: The key for which to read the value.

        """
        key = bytes_to_str(key)
        LOGGER.debug("Getting CosmosDB document %s/%s/%s",
                     self._database_name, self._collection_name, key)

        try:
            document = self._client.ReadDocument(
                self._get_document_link(key),
                self._get_partition_key(key))
        except HTTPFailure as ex:
            if ex.status_code != ERROR_NOT_FOUND:
                raise
            return None
        else:
            return document.get("value")

    def set(self, key, value):
        """Store a value for a given key.

        Args:
              key: The key at which to store the value.
              value: The value to store.

        """
        key = bytes_to_str(key)
        LOGGER.debug("Creating CosmosDB document %s/%s/%s",
                     self._database_name, self._collection_name, key)

        self._client.CreateDocument(
            self._collection_link,
            {"id": key, "value": value},
            self._get_partition_key(key))

    def mget(self, keys):
        """Read all the values for the provided keys.

        Args:
              keys: The list of keys to read.

        """
        return [self.get(key) for key in keys]

    def delete(self, key):
        """Delete the value at a given key.

        Args:
              key: The key of the value to delete.

        """
        key = bytes_to_str(key)
        LOGGER.debug("Deleting CosmosDB document %s/%s/%s",
                     self._database_name, self._collection_name, key)

        self._client.DeleteDocument(
            self._get_document_link(key),
            self._get_partition_key(key))
