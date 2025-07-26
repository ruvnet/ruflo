from __future__ import annotations

import sys

import pydantic

from ._utils import Colors, organization_info
from .._exceptions import APIError, OpenAIError


class CLIError(OpenAIError):
    ...


class SilentCLIError(CLIError):
    ...


def display_error(err: CLIError | APIError | pydantic.ValidationError) -> None:
    if isinstance(err, SilentCLIError):
        return

    sys.stderr.write("{}{}Error:{} {}\n".format(organization_info(), Colors.FAIL, Colors.ENDC, err))
