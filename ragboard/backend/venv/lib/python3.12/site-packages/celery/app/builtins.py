"""Built-in Tasks.

The built-in tasks are always available in all app instances.
"""
from celery._state import connect_on_app_finalize
from celery.utils.log import get_logger

__all__ = ()
logger = get_logger(__name__)


@connect_on_app_finalize
def add_backend_cleanup_task(app):
    """Task used to clean up expired results.

    If the configured backend requires periodic cleanup this task is also
    automatically configured to run every day at 4am (requires
    :program:`celery beat` to be running).
    """
    @app.task(name='celery.backend_cleanup', shared=False, lazy=False)
    def backend_cleanup():
        app.backend.cleanup()
    return backend_cleanup


@connect_on_app_finalize
def add_accumulate_task(app):
    """Task used by Task.replace when replacing task with group."""
    @app.task(bind=True, name='celery.accumulate', shared=False, lazy=False)
    def accumulate(self, *args, **kwargs):
        index = kwargs.get('index')
        return args[index] if index is not None else args
    return accumulate


@connect_on_app_finalize
def add_unlock_chord_task(app):
    """Task used by result backends without native chord support.

    Will joins chord by creating a task chain polling the header
    for completion.
    """
    from celery.canvas import maybe_signature
    from celery.exceptions import ChordError
    from celery.result import allow_join_result, result_from_tuple

    @app.task(name='celery.chord_unlock', max_retries=None, shared=False,
              default_retry_delay=app.conf.result_chord_retry_interval, ignore_result=True, lazy=False, bind=True)
    def unlock_chord(self, group_id, callback, interval=None,
                     max_retries=None, result=None,
                     Result=app.AsyncResult, GroupResult=app.GroupResult,
                     result_from_tuple=result_from_tuple, **kwargs):
        if interval is None:
            interval = self.default_retry_delay

        # check if the task group is ready, and if so apply the callback.
        callback = maybe_signature(callback, app)
        deps = GroupResult(
            group_id,
            [result_from_tuple(r, app=app) for r in result],
            app=app,
        )
        j = deps.join_native if deps.supports_native_join else deps.join

        try:
            ready = deps.ready()
        except Exception as exc:
            raise self.retry(
                exc=exc, countdown=interval, max_retries=max_retries,
            )
        else:
            if not ready:
                raise self.retry(countdown=interval, max_retries=max_retries)

        callback = maybe_signature(callback, app=app)
        try:
            with allow_join_result():
                ret = j(
                    timeout=app.conf.result_chord_join_timeout,
                    propagate=True,
                )
        except Exception as exc:  # pylint: disable=broad-except
            try:
                culprit = next(deps._failed_join_report())
                reason = f'Dependency {culprit.id} raised {exc!r}'
            except StopIteration:
                reason = repr(exc)
            logger.exception('Chord %r raised: %r', group_id, exc)
            app.backend.chord_error_from_stack(callback, ChordError(reason))
        else:
            try:
                callback.delay(ret)
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception('Chord %r raised: %r', group_id, exc)
                app.backend.chord_error_from_stack(
                    callback,
                    exc=ChordError(f'Callback error: {exc!r}'),
                )
    return unlock_chord


@connect_on_app_finalize
def add_map_task(app):
    from celery.canvas import signature

    @app.task(name='celery.map', shared=False, lazy=False)
    def xmap(task, it):
        task = signature(task, app=app).type
        return [task(item) for item in it]
    return xmap


@connect_on_app_finalize
def add_starmap_task(app):
    from celery.canvas import signature

    @app.task(name='celery.starmap', shared=False, lazy=False)
    def xstarmap(task, it):
        task = signature(task, app=app).type
        return [task(*item) for item in it]
    return xstarmap


@connect_on_app_finalize
def add_chunk_task(app):
    from celery.canvas import chunks as _chunks

    @app.task(name='celery.chunks', shared=False, lazy=False)
    def chunks(task, it, n):
        return _chunks.apply_chunks(task, it, n)
    return chunks


@connect_on_app_finalize
def add_group_task(app):
    """No longer used, but here for backwards compatibility."""
    from celery.canvas import maybe_signature
    from celery.result import result_from_tuple

    @app.task(name='celery.group', bind=True, shared=False, lazy=False)
    def group(self, tasks, result, group_id, partial_args, add_to_parent=True):
        app = self.app
        result = result_from_tuple(result, app)
        # any partial args are added to all tasks in the group
        taskit = (maybe_signature(task, app=app).clone(partial_args)
                  for i, task in enumerate(tasks))
        with app.producer_or_acquire() as producer:
            [stask.apply_async(group_id=group_id, producer=producer,
                               add_to_parent=False) for stask in taskit]
        parent = app.current_worker_task
        if add_to_parent and parent:
            parent.add_trail(result)
        return result
    return group


@connect_on_app_finalize
def add_chain_task(app):
    """No longer used, but here for backwards compatibility."""
    @app.task(name='celery.chain', shared=False, lazy=False)
    def chain(*args, **kwargs):
        raise NotImplementedError('chain is not a real task')
    return chain


@connect_on_app_finalize
def add_chord_task(app):
    """No longer used, but here for backwards compatibility."""
    from celery import chord as _chord
    from celery import group
    from celery.canvas import maybe_signature

    @app.task(name='celery.chord', bind=True, ignore_result=False,
              shared=False, lazy=False)
    def chord(self, header, body, partial_args=(), interval=None,
              countdown=1, max_retries=None, eager=False, **kwargs):
        app = self.app
        # - convert back to group if serialized
        tasks = header.tasks if isinstance(header, group) else header
        header = group([
            maybe_signature(s, app=app) for s in tasks
        ], app=self.app)
        body = maybe_signature(body, app=app)
        ch = _chord(header, body)
        return ch.run(header, body, partial_args, app, interval,
                      countdown, max_retries, **kwargs)
    return chord
