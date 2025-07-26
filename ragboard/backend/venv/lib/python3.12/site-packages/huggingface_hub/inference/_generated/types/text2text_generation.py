# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, Dict, Literal, Optional

from .base import BaseInferenceType, dataclass_with_extra


Text2TextGenerationTruncationStrategy = Literal["do_not_truncate", "longest_first", "only_first", "only_second"]


@dataclass_with_extra
class Text2TextGenerationParameters(BaseInferenceType):
    """Additional inference parameters for Text2text Generation"""

    clean_up_tokenization_spaces: Optional[bool] = None
    """Whether to clean up the potential extra spaces in the text output."""
    generate_parameters: Optional[Dict[str, Any]] = None
    """Additional parametrization of the text generation algorithm"""
    truncation: Optional["Text2TextGenerationTruncationStrategy"] = None
    """The truncation strategy to use"""


@dataclass_with_extra
class Text2TextGenerationInput(BaseInferenceType):
    """Inputs for Text2text Generation inference"""

    inputs: str
    """The input text data"""
    parameters: Optional[Text2TextGenerationParameters] = None
    """Additional inference parameters for Text2text Generation"""


@dataclass_with_extra
class Text2TextGenerationOutput(BaseInferenceType):
    """Outputs of inference for the Text2text Generation task"""

    generated_text: Any
    text2_text_generation_output_generated_text: Optional[str] = None
    """The generated text."""
