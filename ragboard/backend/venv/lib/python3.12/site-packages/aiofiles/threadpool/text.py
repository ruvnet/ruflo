from ..base import AsyncBase, AsyncIndirectBase
from .utils import delegate_to_executor, proxy_method_directly, proxy_property_directly


@delegate_to_executor(
    "close",
    "flush",
    "isatty",
    "read",
    "readable",
    "readline",
    "readlines",
    "seek",
    "seekable",
    "tell",
    "truncate",
    "write",
    "writable",
    "writelines",
)
@proxy_method_directly("detach", "fileno", "readable")
@proxy_property_directly(
    "buffer",
    "closed",
    "encoding",
    "errors",
    "line_buffering",
    "newlines",
    "name",
    "mode",
)
class AsyncTextIOWrapper(AsyncBase):
    """The asyncio executor version of io.TextIOWrapper."""


@delegate_to_executor(
    "close",
    "flush",
    "isatty",
    "read",
    "readable",
    "readline",
    "readlines",
    "seek",
    "seekable",
    "tell",
    "truncate",
    "write",
    "writable",
    "writelines",
)
@proxy_method_directly("detach", "fileno", "readable")
@proxy_property_directly(
    "buffer",
    "closed",
    "encoding",
    "errors",
    "line_buffering",
    "newlines",
    "name",
    "mode",
)
class AsyncTextIndirectIOWrapper(AsyncIndirectBase):
    """The indirect asyncio executor version of io.TextIOWrapper."""
