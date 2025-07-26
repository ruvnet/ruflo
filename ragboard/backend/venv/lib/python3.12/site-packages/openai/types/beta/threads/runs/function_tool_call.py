# File generated from our OpenAPI spec by Stainless.

from typing import Optional
from typing_extensions import Literal

from ....._models import BaseModel

__all__ = ["FunctionToolCall", "Function"]


class Function(BaseModel):
    arguments: str
    """The arguments passed to the function."""

    name: str
    """The name of the function."""

    output: Optional[str] = None
    """The output of the function.

    This will be `null` if the outputs have not been
    [submitted](https://platform.openai.com/docs/api-reference/runs/submitToolOutputs)
    yet.
    """


class FunctionToolCall(BaseModel):
    id: str
    """The ID of the tool call object."""

    function: Function
    """The definition of the function that was called."""

    type: Literal["function"]
    """The type of tool call.

    This is always going to be `function` for this type of tool call.
    """
