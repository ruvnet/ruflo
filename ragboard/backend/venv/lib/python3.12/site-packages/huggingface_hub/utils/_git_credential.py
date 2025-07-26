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
"""Contains utilities to manage Git credentials."""

import re
import subprocess
from typing import List, Optional

from ..constants import ENDPOINT
from ._subprocess import run_interactive_subprocess, run_subprocess


GIT_CREDENTIAL_REGEX = re.compile(
    r"""
        ^\s* # start of line
        credential\.helper # credential.helper value
        \s*=\s* # separator
        (\w+) # the helper name (group 1)
        (\s|$) # whitespace or end of line
    """,
    flags=re.MULTILINE | re.IGNORECASE | re.VERBOSE,
)


def list_credential_helpers(folder: Optional[str] = None) -> List[str]:
    """Return the list of git credential helpers configured.

    See https://git-scm.com/docs/gitcredentials.

    Credentials are saved in all configured helpers (store, cache, macOS keychain,...).
    Calls "`git credential approve`" internally. See https://git-scm.com/docs/git-credential.

    Args:
        folder (`str`, *optional*):
            The folder in which to check the configured helpers.
    """
    try:
        output = run_subprocess("git config --list", folder=folder).stdout
        parsed = _parse_credential_output(output)
        return parsed
    except subprocess.CalledProcessError as exc:
        raise EnvironmentError(exc.stderr)


def set_git_credential(token: str, username: str = "hf_user", folder: Optional[str] = None) -> None:
    """Save a username/token pair in git credential for HF Hub registry.

    Credentials are saved in all configured helpers (store, cache, macOS keychain,...).
    Calls "`git credential approve`" internally. See https://git-scm.com/docs/git-credential.

    Args:
        username (`str`, defaults to `"hf_user"`):
            A git username. Defaults to `"hf_user"`, the default user used in the Hub.
        token (`str`, defaults to `"hf_user"`):
            A git password. In practice, the User Access Token for the Hub.
            See https://huggingface.co/settings/tokens.
        folder (`str`, *optional*):
            The folder in which to check the configured helpers.
    """
    with run_interactive_subprocess("git credential approve", folder=folder) as (
        stdin,
        _,
    ):
        stdin.write(f"url={ENDPOINT}\nusername={username.lower()}\npassword={token}\n\n")
        stdin.flush()


def unset_git_credential(username: str = "hf_user", folder: Optional[str] = None) -> None:
    """Erase credentials from git credential for HF Hub registry.

    Credentials are erased from the configured helpers (store, cache, macOS
    keychain,...), if any. If `username` is not provided, any credential configured for
    HF Hub endpoint is erased.
    Calls "`git credential erase`" internally. See https://git-scm.com/docs/git-credential.

    Args:
        username (`str`, defaults to `"hf_user"`):
            A git username. Defaults to `"hf_user"`, the default user used in the Hub.
        folder (`str`, *optional*):
            The folder in which to check the configured helpers.
    """
    with run_interactive_subprocess("git credential reject", folder=folder) as (
        stdin,
        _,
    ):
        standard_input = f"url={ENDPOINT}\n"
        if username is not None:
            standard_input += f"username={username.lower()}\n"
        standard_input += "\n"

        stdin.write(standard_input)
        stdin.flush()


def _parse_credential_output(output: str) -> List[str]:
    """Parse the output of `git credential fill` to extract the password.

    Args:
        output (`str`):
            The output of `git credential fill`.
    """
    # NOTE: If user has set an helper for a custom URL, it will not we caught here.
    #       Example: `credential.https://huggingface.co.helper=store`
    #       See: https://github.com/huggingface/huggingface_hub/pull/1138#discussion_r1013324508
    return sorted(  # Sort for nice printing
        set(  # Might have some duplicates
            match[0] for match in GIT_CREDENTIAL_REGEX.findall(output)
        )
    )
