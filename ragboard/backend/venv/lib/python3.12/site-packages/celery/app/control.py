"""Worker Remote Control Client.

Client for worker remote control commands.
Server implementation is in :mod:`celery.worker.control`.
There are two types of remote control commands:

* Inspect commands: Does not have side effects, will usually just return some value
  found in the worker, like the list of currently registered tasks, the list of active tasks, etc.
  Commands are accessible via :class:`Inspect` class.

* Control commands: Performs side effects, like adding a new queue to consume from.
  Commands are accessible via :class:`Control` class.
"""
import warnings

from billiard.common import TERM_SIGNAME
from kombu.matcher import match
from kombu.pidbox import Mailbox
from kombu.utils.compat import register_after_fork
from kombu.utils.functional import lazy
from kombu.utils.objects import cached_property

from celery.exceptions import DuplicateNodenameWarning
from celery.utils.log import get_logger
from celery.utils.text import pluralize

__all__ = ('Inspect', 'Control', 'flatten_reply')

logger = get_logger(__name__)

W_DUPNODE = """\
Received multiple replies from node {0}: {1}.
Please make sure you give each node a unique nodename using
the celery worker `-n` option.\
"""


def flatten_reply(reply):
    """Flatten node replies.

    Convert from a list of replies in this format::

        [{'a@example.com': reply},
         {'b@example.com': reply}]

    into this format::

        {'a@example.com': reply,
         'b@example.com': reply}
    """
    nodes, dupes = {}, set()
    for item in reply:
        [dupes.add(name) for name in item if name in nodes]
        nodes.update(item)
    if dupes:
        warnings.warn(DuplicateNodenameWarning(
            W_DUPNODE.format(
                pluralize(len(dupes), 'name'), ', '.join(sorted(dupes)),
            ),
        ))
    return nodes


def _after_fork_cleanup_control(control):
    try:
        control._after_fork()
    except Exception as exc:  # pylint: disable=broad-except
        logger.info('after fork raised exception: %r', exc, exc_info=1)


