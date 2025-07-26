import atexit
import os
import re
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Dict, Iterator, List, Optional, Tuple, TypedDict, Union
from urllib.parse import urlparse

from huggingface_hub import constants
from huggingface_hub.repocard import metadata_load, metadata_save

from .hf_api import HfApi, repo_type_and_id_from_hf_id
from .lfs import LFS_MULTIPART_UPLOAD_COMMAND
from .utils import (
    SoftTemporaryDirectory,
    get_token,
    logging,
    run_subprocess,
    tqdm,
    validate_hf_hub_args,
)
from .utils._deprecation import _deprecate_method


logger = logging.get_logger(__name__)


class CommandInProgress:
    """
    Utility to follow commands launched asynchronously.
    """

    def __init__(
        self,
        title: str,
        is_done_method: Callable,
        status_method: Callable,
        process: subprocess.Popen,
        post_method: Optional[Callable] = None,
    ):
        self.title = title
        self._is_done = is_done_method
        self._status = status_method
        self._process = process
        self._stderr = ""
        self._stdout = ""
        self._post_method = post_method

    @property
    def is_done(self) -> bool:
        """
        Whether the process is done.
        """
        result = self._is_done()

        if result and self._post_method is not None:
            self._post_method()
            self._post_method = None

        return result

    @property
    def status(self) -> int:
        """
        The exit code/status of the current action. Will return `0` if the
        command has completed successfully, and a number between 1 and 255 if
        the process errored-out.

        Will return -1 if the command is still ongoing.
        """
        return self._status()

    @property
    def failed(self) -> bool:
        """
        Whether the process errored-out.
        """
        return self.status > 0

    @property
    def stderr(self) -> str:
        """
        The current output message on the standard error.
        """
        if self._process.stderr is not None:
            self._stderr += self._process.stderr.read()
        return self._stderr

    @property
    def stdout(self) -> str:
        """
        The current output message on the standard output.
        """
        if self._process.stdout is not None:
            self._stdout += self._process.stdout.read()
        return self._stdout

    def __repr__(self):
        status = self.status

        if status == -1:
            status = "running"

        return (
            f"[{self.title} command, status code: {status},"
            f" {'in progress.' if not self.is_done else 'finished.'} PID:"
            f" {self._process.pid}]"
        )


def is_git_repo(folder: Union[str, Path]) -> bool:
    """
    Check if the folder is the root or part of a git repository

    Args:
        folder (`str`):
            The folder in which to run the command.

    Returns:
        `bool`: `True` if the repository is part of a repository, `False`
        otherwise.
    """
    folder_exists = os.path.exists(os.path.join(folder, ".git"))
    git_branch = subprocess.run("git branch".split(), cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return folder_exists and git_branch.returncode == 0


def is_local_clone(folder: Union[str, Path], remote_url: str) -> bool:
    """
    Check if the folder is a local clone of the remote_url

    Args:
        folder (`str` or `Path`):
            The folder in which to run the command.
        remote_url (`str`):
            The url of a git repository.

    Returns:
        `bool`: `True` if the repository is a local clone of the remote
        repository specified, `False` otherwise.
    """
    if not is_git_repo(folder):
        return False

    remotes = run_subprocess("git remote -v", folder).stdout

    # Remove token for the test with remotes.
    remote_url = re.sub(r"https://.*@", "https://", remote_url)
    remotes = [re.sub(r"https://.*@", "https://", remote) for remote in remotes.split()]
    return remote_url in remotes


def is_tracked_with_lfs(filename: Union[str, Path]) -> bool:
    """
    Check if the file passed is tracked with git-lfs.

    Args:
        filename (`str` or `Path`):
            The filename to check.

    Returns:
        `bool`: `True` if the file passed is tracked with git-lfs, `False`
        otherwise.
    """
    folder = Path(filename).parent
    filename = Path(filename).name

    try:
        p = run_subprocess("git check-attr -a".split() + [filename], folder)
        attributes = p.stdout.strip()
    except subprocess.CalledProcessError as exc:
        if not is_git_repo(folder):
            return False
        else:
            raise OSError(exc.stderr)

    if len(attributes) == 0:
        return False

    found_lfs_tag = {"diff": False, "merge": False, "filter": False}

    for attribute in attributes.split("\n"):
        for tag in found_lfs_tag.keys():
            if tag in attribute and "lfs" in attribute:
                found_lfs_tag[tag] = True

    return all(found_lfs_tag.values())


def is_git_ignored(filename: Union[str, Path]) -> bool:
    """
    Check if file is git-ignored. Supports nested .gitignore files.

    Args:
        filename (`str` or `Path`):
            The filename to check.

    Returns:
        `bool`: `True` if the file passed is ignored by `git`, `False`
        otherwise.
    """
    folder = Path(filename).parent
    filename = Path(filename).name

    try:
        p = run_subprocess("git check-ignore".split() + [filename], folder, check=False)
        # Will return exit code 1 if not gitignored
        is_ignored = not bool(p.returncode)
    except subprocess.CalledProcessError as exc:
        raise OSError(exc.stderr)

    return is_ignored


def is_binary_file(filename: Union[str, Path]) -> bool:
    """
    Check if file is a binary file.

    Args:
        filename (`str` or `Path`):
            The filename to check.

    Returns:
        `bool`: `True` if the file passed is a binary file, `False` otherwise.
    """
    try:
        with open(filename, "rb") as f:
            content = f.read(10 * (1024**2))  # Read a maximum of 10MB

        # Code sample taken from the following stack overflow thread
        # https://stackoverflow.com/questions/898669/how-can-i-detect-if-a-file-is-binary-non-text-in-python/7392391#7392391
        text_chars = bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x100)) - {0x7F})
        return bool(content.translate(None, text_chars))
    except UnicodeDecodeError:
        return True


