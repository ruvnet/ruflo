import atexit
import logging
import os
import time
from concurrent.futures import Future
from dataclasses import dataclass
from io import SEEK_END, SEEK_SET, BytesIO
from pathlib import Path
from threading import Lock, Thread
from typing import Dict, List, Optional, Union

from .hf_api import DEFAULT_IGNORE_PATTERNS, CommitInfo, CommitOperationAdd, HfApi
from .utils import filter_repo_objects


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _FileToUpload:
    """Temporary dataclass to store info about files to upload. Not meant to be used directly."""

    local_path: Path
    path_in_repo: str
    size_limit: int
    last_modified: float


class CommitScheduler:
    """
    Scheduler to upload a local folder to the Hub at regular intervals (e.g. push to hub every 5 minutes).

    The recommended way to use the scheduler is to use it as a context manager. This ensures that the scheduler is
    properly stopped and the last commit is triggered when the script ends. The scheduler can also be stopped manually
    with the `stop` method. Checkout the [upload guide](https://huggingface.co/docs/huggingface_hub/guides/upload#scheduled-uploads)
    to learn more about how to use it.

    Args:
        repo_id (`str`):
            The id of the repo to commit to.
        folder_path (`str` or `Path`):
            Path to the local folder to upload regularly.
        every (`int` or `float`, *optional*):
            The number of minutes between each commit. Defaults to 5 minutes.
        path_in_repo (`str`, *optional*):
            Relative path of the directory in the repo, for example: `"checkpoints/"`. Defaults to the root folder
            of the repository.
        repo_type (`str`, *optional*):
            The type of the repo to commit to. Defaults to `model`.
        revision (`str`, *optional*):
            The revision of the repo to commit to. Defaults to `main`.
        private (`bool`, *optional*):
            Whether to make the repo private. If `None` (default), the repo will be public unless the organization's default is private. This value is ignored if the repo already exists.
        token (`str`, *optional*):
            The token to use to commit to the repo. Defaults to the token saved on the machine.
        allow_patterns (`List[str]` or `str`, *optional*):
            If provided, only files matching at least one pattern are uploaded.
        ignore_patterns (`List[str]` or `str`, *optional*):
            If provided, files matching any of the patterns are not uploaded.
        squash_history (`bool`, *optional*):
            Whether to squash the history of the repo after each commit. Defaults to `False`. Squashing commits is
            useful to avoid degraded performances on the repo when it grows too large.
        hf_api (`HfApi`, *optional*):
            The [`HfApi`] client to use to commit to the Hub. Can be set with custom settings (user agent, token,...).

    Example:
    ```py
    >>> from pathlib import Path
    >>> from huggingface_hub import CommitScheduler

    # Scheduler uploads every 10 minutes
    >>> csv_path = Path("watched_folder/data.csv")
    >>> CommitScheduler(repo_id="test_scheduler", repo_type="dataset", folder_path=csv_path.parent, every=10)

    >>> with csv_path.open("a") as f:
    ...     f.write("first line")

    # Some time later (...)
    >>> with csv_path.open("a") as f:
    ...     f.write("second line")
    ```

    Example using a context manager:
    ```py
    >>> from pathlib import Path
    >>> from huggingface_hub import CommitScheduler

    >>> with CommitScheduler(repo_id="test_scheduler", repo_type="dataset", folder_path="watched_folder", every=10) as scheduler:
    ...     csv_path = Path("watched_folder/data.csv")
    ...     with csv_path.open("a") as f:
    ...         f.write("first line")
    ...     (...)
    ...     with csv_path.open("a") as f:
    ...         f.write("second line")

    # Scheduler is now stopped and last commit have been triggered
    ```
    """

    def __init__(
        self,
        *,
        repo_id: str,
        folder_path: Union[str, Path],
        every: Union[int, float] = 5,
        path_in_repo: Optional[str] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        private: Optional[bool] = None,
        token: Optional[str] = None,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        squash_history: bool = False,
        hf_api: Optional["HfApi"] = None,
    ) -> None:
        self.api = hf_api or HfApi(token=token)

        # Folder
        self.folder_path = Path(folder_path).expanduser().resolve()
        self.path_in_repo = path_in_repo or ""
        self.allow_patterns = allow_patterns

        if ignore_patterns is None:
            ignore_patterns = []
        elif isinstance(ignore_patterns, str):
            ignore_patterns = [ignore_patterns]
        self.ignore_patterns = ignore_patterns + DEFAULT_IGNORE_PATTERNS

        if self.folder_path.is_file():
            raise ValueError(f"'folder_path' must be a directory, not a file: '{self.folder_path}'.")
        self.folder_path.mkdir(parents=True, exist_ok=True)

        # Repository
        repo_url = self.api.create_repo(repo_id=repo_id, private=private, repo_type=repo_type, exist_ok=True)
        self.repo_id = repo_url.repo_id
        self.repo_type = repo_type
        self.revision = revision
        self.token = token

        # Keep track of already uploaded files
        self.last_uploaded: Dict[Path, float] = {}  # key is local path, value is timestamp

        # Scheduler
        if not every > 0:
            raise ValueError(f"'every' must be a positive integer, not '{every}'.")
        self.lock = Lock()
        self.every = every
        self.squash_history = squash_history

        logger.info(f"Scheduled job to push '{self.folder_path}' to '{self.repo_id}' every {self.every} minutes.")
        self._scheduler_thread = Thread(target=self._run_scheduler, daemon=True)
        self._scheduler_thread.start()
        atexit.register(self._push_to_hub)

        self.__stopped = False

    def stop(self) -> None:
        """Stop the scheduler.

        A stopped scheduler cannot be restarted. Mostly for tests purposes.
        """
        self.__stopped = True

    def __enter__(self) -> "CommitScheduler":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        # Upload last changes before exiting
        self.trigger().result()
        self.stop()
        return

    def _run_scheduler(self) -> None:
        """Dumb thread waiting between each scheduled push to Hub."""
        while True:
            self.last_future = self.trigger()
            time.sleep(self.every * 60)
            if self.__stopped:
                break

    def trigger(self) -> Future:
        """Trigger a `push_to_hub` and return a future.

        This method is automatically called every `every` minutes. You can also call it manually to trigger a commit
        immediately, without waiting for the next scheduled commit.
        """
        return self.api.run_as_future(self._push_to_hub)

    def _push_to_hub(self) -> Optional[CommitInfo]:
        if self.__stopped:  # If stopped, already scheduled commits are ignored
            return None

        logger.info("(Background) scheduled commit triggered.")
        try:
            value = self.push_to_hub()
            if self.squash_history:
                logger.info("(Background) squashing repo history.")
                self.api.super_squash_history(repo_id=self.repo_id, repo_type=self.repo_type, branch=self.revision)
            return value
        except Exception as e:
            logger.error(f"Error while pushing to Hub: {e}")  # Depending on the setup, error might be silenced
            raise

    def push_to_hub(self) -> Optional[CommitInfo]:
        """
        Push folder to the Hub and return the commit info.

        <Tip warning={true}>

        This method is not meant to be called directly. It is run in the background by the scheduler, respecting a
        queue mechanism to avoid concurrent commits. Making a direct call to the method might lead to concurrency
        issues.

        </Tip>

        The default behavior of `push_to_hub` is to assume an append-only folder. It lists all files in the folder and
        uploads only changed files. If no changes are found, the method returns without committing anything. If you want
        to change this behavior, you can inherit from [`CommitScheduler`] and override this method. This can be useful
        for example to compress data together in a single file before committing. For more details and examples, check
        out our [integration guide](https://huggingface.co/docs/huggingface_hub/main/en/guides/upload#scheduled-uploads).
        """
        # Check files to upload (with lock)
        with self.lock:
            logger.debug("Listing files to upload for scheduled commit.")

            # List files from folder (taken from `_prepare_upload_folder_additions`)
            relpath_to_abspath = {
                path.relative_to(self.folder_path).as_posix(): path
                for path in sorted(self.folder_path.glob("**/*"))  # sorted to be deterministic
                if path.is_file()
            }
            prefix = f"{self.path_in_repo.strip('/')}/" if self.path_in_repo else ""

            # Filter with pattern + filter out unchanged files + retrieve current file size
            files_to_upload: List[_FileToUpload] = []
            for relpath in filter_repo_objects(
                relpath_to_abspath.keys(), allow_patterns=self.allow_patterns, ignore_patterns=self.ignore_patterns
            ):
                local_path = relpath_to_abspath[relpath]
                stat = local_path.stat()
                if self.last_uploaded.get(local_path) is None or self.last_uploaded[local_path] != stat.st_mtime:
                    files_to_upload.append(
                        _FileToUpload(
                            local_path=local_path,
                            path_in_repo=prefix + relpath,
                            size_limit=stat.st_size,
                            last_modified=stat.st_mtime,
                        )
                    )

        # Return if nothing to upload
        if len(files_to_upload) == 0:
            logger.debug("Dropping schedule commit: no changed file to upload.")
            return None

        # Convert `_FileToUpload` as `CommitOperationAdd` (=> compute file shas + limit to file size)
        logger.debug("Removing unchanged files since previous scheduled commit.")
        add_operations = [
            CommitOperationAdd(
                # Cap the file to its current size, even if the user append data to it while a scheduled commit is happening
                path_or_fileobj=PartialFileIO(file_to_upload.local_path, size_limit=file_to_upload.size_limit),
                path_in_repo=file_to_upload.path_in_repo,
            )
            for file_to_upload in files_to_upload
        ]

        # Upload files (append mode expected - no need for lock)
        logger.debug("Uploading files for scheduled commit.")
        commit_info = self.api.create_commit(
            repo_id=self.repo_id,
            repo_type=self.repo_type,
            operations=add_operations,
            commit_message="Scheduled Commit",
            revision=self.revision,
        )

        # Successful commit: keep track of the latest "last_modified" for each file
        for file in files_to_upload:
            self.last_uploaded[file.local_path] = file.last_modified
        return commit_info


