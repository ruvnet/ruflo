from __future__ import annotations

from collections.abc import Iterable
from contextlib import contextmanager
import logging
import sys
import textwrap
from typing import Iterator
from typing import Optional
from typing import TextIO
from typing import Union
import warnings

from sqlalchemy.engine import url

from . import sqla_compat

log = logging.getLogger(__name__)

# disable "no handler found" errors
logging.getLogger("alembic").addHandler(logging.NullHandler())


try:
    import fcntl
    import termios
    import struct

    ioctl = fcntl.ioctl(0, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0))
    _h, TERMWIDTH, _hp, _wp = struct.unpack("HHHH", ioctl)
    if TERMWIDTH <= 0:  # can occur if running in emacs pseudo-tty
        TERMWIDTH = None
except (ImportError, OSError):
    TERMWIDTH = None


def write_outstream(
    stream: TextIO, *text: Union[str, bytes], quiet: bool = False
) -> None:
    if quiet:
        return
    encoding = getattr(stream, "encoding", "ascii") or "ascii"
    for t in text:
        if not isinstance(t, bytes):
            t = t.encode(encoding, "replace")
        t = t.decode(encoding)
        try:
            stream.write(t)
        except OSError:
            # suppress "broken pipe" errors.
            # no known way to handle this on Python 3 however
            # as the exception is "ignored" (noisily) in TextIOWrapper.
            break


@contextmanager
def status(
    status_msg: str, newline: bool = False, quiet: bool = False
) -> Iterator[None]:
    msg(status_msg + " ...", newline, flush=True, quiet=quiet)
    try:
        yield
    except:
        if not quiet:
            write_outstream(sys.stdout, "  FAILED\n")
        raise
    else:
        if not quiet:
            write_outstream(sys.stdout, "  done\n")


def err(message: str, quiet: bool = False) -> None:
    log.error(message)
    msg(f"FAILED: {message}", quiet=quiet)
    sys.exit(-1)


def obfuscate_url_pw(input_url: str) -> str:
    u = url.make_url(input_url)
    return sqla_compat.url_render_as_string(u, hide_password=True)  # type: ignore  # noqa: E501


def warn(msg: str, stacklevel: int = 2) -> None:
    warnings.warn(msg, UserWarning, stacklevel=stacklevel)


def msg(
    msg: str, newline: bool = True, flush: bool = False, quiet: bool = False
) -> None:
    if quiet:
        return
    if TERMWIDTH is None:
        write_outstream(sys.stdout, msg)
        if newline:
            write_outstream(sys.stdout, "\n")
    else:
        # left indent output lines
        lines = textwrap.wrap(msg, TERMWIDTH)
        if len(lines) > 1:
            for line in lines[0:-1]:
                write_outstream(sys.stdout, "  ", line, "\n")
        write_outstream(sys.stdout, "  ", lines[-1], ("\n" if newline else ""))
    if flush:
        sys.stdout.flush()


def format_as_comma(value: Optional[Union[str, Iterable[str]]]) -> str:
    if value is None:
        return ""
    elif isinstance(value, str):
        return value
    elif isinstance(value, Iterable):
        return ", ".join(value)
    else:
        raise ValueError("Don't know how to comma-format %r" % value)
