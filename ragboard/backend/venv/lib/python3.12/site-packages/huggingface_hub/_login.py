# Copyright 2020 The HuggingFace Team. All rights reserved.
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
"""Contains methods to log in to the Hub."""

import os
import subprocess
from getpass import getpass
from pathlib import Path
from typing import Optional

from . import constants
from .commands._cli_utils import ANSI
from .utils import (
    capture_output,
    get_token,
    is_google_colab,
    is_notebook,
    list_credential_helpers,
    logging,
    run_subprocess,
    set_git_credential,
    unset_git_credential,
)
from .utils._auth import (
    _get_token_by_name,
    _get_token_from_environment,
    _get_token_from_file,
    _get_token_from_google_colab,
    _save_stored_tokens,
    _save_token,
    get_stored_tokens,
)
from .utils._deprecation import _deprecate_arguments, _deprecate_positional_args


logger = logging.get_logger(__name__)

_HF_LOGO_ASCII = """
    _|    _|  _|    _|    _|_|_|    _|_|_|  _|_|_|  _|      _|    _|_|_|      _|_|_|_|    _|_|      _|_|_|  _|_|_|_|
    _|    _|  _|    _|  _|        _|          _|    _|_|    _|  _|            _|        _|    _|  _|        _|
    _|_|_|_|  _|    _|  _|  _|_|  _|  _|_|    _|    _|  _|  _|  _|  _|_|      _|_|_|    _|_|_|_|  _|        _|_|_|
    _|    _|  _|    _|  _|    _|  _|    _|    _|    _|    _|_|  _|    _|      _|        _|    _|  _|        _|
    _|    _|    _|_|      _|_|_|    _|_|_|  _|_|_|  _|      _|    _|_|_|      _|        _|    _|    _|_|_|  _|_|_|_|
"""


@_deprecate_arguments(
    version="1.0",
    deprecated_args="write_permission",
    custom_message="Fine-grained tokens added complexity to the permissions, making it irrelevant to check if a token has 'write' access.",
)
@_deprecate_positional_args(version="1.0")
def login(
    token: Optional[str] = None,
    *,
    add_to_git_credential: bool = False,
    new_session: bool = True,
    write_permission: bool = False,
) -> None:
    """Login the machine to access the Hub.

    The `token` is persisted in cache and set as a git credential. Once done, the machine
    is logged in and the access token will be available across all `huggingface_hub`
    components. If `token` is not provided, it will be prompted to the user either with
    a widget (in a notebook) or via the terminal.

    To log in from outside of a script, one can also use `huggingface-cli login` which is
    a cli command that wraps [`login`].

    <Tip>

    [`login`] is a drop-in replacement method for [`notebook_login`] as it wraps and
    extends its capabilities.

    </Tip>

    <Tip>

    When the token is not passed, [`login`] will automatically detect if the script runs
    in a notebook or not. However, this detection might not be accurate due to the
    variety of notebooks that exists nowadays. If that is the case, you can always force
    the UI by using [`notebook_login`] or [`interpreter_login`].

    </Tip>

    Args:
        token (`str`, *optional*):
            User access token to generate from https://huggingface.co/settings/token.
        add_to_git_credential (`bool`, defaults to `False`):
            If `True`, token will be set as git credential. If no git credential helper
            is configured, a warning will be displayed to the user. If `token` is `None`,
            the value of `add_to_git_credential` is ignored and will be prompted again
            to the end user.
        new_session (`bool`, defaults to `True`):
            If `True`, will request a token even if one is already saved on the machine.
        write_permission (`bool`):
            Ignored and deprecated argument.
    Raises:
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If an organization token is passed. Only personal account tokens are valid
            to log in.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If token is invalid.
        [`ImportError`](https://docs.python.org/3/library/exceptions.html#ImportError)
            If running in a notebook but `ipywidgets` is not installed.
    """
    if token is not None:
        if not add_to_git_credential:
            logger.info(
                "The token has not been saved to the git credentials helper. Pass "
                "`add_to_git_credential=True` in this function directly or "
                "`--add-to-git-credential` if using via `huggingface-cli` if "
                "you want to set the git credential as well."
            )
        _login(token, add_to_git_credential=add_to_git_credential)
    elif is_notebook():
        notebook_login(new_session=new_session)
    else:
        interpreter_login(new_session=new_session)