def files_to_be_staged(pattern: str = ".", folder: Union[str, Path, None] = None) -> List[str]:
    """
    Returns a list of filenames that are to be staged.

    Args:
        pattern (`str` or `Path`):
            The pattern of filenames to check. Put `.` to get all files.
        folder (`str` or `Path`):
            The folder in which to run the command.

    Returns:
        `List[str]`: List of files that are to be staged.
    """
    try:
        p = run_subprocess("git ls-files --exclude-standard -mo".split() + [pattern], folder)
        if len(p.stdout.strip()):
            files = p.stdout.strip().split("\n")
        else:
            files = []
    except subprocess.CalledProcessError as exc:
        raise EnvironmentError(exc.stderr)

    return files


def is_tracked_upstream(folder: Union[str, Path]) -> bool:
    """
    Check if the current checked-out branch is tracked upstream.

    Args:
        folder (`str` or `Path`):
            The folder in which to run the command.

    Returns:
        `bool`: `True` if the current checked-out branch is tracked upstream,
        `False` otherwise.
    """
    try:
        run_subprocess("git rev-parse --symbolic-full-name --abbrev-ref @{u}", folder)
        return True
    except subprocess.CalledProcessError as exc:
        if "HEAD" in exc.stderr:
            raise OSError("No branch checked out")

        return False


def commits_to_push(folder: Union[str, Path], upstream: Optional[str] = None) -> int:
    """
        Check the number of commits that would be pushed upstream

        Args:
            folder (`str` or `Path`):
                The folder in which to run the command.
            upstream (`str`, *optional*):
    The name of the upstream repository with which the comparison should be
    made.

        Returns:
            `int`: Number of commits that would be pushed upstream were a `git
            push` to proceed.
    """
    try:
        result = run_subprocess(f"git cherry -v {upstream or ''}", folder)
        return len(result.stdout.split("\n")) - 1
    except subprocess.CalledProcessError as exc:
        raise EnvironmentError(exc.stderr)


class PbarT(TypedDict):
    # Used to store an opened progress bar in `_lfs_log_progress`
    bar: tqdm
    past_bytes: int


@contextmanager
def _lfs_log_progress():
    """
    This is a context manager that will log the Git LFS progress of cleaning,
    smudging, pulling and pushing.
    """

    if logger.getEffectiveLevel() >= logging.ERROR:
        try:
            yield
        except Exception:
            pass
        return

    def output_progress(stopping_event: threading.Event):
        """
        To be launched as a separate thread with an event meaning it should stop
        the tail.
        """
        # Key is tuple(state, filename), value is a dict(tqdm bar and a previous value)
        pbars: Dict[Tuple[str, str], PbarT] = {}

        def close_pbars():
            for pbar in pbars.values():
                pbar["bar"].update(pbar["bar"].total - pbar["past_bytes"])
                pbar["bar"].refresh()
                pbar["bar"].close()

        def tail_file(filename) -> Iterator[str]:
            """
            Creates a generator to be iterated through, which will return each
            line one by one. Will stop tailing the file if the stopping_event is
            set.
            """
            with open(filename, "r") as file:
                current_line = ""
                while True:
                    if stopping_event.is_set():
                        close_pbars()
                        break

                    line_bit = file.readline()
                    if line_bit is not None and not len(line_bit.strip()) == 0:
                        current_line += line_bit
                        if current_line.endswith("\n"):
                            yield current_line
                            current_line = ""
                    else:
                        time.sleep(1)

        # If the file isn't created yet, wait for a few seconds before trying again.
        # Can be interrupted with the stopping_event.
        while not os.path.exists(os.environ["GIT_LFS_PROGRESS"]):
            if stopping_event.is_set():
                close_pbars()
                return

            time.sleep(2)

        for line in tail_file(os.environ["GIT_LFS_PROGRESS"]):
            try:
                state, file_progress, byte_progress, filename = line.split()
            except ValueError as error:
                # Try/except to ease debugging. See https://github.com/huggingface/huggingface_hub/issues/1373.
                raise ValueError(f"Cannot unpack LFS progress line:\n{line}") from error
            description = f"{state.capitalize()} file {filename}"

            current_bytes, total_bytes = byte_progress.split("/")
            current_bytes_int = int(current_bytes)
            total_bytes_int = int(total_bytes)

            pbar = pbars.get((state, filename))
            if pbar is None:
                # Initialize progress bar
                pbars[(state, filename)] = {
                    "bar": tqdm(
                        desc=description,
                        initial=current_bytes_int,
                        total=total_bytes_int,
                        unit="B",
                        unit_scale=True,
                        unit_divisor=1024,
                        name="huggingface_hub.lfs_upload",
                    ),
                    "past_bytes": int(current_bytes),
                }
            else:
                # Update progress bar
                pbar["bar"].update(current_bytes_int - pbar["past_bytes"])
                pbar["past_bytes"] = current_bytes_int

    current_lfs_progress_value = os.environ.get("GIT_LFS_PROGRESS", "")

    with SoftTemporaryDirectory() as tmpdir:
        os.environ["GIT_LFS_PROGRESS"] = os.path.join(tmpdir, "lfs_progress")
        logger.debug(f"Following progress in {os.environ['GIT_LFS_PROGRESS']}")

        exit_event = threading.Event()
        x = threading.Thread(target=output_progress, args=(exit_event,), daemon=True)
        x.start()

        try:
            yield
        finally:
            exit_event.set()
            x.join()

            os.environ["GIT_LFS_PROGRESS"] = current_lfs_progress_value


