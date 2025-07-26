# File generated from our OpenAPI spec by Stainless.

from typing import List

from .._models import BaseModel
from .moderation import Moderation

__all__ = ["ModerationCreateResponse"]


class ModerationCreateResponse(BaseModel):
    id: str
    """The unique identifier for the moderation request."""

    model: str
    """The model used to generate the moderation results."""

    results: List[Moderation]
    """A list of moderation objects."""
