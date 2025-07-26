"""Tasks auto-retry functionality."""
from vine.utils import wraps

from celery.exceptions import Ignore, Retry
from celery.utils.time import get_exponential_backoff_interval


def add_autoretry_behaviour(task, **options):
    """Wrap task's `run` method with auto-retry functionality."""
    autoretry_for = tuple(
        options.get('autoretry_for',
                    getattr(task, 'autoretry_for', ()))
    )
    dont_autoretry_for = tuple(
        options.get('dont_autoretry_for',
                    getattr(task, 'dont_autoretry_for', ()))
    )
    retry_kwargs = options.get(
        'retry_kwargs', getattr(task, 'retry_kwargs', {})
    )
    retry_backoff = float(
        options.get('retry_backoff',
                    getattr(task, 'retry_backoff', False))
    )
    retry_backoff_max = int(
        options.get('retry_backoff_max',
                    getattr(task, 'retry_backoff_max', 600))
    )
    retry_jitter = options.get(
        'retry_jitter', getattr(task, 'retry_jitter', True)
    )

    if autoretry_for and not hasattr(task, '_orig_run'):

        @wraps(task.run)
        def run(*args, **kwargs):
            try:
                return task._orig_run(*args, **kwargs)
            except Ignore:
                # If Ignore signal occurs task shouldn't be retried,
                # even if it suits autoretry_for list
                raise
            except Retry:
                raise
            except dont_autoretry_for:
                raise
            except autoretry_for as exc:
                if retry_backoff:
                    retry_kwargs['countdown'] = \
                        get_exponential_backoff_interval(
                            factor=int(max(1.0, retry_backoff)),
                            retries=task.request.retries,
                            maximum=retry_backoff_max,
                            full_jitter=retry_jitter)
                # Override max_retries
                if hasattr(task, 'override_max_retries'):
                    retry_kwargs['max_retries'] = getattr(task,
                                                          'override_max_retries',
                                                          task.max_retries)
                ret = task.retry(exc=exc, **retry_kwargs)
                # Stop propagation
                if hasattr(task, 'override_max_retries'):
                    delattr(task, 'override_max_retries')
                raise ret

        task._orig_run, task.run = task.run, run
