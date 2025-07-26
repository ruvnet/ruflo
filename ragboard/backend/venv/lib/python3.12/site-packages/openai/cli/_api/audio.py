from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional, cast
from argparse import ArgumentParser

from .._utils import get_client, print_model
from ..._types import NOT_GIVEN
from .._models import BaseModel
from .._progress import BufferReader

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register(subparser: _SubParsersAction[ArgumentParser]) -> None:
    # transcriptions
    sub = subparser.add_parser("audio.transcriptions.create")

    # Required
    sub.add_argument("-m", "--model", type=str, default="whisper-1")
    sub.add_argument("-f", "--file", type=str, required=True)
    # Optional
    sub.add_argument("--response-format", type=str)
    sub.add_argument("--language", type=str)
    sub.add_argument("-t", "--temperature", type=float)
    sub.add_argument("--prompt", type=str)
    sub.set_defaults(func=CLIAudio.transcribe, args_model=CLITranscribeArgs)

    # translations
    sub = subparser.add_parser("audio.translations.create")

    # Required
    sub.add_argument("-f", "--file", type=str, required=True)
    # Optional
    sub.add_argument("-m", "--model", type=str, default="whisper-1")
    sub.add_argument("--response-format", type=str)
    # TODO: doesn't seem to be supported by the API
    # sub.add_argument("--language", type=str)
    sub.add_argument("-t", "--temperature", type=float)
    sub.add_argument("--prompt", type=str)
    sub.set_defaults(func=CLIAudio.translate, args_model=CLITranslationArgs)


class CLITranscribeArgs(BaseModel):
    model: str
    file: str
    response_format: Optional[str] = None
    language: Optional[str] = None
    temperature: Optional[float] = None
    prompt: Optional[str] = None


class CLITranslationArgs(BaseModel):
    model: str
    file: str
    response_format: Optional[str] = None
    language: Optional[str] = None
    temperature: Optional[float] = None
    prompt: Optional[str] = None


class CLIAudio:
    @staticmethod
    def transcribe(args: CLITranscribeArgs) -> None:
        with open(args.file, "rb") as file_reader:
            buffer_reader = BufferReader(file_reader.read(), desc="Upload progress")

        model = get_client().audio.transcriptions.create(
            file=(args.file, buffer_reader),
            model=args.model,
            language=args.language or NOT_GIVEN,
            temperature=args.temperature or NOT_GIVEN,
            prompt=args.prompt or NOT_GIVEN,
            # casts required because the API is typed for enums
            # but we don't want to validate that here for forwards-compat
            response_format=cast(Any, args.response_format),
        )
        print_model(model)

    @staticmethod
    def translate(args: CLITranslationArgs) -> None:
        with open(args.file, "rb") as file_reader:
            buffer_reader = BufferReader(file_reader.read(), desc="Upload progress")

        model = get_client().audio.translations.create(
            file=(args.file, buffer_reader),
            model=args.model,
            temperature=args.temperature or NOT_GIVEN,
            prompt=args.prompt or NOT_GIVEN,
            # casts required because the API is typed for enums
            # but we don't want to validate that here for forwards-compat
            response_format=cast(Any, args.response_format),
        )
        print_model(model)
