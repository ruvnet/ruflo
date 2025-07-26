import codecs
from typing import Dict, List, Tuple, Union

from .._codecs import _pdfdoc_encoding
from .._utils import StreamType, b_, logger_warning, read_non_whitespace
from ..errors import STREAM_TRUNCATED_PREMATURELY, PdfStreamError
from ._base import ByteStringObject, TextStringObject


def hex_to_rgb(value: str) -> Tuple[float, float, float]:
    return tuple(int(value.lstrip("#")[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore


def read_hex_string_from_stream(
    stream: StreamType,
    forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
) -> Union["TextStringObject", "ByteStringObject"]:
    stream.read(1)
    txt = ""
    x = b""
    while True:
        tok = read_non_whitespace(stream)
        if not tok:
            raise PdfStreamError(STREAM_TRUNCATED_PREMATURELY)
        if tok == b">":
            break
        x += tok
        if len(x) == 2:
            txt += chr(int(x, base=16))
            x = b""
    if len(x) == 1:
        x += b"0"
    if len(x) == 2:
        txt += chr(int(x, base=16))
    return create_string_object(b_(txt), forced_encoding)


def read_string_from_stream(
    stream: StreamType,
    forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
) -> Union["TextStringObject", "ByteStringObject"]:
    tok = stream.read(1)
    parens = 1
    txt = []
    while True:
        tok = stream.read(1)
        if not tok:
            raise PdfStreamError(STREAM_TRUNCATED_PREMATURELY)
        if tok == b"(":
            parens += 1
        elif tok == b")":
            parens -= 1
            if parens == 0:
                break
        elif tok == b"\\":
            tok = stream.read(1)
            escape_dict = {
                b"n": b"\n",
                b"r": b"\r",
                b"t": b"\t",
                b"b": b"\b",
                b"f": b"\f",
                b"c": rb"\c",
                b"(": b"(",
                b")": b")",
                b"/": b"/",
                b"\\": b"\\",
                b" ": b" ",
                b"%": b"%",
                b"<": b"<",
                b">": b">",
                b"[": b"[",
                b"]": b"]",
                b"#": b"#",
                b"_": b"_",
                b"&": b"&",
                b"$": b"$",
            }
            try:
                tok = escape_dict[tok]
            except KeyError:
                if b"0" <= tok and tok <= b"7":
                    # "The number ddd may consist of one, two, or three
                    # octal digits; high-order overflow shall be ignored.
                    # Three octal digits shall be used, with leading zeros
                    # as needed, if the next character of the string is also
                    # a digit." (PDF reference 7.3.4.2, p 16)
                    for _ in range(2):
                        ntok = stream.read(1)
                        if b"0" <= ntok and ntok <= b"7":
                            tok += ntok
                        else:
                            stream.seek(-1, 1)  # ntok has to be analysed
                            break
                    tok = b_(chr(int(tok, base=8)))
                elif tok in b"\n\r":
                    # This case is  hit when a backslash followed by a line
                    # break occurs.  If it's a multi-char EOL, consume the
                    # second character:
                    tok = stream.read(1)
                    if tok not in b"\n\r":
                        stream.seek(-1, 1)
                    # Then don't add anything to the actual string, since this
                    # line break was escaped:
                    tok = b""
                else:
                    msg = rf"Unexpected escaped string: {tok.decode('utf8')}"
                    logger_warning(msg, __name__)
        txt.append(tok)
    return create_string_object(b"".join(txt), forced_encoding)


def create_string_object(
    string: Union[str, bytes],
    forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
) -> Union[TextStringObject, ByteStringObject]:
    """
    Create a ByteStringObject or a TextStringObject from a string to represent the string.

    :param Union[str, bytes] string: A string

    :raises TypeError: If string is not of type str or bytes.
    """
    if isinstance(string, str):
        return TextStringObject(string)
    elif isinstance(string, bytes):
        if isinstance(forced_encoding, (list, dict)):
            out = ""
            for x in string:
                try:
                    out += forced_encoding[x]
                except Exception:
                    out += bytes((x,)).decode("charmap")
            return TextStringObject(out)
        elif isinstance(forced_encoding, str):
            if forced_encoding == "bytes":
                return ByteStringObject(string)
            return TextStringObject(string.decode(forced_encoding))
        else:
            try:
                if string.startswith(codecs.BOM_UTF16_BE):
                    retval = TextStringObject(string.decode("utf-16"))
                    retval.autodetect_utf16 = True
                    return retval
                else:
                    # This is probably a big performance hit here, but we need to
                    # convert string objects into the text/unicode-aware version if
                    # possible... and the only way to check if that's possible is
                    # to try.  Some strings are strings, some are just byte arrays.
                    retval = TextStringObject(decode_pdfdocencoding(string))
                    retval.autodetect_pdfdocencoding = True
                    return retval
            except UnicodeDecodeError:
                return ByteStringObject(string)
    else:
        raise TypeError("create_string_object should have str or unicode arg")


def decode_pdfdocencoding(byte_array: bytes) -> str:
    retval = ""
    for b in byte_array:
        c = _pdfdoc_encoding[b]
        if c == "\u0000":
            raise UnicodeDecodeError(
                "pdfdocencoding",
                bytearray(b),
                -1,
                -1,
                "does not exist in translation table",
            )
        retval += c
    return retval
