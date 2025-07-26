# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, List, Optional, Union

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class DocumentQuestionAnsweringInputData(BaseInferenceType):
    """One (document, question) pair to answer"""

    image: Any
    """The image on which the question is asked"""
    question: str
    """A question to ask of the document"""


@dataclass_with_extra
class DocumentQuestionAnsweringParameters(BaseInferenceType):
    """Additional inference parameters for Document Question Answering"""

    doc_stride: Optional[int] = None
    """If the words in the document are too long to fit with the question for the model, it will
    be split in several chunks with some overlap. This argument controls the size of that
    overlap.
    """
    handle_impossible_answer: Optional[bool] = None
    """Whether to accept impossible as an answer"""
    lang: Optional[str] = None
    """Language to use while running OCR. Defaults to english."""
    max_answer_len: Optional[int] = None
    """The maximum length of predicted answers (e.g., only answers with a shorter length are
    considered).
    """
    max_question_len: Optional[int] = None
    """The maximum length of the question after tokenization. It will be truncated if needed."""
    max_seq_len: Optional[int] = None
    """The maximum length of the total sentence (context + question) in tokens of each chunk
    passed to the model. The context will be split in several chunks (using doc_stride as
    overlap) if needed.
    """
    top_k: Optional[int] = None
    """The number of answers to return (will be chosen by order of likelihood). Can return less
    than top_k answers if there are not enough options available within the context.
    """
    word_boxes: Optional[List[Union[List[float], str]]] = None
    """A list of words and bounding boxes (normalized 0->1000). If provided, the inference will
    skip the OCR step and use the provided bounding boxes instead.
    """


@dataclass_with_extra
class DocumentQuestionAnsweringInput(BaseInferenceType):
    """Inputs for Document Question Answering inference"""

    inputs: DocumentQuestionAnsweringInputData
    """One (document, question) pair to answer"""
    parameters: Optional[DocumentQuestionAnsweringParameters] = None
    """Additional inference parameters for Document Question Answering"""


@dataclass_with_extra
class DocumentQuestionAnsweringOutputElement(BaseInferenceType):
    """Outputs of inference for the Document Question Answering task"""

    answer: str
    """The answer to the question."""
    end: int
    """The end word index of the answer (in the OCR’d version of the input or provided word
    boxes).
    """
    score: float
    """The probability associated to the answer."""
    start: int
    """The start word index of the answer (in the OCR’d version of the input or provided word
    boxes).
    """
