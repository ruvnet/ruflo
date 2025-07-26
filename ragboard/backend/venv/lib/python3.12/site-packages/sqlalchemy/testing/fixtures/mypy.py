# testing/fixtures/mypy.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors

from __future__ import annotations

import inspect
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

from .base import TestBase
from .. import config
from ..assertions import eq_
from ... import util


@config.add_to_marker.mypy
class MypyTest(TestBase):
    __requires__ = ("no_sqlalchemy2_stubs",)

    @config.fixture(scope="function")
    def per_func_cachedir(self):
        yield from self._cachedir()

    @config.fixture(scope="class")
    def cachedir(self):
        yield from self._cachedir()

    def _cachedir(self):
        # as of mypy 0.971 i think we need to keep mypy_path empty
        mypy_path = ""

        with tempfile.TemporaryDirectory() as cachedir:
            with open(
                Path(cachedir) / "sqla_mypy_config.cfg", "w"
            ) as config_file:
                config_file.write(
                    f"""
                    [mypy]\n
                    plugins = sqlalchemy.ext.mypy.plugin\n
                    show_error_codes = True\n
                    {mypy_path}
                    disable_error_code = no-untyped-call

                    [mypy-sqlalchemy.*]
                    ignore_errors = True

                    """
                )
            with open(
                Path(cachedir) / "plain_mypy_config.cfg", "w"
            ) as config_file:
                config_file.write(
                    f"""
                    [mypy]\n
                    show_error_codes = True\n
                    {mypy_path}
                    disable_error_code = var-annotated,no-untyped-call
                    [mypy-sqlalchemy.*]
                    ignore_errors = True

                    """
                )
            yield cachedir

    @config.fixture()
    def mypy_runner(self, cachedir):
        from mypy import api

        def run(path, use_plugin=False, use_cachedir=None):
            if use_cachedir is None:
                use_cachedir = cachedir
            args = [
                "--strict",
                "--raise-exceptions",
                "--cache-dir",
                use_cachedir,
                "--config-file",
                os.path.join(
                    use_cachedir,
                    "sqla_mypy_config.cfg"
                    if use_plugin
                    else "plain_mypy_config.cfg",
                ),
            ]

            # mypy as of 0.990 is more aggressively blocking messaging
            # for paths that are in sys.path, and as pytest puts currdir,
            # test/ etc in sys.path, just copy the source file to the
            # tempdir we are working in so that we don't have to try to
            # manipulate sys.path and/or guess what mypy is doing
            filename = os.path.basename(path)
            test_program = os.path.join(use_cachedir, filename)
            if path != test_program:
                shutil.copyfile(path, test_program)
            args.append(test_program)

            # I set this locally but for the suite here needs to be
            # disabled
            os.environ.pop("MYPY_FORCE_COLOR", None)

            stdout, stderr, exitcode = api.run(args)
            return stdout, stderr, exitcode

        return run

    @config.fixture
    def mypy_typecheck_file(self, mypy_runner):
        def run(path, use_plugin=False):
            expected_messages = self._collect_messages(path)
            stdout, stderr, exitcode = mypy_runner(path, use_plugin=use_plugin)
            self._check_output(
                path, expected_messages, stdout, stderr, exitcode
            )

        return run

    @staticmethod
    def file_combinations(dirname):
        if os.path.isabs(dirname):
            path = dirname
        else:
            caller_path = inspect.stack()[1].filename
            path = os.path.join(os.path.dirname(caller_path), dirname)
        files = list(Path(path).glob("**/*.py"))

        for extra_dir in config.options.mypy_extra_test_paths:
            if extra_dir and os.path.isdir(extra_dir):
                files.extend((Path(extra_dir) / dirname).glob("**/*.py"))
        return files

    def _collect_messages(self, path):
        from sqlalchemy.ext.mypy.util import mypy_14

        expected_messages = []
        expected_re = re.compile(r"\s*# EXPECTED(_MYPY)?(_RE)?(_TYPE)?: (.+)")
        py_ver_re = re.compile(r"^#\s*PYTHON_VERSION\s?>=\s?(\d+\.\d+)")
        with open(path) as file_:
            current_assert_messages = []
            for num, line in enumerate(file_, 1):
                m = py_ver_re.match(line)
                if m:
                    major, _, minor = m.group(1).partition(".")
                    if sys.version_info < (int(major), int(minor)):
                        config.skip_test(
                            "Requires python >= %s" % (m.group(1))
                        )
                    continue

                m = expected_re.match(line)
                if m:
                    is_mypy = bool(m.group(1))
                    is_re = bool(m.group(2))
                    is_type = bool(m.group(3))

                    expected_msg = re.sub(r"# noqa[:]? ?.*", "", m.group(4))
                    if is_type:
                        if not is_re:
                            # the goal here is that we can cut-and-paste
                            # from vscode -> pylance into the
                            # EXPECTED_TYPE: line, then the test suite will
                            # validate that line against what mypy produces
                            expected_msg = re.sub(
                                r"([\[\]])",
                                lambda m: rf"\{m.group(0)}",
                                expected_msg,
                            )

                            # note making sure preceding text matches
                            # with a dot, so that an expect for "Select"
                            # does not match "TypedSelect"
                            expected_msg = re.sub(
                                r"([\w_]+)",
                                lambda m: rf"(?:.*\.)?{m.group(1)}\*?",
                                expected_msg,
                            )

                            expected_msg = re.sub(
                                "List", "builtins.list", expected_msg
                            )

                            expected_msg = re.sub(
                                r"\b(int|str|float|bool)\b",
                                lambda m: rf"builtins.{m.group(0)}\*?",
                                expected_msg,
                            )
                            # expected_msg = re.sub(
                            #     r"(Sequence|Tuple|List|Union)",
                            #     lambda m: fr"typing.{m.group(0)}\*?",
                            #     expected_msg,
                            # )

                        is_mypy = is_re = True
                        expected_msg = f'Revealed type is "{expected_msg}"'

                    if mypy_14 and util.py39:
                        # use_lowercase_names, py39 and above
                        # https://github.com/python/mypy/blob/304997bfb85200fb521ac727ee0ce3e6085e5278/mypy/options.py#L363  # noqa: E501

                        # skip first character which could be capitalized
                        # "List item x not found" type of message
                        expected_msg = expected_msg[0] + re.sub(
                            r"\b(List|Tuple|Dict|Set)\b"
                            if is_type
                            else r"\b(List|Tuple|Dict|Set|Type)\b",
                            lambda m: m.group(1).lower(),
                            expected_msg[1:],
                        )

                    if mypy_14 and util.py310:
                        # use_or_syntax, py310 and above
                        # https://github.com/python/mypy/blob/304997bfb85200fb521ac727ee0ce3e6085e5278/mypy/options.py#L368  # noqa: E501
                        expected_msg = re.sub(
                            r"Optional\[(.*?)\]",
                            lambda m: f"{m.group(1)} | None",
                            expected_msg,
                        )
                    current_assert_messages.append(
                        (is_mypy, is_re, expected_msg.strip())
                    )
                elif current_assert_messages:
                    expected_messages.extend(
                        (num, is_mypy, is_re, expected_msg)
                        for (
                            is_mypy,
                            is_re,
                            expected_msg,
                        ) in current_assert_messages
                    )
                    current_assert_messages[:] = []

        return expected_messages

    def _check_output(self, path, expected_messages, stdout, stderr, exitcode):
        not_located = []
        filename = os.path.basename(path)
        if expected_messages:
            # mypy 0.990 changed how return codes work, so don't assume a
            # 1 or a 0 return code here, could be either depending on if
            # errors were generated or not

            output = []

            raw_lines = stdout.split("\n")
            while raw_lines:
                e = raw_lines.pop(0)
                if re.match(r".+\.py:\d+: error: .*", e):
                    output.append(("error", e))
                elif re.match(
                    r".+\.py:\d+: note: +(?:Possible overload|def ).*", e
                ):
                    while raw_lines:
                        ol = raw_lines.pop(0)
                        if not re.match(r".+\.py:\d+: note: +def \[.*", ol):
                            break
                elif re.match(
                    r".+\.py:\d+: note: .*(?:perhaps|suggestion)", e, re.I
                ):
                    pass
                elif re.match(r".+\.py:\d+: note: .*", e):
                    output.append(("note", e))

            for num, is_mypy, is_re, msg in expected_messages:
                msg = msg.replace("'", '"')
                prefix = "[SQLAlchemy Mypy plugin] " if not is_mypy else ""
                for idx, (typ, errmsg) in enumerate(output):
                    if is_re:
                        if re.match(
                            rf".*{filename}\:{num}\: {typ}\: {prefix}{msg}",
                            errmsg,
                        ):
                            break
                    elif (
                        f"{filename}:{num}: {typ}: {prefix}{msg}"
                        in errmsg.replace("'", '"')
                    ):
                        break
                else:
                    not_located.append(msg)
                    continue
                del output[idx]

            if not_located:
                missing = "\n".join(not_located)
                print("Couldn't locate expected messages:", missing, sep="\n")
                if output:
                    extra = "\n".join(msg for _, msg in output)
                    print("Remaining messages:", extra, sep="\n")
                assert False, "expected messages not found, see stdout"

            if output:
                print(f"{len(output)} messages from mypy were not consumed:")
                print("\n".join(msg for _, msg in output))
                assert False, "errors and/or notes remain, see stdout"

        else:
            if exitcode != 0:
                print(stdout, stderr, sep="\n")

            eq_(exitcode, 0, msg=stdout)
