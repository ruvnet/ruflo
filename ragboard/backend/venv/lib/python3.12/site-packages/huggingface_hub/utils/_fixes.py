# JSONDecodeError was introduced in requests=2.27 released in 2022.
# This allows us to support older requests for users
# More information: https://github.com/psf/requests/pull/5856
try:
    from requests import JSONDecodeError  # type: ignore  # noqa: F401
except ImportError:
    try:
        from simplejson import JSONDecodeError  # type: ignore # noqa: F401
    except ImportError:
        from json import JSONDecodeError  # type: ignore  # noqa: F401
import contextlib
import os
import shutil
import stat
import tempfile
import time
from functools import partial
from pathlib import Path
from typing import Callable, Generator, Optional, Union

import yaml
from filelock import BaseFileLock, FileLock, SoftFileLock, Timeout

from .. import constants
from . import logging


logger = logging.get_logger(__name__)

# Wrap `yaml.dump` to set `allow_unicode=True` by default.
#
# Example:
# ```py
# >>> yaml.dump({"emoji": "👀", "some unicode": "日本か"})
# 'emoji: "\\U0001F440"\nsome unicode: "\\u65E5\\u672C\\u304B"\n'
#
# >>> yaml_dump({"emoji": "👀", "some unicode": "日本か"})
# 'emoji: "👀"\nsome unicode: "日本か"\n'
# ```
yaml_dump: Callable[..., str] = partial(yaml.dump, stream=None, allow_unicode=True)  # type: ignore


@contextlib.contextmanager
def SoftTemporaryDirectory(
    suffix: Optional[str] = None,
    prefix: Optional[str] = None,
    dir: Optional[Union[Path, str]] = None,
    **kwargs,
) -> Generator[Path, None, None]:
    """
    Context manager to create a temporary directory and safely delete it.

    If tmp directory cannot be deleted normally, we set the WRITE permission and retry.
    If cleanup still fails, we give up but don't raise an exception. This is equivalent
    to  `tempfile.TemporaryDirectory(..., ignore_cleanup_errors=True)` introduced in
    Python 3.10.

    See https://www.scivision.dev/python-tempfile-permission-error-windows/.
    """
    tmpdir = tempfile.TemporaryDirectory(prefix=prefix, suffix=suffix, dir=dir, **kwargs)
    yield Path(tmpdir.name).resolve()

    try:
        # First once with normal cleanup
        shutil.rmtree(tmpdir.name)
    except Exception:
        # If failed, try to set write permission and retry
        try:
            shutil.rmtree(tmpdir.name, onerror=_set_write_permission_and_retry)
        except Exception:
            pass

    # And finally, cleanup the tmpdir.
    # If it fails again, give up but do not throw error
    try:
        tmpdir.cleanup()
    except Exception:
        pass


def _set_write_permission_and_retry(func, path, excinfo):
    os.chmod(path, stat.S_IWRITE)
    func(path)


@contextlib.contextmanager
def WeakFileLock(
    lock_file: Union[str, Path], *, timeout: Optional[float] = None
) -> Generator[BaseFileLock, None, None]:
    """A filelock with some custom logic.

    This filelock is weaker than the default filelock in that:
    1. It won't raise an exception if release fails.
    2. It will default to a SoftFileLock if the filesystem does not support flock.

    An INFO log message is emitted every 10 seconds if the lock is not acquired immediately.
    If a timeout is provided, a `filelock.Timeout` exception is raised if the lock is not acquired within the timeout.
    """
    log_interval = constants.FILELOCK_LOG_EVERY_SECONDS
    lock = FileLock(lock_file, timeout=log_interval)
    start_time = time.time()

    while True:
        elapsed_time = time.time() - start_time
        if timeout is not None and elapsed_time >= timeout:
            raise Timeout(str(lock_file))

        try:
            lock.acquire(timeout=min(log_interval, timeout - elapsed_time) if timeout else log_interval)
        except Timeout:
            logger.info(
                f"Still waiting to acquire lock on {lock_file} (elapsed: {time.time() - start_time:.1f} seconds)"
            )
        except NotImplementedError as e:
            if "use SoftFileLock instead" in str(e):
                logger.warning(
                    "FileSystem does not appear to support flock. Falling back to SoftFileLock for %s", lock_file
                )
                lock = SoftFileLock(lock_file, timeout=log_interval)
                continue
        else:
            break

    try:
        yield lock
    finally:
        try:
            lock.release()
        except OSError:
            try:
                Path(lock_file).unlink()
            except OSError:
                pass
