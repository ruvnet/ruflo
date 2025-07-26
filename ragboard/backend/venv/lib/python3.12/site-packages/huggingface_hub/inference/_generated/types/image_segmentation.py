# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Literal, Optional

from .base import BaseInferenceType, dataclass_with_extra


ImageSegmentationSubtask = Literal["instance", "panoptic", "semantic"]


@dataclass_with_extra
class ImageSegmentationParameters(BaseInferenceType):
    """Additional inference parameters for Image Segmentation"""

    mask_threshold: Optional[float] = None
    """Threshold to use when turning the predicted masks into binary values."""
    overlap_mask_area_threshold: Optional[float] = None
    """Mask overlap threshold to eliminate small, disconnected segments."""
    subtask: Optional["ImageSegmentationSubtask"] = None
    """Segmentation task to be performed, depending on model capabilities."""
    threshold: Optional[float] = None
    """Probability threshold to filter out predicted masks."""


@dataclass_with_extra
class ImageSegmentationInput(BaseInferenceType):
    """Inputs for Image Segmentation inference"""

    inputs: str
    """The input image data as a base64-encoded string. If no `parameters` are provided, you can
    also provide the image data as a raw bytes payload.
    """
    parameters: Optional[ImageSegmentationParameters] = None
    """Additional inference parameters for Image Segmentation"""


@dataclass_with_extra
class ImageSegmentationOutputElement(BaseInferenceType):
    """Outputs of inference for the Image Segmentation task
    A predicted mask / segment
    """

    label: str
    """The label of the predicted segment."""
    mask: str
    """The corresponding mask as a black-and-white image (base64-encoded)."""
    score: Optional[float] = None
    """The score or confidence degree the model has."""
