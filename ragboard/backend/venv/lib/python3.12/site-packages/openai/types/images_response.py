# File generated from our OpenAPI spec by Stainless.

from typing import List

from .image import Image
from .._models import BaseModel

__all__ = ["ImagesResponse"]


class ImagesResponse(BaseModel):
    created: int

    data: List[Image]
