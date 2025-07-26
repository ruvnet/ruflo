# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import List, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class ZeroShotClassificationParameters(BaseInferenceType):
    """Additional inference parameters for Zero Shot Classification"""

    candidate_labels: List[str]
    """The set of possible class labels to classify the text into."""
    hypothesis_template: Optional[str] = None
    """The sentence used in conjunction with `candidate_labels` to attempt the text
    classification by replacing the placeholder with the candidate labels.
    """
    multi_label: Optional[bool] = None
    """Whether multiple candidate labels can be true. If false, the scores are normalized such
    that the sum of the label likelihoods for each sequence is 1. If true, the labels are
    considered independent and probabilities are normalized for each candidate.
    """


@dataclass_with_extra
class ZeroShotClassificationInput(BaseInferenceType):
    """Inputs for Zero Shot Classification inference"""

    inputs: str
    """The text to classify"""
    parameters: ZeroShotClassificationParameters
    """Additional inference parameters for Zero Shot Classification"""


@dataclass_with_extra
class ZeroShotClassificationOutputElement(BaseInferenceType):
    """Outputs of inference for the Zero Shot Classification task"""

    label: str
    """The predicted class label."""
    score: float
    """The corresponding probability."""
