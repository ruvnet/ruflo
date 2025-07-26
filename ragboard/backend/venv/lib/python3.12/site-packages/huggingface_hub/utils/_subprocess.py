# coding=utf-8
# Copyright 2021 The HuggingFace Inc. team. All rights reserved.
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
# limitations under the License
"""Contains utilities to easily handle subprocesses in `huggingface_hub`."""

import os
import subprocess
import sys
from contextlib import contextmanager
from io import StringIO
from pathlib import Path
from typing import IO, Generator, List, Optional, Tuple, Union

from .logging import get_logger


logger = get_logger(__name__)


@contextmanager
def capture_output() -> Generator[StringIO, None, None]:
    """Capture output that is printed to terminal.

    Taken from https://stackoverflow.com/a/34738440

    Example:
    ```py
    >>> with capture_output() as output:
    ...     print("hello world")
    >>> assert output.getvalue() == "hello world\n"
    ```
    """
    output = StringIO()
    previous_output = sys.stdout
    sys.stdout = output
    try:
        yield output
    finally:
        sys.stdout = previous_output


def run_subprocess(
    command: Union[str, List[str]],
    folder: Optional[Union[str, Path]] = None,
    check=True,
    **kwargs,
) -> subprocess.CompletedProcess:
    """
    Method to run subprocesses. Calling this will capture the `stderr` and `stdout`,
    please call `subprocess.run` manually in case you would like for them not to
    be captured.

    Args:
        command (`str` or `List[str]`):
            The command to execute as a string or list of strings.
        folder (`str`, *optional*):
            The folder in which to run the command. Defaults to current working
            directory (from `os.getcwd()`).
        check (`bool`, *optional*, defaults to `True`):
            Setting `check` to `True` will raise a `subprocess.CalledProcessError`
            when the subprocess has a non-zero exit code.
        kwargs (`Dict[str]`):
            Keyword arguments to be passed to the `subprocess.run` underlying command.

    Returns:
        `subprocess.CompletedProcess`: The completed process.
    """
    if isinstance(command, str):
        command = command.split()

    if isinstance(folder, Path):
        folder = str(folder)

    return subprocess.run(
        command,
        stderr=subprocess.PIPE,
        stdout=subprocess.PIPE,
        check=check,
        encoding="utf-8",
        errors="replace",  # if not utf-8, replace char by �
        cwd=folder or os.getcwd(),
        **kwargs,
    )


@contextmanager
def run_interactive_subprocess(
    command: Union[str, List[str]],
    folder: Optional[Union[str, Path]] = None,
    **kwargs,
) -> Generator[Tuple[IO[str], IO[str]], None, None]:
    """Run a subprocess in an interactive mode in a context manager.

    Args:
        command (`str` or `List[str]`):
            The command to execute as a string or list of strings.
        folder (`str`, *optional*):
            The folder in which to run the command. Defaults to current working
            directory (from `os.getcwd()`).
        kwargs (`Dict[str]`):
            Keyword arguments to be passed to the `subprocess.run` underlying command.

    Returns:
        `Tuple[IO[str], IO[str]]`: A tuple with `stdin` and `stdout` to interact
        with the process (input and output are utf-8 encoded).

    Example:
    ```python
    with _interactive_subprocess("git credential-store get") as (stdin, stdout):
        # Write to stdin
        stdin.write("url=hf.co\nusername=obama\n".encode("utf-8"))
        stdin.flush()

        # Read from stdout
        output = stdout.read().decode("utf-8")
    ```
    """
    if isinstance(command, str):
        command = command.split()

    with subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        errors="replace",  # if not utf-8, replace char by �
        cwd=folder or os.getcwd(),
        **kwargs,
    ) as process:
        assert process.stdin is not None, "subprocess is opened as subprocess.PIPE"
        assert process.stdout is not None, "subprocess is opened as subprocess.PIPE"
        yield process.stdin, process.stdout
