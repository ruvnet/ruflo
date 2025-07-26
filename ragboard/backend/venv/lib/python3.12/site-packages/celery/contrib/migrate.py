"""Message migration tools (Broker <-> Broker)."""
import socket
from functools import partial
from itertools import cycle, islice

from kombu import Queue, eventloop
from kombu.common import maybe_declare
from kombu.utils.encoding import ensure_bytes

from celery.app import app_or_default
from celery.utils.nodenames import worker_direct
from celery.utils.text import str_to_list

__all__ = (
    'StopFiltering', 'State', 'republish', 'migrate_task',
    'migrate_tasks', 'move', 'task_id_eq', 'task_id_in',
    'start_filter', 'move_task_by_id', 'move_by_idmap',
    'move_by_taskmap', 'move_direct', 'move_direct_by_id',
)

MOVING_PROGRESS_FMT = """\
Moving task {state.filtered}/{state.strtotal}: \
{body[task]}[{body[id]}]\
"""


class StopFiltering(Exception):
    """Semi-predicate used to signal filter stop."""


class State:
    """Migration progress state."""

    count = 0
    filtered = 0
    total_apx = 0

    @property
    def strtotal(self):
        if not self.total_apx:
            return '?'
        return str(self.total_apx)

    def __repr__(self):
        if self.filtered:
            return f'^{self.filtered}'
        return f'{self.count}/{self.strtotal}'


def republish(producer, message, exchange=None, routing_key=None,
              remove_props=None):
    """Republish message."""
    if not remove_props:
        remove_props = ['application_headers', 'content_type',
                        'content_encoding', 'headers']
    body = ensure_bytes(message.body)  # use raw message body.
    info, headers, props = (message.delivery_info,
                            message.headers, message.properties)
    exchange = info['exchange'] if exchange is None else exchange
    routing_key = info['routing_key'] if routing_key is None else routing_key
    ctype, enc = message.content_type, message.content_encoding
    # remove compression header, as this will be inserted again
    # when the message is recompressed.
    compression = headers.pop('compression', None)

    expiration = props.pop('expiration', None)
    # ensure expiration is a float
    expiration = float(expiration) if expiration is not None else None

    for key in remove_props:
        props.pop(key, None)

    producer.publish(ensure_bytes(body), exchange=exchange,
                     routing_key=routing_key, compression=compression,
                     headers=headers, content_type=ctype,
                     content_encoding=enc, expiration=expiration,
                     **props)


def migrate_task(producer, body_, message, queues=None):
    """Migrate single task message."""
    info = message.delivery_info
    queues = {} if queues is None else queues
    republish(producer, message,
              exchange=queues.get(info['exchange']),
              routing_key=queues.get(info['routing_key']))


def filter_callback(callback, tasks):

    def filtered(body, message):
        if tasks and body['task'] not in tasks:
            return

        return callback(body, message)
    return filtered


def migrate_tasks(source, dest, migrate=migrate_task, app=None,
                  queues=None, **kwargs):
    """Migrate tasks from one broker to another."""
    app = app_or_default(app)
    queues = prepare_queues(queues)
    producer = app.amqp.Producer(dest, auto_declare=False)
    migrate = partial(migrate, producer, queues=queues)

    def on_declare_queue(queue):
        new_queue = queue(producer.channel)
        new_queue.name = queues.get(queue.name, queue.name)
        if new_queue.routing_key == queue.name:
            new_queue.routing_key = queues.get(queue.name,
                                               new_queue.routing_key)
        if new_queue.exchange.name == queue.name:
            new_queue.exchange.name = queues.get(queue.name, queue.name)
        new_queue.declare()

    return start_filter(app, source, migrate, queues=queues,
                        on_declare_queue=on_declare_queue, **kwargs)


def _maybe_queue(app, q):
    if isinstance(q, str):
        return app.amqp.queues[q]
    return q


