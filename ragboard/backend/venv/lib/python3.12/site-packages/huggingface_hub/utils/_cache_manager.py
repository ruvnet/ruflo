# coding=utf-8
# Copyright 2022-present, the HuggingFace Inc. team.
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
"""Contains utilities to manage the HF cache directory."""

import os
import shutil
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, FrozenSet, List, Literal, Optional, Set, Union

from huggingface_hub.errors import CacheNotFound, CorruptedCacheException

from ..commands._cli_utils import tabulate
from ..constants import HF_HUB_CACHE
from . import logging


logger = logging.get_logger(__name__)

REPO_TYPE_T = Literal["model", "dataset", "space"]

# List of OS-created helper files that need to be ignored
FILES_TO_IGNORE = [".DS_Store"]


@dataclass(frozen=True)
class CachedFileInfo:
    """Frozen data structure holding information about a single cached file.

    Args:
        file_name (`str`):
            Name of the file. Example: `config.json`.
        file_path (`Path`):
            Path of the file in the `snapshots` directory. The file path is a symlink
            referring to a blob in the `blobs` folder.
        blob_path (`Path`):
            Path of the blob file. This is equivalent to `file_path.resolve()`.
        size_on_disk (`int`):
            Size of the blob file in bytes.
        blob_last_accessed (`float`):
            Timestamp of the last time the blob file has been accessed (from any
            revision).
        blob_last_modified (`float`):
            Timestamp of the last time the blob file has been modified/created.

    <Tip warning={true}>

    `blob_last_accessed` and `blob_last_modified` reliability can depend on the OS you
    are using. See [python documentation](https://docs.python.org/3/library/os.html#os.stat_result)
    for more details.

    </Tip>
    """

    file_name: str
    file_path: Path
    blob_path: Path
    size_on_disk: int

    blob_last_accessed: float
    blob_last_modified: float

    @property
    def blob_last_accessed_str(self) -> str:
        """
        (property) Timestamp of the last time the blob file has been accessed (from any
        revision), returned as a human-readable string.

        Example: "2 weeks ago".
        """
        return _format_timesince(self.blob_last_accessed)

    @property
    def blob_last_modified_str(self) -> str:
        """
        (property) Timestamp of the last time the blob file has been modified, returned
        as a human-readable string.

        Example: "2 weeks ago".
        """
        return _format_timesince(self.blob_last_modified)

    @property
    def size_on_disk_str(self) -> str:
        """
        (property) Size of the blob file as a human-readable string.

        Example: "42.2K".
        """
        return _format_size(self.size_on_disk)


@dataclass(frozen=True)
class CachedRevisionInfo:
    """Frozen data structure holding information about a revision.

    A revision correspond to a folder in the `snapshots` folder and is populated with
    the exact tree structure as the repo on the Hub but contains only symlinks. A
    revision can be either referenced by 1 or more `refs` or be "detached" (no refs).

    Args:
        commit_hash (`str`):
            Hash of the revision (unique).
            Example: `"9338f7b671827df886678df2bdd7cc7b4f36dffd"`.
        snapshot_path (`Path`):
            Path to the revision directory in the `snapshots` folder. It contains the
            exact tree structure as the repo on the Hub.
        files: (`FrozenSet[CachedFileInfo]`):
            Set of [`~CachedFileInfo`] describing all files contained in the snapshot.
        refs (`FrozenSet[str]`):
            Set of `refs` pointing to this revision. If the revision has no `refs`, it
            is considered detached.
            Example: `{"main", "2.4.0"}` or `{"refs/pr/1"}`.
        size_on_disk (`int`):
            Sum of the blob file sizes that are symlink-ed by the revision.
        last_modified (`float`):
            Timestamp of the last time the revision has been created/modified.

    <Tip warning={true}>

    `last_accessed` cannot be determined correctly on a single revision as blob files
    are shared across revisions.

    </Tip>

    <Tip warning={true}>

    `size_on_disk` is not necessarily the sum of all file sizes because of possible
    duplicated files. Besides, only blobs are taken into account, not the (negligible)
    size of folders and symlinks.

    </Tip>
    """

    commit_hash: str
    snapshot_path: Path
    size_on_disk: int
    files: FrozenSet[CachedFileInfo]
    refs: FrozenSet[str]

    last_modified: float

    @property
    def last_modified_str(self) -> str:
        """
        (property) Timestamp of the last time the revision has been modified, returned
        as a human-readable string.

        Example: "2 weeks ago".
        """
        return _format_timesince(self.last_modified)

    @property
    def size_on_disk_str(self) -> str:
        """
        (property) Sum of the blob file sizes as a human-readable string.

        Example: "42.2K".
        """
        return _format_size(self.size_on_disk)

    @property
    def nb_files(self) -> int:
        """
        (property) Total number of files in the revision.
        """
        return len(self.files)


