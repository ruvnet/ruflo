from __future__ import annotations

import sys

import openai

from .. import OpenAI, _load_client
from .._compat import model_json
from .._models import BaseModel


class Colors:
    HEADER = "\033[95m"
    OKBLUE = "\033[94m"
    OKGREEN = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    ENDC = "\033[0m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"


def get_client() -> OpenAI:
    return _load_client()


def organization_info() -> str:
    organization = openai.organization
    if organization is not None:
        return "[organization={}] ".format(organization)

    return ""


def print_model(model: BaseModel) -> None:
    sys.stdout.write(model_json(model, indent=2) + "\n")


def can_use_http2() -> bool:
    try:
        import h2  # type: ignore  # noqa
    except ImportError:
        return False

    return True
