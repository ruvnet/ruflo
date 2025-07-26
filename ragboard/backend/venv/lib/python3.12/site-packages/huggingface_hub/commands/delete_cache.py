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
"""Contains command to delete some revisions from the HF cache directory.

Usage:
    huggingface-cli delete-cache
    huggingface-cli delete-cache --disable-tui
    huggingface-cli delete-cache --dir ~/.cache/huggingface/hub
    huggingface-cli delete-cache --sort=size

NOTE:
    This command is based on `InquirerPy` to build the multiselect menu in the terminal.
    This dependency has to be installed with `pip install huggingface_hub[cli]`. Since
    we want to avoid as much as possible cross-platform issues, I chose a library that
    is built on top of `python-prompt-toolkit` which seems to be a reference in terminal
    GUI (actively maintained on both Unix and Windows, 7.9k stars).

    For the moment, the TUI feature is in beta.

    See:
    - https://github.com/kazhala/InquirerPy
    - https://inquirerpy.readthedocs.io/en/latest/
    - https://github.com/prompt-toolkit/python-prompt-toolkit

    Other solutions could have been:
    - `simple_term_menu`: would be good as well for our use case but some issues suggest
      that Windows is less supported.
      See: https://github.com/IngoMeyer441/simple-term-menu
    - `PyInquirer`: very similar to `InquirerPy` but older and not maintained anymore.
      In particular, no support of Python3.10.
      See: https://github.com/CITGuru/PyInquirer
    - `pick` (or `pickpack`): easy to use and flexible but built on top of Python's
      standard library `curses` that is specific to Unix (not implemented on Windows).
      See https://github.com/wong2/pick and https://github.com/anafvana/pickpack.
    - `inquirer`: lot of traction (700 stars) but explicitly states "experimental
      support of Windows". Not built on top of `python-prompt-toolkit`.
      See https://github.com/magmax/python-inquirer

TODO: add support for `huggingface-cli delete-cache aaaaaa bbbbbb cccccc (...)` ?
TODO: add "--keep-last" arg to delete revisions that are not on `main` ref
TODO: add "--filter" arg to filter repositories by name ?
TODO: add "--limit" arg to limit to X repos ?
TODO: add "-y" arg for immediate deletion ?
See discussions in https://github.com/huggingface/huggingface_hub/issues/1025.
"""

import os
from argparse import Namespace, _SubParsersAction
from functools import wraps
from tempfile import mkstemp
from typing import Any, Callable, Iterable, List, Literal, Optional, Union

from ..utils import CachedRepoInfo, CachedRevisionInfo, HFCacheInfo, scan_cache_dir
from . import BaseHuggingfaceCLICommand
from ._cli_utils import ANSI


try:
    from InquirerPy import inquirer
    from InquirerPy.base.control import Choice
    from InquirerPy.separator import Separator

    _inquirer_py_available = True
except ImportError:
    _inquirer_py_available = False

SortingOption_T = Literal["alphabetical", "lastUpdated", "lastUsed", "size"]


def require_inquirer_py(fn: Callable) -> Callable:
    """Decorator to flag methods that require `InquirerPy`."""

    # TODO: refactor this + imports in a unified pattern across codebase
    @wraps(fn)
    def _inner(*args, **kwargs):
        if not _inquirer_py_available:
            raise ImportError(
                "The `delete-cache` command requires extra dependencies to work with"
                " the TUI.\nPlease run `pip install huggingface_hub[cli]` to install"
                " them.\nOtherwise, disable TUI using the `--disable-tui` flag."
            )

        return fn(*args, **kwargs)

    return _inner


# Possibility for the user to cancel deletion
_CANCEL_DELETION_STR = "CANCEL_DELETION"