@dataclass(frozen=True)
class CachedRepoInfo:
    """Frozen data structure holding information about a cached repository.

    Args:
        repo_id (`str`):
            Repo id of the repo on the Hub. Example: `"google/fleurs"`.
        repo_type (`Literal["dataset", "model", "space"]`):
            Type of the cached repo.
        repo_path (`Path`):
            Local path to the cached repo.
        size_on_disk (`int`):
            Sum of the blob file sizes in the cached repo.
        nb_files (`int`):
            Total number of blob files in the cached repo.
        revisions (`FrozenSet[CachedRevisionInfo]`):
            Set of [`~CachedRevisionInfo`] describing all revisions cached in the repo.
        last_accessed (`float`):
            Timestamp of the last time a blob file of the repo has been accessed.
        last_modified (`float`):
            Timestamp of the last time a blob file of the repo has been modified/created.

    <Tip warning={true}>

    `size_on_disk` is not necessarily the sum of all revisions sizes because of
    duplicated files. Besides, only blobs are taken into account, not the (negligible)
    size of folders and symlinks.

    </Tip>

    <Tip warning={true}>

    `last_accessed` and `last_modified` reliability can depend on the OS you are using.
    See [python documentation](https://docs.python.org/3/library/os.html#os.stat_result)
    for more details.

    </Tip>
    """

    repo_id: str
    repo_type: REPO_TYPE_T
    repo_path: Path
    size_on_disk: int
    nb_files: int
    revisions: FrozenSet[CachedRevisionInfo]

    last_accessed: float
    last_modified: float

    @property
    def last_accessed_str(self) -> str:
        """
        (property) Last time a blob file of the repo has been accessed, returned as a
        human-readable string.

        Example: "2 weeks ago".
        """
        return _format_timesince(self.last_accessed)

    @property
    def last_modified_str(self) -> str:
        """
        (property) Last time a blob file of the repo has been modified, returned as a
        human-readable string.

        Example: "2 weeks ago".
        """
        return _format_timesince(self.last_modified)

    @property
    def size_on_disk_str(self) -> str:
        """
        (property) Sum of the blob file sizes as a human-readable string.

        Example: "42.2K".
        """
        return _format_size(self.size_on_disk)

    @property
    def refs(self) -> Dict[str, CachedRevisionInfo]:
        """
        (property) Mapping between `refs` and revision data structures.
        """
        return {ref: revision for revision in self.revisions for ref in revision.refs}