class Inspect:
    """API for inspecting workers.

    This class provides proxy for accessing Inspect API of workers. The API is
    defined in :py:mod:`celery.worker.control`
    """

    app = None

    def __init__(self, destination=None, timeout=1.0, callback=None,
                 connection=None, app=None, limit=None, pattern=None,
                 matcher=None):
        self.app = app or self.app
        self.destination = destination
        self.timeout = timeout
        self.callback = callback
        self.connection = connection
        self.limit = limit
        self.pattern = pattern
        self.matcher = matcher

    def _prepare(self, reply):
        if reply:
            by_node = flatten_reply(reply)
            if (self.destination and
                    not isinstance(self.destination, (list, tuple))):
                return by_node.get(self.destination)
            if self.pattern:
                pattern = self.pattern
                matcher = self.matcher
                return {node: reply for node, reply in by_node.items()
                        if match(node, pattern, matcher)}
            return by_node

    def _request(self, command, **kwargs):
        return self._prepare(self.app.control.broadcast(
            command,
            arguments=kwargs,
            destination=self.destination,
            callback=self.callback,
            connection=self.connection,
            limit=self.limit,
            timeout=self.timeout, reply=True,
            pattern=self.pattern, matcher=self.matcher,
        ))

    def report(self):
        """Return human readable report for each worker.

        Returns:
            Dict: Dictionary ``{HOSTNAME: {'ok': REPORT_STRING}}``.
        """
        return self._request('report')

    def clock(self):
        """Get the Clock value on workers.

        >>> app.control.inspect().clock()
        {'celery@node1': {'clock': 12}}

        Returns:
            Dict: Dictionary ``{HOSTNAME: CLOCK_VALUE}``.
        """
        return self._request('clock')

    def active(self, safe=None):
        """Return list of tasks currently executed by workers.

        Arguments:
            safe (Boolean): Set to True to disable deserialization.

        Returns:
            Dict: Dictionary ``{HOSTNAME: [TASK_INFO,...]}``.

        See Also:
            For ``TASK_INFO`` details see :func:`query_task` return value.

        """
        return self._request('active', safe=safe)

    def scheduled(self, safe=None):
        """Return list of scheduled tasks with details.

        Returns:
            Dict: Dictionary ``{HOSTNAME: [TASK_SCHEDULED_INFO,...]}``.

        Here is the list of ``TASK_SCHEDULED_INFO`` fields:

        * ``eta`` - scheduled time for task execution as string in ISO 8601 format
        * ``priority`` - priority of the task
        * ``request`` - field containing ``TASK_INFO`` value.

        See Also:
            For more details about ``TASK_INFO``  see :func:`query_task` return value.
        """
        return self._request('scheduled')

    def reserved(self, safe=None):
        """Return list of currently reserved tasks, not including scheduled/active.

        Returns:
            Dict: Dictionary ``{HOSTNAME: [TASK_INFO,...]}``.

        See Also:
            For ``TASK_INFO`` details see :func:`query_task` return value.
        """
        return self._request('reserved')

    def stats(self):
        """Return statistics of worker.

        Returns:
            Dict: Dictionary ``{HOSTNAME: STAT_INFO}``.

        Here is the list of ``STAT_INFO`` fields:

        * ``broker`` - Section for broker information.
            * ``connect_timeout`` - Timeout in seconds (int/float) for establishing a new connection.
            * ``heartbeat`` - Current heartbeat value (set by client).
            * ``hostname`` - Node name of the remote broker.
            * ``insist`` - No longer used.
            * ``login_method`` - Login method used to connect to the broker.
            * ``port`` - Port of the remote broker.
            * ``ssl`` - SSL enabled/disabled.
            * ``transport`` - Name of transport used (e.g., amqp or redis)
            * ``transport_options`` - Options passed to transport.
            * ``uri_prefix`` - Some transports expects the host name to be a URL.
              E.g. ``redis+socket:///tmp/redis.sock``.
              In this example the URI-prefix will be redis.
            * ``userid`` - User id used to connect to the broker with.
            * ``virtual_host`` - Virtual host used.
        * ``clock`` - Value of the workers logical clock. This is a positive integer
          and should be increasing every time you receive statistics.
        * ``uptime`` - Numbers of seconds since the worker controller was started
        * ``pid`` - Process id of the worker instance (Main process).
        * ``pool`` - Pool-specific section.
            * ``max-concurrency`` - Max number of processes/threads/green threads.
            * ``max-tasks-per-child`` - Max number of tasks a thread may execute before being recycled.
            * ``processes`` - List of PIDs (or thread-id’s).
            * ``put-guarded-by-semaphore`` - Internal
            * ``timeouts`` - Default values for time limits.
            * ``writes`` - Specific to the prefork pool, this shows the distribution
              of writes to each process in the pool when using async I/O.
        * ``prefetch_count`` - Current prefetch count value for the task consumer.
        * ``rusage`` - System usage statistics. The fields available may be different on your platform.
          From :manpage:`getrusage(2)`:

            * ``stime`` - Time spent in operating system code on behalf of this process.
            * ``utime`` - Time spent executing user instructions.
            * ``maxrss`` - The maximum resident size used by this process (in kilobytes).
            * ``idrss`` - Amount of non-shared memory used for data (in kilobytes times
              ticks of execution)
            * ``isrss`` - Amount of non-shared memory used for stack space
              (in kilobytes times ticks of execution)
            * ``ixrss`` - Amount of memory shared with other processes
              (in kilobytes times ticks of execution).
            * ``inblock`` - Number of times the file system had to read from the disk
              on behalf of this process.
            * ``oublock`` - Number of times the file system has to write to disk
              on behalf of this process.
            * ``majflt`` - Number of page faults that were serviced by doing I/O.
            * ``minflt`` - Number of page faults that were serviced without doing I/O.
            * ``msgrcv`` - Number of IPC messages received.
            * ``msgsnd`` - Number of IPC messages sent.
            * ``nvcsw`` - Number of times this process voluntarily invoked a context switch.
            * ``nivcsw`` - Number of times an involuntary context switch took place.
            * ``nsignals`` - Number of signals received.
            * ``nswap`` - The number of times this process was swapped entirely
              out of memory.
        * ``total`` - Map of task names and the total number of tasks with that type
          the worker has accepted since start-up.
        """
        return self._request('stats')

    def revoked(self):
        """Return list of revoked tasks.

        >>> app.control.inspect().revoked()
        {'celery@node1': ['16f527de-1c72-47a6-b477-c472b92fef7a']}

        Returns:
            Dict: Dictionary ``{HOSTNAME: [TASK_ID, ...]}``.
        """
        return self._request('revoked')

    def registered(self, *taskinfoitems):
        """Return all registered tasks per worker.

        >>> app.control.inspect().registered()
        {'celery@node1': ['task1', 'task1']}
        >>> app.control.inspect().registered('serializer', 'max_retries')
        {'celery@node1': ['task_foo [serializer=json max_retries=3]', 'tasb_bar [serializer=json max_retries=3]']}

        Arguments:
            taskinfoitems (Sequence[str]): List of :class:`~celery.app.task.Task`
                                           attributes to include.

        Returns:
            Dict: Dictionary ``{HOSTNAME: [TASK1_INFO, ...]}``.
        """
        return self._request('registered', taskinfoitems=taskinfoitems)
    registered_tasks = registered

    def ping(self, destination=None):
        """Ping all (or specific) workers.

        >>> app.control.inspect().ping()
        {'celery@node1': {'ok': 'pong'}, 'celery@node2': {'ok': 'pong'}}
        >>> app.control.inspect().ping(destination=['celery@node1'])
        {'celery@node1': {'ok': 'pong'}}

        Arguments:
            destination (List): If set, a list of the hosts to send the
                command to, when empty broadcast to all workers.

        Returns:
            Dict: Dictionary ``{HOSTNAME: {'ok': 'pong'}}``.

        See Also:
            :meth:`broadcast` for supported keyword arguments.
        """
        if destination:
            self.destination = destination
        return self._request('ping')

    def active_queues(self):
        """Return information about queues from which worker consumes tasks.

        Returns:
            Dict: Dictionary ``{HOSTNAME: [QUEUE_INFO, QUEUE_INFO,...]}``.

        Here is the list of ``QUEUE_INFO`` fields:

        * ``name``
        * ``exchange``
            * ``name``
            * ``type``
            * ``arguments``
            * ``durable``
            * ``passive``
            * ``auto_delete``
            * ``delivery_mode``
            * ``no_declare``
        * ``routing_key``
        * ``queue_arguments``
        * ``binding_arguments``
        * ``consumer_arguments``
        * ``durable``
        * ``exclusive``
        * ``auto_delete``
        * ``no_ack``
        * ``alias``
        * ``bindings``
        * ``no_declare``
        * ``expires``
        * ``message_ttl``
        * ``max_length``
        * ``max_length_bytes``
        * ``max_priority``

        See Also:
            See the RabbitMQ/AMQP documentation for more details about
            ``queue_info`` fields.
        Note:
            The ``queue_info`` fields are RabbitMQ/AMQP oriented.
            Not all fields applies for other transports.
        """
        return self._request('active_queues')

    def query_task(self, *ids):
        """Return detail of tasks currently executed by workers.

        Arguments:
            *ids (str): IDs of tasks to be queried.

        Returns:
            Dict: Dictionary ``{HOSTNAME: {TASK_ID: [STATE, TASK_INFO]}}``.

        Here is the list of ``TASK_INFO`` fields:
            * ``id`` - ID of the task
            * ``name`` - Name of the task
            * ``args`` - Positinal arguments passed to the task
            * ``kwargs`` - Keyword arguments passed to the task
            * ``type`` - Type of the task
            * ``hostname`` - Hostname of the worker processing the task
            * ``time_start`` - Time of processing start
            * ``acknowledged`` - True when task was acknowledged to broker
            * ``delivery_info`` - Dictionary containing delivery information
                * ``exchange`` - Name of exchange where task was published
                * ``routing_key`` - Routing key used when task was published
                * ``priority`` - Priority used when task was published
                * ``redelivered`` - True if the task was redelivered
            * ``worker_pid`` - PID of worker processin the task

        """
        # signature used be unary: query_task(ids=[id1, id2])
        # we need this to preserve backward compatibility.
        if len(ids) == 1 and isinstance(ids[0], (list, tuple)):
            ids = ids[0]
        return self._request('query_task', ids=ids)

    def conf(self, with_defaults=False):
        """Return configuration of each worker.

        Arguments:
            with_defaults (bool): if set to True, method returns also
                                   configuration options with default values.

        Returns:
            Dict: Dictionary ``{HOSTNAME: WORKER_CONFIGURATION}``.

        See Also:
            ``WORKER_CONFIGURATION`` is a dictionary containing current configuration options.
            See :ref:`configuration` for possible values.
        """
        return self._request('conf', with_defaults=with_defaults)

    def hello(self, from_node, revoked=None):
        return self._request('hello', from_node=from_node, revoked=revoked)

    def memsample(self):
        """Return sample current RSS memory usage.

        Note:
            Requires the psutils library.
        """
        return self._request('memsample')

    def memdump(self, samples=10):
        """Dump statistics of previous memsample requests.

        Note:
            Requires the psutils library.
        """
        return self._request('memdump', samples=samples)

    def objgraph(self, type='Request', n=200, max_depth=10):
        """Create graph of uncollected objects (memory-leak debugging).

        Arguments:
            n (int): Max number of objects to graph.
            max_depth (int): Traverse at most n levels deep.
            type (str): Name of object to graph.  Default is ``"Request"``.

        Returns:
            Dict: Dictionary ``{'filename': FILENAME}``

        Note:
            Requires the objgraph library.
        """
        return self._request('objgraph', num=n, max_depth=max_depth, type=type)


