# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ...._models import BaseModel

__all__ = ["MessageContentImageFile", "ImageFile"]


class ImageFile(BaseModel):
    file_id: str
    """
    The [File](https://platform.openai.com/docs/api-reference/files) ID of the image
    in the message content.
    """


class MessageContentImageFile(BaseModel):
    image_file: ImageFile

    type: Literal["image_file"]
    """Always `image_file`."""
