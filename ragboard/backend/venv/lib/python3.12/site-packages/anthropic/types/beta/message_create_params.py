# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import List, Union
from typing_extensions import Literal, Required, TypedDict

from .message_param import MessageParam

__all__ = ["MessageCreateParamsBase", "Metadata", "MessageCreateParamsNonStreaming", "MessageCreateParamsStreaming"]


class MessageCreateParamsBase(TypedDict, total=False):
    max_tokens: Required[int]
    """The maximum number of tokens to generate before stopping.

    Note that our models may stop _before_ reaching this maximum. This parameter
    only specifies the absolute maximum number of tokens to generate.

    Different models have different maximum values for this parameter. See
    [input and output sizes](https://docs.anthropic.com/claude/reference/input-and-output-sizes)
    for details.
    """

    messages: Required[List[MessageParam]]
    """Input messages.

    Our models are trained to operate on alternating `user` and `assistant`
    conversational turns. When creating a new `Message`, you specify the prior
    conversational turns with the `messages` parameter, and the model then generates
    the next `Message` in the conversation.

    Each input message must be an object with a `role` and `content`. You can
    specify a single `user`-role message, or you can include multiple `user` and
    `assistant` messages. The first message must always use the `user` role.

    If the final message uses the `assistant` role, the response content will
    continue immediately from the content in that message. This can be used to
    constrain part of the model's response.

    Example with a single `user` message:

    ```json
    [{ "role": "user", "content": "Hello, Claude" }]
    ```

    Example with multiple conversational turns:

    ```json
    [
      { "role": "user", "content": "Hello there." },
      { "role": "assistant", "content": "Hi, I'm Claude. How can I help you?" },
      { "role": "user", "content": "Can you explain LLMs in plain English?" }
    ]
    ```

    Example with a partially-filled response from Claude:

    ```json
    [
      { "role": "user", "content": "Please describe yourself using only JSON" },
      { "role": "assistant", "content": "Here is my JSON description:\n{" }
    ]
    ```

    Each input message `content` may be either a single `string` or an array of
    content blocks, where each block has a specific `type`. Using a `string` is
    shorthand for an array of one content block of type `"text"`. The following
    input messages are equivalent:

    ```json
    { "role": "user", "content": "Hello, Claude" }
    ```

    ```json
    { "role": "user", "content": [{ "type": "text", "text": "Hello, Claude" }] }
    ```

    During beta, the Messages API only accepts content blocks of type `"text"`, and
    at most one block per message.

    See our
    [guide to prompt design](https://docs.anthropic.com/claude/docs/introduction-to-prompt-design)
    for more details on how to best construct prompts.
    """

    model: Required[str]
    """The model that will complete your prompt.

    As we improve Claude, we develop new versions of it that you can query. The
    `model` parameter controls which version of Claude responds to your request.
    Right now we offer two model families: Claude, and Claude Instant. You can use
    them by setting `model` to `"claude-2.1"` or `"claude-instant-1.2"`,
    respectively.

    See [models](https://docs.anthropic.com/claude/reference/selecting-a-model) for
    additional details and options.
    """

    metadata: Metadata
    """An object describing metadata about the request."""

    stop_sequences: List[str]
    """Custom text sequences that will cause the model to stop generating.

    Our models will normally stop when they have naturally completed their turn,
    which will result in a response `stop_reason` of `"end_turn"`.

    If you want the model to stop generating when it encounters custom strings of
    text, you can use the `stop_sequences` parameter. If the model encounters one of
    the custom sequences, the response `stop_reason` value will be `"stop_sequence"`
    and the response `stop_sequence` value will contain the matched stop sequence.
    """

    system: str
    """System prompt.

    A system prompt is a way of providing context and instructions to Claude, such
    as specifying a particular goal or role. See our
    [guide to system prompts](https://docs.anthropic.com/claude/docs/how-to-use-system-prompts).
    """

    temperature: float
    """Amount of randomness injected into the response.

    Defaults to 1. Ranges from 0 to 1. Use temp closer to 0 for analytical /
    multiple choice, and closer to 1 for creative and generative tasks.
    """

    top_k: int
    """Only sample from the top K options for each subsequent token.

    Used to remove "long tail" low probability responses.
    [Learn more technical details here](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277).
    """

    top_p: float
    """Use nucleus sampling.

    In nucleus sampling, we compute the cumulative distribution over all the options
    for each subsequent token in decreasing probability order and cut it off once it
    reaches a particular probability specified by `top_p`. You should either alter
    `temperature` or `top_p`, but not both.
    """


class Metadata(TypedDict, total=False):
    user_id: str
    """An external identifier for the user who is associated with the request.

    This should be a uuid, hash value, or other opaque identifier. Anthropic may use
    this id to help detect abuse. Do not include any identifying information such as
    name, email address, or phone number.
    """


class MessageCreateParamsNonStreaming(MessageCreateParamsBase):
    stream: Literal[False]
    """Whether to incrementally stream the response using server-sent events.

    See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
    details.
    """


class MessageCreateParamsStreaming(MessageCreateParamsBase):
    stream: Required[Literal[True]]
    """Whether to incrementally stream the response using server-sent events.

    See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
    details.
    """


MessageCreateParams = Union[MessageCreateParamsNonStreaming, MessageCreateParamsStreaming]
