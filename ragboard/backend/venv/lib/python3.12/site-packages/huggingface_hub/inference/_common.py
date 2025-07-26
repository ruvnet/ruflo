# coding=utf-8
# Copyright 2023-present, the HuggingFace Inc. team.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Contains utilities used by both the sync and async inference clients."""

import base64
import io
import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import (
    TYPE_CHECKING,
    Any,
    AsyncIterable,
    BinaryIO,
    ContextManager,
    Dict,
    Generator,
    Iterable,
    List,
    Literal,
    NoReturn,
    Optional,
    Union,
    overload,
)

from requests import HTTPError

from huggingface_hub.errors import (
    GenerationError,
    IncompleteGenerationError,
    OverloadedError,
    TextGenerationError,
    UnknownError,
    ValidationError,
)

from ..utils import get_session, is_aiohttp_available, is_numpy_available, is_pillow_available
from ._generated.types import ChatCompletionStreamOutput, TextGenerationStreamOutput


if TYPE_CHECKING:
    from aiohttp import ClientResponse, ClientSession
    from PIL.Image import Image

# TYPES
UrlT = str
PathT = Union[str, Path]
BinaryT = Union[bytes, BinaryIO]
ContentT = Union[BinaryT, PathT, UrlT, "Image"]

# Use to set a Accept: image/png header
TASKS_EXPECTING_IMAGES = {"text-to-image", "image-to-image"}

logger = logging.getLogger(__name__)


@dataclass
class RequestParameters:
    url: str
    task: str
    model: Optional[str]
    json: Optional[Union[str, Dict, List]]
    data: Optional[ContentT]
    headers: Dict[str, Any]


# Add dataclass for ModelStatus. We use this dataclass in get_model_status function.
@dataclass
class ModelStatus:
    """
    This Dataclass represents the model status in the HF Inference API.

    Args:
        loaded (`bool`):
            If the model is currently loaded into HF's Inference API. Models
            are loaded on-demand, leading to the user's first request taking longer.
            If a model is loaded, you can be assured that it is in a healthy state.
        state (`str`):
            The current state of the model. This can be 'Loaded', 'Loadable', 'TooBig'.
            If a model's state is 'Loadable', it's not too big and has a supported
            backend. Loadable models are automatically loaded when the user first
            requests inference on the endpoint. This means it is transparent for the
            user to load a model, except that the first call takes longer to complete.
        compute_type (`Dict`):
            Information about the compute resource the model is using or will use, such as 'gpu' type and number of
            replicas.
        framework (`str`):
            The name of the framework that the model was built with, such as 'transformers'
            or 'text-generation-inference'.
    """

    loaded: bool
    state: str
    compute_type: Dict
    framework: str


## IMPORT UTILS


def _import_aiohttp():
    # Make sure `aiohttp` is installed on the machine.
    if not is_aiohttp_available():
        raise ImportError("Please install aiohttp to use `AsyncInferenceClient` (`pip install aiohttp`).")
    import aiohttp

    return aiohttp


def _import_numpy():
    """Make sure `numpy` is installed on the machine."""
    if not is_numpy_available():
        raise ImportError("Please install numpy to use deal with embeddings (`pip install numpy`).")
    import numpy

    return numpy


def _import_pil_image():
    """Make sure `PIL` is installed on the machine."""
    if not is_pillow_available():
        raise ImportError(
            "Please install Pillow to use deal with images (`pip install Pillow`). If you don't want the image to be"
            " post-processed, use `client.post(...)` and get the raw response from the server."
        )
    from PIL import Image

    return Image


## ENCODING / DECODING UTILS


@overload
def _open_as_binary(
    content: ContentT,
) -> ContextManager[BinaryT]: ...  # means "if input is not None, output is not None"


@overload
def _open_as_binary(
    content: Literal[None],
) -> ContextManager[Literal[None]]: ...  # means "if input is None, output is None"


