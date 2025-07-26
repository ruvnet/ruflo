# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, Dict, List, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class SentenceSimilarityInputData(BaseInferenceType):
    sentences: List[str]
    """A list of strings which will be compared against the source_sentence."""
    source_sentence: str
    """The string that you wish to compare the other strings with. This can be a phrase,
    sentence, or longer passage, depending on the model being used.
    """


@dataclass_with_extra
class SentenceSimilarityInput(BaseInferenceType):
    """Inputs for Sentence similarity inference"""

    inputs: SentenceSimilarityInputData
    parameters: Optional[Dict[str, Any]] = None
    """Additional inference parameters for Sentence Similarity"""
