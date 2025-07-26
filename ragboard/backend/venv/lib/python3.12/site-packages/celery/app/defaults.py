"""Configuration introspection and defaults."""
from collections import deque, namedtuple
from datetime import timedelta

from celery.utils.functional import memoize
from celery.utils.serialization import strtobool

__all__ = ('Option', 'NAMESPACES', 'flatten', 'find')


DEFAULT_POOL = 'prefork'

DEFAULT_ACCEPT_CONTENT = ('json',)
DEFAULT_PROCESS_LOG_FMT = """
    [%(asctime)s: %(levelname)s/%(processName)s] %(message)s
""".strip()
DEFAULT_TASK_LOG_FMT = """[%(asctime)s: %(levelname)s/%(processName)s] \
%(task_name)s[%(task_id)s]: %(message)s"""

DEFAULT_SECURITY_DIGEST = 'sha256'


OLD_NS = {'celery_{0}'}
OLD_NS_BEAT = {'celerybeat_{0}'}
OLD_NS_WORKER = {'celeryd_{0}'}

searchresult = namedtuple('searchresult', ('namespace', 'key', 'type'))


def Namespace(__old__=None, **options):
    if __old__ is not None:
        for key, opt in options.items():
            if not opt.old:
                opt.old = {o.format(key) for o in __old__}
    return options


def old_ns(ns):
    return {f'{ns}_{{0}}'}


class Option:
    """Describes a Celery configuration option."""

    alt = None
    deprecate_by = None
    remove_by = None
    old = set()
    typemap = {'string': str, 'int': int, 'float': float, 'any': lambda v: v,
               'bool': strtobool, 'dict': dict, 'tuple': tuple}

    def __init__(self, default=None, *args, **kwargs):
        self.default = default
        self.type = kwargs.get('type') or 'string'
        for attr, value in kwargs.items():
            setattr(self, attr, value)

    def to_python(self, value):
        return self.typemap[self.type](value)

    def __repr__(self):
        return '<Option: type->{} default->{!r}>'.format(self.type,
                                                         self.default)