@contextmanager  # type: ignore
def _open_as_binary(content: Optional[ContentT]) -> Generator[Optional[BinaryT], None, None]:
    """Open `content` as a binary file, either from a URL, a local path, or raw bytes.

    Do nothing if `content` is None,

    TODO: handle base64 as input
    """
    # If content is a string => must be either a URL or a path
    if isinstance(content, str):
        if content.startswith("https://") or content.startswith("http://"):
            logger.debug(f"Downloading content from {content}")
            yield get_session().get(content).content  # TODO: retrieve as stream and pipe to post request ?
            return
        content = Path(content)
        if not content.exists():
            raise FileNotFoundError(
                f"File not found at {content}. If `data` is a string, it must either be a URL or a path to a local"
                " file. To pass raw content, please encode it as bytes first."
            )

    # If content is a Path => open it
    if isinstance(content, Path):
        logger.debug(f"Opening content from {content}")
        with content.open("rb") as f:
            yield f
    elif hasattr(content, "save"):  # PIL Image
        logger.debug("Converting PIL Image to bytes")
        buffer = io.BytesIO()
        content.save(buffer, format="PNG")
        buffer.seek(0)
        yield buffer
    else:
        # Otherwise: already a file-like object or None
        yield content


def _b64_encode(content: ContentT) -> str:
    """Encode a raw file (image, audio) into base64. Can be bytes, an opened file, a path or a URL."""
    with _open_as_binary(content) as data:
        data_as_bytes = data if isinstance(data, bytes) else data.read()
        return base64.b64encode(data_as_bytes).decode()


def _b64_to_image(encoded_image: str) -> "Image":
    """Parse a base64-encoded string into a PIL Image."""
    Image = _import_pil_image()
    return Image.open(io.BytesIO(base64.b64decode(encoded_image)))


def _bytes_to_list(content: bytes) -> List:
    """Parse bytes from a Response object into a Python list.

    Expects the response body to be JSON-encoded data.

    NOTE: This is exactly the same implementation as `_bytes_to_dict` and will not complain if the returned data is a
    dictionary. The only advantage of having both is to help the user (and mypy) understand what kind of data to expect.
    """
    return json.loads(content.decode())


def _bytes_to_dict(content: bytes) -> Dict:
    """Parse bytes from a Response object into a Python dictionary.

    Expects the response body to be JSON-encoded data.

    NOTE: This is exactly the same implementation as `_bytes_to_list` and will not complain if the returned data is a
    list. The only advantage of having both is to help the user (and mypy) understand what kind of data to expect.
    """
    return json.loads(content.decode())


def _bytes_to_image(content: bytes) -> "Image":
    """Parse bytes from a Response object into a PIL Image.

    Expects the response body to be raw bytes. To deal with b64 encoded images, use `_b64_to_image` instead.
    """
    Image = _import_pil_image()
    return Image.open(io.BytesIO(content))


def _as_dict(response: Union[bytes, Dict]) -> Dict:
    return json.loads(response) if isinstance(response, bytes) else response


## PAYLOAD UTILS


## STREAMING UTILS


def _stream_text_generation_response(
    bytes_output_as_lines: Iterable[bytes], details: bool
) -> Union[Iterable[str], Iterable[TextGenerationStreamOutput]]:
    """Used in `InferenceClient.text_generation`."""
    # Parse ServerSentEvents
    for byte_payload in bytes_output_as_lines:
        try:
            output = _format_text_generation_stream_output(byte_payload, details)
        except StopIteration:
            break
        if output is not None:
            yield output


async def _async_stream_text_generation_response(
    bytes_output_as_lines: AsyncIterable[bytes], details: bool
) -> Union[AsyncIterable[str], AsyncIterable[TextGenerationStreamOutput]]:
    """Used in `AsyncInferenceClient.text_generation`."""
    # Parse ServerSentEvents
    async for byte_payload in bytes_output_as_lines:
        try:
            output = _format_text_generation_stream_output(byte_payload, details)
        except StopIteration:
            break
        if output is not None:
            yield output


def _format_text_generation_stream_output(
    byte_payload: bytes, details: bool
) -> Optional[Union[str, TextGenerationStreamOutput]]:
    if not byte_payload.startswith(b"data:"):
        return None  # empty line

    if byte_payload.strip() == b"data: [DONE]":
        raise StopIteration("[DONE] signal received.")

    # Decode payload
    payload = byte_payload.decode("utf-8")
    json_payload = json.loads(payload.lstrip("data:").rstrip("/n"))

    # Either an error as being returned
    if json_payload.get("error") is not None:
        raise _parse_text_generation_error(json_payload["error"], json_payload.get("error_type"))

    # Or parse token payload
    output = TextGenerationStreamOutput.parse_obj_as_instance(json_payload)
    return output.token.text if not details else output


def _stream_chat_completion_response(
    bytes_lines: Iterable[bytes],
) -> Iterable[ChatCompletionStreamOutput]:
    """Used in `InferenceClient.chat_completion` if model is served with TGI."""
    for item in bytes_lines:
        try:
            output = _format_chat_completion_stream_output(item)
        except StopIteration:
            break
        if output is not None:
            yield output