@dataclass(frozen=True)
class DeleteCacheStrategy:
    """Frozen data structure holding the strategy to delete cached revisions.

    This object is not meant to be instantiated programmatically but to be returned by
    [`~utils.HFCacheInfo.delete_revisions`]. See documentation for usage example.

    Args:
        expected_freed_size (`float`):
            Expected freed size once strategy is executed.
        blobs (`FrozenSet[Path]`):
            Set of blob file paths to be deleted.
        refs (`FrozenSet[Path]`):
            Set of reference file paths to be deleted.
        repos (`FrozenSet[Path]`):
            Set of entire repo paths to be deleted.
        snapshots (`FrozenSet[Path]`):
            Set of snapshots to be deleted (directory of symlinks).
    """

    expected_freed_size: int
    blobs: FrozenSet[Path]
    refs: FrozenSet[Path]
    repos: FrozenSet[Path]
    snapshots: FrozenSet[Path]

    @property
    def expected_freed_size_str(self) -> str:
        """
        (property) Expected size that will be freed as a human-readable string.

        Example: "42.2K".
        """
        return _format_size(self.expected_freed_size)

    def execute(self) -> None:
        """Execute the defined strategy.

        <Tip warning={true}>

        If this method is interrupted, the cache might get corrupted. Deletion order is
        implemented so that references and symlinks are deleted before the actual blob
        files.

        </Tip>

        <Tip warning={true}>

        This method is irreversible. If executed, cached files are erased and must be
        downloaded again.

        </Tip>
        """
        # Deletion order matters. Blobs are deleted in last so that the user can't end
        # up in a state where a `ref`` refers to a missing snapshot or a snapshot
        # symlink refers to a deleted blob.

        # Delete entire repos
        for path in self.repos:
            _try_delete_path(path, path_type="repo")

        # Delete snapshot directories
        for path in self.snapshots:
            _try_delete_path(path, path_type="snapshot")

        # Delete refs files
        for path in self.refs:
            _try_delete_path(path, path_type="ref")

        # Delete blob files
        for path in self.blobs:
            _try_delete_path(path, path_type="blob")

        logger.info(f"Cache deletion done. Saved {self.expected_freed_size_str}.")


