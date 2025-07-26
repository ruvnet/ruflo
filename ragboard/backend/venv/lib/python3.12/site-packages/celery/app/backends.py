"""Backend selection."""
import sys
import types

from celery._state import current_app
from celery.exceptions import ImproperlyConfigured, reraise
from celery.utils.imports import load_extension_class_names, symbol_by_name

__all__ = ('by_name', 'by_url')

UNKNOWN_BACKEND = """
Unknown result backend: {0!r}.  Did you spell that correctly? ({1!r})
"""

BACKEND_ALIASES = {
    'rpc': 'celery.backends.rpc.RPCBackend',
    'cache': 'celery.backends.cache:CacheBackend',
    'redis': 'celery.backends.redis:RedisBackend',
    'rediss': 'celery.backends.redis:RedisBackend',
    'sentinel': 'celery.backends.redis:SentinelBackend',
    'mongodb': 'celery.backends.mongodb:MongoBackend',
    'db': 'celery.backends.database:DatabaseBackend',
    'database': 'celery.backends.database:DatabaseBackend',
    'elasticsearch': 'celery.backends.elasticsearch:ElasticsearchBackend',
    'cassandra': 'celery.backends.cassandra:CassandraBackend',
    'couchbase': 'celery.backends.couchbase:CouchbaseBackend',
    'couchdb': 'celery.backends.couchdb:CouchBackend',
    'cosmosdbsql': 'celery.backends.cosmosdbsql:CosmosDBSQLBackend',
    'riak': 'celery.backends.riak:RiakBackend',
    'file': 'celery.backends.filesystem:FilesystemBackend',
    'disabled': 'celery.backends.base:DisabledBackend',
    'consul': 'celery.backends.consul:ConsulBackend',
    'dynamodb': 'celery.backends.dynamodb:DynamoDBBackend',
    'azureblockblob': 'celery.backends.azureblockblob:AzureBlockBlobBackend',
    'arangodb': 'celery.backends.arangodb:ArangoDbBackend',
    's3': 'celery.backends.s3:S3Backend',
}


def by_name(backend=None, loader=None,
            extension_namespace='celery.result_backends'):
    """Get backend class by name/alias."""
    backend = backend or 'disabled'
    loader = loader or current_app.loader
    aliases = dict(BACKEND_ALIASES, **loader.override_backends)
    aliases.update(load_extension_class_names(extension_namespace))
    try:
        cls = symbol_by_name(backend, aliases)
    except ValueError as exc:
        reraise(ImproperlyConfigured, ImproperlyConfigured(
            UNKNOWN_BACKEND.strip().format(backend, exc)), sys.exc_info()[2])
    if isinstance(cls, types.ModuleType):
        raise ImproperlyConfigured(UNKNOWN_BACKEND.strip().format(
            backend, 'is a Python module, not a backend class.'))
    return cls


def by_url(backend=None, loader=None):
    """Get backend class by URL."""
    url = None
    if backend and '://' in backend:
        url = backend
        scheme, _, _ = url.partition('://')
        if '+' in scheme:
            backend, url = url.split('+', 1)
        else:
            backend = scheme
    return by_name(backend, loader), url
