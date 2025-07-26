from __future__ import annotations

import asyncio
from types import TracebackType
from typing import TYPE_CHECKING, Generic, TypeVar, Callable
from typing_extensions import Iterator, Awaitable, AsyncIterator, override, assert_never

import httpx

from ..._utils import consume_sync_iterator, consume_async_iterator
from ..._streaming import Stream, AsyncStream
from ...types.beta import Message, MessageStreamEvent
from ...types.beta.message import ContentBlock

if TYPE_CHECKING:
    from ..._client import Anthropic, AsyncAnthropic


class MessageStream(Stream[MessageStreamEvent]):
    text_stream: Iterator[str]
    """Iterator over just the text deltas in the stream.

    ```py
    for text in stream.text_stream:
        print(text, end="", flush=True)
    print()
    ```
    """

    def __init__(
        self,
        *,
        cast_to: type[MessageStreamEvent],
        response: httpx.Response,
        client: Anthropic,
    ) -> None:
        super().__init__(cast_to=cast_to, response=response, client=client)

        self.text_stream = self.__stream_text__()
        self.__final_message_snapshot: Message | None = None
        self.__events: list[MessageStreamEvent] = []

    def get_final_message(self) -> Message:
        """Waits until the stream has been read to completion and returns
        the accumulated `Message` object.
        """
        self.until_done()
        assert self.__final_message_snapshot is not None
        return self.__final_message_snapshot

    def get_final_text(self) -> str:
        """Returns all `text` content blocks concatenated together.

        > [!NOTE]
        > Currently the API will only respond with a single content block.

        Will raise an error if no `text` content blocks were returned.
        """
        message = self.get_final_message()
        text_blocks: list[str] = []
        for block in message.content:
            if block.type == "text":
                text_blocks.append(block.text)

        if not text_blocks:
            raise RuntimeError("Expected to have received at least 1 text block")

        return "".join(text_blocks)

    def until_done(self) -> None:
        """Blocks until the stream has been consumed"""
        consume_sync_iterator(self)

    @override
    def close(self) -> None:
        super().close()
        self.on_end()

    # properties
    @property
    def current_message_snapshot(self) -> Message:
        assert self.__final_message_snapshot is not None
        return self.__final_message_snapshot

    # event handlers
    def on_stream_event(self, event: MessageStreamEvent) -> None:
        """Callback that is fired for every Server-Sent-Event"""

    def on_message(self, message: Message) -> None:
        """Callback that is fired when a full Message object is accumulated.

        This corresponds to the `message_stop` SSE type.
        """

    def on_content_block(self, content_block: ContentBlock) -> None:
        """Callback that is fired whenever a full ContentBlock is accumulated.

        This corresponds to the `content_block_stop` SSE type.
        """

    def on_text(self, text: str, snapshot: str) -> None:
        """Callback that is fired whenever a `text` ContentBlock is yielded.

        The first argument is the text delta and the second is the current accumulated
        text, for example:

        ```py
        on_text("Hello", "Hello")
        on_text(" there", "Hello there")
        on_text("!", "Hello there!")
        ```
        """

    def on_exception(self, exception: Exception) -> None:
        """Fires if any exception occurs"""

    def on_end(self) -> None:
        ...

    def on_timeout(self) -> None:
        """Fires if the request times out"""

    @override
    def __stream__(self) -> Iterator[MessageStreamEvent]:
        try:
            for event in super().__stream__():
                self.__events.append(event)

                self.__final_message_snapshot = accumulate_event(
                    event=event,
                    current_snapshot=self.__final_message_snapshot,
                )
                self._emit_sse_event(event)

                yield event
        except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
            self.on_timeout()
            self.on_exception(exc)
            raise
        except Exception as exc:
            self.on_exception(exc)
            raise
        finally:
            self.on_end()

    def __stream_text__(self) -> Iterator[str]:
        for chunk in self:
            if chunk.type == "content_block_delta" and chunk.delta.type == "text_delta":
                yield chunk.delta.text

    def _emit_sse_event(self, event: MessageStreamEvent) -> None:
        self.on_stream_event(event)

        if event.type == "message_start":
            # nothing special we want to fire here
            pass
        elif event.type == "message_delta":
            # nothing special we want to fire here
            pass
        elif event.type == "message_stop":
            self.on_message(self.current_message_snapshot)
        elif event.type == "content_block_start":
            # nothing special we want to fire here
            pass
        elif event.type == "content_block_delta":
            content = self.current_message_snapshot.content[event.index]
            if event.delta.type == "text_delta" and content.type == "text":
                self.on_text(event.delta.text, content.text)
        elif event.type == "content_block_stop":
            content = self.current_message_snapshot.content[event.index]
            self.on_content_block(content)
        else:
            # we only want exhaustive checking for linters, not at runtime
            if TYPE_CHECKING:  # type: ignore[unreachable]
                assert_never(event)