@dataclass(frozen=True)
class HFCacheInfo:
    """Frozen data structure holding information about the entire cache-system.

    This data structure is returned by [`scan_cache_dir`] and is immutable.

    Args:
        size_on_disk (`int`):
            Sum of all valid repo sizes in the cache-system.
        repos (`FrozenSet[CachedRepoInfo]`):
            Set of [`~CachedRepoInfo`] describing all valid cached repos found on the
            cache-system while scanning.
        warnings (`List[CorruptedCacheException]`):
            List of [`~CorruptedCacheException`] that occurred while scanning the cache.
            Those exceptions are captured so that the scan can continue. Corrupted repos
            are skipped from the scan.

    <Tip warning={true}>

    Here `size_on_disk` is equal to the sum of all repo sizes (only blobs). However if
    some cached repos are corrupted, their sizes are not taken into account.

    </Tip>
    """

    size_on_disk: int
    repos: FrozenSet[CachedRepoInfo]
    warnings: List[CorruptedCacheException]

    @property
    def size_on_disk_str(self) -> str:
        """
        (property) Sum of all valid repo sizes in the cache-system as a human-readable
        string.

        Example: "42.2K".
        """
        return _format_size(self.size_on_disk)

    def delete_revisions(self, *revisions: str) -> DeleteCacheStrategy:
        """Prepare the strategy to delete one or more revisions cached locally.

        Input revisions can be any revision hash. If a revision hash is not found in the
        local cache, a warning is thrown but no error is raised. Revisions can be from
        different cached repos since hashes are unique across repos,

        Examples:
        ```py
        >>> from huggingface_hub import scan_cache_dir
        >>> cache_info = scan_cache_dir()
        >>> delete_strategy = cache_info.delete_revisions(
        ...     "81fd1d6e7847c99f5862c9fb81387956d99ec7aa"
        ... )
        >>> print(f"Will free {delete_strategy.expected_freed_size_str}.")
        Will free 7.9K.
        >>> delete_strategy.execute()
        Cache deletion done. Saved 7.9K.
        ```

        ```py
        >>> from huggingface_hub import scan_cache_dir
        >>> scan_cache_dir().delete_revisions(
        ...     "81fd1d6e7847c99f5862c9fb81387956d99ec7aa",
        ...     "e2983b237dccf3ab4937c97fa717319a9ca1a96d",
        ...     "6c0e6080953db56375760c0471a8c5f2929baf11",
        ... ).execute()
        Cache deletion done. Saved 8.6G.
        ```

        <Tip warning={true}>

        `delete_revisions` returns a [`~utils.DeleteCacheStrategy`] object that needs to
        be executed. The [`~utils.DeleteCacheStrategy`] is not meant to be modified but
        allows having a dry run before actually executing the deletion.

        </Tip>
        """
        hashes_to_delete: Set[str] = set(revisions)

        repos_with_revisions: Dict[CachedRepoInfo, Set[CachedRevisionInfo]] = defaultdict(set)

        for repo in self.repos:
            for revision in repo.revisions:
                if revision.commit_hash in hashes_to_delete:
                    repos_with_revisions[repo].add(revision)
                    hashes_to_delete.remove(revision.commit_hash)

        if len(hashes_to_delete) > 0:
            logger.warning(f"Revision(s) not found - cannot delete them: {', '.join(hashes_to_delete)}")

        delete_strategy_blobs: Set[Path] = set()
        delete_strategy_refs: Set[Path] = set()
        delete_strategy_repos: Set[Path] = set()
        delete_strategy_snapshots: Set[Path] = set()
        delete_strategy_expected_freed_size = 0

        for affected_repo, revisions_to_delete in repos_with_revisions.items():
            other_revisions = affected_repo.revisions - revisions_to_delete

            # If no other revisions, it means all revisions are deleted
            # -> delete the entire cached repo
            if len(other_revisions) == 0:
                delete_strategy_repos.add(affected_repo.repo_path)
                delete_strategy_expected_freed_size += affected_repo.size_on_disk
                continue

            # Some revisions of the repo will be deleted but not all. We need to filter
            # which blob files will not be linked anymore.
            for revision_to_delete in revisions_to_delete:
                # Snapshot dir
                delete_strategy_snapshots.add(revision_to_delete.snapshot_path)

                # Refs dir
                for ref in revision_to_delete.refs:
                    delete_strategy_refs.add(affected_repo.repo_path / "refs" / ref)

                # Blobs dir
                for file in revision_to_delete.files:
                    if file.blob_path not in delete_strategy_blobs:
                        is_file_alone = True
                        for revision in other_revisions:
                            for rev_file in revision.files:
                                if file.blob_path == rev_file.blob_path:
                                    is_file_alone = False
                                    break
                            if not is_file_alone:
                                break

                        # Blob file not referenced by remaining revisions -> delete
                        if is_file_alone:
                            delete_strategy_blobs.add(file.blob_path)
                            delete_strategy_expected_freed_size += file.size_on_disk

        # Return the strategy instead of executing it.
        return DeleteCacheStrategy(
            blobs=frozenset(delete_strategy_blobs),
            refs=frozenset(delete_strategy_refs),
            repos=frozenset(delete_strategy_repos),
            snapshots=frozenset(delete_strategy_snapshots),
            expected_freed_size=delete_strategy_expected_freed_size,
        )

    def export_as_table(self, *, verbosity: int = 0) -> str:
        """Generate a table from the [`HFCacheInfo`] object.

        Pass `verbosity=0` to get a table with a single row per repo, with columns
        "repo_id", "repo_type", "size_on_disk", "nb_files", "last_accessed", "last_modified", "refs", "local_path".

        Pass `verbosity=1` to get a table with a row per repo and revision (thus multiple rows can appear for a single repo), with columns
        "repo_id", "repo_type", "revision", "size_on_disk", "nb_files", "last_modified", "refs", "local_path".

        Example:
        ```py
        >>> from huggingface_hub.utils import scan_cache_dir

        >>> hf_cache_info = scan_cache_dir()
        HFCacheInfo(...)

        >>> print(hf_cache_info.export_as_table())
        REPO ID                                             REPO TYPE SIZE ON DISK NB FILES LAST_ACCESSED LAST_MODIFIED REFS LOCAL PATH
        --------------------------------------------------- --------- ------------ -------- ------------- ------------- ---- --------------------------------------------------------------------------------------------------
        roberta-base                                        model             2.7M        5 1 day ago     1 week ago    main ~/.cache/huggingface/hub/models--roberta-base
        suno/bark                                           model             8.8K        1 1 week ago    1 week ago    main ~/.cache/huggingface/hub/models--suno--bark
        t5-base                                             model           893.8M        4 4 days ago    7 months ago  main ~/.cache/huggingface/hub/models--t5-base
        t5-large                                            model             3.0G        4 5 weeks ago   5 months ago  main ~/.cache/huggingface/hub/models--t5-large

        >>> print(hf_cache_info.export_as_table(verbosity=1))
        REPO ID                                             REPO TYPE REVISION                                 SIZE ON DISK NB FILES LAST_MODIFIED REFS LOCAL PATH
        --------------------------------------------------- --------- ---------------------------------------- ------------ -------- ------------- ---- -----------------------------------------------------------------------------------------------------------------------------------------------------
        roberta-base                                        model     e2da8e2f811d1448a5b465c236feacd80ffbac7b         2.7M        5 1 week ago    main ~/.cache/huggingface/hub/models--roberta-base/snapshots/e2da8e2f811d1448a5b465c236feacd80ffbac7b
        suno/bark                                           model     70a8a7d34168586dc5d028fa9666aceade177992         8.8K        1 1 week ago    main ~/.cache/huggingface/hub/models--suno--bark/snapshots/70a8a7d34168586dc5d028fa9666aceade177992
        t5-base                                             model     a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1       893.8M        4 7 months ago  main ~/.cache/huggingface/hub/models--t5-base/snapshots/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1
        t5-large                                            model     150ebc2c4b72291e770f58e6057481c8d2ed331a         3.0G        4 5 months ago  main ~/.cache/huggingface/hub/models--t5-large/snapshots/150ebc2c4b72291e770f58e6057481c8d2ed331a
        ```

        Args:
            verbosity (`int`, *optional*):
                The verbosity level. Defaults to 0.

        Returns:
            `str`: The table as a string.
        """
        if verbosity == 0:
            return tabulate(
                rows=[
                    [
                        repo.repo_id,
                        repo.repo_type,
                        "{:>12}".format(repo.size_on_disk_str),
                        repo.nb_files,
                        repo.last_accessed_str,
                        repo.last_modified_str,
                        ", ".join(sorted(repo.refs)),
                        str(repo.repo_path),
                    ]
                    for repo in sorted(self.repos, key=lambda repo: repo.repo_path)
                ],
                headers=[
                    "REPO ID",
                    "REPO TYPE",
                    "SIZE ON DISK",
                    "NB FILES",
                    "LAST_ACCESSED",
                    "LAST_MODIFIED",
                    "REFS",
                    "LOCAL PATH",
                ],
            )
        else:
            return tabulate(
                rows=[
                    [
                        repo.repo_id,
                        repo.repo_type,
                        revision.commit_hash,
                        "{:>12}".format(revision.size_on_disk_str),
                        revision.nb_files,
                        revision.last_modified_str,
                        ", ".join(sorted(revision.refs)),
                        str(revision.snapshot_path),
                    ]
                    for repo in sorted(self.repos, key=lambda repo: repo.repo_path)
                    for revision in sorted(repo.revisions, key=lambda revision: revision.commit_hash)
                ],
                headers=[
                    "REPO ID",
                    "REPO TYPE",
                    "REVISION",
                    "SIZE ON DISK",
                    "NB FILES",
                    "LAST_MODIFIED",
                    "REFS",
                    "LOCAL PATH",
                ],
            )


