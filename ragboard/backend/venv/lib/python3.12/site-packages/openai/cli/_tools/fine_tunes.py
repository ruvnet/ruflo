from __future__ import annotations

import sys
from typing import TYPE_CHECKING
from argparse import ArgumentParser

from .._models import BaseModel
from ...lib._validators import (
    get_validators,
    write_out_file,
    read_any_format,
    apply_validators,
    apply_necessary_remediation,
)

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register(subparser: _SubParsersAction[ArgumentParser]) -> None:
    sub = subparser.add_parser("fine_tunes.prepare_data")
    sub.add_argument(
        "-f",
        "--file",
        required=True,
        help="JSONL, JSON, CSV, TSV, TXT or XLSX file containing prompt-completion examples to be analyzed."
        "This should be the local file path.",
    )
    sub.add_argument(
        "-q",
        "--quiet",
        required=False,
        action="store_true",
        help="Auto accepts all suggestions, without asking for user input. To be used within scripts.",
    )
    sub.set_defaults(func=prepare_data, args_model=PrepareDataArgs)


class PrepareDataArgs(BaseModel):
    file: str

    quiet: bool


def prepare_data(args: PrepareDataArgs) -> None:
    sys.stdout.write("Analyzing...\n")
    fname = args.file
    auto_accept = args.quiet
    df, remediation = read_any_format(fname)
    apply_necessary_remediation(None, remediation)

    validators = get_validators()

    assert df is not None

    apply_validators(
        df,
        fname,
        remediation,
        validators,
        auto_accept,
        write_out_file_func=write_out_file,
    )
