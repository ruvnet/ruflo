# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Dict, List, Literal, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class TableQuestionAnsweringInputData(BaseInferenceType):
    """One (table, question) pair to answer"""

    question: str
    """The question to be answered about the table"""
    table: Dict[str, List[str]]
    """The table to serve as context for the questions"""


Padding = Literal["do_not_pad", "longest", "max_length"]


@dataclass_with_extra
class TableQuestionAnsweringParameters(BaseInferenceType):
    """Additional inference parameters for Table Question Answering"""

    padding: Optional["Padding"] = None
    """Activates and controls padding."""
    sequential: Optional[bool] = None
    """Whether to do inference sequentially or as a batch. Batching is faster, but models like
    SQA require the inference to be done sequentially to extract relations within sequences,
    given their conversational nature.
    """
    truncation: Optional[bool] = None
    """Activates and controls truncation."""


@dataclass_with_extra
class TableQuestionAnsweringInput(BaseInferenceType):
    """Inputs for Table Question Answering inference"""

    inputs: TableQuestionAnsweringInputData
    """One (table, question) pair to answer"""
    parameters: Optional[TableQuestionAnsweringParameters] = None
    """Additional inference parameters for Table Question Answering"""


@dataclass_with_extra
class TableQuestionAnsweringOutputElement(BaseInferenceType):
    """Outputs of inference for the Table Question Answering task"""

    answer: str
    """The answer of the question given the table. If there is an aggregator, the answer will be
    preceded by `AGGREGATOR >`.
    """
    cells: List[str]
    """List of strings made up of the answer cell values."""
    coordinates: List[List[int]]
    """Coordinates of the cells of the answers."""
    aggregator: Optional[str] = None
    """If the model has an aggregator, this returns the aggregator."""
