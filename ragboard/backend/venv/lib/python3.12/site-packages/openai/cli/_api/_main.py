from __future__ import annotations

from argparse import ArgumentParser

from . import chat, audio, files, image, models, completions


def register_commands(parser: ArgumentParser) -> None:
    subparsers = parser.add_subparsers(help="All API subcommands")

    chat.register(subparsers)
    image.register(subparsers)
    audio.register(subparsers)
    files.register(subparsers)
    models.register(subparsers)
    completions.register(subparsers)
