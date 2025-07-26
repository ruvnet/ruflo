# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, List, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class FillMaskParameters(BaseInferenceType):
    """Additional inference parameters for Fill Mask"""

    targets: Optional[List[str]] = None
    """When passed, the model will limit the scores to the passed targets instead of looking up
    in the whole vocabulary. If the provided targets are not in the model vocab, they will be
    tokenized and the first resulting token will be used (with a warning, and that might be
    slower).
    """
    top_k: Optional[int] = None
    """When passed, overrides the number of predictions to return."""


@dataclass_with_extra
class FillMaskInput(BaseInferenceType):
    """Inputs for Fill Mask inference"""

    inputs: str
    """The text with masked tokens"""
    parameters: Optional[FillMaskParameters] = None
    """Additional inference parameters for Fill Mask"""


@dataclass_with_extra
class FillMaskOutputElement(BaseInferenceType):
    """Outputs of inference for the Fill Mask task"""

    score: float
    """The corresponding probability"""
    sequence: str
    """The corresponding input with the mask token prediction."""
    token: int
    """The predicted token id (to replace the masked one)."""
    token_str: Any
    fill_mask_output_token_str: Optional[str] = None
    """The predicted token (to replace the masked one)."""
