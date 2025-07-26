# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import List

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class ZeroShotObjectDetectionParameters(BaseInferenceType):
    """Additional inference parameters for Zero Shot Object Detection"""

    candidate_labels: List[str]
    """The candidate labels for this image"""


@dataclass_with_extra
class ZeroShotObjectDetectionInput(BaseInferenceType):
    """Inputs for Zero Shot Object Detection inference"""

    inputs: str
    """The input image data as a base64-encoded string."""
    parameters: ZeroShotObjectDetectionParameters
    """Additional inference parameters for Zero Shot Object Detection"""


@dataclass_with_extra
class ZeroShotObjectDetectionBoundingBox(BaseInferenceType):
    """The predicted bounding box. Coordinates are relative to the top left corner of the input
    image.
    """

    xmax: int
    xmin: int
    ymax: int
    ymin: int


@dataclass_with_extra
class ZeroShotObjectDetectionOutputElement(BaseInferenceType):
    """Outputs of inference for the Zero Shot Object Detection task"""

    box: ZeroShotObjectDetectionBoundingBox
    """The predicted bounding box. Coordinates are relative to the top left corner of the input
    image.
    """
    label: str
    """A candidate label"""
    score: float
    """The associated score / probability"""
