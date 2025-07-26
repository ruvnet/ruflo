# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, List, Literal, Optional

from .base import BaseInferenceType, dataclass_with_extra


TypeEnum = Literal["json", "regex", "json_schema"]


@dataclass_with_extra
class TextGenerationInputGrammarType(BaseInferenceType):
    type: "TypeEnum"
    value: Any
    """A string that represents a [JSON Schema](https://json-schema.org/).
    JSON Schema is a declarative language that allows to annotate JSON documents
    with types and descriptions.
    """


@dataclass_with_extra
class TextGenerationInputGenerateParameters(BaseInferenceType):
    adapter_id: Optional[str] = None
    """Lora adapter id"""
    best_of: Optional[int] = None
    """Generate best_of sequences and return the one if the highest token logprobs."""
    decoder_input_details: Optional[bool] = None
    """Whether to return decoder input token logprobs and ids."""
    details: Optional[bool] = None
    """Whether to return generation details."""
    do_sample: Optional[bool] = None
    """Activate logits sampling."""
    frequency_penalty: Optional[float] = None
    """The parameter for frequency penalty. 1.0 means no penalty
    Penalize new tokens based on their existing frequency in the text so far,
    decreasing the model's likelihood to repeat the same line verbatim.
    """
    grammar: Optional[TextGenerationInputGrammarType] = None
    max_new_tokens: Optional[int] = None
    """Maximum number of tokens to generate."""
    repetition_penalty: Optional[float] = None
    """The parameter for repetition penalty. 1.0 means no penalty.
    See [this paper](https://arxiv.org/pdf/1909.05858.pdf) for more details.
    """
    return_full_text: Optional[bool] = None
    """Whether to prepend the prompt to the generated text"""
    seed: Optional[int] = None
    """Random sampling seed."""
    stop: Optional[List[str]] = None
    """Stop generating tokens if a member of `stop` is generated."""
    temperature: Optional[float] = None
    """The value used to module the logits distribution."""
    top_k: Optional[int] = None
    """The number of highest probability vocabulary tokens to keep for top-k-filtering."""
    top_n_tokens: Optional[int] = None
    """The number of highest probability vocabulary tokens to keep for top-n-filtering."""
    top_p: Optional[float] = None
    """Top-p value for nucleus sampling."""
    truncate: Optional[int] = None
    """Truncate inputs tokens to the given size."""
    typical_p: Optional[float] = None
    """Typical Decoding mass
    See [Typical Decoding for Natural Language Generation](https://arxiv.org/abs/2202.00666)
    for more information.
    """
    watermark: Optional[bool] = None
    """Watermarking with [A Watermark for Large Language
    Models](https://arxiv.org/abs/2301.10226).
    """


@dataclass_with_extra
class TextGenerationInput(BaseInferenceType):
    """Text Generation Input.
    Auto-generated from TGI specs.
    For more details, check out
    https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-tgi-import.ts.
    """

    inputs: str
    parameters: Optional[TextGenerationInputGenerateParameters] = None
    stream: Optional[bool] = None


TextGenerationOutputFinishReason = Literal["length", "eos_token", "stop_sequence"]


@dataclass_with_extra
class TextGenerationOutputPrefillToken(BaseInferenceType):
    id: int
    logprob: float
    text: str


@dataclass_with_extra
class TextGenerationOutputToken(BaseInferenceType):
    id: int
    logprob: float
    special: bool
    text: str


@dataclass_with_extra
class TextGenerationOutputBestOfSequence(BaseInferenceType):
    finish_reason: "TextGenerationOutputFinishReason"
    generated_text: str
    generated_tokens: int
    prefill: List[TextGenerationOutputPrefillToken]
    tokens: List[TextGenerationOutputToken]
    seed: Optional[int] = None
    top_tokens: Optional[List[List[TextGenerationOutputToken]]] = None


@dataclass_with_extra
class TextGenerationOutputDetails(BaseInferenceType):
    finish_reason: "TextGenerationOutputFinishReason"
    generated_tokens: int
    prefill: List[TextGenerationOutputPrefillToken]
    tokens: List[TextGenerationOutputToken]
    best_of_sequences: Optional[List[TextGenerationOutputBestOfSequence]] = None
    seed: Optional[int] = None
    top_tokens: Optional[List[List[TextGenerationOutputToken]]] = None


@dataclass_with_extra
class TextGenerationOutput(BaseInferenceType):
    """Text Generation Output.
    Auto-generated from TGI specs.
    For more details, check out
    https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-tgi-import.ts.
    """

    generated_text: str
    details: Optional[TextGenerationOutputDetails] = None


@dataclass_with_extra
class TextGenerationStreamOutputStreamDetails(BaseInferenceType):
    finish_reason: "TextGenerationOutputFinishReason"
    generated_tokens: int
    input_length: int
    seed: Optional[int] = None


@dataclass_with_extra
class TextGenerationStreamOutputToken(BaseInferenceType):
    id: int
    logprob: float
    special: bool
    text: str


@dataclass_with_extra
class TextGenerationStreamOutput(BaseInferenceType):
    """Text Generation Stream Output.
    Auto-generated from TGI specs.
    For more details, check out
    https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-tgi-import.ts.
    """

    index: int
    token: TextGenerationStreamOutputToken
    details: Optional[TextGenerationStreamOutputStreamDetails] = None
    generated_text: Optional[str] = None
    top_tokens: Optional[List[TextGenerationStreamOutputToken]] = None
