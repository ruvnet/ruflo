# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import Union, Optional
from typing_extensions import Literal, Required, TypedDict

__all__ = ["ImageGenerateParams"]


class ImageGenerateParams(TypedDict, total=False):
    prompt: Required[str]
    """A text description of the desired image(s).

    The maximum length is 1000 characters for `dall-e-2` and 4000 characters for
    `dall-e-3`.
    """

    model: Union[str, Literal["dall-e-2", "dall-e-3"], None]
    """The model to use for image generation."""

    n: Optional[int]
    """The number of images to generate.

    Must be between 1 and 10. For `dall-e-3`, only `n=1` is supported.
    """

    quality: Literal["standard", "hd"]
    """The quality of the image that will be generated.

    `hd` creates images with finer details and greater consistency across the image.
    This param is only supported for `dall-e-3`.
    """

    response_format: Optional[Literal["url", "b64_json"]]
    """The format in which the generated images are returned.

    Must be one of `url` or `b64_json`.
    """

    size: Optional[Literal["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"]]
    """The size of the generated images.

    Must be one of `256x256`, `512x512`, or `1024x1024` for `dall-e-2`. Must be one
    of `1024x1024`, `1792x1024`, or `1024x1792` for `dall-e-3` models.
    """

    style: Optional[Literal["vivid", "natural"]]
    """The style of the generated images.

    Must be one of `vivid` or `natural`. Vivid causes the model to lean towards
    generating hyper-real and dramatic images. Natural causes the model to produce
    more natural, less hyper-real looking images. This param is only supported for
    `dall-e-3`.
    """

    user: str
    """
    A unique identifier representing your end-user, which can help OpenAI to monitor
    and detect abuse.
    [Learn more](https://platform.openai.com/docs/guides/safety-best-practices/end-user-ids).
    """