def scan_cache_dir(cache_dir: Optional[Union[str, Path]] = None) -> HFCacheInfo:
    """Scan the entire HF cache-system and return a [`~HFCacheInfo`] structure.

    Use `scan_cache_dir` in order to programmatically scan your cache-system. The cache
    will be scanned repo by repo. If a repo is corrupted, a [`~CorruptedCacheException`]
    will be thrown internally but captured and returned in the [`~HFCacheInfo`]
    structure. Only valid repos get a proper report.

    ```py
    >>> from huggingface_hub import scan_cache_dir

    >>> hf_cache_info = scan_cache_dir()
    HFCacheInfo(
        size_on_disk=3398085269,
        repos=frozenset({
            CachedRepoInfo(
                repo_id='t5-small',
                repo_type='model',
                repo_path=PosixPath(...),
                size_on_disk=970726914,
                nb_files=11,
                revisions=frozenset({
                    CachedRevisionInfo(
                        commit_hash='d78aea13fa7ecd06c29e3e46195d6341255065d5',
                        size_on_disk=970726339,
                        snapshot_path=PosixPath(...),
                        files=frozenset({
                            CachedFileInfo(
                                file_name='config.json',
                                size_on_disk=1197
                                file_path=PosixPath(...),
                                blob_path=PosixPath(...),
                            ),
                            CachedFileInfo(...),
                            ...
                        }),
                    ),
                    CachedRevisionInfo(...),
                    ...
                }),
            ),
            CachedRepoInfo(...),
            ...
        }),
        warnings=[
            CorruptedCacheException("Snapshots dir doesn't exist in cached repo: ..."),
            CorruptedCacheException(...),
            ...
        ],
    )
    ```

    You can also print a detailed report directly from the `huggingface-cli` using:
    ```text
    > huggingface-cli scan-cache
    REPO ID                     REPO TYPE SIZE ON DISK NB FILES REFS                LOCAL PATH
    --------------------------- --------- ------------ -------- ------------------- -------------------------------------------------------------------------
    glue                        dataset         116.3K       15 1.17.0, main, 2.4.0 /Users/lucain/.cache/huggingface/hub/datasets--glue
    google/fleurs               dataset          64.9M        6 main, refs/pr/1     /Users/lucain/.cache/huggingface/hub/datasets--google--fleurs
    Jean-Baptiste/camembert-ner model           441.0M        7 main                /Users/lucain/.cache/huggingface/hub/models--Jean-Baptiste--camembert-ner
    bert-base-cased             model             1.9G       13 main                /Users/lucain/.cache/huggingface/hub/models--bert-base-cased
    t5-base                     model            10.1K        3 main                /Users/lucain/.cache/huggingface/hub/models--t5-base
    t5-small                    model           970.7M       11 refs/pr/1, main     /Users/lucain/.cache/huggingface/hub/models--t5-small

    Done in 0.0s. Scanned 6 repo(s) for a total of 3.4G.
    Got 1 warning(s) while scanning. Use -vvv to print details.
    ```

    Args:
        cache_dir (`str` or `Path`, `optional`):
            Cache directory to cache. Defaults to the default HF cache directory.

    <Tip warning={true}>

    Raises:

        `CacheNotFound`
          If the cache directory does not exist.

        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
          If the cache directory is a file, instead of a directory.

    </Tip>

    Returns: a [`~HFCacheInfo`] object.
    """
    if cache_dir is None:
        cache_dir = HF_HUB_CACHE

    cache_dir = Path(cache_dir).expanduser().resolve()
    if not cache_dir.exists():
        raise CacheNotFound(
            f"Cache directory not found: {cache_dir}. Please use `cache_dir` argument or set `HF_HUB_CACHE` environment variable.",
            cache_dir=cache_dir,
        )

    if cache_dir.is_file():
        raise ValueError(
            f"Scan cache expects a directory but found a file: {cache_dir}. Please use `cache_dir` argument or set `HF_HUB_CACHE` environment variable."
        )

    repos: Set[CachedRepoInfo] = set()
    warnings: List[CorruptedCacheException] = []
    for repo_path in cache_dir.iterdir():
        if repo_path.name == ".locks":  # skip './.locks/' folder
            continue
        try:
            repos.add(_scan_cached_repo(repo_path))
        except CorruptedCacheException as e:
            warnings.append(e)

    return HFCacheInfo(
        repos=frozenset(repos),
        size_on_disk=sum(repo.size_on_disk for repo in repos),
        warnings=warnings,
    )


