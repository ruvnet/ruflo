# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing_extensions import TypedDict

__all__ = ["JobListEventsParams"]


class JobListEventsParams(TypedDict, total=False):
    after: str
    """Identifier for the last event from the previous pagination request."""

    limit: int
    """Number of events to retrieve."""
