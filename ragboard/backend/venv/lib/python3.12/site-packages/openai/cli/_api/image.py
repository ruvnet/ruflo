from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast
from argparse import ArgumentParser

from .._utils import get_client, print_model
from ..._types import NOT_GIVEN, NotGiven, NotGivenOr
from .._models import BaseModel
from .._progress import BufferReader

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register(subparser: _SubParsersAction[ArgumentParser]) -> None:
    sub = subparser.add_parser("images.generate")
    sub.add_argument("-p", "--prompt", type=str, required=True)
    sub.add_argument("-n", "--num-images", type=int, default=1)
    sub.add_argument("-s", "--size", type=str, default="1024x1024", help="Size of the output image")
    sub.add_argument("--response-format", type=str, default="url")
    sub.set_defaults(func=CLIImage.create, args_model=CLIImageCreateArgs)

    sub = subparser.add_parser("images.edit")
    sub.add_argument("-p", "--prompt", type=str, required=True)
    sub.add_argument("-n", "--num-images", type=int, default=1)
    sub.add_argument(
        "-I",
        "--image",
        type=str,
        required=True,
        help="Image to modify. Should be a local path and a PNG encoded image.",
    )
    sub.add_argument("-s", "--size", type=str, default="1024x1024", help="Size of the output image")
    sub.add_argument("--response-format", type=str, default="url")
    sub.add_argument(
        "-M",
        "--mask",
        type=str,
        required=False,
        help="Path to a mask image. It should be the same size as the image you're editing and a RGBA PNG image. The Alpha channel acts as the mask.",
    )
    sub.set_defaults(func=CLIImage.edit, args_model=CLIImageEditArgs)

    sub = subparser.add_parser("images.create_variation")
    sub.add_argument("-n", "--num-images", type=int, default=1)
    sub.add_argument(
        "-I",
        "--image",
        type=str,
        required=True,
        help="Image to modify. Should be a local path and a PNG encoded image.",
    )
    sub.add_argument("-s", "--size", type=str, default="1024x1024", help="Size of the output image")
    sub.add_argument("--response-format", type=str, default="url")
    sub.set_defaults(func=CLIImage.create_variation, args_model=CLIImageCreateVariationArgs)


class CLIImageCreateArgs(BaseModel):
    prompt: str
    num_images: int
    size: str
    response_format: str


class CLIImageCreateVariationArgs(BaseModel):
    image: str
    num_images: int
    size: str
    response_format: str


class CLIImageEditArgs(BaseModel):
    image: str
    num_images: int
    size: str
    response_format: str
    prompt: str
    mask: NotGivenOr[str] = NOT_GIVEN


class CLIImage:
    @staticmethod
    def create(args: CLIImageCreateArgs) -> None:
        image = get_client().images.generate(
            prompt=args.prompt,
            n=args.num_images,
            # casts required because the API is typed for enums
            # but we don't want to validate that here for forwards-compat
            size=cast(Any, args.size),
            response_format=cast(Any, args.response_format),
        )
        print_model(image)

    @staticmethod
    def create_variation(args: CLIImageCreateVariationArgs) -> None:
        with open(args.image, "rb") as file_reader:
            buffer_reader = BufferReader(file_reader.read(), desc="Upload progress")

        image = get_client().images.create_variation(
            image=("image", buffer_reader),
            n=args.num_images,
            # casts required because the API is typed for enums
            # but we don't want to validate that here for forwards-compat
            size=cast(Any, args.size),
            response_format=cast(Any, args.response_format),
        )
        print_model(image)

    @staticmethod
    def edit(args: CLIImageEditArgs) -> None:
        with open(args.image, "rb") as file_reader:
            buffer_reader = BufferReader(file_reader.read(), desc="Image upload progress")

        if isinstance(args.mask, NotGiven):
            mask: NotGivenOr[BufferReader] = NOT_GIVEN
        else:
            with open(args.mask, "rb") as file_reader:
                mask = BufferReader(file_reader.read(), desc="Mask progress")

        image = get_client().images.edit(
            prompt=args.prompt,
            image=("image", buffer_reader),
            n=args.num_images,
            mask=("mask", mask) if not isinstance(mask, NotGiven) else mask,
            # casts required because the API is typed for enums
            # but we don't want to validate that here for forwards-compat
            size=cast(Any, args.size),
            response_format=cast(Any, args.response_format),
        )
        print_model(image)