def _scan_cached_repo(repo_path: Path) -> CachedRepoInfo:
    """Scan a single cache repo and return information about it.

    Any unexpected behavior will raise a [`~CorruptedCacheException`].
    """
    if not repo_path.is_dir():
        raise CorruptedCacheException(f"Repo path is not a directory: {repo_path}")

    if "--" not in repo_path.name:
        raise CorruptedCacheException(f"Repo path is not a valid HuggingFace cache directory: {repo_path}")

    repo_type, repo_id = repo_path.name.split("--", maxsplit=1)
    repo_type = repo_type[:-1]  # "models" -> "model"
    repo_id = repo_id.replace("--", "/")  # google/fleurs -> "google/fleurs"

    if repo_type not in {"dataset", "model", "space"}:
        raise CorruptedCacheException(
            f"Repo type must be `dataset`, `model` or `space`, found `{repo_type}` ({repo_path})."
        )

    blob_stats: Dict[Path, os.stat_result] = {}  # Key is blob_path, value is blob stats

    snapshots_path = repo_path / "snapshots"
    refs_path = repo_path / "refs"

    if not snapshots_path.exists() or not snapshots_path.is_dir():
        raise CorruptedCacheException(f"Snapshots dir doesn't exist in cached repo: {snapshots_path}")

    # Scan over `refs` directory

    # key is revision hash, value is set of refs
    refs_by_hash: Dict[str, Set[str]] = defaultdict(set)
    if refs_path.exists():
        # Example of `refs` directory
        # ── refs
        #     ├── main
        #     └── refs
        #         └── pr
        #             └── 1
        if refs_path.is_file():
            raise CorruptedCacheException(f"Refs directory cannot be a file: {refs_path}")

        for ref_path in refs_path.glob("**/*"):
            # glob("**/*") iterates over all files and directories -> skip directories
            if ref_path.is_dir() or ref_path.name in FILES_TO_IGNORE:
                continue

            ref_name = str(ref_path.relative_to(refs_path))
            with ref_path.open() as f:
                commit_hash = f.read()

            refs_by_hash[commit_hash].add(ref_name)

    # Scan snapshots directory
    cached_revisions: Set[CachedRevisionInfo] = set()
    for revision_path in snapshots_path.iterdir():
        # Ignore OS-created helper files
        if revision_path.name in FILES_TO_IGNORE:
            continue
        if revision_path.is_file():
            raise CorruptedCacheException(f"Snapshots folder corrupted. Found a file: {revision_path}")

        cached_files = set()
        for file_path in revision_path.glob("**/*"):
            # glob("**/*") iterates over all files and directories -> skip directories
            if file_path.is_dir():
                continue

            blob_path = Path(file_path).resolve()
            if not blob_path.exists():
                raise CorruptedCacheException(f"Blob missing (broken symlink): {blob_path}")

            if blob_path not in blob_stats:
                blob_stats[blob_path] = blob_path.stat()

            cached_files.add(
                CachedFileInfo(
                    file_name=file_path.name,
                    file_path=file_path,
                    size_on_disk=blob_stats[blob_path].st_size,
                    blob_path=blob_path,
                    blob_last_accessed=blob_stats[blob_path].st_atime,
                    blob_last_modified=blob_stats[blob_path].st_mtime,
                )
            )

        # Last modified is either the last modified blob file or the revision folder
        # itself if it is empty
        if len(cached_files) > 0:
            revision_last_modified = max(blob_stats[file.blob_path].st_mtime for file in cached_files)
        else:
            revision_last_modified = revision_path.stat().st_mtime

        cached_revisions.add(
            CachedRevisionInfo(
                commit_hash=revision_path.name,
                files=frozenset(cached_files),
                refs=frozenset(refs_by_hash.pop(revision_path.name, set())),
                size_on_disk=sum(
                    blob_stats[blob_path].st_size for blob_path in set(file.blob_path for file in cached_files)
                ),
                snapshot_path=revision_path,
                last_modified=revision_last_modified,
            )
        )

    # Check that all refs referred to an existing revision
    if len(refs_by_hash) > 0:
        raise CorruptedCacheException(
            f"Reference(s) refer to missing commit hashes: {dict(refs_by_hash)} ({repo_path})."
        )

    # Last modified is either the last modified blob file or the repo folder itself if
    # no blob files has been found. Same for last accessed.
    if len(blob_stats) > 0:
        repo_last_accessed = max(stat.st_atime for stat in blob_stats.values())
        repo_last_modified = max(stat.st_mtime for stat in blob_stats.values())
    else:
        repo_stats = repo_path.stat()
        repo_last_accessed = repo_stats.st_atime
        repo_last_modified = repo_stats.st_mtime

    # Build and return frozen structure
    return CachedRepoInfo(
        nb_files=len(blob_stats),
        repo_id=repo_id,
        repo_path=repo_path,
        repo_type=repo_type,  # type: ignore
        revisions=frozenset(cached_revisions),
        size_on_disk=sum(stat.st_size for stat in blob_stats.values()),
        last_accessed=repo_last_accessed,
        last_modified=repo_last_modified,
    )