async def _async_stream_chat_completion_response(
    bytes_lines: AsyncIterable[bytes],
) -> AsyncIterable[ChatCompletionStreamOutput]:
    """Used in `AsyncInferenceClient.chat_completion`."""
    async for item in bytes_lines:
        try:
            output = _format_chat_completion_stream_output(item)
        except StopIteration:
            break
        if output is not None:
            yield output


def _format_chat_completion_stream_output(
    byte_payload: bytes,
) -> Optional[ChatCompletionStreamOutput]:
    if not byte_payload.startswith(b"data:"):
        return None  # empty line

    if byte_payload.strip() == b"data: [DONE]":
        raise StopIteration("[DONE] signal received.")

    # Decode payload
    payload = byte_payload.decode("utf-8")
    json_payload = json.loads(payload.lstrip("data:").rstrip("/n"))

    # Either an error as being returned
    if json_payload.get("error") is not None:
        raise _parse_text_generation_error(json_payload["error"], json_payload.get("error_type"))

    # Or parse token payload
    return ChatCompletionStreamOutput.parse_obj_as_instance(json_payload)


async def _async_yield_from(client: "ClientSession", response: "ClientResponse") -> AsyncIterable[bytes]:
    try:
        async for byte_payload in response.content:
            yield byte_payload.strip()
    finally:
        # Always close the underlying HTTP session to avoid resource leaks
        await client.close()


# "TGI servers" are servers running with the `text-generation-inference` backend.
# This backend is the go-to solution to run large language models at scale. However,
# for some smaller models (e.g. "gpt2") the default `transformers` + `api-inference`
# solution is still in use.
#
# Both approaches have very similar APIs, but not exactly the same. What we do first in
# the `text_generation` method is to assume the model is served via TGI. If we realize
# it's not the case (i.e. we receive an HTTP 400 Bad Request), we fallback to the
# default API with a warning message. When that's the case, We remember the unsupported
# attributes for this model in the `_UNSUPPORTED_TEXT_GENERATION_KWARGS` global variable.
#
# In addition, TGI servers have a built-in API route for chat-completion, which is not
# available on the default API. We use this route to provide a more consistent behavior
# when available.
#
# For more details, see https://github.com/huggingface/text-generation-inference and
# https://huggingface.co/docs/api-inference/detailed_parameters#text-generation-task.

_UNSUPPORTED_TEXT_GENERATION_KWARGS: Dict[Optional[str], List[str]] = {}


def _set_unsupported_text_generation_kwargs(model: Optional[str], unsupported_kwargs: List[str]) -> None:
    _UNSUPPORTED_TEXT_GENERATION_KWARGS.setdefault(model, []).extend(unsupported_kwargs)


def _get_unsupported_text_generation_kwargs(model: Optional[str]) -> List[str]:
    return _UNSUPPORTED_TEXT_GENERATION_KWARGS.get(model, [])


# TEXT GENERATION ERRORS
# ----------------------
# Text-generation errors are parsed separately to handle as much as possible the errors returned by the text generation
# inference project (https://github.com/huggingface/text-generation-inference).
# ----------------------


def raise_text_generation_error(http_error: HTTPError) -> NoReturn:
    """
    Try to parse text-generation-inference error message and raise HTTPError in any case.

    Args:
        error (`HTTPError`):
            The HTTPError that have been raised.
    """
    # Try to parse a Text Generation Inference error

    try:
        # Hacky way to retrieve payload in case of aiohttp error
        payload = getattr(http_error, "response_error_payload", None) or http_error.response.json()
        error = payload.get("error")
        error_type = payload.get("error_type")
    except Exception:  # no payload
        raise http_error

    # If error_type => more information than `hf_raise_for_status`
    if error_type is not None:
        exception = _parse_text_generation_error(error, error_type)
        raise exception from http_error

    # Otherwise, fallback to default error
    raise http_error


def _parse_text_generation_error(error: Optional[str], error_type: Optional[str]) -> TextGenerationError:
    if error_type == "generation":
        return GenerationError(error)  # type: ignore
    if error_type == "incomplete_generation":
        return IncompleteGenerationError(error)  # type: ignore
    if error_type == "overloaded":
        return OverloadedError(error)  # type: ignore
    if error_type == "validation":
        return ValidationError(error)  # type: ignore
    return UnknownError(error)  # type: ignore