MessageStreamT = TypeVar("MessageStreamT", bound=MessageStream)


class MessageStreamManager(Generic[MessageStreamT]):
    """Wrapper over MessageStream that is returned by `.stream()`.

    ```py
    with client.beta.messages.stream(...) as stream:
        for chunk in stream:
            ...
    ```
    """

    def __init__(self, api_request: Callable[[], MessageStreamT]) -> None:
        self.__stream: MessageStreamT | None = None
        self.__api_request = api_request

    def __enter__(self) -> MessageStreamT:
        self.__stream = self.__api_request()
        return self.__stream

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        if self.__stream is not None:
            self.__stream.close()


class AsyncMessageStream(AsyncStream[MessageStreamEvent]):
    text_stream: AsyncIterator[str]
    """Async iterator over just the text deltas in the stream.

    ```py
    async for text in stream.text_stream:
        print(text, end="", flush=True)
    print()
    ```
    """

    def __init__(
        self,
        *,
        cast_to: type[MessageStreamEvent],
        response: httpx.Response,
        client: AsyncAnthropic,
    ) -> None:
        super().__init__(cast_to=cast_to, response=response, client=client)

        self.text_stream = self.__stream_text__()
        self.__final_message_snapshot: Message | None = None
        self.__events: list[MessageStreamEvent] = []

    async def get_final_message(self) -> Message:
        """Waits until the stream has been read to completion and returns
        the accumulated `Message` object.
        """
        await self.until_done()
        assert self.__final_message_snapshot is not None
        return self.__final_message_snapshot

    async def get_final_text(self) -> str:
        """Returns all `text` content blocks concatenated together.

        > [!NOTE]
        > Currently the API will only respond with a single content block.

        Will raise an error if no `text` content blocks were returned.
        """
        message = await self.get_final_message()
        text_blocks: list[str] = []
        for block in message.content:
            if block.type == "text":
                text_blocks.append(block.text)

        if not text_blocks:
            raise RuntimeError("Expected to have received at least 1 text block")

        return "".join(text_blocks)

    async def until_done(self) -> None:
        """Waits until the stream has been consumed"""
        await consume_async_iterator(self)

    @override
    async def close(self) -> None:
        await super().close()
        await self.on_end()

    # properties
    @property
    def current_message_snapshot(self) -> Message:
        assert self.__final_message_snapshot is not None
        return self.__final_message_snapshot

    # event handlers
    async def on_stream_event(self, event: MessageStreamEvent) -> None:
        """Callback that is fired for every Server-Sent-Event"""

    async def on_message(self, message: Message) -> None:
        """Callback that is fired when a full Message object is accumulated.

        This corresponds to the `message_stop` SSE type.
        """

    async def on_content_block(self, content_block: ContentBlock) -> None:
        """Callback that is fired whenever a full ContentBlock is accumulated.

        This corresponds to the `content_block_stop` SSE type.
        """

    async def on_text(self, text: str, snapshot: str) -> None:
        """Callback that is fired whenever a `text` ContentBlock is yielded.

        The first argument is the text delta and the second is the current accumulated
        text, for example:

        ```
        on_text("Hello", "Hello")
        on_text(" there", "Hello there")
        on_text("!", "Hello there!")
        ```
        """

    async def on_final_text(self, text: str) -> None:
        """Callback that is fired whenever a full `text` ContentBlock is accumulated.

        This corresponds to the `content_block_stop` SSE type.
        """

    async def on_exception(self, exception: Exception) -> None:
        """Fires if any exception occurs"""

    async def on_end(self) -> None:
        ...

    async def on_timeout(self) -> None:
        """Fires if the request times out"""

    @override
    async def __stream__(self) -> AsyncIterator[MessageStreamEvent]:
        try:
            async for event in super().__stream__():
                self.__events.append(event)

                self.__final_message_snapshot = accumulate_event(
                    event=event,
                    current_snapshot=self.__final_message_snapshot,
                )
                await self._emit_sse_event(event)

                yield event
        except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
            await self.on_timeout()
            await self.on_exception(exc)
            raise
        except Exception as exc:
            await self.on_exception(exc)
            raise
        finally:
            await self.on_end()

    async def __stream_text__(self) -> AsyncIterator[str]:
        async for chunk in self:
            if chunk.type == "content_block_delta" and chunk.delta.type == "text_delta":
                yield chunk.delta.text

    async def _emit_sse_event(self, event: MessageStreamEvent) -> None:
        await self.on_stream_event(event)

        if event.type == "message_start":
            # nothing special we want to fire here
            pass
        elif event.type == "message_delta":
            # nothing special we want to fire here
            pass
        elif event.type == "message_stop":
            await self.on_message(self.current_message_snapshot)
        elif event.type == "content_block_start":
            # nothing special we want to fire here
            pass
        elif event.type == "content_block_delta":
            content = self.current_message_snapshot.content[event.index]
            if event.delta.type == "text_delta" and content.type == "text":
                await self.on_text(event.delta.text, content.text)
        elif event.type == "content_block_stop":
            content = self.current_message_snapshot.content[event.index]
            await self.on_content_block(content)

            if content.type == "text":
                await self.on_final_text(content.text)
        else:
            # we only want exhaustive checking for linters, not at runtime
            if TYPE_CHECKING:  # type: ignore[unreachable]
                assert_never(event)


