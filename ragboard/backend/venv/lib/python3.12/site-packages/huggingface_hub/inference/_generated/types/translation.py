# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, Dict, Literal, Optional

from .base import BaseInferenceType, dataclass_with_extra


TranslationTruncationStrategy = Literal["do_not_truncate", "longest_first", "only_first", "only_second"]


@dataclass_with_extra
class TranslationParameters(BaseInferenceType):
    """Additional inference parameters for Translation"""

    clean_up_tokenization_spaces: Optional[bool] = None
    """Whether to clean up the potential extra spaces in the text output."""
    generate_parameters: Optional[Dict[str, Any]] = None
    """Additional parametrization of the text generation algorithm."""
    src_lang: Optional[str] = None
    """The source language of the text. Required for models that can translate from multiple
    languages.
    """
    tgt_lang: Optional[str] = None
    """Target language to translate to. Required for models that can translate to multiple
    languages.
    """
    truncation: Optional["TranslationTruncationStrategy"] = None
    """The truncation strategy to use."""


@dataclass_with_extra
class TranslationInput(BaseInferenceType):
    """Inputs for Translation inference"""

    inputs: str
    """The text to translate."""
    parameters: Optional[TranslationParameters] = None
    """Additional inference parameters for Translation"""


@dataclass_with_extra
class TranslationOutput(BaseInferenceType):
    """Outputs of inference for the Translation task"""

    translation_text: str
    """The translated text."""
