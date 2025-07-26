# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import List, Union
from typing_extensions import Literal, Required, TypedDict

__all__ = ["ModerationCreateParams"]


class ModerationCreateParams(TypedDict, total=False):
    input: Required[Union[str, List[str]]]
    """The input text to classify"""

    model: Union[str, Literal["text-moderation-latest", "text-moderation-stable"]]
    """
    Two content moderations models are available: `text-moderation-stable` and
    `text-moderation-latest`.

    The default is `text-moderation-latest` which will be automatically upgraded
    over time. This ensures you are always using our most accurate model. If you use
    `text-moderation-stable`, we will provide advanced notice before updating the
    model. Accuracy of `text-moderation-stable` may be slightly lower than for
    `text-moderation-latest`.
    """
