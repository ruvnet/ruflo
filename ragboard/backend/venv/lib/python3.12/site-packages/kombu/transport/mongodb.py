# copyright: (c) 2010 - 2013 by Flavio Percoco Premoli.
# license: BSD, see LICENSE for more details.

"""MongoDB transport module for kombu.

Features
========
* Type: Virtual
* Supports Direct: Yes
* Supports Topic: Yes
* Supports Fanout: Yes
* Supports Priority: Yes
* Supports TTL: Yes

Connection String
=================
 *Unreviewed*

Transport Options
=================

* ``connect_timeout``,
* ``ssl``,
* ``ttl``,
* ``capped_queue_size``,
* ``default_hostname``,
* ``default_port``,
* ``default_database``,
* ``messages_collection``,
* ``routing_collection``,
* ``broadcast_collection``,
* ``queues_collection``,
* ``calc_queue_size``,
"""

from __future__ import annotations

import datetime
from queue import Empty

import pymongo
from pymongo import MongoClient, errors, uri_parser
from pymongo.cursor import CursorType

from kombu.exceptions import VersionMismatch
from kombu.utils.compat import _detect_environment
from kombu.utils.encoding import bytes_to_str
from kombu.utils.json import dumps, loads
from kombu.utils.objects import cached_property
from kombu.utils.url import maybe_sanitize_url

from . import virtual
from .base import to_rabbitmq_queue_arguments

E_SERVER_VERSION = """\
Kombu requires MongoDB version 1.3+ (server is {0})\
"""

E_NO_TTL_INDEXES = """\
Kombu requires MongoDB version 2.2+ (server is {0}) for TTL indexes support\
"""


class BroadcastCursor:
    """Cursor for broadcast queues."""

    def __init__(self, cursor):
        self._cursor = cursor
        self._offset = 0
        self.purge(rewind=False)

    def get_size(self):
        return self._cursor.collection.count_documents({}) - self._offset

    def close(self):
        self._cursor.close()

    def purge(self, rewind=True):
        if rewind:
            self._cursor.rewind()

        # Fast-forward the cursor past old events
        self._offset = self._cursor.collection.count_documents({})
        self._cursor = self._cursor.skip(self._offset)

    def __iter__(self):
        return self

    def __next__(self):
        while True:
            try:
                msg = next(self._cursor)
            except pymongo.errors.OperationFailure as exc:
                # In some cases tailed cursor can become invalid
                # and have to be reinitalized
                if 'not valid at server' in str(exc):
                    self.purge()

                    continue

                raise
            else:
                break

        self._offset += 1

        return msg
    next = __next__


