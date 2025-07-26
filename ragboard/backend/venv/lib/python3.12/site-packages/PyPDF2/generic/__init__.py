# Copyright (c) 2006, Mathieu Fenniak
# All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are
# met:
#
# * Redistributions of source code must retain the above copyright notice,
# this list of conditions and the following disclaimer.
# * Redistributions in binary form must reproduce the above copyright notice,
# this list of conditions and the following disclaimer in the documentation
# and/or other materials provided with the distribution.
# * The name of the author may not be used to endorse or promote products
# derived from this software without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.

"""Implementation of generic PDF objects (dictionary, number, string, ...)."""
__author__ = "Mathieu Fenniak"
__author_email__ = "biziqe@mathieu.fenniak.net"

from typing import Dict, List, Union

from .._utils import StreamType, deprecate_with_replacement
from ..constants import OutlineFontFlag
from ._annotations import AnnotationBuilder
from ._base import (
    BooleanObject,
    ByteStringObject,
    FloatObject,
    IndirectObject,
    NameObject,
    NullObject,
    NumberObject,
    PdfObject,
    TextStringObject,
    encode_pdfdocencoding,
)
from ._data_structures import (
    ArrayObject,
    ContentStream,
    DecodedStreamObject,
    Destination,
    DictionaryObject,
    EncodedStreamObject,
    Field,
    StreamObject,
    TreeObject,
    read_object,
)
from ._fit import Fit
from ._outline import Bookmark, OutlineItem
from ._rectangle import RectangleObject
from ._utils import (
    create_string_object,
    decode_pdfdocencoding,
    hex_to_rgb,
    read_hex_string_from_stream,
    read_string_from_stream,
)


def readHexStringFromStream(
    stream: StreamType,
) -> Union["TextStringObject", "ByteStringObject"]:  # pragma: no cover
    deprecate_with_replacement(
        "readHexStringFromStream", "read_hex_string_from_stream", "4.0.0"
    )
    return read_hex_string_from_stream(stream)


def readStringFromStream(
    stream: StreamType,
    forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
) -> Union["TextStringObject", "ByteStringObject"]:  # pragma: no cover
    deprecate_with_replacement(
        "readStringFromStream", "read_string_from_stream", "4.0.0"
    )
    return read_string_from_stream(stream, forced_encoding)


def createStringObject(
    string: Union[str, bytes],
    forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
) -> Union[TextStringObject, ByteStringObject]:  # pragma: no cover
    deprecate_with_replacement("createStringObject", "create_string_object", "4.0.0")
    return create_string_object(string, forced_encoding)


PAGE_FIT = Fit.fit()


__all__ = [
    # Base types
    "BooleanObject",
    "FloatObject",
    "NumberObject",
    "NameObject",
    "IndirectObject",
    "NullObject",
    "PdfObject",
    "TextStringObject",
    "ByteStringObject",
    # Annotations
    "AnnotationBuilder",
    # Fit
    "Fit",
    "PAGE_FIT",
    # Data structures
    "ArrayObject",
    "DictionaryObject",
    "TreeObject",
    "StreamObject",
    "DecodedStreamObject",
    "EncodedStreamObject",
    "ContentStream",
    "RectangleObject",
    "Field",
    "Destination",
    # --- More specific stuff
    # Outline
    "OutlineItem",
    "OutlineFontFlag",
    "Bookmark",
    # Data structures core functions
    "read_object",
    # Utility functions
    "create_string_object",
    "encode_pdfdocencoding",
    "decode_pdfdocencoding",
    "hex_to_rgb",
    "read_hex_string_from_stream",
    "read_string_from_stream",
]