class DeleteCacheCommand(BaseHuggingfaceCLICommand):
    @staticmethod
    def register_subcommand(parser: _SubParsersAction):
        delete_cache_parser = parser.add_parser("delete-cache", help="Delete revisions from the cache directory.")

        delete_cache_parser.add_argument(
            "--dir",
            type=str,
            default=None,
            help="cache directory (optional). Default to the default HuggingFace cache.",
        )

        delete_cache_parser.add_argument(
            "--disable-tui",
            action="store_true",
            help=(
                "Disable Terminal User Interface (TUI) mode. Useful if your"
                " platform/terminal doesn't support the multiselect menu."
            ),
        )

        delete_cache_parser.add_argument(
            "--sort",
            nargs="?",
            choices=["alphabetical", "lastUpdated", "lastUsed", "size"],
            help=(
                "Sort repositories by the specified criteria. Options: "
                "'alphabetical' (A-Z), "
                "'lastUpdated' (newest first), "
                "'lastUsed' (most recent first), "
                "'size' (largest first)."
            ),
        )

        delete_cache_parser.set_defaults(func=DeleteCacheCommand)

    def __init__(self, args: Namespace) -> None:
        self.cache_dir: Optional[str] = args.dir
        self.disable_tui: bool = args.disable_tui
        self.sort_by: Optional[SortingOption_T] = args.sort

    def run(self):
        """Run `delete-cache` command with or without TUI."""
        # Scan cache directory
        hf_cache_info = scan_cache_dir(self.cache_dir)

        # Manual review from the user
        if self.disable_tui:
            selected_hashes = _manual_review_no_tui(hf_cache_info, preselected=[], sort_by=self.sort_by)
        else:
            selected_hashes = _manual_review_tui(hf_cache_info, preselected=[], sort_by=self.sort_by)

        # If deletion is not cancelled
        if len(selected_hashes) > 0 and _CANCEL_DELETION_STR not in selected_hashes:
            confirm_message = _get_expectations_str(hf_cache_info, selected_hashes) + " Confirm deletion ?"

            # Confirm deletion
            if self.disable_tui:
                confirmed = _ask_for_confirmation_no_tui(confirm_message)
            else:
                confirmed = _ask_for_confirmation_tui(confirm_message)

            # Deletion is confirmed
            if confirmed:
                strategy = hf_cache_info.delete_revisions(*selected_hashes)
                print("Start deletion.")
                strategy.execute()
                print(
                    f"Done. Deleted {len(strategy.repos)} repo(s) and"
                    f" {len(strategy.snapshots)} revision(s) for a total of"
                    f" {strategy.expected_freed_size_str}."
                )
                return

        # Deletion is cancelled
        print("Deletion is cancelled. Do nothing.")


def _get_repo_sorting_key(repo: CachedRepoInfo, sort_by: Optional[SortingOption_T] = None):
    if sort_by == "alphabetical":
        return (repo.repo_type, repo.repo_id.lower())  # by type then name
    elif sort_by == "lastUpdated":
        return -max(rev.last_modified for rev in repo.revisions)  # newest first
    elif sort_by == "lastUsed":
        return -repo.last_accessed  # most recently used first
    elif sort_by == "size":
        return -repo.size_on_disk  # largest first
    else:
        return (repo.repo_type, repo.repo_id)  # default stable order


@require_inquirer_py
def _manual_review_tui(
    hf_cache_info: HFCacheInfo,
    preselected: List[str],
    sort_by: Optional[SortingOption_T] = None,
) -> List[str]:
    """Ask the user for a manual review of the revisions to delete.

    Displays a multi-select menu in the terminal (TUI).
    """
    # Define multiselect list
    choices = _get_tui_choices_from_scan(
        repos=hf_cache_info.repos,
        preselected=preselected,
        sort_by=sort_by,
    )
    checkbox = inquirer.checkbox(
        message="Select revisions to delete:",
        choices=choices,  # List of revisions with some pre-selection
        cycle=False,  # No loop between top and bottom
        height=100,  # Large list if possible
        # We use the instruction to display to the user the expected effect of the
        # deletion.
        instruction=_get_expectations_str(
            hf_cache_info,
            selected_hashes=[c.value for c in choices if isinstance(c, Choice) and c.enabled],
        ),
        # We use the long instruction to should keybindings instructions to the user
        long_instruction="Press <space> to select, <enter> to validate and <ctrl+c> to quit without modification.",
        # Message that is displayed once the user validates its selection.
        transformer=lambda result: f"{len(result)} revision(s) selected.",
    )

    # Add a callback to update the information line when a revision is
    # selected/unselected
    def _update_expectations(_) -> None:
        # Hacky way to dynamically set an instruction message to the checkbox when
        # a revision hash is selected/unselected.
        checkbox._instruction = _get_expectations_str(
            hf_cache_info,
            selected_hashes=[choice["value"] for choice in checkbox.content_control.choices if choice["enabled"]],
        )

    checkbox.kb_func_lookup["toggle"].append({"func": _update_expectations})

    # Finally display the form to the user.
    try:
        return checkbox.execute()
    except KeyboardInterrupt:
        return []  # Quit without deletion


