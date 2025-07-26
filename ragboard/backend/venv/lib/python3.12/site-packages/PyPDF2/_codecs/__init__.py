from typing import Dict, List

from .adobe_glyphs import adobe_glyphs
from .pdfdoc import _pdfdoc_encoding
from .std import _std_encoding
from .symbol import _symbol_encoding
from .zapfding import _zapfding_encoding


def fill_from_encoding(enc: str) -> List[str]:
    lst: List[str] = []
    for x in range(256):
        try:
            lst += (bytes((x,)).decode(enc),)
        except Exception:
            lst += (chr(x),)
    return lst


def rev_encoding(enc: List[str]) -> Dict[str, int]:
    rev: Dict[str, int] = {}
    for i in range(256):
        char = enc[i]
        if char == "\u0000":
            continue
        assert char not in rev, (
            str(char) + " at " + str(i) + " already at " + str(rev[char])
        )
        rev[char] = i
    return rev


_win_encoding = fill_from_encoding("cp1252")
_mac_encoding = fill_from_encoding("mac_roman")


_win_encoding_rev: Dict[str, int] = rev_encoding(_win_encoding)
_mac_encoding_rev: Dict[str, int] = rev_encoding(_mac_encoding)
_symbol_encoding_rev: Dict[str, int] = rev_encoding(_symbol_encoding)
_zapfding_encoding_rev: Dict[str, int] = rev_encoding(_zapfding_encoding)
_pdfdoc_encoding_rev: Dict[str, int] = rev_encoding(_pdfdoc_encoding)


charset_encoding: Dict[str, List[str]] = {
    "/StandardCoding": _std_encoding,
    "/WinAnsiEncoding": _win_encoding,
    "/MacRomanEncoding": _mac_encoding,
    "/PDFDocEncoding": _pdfdoc_encoding,
    "/Symbol": _symbol_encoding,
    "/ZapfDingbats": _zapfding_encoding,
}

__all__ = [
    "adobe_glyphs",
    "_std_encoding",
    "_symbol_encoding",
    "_zapfding_encoding",
    "_pdfdoc_encoding",
    "_pdfdoc_encoding_rev",
    "_win_encoding",
    "_mac_encoding",
    "charset_encoding",
]
