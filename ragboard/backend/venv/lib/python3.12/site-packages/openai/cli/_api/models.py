from __future__ import annotations

from typing import TYPE_CHECKING
from argparse import ArgumentParser

from .._utils import get_client, print_model
from .._models import BaseModel

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register(subparser: _SubParsersAction[ArgumentParser]) -> None:
    sub = subparser.add_parser("models.list")
    sub.set_defaults(func=CLIModels.list)

    sub = subparser.add_parser("models.retrieve")
    sub.add_argument("-i", "--id", required=True, help="The model ID")
    sub.set_defaults(func=CLIModels.get, args_model=CLIModelIDArgs)

    sub = subparser.add_parser("models.delete")
    sub.add_argument("-i", "--id", required=True, help="The model ID")
    sub.set_defaults(func=CLIModels.delete, args_model=CLIModelIDArgs)


class CLIModelIDArgs(BaseModel):
    id: str


class CLIModels:
    @staticmethod
    def get(args: CLIModelIDArgs) -> None:
        model = get_client().models.retrieve(model=args.id)
        print_model(model)

    @staticmethod
    def delete(args: CLIModelIDArgs) -> None:
        model = get_client().models.delete(model=args.id)
        print_model(model)

    @staticmethod
    def list() -> None:
        models = get_client().models.list()
        for model in models:
            print_model(model)