AsyncMessageStreamT = TypeVar("AsyncMessageStreamT", bound=AsyncMessageStream)


class AsyncMessageStreamManager(Generic[AsyncMessageStreamT]):
    """Wrapper over AsyncMessageStream that is returned by `.stream()`
    so that an async context manager can be used without `await`ing the
    original client call.

    ```py
    async with client.beta.messages.stream(...) as stream:
        async for chunk in stream:
            ...
    ```
    """

    def __init__(self, api_request: Awaitable[AsyncMessageStreamT]) -> None:
        self.__stream: AsyncMessageStreamT | None = None
        self.__api_request = api_request

    async def __aenter__(self) -> AsyncMessageStreamT:
        self.__stream = await self.__api_request
        return self.__stream

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        if self.__stream is not None:
            await self.__stream.close()


def accumulate_event(*, event: MessageStreamEvent, current_snapshot: Message | None) -> Message:
    if current_snapshot is None:
        if event.type == "message_start":
            return event.message

        raise RuntimeError(f'Unexpected event order, got {event.type} before "message_start"')

    if event.type == "content_block_start":
        # TODO: check index
        current_snapshot.content.append(
            ContentBlock.construct(**event.content_block.model_dump()),
        )
    elif event.type == "content_block_delta":
        content = current_snapshot.content[event.index]
        content.text += event.delta.text
    elif event.type == "message_delta":
        current_snapshot.stop_reason = event.delta.stop_reason
        current_snapshot.stop_sequence = event.delta.stop_sequence

    return current_snapshot