def move(predicate, connection=None, exchange=None, routing_key=None,
         source=None, app=None, callback=None, limit=None, transform=None,
         **kwargs):
    """Find tasks by filtering them and move the tasks to a new queue.

    Arguments:
        predicate (Callable): Filter function used to decide the messages
            to move.  Must accept the standard signature of ``(body, message)``
            used by Kombu consumer callbacks.  If the predicate wants the
            message to be moved it must return either:

                1) a tuple of ``(exchange, routing_key)``, or

                2) a :class:`~kombu.entity.Queue` instance, or

                3) any other true value means the specified
                    ``exchange`` and ``routing_key`` arguments will be used.
        connection (kombu.Connection): Custom connection to use.
        source: List[Union[str, kombu.Queue]]: Optional list of source
            queues to use instead of the default (queues
            in :setting:`task_queues`).  This list can also contain
            :class:`~kombu.entity.Queue` instances.
        exchange (str, kombu.Exchange): Default destination exchange.
        routing_key (str): Default destination routing key.
        limit (int): Limit number of messages to filter.
        callback (Callable): Callback called after message moved,
            with signature ``(state, body, message)``.
        transform (Callable): Optional function to transform the return
            value (destination) of the filter function.

    Also supports the same keyword arguments as :func:`start_filter`.

    To demonstrate, the :func:`move_task_by_id` operation can be implemented
    like this:

    .. code-block:: python

        def is_wanted_task(body, message):
            if body['id'] == wanted_id:
                return Queue('foo', exchange=Exchange('foo'),
                             routing_key='foo')

        move(is_wanted_task)

    or with a transform:

    .. code-block:: python

        def transform(value):
            if isinstance(value, str):
                return Queue(value, Exchange(value), value)
            return value

        move(is_wanted_task, transform=transform)

    Note:
        The predicate may also return a tuple of ``(exchange, routing_key)``
        to specify the destination to where the task should be moved,
        or a :class:`~kombu.entity.Queue` instance.
        Any other true value means that the task will be moved to the
        default exchange/routing_key.
    """
    app = app_or_default(app)
    queues = [_maybe_queue(app, queue) for queue in source or []] or None
    with app.connection_or_acquire(connection, pool=False) as conn:
        producer = app.amqp.Producer(conn)
        state = State()

        def on_task(body, message):
            ret = predicate(body, message)
            if ret:
                if transform:
                    ret = transform(ret)
                if isinstance(ret, Queue):
                    maybe_declare(ret, conn.default_channel)
                    ex, rk = ret.exchange.name, ret.routing_key
                else:
                    ex, rk = expand_dest(ret, exchange, routing_key)
                republish(producer, message,
                          exchange=ex, routing_key=rk)
                message.ack()

                state.filtered += 1
                if callback:
                    callback(state, body, message)
                if limit and state.filtered >= limit:
                    raise StopFiltering()

        return start_filter(app, conn, on_task, consume_from=queues, **kwargs)


def expand_dest(ret, exchange, routing_key):
    try:
        ex, rk = ret
    except (TypeError, ValueError):
        ex, rk = exchange, routing_key
    return ex, rk


def task_id_eq(task_id, body, message):
    """Return true if task id equals task_id'."""
    return body['id'] == task_id


def task_id_in(ids, body, message):
    """Return true if task id is member of set ids'."""
    return body['id'] in ids


def prepare_queues(queues):
    if isinstance(queues, str):
        queues = queues.split(',')
    if isinstance(queues, list):
        queues = dict(tuple(islice(cycle(q.split(':')), None, 2))
                      for q in queues)
    if queues is None:
        queues = {}
    return queues