class PartialFileIO(BytesIO):
    """A file-like object that reads only the first part of a file.

    Useful to upload a file to the Hub when the user might still be appending data to it. Only the first part of the
    file is uploaded (i.e. the part that was available when the filesystem was first scanned).

    In practice, only used internally by the CommitScheduler to regularly push a folder to the Hub with minimal
    disturbance for the user. The object is passed to `CommitOperationAdd`.

    Only supports `read`, `tell` and `seek` methods.

    Args:
        file_path (`str` or `Path`):
            Path to the file to read.
        size_limit (`int`):
            The maximum number of bytes to read from the file. If the file is larger than this, only the first part
            will be read (and uploaded).
    """

    def __init__(self, file_path: Union[str, Path], size_limit: int) -> None:
        self._file_path = Path(file_path)
        self._file = self._file_path.open("rb")
        self._size_limit = min(size_limit, os.fstat(self._file.fileno()).st_size)

    def __del__(self) -> None:
        self._file.close()
        return super().__del__()

    def __repr__(self) -> str:
        return f"<PartialFileIO file_path={self._file_path} size_limit={self._size_limit}>"

    def __len__(self) -> int:
        return self._size_limit

    def __getattribute__(self, name: str):
        if name.startswith("_") or name in ("read", "tell", "seek"):  # only 3 public methods supported
            return super().__getattribute__(name)
        raise NotImplementedError(f"PartialFileIO does not support '{name}'.")

    def tell(self) -> int:
        """Return the current file position."""
        return self._file.tell()

    def seek(self, __offset: int, __whence: int = SEEK_SET) -> int:
        """Change the stream position to the given offset.

        Behavior is the same as a regular file, except that the position is capped to the size limit.
        """
        if __whence == SEEK_END:
            # SEEK_END => set from the truncated end
            __offset = len(self) + __offset
            __whence = SEEK_SET

        pos = self._file.seek(__offset, __whence)
        if pos > self._size_limit:
            return self._file.seek(self._size_limit)
        return pos

    def read(self, __size: Optional[int] = -1) -> bytes:
        """Read at most `__size` bytes from the file.

        Behavior is the same as a regular file, except that it is capped to the size limit.
        """
        current = self._file.tell()
        if __size is None or __size < 0:
            # Read until file limit
            truncated_size = self._size_limit - current
        else:
            # Read until file limit or __size
            truncated_size = min(__size, self._size_limit - current)
        return self._file.read(truncated_size)
