# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ..._models import BaseModel

__all__ = ["ContentBlockStopEvent"]


class ContentBlockStopEvent(BaseModel):
    index: int

    type: Literal["content_block_stop"]
