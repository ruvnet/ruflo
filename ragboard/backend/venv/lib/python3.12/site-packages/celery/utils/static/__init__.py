"""Static files."""
import os


def get_file(*args):
    # type: (*str) -> str
    """Get filename for static file."""
    return os.path.join(os.path.abspath(os.path.dirname(__file__)), *args)


def logo():
    # type: () -> bytes
    """Celery logo image."""
    return get_file('celery_128.png')
