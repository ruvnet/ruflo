import os
import re
import tempfile
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from itertools import chain
from pathlib import Path
from typing import Any, Dict, Iterator, List, NoReturn, Optional, Tuple, Union
from urllib.parse import quote, unquote

import fsspec
from fsspec.callbacks import _DEFAULT_CALLBACK, NoOpCallback, TqdmCallback
from fsspec.utils import isfilelike
from requests import Response

from . import constants
from ._commit_api import CommitOperationCopy, CommitOperationDelete
from .errors import EntryNotFoundError, RepositoryNotFoundError, RevisionNotFoundError
from .file_download import hf_hub_url, http_get
from .hf_api import HfApi, LastCommitInfo, RepoFile
from .utils import HFValidationError, hf_raise_for_status, http_backoff


# Regex used to match special revisions with "/" in them (see #1710)
SPECIAL_REFS_REVISION_REGEX = re.compile(
    r"""
    (^refs\/convert\/\w+)     # `refs/convert/parquet` revisions
    |
    (^refs\/pr\/\d+)          # PR revisions
    """,
    re.VERBOSE,
)


@dataclass
class HfFileSystemResolvedPath:
    """Data structure containing information about a resolved Hugging Face file system path."""

    repo_type: str
    repo_id: str
    revision: str
    path_in_repo: str
    # The part placed after '@' in the initial path. It can be a quoted or unquoted refs revision.
    # Used to reconstruct the unresolved path to return to the user.
    _raw_revision: Optional[str] = field(default=None, repr=False)

    def unresolve(self) -> str:
        repo_path = constants.REPO_TYPES_URL_PREFIXES.get(self.repo_type, "") + self.repo_id
        if self._raw_revision:
            return f"{repo_path}@{self._raw_revision}/{self.path_in_repo}".rstrip("/")
        elif self.revision != constants.DEFAULT_REVISION:
            return f"{repo_path}@{safe_revision(self.revision)}/{self.path_in_repo}".rstrip("/")
        else:
            return f"{repo_path}/{self.path_in_repo}".rstrip("/")


