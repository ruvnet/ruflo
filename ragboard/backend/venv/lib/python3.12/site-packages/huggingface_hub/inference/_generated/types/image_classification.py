# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Literal, Optional

from .base import BaseInferenceType, dataclass_with_extra


ImageClassificationOutputTransform = Literal["sigmoid", "softmax", "none"]


@dataclass_with_extra
class ImageClassificationParameters(BaseInferenceType):
    """Additional inference parameters for Image Classification"""

    function_to_apply: Optional["ImageClassificationOutputTransform"] = None
    """The function to apply to the model outputs in order to retrieve the scores."""
    top_k: Optional[int] = None
    """When specified, limits the output to the top K most probable classes."""


@dataclass_with_extra
class ImageClassificationInput(BaseInferenceType):
    """Inputs for Image Classification inference"""

    inputs: str
    """The input image data as a base64-encoded string. If no `parameters` are provided, you can
    also provide the image data as a raw bytes payload.
    """
    parameters: Optional[ImageClassificationParameters] = None
    """Additional inference parameters for Image Classification"""


@dataclass_with_extra
class ImageClassificationOutputElement(BaseInferenceType):
    """Outputs of inference for the Image Classification task"""

    label: str
    """The predicted class label."""
    score: float
    """The corresponding probability."""
