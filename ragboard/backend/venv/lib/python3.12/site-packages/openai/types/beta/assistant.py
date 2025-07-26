# File generated from our OpenAPI spec by Stainless.

import builtins
from typing import List, Union, Optional
from typing_extensions import Literal

from ..shared import FunctionDefinition
from ..._models import BaseModel

__all__ = ["Assistant", "Tool", "ToolCodeInterpreter", "ToolRetrieval", "ToolFunction"]


class ToolCodeInterpreter(BaseModel):
    type: Literal["code_interpreter"]
    """The type of tool being defined: `code_interpreter`"""


class ToolRetrieval(BaseModel):
    type: Literal["retrieval"]
    """The type of tool being defined: `retrieval`"""


class ToolFunction(BaseModel):
    function: FunctionDefinition

    type: Literal["function"]
    """The type of tool being defined: `function`"""


Tool = Union[ToolCodeInterpreter, ToolRetrieval, ToolFunction]


class Assistant(BaseModel):
    id: str
    """The identifier, which can be referenced in API endpoints."""

    created_at: int
    """The Unix timestamp (in seconds) for when the assistant was created."""

    description: Optional[str] = None
    """The description of the assistant. The maximum length is 512 characters."""

    file_ids: List[str]
    """
    A list of [file](https://platform.openai.com/docs/api-reference/files) IDs
    attached to this assistant. There can be a maximum of 20 files attached to the
    assistant. Files are ordered by their creation date in ascending order.
    """

    instructions: Optional[str] = None
    """The system instructions that the assistant uses.

    The maximum length is 32768 characters.
    """

    metadata: Optional[builtins.object] = None
    """Set of 16 key-value pairs that can be attached to an object.

    This can be useful for storing additional information about the object in a
    structured format. Keys can be a maximum of 64 characters long and values can be
    a maxium of 512 characters long.
    """

    model: str
    """ID of the model to use.

    You can use the
    [List models](https://platform.openai.com/docs/api-reference/models/list) API to
    see all of your available models, or see our
    [Model overview](https://platform.openai.com/docs/models/overview) for
    descriptions of them.
    """

    name: Optional[str] = None
    """The name of the assistant. The maximum length is 256 characters."""

    object: Literal["assistant"]
    """The object type, which is always `assistant`."""

    tools: List[Tool]
    """A list of tool enabled on the assistant.

    There can be a maximum of 128 tools per assistant. Tools can be of types
    `code_interpreter`, `retrieval`, or `function`.
    """