NAMESPACES = Namespace(
    accept_content=Option(DEFAULT_ACCEPT_CONTENT, type='list', old=OLD_NS),
    result_accept_content=Option(None, type='list'),
    enable_utc=Option(True, type='bool'),
    imports=Option((), type='tuple', old=OLD_NS),
    include=Option((), type='tuple', old=OLD_NS),
    timezone=Option(type='string', old=OLD_NS),
    beat=Namespace(
        __old__=OLD_NS_BEAT,

        max_loop_interval=Option(0, type='float'),
        schedule=Option({}, type='dict'),
        scheduler=Option('celery.beat:PersistentScheduler'),
        schedule_filename=Option('celerybeat-schedule'),
        sync_every=Option(0, type='int'),
        cron_starting_deadline=Option(None, type=int)
    ),
    broker=Namespace(
        url=Option(None, type='string'),
        read_url=Option(None, type='string'),
        write_url=Option(None, type='string'),
        transport=Option(type='string'),
        transport_options=Option({}, type='dict'),
        connection_timeout=Option(4, type='float'),
        connection_retry=Option(True, type='bool'),
        connection_retry_on_startup=Option(None, type='bool'),
        connection_max_retries=Option(100, type='int'),
        channel_error_retry=Option(False, type='bool'),
        failover_strategy=Option(None, type='string'),
        heartbeat=Option(120, type='int'),
        heartbeat_checkrate=Option(3.0, type='int'),
        login_method=Option(None, type='string'),
        pool_limit=Option(10, type='int'),
        use_ssl=Option(False, type='bool'),

        host=Option(type='string'),
        port=Option(type='int'),
        user=Option(type='string'),
        password=Option(type='string'),
        vhost=Option(type='string'),
    ),
    cache=Namespace(
        __old__=old_ns('celery_cache'),

        backend=Option(),
        backend_options=Option({}, type='dict'),
    ),
    cassandra=Namespace(
        entry_ttl=Option(type='float'),
        keyspace=Option(type='string'),
        port=Option(type='string'),
        read_consistency=Option(type='string'),
        servers=Option(type='list'),
        bundle_path=Option(type='string'),
        table=Option(type='string'),
        write_consistency=Option(type='string'),
        auth_provider=Option(type='string'),
        auth_kwargs=Option(type='string'),
        options=Option({}, type='dict'),
    ),
    s3=Namespace(
        access_key_id=Option(type='string'),
        secret_access_key=Option(type='string'),
        bucket=Option(type='string'),
        base_path=Option(type='string'),
        endpoint_url=Option(type='string'),
        region=Option(type='string'),
    ),
    azureblockblob=Namespace(
        container_name=Option('celery', type='string'),
        retry_initial_backoff_sec=Option(2, type='int'),
        retry_increment_base=Option(2, type='int'),
        retry_max_attempts=Option(3, type='int'),
        base_path=Option('', type='string'),
        connection_timeout=Option(20, type='int'),
        read_timeout=Option(120, type='int'),
    ),
    control=Namespace(
        queue_ttl=Option(300.0, type='float'),
        queue_expires=Option(10.0, type='float'),
        exchange=Option('celery', type='string'),
    ),
    couchbase=Namespace(
        __old__=old_ns('celery_couchbase'),

        backend_settings=Option(None, type='dict'),
    ),
    arangodb=Namespace(
        __old__=old_ns('celery_arangodb'),
        backend_settings=Option(None, type='dict')
    ),
    mongodb=Namespace(
        __old__=old_ns('celery_mongodb'),

        backend_settings=Option(type='dict'),
    ),
    cosmosdbsql=Namespace(
        database_name=Option('celerydb', type='string'),
        collection_name=Option('celerycol', type='string'),
        consistency_level=Option('Session', type='string'),
        max_retry_attempts=Option(9, type='int'),
        max_retry_wait_time=Option(30, type='int'),
    ),
    event=Namespace(
        __old__=old_ns('celery_event'),

        queue_expires=Option(60.0, type='float'),
        queue_ttl=Option(5.0, type='float'),
        queue_prefix=Option('celeryev'),
        serializer=Option('json'),
        exchange=Option('celeryev', type='string'),
    ),
    redis=Namespace(
        __old__=old_ns('celery_redis'),

        backend_use_ssl=Option(type='dict'),
        db=Option(type='int'),
        host=Option(type='string'),
        max_connections=Option(type='int'),
        username=Option(type='string'),
        password=Option(type='string'),
        port=Option(type='int'),
        socket_timeout=Option(120.0, type='float'),
        socket_connect_timeout=Option(None, type='float'),
        retry_on_timeout=Option(False, type='bool'),
        socket_keepalive=Option(False, type='bool'),
    ),
    result=Namespace(
        __old__=old_ns('celery_result'),

        backend=Option(type='string'),
        cache_max=Option(
            -1,
            type='int', old={'celery_max_cached_results'},
        ),
        compression=Option(type='str'),
        exchange=Option('celeryresults'),
        exchange_type=Option('direct'),
        expires=Option(
            timedelta(days=1),
            type='float', old={'celery_task_result_expires'},
        ),
        persistent=Option(None, type='bool'),
        extended=Option(False, type='bool'),
        serializer=Option('json'),
        backend_transport_options=Option({}, type='dict'),
        chord_retry_interval=Option(1.0, type='float'),
        chord_join_timeout=Option(3.0, type='float'),
        backend_max_sleep_between_retries_ms=Option(10000, type='int'),
        backend_max_retries=Option(float("inf"), type='float'),
        backend_base_sleep_between_retries_ms=Option(10, type='int'),
        backend_always_retry=Option(False, type='bool'),
    ),
    elasticsearch=Namespace(
        __old__=old_ns('celery_elasticsearch'),

        retry_on_timeout=Option(type='bool'),
        max_retries=Option(type='int'),
        timeout=Option(type='float'),
        save_meta_as_text=Option(True, type='bool'),
    ),
    security=Namespace(
        __old__=old_ns('celery_security'),

        certificate=Option(type='string'),
        cert_store=Option(type='string'),
        key=Option(type='string'),
        key_password=Option(type='bytes'),
        digest=Option(DEFAULT_SECURITY_DIGEST, type='string'),
    ),
    database=Namespace(
        url=Option(old={'celery_result_dburi'}),
        engine_options=Option(
            type='dict', old={'celery_result_engine_options'},
        ),
        short_lived_sessions=Option(
            False, type='bool', old={'celery_result_db_short_lived_sessions'},
        ),
        table_schemas=Option(type='dict'),
        table_names=Option(type='dict', old={'celery_result_db_tablenames'}),
    ),
    task=Namespace(
        __old__=OLD_NS,
        acks_late=Option(False, type='bool'),
        acks_on_failure_or_timeout=Option(True, type='bool'),
        always_eager=Option(False, type='bool'),
        annotations=Option(type='any'),
        compression=Option(type='string', old={'celery_message_compression'}),
        create_missing_queues=Option(True, type='bool'),
        inherit_parent_priority=Option(False, type='bool'),
        default_delivery_mode=Option(2, type='string'),
        default_queue=Option('celery'),
        default_exchange=Option(None, type='string'),  # taken from queue
        default_exchange_type=Option('direct'),
        default_routing_key=Option(None, type='string'),  # taken from queue
        default_rate_limit=Option(type='string'),
        default_priority=Option(None, type='string'),
        eager_propagates=Option(
            False, type='bool', old={'celery_eager_propagates_exceptions'},
        ),
        ignore_result=Option(False, type='bool'),
        store_eager_result=Option(False, type='bool'),
        protocol=Option(2, type='int', old={'celery_task_protocol'}),
        publish_retry=Option(
            True, type='bool', old={'celery_task_publish_retry'},
        ),
        publish_retry_policy=Option(
            {'max_retries': 3,
             'interval_start': 0,
             'interval_max': 1,
             'interval_step': 0.2},
            type='dict', old={'celery_task_publish_retry_policy'},
        ),
        queues=Option(type='dict'),
        queue_max_priority=Option(None, type='int'),
        reject_on_worker_lost=Option(type='bool'),
        remote_tracebacks=Option(False, type='bool'),
        routes=Option(type='any'),
        send_sent_event=Option(
            False, type='bool', old={'celery_send_task_sent_event'},
        ),
        serializer=Option('json', old={'celery_task_serializer'}),
        soft_time_limit=Option(
            type='float', old={'celeryd_task_soft_time_limit'},
        ),
        time_limit=Option(
            type='float', old={'celeryd_task_time_limit'},
        ),
        store_errors_even_if_ignored=Option(False, type='bool'),
        track_started=Option(False, type='bool'),
        allow_error_cb_on_chord_header=Option(False, type='bool'),
    ),
    worker=Namespace(
        __old__=OLD_NS_WORKER,
        agent=Option(None, type='string'),
        autoscaler=Option('celery.worker.autoscale:Autoscaler'),
        cancel_long_running_tasks_on_connection_loss=Option(
            False, type='bool'
        ),
        concurrency=Option(None, type='int'),
        consumer=Option('celery.worker.consumer:Consumer', type='string'),
        direct=Option(False, type='bool', old={'celery_worker_direct'}),
        disable_rate_limits=Option(
            False, type='bool', old={'celery_disable_rate_limits'},
        ),
        deduplicate_successful_tasks=Option(
            False, type='bool'
        ),
        enable_remote_control=Option(
            True, type='bool', old={'celery_enable_remote_control'},
        ),
        hijack_root_logger=Option(True, type='bool'),
        log_color=Option(type='bool'),
        log_format=Option(DEFAULT_PROCESS_LOG_FMT),
        lost_wait=Option(10.0, type='float', old={'celeryd_worker_lost_wait'}),
        max_memory_per_child=Option(type='int'),
        max_tasks_per_child=Option(type='int'),
        pool=Option(DEFAULT_POOL),
        pool_putlocks=Option(True, type='bool'),
        pool_restarts=Option(False, type='bool'),
        proc_alive_timeout=Option(4.0, type='float'),
        prefetch_multiplier=Option(4, type='int'),
        redirect_stdouts=Option(
            True, type='bool', old={'celery_redirect_stdouts'},
        ),
        redirect_stdouts_level=Option(
            'WARNING', old={'celery_redirect_stdouts_level'},
        ),
        send_task_events=Option(
            False, type='bool', old={'celery_send_events'},
        ),
        state_db=Option(),
        task_log_format=Option(DEFAULT_TASK_LOG_FMT),
        timer=Option(type='string'),
        timer_precision=Option(1.0, type='float'),
    ),
)


