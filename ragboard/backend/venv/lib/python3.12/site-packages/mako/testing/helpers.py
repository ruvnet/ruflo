import contextlib
import pathlib
from pathlib import Path
import re
import time
from typing import Union
from unittest import mock


def flatten_result(result):
    return re.sub(r"[\s\r\n]+", " ", result).strip()


def result_lines(result):
    return [
        x.strip()
        for x in re.split(r"\r?\n", re.sub(r" +", " ", result))
        if x.strip() != ""
    ]


def result_raw_lines(result):
    return [x for x in re.split(r"\r?\n", result) if x.strip() != ""]


def make_path(
    filespec: Union[Path, str],
    make_absolute: bool = True,
    check_exists: bool = False,
) -> Path:
    path = Path(filespec)
    if make_absolute:
        path = path.resolve(strict=check_exists)
    if check_exists and (not path.exists()):
        raise FileNotFoundError(f"No file or directory at {filespec}")
    return path


def _unlink_path(path, missing_ok=False):
    # Replicate 3.8+ functionality in 3.7
    cm = contextlib.nullcontext()
    if missing_ok:
        cm = contextlib.suppress(FileNotFoundError)

    with cm:
        path.unlink()


def replace_file_with_dir(pathspec):
    path = pathlib.Path(pathspec)
    _unlink_path(path, missing_ok=True)
    path.mkdir(exist_ok=True)
    return path


def file_with_template_code(filespec):
    with open(filespec, "w") as f:
        f.write(
            """
i am an artificial template just for you
"""
        )
    return filespec


@contextlib.contextmanager
def rewind_compile_time(hours=1):
    rewound = time.time() - (hours * 3_600)
    with mock.patch("mako.codegen.time") as codegen_time:
        codegen_time.time.return_value = rewound
        yield
