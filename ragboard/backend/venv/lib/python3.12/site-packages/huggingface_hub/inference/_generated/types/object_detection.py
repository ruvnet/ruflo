# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class ObjectDetectionParameters(BaseInferenceType):
    """Additional inference parameters for Object Detection"""

    threshold: Optional[float] = None
    """The probability necessary to make a prediction."""


@dataclass_with_extra
class ObjectDetectionInput(BaseInferenceType):
    """Inputs for Object Detection inference"""

    inputs: str
    """The input image data as a base64-encoded string. If no `parameters` are provided, you can
    also provide the image data as a raw bytes payload.
    """
    parameters: Optional[ObjectDetectionParameters] = None
    """Additional inference parameters for Object Detection"""


@dataclass_with_extra
class ObjectDetectionBoundingBox(BaseInferenceType):
    """The predicted bounding box. Coordinates are relative to the top left corner of the input
    image.
    """

    xmax: int
    """The x-coordinate of the bottom-right corner of the bounding box."""
    xmin: int
    """The x-coordinate of the top-left corner of the bounding box."""
    ymax: int
    """The y-coordinate of the bottom-right corner of the bounding box."""
    ymin: int
    """The y-coordinate of the top-left corner of the bounding box."""


@dataclass_with_extra
class ObjectDetectionOutputElement(BaseInferenceType):
    """Outputs of inference for the Object Detection task"""

    box: ObjectDetectionBoundingBox
    """The predicted bounding box. Coordinates are relative to the top left corner of the input
    image.
    """
    label: str
    """The predicted label for the bounding box."""
    score: float
    """The associated score / probability."""
