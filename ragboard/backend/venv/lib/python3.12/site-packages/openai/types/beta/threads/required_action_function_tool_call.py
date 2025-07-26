# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ...._models import BaseModel

__all__ = ["RequiredActionFunctionToolCall", "Function"]


class Function(BaseModel):
    arguments: str
    """The arguments that the model expects you to pass to the function."""

    name: str
    """The name of the function."""


class RequiredActionFunctionToolCall(BaseModel):
    id: str
    """The ID of the tool call.

    This ID must be referenced when you submit the tool outputs in using the
    [Submit tool outputs to run](https://platform.openai.com/docs/api-reference/runs/submitToolOutputs)
    endpoint.
    """

    function: Function
    """The function definition."""

    type: Literal["function"]
    """The type of tool call the output is required for.

    For now, this is always `function`.
    """