@require_inquirer_py
def _ask_for_confirmation_tui(message: str, default: bool = True) -> bool:
    """Ask for confirmation using Inquirer."""
    return inquirer.confirm(message, default=default).execute()


def _get_tui_choices_from_scan(
    repos: Iterable[CachedRepoInfo],
    preselected: List[str],
    sort_by: Optional[SortingOption_T] = None,
) -> List:
    """Build a list of choices from the scanned repos.

    Args:
        repos (*Iterable[`CachedRepoInfo`]*):
            List of scanned repos on which we want to delete revisions.
        preselected (*List[`str`]*):
            List of revision hashes that will be preselected.
        sort_by (*Optional[SortingOption_T]*):
            Sorting direction. Choices: "alphabetical", "lastUpdated", "lastUsed", "size".

    Return:
        The list of choices to pass to `inquirer.checkbox`.
    """
    choices: List[Union[Choice, Separator]] = []

    # First choice is to cancel the deletion
    choices.append(
        Choice(
            _CANCEL_DELETION_STR,
            name="None of the following (if selected, nothing will be deleted).",
            enabled=False,
        )
    )

    # Sort repos based on specified criteria
    sorted_repos = sorted(repos, key=lambda repo: _get_repo_sorting_key(repo, sort_by))

    for repo in sorted_repos:
        # Repo as separator
        choices.append(
            Separator(
                f"\n{repo.repo_type.capitalize()} {repo.repo_id} ({repo.size_on_disk_str},"
                f" used {repo.last_accessed_str})"
            )
        )
        for revision in sorted(repo.revisions, key=_revision_sorting_order):
            # Revision as choice
            choices.append(
                Choice(
                    revision.commit_hash,
                    name=(
                        f"{revision.commit_hash[:8]}:"
                        f" {', '.join(sorted(revision.refs)) or '(detached)'} #"
                        f" modified {revision.last_modified_str}"
                    ),
                    enabled=revision.commit_hash in preselected,
                )
            )

    # Return choices
    return choices


def _manual_review_no_tui(
    hf_cache_info: HFCacheInfo,
    preselected: List[str],
    sort_by: Optional[SortingOption_T] = None,
) -> List[str]:
    """Ask the user for a manual review of the revisions to delete.

    Used when TUI is disabled. Manual review happens in a separate tmp file that the
    user can manually edit.
    """
    # 1. Generate temporary file with delete commands.
    fd, tmp_path = mkstemp(suffix=".txt")  # suffix to make it easier to find by editors
    os.close(fd)

    lines = []

    sorted_repos = sorted(hf_cache_info.repos, key=lambda repo: _get_repo_sorting_key(repo, sort_by))

    for repo in sorted_repos:
        lines.append(
            f"\n# {repo.repo_type.capitalize()} {repo.repo_id} ({repo.size_on_disk_str},"
            f" used {repo.last_accessed_str})"
        )
        for revision in sorted(repo.revisions, key=_revision_sorting_order):
            lines.append(
                # Deselect by prepending a '#'
                f"{'' if revision.commit_hash in preselected else '#'}   "
                f" {revision.commit_hash} # Refs:"
                # Print `refs` as comment on same line
                f" {', '.join(sorted(revision.refs)) or '(detached)'} # modified"
                # Print `last_modified` as comment on same line
                f" {revision.last_modified_str}"
            )

    with open(tmp_path, "w") as f:
        f.write(_MANUAL_REVIEW_NO_TUI_INSTRUCTIONS)
        f.write("\n".join(lines))

    # 2. Prompt instructions to user.
    instructions = f"""
    TUI is disabled. In order to select which revisions you want to delete, please edit
    the following file using the text editor of your choice. Instructions for manual
    editing are located at the beginning of the file. Edit the file, save it and confirm
    to continue.
    File to edit: {ANSI.bold(tmp_path)}
    """
    print("\n".join(line.strip() for line in instructions.strip().split("\n")))

    # 3. Wait for user confirmation.
    while True:
        selected_hashes = _read_manual_review_tmp_file(tmp_path)
        if _ask_for_confirmation_no_tui(
            _get_expectations_str(hf_cache_info, selected_hashes) + " Continue ?",
            default=False,
        ):
            break

    # 4. Return selected_hashes sorted to maintain stable order
    os.remove(tmp_path)
    return sorted(selected_hashes)  # Sort to maintain stable order


