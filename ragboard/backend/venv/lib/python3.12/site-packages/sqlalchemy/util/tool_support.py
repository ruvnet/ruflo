# util/tool_support.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls
"""support routines for the helpers in tools/.

These aren't imported by the enclosing util package as the are not
needed for normal library use.

"""
from __future__ import annotations

from argparse import ArgumentParser
from argparse import Namespace
import contextlib
import difflib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
from typing import Any
from typing import Dict
from typing import Iterator
from typing import Optional
from typing import Union

from . import compat


class code_writer_cmd:
    parser: ArgumentParser
    args: Namespace
    suppress_output: bool
    diffs_detected: bool
    source_root: Path
    pyproject_toml_path: Path

    def __init__(self, tool_script: str):
        self.source_root = Path(tool_script).parent.parent
        self.pyproject_toml_path = self.source_root / Path("pyproject.toml")
        assert self.pyproject_toml_path.exists()

        self.parser = ArgumentParser()
        self.parser.add_argument(
            "--stdout",
            action="store_true",
            help="Write to stdout instead of saving to file",
        )
        self.parser.add_argument(
            "-c",
            "--check",
            help="Don't write the files back, just return the "
            "status. Return code 0 means nothing would change. "
            "Return code 1 means some files would be reformatted",
            action="store_true",
        )

    def run_zimports(self, tempfile: str) -> None:
        self._run_console_script(
            str(tempfile),
            {
                "entrypoint": "zimports",
                "options": f"--toml-config {self.pyproject_toml_path}",
            },
        )

    def run_black(self, tempfile: str) -> None:
        self._run_console_script(
            str(tempfile),
            {
                "entrypoint": "black",
                "options": f"--config {self.pyproject_toml_path}",
            },
        )

    def _run_console_script(self, path: str, options: Dict[str, Any]) -> None:
        """Run a Python console application from within the process.

        Used for black, zimports

        """

        is_posix = os.name == "posix"

        entrypoint_name = options["entrypoint"]

        for entry in compat.importlib_metadata_get("console_scripts"):
            if entry.name == entrypoint_name:
                impl = entry
                break
        else:
            raise Exception(
                f"Could not find entrypoint console_scripts.{entrypoint_name}"
            )
        cmdline_options_str = options.get("options", "")
        cmdline_options_list = shlex.split(
            cmdline_options_str, posix=is_posix
        ) + [path]

        kw: Dict[str, Any] = {}
        if self.suppress_output:
            kw["stdout"] = kw["stderr"] = subprocess.DEVNULL

        subprocess.run(
            [
                sys.executable,
                "-c",
                "import %s; %s.%s()" % (impl.module, impl.module, impl.attr),
            ]
            + cmdline_options_list,
            cwd=str(self.source_root),
            **kw,
        )

    def write_status(self, *text: str) -> None:
        if not self.suppress_output:
            sys.stderr.write(" ".join(text))

    def write_output_file_from_text(
        self, text: str, destination_path: Union[str, Path]
    ) -> None:
        if self.args.check:
            self._run_diff(destination_path, source=text)
        elif self.args.stdout:
            print(text)
        else:
            self.write_status(f"Writing {destination_path}...")
            Path(destination_path).write_text(
                text, encoding="utf-8", newline="\n"
            )
            self.write_status("done\n")

    def write_output_file_from_tempfile(
        self, tempfile: str, destination_path: str
    ) -> None:
        if self.args.check:
            self._run_diff(destination_path, source_file=tempfile)
            os.unlink(tempfile)
        elif self.args.stdout:
            with open(tempfile) as tf:
                print(tf.read())
            os.unlink(tempfile)
        else:
            self.write_status(f"Writing {destination_path}...")
            shutil.move(tempfile, destination_path)
            self.write_status("done\n")

    def _run_diff(
        self,
        destination_path: Union[str, Path],
        *,
        source: Optional[str] = None,
        source_file: Optional[str] = None,
    ) -> None:
        if source_file:
            with open(source_file, encoding="utf-8") as tf:
                source_lines = list(tf)
        elif source is not None:
            source_lines = source.splitlines(keepends=True)
        else:
            assert False, "source or source_file is required"

        with open(destination_path, encoding="utf-8") as dp:
            d = difflib.unified_diff(
                list(dp),
                source_lines,
                fromfile=Path(destination_path).as_posix(),
                tofile="<proposed changes>",
                n=3,
                lineterm="\n",
            )
            d_as_list = list(d)
            if d_as_list:
                self.diffs_detected = True
                print("".join(d_as_list))

    @contextlib.contextmanager
    def add_arguments(self) -> Iterator[ArgumentParser]:
        yield self.parser

    @contextlib.contextmanager
    def run_program(self) -> Iterator[None]:
        self.args = self.parser.parse_args()
        if self.args.check:
            self.diffs_detected = False
            self.suppress_output = True
        elif self.args.stdout:
            self.suppress_output = True
        else:
            self.suppress_output = False
        yield

        if self.args.check and self.diffs_detected:
            sys.exit(1)
        else:
            sys.exit(0)
