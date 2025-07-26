# File generated from our OpenAPI spec by Stainless.

from .._models import BaseModel

__all__ = ["CompletionUsage"]


class CompletionUsage(BaseModel):
    completion_tokens: int
    """Number of tokens in the generated completion."""

    prompt_tokens: int
    """Number of tokens in the prompt."""

    total_tokens: int
    """Total number of tokens used in the request (prompt + completion)."""
