from __future__ import annotations

import sys
from typing import TYPE_CHECKING, Optional, cast
from argparse import ArgumentParser
from functools import partial

from openai.types.completion import Completion

from .._utils import get_client
from ..._types import NOT_GIVEN, NotGivenOr
from ..._utils import is_given
from .._errors import CLIError
from .._models import BaseModel
from ..._streaming import Stream

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register(subparser: _SubParsersAction[ArgumentParser]) -> None:
    sub = subparser.add_parser("completions.create")

    # Required
    sub.add_argument(
        "-m",
        "--model",
        help="The model to use",
        required=True,
    )

    # Optional
    sub.add_argument("-p", "--prompt", help="An optional prompt to complete from")
    sub.add_argument("--stream", help="Stream tokens as they're ready.", action="store_true")
    sub.add_argument("-M", "--max-tokens", help="The maximum number of tokens to generate", type=int)
    sub.add_argument(
        "-t",
        "--temperature",
        help="""What sampling temperature to use. Higher values means the model will take more risks. Try 0.9 for more creative applications, and 0 (argmax sampling) for ones with a well-defined answer.

Mutually exclusive with `top_p`.""",
        type=float,
    )
    sub.add_argument(
        "-P",
        "--top_p",
        help="""An alternative to sampling with temperature, called nucleus sampling, where the considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10%% probability mass are considered.

            Mutually exclusive with `temperature`.""",
        type=float,
    )
    sub.add_argument(
        "-n",
        "--n",
        help="How many sub-completions to generate for each prompt.",
        type=int,
    )
    sub.add_argument(
        "--logprobs",
        help="Include the log probabilities on the `logprobs` most likely tokens, as well the chosen tokens. So for example, if `logprobs` is 10, the API will return a list of the 10 most likely tokens. If `logprobs` is 0, only the chosen tokens will have logprobs returned.",
        type=int,
    )
    sub.add_argument(
        "--best_of",
        help="Generates `best_of` completions server-side and returns the 'best' (the one with the highest log probability per token). Results cannot be streamed.",
        type=int,
    )
    sub.add_argument(
        "--echo",
        help="Echo back the prompt in addition to the completion",
        action="store_true",
    )
    sub.add_argument(
        "--frequency_penalty",
        help="Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.",
        type=float,
    )
    sub.add_argument(
        "--presence_penalty",
        help="Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
        type=float,
    )
    sub.add_argument("--suffix", help="The suffix that comes after a completion of inserted text.")
    sub.add_argument("--stop", help="A stop sequence at which to stop generating tokens.")
    sub.add_argument(
        "--user",
        help="A unique identifier representing your end-user, which can help OpenAI to monitor and detect abuse.",
    )
    # TODO: add support for logit_bias
    sub.set_defaults(func=CLICompletions.create, args_model=CLICompletionCreateArgs)


class CLICompletionCreateArgs(BaseModel):
    model: str
    stream: bool = False

    prompt: Optional[str] = None
    n: NotGivenOr[int] = NOT_GIVEN
    stop: NotGivenOr[str] = NOT_GIVEN
    user: NotGivenOr[str] = NOT_GIVEN
    echo: NotGivenOr[bool] = NOT_GIVEN
    suffix: NotGivenOr[str] = NOT_GIVEN
    best_of: NotGivenOr[int] = NOT_GIVEN
    top_p: NotGivenOr[float] = NOT_GIVEN
    logprobs: NotGivenOr[int] = NOT_GIVEN
    max_tokens: NotGivenOr[int] = NOT_GIVEN
    temperature: NotGivenOr[float] = NOT_GIVEN
    presence_penalty: NotGivenOr[float] = NOT_GIVEN
    frequency_penalty: NotGivenOr[float] = NOT_GIVEN


class CLICompletions:
    @staticmethod
    def create(args: CLICompletionCreateArgs) -> None:
        if is_given(args.n) and args.n > 1 and args.stream:
            raise CLIError("Can't stream completions with n>1 with the current CLI")

        make_request = partial(
            get_client().completions.create,
            n=args.n,
            echo=args.echo,
            stop=args.stop,
            user=args.user,
            model=args.model,
            top_p=args.top_p,
            prompt=args.prompt,
            suffix=args.suffix,
            best_of=args.best_of,
            logprobs=args.logprobs,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
            presence_penalty=args.presence_penalty,
            frequency_penalty=args.frequency_penalty,
        )

        if args.stream:
            return CLICompletions._stream_create(
                # mypy doesn't understand the `partial` function but pyright does
                cast(Stream[Completion], make_request(stream=True))  # pyright: ignore[reportUnnecessaryCast]
            )

        return CLICompletions._create(make_request())

    @staticmethod
    def _create(completion: Completion) -> None:
        should_print_header = len(completion.choices) > 1
        for choice in completion.choices:
            if should_print_header:
                sys.stdout.write("===== Completion {} =====\n".format(choice.index))

            sys.stdout.write(choice.text)

            if should_print_header or not choice.text.endswith("\n"):
                sys.stdout.write("\n")

            sys.stdout.flush()

    @staticmethod
    def _stream_create(stream: Stream[Completion]) -> None:
        for completion in stream:
            should_print_header = len(completion.choices) > 1
            for choice in sorted(completion.choices, key=lambda c: c.index):
                if should_print_header:
                    sys.stdout.write("===== Chat Completion {} =====\n".format(choice.index))

                sys.stdout.write(choice.text)

                if should_print_header:
                    sys.stdout.write("\n")

                sys.stdout.flush()

        sys.stdout.write("\n")
