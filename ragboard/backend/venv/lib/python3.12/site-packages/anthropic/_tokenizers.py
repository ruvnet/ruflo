from __future__ import annotations

from typing import TYPE_CHECKING, cast
from pathlib import Path

from anyio import Path as AsyncPath

# tokenizers is untyped, https://github.com/huggingface/tokenizers/issues/811
# note: this comment affects the entire file
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false
if TYPE_CHECKING:
    # we only import this at the type-level as deferring the import
    # avoids issues like this: https://github.com/anthropics/anthropic-sdk-python/issues/280
    from tokenizers import Tokenizer as TokenizerType  # type: ignore[import]
else:
    TokenizerType = None


def _get_tokenizer_cache_path() -> Path:
    return Path(__file__).parent / "tokenizer.json"


_tokenizer: TokenizerType | None = None


def _load_tokenizer(raw: str) -> TokenizerType:
    global _tokenizer

    from tokenizers import Tokenizer

    _tokenizer = cast(TokenizerType, Tokenizer.from_str(raw))
    return _tokenizer


def sync_get_tokenizer() -> TokenizerType:
    if _tokenizer is not None:
        return _tokenizer

    tokenizer_path = _get_tokenizer_cache_path()
    text = tokenizer_path.read_text(encoding="utf-8")
    return _load_tokenizer(text)


async def async_get_tokenizer() -> TokenizerType:
    if _tokenizer is not None:
        return _tokenizer

    tokenizer_path = AsyncPath(_get_tokenizer_cache_path())
    text = await tokenizer_path.read_text(encoding="utf-8")
    return _load_tokenizer(text)
