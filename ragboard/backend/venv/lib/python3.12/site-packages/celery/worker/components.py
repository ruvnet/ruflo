"""Worker-level Bootsteps."""
import atexit
import warnings

from kombu.asynchronous import Hub as _Hub
from kombu.asynchronous import get_event_loop, set_event_loop
from kombu.asynchronous.semaphore import DummyLock, LaxBoundedSemaphore
from kombu.asynchronous.timer import Timer as _Timer

from celery import bootsteps
from celery._state import _set_task_join_will_block
from celery.exceptions import ImproperlyConfigured
from celery.platforms import IS_WINDOWS
from celery.utils.log import worker_logger as logger

__all__ = ('Timer', 'Hub', 'Pool', 'Beat', 'StateDB', 'Consumer')

GREEN_POOLS = {'eventlet', 'gevent'}

ERR_B_GREEN = """\
-B option doesn't work with eventlet/gevent pools: \
use standalone beat instead.\
"""

W_POOL_SETTING = """
The worker_pool setting shouldn't be used to select the eventlet/gevent
pools, instead you *must use the -P* argument so that patches are applied
as early as possible.
"""


class Timer(bootsteps.Step):
    """Timer bootstep."""

    def create(self, w):
        if w.use_eventloop:
            # does not use dedicated timer thread.
            w.timer = _Timer(max_interval=10.0)
        else:
            if not w.timer_cls:
                # Default Timer is set by the pool, as for example, the
                # eventlet pool needs a custom timer implementation.
                w.timer_cls = w.pool_cls.Timer
            w.timer = self.instantiate(w.timer_cls,
                                       max_interval=w.timer_precision,
                                       on_error=self.on_timer_error,
                                       on_tick=self.on_timer_tick)

    def on_timer_error(self, exc):
        logger.error('Timer error: %r', exc, exc_info=True)

    def on_timer_tick(self, delay):
        logger.debug('Timer wake-up! Next ETA %s secs.', delay)


class Hub(bootsteps.StartStopStep):
    """Worker starts the event loop."""

    requires = (Timer,)

    def __init__(self, w, **kwargs):
        w.hub = None
        super().__init__(w, **kwargs)

    def include_if(self, w):
        return w.use_eventloop

    def create(self, w):
        w.hub = get_event_loop()
        if w.hub is None:
            required_hub = getattr(w._conninfo, 'requires_hub', None)
            w.hub = set_event_loop((
                required_hub if required_hub else _Hub)(w.timer))
        self._patch_thread_primitives(w)
        return self

    def start(self, w):
        pass

    def stop(self, w):
        w.hub.close()

    def terminate(self, w):
        w.hub.close()

    def _patch_thread_primitives(self, w):
        # make clock use dummy lock
        w.app.clock.mutex = DummyLock()
        # multiprocessing's ApplyResult uses this lock.
        try:
            from billiard import pool
        except ImportError:
            pass
        else:
            pool.Lock = DummyLock


class Pool(bootsteps.StartStopStep):
    """Bootstep managing the worker pool.

    Describes how to initialize the worker pool, and starts and stops
    the pool during worker start-up/shutdown.

    Adds attributes:

        * autoscale
        * pool
        * max_concurrency
        * min_concurrency
    """

    requires = (Hub,)

    def __init__(self, w, autoscale=None, **kwargs):
        w.pool = None
        w.max_concurrency = None
        w.min_concurrency = w.concurrency
        self.optimization = w.optimization
        if isinstance(autoscale, str):
            max_c, _, min_c = autoscale.partition(',')
            autoscale = [int(max_c), min_c and int(min_c) or 0]
        w.autoscale = autoscale
        if w.autoscale:
            w.max_concurrency, w.min_concurrency = w.autoscale
        super().__init__(w, **kwargs)

    def close(self, w):
        if w.pool:
            w.pool.close()

    def terminate(self, w):
        if w.pool:
            w.pool.terminate()

    def create(self, w):
        semaphore = None
        max_restarts = None
        if w.app.conf.worker_pool in GREEN_POOLS:  # pragma: no cover
            warnings.warn(UserWarning(W_POOL_SETTING))
        threaded = not w.use_eventloop or IS_WINDOWS
        procs = w.min_concurrency
        w.process_task = w._process_task
        if not threaded:
            semaphore = w.semaphore = LaxBoundedSemaphore(procs)
            w._quick_acquire = w.semaphore.acquire
            w._quick_release = w.semaphore.release
            max_restarts = 100
            if w.pool_putlocks and w.pool_cls.uses_semaphore:
                w.process_task = w._process_task_sem
        allow_restart = w.pool_restarts
        pool = w.pool = self.instantiate(
            w.pool_cls, w.min_concurrency,
            initargs=(w.app, w.hostname),
            maxtasksperchild=w.max_tasks_per_child,
            max_memory_per_child=w.max_memory_per_child,
            timeout=w.time_limit,
            soft_timeout=w.soft_time_limit,
            putlocks=w.pool_putlocks and threaded,
            lost_worker_timeout=w.worker_lost_wait,
            threads=threaded,
            max_restarts=max_restarts,
            allow_restart=allow_restart,
            forking_enable=True,
            semaphore=semaphore,
            sched_strategy=self.optimization,
            app=w.app,
        )
        _set_task_join_will_block(pool.task_join_will_block)
        return pool

    def info(self, w):
        return {'pool': w.pool.info if w.pool else 'N/A'}

    def register_with_event_loop(self, w, hub):
        w.pool.register_with_event_loop(hub)


class Beat(bootsteps.StartStopStep):
    """Step used to embed a beat process.

    Enabled when the ``beat`` argument is set.
    """

    label = 'Beat'
    conditional = True

    def __init__(self, w, beat=False, **kwargs):
        self.enabled = w.beat = beat
        w.beat = None
        super().__init__(w, beat=beat, **kwargs)

    def create(self, w):
        from celery.beat import EmbeddedService
        if w.pool_cls.__module__.endswith(('gevent', 'eventlet')):
            raise ImproperlyConfigured(ERR_B_GREEN)
        b = w.beat = EmbeddedService(w.app,
                                     schedule_filename=w.schedule_filename,
                                     scheduler_cls=w.scheduler)
        return b


class StateDB(bootsteps.Step):
    """Bootstep that sets up between-restart state database file."""

    def __init__(self, w, **kwargs):
        self.enabled = w.statedb
        w._persistence = None
        super().__init__(w, **kwargs)

    def create(self, w):
        w._persistence = w.state.Persistent(w.state, w.statedb, w.app.clock)
        atexit.register(w._persistence.save)


class Consumer(bootsteps.StartStopStep):
    """Bootstep starting the Consumer blueprint."""

    last = True

    def create(self, w):
        if w.max_concurrency:
            prefetch_count = max(w.max_concurrency, 1) * w.prefetch_multiplier
        else:
            prefetch_count = w.concurrency * w.prefetch_multiplier
        c = w.consumer = self.instantiate(
            w.consumer_cls, w.process_task,
            hostname=w.hostname,
            task_events=w.task_events,
            init_callback=w.ready_callback,
            initial_prefetch_count=prefetch_count,
            pool=w.pool,
            timer=w.timer,
            app=w.app,
            controller=w,
            hub=w.hub,
            worker_options=w.options,
            disable_rate_limits=w.disable_rate_limits,
            prefetch_multiplier=w.prefetch_multiplier,
        )
        return c
