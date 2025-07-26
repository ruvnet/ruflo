from __future__ import annotations

import sys
from typing import TYPE_CHECKING, List, Optional, cast
from argparse import ArgumentParser
from typing_extensions import Literal, NamedTuple

from ..._utils import get_client
from ..._models import BaseModel
from ...._streaming import Stream
from ....types.chat import (
    ChatCompletionRole,
    ChatCompletionChunk,
    CompletionCreateParams,
)
from ....types.chat.completion_create_params import (
    CompletionCreateParamsStreaming,
    CompletionCreateParamsNonStreaming,
)

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register(subparser: _SubParsersAction[ArgumentParser]) -> None:
    sub = subparser.add_parser("chat.completions.create")

    sub._action_groups.pop()
    req = sub.add_argument_group("required arguments")
    opt = sub.add_argument_group("optional arguments")

    req.add_argument(
        "-g",
        "--message",
        action="append",
        nargs=2,
        metavar=("ROLE", "CONTENT"),
        help="A message in `{role} {content}` format. Use this argument multiple times to add multiple messages.",
        required=True,
    )
    req.add_argument(
        "-m",
        "--model",
        help="The model to use.",
        required=True,
    )

    opt.add_argument(
        "-n",
        "--n",
        help="How many completions to generate for the conversation.",
        type=int,
    )
    opt.add_argument("-M", "--max-tokens", help="The maximum number of tokens to generate.", type=int)
    opt.add_argument(
        "-t",
        "--temperature",
        help="""What sampling temperature to use. Higher values means the model will take more risks. Try 0.9 for more creative applications, and 0 (argmax sampling) for ones with a well-defined answer.

Mutually exclusive with `top_p`.""",
        type=float,
    )
    opt.add_argument(
        "-P",
        "--top_p",
        help="""An alternative to sampling with temperature, called nucleus sampling, where the considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10%% probability mass are considered.

            Mutually exclusive with `temperature`.""",
        type=float,
    )
    opt.add_argument(
        "--stop",
        help="A stop sequence at which to stop generating tokens for the message.",
    )
    opt.add_argument("--stream", help="Stream messages as they're ready.", action="store_true")
    sub.set_defaults(func=CLIChatCompletion.create, args_model=CLIChatCompletionCreateArgs)


class CLIMessage(NamedTuple):
    role: ChatCompletionRole
    content: str


class CLIChatCompletionCreateArgs(BaseModel):
    message: List[CLIMessage]
    model: str
    n: Optional[int] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    stop: Optional[str] = None
    stream: bool = False


class CLIChatCompletion:
    @staticmethod
    def create(args: CLIChatCompletionCreateArgs) -> None:
        params: CompletionCreateParams = {
            "model": args.model,
            "messages": [
                {"role": cast(Literal["user"], message.role), "content": message.content} for message in args.message
            ],
            "n": args.n,
            "temperature": args.temperature,
            "top_p": args.top_p,
            "stop": args.stop,
            # type checkers are not good at inferring union types so we have to set stream afterwards
            "stream": False,
        }
        if args.stream:
            params["stream"] = args.stream  # type: ignore
        if args.max_tokens is not None:
            params["max_tokens"] = args.max_tokens

        if args.stream:
            return CLIChatCompletion._stream_create(cast(CompletionCreateParamsStreaming, params))

        return CLIChatCompletion._create(cast(CompletionCreateParamsNonStreaming, params))

    @staticmethod
    def _create(params: CompletionCreateParamsNonStreaming) -> None:
        completion = get_client().chat.completions.create(**params)
        should_print_header = len(completion.choices) > 1
        for choice in completion.choices:
            if should_print_header:
                sys.stdout.write("===== Chat Completion {} =====\n".format(choice.index))

            content = choice.message.content if choice.message.content is not None else "None"
            sys.stdout.write(content)

            if should_print_header or not content.endswith("\n"):
                sys.stdout.write("\n")

            sys.stdout.flush()

    @staticmethod
    def _stream_create(params: CompletionCreateParamsStreaming) -> None:
        # cast is required for mypy
        stream = cast(  # pyright: ignore[reportUnnecessaryCast]
            Stream[ChatCompletionChunk], get_client().chat.completions.create(**params)
        )
        for chunk in stream:
            should_print_header = len(chunk.choices) > 1
            for choice in chunk.choices:
                if should_print_header:
                    sys.stdout.write("===== Chat Completion {} =====\n".format(choice.index))

                content = choice.delta.content or ""
                sys.stdout.write(content)

                if should_print_header:
                    sys.stdout.write("\n")

                sys.stdout.flush()

        sys.stdout.write("\n")
