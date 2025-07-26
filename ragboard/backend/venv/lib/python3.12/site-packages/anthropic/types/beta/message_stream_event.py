# File generated from our OpenAPI spec by Stainless.

from typing import Union

from .message_stop_event import MessageStopEvent
from .message_delta_event import MessageDeltaEvent
from .message_start_event import MessageStartEvent
from .content_block_stop_event import ContentBlockStopEvent
from .content_block_delta_event import ContentBlockDeltaEvent
from .content_block_start_event import ContentBlockStartEvent

__all__ = ["MessageStreamEvent"]

MessageStreamEvent = Union[
    MessageStartEvent,
    MessageDeltaEvent,
    MessageStopEvent,
    ContentBlockStartEvent,
    ContentBlockDeltaEvent,
    ContentBlockStopEvent,
]
