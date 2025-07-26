# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ..._models import BaseModel

__all__ = ["ContentBlock"]


class ContentBlock(BaseModel):
    text: str

    type: Literal["text"]
