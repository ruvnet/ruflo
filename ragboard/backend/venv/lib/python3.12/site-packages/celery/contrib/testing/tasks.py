"""Helper tasks for integration tests."""
from celery import shared_task


@shared_task(name='celery.ping')
def ping():
    # type: () -> str
    """Simple task that just returns 'pong'."""
    return 'pong'
