# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import Union
from typing_extensions import Literal, Required, TypedDict

from ..._types import FileTypes

__all__ = ["TranslationCreateParams"]


class TranslationCreateParams(TypedDict, total=False):
    file: Required[FileTypes]
    """
    The audio file object (not file name) translate, in one of these formats: flac,
    mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm.
    """

    model: Required[Union[str, Literal["whisper-1"]]]
    """ID of the model to use. Only `whisper-1` is currently available."""

    prompt: str
    """An optional text to guide the model's style or continue a previous audio
    segment.

    The [prompt](https://platform.openai.com/docs/guides/speech-to-text/prompting)
    should be in English.
    """

    response_format: str
    """
    The format of the transcript output, in one of these options: `json`, `text`,
    `srt`, `verbose_json`, or `vtt`.
    """

    temperature: float
    """The sampling temperature, between 0 and 1.

    Higher values like 0.8 will make the output more random, while lower values like
    0.2 will make it more focused and deterministic. If set to 0, the model will use
    [log probability](https://en.wikipedia.org/wiki/Log_probability) to
    automatically increase the temperature until certain thresholds are hit.
    """
