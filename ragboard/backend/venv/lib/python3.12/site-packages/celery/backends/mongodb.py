"""MongoDB result store backend."""
from datetime import datetime, timedelta

from kombu.exceptions import EncodeError
from kombu.utils.objects import cached_property
from kombu.utils.url import maybe_sanitize_url, urlparse

from celery import states
from celery.exceptions import ImproperlyConfigured

from .base import BaseBackend

try:
    import pymongo
except ImportError:
    pymongo = None

if pymongo:
    try:
        from bson.binary import Binary
    except ImportError:
        from pymongo.binary import Binary
    from pymongo.errors import InvalidDocument
else:                                       # pragma: no cover
    Binary = None

    class InvalidDocument(Exception):
        pass

__all__ = ('MongoBackend',)

BINARY_CODECS = frozenset(['pickle', 'msgpack'])


class MongoBackend(BaseBackend):
    """MongoDB result backend.

    Raises:
        celery.exceptions.ImproperlyConfigured:
            if module :pypi:`pymongo` is not available.
    """

    mongo_host = None
    host = 'localhost'
    port = 27017
    user = None
    password = None
    database_name = 'celery'
    taskmeta_collection = 'celery_taskmeta'
    groupmeta_collection = 'celery_groupmeta'
    max_pool_size = 10
    options = None

    supports_autoexpire = False

    _connection = None

    def __init__(self, app=None, **kwargs):
        self.options = {}

        super().__init__(app, **kwargs)

        if not pymongo:
            raise ImproperlyConfigured(
                'You need to install the pymongo library to use the '
                'MongoDB backend.')

        # Set option defaults
        for key, value in self._prepare_client_options().items():
            self.options.setdefault(key, value)

        # update conf with mongo uri data, only if uri was given
        if self.url:
            self.url = self._ensure_mongodb_uri_compliance(self.url)

            uri_data = pymongo.uri_parser.parse_uri(self.url)
            # build the hosts list to create a mongo connection
            hostslist = [
                f'{x[0]}:{x[1]}' for x in uri_data['nodelist']
            ]
            self.user = uri_data['username']
            self.password = uri_data['password']
            self.mongo_host = hostslist
            if uri_data['database']:
                # if no database is provided in the uri, use default
                self.database_name = uri_data['database']

            self.options.update(uri_data['options'])

        # update conf with specific settings
        config = self.app.conf.get('mongodb_backend_settings')
        if config is not None:
            if not isinstance(config, dict):
                raise ImproperlyConfigured(
                    'MongoDB backend settings should be grouped in a dict')
            config = dict(config)  # don't modify original

            if 'host' in config or 'port' in config:
                # these should take over uri conf
                self.mongo_host = None

            self.host = config.pop('host', self.host)
            self.port = config.pop('port', self.port)
            self.mongo_host = config.pop('mongo_host', self.mongo_host)
            self.user = config.pop('user', self.user)
            self.password = config.pop('password', self.password)
            self.database_name = config.pop('database', self.database_name)
            self.taskmeta_collection = config.pop(
                'taskmeta_collection', self.taskmeta_collection,
            )
            self.groupmeta_collection = config.pop(
                'groupmeta_collection', self.groupmeta_collection,
            )

            self.options.update(config.pop('options', {}))
            self.options.update(config)

    @staticmethod
    def _ensure_mongodb_uri_compliance(url):
        parsed_url = urlparse(url)
        if not parsed_url.scheme.startswith('mongodb'):
            url = f'mongodb+{url}'

        if url == 'mongodb://':
            url += 'localhost'

        return url

    def _prepare_client_options(self):
        if pymongo.version_tuple >= (3,):
            return {'maxPoolSize': self.max_pool_size}
        else:  # pragma: no cover
            return {'max_pool_size': self.max_pool_size,
                    'auto_start_request': False}

    def _get_connection(self):
        """Connect to the MongoDB server."""
        if self._connection is None:
            from pymongo import MongoClient

            host = self.mongo_host
            if not host:
                # The first pymongo.Connection() argument (host) can be
                # a list of ['host:port'] elements or a mongodb connection
                # URI.  If this is the case, don't use self.port
                # but let pymongo get the port(s) from the URI instead.
                # This enables the use of replica sets and sharding.
                # See pymongo.Connection() for more info.
                host = self.host
                if isinstance(host, str) \
                   and not host.startswith('mongodb://'):
                    host = f'mongodb://{host}:{self.port}'
            # don't change self.options
            conf = dict(self.options)
            conf['host'] = host
            if self.user:
                conf['username'] = self.user
            if self.password:
                conf['password'] = self.password

            self._connection = MongoClient(**conf)

        return self._connection

    def encode(self, data):
        if self.serializer == 'bson':
            # mongodb handles serialization
            return data
        payload = super().encode(data)

        # serializer which are in a unsupported format (pickle/binary)
        if self.serializer in BINARY_CODECS:
            payload = Binary(payload)
        return payload

    def decode(self, data):
        if self.serializer == 'bson':
            return data
        return super().decode(data)

    def _store_result(self, task_id, result, state,
                      traceback=None, request=None, **kwargs):
        """Store return value and state of an executed task."""
        meta = self._get_result_meta(result=self.encode(result), state=state,
                                     traceback=traceback, request=request,
                                     format_date=False)
        # Add the _id for mongodb
        meta['_id'] = task_id

        try:
            self.collection.replace_one({'_id': task_id}, meta, upsert=True)
        except InvalidDocument as exc:
            raise EncodeError(exc)

        return result

    def _get_task_meta_for(self, task_id):
        """Get task meta-data for a task by id."""
        obj = self.collection.find_one({'_id': task_id})
        if obj:
            if self.app.conf.find_value_for_key('extended', 'result'):
                return self.meta_from_decoded({
                    'name': obj['name'],
                    'args': obj['args'],
                    'task_id': obj['_id'],
                    'queue': obj['queue'],
                    'kwargs': obj['kwargs'],
                    'status': obj['status'],
                    'worker': obj['worker'],
                    'retries': obj['retries'],
                    'children': obj['children'],
                    'date_done': obj['date_done'],
                    'traceback': obj['traceback'],
                    'result': self.decode(obj['result']),
                })
            return self.meta_from_decoded({
                'task_id': obj['_id'],
                'status': obj['status'],
                'result': self.decode(obj['result']),
                'date_done': obj['date_done'],
                'traceback': obj['traceback'],
                'children': obj['children'],
            })
        return {'status': states.PENDING, 'result': None}

    def _save_group(self, group_id, result):
        """Save the group result."""
        meta = {
            '_id': group_id,
            'result': self.encode([i.id for i in result]),
            'date_done': datetime.utcnow(),
        }
        self.group_collection.replace_one({'_id': group_id}, meta, upsert=True)
        return result

    def _restore_group(self, group_id):
        """Get the result for a group by id."""
        obj = self.group_collection.find_one({'_id': group_id})
        if obj:
            return {
                'task_id': obj['_id'],
                'date_done': obj['date_done'],
                'result': [
                    self.app.AsyncResult(task)
                    for task in self.decode(obj['result'])
                ],
            }

    def _delete_group(self, group_id):
        """Delete a group by id."""
        self.group_collection.delete_one({'_id': group_id})

    def _forget(self, task_id):
        """Remove result from MongoDB.

        Raises:
            pymongo.exceptions.OperationsError:
                if the task_id could not be removed.
        """
        # By using safe=True, this will wait until it receives a response from
        # the server.  Likewise, it will raise an OperationsError if the
        # response was unable to be completed.
        self.collection.delete_one({'_id': task_id})

    def cleanup(self):
        """Delete expired meta-data."""
        if not self.expires:
            return

        self.collection.delete_many(
            {'date_done': {'$lt': self.app.now() - self.expires_delta}},
        )
        self.group_collection.delete_many(
            {'date_done': {'$lt': self.app.now() - self.expires_delta}},
        )

    def __reduce__(self, args=(), kwargs=None):
        kwargs = {} if not kwargs else kwargs
        return super().__reduce__(
            args, dict(kwargs, expires=self.expires, url=self.url))

    def _get_database(self):
        conn = self._get_connection()
        return conn[self.database_name]

    @cached_property
    def database(self):
        """Get database from MongoDB connection.

        performs authentication if necessary.
        """
        return self._get_database()

    @cached_property
    def collection(self):
        """Get the meta-data task collection."""
        collection = self.database[self.taskmeta_collection]

        # Ensure an index on date_done is there, if not process the index
        # in the background.  Once completed cleanup will be much faster
        collection.create_index('date_done', background=True)
        return collection

    @cached_property
    def group_collection(self):
        """Get the meta-data task collection."""
        collection = self.database[self.groupmeta_collection]

        # Ensure an index on date_done is there, if not process the index
        # in the background.  Once completed cleanup will be much faster
        collection.create_index('date_done', background=True)
        return collection

    @cached_property
    def expires_delta(self):
        return timedelta(seconds=self.expires)

    def as_uri(self, include_password=False):
        """Return the backend as an URI.

        Arguments:
            include_password (bool): Password censored if disabled.
        """
        if not self.url:
            return 'mongodb://'
        if include_password:
            return self.url

        if ',' not in self.url:
            return maybe_sanitize_url(self.url)

        uri1, remainder = self.url.split(',', 1)
        return ','.join([maybe_sanitize_url(uri1), remainder])
