# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import List, Union, Optional
from typing_extensions import Literal, Required, TypedDict

from ....types import shared_params

__all__ = [
    "RunCreateParams",
    "Tool",
    "ToolAssistantToolsCode",
    "ToolAssistantToolsRetrieval",
    "ToolAssistantToolsFunction",
]


class RunCreateParams(TypedDict, total=False):
    assistant_id: Required[str]
    """
    The ID of the
    [assistant](https://platform.openai.com/docs/api-reference/assistants) to use to
    execute this run.
    """

    additional_instructions: Optional[str]
    """Appends additional instructions at the end of the instructions for the run.

    This is useful for modifying the behavior on a per-run basis without overriding
    other instructions.
    """

    instructions: Optional[str]
    """
    Overrides the
    [instructions](https://platform.openai.com/docs/api-reference/assistants/createAssistant)
    of the assistant. This is useful for modifying the behavior on a per-run basis.
    """

    metadata: Optional[object]
    """Set of 16 key-value pairs that can be attached to an object.

    This can be useful for storing additional information about the object in a
    structured format. Keys can be a maximum of 64 characters long and values can be
    a maxium of 512 characters long.
    """

    model: Optional[str]
    """
    The ID of the [Model](https://platform.openai.com/docs/api-reference/models) to
    be used to execute this run. If a value is provided here, it will override the
    model associated with the assistant. If not, the model associated with the
    assistant will be used.
    """

    tools: Optional[List[Tool]]
    """Override the tools the assistant can use for this run.

    This is useful for modifying the behavior on a per-run basis.
    """


class ToolAssistantToolsCode(TypedDict, total=False):
    type: Required[Literal["code_interpreter"]]
    """The type of tool being defined: `code_interpreter`"""


class ToolAssistantToolsRetrieval(TypedDict, total=False):
    type: Required[Literal["retrieval"]]
    """The type of tool being defined: `retrieval`"""


class ToolAssistantToolsFunction(TypedDict, total=False):
    function: Required[shared_params.FunctionDefinition]

    type: Required[Literal["function"]]
    """The type of tool being defined: `function`"""


Tool = Union[ToolAssistantToolsCode, ToolAssistantToolsRetrieval, ToolAssistantToolsFunction]
