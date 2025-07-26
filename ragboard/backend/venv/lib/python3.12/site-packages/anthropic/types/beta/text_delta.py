# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ..._models import BaseModel

__all__ = ["TextDelta"]


class TextDelta(BaseModel):
    text: str

    type: Literal["text_delta"]
