# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing_extensions import Literal, Required, TypedDict

from .._types import FileTypes

__all__ = ["FileCreateParams"]


class FileCreateParams(TypedDict, total=False):
    file: Required[FileTypes]
    """The File object (not file name) to be uploaded."""

    purpose: Required[Literal["fine-tune", "assistants"]]
    """The intended purpose of the uploaded file.

    Use "fine-tune" for
    [Fine-tuning](https://platform.openai.com/docs/api-reference/fine-tuning) and
    "assistants" for
    [Assistants](https://platform.openai.com/docs/api-reference/assistants) and
    [Messages](https://platform.openai.com/docs/api-reference/messages). This allows
    us to validate the format of the uploaded file is correct for fine-tuning.
    """
