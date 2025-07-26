# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, Dict, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class DepthEstimationInput(BaseInferenceType):
    """Inputs for Depth Estimation inference"""

    inputs: Any
    """The input image data"""
    parameters: Optional[Dict[str, Any]] = None
    """Additional inference parameters for Depth Estimation"""


@dataclass_with_extra
class DepthEstimationOutput(BaseInferenceType):
    """Outputs of inference for the Depth Estimation task"""

    depth: Any
    """The predicted depth as an image"""
    predicted_depth: Any
    """The predicted depth as a tensor"""