def _format_size(num: int) -> str:
    """Format size in bytes into a human-readable string.

    Taken from https://stackoverflow.com/a/1094933
    """
    num_f = float(num)
    for unit in ["", "K", "M", "G", "T", "P", "E", "Z"]:
        if abs(num_f) < 1000.0:
            return f"{num_f:3.1f}{unit}"
        num_f /= 1000.0
    return f"{num_f:.1f}Y"


_TIMESINCE_CHUNKS = (
    # Label, divider, max value
    ("second", 1, 60),
    ("minute", 60, 60),
    ("hour", 60 * 60, 24),
    ("day", 60 * 60 * 24, 6),
    ("week", 60 * 60 * 24 * 7, 6),
    ("month", 60 * 60 * 24 * 30, 11),
    ("year", 60 * 60 * 24 * 365, None),
)


def _format_timesince(ts: float) -> str:
    """Format timestamp in seconds into a human-readable string, relative to now.

    Vaguely inspired by Django's `timesince` formatter.
    """
    delta = time.time() - ts
    if delta < 20:
        return "a few seconds ago"
    for label, divider, max_value in _TIMESINCE_CHUNKS:  # noqa: B007
        value = round(delta / divider)
        if max_value is not None and value <= max_value:
            break
    return f"{value} {label}{'s' if value > 1 else ''} ago"


def _try_delete_path(path: Path, path_type: str) -> None:
    """Try to delete a local file or folder.

    If the path does not exists, error is logged as a warning and then ignored.

    Args:
        path (`Path`)
            Path to delete. Can be a file or a folder.
        path_type (`str`)
            What path are we deleting ? Only for logging purposes. Example: "snapshot".
    """
    logger.info(f"Delete {path_type}: {path}")
    try:
        if path.is_file():
            os.remove(path)
        else:
            shutil.rmtree(path)
    except FileNotFoundError:
        logger.warning(f"Couldn't delete {path_type}: file not found ({path})", exc_info=True)
    except PermissionError:
        logger.warning(f"Couldn't delete {path_type}: permission denied ({path})", exc_info=True)