class Channel(virtual.Channel):
    """MongoDB Channel."""

    supports_fanout = True

    # Mutable container. Shared by all class instances
    _fanout_queues = {}

    # Options
    ssl = False
    ttl = False
    connect_timeout = None
    capped_queue_size = 100000
    calc_queue_size = True

    default_hostname = '127.0.0.1'
    default_port = 27017
    default_database = 'kombu_default'

    messages_collection = 'messages'
    routing_collection = 'messages.routing'
    broadcast_collection = 'messages.broadcast'
    queues_collection = 'messages.queues'

    from_transport_options = (virtual.Channel.from_transport_options + (
        'connect_timeout', 'ssl', 'ttl', 'capped_queue_size',
        'default_hostname', 'default_port', 'default_database',
        'messages_collection', 'routing_collection',
        'broadcast_collection', 'queues_collection',
        'calc_queue_size',
    ))

    def __init__(self, *vargs, **kwargs):
        super().__init__(*vargs, **kwargs)

        self._broadcast_cursors = {}

        # Evaluate connection
        self.client

    # AbstractChannel/Channel interface implementation

    def _new_queue(self, queue, **kwargs):
        if self.ttl:
            self.queues.update_one(
                {'_id': queue},
                {
                    '$set': {
                        '_id': queue,
                        'options': kwargs,
                        'expire_at': self._get_queue_expire(
                            kwargs, 'x-expires'
                        ),
                    },
                },
                upsert=True)

    def _get(self, queue):
        if queue in self._fanout_queues:
            try:
                msg = next(self._get_broadcast_cursor(queue))
            except StopIteration:
                msg = None
        else:
            msg = self.messages.find_one_and_delete(
                {'queue': queue},
                sort=[('priority', pymongo.ASCENDING)],
            )

        if self.ttl:
            self._update_queues_expire(queue)

        if msg is None:
            raise Empty()

        return loads(bytes_to_str(msg['payload']))

    def _size(self, queue):
        # Do not calculate actual queue size if requested
        # for performance considerations
        if not self.calc_queue_size:
            return super()._size(queue)

        if queue in self._fanout_queues:
            return self._get_broadcast_cursor(queue).get_size()

        return self.messages.count_documents({'queue': queue})

    def _put(self, queue, message, **kwargs):
        data = {
            'payload': dumps(message),
            'queue': queue,
            'priority': self._get_message_priority(message, reverse=True)
        }

        if self.ttl:
            data['expire_at'] = self._get_queue_expire(queue, 'x-message-ttl')
            msg_expire = self._get_message_expire(message)
            if msg_expire is not None and (
                data['expire_at'] is None or msg_expire < data['expire_at']
            ):
                data['expire_at'] = msg_expire

        self.messages.insert_one(data)

    def _put_fanout(self, exchange, message, routing_key, **kwargs):
        self.broadcast.insert_one({'payload': dumps(message),
                                  'queue': exchange})

    def _purge(self, queue):
        size = self._size(queue)

        if queue in self._fanout_queues:
            self._get_broadcast_cursor(queue).purge()
        else:
            self.messages.delete_many({'queue': queue})

        return size

    def get_table(self, exchange):
        localRoutes = frozenset(self.state.exchanges[exchange]['table'])
        brokerRoutes = self.routing.find(
            {'exchange': exchange}
        )

        return localRoutes | frozenset(
            (r['routing_key'], r['pattern'], r['queue'])
            for r in brokerRoutes
        )

    def _queue_bind(self, exchange, routing_key, pattern, queue):
        if self.typeof(exchange).type == 'fanout':
            self._create_broadcast_cursor(
                exchange, routing_key, pattern, queue)
            self._fanout_queues[queue] = exchange

        lookup = {
            'exchange': exchange,
            'queue': queue,
            'routing_key': routing_key,
            'pattern': pattern,
        }

        data = lookup.copy()

        if self.ttl:
            data['expire_at'] = self._get_queue_expire(queue, 'x-expires')

        self.routing.update_one(lookup, {'$set': data}, upsert=True)

    def queue_delete(self, queue, **kwargs):
        self.routing.delete_many({'queue': queue})

        if self.ttl:
            self.queues.delete_one({'_id': queue})

        super().queue_delete(queue, **kwargs)

        if queue in self._fanout_queues:
            try:
                cursor = self._broadcast_cursors.pop(queue)
            except KeyError:
                pass
            else:
                cursor.close()

                self._fanout_queues.pop(queue)

    # Implementation details

    def _parse_uri(self, scheme='mongodb://'):
        # See mongodb uri documentation:
        # https://docs.mongodb.org/manual/reference/connection-string/
        client = self.connection.client
        hostname = client.hostname

        if hostname.startswith('srv://'):
            scheme = 'mongodb+srv://'
            hostname = 'mongodb+' + hostname

        if not hostname.startswith(scheme):
            hostname = scheme + hostname

        if not hostname[len(scheme):]:
            hostname += self.default_hostname

        if client.userid and '@' not in hostname:
            head, tail = hostname.split('://')

            credentials = client.userid
            if client.password:
                credentials += ':' + client.password

            hostname = head + '://' + credentials + '@' + tail

        port = client.port if client.port else self.default_port

        # We disable validating and normalization parameters here,
        # because pymongo will validate and normalize parameters later in __init__ of MongoClient
        parsed = uri_parser.parse_uri(hostname, port, validate=False)

        dbname = parsed['database'] or client.virtual_host

        if dbname in ('/', None):
            dbname = self.default_database

        options = {
            'auto_start_request': True,
            'ssl': self.ssl,
            'connectTimeoutMS': (int(self.connect_timeout * 1000)
                                 if self.connect_timeout else None),
        }
        options.update(parsed['options'])
        options = self._prepare_client_options(options)

        if 'tls' in options:
            options.pop('ssl')

        return hostname, dbname, options

    def _prepare_client_options(self, options):
        if pymongo.version_tuple >= (3,):
            options.pop('auto_start_request', None)
            if isinstance(options.get('readpreference'), int):
                modes = pymongo.read_preferences._MONGOS_MODES
                options['readpreference'] = modes[options['readpreference']]
        return options

    def prepare_queue_arguments(self, arguments, **kwargs):
        return to_rabbitmq_queue_arguments(arguments, **kwargs)

    def _open(self, scheme='mongodb://'):
        hostname, dbname, conf = self._parse_uri(scheme=scheme)

        conf['host'] = hostname

        env = _detect_environment()
        if env == 'gevent':
            from gevent import monkey
            monkey.patch_all()
        elif env == 'eventlet':
            from eventlet import monkey_patch
            monkey_patch()

        mongoconn = MongoClient(**conf)
        database = mongoconn[dbname]

        version_str = mongoconn.server_info()['version']
        version_str = version_str.split('-')[0]
        version = tuple(map(int, version_str.split('.')))

        if version < (1, 3):
            raise VersionMismatch(E_SERVER_VERSION.format(version_str))
        elif self.ttl and version < (2, 2):
            raise VersionMismatch(E_NO_TTL_INDEXES.format(version_str))

        return database

    def _create_broadcast(self, database):
        """Create capped collection for broadcast messages."""
        if self.broadcast_collection in database.list_collection_names():
            return

        database.create_collection(self.broadcast_collection,
                                   size=self.capped_queue_size,
                                   capped=True)

    def _ensure_indexes(self, database):
        """Ensure indexes on collections."""
        messages = database[self.messages_collection]
        messages.create_index(
            [('queue', 1), ('priority', 1), ('_id', 1)], background=True,
        )

        database[self.broadcast_collection].create_index([('queue', 1)])

        routing = database[self.routing_collection]
        routing.create_index([('queue', 1), ('exchange', 1)])

        if self.ttl:
            messages.create_index([('expire_at', 1)], expireAfterSeconds=0)
            routing.create_index([('expire_at', 1)], expireAfterSeconds=0)

            database[self.queues_collection].create_index(
                [('expire_at', 1)], expireAfterSeconds=0)

    def _create_client(self):
        """Actually creates connection."""
        database = self._open()
        self._create_broadcast(database)
        self._ensure_indexes(database)

        return database

    @cached_property
    def client(self):
        return self._create_client()

    @cached_property
    def messages(self):
        return self.client[self.messages_collection]

    @cached_property
    def routing(self):
        return self.client[self.routing_collection]

    @cached_property
    def broadcast(self):
        return self.client[self.broadcast_collection]

    @cached_property
    def queues(self):
        return self.client[self.queues_collection]

    def _get_broadcast_cursor(self, queue):
        try:
            return self._broadcast_cursors[queue]
        except KeyError:
            # Cursor may be absent when Channel created more than once.
            # _fanout_queues is a class-level mutable attribute so it's
            # shared over all Channel instances.
            return self._create_broadcast_cursor(
                self._fanout_queues[queue], None, None, queue,
            )

    def _create_broadcast_cursor(self, exchange, routing_key, pattern, queue):
        if pymongo.version_tuple >= (3, ):
            query = {
                'filter': {'queue': exchange},
                'cursor_type': CursorType.TAILABLE,
            }
        else:
            query = {
                'query': {'queue': exchange},
                'tailable': True,
            }

        cursor = self.broadcast.find(**query)
        ret = self._broadcast_cursors[queue] = BroadcastCursor(cursor)
        return ret

    def _get_message_expire(self, message):
        value = message.get('properties', {}).get('expiration')
        if value is not None:
            return self.get_now() + datetime.timedelta(milliseconds=int(value))

    def _get_queue_expire(self, queue, argument):
        """Get expiration header named `argument` of queue definition.

        Note:
        ----
            `queue` must be either queue name or options itself.
        """
        if isinstance(queue, str):
            doc = self.queues.find_one({'_id': queue})

            if not doc:
                return

            data = doc['options']
        else:
            data = queue

        try:
            value = data['arguments'][argument]
        except (KeyError, TypeError):
            return

        return self.get_now() + datetime.timedelta(milliseconds=value)

    def _update_queues_expire(self, queue):
        """Update expiration field on queues documents."""
        expire_at = self._get_queue_expire(queue, 'x-expires')

        if not expire_at:
            return

        self.routing.update_many(
            {'queue': queue}, {'$set': {'expire_at': expire_at}})
        self.queues.update_many(
            {'_id': queue}, {'$set': {'expire_at': expire_at}})

    def get_now(self):
        """Return current time in UTC."""
        return datetime.datetime.utcnow()


class Transport(virtual.Transport):
    """MongoDB Transport."""

    Channel = Channel

    can_parse_url = True
    polling_interval = 1
    default_port = Channel.default_port
    connection_errors = (
        virtual.Transport.connection_errors + (errors.ConnectionFailure,)
    )
    channel_errors = (
        virtual.Transport.channel_errors + (
            errors.ConnectionFailure,
            errors.OperationFailure)
    )
    driver_type = 'mongodb'
    driver_name = 'pymongo'

    implements = virtual.Transport.implements.extend(
        exchange_type=frozenset(['direct', 'topic', 'fanout']),
    )

    def driver_version(self):
        return pymongo.version

    def as_uri(self, uri: str, include_password=False, mask='**') -> str:
        if not uri:
            return 'mongodb://'
        if include_password:
            return uri

        if ',' not in uri:
            return maybe_sanitize_url(uri)

        uri1, remainder = uri.split(',', 1)
        return ','.join([maybe_sanitize_url(uri1), remainder])
