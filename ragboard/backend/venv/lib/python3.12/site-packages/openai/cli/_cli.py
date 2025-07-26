from __future__ import annotations

import sys
import logging
import argparse
from typing import Any, List, Type, Optional
from typing_extensions import ClassVar

import httpx
import pydantic

import openai

from . import _tools
from .. import _ApiType, __version__
from ._api import register_commands
from ._utils import can_use_http2
from .._types import ProxiesDict
from ._errors import CLIError, display_error
from .._compat import PYDANTIC_V2, ConfigDict, model_parse
from .._models import BaseModel
from .._exceptions import APIError

logger = logging.getLogger()
formatter = logging.Formatter("[%(asctime)s] %(message)s")
handler = logging.StreamHandler(sys.stderr)
handler.setFormatter(formatter)
logger.addHandler(handler)


class Arguments(BaseModel):
    if PYDANTIC_V2:
        model_config: ClassVar[ConfigDict] = ConfigDict(
            extra="ignore",
        )
    else:

        class Config(pydantic.BaseConfig):  # type: ignore
            extra: Any = pydantic.Extra.ignore  # type: ignore

    verbosity: int
    version: Optional[str] = None

    api_key: Optional[str]
    api_base: Optional[str]
    organization: Optional[str]
    proxy: Optional[List[str]]
    api_type: Optional[_ApiType] = None
    api_version: Optional[str] = None

    # azure
    azure_endpoint: Optional[str] = None
    azure_ad_token: Optional[str] = None

    # internal, set by subparsers to parse their specific args
    args_model: Optional[Type[BaseModel]] = None

    # internal, used so that subparsers can forward unknown arguments
    unknown_args: List[str] = []
    allow_unknown_args: bool = False


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=None, prog="openai")
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        dest="verbosity",
        default=0,
        help="Set verbosity.",
    )
    parser.add_argument("-b", "--api-base", help="What API base url to use.")
    parser.add_argument("-k", "--api-key", help="What API key to use.")
    parser.add_argument("-p", "--proxy", nargs="+", help="What proxy to use.")
    parser.add_argument(
        "-o",
        "--organization",
        help="Which organization to run as (will use your default organization if not specified)",
    )
    parser.add_argument(
        "-t",
        "--api-type",
        type=str,
        choices=("openai", "azure"),
        help="The backend API to call, must be `openai` or `azure`",
    )
    parser.add_argument(
        "--api-version",
        help="The Azure API version, e.g. 'https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#rest-api-versioning'",
    )

    # azure
    parser.add_argument(
        "--azure-endpoint",
        help="The Azure endpoint, e.g. 'https://endpoint.openai.azure.com'",
    )
    parser.add_argument(
        "--azure-ad-token",
        help="A token from Azure Active Directory, https://www.microsoft.com/en-us/security/business/identity-access/microsoft-entra-id",
    )

    # prints the package version
    parser.add_argument(
        "-V",
        "--version",
        action="version",
        version="%(prog)s " + __version__,
    )

    def help() -> None:
        parser.print_help()

    parser.set_defaults(func=help)

    subparsers = parser.add_subparsers()
    sub_api = subparsers.add_parser("api", help="Direct API calls")

    register_commands(sub_api)

    sub_tools = subparsers.add_parser("tools", help="Client side tools for convenience")
    _tools.register_commands(sub_tools, subparsers)

    return parser


def main() -> int:
    try:
        _main()
    except (APIError, CLIError, pydantic.ValidationError) as err:
        display_error(err)
        return 1
    except KeyboardInterrupt:
        sys.stderr.write("\n")
        return 1
    return 0


def _parse_args(parser: argparse.ArgumentParser) -> tuple[argparse.Namespace, Arguments, list[str]]:
    # argparse by default will strip out the `--` but we want to keep it for unknown arguments
    if "--" in sys.argv:
        idx = sys.argv.index("--")
        known_args = sys.argv[1:idx]
        unknown_args = sys.argv[idx:]
    else:
        known_args = sys.argv[1:]
        unknown_args = []

    parsed, remaining_unknown = parser.parse_known_args(known_args)

    # append any remaining unknown arguments from the initial parsing
    remaining_unknown.extend(unknown_args)

    args = model_parse(Arguments, vars(parsed))
    if not args.allow_unknown_args:
        # we have to parse twice to ensure any unknown arguments
        # result in an error if that behaviour is desired
        parser.parse_args()

    return parsed, args, remaining_unknown


def _main() -> None:
    parser = _build_parser()
    parsed, args, unknown = _parse_args(parser)

    if args.verbosity != 0:
        sys.stderr.write("Warning: --verbosity isn't supported yet\n")

    proxies: ProxiesDict = {}
    if args.proxy is not None:
        for proxy in args.proxy:
            key = "https://" if proxy.startswith("https") else "http://"
            if key in proxies:
                raise CLIError(f"Multiple {key} proxies given - only the last one would be used")

            proxies[key] = proxy

    http_client = httpx.Client(
        proxies=proxies or None,
        http2=can_use_http2(),
    )
    openai.http_client = http_client

    if args.organization:
        openai.organization = args.organization

    if args.api_key:
        openai.api_key = args.api_key

    if args.api_base:
        openai.base_url = args.api_base

    # azure
    if args.api_type is not None:
        openai.api_type = args.api_type

    if args.azure_endpoint is not None:
        openai.azure_endpoint = args.azure_endpoint

    if args.api_version is not None:
        openai.api_version = args.api_version

    if args.azure_ad_token is not None:
        openai.azure_ad_token = args.azure_ad_token

    try:
        if args.args_model:
            parsed.func(
                model_parse(
                    args.args_model,
                    {
                        **{
                            # we omit None values so that they can be defaulted to `NotGiven`
                            # and we'll strip it from the API request
                            key: value
                            for key, value in vars(parsed).items()
                            if value is not None
                        },
                        "unknown_args": unknown,
                    },
                )
            )
        else:
            parsed.func()
    finally:
        try:
            http_client.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