class HfFileSystem(fsspec.AbstractFileSystem):
    """
    Access a remote Hugging Face Hub repository as if were a local file system.

    <Tip warning={true}>

        [`HfFileSystem`] provides fsspec compatibility, which is useful for libraries that require it (e.g., reading
        Hugging Face datasets directly with `pandas`). However, it introduces additional overhead due to this compatibility
        layer. For better performance and reliability, it's recommended to use `HfApi` methods when possible.

    </Tip>

    Args:
        token (`str` or `bool`, *optional*):
            A valid user access token (string). Defaults to the locally saved
            token, which is the recommended method for authentication (see
            https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
            To disable authentication, pass `False`.
        endpoint (`str`, *optional*):
            Endpoint of the Hub. Defaults to <https://huggingface.co>.
    Usage:

    ```python
    >>> from huggingface_hub import HfFileSystem

    >>> fs = HfFileSystem()

    >>> # List files
    >>> fs.glob("my-username/my-model/*.bin")
    ['my-username/my-model/pytorch_model.bin']
    >>> fs.ls("datasets/my-username/my-dataset", detail=False)
    ['datasets/my-username/my-dataset/.gitattributes', 'datasets/my-username/my-dataset/README.md', 'datasets/my-username/my-dataset/data.json']

    >>> # Read/write files
    >>> with fs.open("my-username/my-model/pytorch_model.bin") as f:
    ...     data = f.read()
    >>> with fs.open("my-username/my-model/pytorch_model.bin", "wb") as f:
    ...     f.write(data)
    ```
    """

    root_marker = ""
    protocol = "hf"

    def __init__(
        self,
        *args,
        endpoint: Optional[str] = None,
        token: Union[bool, str, None] = None,
        **storage_options,
    ):
        super().__init__(*args, **storage_options)
        self.endpoint = endpoint or constants.ENDPOINT
        self.token = token
        self._api = HfApi(endpoint=endpoint, token=token)
        # Maps (repo_type, repo_id, revision) to a 2-tuple with:
        #  * the 1st element indicating whether the repositoy and the revision exist
        #  * the 2nd element being the exception raised if the repository or revision doesn't exist
        self._repo_and_revision_exists_cache: Dict[
            Tuple[str, str, Optional[str]], Tuple[bool, Optional[Exception]]
        ] = {}

    def _repo_and_revision_exist(
        self, repo_type: str, repo_id: str, revision: Optional[str]
    ) -> Tuple[bool, Optional[Exception]]:
        if (repo_type, repo_id, revision) not in self._repo_and_revision_exists_cache:
            try:
                self._api.repo_info(
                    repo_id, revision=revision, repo_type=repo_type, timeout=constants.HF_HUB_ETAG_TIMEOUT
                )
            except (RepositoryNotFoundError, HFValidationError) as e:
                self._repo_and_revision_exists_cache[(repo_type, repo_id, revision)] = False, e
                self._repo_and_revision_exists_cache[(repo_type, repo_id, None)] = False, e
            except RevisionNotFoundError as e:
                self._repo_and_revision_exists_cache[(repo_type, repo_id, revision)] = False, e
                self._repo_and_revision_exists_cache[(repo_type, repo_id, None)] = True, None
            else:
                self._repo_and_revision_exists_cache[(repo_type, repo_id, revision)] = True, None
                self._repo_and_revision_exists_cache[(repo_type, repo_id, None)] = True, None
        return self._repo_and_revision_exists_cache[(repo_type, repo_id, revision)]

    def resolve_path(self, path: str, revision: Optional[str] = None) -> HfFileSystemResolvedPath:
        """
        Resolve a Hugging Face file system path into its components.

        Args:
            path (`str`):
                Path to resolve.
            revision (`str`, *optional*):
                The revision of the repo to resolve. Defaults to the revision specified in the path.

        Returns:
            [`HfFileSystemResolvedPath`]: Resolved path information containing `repo_type`, `repo_id`, `revision` and `path_in_repo`.

        Raises:
            `ValueError`:
                If path contains conflicting revision information.
            `NotImplementedError`:
                If trying to list repositories.
        """

        def _align_revision_in_path_with_revision(
            revision_in_path: Optional[str], revision: Optional[str]
        ) -> Optional[str]:
            if revision is not None:
                if revision_in_path is not None and revision_in_path != revision:
                    raise ValueError(
                        f'Revision specified in path ("{revision_in_path}") and in `revision` argument ("{revision}")'
                        " are not the same."
                    )
            else:
                revision = revision_in_path
            return revision

        path = self._strip_protocol(path)
        if not path:
            # can't list repositories at root
            raise NotImplementedError("Access to repositories lists is not implemented.")
        elif path.split("/")[0] + "/" in constants.REPO_TYPES_URL_PREFIXES.values():
            if "/" not in path:
                # can't list repositories at the repository type level
                raise NotImplementedError("Access to repositories lists is not implemented.")
            repo_type, path = path.split("/", 1)
            repo_type = constants.REPO_TYPES_MAPPING[repo_type]
        else:
            repo_type = constants.REPO_TYPE_MODEL
        if path.count("/") > 0:
            if "@" in path:
                repo_id, revision_in_path = path.split("@", 1)
                if "/" in revision_in_path:
                    match = SPECIAL_REFS_REVISION_REGEX.search(revision_in_path)
                    if match is not None and revision in (None, match.group()):
                        # Handle `refs/convert/parquet` and PR revisions separately
                        path_in_repo = SPECIAL_REFS_REVISION_REGEX.sub("", revision_in_path).lstrip("/")
                        revision_in_path = match.group()
                    else:
                        revision_in_path, path_in_repo = revision_in_path.split("/", 1)
                else:
                    path_in_repo = ""
                revision = _align_revision_in_path_with_revision(unquote(revision_in_path), revision)
                repo_and_revision_exist, err = self._repo_and_revision_exist(repo_type, repo_id, revision)
                if not repo_and_revision_exist:
                    _raise_file_not_found(path, err)
            else:
                revision_in_path = None
                repo_id_with_namespace = "/".join(path.split("/")[:2])
                path_in_repo_with_namespace = "/".join(path.split("/")[2:])
                repo_id_without_namespace = path.split("/")[0]
                path_in_repo_without_namespace = "/".join(path.split("/")[1:])
                repo_id = repo_id_with_namespace
                path_in_repo = path_in_repo_with_namespace
                repo_and_revision_exist, err = self._repo_and_revision_exist(repo_type, repo_id, revision)
                if not repo_and_revision_exist:
                    if isinstance(err, (RepositoryNotFoundError, HFValidationError)):
                        repo_id = repo_id_without_namespace
                        path_in_repo = path_in_repo_without_namespace
                        repo_and_revision_exist, _ = self._repo_and_revision_exist(repo_type, repo_id, revision)
                        if not repo_and_revision_exist:
                            _raise_file_not_found(path, err)
                    else:
                        _raise_file_not_found(path, err)
        else:
            repo_id = path
            path_in_repo = ""
            if "@" in path:
                repo_id, revision_in_path = path.split("@", 1)
                revision = _align_revision_in_path_with_revision(unquote(revision_in_path), revision)
            else:
                revision_in_path = None
            repo_and_revision_exist, _ = self._repo_and_revision_exist(repo_type, repo_id, revision)
            if not repo_and_revision_exist:
                raise NotImplementedError("Access to repositories lists is not implemented.")

        revision = revision if revision is not None else constants.DEFAULT_REVISION
        return HfFileSystemResolvedPath(repo_type, repo_id, revision, path_in_repo, _raw_revision=revision_in_path)

    def invalidate_cache(self, path: Optional[str] = None) -> None:
        """
        Clear the cache for a given path.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.invalidate_cache).

        Args:
            path (`str`, *optional*):
                Path to clear from cache. If not provided, clear the entire cache.

        """
        if not path:
            self.dircache.clear()
            self._repo_and_revision_exists_cache.clear()
        else:
            resolved_path = self.resolve_path(path)
            path = resolved_path.unresolve()
            while path:
                self.dircache.pop(path, None)
                path = self._parent(path)

            # Only clear repo cache if path is to repo root
            if not resolved_path.path_in_repo:
                self._repo_and_revision_exists_cache.pop((resolved_path.repo_type, resolved_path.repo_id, None), None)
                self._repo_and_revision_exists_cache.pop(
                    (resolved_path.repo_type, resolved_path.repo_id, resolved_path.revision), None
                )

    def _open(
        self,
        path: str,
        mode: str = "rb",
        revision: Optional[str] = None,
        block_size: Optional[int] = None,
        **kwargs,
    ) -> "HfFileSystemFile":
        if "a" in mode:
            raise NotImplementedError("Appending to remote files is not yet supported.")
        if block_size == 0:
            return HfFileSystemStreamFile(self, path, mode=mode, revision=revision, block_size=block_size, **kwargs)
        else:
            return HfFileSystemFile(self, path, mode=mode, revision=revision, block_size=block_size, **kwargs)

    def _rm(self, path: str, revision: Optional[str] = None, **kwargs) -> None:
        resolved_path = self.resolve_path(path, revision=revision)
        self._api.delete_file(
            path_in_repo=resolved_path.path_in_repo,
            repo_id=resolved_path.repo_id,
            token=self.token,
            repo_type=resolved_path.repo_type,
            revision=resolved_path.revision,
            commit_message=kwargs.get("commit_message"),
            commit_description=kwargs.get("commit_description"),
        )
        self.invalidate_cache(path=resolved_path.unresolve())

    def rm(
        self,
        path: str,
        recursive: bool = False,
        maxdepth: Optional[int] = None,
        revision: Optional[str] = None,
        **kwargs,
    ) -> None:
        """
        Delete files from a repository.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.rm).

        <Tip warning={true}>

            Note: When possible, use `HfApi.delete_file()` for better performance.

        </Tip>

        Args:
            path (`str`):
                Path to delete.
            recursive (`bool`, *optional*):
                If True, delete directory and all its contents. Defaults to False.
            maxdepth (`int`, *optional*):
                Maximum number of subdirectories to visit when deleting recursively.
            revision (`str`, *optional*):
                The git revision to delete from.

        """
        resolved_path = self.resolve_path(path, revision=revision)
        paths = self.expand_path(path, recursive=recursive, maxdepth=maxdepth, revision=revision)
        paths_in_repo = [self.resolve_path(path).path_in_repo for path in paths if not self.isdir(path)]
        operations = [CommitOperationDelete(path_in_repo=path_in_repo) for path_in_repo in paths_in_repo]
        commit_message = f"Delete {path} "
        commit_message += "recursively " if recursive else ""
        commit_message += f"up to depth {maxdepth} " if maxdepth is not None else ""
        # TODO: use `commit_description` to list all the deleted paths?
        self._api.create_commit(
            repo_id=resolved_path.repo_id,
            repo_type=resolved_path.repo_type,
            token=self.token,
            operations=operations,
            revision=resolved_path.revision,
            commit_message=kwargs.get("commit_message", commit_message),
            commit_description=kwargs.get("commit_description"),
        )
        self.invalidate_cache(path=resolved_path.unresolve())

    def ls(
        self, path: str, detail: bool = True, refresh: bool = False, revision: Optional[str] = None, **kwargs
    ) -> List[Union[str, Dict[str, Any]]]:
        """
        List the contents of a directory.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.ls).

        <Tip warning={true}>

            Note: When possible, use `HfApi.list_repo_tree()` for better performance.

        </Tip>

        Args:
            path (`str`):
                Path to the directory.
            detail (`bool`, *optional*):
                If True, returns a list of dictionaries containing file information. If False,
                returns a list of file paths. Defaults to True.
            refresh (`bool`, *optional*):
                If True, bypass the cache and fetch the latest data. Defaults to False.
            revision (`str`, *optional*):
                The git revision to list from.

        Returns:
            `List[Union[str, Dict[str, Any]]]`: List of file paths (if detail=False) or list of file information
            dictionaries (if detail=True).
        """
        resolved_path = self.resolve_path(path, revision=revision)
        path = resolved_path.unresolve()
        kwargs = {"expand_info": detail, **kwargs}
        try:
            out = self._ls_tree(path, refresh=refresh, revision=revision, **kwargs)
        except EntryNotFoundError:
            # Path could be a file
            if not resolved_path.path_in_repo:
                _raise_file_not_found(path, None)
            out = self._ls_tree(self._parent(path), refresh=refresh, revision=revision, **kwargs)
            out = [o for o in out if o["name"] == path]
            if len(out) == 0:
                _raise_file_not_found(path, None)
        return out if detail else [o["name"] for o in out]

    def _ls_tree(
        self,
        path: str,
        recursive: bool = False,
        refresh: bool = False,
        revision: Optional[str] = None,
        expand_info: bool = True,
    ):
        resolved_path = self.resolve_path(path, revision=revision)
        path = resolved_path.unresolve()
        root_path = HfFileSystemResolvedPath(
            resolved_path.repo_type,
            resolved_path.repo_id,
            resolved_path.revision,
            path_in_repo="",
            _raw_revision=resolved_path._raw_revision,
        ).unresolve()

        out = []
        if path in self.dircache and not refresh:
            cached_path_infos = self.dircache[path]
            out.extend(cached_path_infos)
            dirs_not_in_dircache = []
            if recursive:
                # Use BFS to traverse the cache and build the "recursive "output
                # (The Hub uses a so-called "tree first" strategy for the tree endpoint but we sort the output to follow the spec so the result is (eventually) the same)
                dirs_to_visit = deque(
                    [path_info for path_info in cached_path_infos if path_info["type"] == "directory"]
                )
                while dirs_to_visit:
                    dir_info = dirs_to_visit.popleft()
                    if dir_info["name"] not in self.dircache:
                        dirs_not_in_dircache.append(dir_info["name"])
                    else:
                        cached_path_infos = self.dircache[dir_info["name"]]
                        out.extend(cached_path_infos)
                        dirs_to_visit.extend(
                            [path_info for path_info in cached_path_infos if path_info["type"] == "directory"]
                        )

            dirs_not_expanded = []
            if expand_info:
                # Check if there are directories with non-expanded entries
                dirs_not_expanded = [self._parent(o["name"]) for o in out if o["last_commit"] is None]

            if (recursive and dirs_not_in_dircache) or (expand_info and dirs_not_expanded):
                # If the dircache is incomplete, find the common path of the missing and non-expanded entries
                # and extend the output with the result of `_ls_tree(common_path, recursive=True)`
                common_prefix = os.path.commonprefix(dirs_not_in_dircache + dirs_not_expanded)
                # Get the parent directory if the common prefix itself is not a directory
                common_path = (
                    common_prefix.rstrip("/")
                    if common_prefix.endswith("/")
                    or common_prefix == root_path
                    or common_prefix in chain(dirs_not_in_dircache, dirs_not_expanded)
                    else self._parent(common_prefix)
                )
                out = [o for o in out if not o["name"].startswith(common_path + "/")]
                for cached_path in self.dircache:
                    if cached_path.startswith(common_path + "/"):
                        self.dircache.pop(cached_path, None)
                self.dircache.pop(common_path, None)
                out.extend(
                    self._ls_tree(
                        common_path,
                        recursive=recursive,
                        refresh=True,
                        revision=revision,
                        expand_info=expand_info,
                    )
                )
        else:
            tree = self._api.list_repo_tree(
                resolved_path.repo_id,
                resolved_path.path_in_repo,
                recursive=recursive,
                expand=expand_info,
                revision=resolved_path.revision,
                repo_type=resolved_path.repo_type,
            )
            for path_info in tree:
                if isinstance(path_info, RepoFile):
                    cache_path_info = {
                        "name": root_path + "/" + path_info.path,
                        "size": path_info.size,
                        "type": "file",
                        "blob_id": path_info.blob_id,
                        "lfs": path_info.lfs,
                        "last_commit": path_info.last_commit,
                        "security": path_info.security,
                    }
                else:
                    cache_path_info = {
                        "name": root_path + "/" + path_info.path,
                        "size": 0,
                        "type": "directory",
                        "tree_id": path_info.tree_id,
                        "last_commit": path_info.last_commit,
                    }
                parent_path = self._parent(cache_path_info["name"])
                self.dircache.setdefault(parent_path, []).append(cache_path_info)
                out.append(cache_path_info)
        return out

    def walk(self, path: str, *args, **kwargs) -> Iterator[Tuple[str, List[str], List[str]]]:
        """
        Return all files below the given path.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.walk).

        Args:
            path (`str`):
                Root path to list files from.

        Returns:
            `Iterator[Tuple[str, List[str], List[str]]]`: An iterator of (path, list of directory names, list of file names) tuples.
        """
        # Set expand_info=False by default to get a x10 speed boost
        kwargs = {"expand_info": kwargs.get("detail", False), **kwargs}
        path = self.resolve_path(path, revision=kwargs.get("revision")).unresolve()
        yield from super().walk(path, *args, **kwargs)

    def glob(self, path: str, **kwargs) -> List[str]:
        """
        Find files by glob-matching.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.glob).

        Args:
            path (`str`):
                Path pattern to match.

        Returns:
            `List[str]`: List of paths matching the pattern.
        """
        # Set expand_info=False by default to get a x10 speed boost
        kwargs = {"expand_info": kwargs.get("detail", False), **kwargs}
        path = self.resolve_path(path, revision=kwargs.get("revision")).unresolve()
        return super().glob(path, **kwargs)

    def find(
        self,
        path: str,
        maxdepth: Optional[int] = None,
        withdirs: bool = False,
        detail: bool = False,
        refresh: bool = False,
        revision: Optional[str] = None,
        **kwargs,
    ) -> Union[List[str], Dict[str, Dict[str, Any]]]:
        """
        List all files below path.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.find).

        Args:
            path (`str`):
                Root path to list files from.
            maxdepth (`int`, *optional*):
                Maximum depth to descend into subdirectories.
            withdirs (`bool`, *optional*):
                Include directory paths in the output. Defaults to False.
            detail (`bool`, *optional*):
                If True, returns a dict mapping paths to file information. Defaults to False.
            refresh (`bool`, *optional*):
                If True, bypass the cache and fetch the latest data. Defaults to False.
            revision (`str`, *optional*):
                The git revision to list from.

        Returns:
            `Union[List[str], Dict[str, Dict[str, Any]]]`: List of paths or dict of file information.
        """
        if maxdepth:
            return super().find(
                path, maxdepth=maxdepth, withdirs=withdirs, detail=detail, refresh=refresh, revision=revision, **kwargs
            )
        resolved_path = self.resolve_path(path, revision=revision)
        path = resolved_path.unresolve()
        kwargs = {"expand_info": detail, **kwargs}
        try:
            out = self._ls_tree(path, recursive=True, refresh=refresh, revision=resolved_path.revision, **kwargs)
        except EntryNotFoundError:
            # Path could be a file
            if self.info(path, revision=revision, **kwargs)["type"] == "file":
                out = {path: {}}
            else:
                out = {}
        else:
            if not withdirs:
                out = [o for o in out if o["type"] != "directory"]
            else:
                # If `withdirs=True`, include the directory itself to be consistent with the spec
                path_info = self.info(path, revision=resolved_path.revision, **kwargs)
                out = [path_info] + out if path_info["type"] == "directory" else out
            out = {o["name"]: o for o in out}
        names = sorted(out)
        if not detail:
            return names
        else:
            return {name: out[name] for name in names}

    def cp_file(self, path1: str, path2: str, revision: Optional[str] = None, **kwargs) -> None:
        """
        Copy a file within or between repositories.

        <Tip warning={true}>

            Note: When possible, use `HfApi.upload_file()` for better performance.

        </Tip>

        Args:
            path1 (`str`):
                Source path to copy from.
            path2 (`str`):
                Destination path to copy to.
            revision (`str`, *optional*):
                The git revision to copy from.

        """
        resolved_path1 = self.resolve_path(path1, revision=revision)
        resolved_path2 = self.resolve_path(path2, revision=revision)

        same_repo = (
            resolved_path1.repo_type == resolved_path2.repo_type and resolved_path1.repo_id == resolved_path2.repo_id
        )

        if same_repo:
            commit_message = f"Copy {path1} to {path2}"
            self._api.create_commit(
                repo_id=resolved_path1.repo_id,
                repo_type=resolved_path1.repo_type,
                revision=resolved_path2.revision,
                commit_message=kwargs.get("commit_message", commit_message),
                commit_description=kwargs.get("commit_description", ""),
                operations=[
                    CommitOperationCopy(
                        src_path_in_repo=resolved_path1.path_in_repo,
                        path_in_repo=resolved_path2.path_in_repo,
                        src_revision=resolved_path1.revision,
                    )
                ],
            )
        else:
            with self.open(path1, "rb", revision=resolved_path1.revision) as f:
                content = f.read()
            commit_message = f"Copy {path1} to {path2}"
            self._api.upload_file(
                path_or_fileobj=content,
                path_in_repo=resolved_path2.path_in_repo,
                repo_id=resolved_path2.repo_id,
                token=self.token,
                repo_type=resolved_path2.repo_type,
                revision=resolved_path2.revision,
                commit_message=kwargs.get("commit_message", commit_message),
                commit_description=kwargs.get("commit_description"),
            )
        self.invalidate_cache(path=resolved_path1.unresolve())
        self.invalidate_cache(path=resolved_path2.unresolve())

    def modified(self, path: str, **kwargs) -> datetime:
        """
        Get the last modified time of a file.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.modified).

        Args:
            path (`str`):
                Path to the file.

        Returns:
            `datetime`: Last commit date of the file.
        """
        info = self.info(path, **kwargs)
        return info["last_commit"]["date"]

    def info(self, path: str, refresh: bool = False, revision: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """
        Get information about a file or directory.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.info).

        <Tip warning={true}>

            Note: When possible, use `HfApi.get_paths_info()` or `HfApi.repo_info()`  for better performance.

        </Tip>

        Args:
            path (`str`):
                Path to get info for.
            refresh (`bool`, *optional*):
                If True, bypass the cache and fetch the latest data. Defaults to False.
            revision (`str`, *optional*):
                The git revision to get info from.

        Returns:
            `Dict[str, Any]`: Dictionary containing file information (type, size, commit info, etc.).

        """
        resolved_path = self.resolve_path(path, revision=revision)
        path = resolved_path.unresolve()
        expand_info = kwargs.get(
            "expand_info", True
        )  # don't expose it as a parameter in the public API to follow the spec
        if not resolved_path.path_in_repo:
            # Path is the root directory
            out = {
                "name": path,
                "size": 0,
                "type": "directory",
            }
            if expand_info:
                last_commit = self._api.list_repo_commits(
                    resolved_path.repo_id, repo_type=resolved_path.repo_type, revision=resolved_path.revision
                )[-1]
                out = {
                    **out,
                    "tree_id": None,  # TODO: tree_id of the root directory?
                    "last_commit": LastCommitInfo(
                        oid=last_commit.commit_id, title=last_commit.title, date=last_commit.created_at
                    ),
                }
        else:
            out = None
            parent_path = self._parent(path)
            if not expand_info and parent_path not in self.dircache:
                # Fill the cache with cheap call
                self.ls(parent_path, expand_info=False)
            if parent_path in self.dircache:
                # Check if the path is in the cache
                out1 = [o for o in self.dircache[parent_path] if o["name"] == path]
                if not out1:
                    _raise_file_not_found(path, None)
                out = out1[0]
            if refresh or out is None or (expand_info and out and out["last_commit"] is None):
                paths_info = self._api.get_paths_info(
                    resolved_path.repo_id,
                    resolved_path.path_in_repo,
                    expand=expand_info,
                    revision=resolved_path.revision,
                    repo_type=resolved_path.repo_type,
                )
                if not paths_info:
                    _raise_file_not_found(path, None)
                path_info = paths_info[0]
                root_path = HfFileSystemResolvedPath(
                    resolved_path.repo_type,
                    resolved_path.repo_id,
                    resolved_path.revision,
                    path_in_repo="",
                    _raw_revision=resolved_path._raw_revision,
                ).unresolve()
                if isinstance(path_info, RepoFile):
                    out = {
                        "name": root_path + "/" + path_info.path,
                        "size": path_info.size,
                        "type": "file",
                        "blob_id": path_info.blob_id,
                        "lfs": path_info.lfs,
                        "last_commit": path_info.last_commit,
                        "security": path_info.security,
                    }
                else:
                    out = {
                        "name": root_path + "/" + path_info.path,
                        "size": 0,
                        "type": "directory",
                        "tree_id": path_info.tree_id,
                        "last_commit": path_info.last_commit,
                    }
                if not expand_info:
                    out = {k: out[k] for k in ["name", "size", "type"]}
        assert out is not None
        return out

    def exists(self, path, **kwargs):
        """
        Check if a file exists.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.exists).

        <Tip warning={true}>

            Note: When possible, use `HfApi.file_exists()` for better performance.

        </Tip>

        Args:
            path (`str`):
                Path to check.

        Returns:
            `bool`: True if file exists, False otherwise.
        """
        try:
            if kwargs.get("refresh", False):
                self.invalidate_cache(path)

            self.info(path, **{**kwargs, "expand_info": False})
            return True
        except:  # noqa: E722
            return False

    def isdir(self, path):
        """
        Check if a path is a directory.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.isdir).

        Args:
            path (`str`):
                Path to check.

        Returns:
            `bool`: True if path is a directory, False otherwise.
        """
        try:
            return self.info(path, expand_info=False)["type"] == "directory"
        except OSError:
            return False

    def isfile(self, path):
        """
        Check if a path is a file.

        For more details, refer to [fsspec documentation](https://filesystem-spec.readthedocs.io/en/latest/api.html#fsspec.spec.AbstractFileSystem.isfile).

        Args:
            path (`str`):
                Path to check.

        Returns:
            `bool`: True if path is a file, False otherwise.
        """
        try:
            return self.info(path, expand_info=False)["type"] == "file"
        except:  # noqa: E722
            return False

    def url(self, path: str) -> str:
        """
        Get the HTTP URL of the given path.

        Args:
            path (`str`):
                Path to get URL for.

        Returns:
            `str`: HTTP URL to access the file or directory on the Hub.
        """
        resolved_path = self.resolve_path(path)
        url = hf_hub_url(
            resolved_path.repo_id,
            resolved_path.path_in_repo,
            repo_type=resolved_path.repo_type,
            revision=resolved_path.revision,
            endpoint=self.endpoint,
        )
        if self.isdir(path):
            url = url.replace("/resolve/", "/tree/", 1)
        return url

    def get_file(self, rpath, lpath, callback=_DEFAULT_CALLBACK, outfile=None, **kwargs) -> None:
        """
        Copy single remote file to local.

        <Tip warning={true}>

            Note: When possible, use `HfApi.hf_hub_download()` for better performance.

        </Tip>

        Args:
            rpath (`str`):
                Remote path to download from.
            lpath (`str`):
                Local path to download to.
            callback (`Callback`, *optional*):
                Optional callback to track download progress. Defaults to no callback.
            outfile (`IO`, *optional*):
                Optional file-like object to write to. If provided, `lpath` is ignored.

        """
        revision = kwargs.get("revision")
        unhandled_kwargs = set(kwargs.keys()) - {"revision"}
        if not isinstance(callback, (NoOpCallback, TqdmCallback)) or len(unhandled_kwargs) > 0:
            # for now, let's not handle custom callbacks
            # and let's not handle custom kwargs
            return super().get_file(rpath, lpath, callback=callback, outfile=outfile, **kwargs)

        # Taken from https://github.com/fsspec/filesystem_spec/blob/47b445ae4c284a82dd15e0287b1ffc410e8fc470/fsspec/spec.py#L883
        if isfilelike(lpath):
            outfile = lpath
        elif self.isdir(rpath):
            os.makedirs(lpath, exist_ok=True)
            return None

        if isinstance(lpath, (str, Path)):  # otherwise, let's assume it's a file-like object
            os.makedirs(os.path.dirname(lpath), exist_ok=True)

        # Open file if not already open
        close_file = False
        if outfile is None:
            outfile = open(lpath, "wb")
            close_file = True
        initial_pos = outfile.tell()

        # Custom implementation of `get_file` to use `http_get`.
        resolve_remote_path = self.resolve_path(rpath, revision=revision)
        expected_size = self.info(rpath, revision=revision)["size"]
        callback.set_size(expected_size)
        try:
            http_get(
                url=hf_hub_url(
                    repo_id=resolve_remote_path.repo_id,
                    revision=resolve_remote_path.revision,
                    filename=resolve_remote_path.path_in_repo,
                    repo_type=resolve_remote_path.repo_type,
                    endpoint=self.endpoint,
                ),
                temp_file=outfile,
                displayed_filename=rpath,
                expected_size=expected_size,
                resume_size=0,
                headers=self._api._build_hf_headers(),
                _tqdm_bar=callback.tqdm if isinstance(callback, TqdmCallback) else None,
            )
            outfile.seek(initial_pos)
        finally:
            # Close file only if we opened it ourselves
            if close_file:
                outfile.close()

    @property
    def transaction(self):
        """A context within which files are committed together upon exit

        Requires the file class to implement `.commit()` and `.discard()`
        for the normal and exception cases.
        """
        # Taken from https://github.com/fsspec/filesystem_spec/blob/3fbb6fee33b46cccb015607630843dea049d3243/fsspec/spec.py#L231
        # See https://github.com/huggingface/huggingface_hub/issues/1733
        raise NotImplementedError("Transactional commits are not supported.")

    def start_transaction(self):
        """Begin write transaction for deferring files, non-context version"""
        # Taken from https://github.com/fsspec/filesystem_spec/blob/3fbb6fee33b46cccb015607630843dea049d3243/fsspec/spec.py#L241
        # See https://github.com/huggingface/huggingface_hub/issues/1733
        raise NotImplementedError("Transactional commits are not supported.")


class HfFileSystemFile(fsspec.spec.AbstractBufferedFile):
    def __init__(self, fs: HfFileSystem, path: str, revision: Optional[str] = None, **kwargs):
        try:
            self.resolved_path = fs.resolve_path(path, revision=revision)
        except FileNotFoundError as e:
            if "w" in kwargs.get("mode", ""):
                raise FileNotFoundError(
                    f"{e}.\nMake sure the repository and revision exist before writing data."
                ) from e
            raise
        # avoid an unnecessary .info() call with expensive expand_info=True to instantiate .details
        if kwargs.get("mode", "rb") == "rb":
            self.details = fs.info(self.resolved_path.unresolve(), expand_info=False)
        super().__init__(fs, self.resolved_path.unresolve(), **kwargs)
        self.fs: HfFileSystem

    def __del__(self):
        if not hasattr(self, "resolved_path"):
            # Means that the constructor failed. Nothing to do.
            return
        return super().__del__()

    def _fetch_range(self, start: int, end: int) -> bytes:
        headers = {
            "range": f"bytes={start}-{end - 1}",
            **self.fs._api._build_hf_headers(),
        }
        url = hf_hub_url(
            repo_id=self.resolved_path.repo_id,
            revision=self.resolved_path.revision,
            filename=self.resolved_path.path_in_repo,
            repo_type=self.resolved_path.repo_type,
            endpoint=self.fs.endpoint,
        )
        r = http_backoff(
            "GET",
            url,
            headers=headers,
            retry_on_status_codes=(500, 502, 503, 504),
            timeout=constants.HF_HUB_DOWNLOAD_TIMEOUT,
        )
        hf_raise_for_status(r)
        return r.content

    def _initiate_upload(self) -> None:
        self.temp_file = tempfile.NamedTemporaryFile(prefix="hffs-", delete=False)

    def _upload_chunk(self, final: bool = False) -> None:
        self.buffer.seek(0)
        block = self.buffer.read()
        self.temp_file.write(block)
        if final:
            self.temp_file.close()
            self.fs._api.upload_file(
                path_or_fileobj=self.temp_file.name,
                path_in_repo=self.resolved_path.path_in_repo,
                repo_id=self.resolved_path.repo_id,
                token=self.fs.token,
                repo_type=self.resolved_path.repo_type,
                revision=self.resolved_path.revision,
                commit_message=self.kwargs.get("commit_message"),
                commit_description=self.kwargs.get("commit_description"),
            )
            os.remove(self.temp_file.name)
            self.fs.invalidate_cache(
                path=self.resolved_path.unresolve(),
            )

    def read(self, length=-1):
        """Read remote file.

        If `length` is not provided or is -1, the entire file is downloaded and read. On POSIX systems and if
        `hf_transfer` is not enabled, the file is loaded in memory directly. Otherwise, the file is downloaded to a
        temporary file and read from there.
        """
        if self.mode == "rb" and (length is None or length == -1) and self.loc == 0:
            with self.fs.open(self.path, "rb", block_size=0) as f:  # block_size=0 enables fast streaming
                out = f.read()
                self.loc += len(out)
                return out
        return super().read(length)

    def url(self) -> str:
        return self.fs.url(self.path)


class HfFileSystemStreamFile(fsspec.spec.AbstractBufferedFile):
    def __init__(
        self,
        fs: HfFileSystem,
        path: str,
        mode: str = "rb",
        revision: Optional[str] = None,
        block_size: int = 0,
        cache_type: str = "none",
        **kwargs,
    ):
        if block_size != 0:
            raise ValueError(f"HfFileSystemStreamFile only supports block_size=0 but got {block_size}")
        if cache_type != "none":
            raise ValueError(f"HfFileSystemStreamFile only supports cache_type='none' but got {cache_type}")
        if "w" in mode:
            raise ValueError(f"HfFileSystemStreamFile only supports reading but got mode='{mode}'")
        try:
            self.resolved_path = fs.resolve_path(path, revision=revision)
        except FileNotFoundError as e:
            if "w" in kwargs.get("mode", ""):
                raise FileNotFoundError(
                    f"{e}.\nMake sure the repository and revision exist before writing data."
                ) from e
        # avoid an unnecessary .info() call to instantiate .details
        self.details = {"name": self.resolved_path.unresolve(), "size": None}
        super().__init__(
            fs, self.resolved_path.unresolve(), mode=mode, block_size=block_size, cache_type=cache_type, **kwargs
        )
        self.response: Optional[Response] = None
        self.fs: HfFileSystem

    def seek(self, loc: int, whence: int = 0):
        if loc == 0 and whence == 1:
            return
        if loc == self.loc and whence == 0:
            return
        raise ValueError("Cannot seek streaming HF file")

    def read(self, length: int = -1):
        read_args = (length,) if length >= 0 else ()
        if self.response is None:
            url = hf_hub_url(
                repo_id=self.resolved_path.repo_id,
                revision=self.resolved_path.revision,
                filename=self.resolved_path.path_in_repo,
                repo_type=self.resolved_path.repo_type,
                endpoint=self.fs.endpoint,
            )
            self.response = http_backoff(
                "GET",
                url,
                headers=self.fs._api._build_hf_headers(),
                retry_on_status_codes=(500, 502, 503, 504),
                stream=True,
                timeout=constants.HF_HUB_DOWNLOAD_TIMEOUT,
            )
            hf_raise_for_status(self.response)
        try:
            out = self.response.raw.read(*read_args)
        except Exception:
            self.response.close()

            # Retry by recreating the connection
            url = hf_hub_url(
                repo_id=self.resolved_path.repo_id,
                revision=self.resolved_path.revision,
                filename=self.resolved_path.path_in_repo,
                repo_type=self.resolved_path.repo_type,
                endpoint=self.fs.endpoint,
            )
            self.response = http_backoff(
                "GET",
                url,
                headers={"Range": "bytes=%d-" % self.loc, **self.fs._api._build_hf_headers()},
                retry_on_status_codes=(500, 502, 503, 504),
                stream=True,
                timeout=constants.HF_HUB_DOWNLOAD_TIMEOUT,
            )
            hf_raise_for_status(self.response)
            try:
                out = self.response.raw.read(*read_args)
            except Exception:
                self.response.close()
                raise
        self.loc += len(out)
        return out

    def url(self) -> str:
        return self.fs.url(self.path)

    def __del__(self):
        if not hasattr(self, "resolved_path"):
            # Means that the constructor failed. Nothing to do.
            return
        return super().__del__()

    def __reduce__(self):
        return reopen, (self.fs, self.path, self.mode, self.blocksize, self.cache.name)


def safe_revision(revision: str) -> str:
    return revision if SPECIAL_REFS_REVISION_REGEX.match(revision) else safe_quote(revision)


def safe_quote(s: str) -> str:
    return quote(s, safe="")


def _raise_file_not_found(path: str, err: Optional[Exception]) -> NoReturn:
    msg = path
    if isinstance(err, RepositoryNotFoundError):
        msg = f"{path} (repository not found)"
    elif isinstance(err, RevisionNotFoundError):
        msg = f"{path} (revision not found)"
    elif isinstance(err, HFValidationError):
        msg = f"{path} (invalid repository id)"
    raise FileNotFoundError(msg) from err


def reopen(fs: HfFileSystem, path: str, mode: str, block_size: int, cache_type: str):
    return fs.open(path, mode=mode, block_size=block_size, cache_type=cache_type)