def logout(token_name: Optional[str] = None) -> None:
    """Logout the machine from the Hub.

    Token is deleted from the machine and removed from git credential.

    Args:
        token_name (`str`, *optional*):
            Name of the access token to logout from. If `None`, will logout from all saved access tokens.
    Raises:
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError):
            If the access token name is not found.
    """
    if get_token() is None and not get_stored_tokens():  # No active token and no saved access tokens
        logger.warning("Not logged in!")
        return
    if not token_name:
        # Delete all saved access tokens and token
        for file_path in (constants.HF_TOKEN_PATH, constants.HF_STORED_TOKENS_PATH):
            try:
                Path(file_path).unlink()
            except FileNotFoundError:
                pass
        logger.info("Successfully logged out from all access tokens.")
    else:
        _logout_from_token(token_name)
        logger.info(f"Successfully logged out from access token: {token_name}.")

    unset_git_credential()

    # Check if still logged in
    if _get_token_from_google_colab() is not None:
        raise EnvironmentError(
            "You are automatically logged in using a Google Colab secret.\n"
            "To log out, you must unset the `HF_TOKEN` secret in your Colab settings."
        )
    if _get_token_from_environment() is not None:
        raise EnvironmentError(
            "Token has been deleted from your machine but you are still logged in.\n"
            "To log out, you must clear out both `HF_TOKEN` and `HUGGING_FACE_HUB_TOKEN` environment variables."
        )


def auth_switch(token_name: str, add_to_git_credential: bool = False) -> None:
    """Switch to a different access token.

    Args:
        token_name (`str`):
            Name of the access token to switch to.
        add_to_git_credential (`bool`, defaults to `False`):
            If `True`, token will be set as git credential. If no git credential helper
            is configured, a warning will be displayed to the user. If `token` is `None`,
            the value of `add_to_git_credential` is ignored and will be prompted again
            to the end user.

    Raises:
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError):
            If the access token name is not found.
    """
    token = _get_token_by_name(token_name)
    if not token:
        raise ValueError(f"Access token {token_name} not found in {constants.HF_STORED_TOKENS_PATH}")
    # Write token to HF_TOKEN_PATH
    _set_active_token(token_name, add_to_git_credential)
    logger.info(f"The current active token is: {token_name}")
    token_from_environment = _get_token_from_environment()
    if token_from_environment is not None and token_from_environment != token:
        logger.warning(
            "The environment variable `HF_TOKEN` is set and will override the access token you've just switched to."
        )


def auth_list() -> None:
    """List all stored access tokens."""
    tokens = get_stored_tokens()

    if not tokens:
        logger.info("No access tokens found.")
        return
    # Find current token
    current_token = get_token()
    current_token_name = None
    for token_name in tokens:
        if tokens.get(token_name) == current_token:
            current_token_name = token_name
    # Print header
    max_offset = max(len("token"), max(len(token) for token in tokens)) + 2
    print(f"  {{:<{max_offset}}}| {{:<15}}".format("name", "token"))
    print("-" * (max_offset + 2) + "|" + "-" * 15)

    # Print saved access tokens
    for token_name in tokens:
        token = tokens.get(token_name, "<not set>")
        masked_token = f"{token[:3]}****{token[-4:]}" if token != "<not set>" else token
        is_current = "*" if token == current_token else " "

        print(f"{is_current} {{:<{max_offset}}}| {{:<15}}".format(token_name, masked_token))

    if _get_token_from_environment():
        logger.warning(
            "\nNote: Environment variable `HF_TOKEN` is set and is the current active token independently from the stored tokens listed above."
        )
    elif current_token_name is None:
        logger.warning(
            "\nNote: No active token is set and no environment variable `HF_TOKEN` is found. Use `huggingface-cli login` to log in."
        )


###
# Interpreter-based login (text)
###