class Repository:
    """
    Helper class to wrap the git and git-lfs commands.

    The aim is to facilitate interacting with huggingface.co hosted model or
    dataset repos, though not a lot here (if any) is actually specific to
    huggingface.co.

    <Tip warning={true}>

    [`Repository`] is deprecated in favor of the http-based alternatives implemented in
    [`HfApi`]. Given its large adoption in legacy code, the complete removal of
    [`Repository`] will only happen in release `v1.0`. For more details, please read
    https://huggingface.co/docs/huggingface_hub/concepts/git_vs_http.

    </Tip>
    """

    command_queue: List[CommandInProgress]

    @validate_hf_hub_args
    @_deprecate_method(
        version="1.0",
        message=(
            "Please prefer the http-based alternatives instead. Given its large adoption in legacy code, the complete"
            " removal is only planned on next major release.\nFor more details, please read"
            " https://huggingface.co/docs/huggingface_hub/concepts/git_vs_http."
        ),
    )
    def __init__(
        self,
        local_dir: Union[str, Path],
        clone_from: Optional[str] = None,
        repo_type: Optional[str] = None,
        token: Union[bool, str] = True,
        git_user: Optional[str] = None,
        git_email: Optional[str] = None,
        revision: Optional[str] = None,
        skip_lfs_files: bool = False,
        client: Optional[HfApi] = None,
    ):
        """
        Instantiate a local clone of a git repo.

        If `clone_from` is set, the repo will be cloned from an existing remote repository.
        If the remote repo does not exist, a `EnvironmentError` exception will be thrown.
        Please create the remote repo first using [`create_repo`].

        `Repository` uses the local git credentials by default. If explicitly set, the `token`
        or the `git_user`/`git_email` pair will be used instead.

        Args:
            local_dir (`str` or `Path`):
                path (e.g. `'my_trained_model/'`) to the local directory, where
                the `Repository` will be initialized.
            clone_from (`str`, *optional*):
                Either a repository url or `repo_id`.
                Example:
                - `"https://huggingface.co/philschmid/playground-tests"`
                - `"philschmid/playground-tests"`
            repo_type (`str`, *optional*):
                To set when cloning a repo from a repo_id. Default is model.
            token (`bool` or `str`, *optional*):
                A valid authentication token (see https://huggingface.co/settings/token).
                If `None` or `True` and machine is logged in (through `huggingface-cli login`
                or [`~huggingface_hub.login`]), token will be retrieved from the cache.
                If `False`, token is not sent in the request header.
            git_user (`str`, *optional*):
                will override the `git config user.name` for committing and
                pushing files to the hub.
            git_email (`str`, *optional*):
                will override the `git config user.email` for committing and
                pushing files to the hub.
            revision (`str`, *optional*):
                Revision to checkout after initializing the repository. If the
                revision doesn't exist, a branch will be created with that
                revision name from the default branch's current HEAD.
            skip_lfs_files (`bool`, *optional*, defaults to `False`):
                whether to skip git-LFS files or not.
            client (`HfApi`, *optional*):
                Instance of [`HfApi`] to use when calling the HF Hub API. A new
                instance will be created if this is left to `None`.

        Raises:
            [`EnvironmentError`](https://docs.python.org/3/library/exceptions.html#EnvironmentError)
                If the remote repository set in `clone_from` does not exist.
        """
        if isinstance(local_dir, Path):
            local_dir = str(local_dir)
        os.makedirs(local_dir, exist_ok=True)
        self.local_dir = os.path.join(os.getcwd(), local_dir)
        self._repo_type = repo_type
        self.command_queue = []
        self.skip_lfs_files = skip_lfs_files
        self.client = client if client is not None else HfApi()

        self.check_git_versions()

        if isinstance(token, str):
            self.huggingface_token: Optional[str] = token
        elif token is False:
            self.huggingface_token = None
        else:
            # if `True` -> explicit use of the cached token
            # if `None` -> implicit use of the cached token
            self.huggingface_token = get_token()

        if clone_from is not None:
            self.clone_from(repo_url=clone_from)
        else:
            if is_git_repo(self.local_dir):
                logger.debug("[Repository] is a valid git repo")
            else:
                raise ValueError("If not specifying `clone_from`, you need to pass Repository a valid git clone.")

        if self.huggingface_token is not None and (git_email is None or git_user is None):
            user = self.client.whoami(self.huggingface_token)

            if git_email is None:
                git_email = user.get("email")

            if git_user is None:
                git_user = user.get("fullname")

        if git_user is not None or git_email is not None:
            self.git_config_username_and_email(git_user, git_email)

        self.lfs_enable_largefiles()
        self.git_credential_helper_store()

        if revision is not None:
            self.git_checkout(revision, create_branch_ok=True)

        # This ensures that all commands exit before exiting the Python runtime.
        # This will ensure all pushes register on the hub, even if other errors happen in subsequent operations.
        atexit.register(self.wait_for_commands)

    @property
    def current_branch(self) -> str:
        """
        Returns the current checked out branch.

        Returns:
            `str`: Current checked out branch.
        """
        try:
            result = run_subprocess("git rev-parse --abbrev-ref HEAD", self.local_dir).stdout.strip()
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

        return result

    def check_git_versions(self):
        """
        Checks that `git` and `git-lfs` can be run.

        Raises:
            [`EnvironmentError`](https://docs.python.org/3/library/exceptions.html#EnvironmentError)
                If `git` or `git-lfs` are not installed.
        """
        try:
            git_version = run_subprocess("git --version", self.local_dir).stdout.strip()
        except FileNotFoundError:
            raise EnvironmentError("Looks like you do not have git installed, please install.")

        try:
            lfs_version = run_subprocess("git-lfs --version", self.local_dir).stdout.strip()
        except FileNotFoundError:
            raise EnvironmentError(
                "Looks like you do not have git-lfs installed, please install."
                " You can install from https://git-lfs.github.com/."
                " Then run `git lfs install` (you only have to do this once)."
            )
        logger.info(git_version + "\n" + lfs_version)

    @validate_hf_hub_args
    def clone_from(self, repo_url: str, token: Union[bool, str, None] = None):
        """
        Clone from a remote. If the folder already exists, will try to clone the
        repository within it.

        If this folder is a git repository with linked history, will try to
        update the repository.

        Args:
            repo_url (`str`):
                The URL from which to clone the repository
            token (`Union[str, bool]`, *optional*):
                Whether to use the authentication token. It can be:
                 - a string which is the token itself
                 - `False`, which would not use the authentication token
                 - `True`, which would fetch the authentication token from the
                   local folder and use it (you should be logged in for this to
                   work).
                - `None`, which would retrieve the value of
                  `self.huggingface_token`.

        <Tip>

        Raises the following error:

            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if an organization token (starts with "api_org") is passed. Use must use
              your own personal access token (see https://hf.co/settings/tokens).

            - [`EnvironmentError`](https://docs.python.org/3/library/exceptions.html#EnvironmentError)
              if you are trying to clone the repository in a non-empty folder, or if the
              `git` operations raise errors.

        </Tip>
        """
        token = (
            token  # str -> use it
            if isinstance(token, str)
            else (
                None  # `False` -> explicit no token
                if token is False
                else self.huggingface_token  # `None` or `True` -> use default
            )
        )
        if token is not None and token.startswith("api_org"):
            raise ValueError(
                "You must use your personal access token, not an Organization token"
                " (see https://hf.co/settings/tokens)."
            )

        hub_url = self.client.endpoint
        if hub_url in repo_url or ("http" not in repo_url and len(repo_url.split("/")) <= 2):
            repo_type, namespace, repo_name = repo_type_and_id_from_hf_id(repo_url, hub_url=hub_url)
            repo_id = f"{namespace}/{repo_name}" if namespace is not None else repo_name

            if repo_type is not None:
                self._repo_type = repo_type

            repo_url = hub_url + "/"

            if self._repo_type in constants.REPO_TYPES_URL_PREFIXES:
                repo_url += constants.REPO_TYPES_URL_PREFIXES[self._repo_type]

            if token is not None:
                # Add token in git url when provided
                scheme = urlparse(repo_url).scheme
                repo_url = repo_url.replace(f"{scheme}://", f"{scheme}://user:{token}@")

            repo_url += repo_id

        # For error messages, it's cleaner to show the repo url without the token.
        clean_repo_url = re.sub(r"(https?)://.*@", r"\1://", repo_url)
        try:
            run_subprocess("git lfs install", self.local_dir)

            # checks if repository is initialized in a empty repository or in one with files
            if len(os.listdir(self.local_dir)) == 0:
                logger.warning(f"Cloning {clean_repo_url} into local empty directory.")

                with _lfs_log_progress():
                    env = os.environ.copy()

                    if self.skip_lfs_files:
                        env.update({"GIT_LFS_SKIP_SMUDGE": "1"})

                    run_subprocess(
                        # 'git lfs clone' is deprecated (will display a warning in the terminal)
                        # but we still use it as it provides a nicer UX when downloading large
                        # files (shows progress).
                        f"{'git clone' if self.skip_lfs_files else 'git lfs clone'} {repo_url} .",
                        self.local_dir,
                        env=env,
                    )
            else:
                # Check if the folder is the root of a git repository
                if not is_git_repo(self.local_dir):
                    raise EnvironmentError(
                        "Tried to clone a repository in a non-empty folder that isn't"
                        f" a git repository ('{self.local_dir}'). If you really want to"
                        f" do this, do it manually:\n cd {self.local_dir} && git init"
                        " && git remote add origin && git pull origin main\n or clone"
                        " repo to a new folder and move your existing files there"
                        " afterwards."
                    )

                if is_local_clone(self.local_dir, repo_url):
                    logger.warning(
                        f"{self.local_dir} is already a clone of {clean_repo_url}."
                        " Make sure you pull the latest changes with"
                        " `repo.git_pull()`."
                    )
                else:
                    output = run_subprocess("git remote get-url origin", self.local_dir, check=False)

                    error_msg = (
                        f"Tried to clone {clean_repo_url} in an unrelated git"
                        " repository.\nIf you believe this is an error, please add"
                        f" a remote with the following URL: {clean_repo_url}."
                    )
                    if output.returncode == 0:
                        clean_local_remote_url = re.sub(r"https://.*@", "https://", output.stdout)
                        error_msg += f"\nLocal path has its origin defined as: {clean_local_remote_url}"
                    raise EnvironmentError(error_msg)

        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_config_username_and_email(self, git_user: Optional[str] = None, git_email: Optional[str] = None):
        """
        Sets git username and email (only in the current repo).

        Args:
            git_user (`str`, *optional*):
                The username to register through `git`.
            git_email (`str`, *optional*):
                The email to register through `git`.
        """
        try:
            if git_user is not None:
                run_subprocess("git config user.name".split() + [git_user], self.local_dir)

            if git_email is not None:
                run_subprocess(f"git config user.email {git_email}".split(), self.local_dir)
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_credential_helper_store(self):
        """
        Sets the git credential helper to `store`
        """
        try:
            run_subprocess("git config credential.helper store", self.local_dir)
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_head_hash(self) -> str:
        """
        Get commit sha on top of HEAD.

        Returns:
            `str`: The current checked out commit SHA.
        """
        try:
            p = run_subprocess("git rev-parse HEAD", self.local_dir)
            return p.stdout.strip()
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_remote_url(self) -> str:
        """
        Get URL to origin remote.

        Returns:
            `str`: The URL of the `origin` remote.
        """
        try:
            p = run_subprocess("git config --get remote.origin.url", self.local_dir)
            url = p.stdout.strip()
            # Strip basic auth info.
            return re.sub(r"https://.*@", "https://", url)
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_head_commit_url(self) -> str:
        """
        Get URL to last commit on HEAD. We assume it's been pushed, and the url
        scheme is the same one as for GitHub or HuggingFace.

        Returns:
            `str`: The URL to the current checked-out commit.
        """
        sha = self.git_head_hash()
        url = self.git_remote_url()
        if url.endswith("/"):
            url = url[:-1]
        return f"{url}/commit/{sha}"

    def list_deleted_files(self) -> List[str]:
        """
        Returns a list of the files that are deleted in the working directory or
        index.

        Returns:
            `List[str]`: A list of files that have been deleted in the working
            directory or index.
        """
        try:
            git_status = run_subprocess("git status -s", self.local_dir).stdout.strip()
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

        if len(git_status) == 0:
            return []

        # Receives a status like the following
        #  D .gitignore
        #  D new_file.json
        # AD new_file1.json
        # ?? new_file2.json
        # ?? new_file4.json

        # Strip each line of whitespaces
        modified_files_statuses = [status.strip() for status in git_status.split("\n")]

        # Only keep files that are deleted using the D prefix
        deleted_files_statuses = [status for status in modified_files_statuses if "D" in status.split()[0]]

        # Remove the D prefix and strip to keep only the relevant filename
        deleted_files = [status.split()[-1].strip() for status in deleted_files_statuses]

        return deleted_files

    def lfs_track(self, patterns: Union[str, List[str]], filename: bool = False):
        """
        Tell git-lfs to track files according to a pattern.

        Setting the `filename` argument to `True` will treat the arguments as
        literal filenames, not as patterns. Any special glob characters in the
        filename will be escaped when writing to the `.gitattributes` file.

        Args:
            patterns (`Union[str, List[str]]`):
                The pattern, or list of patterns, to track with git-lfs.
            filename (`bool`, *optional*, defaults to `False`):
                Whether to use the patterns as literal filenames.
        """
        if isinstance(patterns, str):
            patterns = [patterns]
        try:
            for pattern in patterns:
                run_subprocess(
                    f"git lfs track {'--filename' if filename else ''} {pattern}",
                    self.local_dir,
                )
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def lfs_untrack(self, patterns: Union[str, List[str]]):
        """
        Tell git-lfs to untrack those files.

        Args:
            patterns (`Union[str, List[str]]`):
                The pattern, or list of patterns, to untrack with git-lfs.
        """
        if isinstance(patterns, str):
            patterns = [patterns]
        try:
            for pattern in patterns:
                run_subprocess("git lfs untrack".split() + [pattern], self.local_dir)
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def lfs_enable_largefiles(self):
        """
        HF-specific. This enables upload support of files >5GB.
        """
        try:
            lfs_config = "git config lfs.customtransfer.multipart"
            run_subprocess(f"{lfs_config}.path huggingface-cli", self.local_dir)
            run_subprocess(
                f"{lfs_config}.args {LFS_MULTIPART_UPLOAD_COMMAND}",
                self.local_dir,
            )
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def auto_track_binary_files(self, pattern: str = ".") -> List[str]:
        """
        Automatically track binary files with git-lfs.

        Args:
            pattern (`str`, *optional*, defaults to "."):
                The pattern with which to track files that are binary.

        Returns:
            `List[str]`: List of filenames that are now tracked due to being
            binary files
        """
        files_to_be_tracked_with_lfs = []

        deleted_files = self.list_deleted_files()

        for filename in files_to_be_staged(pattern, folder=self.local_dir):
            if filename in deleted_files:
                continue

            path_to_file = os.path.join(os.getcwd(), self.local_dir, filename)

            if not (is_tracked_with_lfs(path_to_file) or is_git_ignored(path_to_file)):
                size_in_mb = os.path.getsize(path_to_file) / (1024 * 1024)

                if size_in_mb >= 10:
                    logger.warning(
                        "Parsing a large file to check if binary or not. Tracking large"
                        " files using `repository.auto_track_large_files` is"
                        " recommended so as to not load the full file in memory."
                    )

                is_binary = is_binary_file(path_to_file)

                if is_binary:
                    self.lfs_track(filename)
                    files_to_be_tracked_with_lfs.append(filename)

        # Cleanup the .gitattributes if files were deleted
        self.lfs_untrack(deleted_files)

        return files_to_be_tracked_with_lfs

    def auto_track_large_files(self, pattern: str = ".") -> List[str]:
        """
        Automatically track large files (files that weigh more than 10MBs) with
        git-lfs.

        Args:
            pattern (`str`, *optional*, defaults to "."):
                The pattern with which to track files that are above 10MBs.

        Returns:
            `List[str]`: List of filenames that are now tracked due to their
            size.
        """
        files_to_be_tracked_with_lfs = []

        deleted_files = self.list_deleted_files()

        for filename in files_to_be_staged(pattern, folder=self.local_dir):
            if filename in deleted_files:
                continue

            path_to_file = os.path.join(os.getcwd(), self.local_dir, filename)
            size_in_mb = os.path.getsize(path_to_file) / (1024 * 1024)

            if size_in_mb >= 10 and not is_tracked_with_lfs(path_to_file) and not is_git_ignored(path_to_file):
                self.lfs_track(filename)
                files_to_be_tracked_with_lfs.append(filename)

        # Cleanup the .gitattributes if files were deleted
        self.lfs_untrack(deleted_files)

        return files_to_be_tracked_with_lfs

    def lfs_prune(self, recent=False):
        """
        git lfs prune

        Args:
            recent (`bool`, *optional*, defaults to `False`):
                Whether to prune files even if they were referenced by recent
                commits. See the following
                [link](https://github.com/git-lfs/git-lfs/blob/f3d43f0428a84fc4f1e5405b76b5a73ec2437e65/docs/man/git-lfs-prune.1.ronn#recent-files)
                for more information.
        """
        try:
            with _lfs_log_progress():
                result = run_subprocess(f"git lfs prune {'--recent' if recent else ''}", self.local_dir)
                logger.info(result.stdout)
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_pull(self, rebase: bool = False, lfs: bool = False):
        """
        git pull

        Args:
            rebase (`bool`, *optional*, defaults to `False`):
                Whether to rebase the current branch on top of the upstream
                branch after fetching.
            lfs (`bool`, *optional*, defaults to `False`):
                Whether to fetch the LFS files too. This option only changes the
                behavior when a repository was cloned without fetching the LFS
                files; calling `repo.git_pull(lfs=True)` will then fetch the LFS
                file from the remote repository.
        """
        command = "git pull" if not lfs else "git lfs pull"
        if rebase:
            command += " --rebase"
        try:
            with _lfs_log_progress():
                result = run_subprocess(command, self.local_dir)
                logger.info(result.stdout)
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_add(self, pattern: str = ".", auto_lfs_track: bool = False):
        """
        git add

        Setting the `auto_lfs_track` parameter to `True` will automatically
        track files that are larger than 10MB with `git-lfs`.

        Args:
            pattern (`str`, *optional*, defaults to "."):
                The pattern with which to add files to staging.
            auto_lfs_track (`bool`, *optional*, defaults to `False`):
                Whether to automatically track large and binary files with
                git-lfs. Any file over 10MB in size, or in binary format, will
                be automatically tracked.
        """
        if auto_lfs_track:
            # Track files according to their size (>=10MB)
            tracked_files = self.auto_track_large_files(pattern)

            # Read the remaining files and track them if they're binary
            tracked_files.extend(self.auto_track_binary_files(pattern))

            if tracked_files:
                logger.warning(
                    f"Adding files tracked by Git LFS: {tracked_files}. This may take a"
                    " bit of time if the files are large."
                )

        try:
            result = run_subprocess("git add -v".split() + [pattern], self.local_dir)
            logger.info(f"Adding to index:\n{result.stdout}\n")
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

    def git_commit(self, commit_message: str = "commit files to HF hub"):
        """
        git commit

        Args:
            commit_message (`str`, *optional*, defaults to "commit files to HF hub"):
                The message attributed to the commit.
        """
        try:
            result = run_subprocess("git commit -v -m".split() + [commit_message], self.local_dir)
            logger.info(f"Committed:\n{result.stdout}\n")
        except subprocess.CalledProcessError as exc:
            if len(exc.stderr) > 0:
                raise EnvironmentError(exc.stderr)
            else:
                raise EnvironmentError(exc.stdout)

    def git_push(
        self,
        upstream: Optional[str] = None,
        blocking: bool = True,
        auto_lfs_prune: bool = False,
    ) -> Union[str, Tuple[str, CommandInProgress]]:
        """
        git push

        If used without setting `blocking`, will return url to commit on remote
        repo. If used with `blocking=True`, will return a tuple containing the
        url to commit and the command object to follow for information about the
        process.

        Args:
            upstream (`str`, *optional*):
                Upstream to which this should push. If not specified, will push
                to the lastly defined upstream or to the default one (`origin
                main`).
            blocking (`bool`, *optional*, defaults to `True`):
                Whether the function should return only when the push has
                finished. Setting this to `False` will return an
                `CommandInProgress` object which has an `is_done` property. This
                property will be set to `True` when the push is finished.
            auto_lfs_prune (`bool`, *optional*, defaults to `False`):
                Whether to automatically prune files once they have been pushed
                to the remote.
        """
        command = "git push"

        if upstream:
            command += f" --set-upstream {upstream}"

        number_of_commits = commits_to_push(self.local_dir, upstream)

        if number_of_commits > 1:
            logger.warning(f"Several commits ({number_of_commits}) will be pushed upstream.")
            if blocking:
                logger.warning("The progress bars may be unreliable.")

        try:
            with _lfs_log_progress():
                process = subprocess.Popen(
                    command.split(),
                    stderr=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    encoding="utf-8",
                    cwd=self.local_dir,
                )

                if blocking:
                    stdout, stderr = process.communicate()
                    return_code = process.poll()
                    process.kill()

                    if len(stderr):
                        logger.warning(stderr)

                    if return_code:
                        raise subprocess.CalledProcessError(return_code, process.args, output=stdout, stderr=stderr)

        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

        if not blocking:

            def status_method():
                status = process.poll()
                if status is None:
                    return -1
                else:
                    return status

            command_in_progress = CommandInProgress(
                "push",
                is_done_method=lambda: process.poll() is not None,
                status_method=status_method,
                process=process,
                post_method=self.lfs_prune if auto_lfs_prune else None,
            )

            self.command_queue.append(command_in_progress)

            return self.git_head_commit_url(), command_in_progress

        if auto_lfs_prune:
            self.lfs_prune()

        return self.git_head_commit_url()

    def git_checkout(self, revision: str, create_branch_ok: bool = False):
        """
        git checkout a given revision

        Specifying `create_branch_ok` to `True` will create the branch to the
        given revision if that revision doesn't exist.

        Args:
            revision (`str`):
                The revision to checkout.
            create_branch_ok (`str`, *optional*, defaults to `False`):
                Whether creating a branch named with the `revision` passed at
                the current checked-out reference if `revision` isn't an
                existing revision is allowed.
        """
        try:
            result = run_subprocess(f"git checkout {revision}", self.local_dir)
            logger.warning(f"Checked out {revision} from {self.current_branch}.")
            logger.warning(result.stdout)
        except subprocess.CalledProcessError as exc:
            if not create_branch_ok:
                raise EnvironmentError(exc.stderr)
            else:
                try:
                    result = run_subprocess(f"git checkout -b {revision}", self.local_dir)
                    logger.warning(
                        f"Revision `{revision}` does not exist. Created and checked out branch `{revision}`."
                    )
                    logger.warning(result.stdout)
                except subprocess.CalledProcessError as exc:
                    raise EnvironmentError(exc.stderr)

    def tag_exists(self, tag_name: str, remote: Optional[str] = None) -> bool:
        """
        Check if a tag exists or not.

        Args:
            tag_name (`str`):
                The name of the tag to check.
            remote (`str`, *optional*):
                Whether to check if the tag exists on a remote. This parameter
                should be the identifier of the remote.

        Returns:
            `bool`: Whether the tag exists.
        """
        if remote:
            try:
                result = run_subprocess(f"git ls-remote origin refs/tags/{tag_name}", self.local_dir).stdout.strip()
            except subprocess.CalledProcessError as exc:
                raise EnvironmentError(exc.stderr)

            return len(result) != 0
        else:
            try:
                git_tags = run_subprocess("git tag", self.local_dir).stdout.strip()
            except subprocess.CalledProcessError as exc:
                raise EnvironmentError(exc.stderr)

            git_tags = git_tags.split("\n")
            return tag_name in git_tags

    def delete_tag(self, tag_name: str, remote: Optional[str] = None) -> bool:
        """
        Delete a tag, both local and remote, if it exists

        Args:
            tag_name (`str`):
                The tag name to delete.
            remote (`str`, *optional*):
                The remote on which to delete the tag.

        Returns:
             `bool`: `True` if deleted, `False` if the tag didn't exist.
                If remote is not passed, will just be updated locally
        """
        delete_locally = True
        delete_remotely = True

        if not self.tag_exists(tag_name):
            delete_locally = False

        if not self.tag_exists(tag_name, remote=remote):
            delete_remotely = False

        if delete_locally:
            try:
                run_subprocess(["git", "tag", "-d", tag_name], self.local_dir).stdout.strip()
            except subprocess.CalledProcessError as exc:
                raise EnvironmentError(exc.stderr)

        if remote and delete_remotely:
            try:
                run_subprocess(f"git push {remote} --delete {tag_name}", self.local_dir).stdout.strip()
            except subprocess.CalledProcessError as exc:
                raise EnvironmentError(exc.stderr)

        return True

    def add_tag(self, tag_name: str, message: Optional[str] = None, remote: Optional[str] = None):
        """
        Add a tag at the current head and push it

        If remote is None, will just be updated locally

        If no message is provided, the tag will be lightweight. if a message is
        provided, the tag will be annotated.

        Args:
            tag_name (`str`):
                The name of the tag to be added.
            message (`str`, *optional*):
                The message that accompanies the tag. The tag will turn into an
                annotated tag if a message is passed.
            remote (`str`, *optional*):
                The remote on which to add the tag.
        """
        if message:
            tag_args = ["git", "tag", "-a", tag_name, "-m", message]
        else:
            tag_args = ["git", "tag", tag_name]

        try:
            run_subprocess(tag_args, self.local_dir).stdout.strip()
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

        if remote:
            try:
                run_subprocess(f"git push {remote} {tag_name}", self.local_dir).stdout.strip()
            except subprocess.CalledProcessError as exc:
                raise EnvironmentError(exc.stderr)

    def is_repo_clean(self) -> bool:
        """
        Return whether or not the git status is clean or not

        Returns:
            `bool`: `True` if the git status is clean, `False` otherwise.
        """
        try:
            git_status = run_subprocess("git status --porcelain", self.local_dir).stdout.strip()
        except subprocess.CalledProcessError as exc:
            raise EnvironmentError(exc.stderr)

        return len(git_status) == 0

    def push_to_hub(
        self,
        commit_message: str = "commit files to HF hub",
        blocking: bool = True,
        clean_ok: bool = True,
        auto_lfs_prune: bool = False,
    ) -> Union[None, str, Tuple[str, CommandInProgress]]:
        """
        Helper to add, commit, and push files to remote repository on the
        HuggingFace Hub. Will automatically track large files (>10MB).

        Args:
            commit_message (`str`):
                Message to use for the commit.
            blocking (`bool`, *optional*, defaults to `True`):
                Whether the function should return only when the `git push` has
                finished.
            clean_ok (`bool`, *optional*, defaults to `True`):
                If True, this function will return None if the repo is
                untouched. Default behavior is to fail because the git command
                fails.
            auto_lfs_prune (`bool`, *optional*, defaults to `False`):
                Whether to automatically prune files once they have been pushed
                to the remote.
        """
        if clean_ok and self.is_repo_clean():
            logger.info("Repo currently clean. Ignoring push_to_hub")
            return None
        self.git_add(auto_lfs_track=True)
        self.git_commit(commit_message)
        return self.git_push(
            upstream=f"origin {self.current_branch}",
            blocking=blocking,
            auto_lfs_prune=auto_lfs_prune,
        )

    @contextmanager
    def commit(
        self,
        commit_message: str,
        branch: Optional[str] = None,
        track_large_files: bool = True,
        blocking: bool = True,
        auto_lfs_prune: bool = False,
    ):
        """
        Context manager utility to handle committing to a repository. This
        automatically tracks large files (>10Mb) with git-lfs. Set the
        `track_large_files` argument to `False` if you wish to ignore that
        behavior.

        Args:
            commit_message (`str`):
                Message to use for the commit.
            branch (`str`, *optional*):
                The branch on which the commit will appear. This branch will be
                checked-out before any operation.
            track_large_files (`bool`, *optional*, defaults to `True`):
                Whether to automatically track large files or not. Will do so by
                default.
            blocking (`bool`, *optional*, defaults to `True`):
                Whether the function should return only when the `git push` has
                finished.
            auto_lfs_prune (`bool`, defaults to `True`):
                Whether to automatically prune files once they have been pushed
                to the remote.

        Examples:

        ```python
        >>> with Repository(
        ...     "text-files",
        ...     clone_from="<user>/text-files",
        ...     token=True,
        >>> ).commit("My first file :)"):
        ...     with open("file.txt", "w+") as f:
        ...         f.write(json.dumps({"hey": 8}))

        >>> import torch

        >>> model = torch.nn.Transformer()
        >>> with Repository(
        ...     "torch-model",
        ...     clone_from="<user>/torch-model",
        ...     token=True,
        >>> ).commit("My cool model :)"):
        ...     torch.save(model.state_dict(), "model.pt")
        ```

        """

        files_to_stage = files_to_be_staged(".", folder=self.local_dir)

        if len(files_to_stage):
            files_in_msg = str(files_to_stage[:5])[:-1] + ", ...]" if len(files_to_stage) > 5 else str(files_to_stage)
            logger.error(
                "There exists some updated files in the local repository that are not"
                f" committed: {files_in_msg}. This may lead to errors if checking out"
                " a branch. These files and their modifications will be added to the"
                " current commit."
            )

        if branch is not None:
            self.git_checkout(branch, create_branch_ok=True)

        if is_tracked_upstream(self.local_dir):
            logger.warning("Pulling changes ...")
            self.git_pull(rebase=True)
        else:
            logger.warning(f"The current branch has no upstream branch. Will push to 'origin {self.current_branch}'")

        current_working_directory = os.getcwd()
        os.chdir(os.path.join(current_working_directory, self.local_dir))

        try:
            yield self
        finally:
            self.git_add(auto_lfs_track=track_large_files)

            try:
                self.git_commit(commit_message)
            except OSError as e:
                # If no changes are detected, there is nothing to commit.
                if "nothing to commit" not in str(e):
                    raise e

            try:
                self.git_push(
                    upstream=f"origin {self.current_branch}",
                    blocking=blocking,
                    auto_lfs_prune=auto_lfs_prune,
                )
            except OSError as e:
                # If no changes are detected, there is nothing to commit.
                if "could not read Username" in str(e):
                    raise OSError("Couldn't authenticate user for push. Did you set `token` to `True`?") from e
                else:
                    raise e

            os.chdir(current_working_directory)

    def repocard_metadata_load(self) -> Optional[Dict]:
        filepath = os.path.join(self.local_dir, constants.REPOCARD_NAME)
        if os.path.isfile(filepath):
            return metadata_load(filepath)
        return None

    def repocard_metadata_save(self, data: Dict) -> None:
        return metadata_save(os.path.join(self.local_dir, constants.REPOCARD_NAME), data)

    @property
    def commands_failed(self):
        """
        Returns the asynchronous commands that failed.
        """
        return [c for c in self.command_queue if c.status > 0]

    @property
    def commands_in_progress(self):
        """
        Returns the asynchronous commands that are currently in progress.
        """
        return [c for c in self.command_queue if not c.is_done]

    def wait_for_commands(self):
        """
        Blocking method: blocks all subsequent execution until all commands have
        been processed.
        """
        index = 0
        for command_failed in self.commands_failed:
            logger.error(f"The {command_failed.title} command with PID {command_failed._process.pid} failed.")
            logger.error(command_failed.stderr)

        while self.commands_in_progress:
            if index % 10 == 0:
                logger.warning(
                    f"Waiting for the following commands to finish before shutting down: {self.commands_in_progress}."
                )

            index += 1

            time.sleep(1)
