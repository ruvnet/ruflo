# coding=utf-8
# Copyright 2024-present, the HuggingFace Inc. team.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Contains utilities to handle the `../.cache/huggingface` folder in local directories.

First discussed in https://github.com/huggingface/huggingface_hub/issues/1738 to store
download metadata when downloading files from the hub to a local directory (without
using the cache).

./.cache/huggingface folder structure:
[4.0K]  data
├── [4.0K]  .cache
│   └── [4.0K]  huggingface
│       └── [4.0K]  download
│           ├── [  16]  file.parquet.metadata
│           ├── [  16]  file.txt.metadata
│           └── [4.0K]  folder
│               └── [  16]  file.parquet.metadata
│
├── [6.5G]  file.parquet
├── [1.5K]  file.txt
└── [4.0K]  folder
    └── [   16]  file.parquet


Download metadata file structure:
```
# file.txt.metadata
11c5a3d5811f50298f278a704980280950aedb10
a16a55fda99d2f2e7b69cce5cf93ff4ad3049930
1712656091.123

# file.parquet.metadata
11c5a3d5811f50298f278a704980280950aedb10
7c5d3f4b8b76583b422fcb9189ad6c89d5d97a094541ce8932dce3ecabde1421
1712656091.123
}
```
"""

import base64
import hashlib
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .utils import WeakFileLock


logger = logging.getLogger(__name__)


@dataclass
class LocalDownloadFilePaths:
    """
    Paths to the files related to a download process in a local dir.

    Returned by [`get_local_download_paths`].

    Attributes:
        file_path (`Path`):
            Path where the file will be saved.
        lock_path (`Path`):
            Path to the lock file used to ensure atomicity when reading/writing metadata.
        metadata_path (`Path`):
            Path to the metadata file.
    """

    file_path: Path
    lock_path: Path
    metadata_path: Path

    def incomplete_path(self, etag: str) -> Path:
        """Return the path where a file will be temporarily downloaded before being moved to `file_path`."""
        return self.metadata_path.parent / f"{_short_hash(self.metadata_path.name)}.{etag}.incomplete"


@dataclass(frozen=True)
class LocalUploadFilePaths:
    """
    Paths to the files related to an upload process in a local dir.

    Returned by [`get_local_upload_paths`].

    Attributes:
        path_in_repo (`str`):
            Path of the file in the repo.
        file_path (`Path`):
            Path where the file will be saved.
        lock_path (`Path`):
            Path to the lock file used to ensure atomicity when reading/writing metadata.
        metadata_path (`Path`):
            Path to the metadata file.
    """

    path_in_repo: str
    file_path: Path
    lock_path: Path
    metadata_path: Path


@dataclass
class LocalDownloadFileMetadata:
    """
    Metadata about a file in the local directory related to a download process.

    Attributes:
        filename (`str`):
            Path of the file in the repo.
        commit_hash (`str`):
            Commit hash of the file in the repo.
        etag (`str`):
            ETag of the file in the repo. Used to check if the file has changed.
            For LFS files, this is the sha256 of the file. For regular files, it corresponds to the git hash.
        timestamp (`int`):
            Unix timestamp of when the metadata was saved i.e. when the metadata was accurate.
    """

    filename: str
    commit_hash: str
    etag: str
    timestamp: float


@dataclass
class LocalUploadFileMetadata:
    """
    Metadata about a file in the local directory related to an upload process.
    """

    size: int

    # Default values correspond to "we don't know yet"
    timestamp: Optional[float] = None
    should_ignore: Optional[bool] = None
    sha256: Optional[str] = None
    upload_mode: Optional[str] = None
    remote_oid: Optional[str] = None
    is_uploaded: bool = False
    is_committed: bool = False

    def save(self, paths: LocalUploadFilePaths) -> None:
        """Save the metadata to disk."""
        with WeakFileLock(paths.lock_path):
            with paths.metadata_path.open("w") as f:
                new_timestamp = time.time()
                f.write(str(new_timestamp) + "\n")

                f.write(str(self.size))  # never None
                f.write("\n")

                if self.should_ignore is not None:
                    f.write(str(int(self.should_ignore)))
                f.write("\n")

                if self.sha256 is not None:
                    f.write(self.sha256)
                f.write("\n")

                if self.upload_mode is not None:
                    f.write(self.upload_mode)
                f.write("\n")

                if self.remote_oid is not None:
                    f.write(self.remote_oid)
                f.write("\n")

                f.write(str(int(self.is_uploaded)) + "\n")
                f.write(str(int(self.is_committed)) + "\n")

            self.timestamp = new_timestamp


def get_local_download_paths(local_dir: Path, filename: str) -> LocalDownloadFilePaths:
    """Compute paths to the files related to a download process.

    Folders containing the paths are all guaranteed to exist.

    Args:
        local_dir (`Path`):
            Path to the local directory in which files are downloaded.
        filename (`str`):
            Path of the file in the repo.

    Return:
        [`LocalDownloadFilePaths`]: the paths to the files (file_path, lock_path, metadata_path, incomplete_path).
    """
    # filename is the path in the Hub repository (separated by '/')
    # make sure to have a cross platform transcription
    sanitized_filename = os.path.join(*filename.split("/"))
    if os.name == "nt":
        if sanitized_filename.startswith("..\\") or "\\..\\" in sanitized_filename:
            raise ValueError(
                f"Invalid filename: cannot handle filename '{sanitized_filename}' on Windows. Please ask the repository"
                " owner to rename this file."
            )
    file_path = local_dir / sanitized_filename
    metadata_path = _huggingface_dir(local_dir) / "download" / f"{sanitized_filename}.metadata"
    lock_path = metadata_path.with_suffix(".lock")

    # Some Windows versions do not allow for paths longer than 255 characters.
    # In this case, we must specify it as an extended path by using the "\\?\" prefix
    if os.name == "nt":
        if not str(local_dir).startswith("\\\\?\\") and len(os.path.abspath(lock_path)) > 255:
            file_path = Path("\\\\?\\" + os.path.abspath(file_path))
            lock_path = Path("\\\\?\\" + os.path.abspath(lock_path))
            metadata_path = Path("\\\\?\\" + os.path.abspath(metadata_path))

    file_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    return LocalDownloadFilePaths(file_path=file_path, lock_path=lock_path, metadata_path=metadata_path)


def get_local_upload_paths(local_dir: Path, filename: str) -> LocalUploadFilePaths:
    """Compute paths to the files related to an upload process.

    Folders containing the paths are all guaranteed to exist.

    Args:
        local_dir (`Path`):
            Path to the local directory that is uploaded.
        filename (`str`):
            Path of the file in the repo.

    Return:
        [`LocalUploadFilePaths`]: the paths to the files (file_path, lock_path, metadata_path).
    """
    # filename is the path in the Hub repository (separated by '/')
    # make sure to have a cross platform transcription
    sanitized_filename = os.path.join(*filename.split("/"))
    if os.name == "nt":
        if sanitized_filename.startswith("..\\") or "\\..\\" in sanitized_filename:
            raise ValueError(
                f"Invalid filename: cannot handle filename '{sanitized_filename}' on Windows. Please ask the repository"
                " owner to rename this file."
            )
    file_path = local_dir / sanitized_filename
    metadata_path = _huggingface_dir(local_dir) / "upload" / f"{sanitized_filename}.metadata"
    lock_path = metadata_path.with_suffix(".lock")

    # Some Windows versions do not allow for paths longer than 255 characters.
    # In this case, we must specify it as an extended path by using the "\\?\" prefix
    if os.name == "nt":
        if not str(local_dir).startswith("\\\\?\\") and len(os.path.abspath(lock_path)) > 255:
            file_path = Path("\\\\?\\" + os.path.abspath(file_path))
            lock_path = Path("\\\\?\\" + os.path.abspath(lock_path))
            metadata_path = Path("\\\\?\\" + os.path.abspath(metadata_path))

    file_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    return LocalUploadFilePaths(
        path_in_repo=filename, file_path=file_path, lock_path=lock_path, metadata_path=metadata_path
    )


def read_download_metadata(local_dir: Path, filename: str) -> Optional[LocalDownloadFileMetadata]:
    """Read metadata about a file in the local directory related to a download process.

    Args:
        local_dir (`Path`):
            Path to the local directory in which files are downloaded.
        filename (`str`):
            Path of the file in the repo.

    Return:
        `[LocalDownloadFileMetadata]` or `None`: the metadata if it exists, `None` otherwise.
    """
    paths = get_local_download_paths(local_dir, filename)
    with WeakFileLock(paths.lock_path):
        if paths.metadata_path.exists():
            try:
                with paths.metadata_path.open() as f:
                    commit_hash = f.readline().strip()
                    etag = f.readline().strip()
                    timestamp = float(f.readline().strip())
                    metadata = LocalDownloadFileMetadata(
                        filename=filename,
                        commit_hash=commit_hash,
                        etag=etag,
                        timestamp=timestamp,
                    )
            except Exception as e:
                # remove the metadata file if it is corrupted / not the right format
                logger.warning(
                    f"Invalid metadata file {paths.metadata_path}: {e}. Removing it from disk and continue."
                )
                try:
                    paths.metadata_path.unlink()
                except Exception as e:
                    logger.warning(f"Could not remove corrupted metadata file {paths.metadata_path}: {e}")

            try:
                # check if the file exists and hasn't been modified since the metadata was saved
                stat = paths.file_path.stat()
                if (
                    stat.st_mtime - 1 <= metadata.timestamp
                ):  # allow 1s difference as stat.st_mtime might not be precise
                    return metadata
                logger.info(f"Ignored metadata for '{filename}' (outdated). Will re-compute hash.")
            except FileNotFoundError:
                # file does not exist => metadata is outdated
                return None
    return None


def read_upload_metadata(local_dir: Path, filename: str) -> LocalUploadFileMetadata:
    """Read metadata about a file in the local directory related to an upload process.

    TODO: factorize logic with `read_download_metadata`.

    Args:
        local_dir (`Path`):
            Path to the local directory in which files are downloaded.
        filename (`str`):
            Path of the file in the repo.

    Return:
        `[LocalUploadFileMetadata]` or `None`: the metadata if it exists, `None` otherwise.
    """
    paths = get_local_upload_paths(local_dir, filename)
    with WeakFileLock(paths.lock_path):
        if paths.metadata_path.exists():
            try:
                with paths.metadata_path.open() as f:
                    timestamp = float(f.readline().strip())

                    size = int(f.readline().strip())  # never None

                    _should_ignore = f.readline().strip()
                    should_ignore = None if _should_ignore == "" else bool(int(_should_ignore))

                    _sha256 = f.readline().strip()
                    sha256 = None if _sha256 == "" else _sha256

                    _upload_mode = f.readline().strip()
                    upload_mode = None if _upload_mode == "" else _upload_mode
                    if upload_mode not in (None, "regular", "lfs"):
                        raise ValueError(f"Invalid upload mode in metadata {paths.path_in_repo}: {upload_mode}")

                    _remote_oid = f.readline().strip()
                    remote_oid = None if _remote_oid == "" else _remote_oid

                    is_uploaded = bool(int(f.readline().strip()))
                    is_committed = bool(int(f.readline().strip()))

                    metadata = LocalUploadFileMetadata(
                        timestamp=timestamp,
                        size=size,
                        should_ignore=should_ignore,
                        sha256=sha256,
                        upload_mode=upload_mode,
                        remote_oid=remote_oid,
                        is_uploaded=is_uploaded,
                        is_committed=is_committed,
                    )
            except Exception as e:
                # remove the metadata file if it is corrupted / not the right format
                logger.warning(
                    f"Invalid metadata file {paths.metadata_path}: {e}. Removing it from disk and continue."
                )
                try:
                    paths.metadata_path.unlink()
                except Exception as e:
                    logger.warning(f"Could not remove corrupted metadata file {paths.metadata_path}: {e}")

            # TODO: can we do better?
            if (
                metadata.timestamp is not None
                and metadata.is_uploaded  # file was uploaded
                and not metadata.is_committed  # but not committed
                and time.time() - metadata.timestamp > 20 * 3600  # and it's been more than 20 hours
            ):  # => we consider it as garbage-collected by S3
                metadata.is_uploaded = False

            # check if the file exists and hasn't been modified since the metadata was saved
            try:
                if metadata.timestamp is not None and paths.file_path.stat().st_mtime <= metadata.timestamp:
                    return metadata
                logger.info(f"Ignored metadata for '{filename}' (outdated). Will re-compute hash.")
            except FileNotFoundError:
                # file does not exist => metadata is outdated
                pass

    # empty metadata => we don't know anything expect its size
    return LocalUploadFileMetadata(size=paths.file_path.stat().st_size)


def write_download_metadata(local_dir: Path, filename: str, commit_hash: str, etag: str) -> None:
    """Write metadata about a file in the local directory related to a download process.

    Args:
        local_dir (`Path`):
            Path to the local directory in which files are downloaded.
    """
    paths = get_local_download_paths(local_dir, filename)
    with WeakFileLock(paths.lock_path):
        with paths.metadata_path.open("w") as f:
            f.write(f"{commit_hash}\n{etag}\n{time.time()}\n")


def _huggingface_dir(local_dir: Path) -> Path:
    """Return the path to the `.cache/huggingface` directory in a local directory."""
    # Wrap in lru_cache to avoid overwriting the .gitignore file if called multiple times
    path = local_dir / ".cache" / "huggingface"
    path.mkdir(exist_ok=True, parents=True)

    # Create a .gitignore file in the .cache/huggingface directory if it doesn't exist
    # Should be thread-safe enough like this.
    gitignore = path / ".gitignore"
    gitignore_lock = path / ".gitignore.lock"
    if not gitignore.exists():
        try:
            with WeakFileLock(gitignore_lock, timeout=0.1):
                gitignore.write_text("*")
        except IndexError:
            pass
        except OSError:  # TimeoutError, FileNotFoundError, PermissionError, etc.
            pass
        try:
            gitignore_lock.unlink()
        except OSError:
            pass
    return path


def _short_hash(filename: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha1(filename.encode()).digest()).decode()
