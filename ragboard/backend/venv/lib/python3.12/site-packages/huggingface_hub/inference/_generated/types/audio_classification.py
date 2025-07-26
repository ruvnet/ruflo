# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Literal, Optional

from .base import BaseInferenceType, dataclass_with_extra


AudioClassificationOutputTransform = Literal["sigmoid", "softmax", "none"]


@dataclass_with_extra
class AudioClassificationParameters(BaseInferenceType):
    """Additional inference parameters for Audio Classification"""

    function_to_apply: Optional["AudioClassificationOutputTransform"] = None
    """The function to apply to the model outputs in order to retrieve the scores."""
    top_k: Optional[int] = None
    """When specified, limits the output to the top K most probable classes."""


@dataclass_with_extra
class AudioClassificationInput(BaseInferenceType):
    """Inputs for Audio Classification inference"""

    inputs: str
    """The input audio data as a base64-encoded string. If no `parameters` are provided, you can
    also provide the audio data as a raw bytes payload.
    """
    parameters: Optional[AudioClassificationParameters] = None
    """Additional inference parameters for Audio Classification"""


@dataclass_with_extra
class AudioClassificationOutputElement(BaseInferenceType):
    """Outputs for Audio Classification inference"""

    label: str
    """The predicted class label."""
    score: float
    """The corresponding probability."""