class Filterer:

    def __init__(self, app, conn, filter,
                 limit=None, timeout=1.0,
                 ack_messages=False, tasks=None, queues=None,
                 callback=None, forever=False, on_declare_queue=None,
                 consume_from=None, state=None, accept=None, **kwargs):
        self.app = app
        self.conn = conn
        self.filter = filter
        self.limit = limit
        self.timeout = timeout
        self.ack_messages = ack_messages
        self.tasks = set(str_to_list(tasks) or [])
        self.queues = prepare_queues(queues)
        self.callback = callback
        self.forever = forever
        self.on_declare_queue = on_declare_queue
        self.consume_from = [
            _maybe_queue(self.app, q)
            for q in consume_from or list(self.queues)
        ]
        self.state = state or State()
        self.accept = accept

    def start(self):
        # start migrating messages.
        with self.prepare_consumer(self.create_consumer()):
            try:
                for _ in eventloop(self.conn,  # pragma: no cover
                                   timeout=self.timeout,
                                   ignore_timeouts=self.forever):
                    pass
            except socket.timeout:
                pass
            except StopFiltering:
                pass
        return self.state

    def update_state(self, body, message):
        self.state.count += 1
        if self.limit and self.state.count >= self.limit:
            raise StopFiltering()

    def ack_message(self, body, message):
        message.ack()

    def create_consumer(self):
        return self.app.amqp.TaskConsumer(
            self.conn,
            queues=self.consume_from,
            accept=self.accept,
        )

    def prepare_consumer(self, consumer):
        filter = self.filter
        update_state = self.update_state
        ack_message = self.ack_message
        if self.tasks:
            filter = filter_callback(filter, self.tasks)
            update_state = filter_callback(update_state, self.tasks)
            ack_message = filter_callback(ack_message, self.tasks)
        consumer.register_callback(filter)
        consumer.register_callback(update_state)
        if self.ack_messages:
            consumer.register_callback(self.ack_message)
        if self.callback is not None:
            callback = partial(self.callback, self.state)
            if self.tasks:
                callback = filter_callback(callback, self.tasks)
            consumer.register_callback(callback)
        self.declare_queues(consumer)
        return consumer

    def declare_queues(self, consumer):
        # declare all queues on the new broker.
        for queue in consumer.queues:
            if self.queues and queue.name not in self.queues:
                continue
            if self.on_declare_queue is not None:
                self.on_declare_queue(queue)
            try:
                _, mcount, _ = queue(
                    consumer.channel).queue_declare(passive=True)
                if mcount:
                    self.state.total_apx += mcount
            except self.conn.channel_errors:
                pass


def start_filter(app, conn, filter, limit=None, timeout=1.0,
                 ack_messages=False, tasks=None, queues=None,
                 callback=None, forever=False, on_declare_queue=None,
                 consume_from=None, state=None, accept=None, **kwargs):
    """Filter tasks."""
    return Filterer(
        app, conn, filter,
        limit=limit,
        timeout=timeout,
        ack_messages=ack_messages,
        tasks=tasks,
        queues=queues,
        callback=callback,
        forever=forever,
        on_declare_queue=on_declare_queue,
        consume_from=consume_from,
        state=state,
        accept=accept,
        **kwargs).start()


def move_task_by_id(task_id, dest, **kwargs):
    """Find a task by id and move it to another queue.

    Arguments:
        task_id (str): Id of task to find and move.
        dest: (str, kombu.Queue): Destination queue.
        transform (Callable): Optional function to transform the return
            value (destination) of the filter function.
        **kwargs (Any): Also supports the same keyword
            arguments as :func:`move`.
    """
    return move_by_idmap({task_id: dest}, **kwargs)


def move_by_idmap(map, **kwargs):
    """Move tasks by matching from a ``task_id: queue`` mapping.

    Where ``queue`` is a queue to move the task to.

    Example:
        >>> move_by_idmap({
        ...     '5bee6e82-f4ac-468e-bd3d-13e8600250bc': Queue('name'),
        ...     'ada8652d-aef3-466b-abd2-becdaf1b82b3': Queue('name'),
        ...     '3a2b140d-7db1-41ba-ac90-c36a0ef4ab1f': Queue('name')},
        ...   queues=['hipri'])
    """
    def task_id_in_map(body, message):
        return map.get(message.properties['correlation_id'])

    # adding the limit means that we don't have to consume any more
    # when we've found everything.
    return move(task_id_in_map, limit=len(map), **kwargs)


def move_by_taskmap(map, **kwargs):
    """Move tasks by matching from a ``task_name: queue`` mapping.

    ``queue`` is the queue to move the task to.

    Example:
        >>> move_by_taskmap({
        ...     'tasks.add': Queue('name'),
        ...     'tasks.mul': Queue('name'),
        ... })
    """
    def task_name_in_map(body, message):
        return map.get(body['task'])  # <- name of task

    return move(task_name_in_map, **kwargs)


def filter_status(state, body, message, **kwargs):
    print(MOVING_PROGRESS_FMT.format(state=state, body=body, **kwargs))


move_direct = partial(move, transform=worker_direct)
move_direct_by_id = partial(move_task_by_id, transform=worker_direct)
move_direct_by_idmap = partial(move_by_idmap, transform=worker_direct)
move_direct_by_taskmap = partial(move_by_taskmap, transform=worker_direct)
