# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, Literal, Optional, Union

from .base import BaseInferenceType, dataclass_with_extra


TextToSpeechEarlyStoppingEnum = Literal["never"]


@dataclass_with_extra
class TextToSpeechGenerationParameters(BaseInferenceType):
    """Parametrization of the text generation process"""

    do_sample: Optional[bool] = None
    """Whether to use sampling instead of greedy decoding when generating new tokens."""
    early_stopping: Optional[Union[bool, "TextToSpeechEarlyStoppingEnum"]] = None
    """Controls the stopping condition for beam-based methods."""
    epsilon_cutoff: Optional[float] = None
    """If set to float strictly between 0 and 1, only tokens with a conditional probability
    greater than epsilon_cutoff will be sampled. In the paper, suggested values range from
    3e-4 to 9e-4, depending on the size of the model. See [Truncation Sampling as Language
    Model Desmoothing](https://hf.co/papers/2210.15191) for more details.
    """
    eta_cutoff: Optional[float] = None
    """Eta sampling is a hybrid of locally typical sampling and epsilon sampling. If set to
    float strictly between 0 and 1, a token is only considered if it is greater than either
    eta_cutoff or sqrt(eta_cutoff) * exp(-entropy(softmax(next_token_logits))). The latter
    term is intuitively the expected next token probability, scaled by sqrt(eta_cutoff). In
    the paper, suggested values range from 3e-4 to 2e-3, depending on the size of the model.
    See [Truncation Sampling as Language Model Desmoothing](https://hf.co/papers/2210.15191)
    for more details.
    """
    max_length: Optional[int] = None
    """The maximum length (in tokens) of the generated text, including the input."""
    max_new_tokens: Optional[int] = None
    """The maximum number of tokens to generate. Takes precedence over max_length."""
    min_length: Optional[int] = None
    """The minimum length (in tokens) of the generated text, including the input."""
    min_new_tokens: Optional[int] = None
    """The minimum number of tokens to generate. Takes precedence over min_length."""
    num_beam_groups: Optional[int] = None
    """Number of groups to divide num_beams into in order to ensure diversity among different
    groups of beams. See [this paper](https://hf.co/papers/1610.02424) for more details.
    """
    num_beams: Optional[int] = None
    """Number of beams to use for beam search."""
    penalty_alpha: Optional[float] = None
    """The value balances the model confidence and the degeneration penalty in contrastive
    search decoding.
    """
    temperature: Optional[float] = None
    """The value used to modulate the next token probabilities."""
    top_k: Optional[int] = None
    """The number of highest probability vocabulary tokens to keep for top-k-filtering."""
    top_p: Optional[float] = None
    """If set to float < 1, only the smallest set of most probable tokens with probabilities
    that add up to top_p or higher are kept for generation.
    """
    typical_p: Optional[float] = None
    """Local typicality measures how similar the conditional probability of predicting a target
    token next is to the expected conditional probability of predicting a random token next,
    given the partial text already generated. If set to float < 1, the smallest set of the
    most locally typical tokens with probabilities that add up to typical_p or higher are
    kept for generation. See [this paper](https://hf.co/papers/2202.00666) for more details.
    """
    use_cache: Optional[bool] = None
    """Whether the model should use the past last key/values attentions to speed up decoding"""


@dataclass_with_extra
class TextToSpeechParameters(BaseInferenceType):
    """Additional inference parameters for Text To Speech"""

    generation_parameters: Optional[TextToSpeechGenerationParameters] = None
    """Parametrization of the text generation process"""


@dataclass_with_extra
class TextToSpeechInput(BaseInferenceType):
    """Inputs for Text To Speech inference"""

    inputs: str
    """The input text data"""
    parameters: Optional[TextToSpeechParameters] = None
    """Additional inference parameters for Text To Speech"""


@dataclass_with_extra
class TextToSpeechOutput(BaseInferenceType):
    """Outputs of inference for the Text To Speech task"""

    audio: Any
    """The generated audio"""
    sampling_rate: Optional[float] = None
    """The sampling rate of the generated audio waveform."""
