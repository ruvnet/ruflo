# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class VisualQuestionAnsweringInputData(BaseInferenceType):
    """One (image, question) pair to answer"""

    image: Any
    """The image."""
    question: str
    """The question to answer based on the image."""


@dataclass_with_extra
class VisualQuestionAnsweringParameters(BaseInferenceType):
    """Additional inference parameters for Visual Question Answering"""

    top_k: Optional[int] = None
    """The number of answers to return (will be chosen by order of likelihood). Note that we
    return less than topk answers if there are not enough options available within the
    context.
    """


@dataclass_with_extra
class VisualQuestionAnsweringInput(BaseInferenceType):
    """Inputs for Visual Question Answering inference"""

    inputs: VisualQuestionAnsweringInputData
    """One (image, question) pair to answer"""
    parameters: Optional[VisualQuestionAnsweringParameters] = None
    """Additional inference parameters for Visual Question Answering"""


@dataclass_with_extra
class VisualQuestionAnsweringOutputElement(BaseInferenceType):
    """Outputs of inference for the Visual Question Answering task"""

    score: float
    """The associated score / probability"""
    answer: Optional[str] = None
    """The answer to the question"""