def _ask_for_confirmation_no_tui(message: str, default: bool = True) -> bool:
    """Ask for confirmation using pure-python."""
    YES = ("y", "yes", "1")
    NO = ("n", "no", "0")
    DEFAULT = ""
    ALL = YES + NO + (DEFAULT,)
    full_message = message + (" (Y/n) " if default else " (y/N) ")
    while True:
        answer = input(full_message).lower()
        if answer == DEFAULT:
            return default
        if answer in YES:
            return True
        if answer in NO:
            return False
        print(f"Invalid input. Must be one of {ALL}")


def _get_expectations_str(hf_cache_info: HFCacheInfo, selected_hashes: List[str]) -> str:
    """Format a string to display to the user how much space would be saved.

    Example:
    ```
    >>> _get_expectations_str(hf_cache_info, selected_hashes)
    '7 revisions selected counting for 4.3G.'
    ```
    """
    if _CANCEL_DELETION_STR in selected_hashes:
        return "Nothing will be deleted."
    strategy = hf_cache_info.delete_revisions(*selected_hashes)
    return f"{len(selected_hashes)} revisions selected counting for {strategy.expected_freed_size_str}."


def _read_manual_review_tmp_file(tmp_path: str) -> List[str]:
    """Read the manually reviewed instruction file and return a list of revision hash.

    Example:
        ```txt
        # This is the tmp file content
        ###

        # Commented out line
        123456789 # revision hash

        # Something else
        #      a_newer_hash # 2 days ago
            an_older_hash # 3 days ago
        ```

        ```py
        >>> _read_manual_review_tmp_file(tmp_path)
        ['123456789', 'an_older_hash']
        ```
    """
    with open(tmp_path) as f:
        content = f.read()

    # Split lines
    lines = [line.strip() for line in content.split("\n")]

    # Filter commented lines
    selected_lines = [line for line in lines if not line.startswith("#")]

    # Select only before comment
    selected_hashes = [line.split("#")[0].strip() for line in selected_lines]

    # Return revision hashes
    return [hash for hash in selected_hashes if len(hash) > 0]


_MANUAL_REVIEW_NO_TUI_INSTRUCTIONS = f"""
# INSTRUCTIONS
# ------------
# This is a temporary file created by running `huggingface-cli delete-cache` with the
# `--disable-tui` option. It contains a set of revisions that can be deleted from your
# local cache directory.
#
# Please manually review the revisions you want to delete:
#   - Revision hashes can be commented out with '#'.
#   - Only non-commented revisions in this file will be deleted.
#   - Revision hashes that are removed from this file are ignored as well.
#   - If `{_CANCEL_DELETION_STR}` line is uncommented, the all cache deletion is cancelled and
#     no changes will be applied.
#
# Once you've manually reviewed this file, please confirm deletion in the terminal. This
# file will be automatically removed once done.
# ------------

# KILL SWITCH
# ------------
# Un-comment following line to completely cancel the deletion process
# {_CANCEL_DELETION_STR}
# ------------

# REVISIONS
# ------------
""".strip()


def _revision_sorting_order(revision: CachedRevisionInfo) -> Any:
    # Sort by last modified (oldest first)
    return revision.last_modified