class Control:
    """Worker remote control client."""

    Mailbox = Mailbox

    def __init__(self, app=None):
        self.app = app
        self.mailbox = self.Mailbox(
            app.conf.control_exchange,
            type='fanout',
            accept=app.conf.accept_content,
            serializer=app.conf.task_serializer,
            producer_pool=lazy(lambda: self.app.amqp.producer_pool),
            queue_ttl=app.conf.control_queue_ttl,
            reply_queue_ttl=app.conf.control_queue_ttl,
            queue_expires=app.conf.control_queue_expires,
            reply_queue_expires=app.conf.control_queue_expires,
        )
        register_after_fork(self, _after_fork_cleanup_control)

    def _after_fork(self):
        del self.mailbox.producer_pool

    @cached_property
    def inspect(self):
        """Create new :class:`Inspect` instance."""
        return self.app.subclass_with_self(Inspect, reverse='control.inspect')

    def purge(self, connection=None):
        """Discard all waiting tasks.

        This will ignore all tasks waiting for execution, and they will
        be deleted from the messaging server.

        Arguments:
            connection (kombu.Connection): Optional specific connection
                instance to use.  If not provided a connection will
                be acquired from the connection pool.

        Returns:
            int: the number of tasks discarded.
        """
        with self.app.connection_or_acquire(connection) as conn:
            return self.app.amqp.TaskConsumer(conn).purge()
    discard_all = purge

    def election(self, id, topic, action=None, connection=None):
        self.broadcast(
            'election', connection=connection, destination=None,
            arguments={
                'id': id, 'topic': topic, 'action': action,
            },
        )

    def revoke(self, task_id, destination=None, terminate=False,
               signal=TERM_SIGNAME, **kwargs):
        """Tell all (or specific) workers to revoke a task by id (or list of ids).

        If a task is revoked, the workers will ignore the task and
        not execute it after all.

        Arguments:
            task_id (Union(str, list)): Id of the task to revoke
                (or list of ids).
            terminate (bool): Also terminate the process currently working
                on the task (if any).
            signal (str): Name of signal to send to process if terminate.
                Default is TERM.

        See Also:
            :meth:`broadcast` for supported keyword arguments.
        """
        return self.broadcast('revoke', destination=destination, arguments={
            'task_id': task_id,
            'terminate': terminate,
            'signal': signal,
        }, **kwargs)

    def revoke_by_stamped_headers(self, headers, destination=None, terminate=False,
                                  signal=TERM_SIGNAME, **kwargs):
        """
        Tell all (or specific) workers to revoke a task by headers.

        If a task is revoked, the workers will ignore the task and
        not execute it after all.

        Arguments:
            headers (dict[str, Union(str, list)]): Headers to match when revoking tasks.
            terminate (bool): Also terminate the process currently working
                on the task (if any).
            signal (str): Name of signal to send to process if terminate.
                Default is TERM.

        See Also:
            :meth:`broadcast` for supported keyword arguments.
        """
        result = self.broadcast('revoke_by_stamped_headers', destination=destination, arguments={
            'headers': headers,
            'terminate': terminate,
            'signal': signal,
        }, **kwargs)

        task_ids = set()
        if result:
            for host in result:
                for response in host.values():
                    task_ids.update(response['ok'])

        if task_ids:
            return self.revoke(list(task_ids), destination=destination, terminate=terminate, signal=signal, **kwargs)
        else:
            return result

    def terminate(self, task_id,
                  destination=None, signal=TERM_SIGNAME, **kwargs):
        """Tell all (or specific) workers to terminate a task by id (or list of ids).

        See Also:
            This is just a shortcut to :meth:`revoke` with the terminate
            argument enabled.
        """
        return self.revoke(
            task_id,
            destination=destination, terminate=True, signal=signal, **kwargs)

    def ping(self, destination=None, timeout=1.0, **kwargs):
        """Ping all (or specific) workers.

        >>> app.control.ping()
        [{'celery@node1': {'ok': 'pong'}}, {'celery@node2': {'ok': 'pong'}}]
        >>> app.control.ping(destination=['celery@node2'])
        [{'celery@node2': {'ok': 'pong'}}]

        Returns:
            List[Dict]: List of ``{HOSTNAME: {'ok': 'pong'}}`` dictionaries.

        See Also:
            :meth:`broadcast` for supported keyword arguments.
        """
        return self.broadcast(
            'ping', reply=True, arguments={}, destination=destination,
            timeout=timeout, **kwargs)

    def rate_limit(self, task_name, rate_limit, destination=None, **kwargs):
        """Tell workers to set a new rate limit for task by type.

        Arguments:
            task_name (str): Name of task to change rate limit for.
            rate_limit (int, str): The rate limit as tasks per second,
                or a rate limit string (`'100/m'`, etc.
                see :attr:`celery.app.task.Task.rate_limit` for
                more information).

        See Also:
            :meth:`broadcast` for supported keyword arguments.
        """
        return self.broadcast(
            'rate_limit',
            destination=destination,
            arguments={
                'task_name': task_name,
                'rate_limit': rate_limit,
            },
            **kwargs)

    def add_consumer(self, queue,
                     exchange=None, exchange_type='direct', routing_key=None,
                     options=None, destination=None, **kwargs):
        """Tell all (or specific) workers to start consuming from a new queue.

        Only the queue name is required as if only the queue is specified
        then the exchange/routing key will be set to the same name (
        like automatic queues do).

        Note:
            This command does not respect the default queue/exchange
            options in the configuration.

        Arguments:
            queue (str): Name of queue to start consuming from.
            exchange (str): Optional name of exchange.
            exchange_type (str): Type of exchange (defaults to 'direct')
                command to, when empty broadcast to all workers.
            routing_key (str): Optional routing key.
            options (Dict): Additional options as supported
                by :meth:`kombu.entity.Queue.from_dict`.

        See Also:
            :meth:`broadcast` for supported keyword arguments.
        """
        return self.broadcast(
            'add_consumer',
            destination=destination,
            arguments=dict({
                'queue': queue,
                'exchange': exchange,
                'exchange_type': exchange_type,
                'routing_key': routing_key,
            }, **options or {}),
            **kwargs
        )

    def cancel_consumer(self, queue, destination=None, **kwargs):
        """Tell all (or specific) workers to stop consuming from ``queue``.

        See Also:
            Supports the same arguments as :meth:`broadcast`.
        """
        return self.broadcast(
            'cancel_consumer', destination=destination,
            arguments={'queue': queue}, **kwargs)

    def time_limit(self, task_name, soft=None, hard=None,
                   destination=None, **kwargs):
        """Tell workers to set time limits for a task by type.

        Arguments:
            task_name (str): Name of task to change time limits for.
            soft (float): New soft time limit (in seconds).
            hard (float): New hard time limit (in seconds).
            **kwargs (Any): arguments passed on to :meth:`broadcast`.
        """
        return self.broadcast(
            'time_limit',
            arguments={
                'task_name': task_name,
                'hard': hard,
                'soft': soft,
            },
            destination=destination,
            **kwargs)

    def enable_events(self, destination=None, **kwargs):
        """Tell all (or specific) workers to enable events.

        See Also:
            Supports the same arguments as :meth:`broadcast`.
        """
        return self.broadcast(
            'enable_events', arguments={}, destination=destination, **kwargs)

    def disable_events(self, destination=None, **kwargs):
        """Tell all (or specific) workers to disable events.

        See Also:
            Supports the same arguments as :meth:`broadcast`.
        """
        return self.broadcast(
            'disable_events', arguments={}, destination=destination, **kwargs)

    def pool_grow(self, n=1, destination=None, **kwargs):
        """Tell all (or specific) workers to grow the pool by ``n``.

        See Also:
            Supports the same arguments as :meth:`broadcast`.
        """
        return self.broadcast(
            'pool_grow', arguments={'n': n}, destination=destination, **kwargs)

    def pool_shrink(self, n=1, destination=None, **kwargs):
        """Tell all (or specific) workers to shrink the pool by ``n``.

        See Also:
            Supports the same arguments as :meth:`broadcast`.
        """
        return self.broadcast(
            'pool_shrink', arguments={'n': n},
            destination=destination, **kwargs)

    def autoscale(self, max, min, destination=None, **kwargs):
        """Change worker(s) autoscale setting.

        See Also:
            Supports the same arguments as :meth:`broadcast`.
        """
        return self.broadcast(
            'autoscale', arguments={'max': max, 'min': min},
            destination=destination, **kwargs)

    def shutdown(self, destination=None, **kwargs):
        """Shutdown worker(s).

        See Also:
            Supports the same arguments as :meth:`broadcast`
        """
        return self.broadcast(
            'shutdown', arguments={}, destination=destination, **kwargs)

    def pool_restart(self, modules=None, reload=False, reloader=None,
                     destination=None, **kwargs):
        """Restart the execution pools of all or specific workers.

        Keyword Arguments:
            modules (Sequence[str]): List of modules to reload.
            reload (bool): Flag to enable module reloading.  Default is False.
            reloader (Any): Function to reload a module.
            destination (Sequence[str]): List of worker names to send this
                command to.

        See Also:
            Supports the same arguments as :meth:`broadcast`
        """
        return self.broadcast(
            'pool_restart',
            arguments={
                'modules': modules,
                'reload': reload,
                'reloader': reloader,
            },
            destination=destination, **kwargs)

    def heartbeat(self, destination=None, **kwargs):
        """Tell worker(s) to send a heartbeat immediately.

        See Also:
            Supports the same arguments as :meth:`broadcast`
        """
        return self.broadcast(
            'heartbeat', arguments={}, destination=destination, **kwargs)

    def broadcast(self, command, arguments=None, destination=None,
                  connection=None, reply=False, timeout=1.0, limit=None,
                  callback=None, channel=None, pattern=None, matcher=None,
                  **extra_kwargs):
        """Broadcast a control command to the celery workers.

        Arguments:
            command (str): Name of command to send.
            arguments (Dict): Keyword arguments for the command.
            destination (List): If set, a list of the hosts to send the
                command to, when empty broadcast to all workers.
            connection (kombu.Connection): Custom broker connection to use,
                if not set, a connection will be acquired from the pool.
            reply (bool): Wait for and return the reply.
            timeout (float): Timeout in seconds to wait for the reply.
            limit (int): Limit number of replies.
            callback (Callable): Callback called immediately for
                each reply received.
            pattern (str): Custom pattern string to match
            matcher (Callable): Custom matcher to run the pattern to match
        """
        with self.app.connection_or_acquire(connection) as conn:
            arguments = dict(arguments or {}, **extra_kwargs)
            if pattern and matcher:
                # tests pass easier without requiring pattern/matcher to
                # always be sent in
                return self.mailbox(conn)._broadcast(
                    command, arguments, destination, reply, timeout,
                    limit, callback, channel=channel,
                    pattern=pattern, matcher=matcher,
                )
            else:
                return self.mailbox(conn)._broadcast(
                    command, arguments, destination, reply, timeout,
                    limit, callback, channel=channel,
                )
