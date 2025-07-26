from __future__ import annotations

from typing import TYPE_CHECKING
from argparse import ArgumentParser

from . import migrate, fine_tunes

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register_commands(parser: ArgumentParser, subparser: _SubParsersAction[ArgumentParser]) -> None:
    migrate.register(subparser)

    namespaced = parser.add_subparsers(title="Tools", help="Convenience client side tools")

    fine_tunes.register(namespaced)