def _flatten_keys(ns, key, opt):
    return [(ns + key, opt)]


def _to_compat(ns, key, opt):
    if opt.old:
        return [
            (oldkey.format(key).upper(), ns + key, opt)
            for oldkey in opt.old
        ]
    return [((ns + key).upper(), ns + key, opt)]


def flatten(d, root='', keyfilter=_flatten_keys):
    """Flatten settings."""
    stack = deque([(root, d)])
    while stack:
        ns, options = stack.popleft()
        for key, opt in options.items():
            if isinstance(opt, dict):
                stack.append((ns + key + '_', opt))
            else:
                yield from keyfilter(ns, key, opt)


DEFAULTS = {
    key: opt.default for key, opt in flatten(NAMESPACES)
}
__compat = list(flatten(NAMESPACES, keyfilter=_to_compat))
_OLD_DEFAULTS = {old_key: opt.default for old_key, _, opt in __compat}
_TO_OLD_KEY = {new_key: old_key for old_key, new_key, _ in __compat}
_TO_NEW_KEY = {old_key: new_key for old_key, new_key, _ in __compat}
__compat = None

SETTING_KEYS = set(DEFAULTS.keys())
_OLD_SETTING_KEYS = set(_TO_NEW_KEY.keys())


def find_deprecated_settings(source):  # pragma: no cover
    from celery.utils import deprecated
    for name, opt in flatten(NAMESPACES):
        if (opt.deprecate_by or opt.remove_by) and getattr(source, name, None):
            deprecated.warn(description=f'The {name!r} setting',
                            deprecation=opt.deprecate_by,
                            removal=opt.remove_by,
                            alternative=f'Use the {opt.alt} instead')
    return source


@memoize(maxsize=None)
def find(name, namespace='celery'):
    """Find setting by name."""
    # - Try specified name-space first.
    namespace = namespace.lower()
    try:
        return searchresult(
            namespace, name.lower(), NAMESPACES[namespace][name.lower()],
        )
    except KeyError:
        # - Try all the other namespaces.
        for ns, opts in NAMESPACES.items():
            if ns.lower() == name.lower():
                return searchresult(None, ns, opts)
            elif isinstance(opts, dict):
                try:
                    return searchresult(ns, name.lower(), opts[name.lower()])
                except KeyError:
                    pass
    # - See if name is a qualname last.
    return searchresult(None, name.lower(), DEFAULTS[name.lower()])