@_deprecate_arguments(
    version="1.0",
    deprecated_args="write_permission",
    custom_message="Fine-grained tokens added complexity to the permissions, making it irrelevant to check if a token has 'write' access.",
)
@_deprecate_positional_args(version="1.0")
def interpreter_login(*, new_session: bool = True, write_permission: bool = False) -> None:
    """
    Displays a prompt to log in to the HF website and store the token.

    This is equivalent to [`login`] without passing a token when not run in a notebook.
    [`interpreter_login`] is useful if you want to force the use of the terminal prompt
    instead of a notebook widget.

    For more details, see [`login`].

    Args:
        new_session (`bool`, defaults to `True`):
            If `True`, will request a token even if one is already saved on the machine.
        write_permission (`bool`):
            Ignored and deprecated argument.
    """
    if not new_session and get_token() is not None:
        logger.info("User is already logged in.")
        return

    from .commands.delete_cache import _ask_for_confirmation_no_tui

    print(_HF_LOGO_ASCII)
    if get_token() is not None:
        logger.info(
            "    A token is already saved on your machine. Run `huggingface-cli"
            " whoami` to get more information or `huggingface-cli logout` if you want"
            " to log out."
        )
        logger.info("    Setting a new token will erase the existing one.")

    logger.info(
        "    To log in, `huggingface_hub` requires a token generated from https://huggingface.co/settings/tokens ."
    )
    if os.name == "nt":
        logger.info("Token can be pasted using 'Right-Click'.")
    token = getpass("Enter your token (input will not be visible): ")
    add_to_git_credential = _ask_for_confirmation_no_tui("Add token as git credential?")

    _login(token=token, add_to_git_credential=add_to_git_credential)


###
# Notebook-based login (widget)
###

NOTEBOOK_LOGIN_PASSWORD_HTML = """<center> <img
src=https://huggingface.co/front/assets/huggingface_logo-noborder.svg
alt='Hugging Face'> <br> Immediately click login after typing your password or
it might be stored in plain text in this notebook file. </center>"""


NOTEBOOK_LOGIN_TOKEN_HTML_START = """<center> <img
src=https://huggingface.co/front/assets/huggingface_logo-noborder.svg
alt='Hugging Face'> <br> Copy a token from <a
href="https://huggingface.co/settings/tokens" target="_blank">your Hugging Face
tokens page</a> and paste it below. <br> Immediately click login after copying
your token or it might be stored in plain text in this notebook file. </center>"""


NOTEBOOK_LOGIN_TOKEN_HTML_END = """
<b>Pro Tip:</b> If you don't already have one, you can create a dedicated
'notebooks' token with 'write' access, that you can then easily reuse for all
notebooks. </center>"""


@_deprecate_arguments(
    version="1.0",
    deprecated_args="write_permission",
    custom_message="Fine-grained tokens added complexity to the permissions, making it irrelevant to check if a token has 'write' access.",
)
@_deprecate_positional_args(version="1.0")
def notebook_login(*, new_session: bool = True, write_permission: bool = False) -> None:
    """
    Displays a widget to log in to the HF website and store the token.

    This is equivalent to [`login`] without passing a token when run in a notebook.
    [`notebook_login`] is useful if you want to force the use of the notebook widget
    instead of a prompt in the terminal.

    For more details, see [`login`].

    Args:
        new_session (`bool`, defaults to `True`):
            If `True`, will request a token even if one is already saved on the machine.
        write_permission (`bool`):
            Ignored and deprecated argument.
    """
    try:
        import ipywidgets.widgets as widgets  # type: ignore
        from IPython.display import display  # type: ignore
    except ImportError:
        raise ImportError(
            "The `notebook_login` function can only be used in a notebook (Jupyter or"
            " Colab) and you need the `ipywidgets` module: `pip install ipywidgets`."
        )
    if not new_session and get_token() is not None:
        logger.info("User is already logged in.")
        return

    box_layout = widgets.Layout(display="flex", flex_flow="column", align_items="center", width="50%")

    token_widget = widgets.Password(description="Token:")
    git_checkbox_widget = widgets.Checkbox(value=True, description="Add token as git credential?")
    token_finish_button = widgets.Button(description="Login")

    login_token_widget = widgets.VBox(
        [
            widgets.HTML(NOTEBOOK_LOGIN_TOKEN_HTML_START),
            token_widget,
            git_checkbox_widget,
            token_finish_button,
            widgets.HTML(NOTEBOOK_LOGIN_TOKEN_HTML_END),
        ],
        layout=box_layout,
    )
    display(login_token_widget)

    # On click events
    def login_token_event(t):
        """Event handler for the login button."""
        token = token_widget.value
        add_to_git_credential = git_checkbox_widget.value
        # Erase token and clear value to make sure it's not saved in the notebook.
        token_widget.value = ""
        # Hide inputs
        login_token_widget.children = [widgets.Label("Connecting...")]
        try:
            with capture_output() as captured:
                _login(token, add_to_git_credential=add_to_git_credential)
            message = captured.getvalue()
        except Exception as error:
            message = str(error)
        # Print result (success message or error)
        login_token_widget.children = [widgets.Label(line) for line in message.split("\n") if line.strip()]

    token_finish_button.on_click(login_token_event)


