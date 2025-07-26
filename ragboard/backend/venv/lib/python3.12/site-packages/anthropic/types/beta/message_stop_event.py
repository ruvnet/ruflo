# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ..._models import BaseModel

__all__ = ["MessageStopEvent"]


class MessageStopEvent(BaseModel):
    type: Literal["message_stop"]