###
# Login private helpers
###


def _login(
    token: str,
    add_to_git_credential: bool,
) -> None:
    from .hf_api import whoami  # avoid circular import

    if token.startswith("api_org"):
        raise ValueError("You must use your personal account token, not an organization token.")

    token_info = whoami(token)
    permission = token_info["auth"]["accessToken"]["role"]
    logger.info(f"Token is valid (permission: {permission}).")

    token_name = token_info["auth"]["accessToken"]["displayName"]
    # Store token locally
    _save_token(token=token, token_name=token_name)
    # Set active token
    _set_active_token(token_name=token_name, add_to_git_credential=add_to_git_credential)
    logger.info("Login successful.")
    if _get_token_from_environment():
        logger.warning(
            "Note: Environment variable`HF_TOKEN` is set and is the current active token independently from the token you've just configured."
        )
    else:
        logger.info(f"The current active token is: `{token_name}`")


def _logout_from_token(token_name: str) -> None:
    """Logout from a specific access token.

    Args:
        token_name (`str`):
            The name of the access token to logout from.
    Raises:
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError):
            If the access token name is not found.
    """
    stored_tokens = get_stored_tokens()
    # If there is no access tokens saved or the access token name is not found, do nothing
    if not stored_tokens or token_name not in stored_tokens:
        return

    token = stored_tokens.pop(token_name)
    _save_stored_tokens(stored_tokens)

    if token == _get_token_from_file():
        logger.warning(f"Active token '{token_name}' has been deleted.")
        Path(constants.HF_TOKEN_PATH).unlink(missing_ok=True)


def _set_active_token(
    token_name: str,
    add_to_git_credential: bool,
) -> None:
    """Set the active access token.

    Args:
        token_name (`str`):
            The name of the token to set as active.
    """
    token = _get_token_by_name(token_name)
    if not token:
        raise ValueError(f"Token {token_name} not found in {constants.HF_STORED_TOKENS_PATH}")
    if add_to_git_credential:
        if _is_git_credential_helper_configured():
            set_git_credential(token)
            logger.info(
                "Your token has been saved in your configured git credential helpers"
                + f" ({','.join(list_credential_helpers())})."
            )
        else:
            logger.warning("Token has not been saved to git credential helper.")
    # Write token to HF_TOKEN_PATH
    path = Path(constants.HF_TOKEN_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token)
    logger.info(f"Your token has been saved to {constants.HF_TOKEN_PATH}")


def _is_git_credential_helper_configured() -> bool:
    """Check if a git credential helper is configured.

    Warns user if not the case (except for Google Colab where "store" is set by default
    by `huggingface_hub`).
    """
    helpers = list_credential_helpers()
    if len(helpers) > 0:
        return True  # Do not warn: at least 1 helper is set

    # Only in Google Colab to avoid the warning message
    # See https://github.com/huggingface/huggingface_hub/issues/1043#issuecomment-1247010710
    if is_google_colab():
        _set_store_as_git_credential_helper_globally()
        return True  # Do not warn: "store" is used by default in Google Colab

    # Otherwise, warn user
    print(
        ANSI.red(
            "Cannot authenticate through git-credential as no helper is defined on your"
            " machine.\nYou might have to re-authenticate when pushing to the Hugging"
            " Face Hub.\nRun the following command in your terminal in case you want to"
            " set the 'store' credential helper as default.\n\ngit config --global"
            " credential.helper store\n\nRead"
            " https://git-scm.com/book/en/v2/Git-Tools-Credential-Storage for more"
            " details."
        )
    )
    return False


def _set_store_as_git_credential_helper_globally() -> None:
    """Set globally the credential.helper to `store`.

    To be used only in Google Colab as we assume the user doesn't care about the git
    credential config. It is the only particular case where we don't want to display the
    warning message in [`notebook_login()`].

    Related:
    - https://github.com/huggingface/huggingface_hub/issues/1043
    - https://github.com/huggingface/huggingface_hub/issues/1051
    - https://git-scm.com/docs/git-credential-store
    """
    try:
        run_subprocess("git config --global credential.helper store")
    except subprocess.CalledProcessError as exc:
        raise EnvironmentError(exc.stderr)
