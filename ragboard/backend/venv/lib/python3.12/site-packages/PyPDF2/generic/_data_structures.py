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


__author__ = "Mathieu Fenniak"
__author_email__ = "biziqe@mathieu.fenniak.net"

import logging
import re
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union, cast

from .._protocols import PdfWriterProtocol
from .._utils import (
    WHITESPACES,
    StreamType,
    b_,
    deprecate_with_replacement,
    deprecation_with_replacement,
    hex_str,
    logger_warning,
    read_non_whitespace,
    read_until_regex,
    skip_over_comment,
)
from ..constants import (
    CheckboxRadioButtonAttributes,
    FieldDictionaryAttributes,
)
from ..constants import FilterTypes as FT
from ..constants import OutlineFontFlag
from ..constants import StreamAttributes as SA
from ..constants import TypArguments as TA
from ..constants import TypFitArguments as TF
from ..errors import STREAM_TRUNCATED_PREMATURELY, PdfReadError, PdfStreamError
from ._base import (
    BooleanObject,
    FloatObject,
    IndirectObject,
    NameObject,
    NullObject,
    NumberObject,
    PdfObject,
    TextStringObject,
)
from ._fit import Fit
from ._utils import read_hex_string_from_stream, read_string_from_stream

logger = logging.getLogger(__name__)
NumberSigns = b"+-"
IndirectPattern = re.compile(rb"[+-]?(\d+)\s+(\d+)\s+R[^a-zA-Z]")


class ArrayObject(list, PdfObject):
    def clone(
        self,
        pdf_dest: PdfWriterProtocol,
        force_duplicate: bool = False,
        ignore_fields: Union[Tuple[str, ...], List[str], None] = (),
    ) -> "ArrayObject":
        """clone object into pdf_dest"""
        try:
            if self.indirect_reference.pdf == pdf_dest and not force_duplicate:  # type: ignore
                return self
        except Exception:
            pass
        arr = cast("ArrayObject", self._reference_clone(ArrayObject(), pdf_dest))
        for data in self:
            if isinstance(data, StreamObject):
                # if not hasattr(data, "indirect_reference"):
                #    data.indirect_reference = None
                dup = data._reference_clone(
                    data.clone(pdf_dest, force_duplicate, ignore_fields), pdf_dest
                )
                arr.append(dup.indirect_reference)
            elif hasattr(data, "clone"):
                arr.append(data.clone(pdf_dest, force_duplicate, ignore_fields))
            else:
                arr.append(data)
        return cast("ArrayObject", arr)

    def items(self) -> Iterable[Any]:
        """
        Emulate DictionaryObject.items for a list
        (index, object)
        """
        return enumerate(self)

    def write_to_stream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:
        stream.write(b"[")
        for data in self:
            stream.write(b" ")
            data.write_to_stream(stream, encryption_key)
        stream.write(b" ]")

    def writeToStream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:  # pragma: no cover
        deprecation_with_replacement("writeToStream", "write_to_stream", "3.0.0")
        self.write_to_stream(stream, encryption_key)

    @staticmethod
    def read_from_stream(
        stream: StreamType,
        pdf: Any,
        forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
    ) -> "ArrayObject":  # PdfReader
        arr = ArrayObject()
        tmp = stream.read(1)
        if tmp != b"[":
            raise PdfReadError("Could not read array")
        while True:
            # skip leading whitespace
            tok = stream.read(1)
            while tok.isspace():
                tok = stream.read(1)
            stream.seek(-1, 1)
            # check for array ending
            peekahead = stream.read(1)
            if peekahead == b"]":
                break
            stream.seek(-1, 1)
            # read and append obj
            arr.append(read_object(stream, pdf, forced_encoding))
        return arr

    @staticmethod
    def readFromStream(
        stream: StreamType, pdf: Any  # PdfReader
    ) -> "ArrayObject":  # pragma: no cover
        deprecation_with_replacement("readFromStream", "read_from_stream", "3.0.0")
        return ArrayObject.read_from_stream(stream, pdf)


class DictionaryObject(dict, PdfObject):
    def clone(
        self,
        pdf_dest: PdfWriterProtocol,
        force_duplicate: bool = False,
        ignore_fields: Union[Tuple[str, ...], List[str], None] = (),
    ) -> "DictionaryObject":
        """clone object into pdf_dest"""
        try:
            if self.indirect_reference.pdf == pdf_dest and not force_duplicate:  # type: ignore
                return self
        except Exception:
            pass

        d__ = cast(
            "DictionaryObject", self._reference_clone(self.__class__(), pdf_dest)
        )
        if ignore_fields is None:
            ignore_fields = []
        if len(d__.keys()) == 0:
            d__._clone(self, pdf_dest, force_duplicate, ignore_fields)
        return d__

    def _clone(
        self,
        src: "DictionaryObject",
        pdf_dest: PdfWriterProtocol,
        force_duplicate: bool,
        ignore_fields: Union[Tuple[str, ...], List[str]],
    ) -> None:
        """update the object from src"""
        #  First check if this is a chain list, we need to loop to prevent recur
        if (
            ("/Next" not in ignore_fields and "/Next" in src)
            or ("/Prev" not in ignore_fields and "/Prev" in src)
        ) or (
            ("/N" not in ignore_fields and "/N" in src)
            or ("/V" not in ignore_fields and "/V" in src)
        ):
            ignore_fields = list(ignore_fields)
            for lst in (("/Next", "/Prev"), ("/N", "/V")):
                for k in lst:
                    objs = []
                    if (
                        k in src
                        and k not in self
                        and isinstance(src.raw_get(k), IndirectObject)
                    ):
                        cur_obj: Optional["DictionaryObject"] = cast(
                            "DictionaryObject", src[k]
                        )
                        prev_obj: Optional["DictionaryObject"] = self
                        while cur_obj is not None:
                            clon = cast(
                                "DictionaryObject",
                                cur_obj._reference_clone(cur_obj.__class__(), pdf_dest),
                            )
                            objs.append((cur_obj, clon))
                            assert prev_obj is not None
                            prev_obj[NameObject(k)] = clon.indirect_reference
                            prev_obj = clon
                            try:
                                if cur_obj == src:
                                    cur_obj = None
                                else:
                                    cur_obj = cast("DictionaryObject", cur_obj[k])
                            except Exception:
                                cur_obj = None
                        for (s, c) in objs:
                            c._clone(s, pdf_dest, force_duplicate, ignore_fields + [k])

        for k, v in src.items():
            if k not in ignore_fields:
                if isinstance(v, StreamObject):
                    if not hasattr(v, "indirect_reference"):
                        v.indirect_reference = None
                    vv = v.clone(pdf_dest, force_duplicate, ignore_fields)
                    assert vv.indirect_reference is not None
                    self[k.clone(pdf_dest)] = vv.indirect_reference  # type: ignore[attr-defined]
                else:
                    if k not in self:
                        self[NameObject(k)] = (
                            v.clone(pdf_dest, force_duplicate, ignore_fields)
                            if hasattr(v, "clone")
                            else v
                        )

    def raw_get(self, key: Any) -> Any:
        return dict.__getitem__(self, key)

    def __setitem__(self, key: Any, value: Any) -> Any:
        if not isinstance(key, PdfObject):
            raise ValueError("key must be PdfObject")
        if not isinstance(value, PdfObject):
            raise ValueError("value must be PdfObject")
        return dict.__setitem__(self, key, value)

    def setdefault(self, key: Any, value: Optional[Any] = None) -> Any:
        if not isinstance(key, PdfObject):
            raise ValueError("key must be PdfObject")
        if not isinstance(value, PdfObject):
            raise ValueError("value must be PdfObject")
        return dict.setdefault(self, key, value)  # type: ignore

    def __getitem__(self, key: Any) -> PdfObject:
        return dict.__getitem__(self, key).get_object()

    @property
    def xmp_metadata(self) -> Optional[PdfObject]:
        """
        Retrieve XMP (Extensible Metadata Platform) data relevant to the
        this object, if available.

        Stability: Added in v1.12, will exist for all future v1.x releases.
        @return Returns a {@link #xmp.XmpInformation XmlInformation} instance
        that can be used to access XMP metadata from the document.  Can also
        return None if no metadata was found on the document root.
        """
        from ..xmp import XmpInformation

        metadata = self.get("/Metadata", None)
        if metadata is None:
            return None
        metadata = metadata.get_object()

        if not isinstance(metadata, XmpInformation):
            metadata = XmpInformation(metadata)
            self[NameObject("/Metadata")] = metadata
        return metadata

    def getXmpMetadata(
        self,
    ) -> Optional[PdfObject]:  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :meth:`xmp_metadata` instead.
        """
        deprecation_with_replacement("getXmpMetadata", "xmp_metadata", "3.0.0")
        return self.xmp_metadata

    @property
    def xmpMetadata(self) -> Optional[PdfObject]:  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :meth:`xmp_metadata` instead.
        """
        deprecation_with_replacement("xmpMetadata", "xmp_metadata", "3.0.0")
        return self.xmp_metadata

    def write_to_stream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:
        stream.write(b"<<\n")
        for key, value in list(self.items()):
            key.write_to_stream(stream, encryption_key)
            stream.write(b" ")
            value.write_to_stream(stream, encryption_key)
            stream.write(b"\n")
        stream.write(b">>")

    def writeToStream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:  # pragma: no cover
        deprecation_with_replacement("writeToStream", "write_to_stream", "3.0.0")
        self.write_to_stream(stream, encryption_key)

    @staticmethod
    def read_from_stream(
        stream: StreamType,
        pdf: Any,  # PdfReader
        forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
    ) -> "DictionaryObject":
        def get_next_obj_pos(
            p: int, p1: int, rem_gens: List[int], pdf: Any
        ) -> int:  # PdfReader
            l = pdf.xref[rem_gens[0]]
            for o in l:
                if p1 > l[o] and p < l[o]:
                    p1 = l[o]
            if len(rem_gens) == 1:
                return p1
            else:
                return get_next_obj_pos(p, p1, rem_gens[1:], pdf)

        def read_unsized_from_steam(stream: StreamType, pdf: Any) -> bytes:  # PdfReader
            # we are just pointing at beginning of the stream
            eon = get_next_obj_pos(stream.tell(), 2**32, list(pdf.xref), pdf) - 1
            curr = stream.tell()
            rw = stream.read(eon - stream.tell())
            p = rw.find(b"endstream")
            if p < 0:
                raise PdfReadError(
                    f"Unable to find 'endstream' marker for obj starting at {curr}."
                )
            stream.seek(curr + p + 9)
            return rw[: p - 1]

        tmp = stream.read(2)
        if tmp != b"<<":
            raise PdfReadError(
                f"Dictionary read error at byte {hex_str(stream.tell())}: "
                "stream must begin with '<<'"
            )
        data: Dict[Any, Any] = {}
        while True:
            tok = read_non_whitespace(stream)
            if tok == b"\x00":
                continue
            elif tok == b"%":
                stream.seek(-1, 1)
                skip_over_comment(stream)
                continue
            if not tok:
                raise PdfStreamError(STREAM_TRUNCATED_PREMATURELY)

            if tok == b">":
                stream.read(1)
                break
            stream.seek(-1, 1)
            try:
                key = read_object(stream, pdf)
                tok = read_non_whitespace(stream)
                stream.seek(-1, 1)
                value = read_object(stream, pdf, forced_encoding)
            except Exception as exc:
                if pdf is not None and pdf.strict:
                    raise PdfReadError(exc.__repr__())
                logger_warning(exc.__repr__(), __name__)
                retval = DictionaryObject()
                retval.update(data)
                return retval  # return partial data

            if not data.get(key):
                data[key] = value
            else:
                # multiple definitions of key not permitted
                msg = (
                    f"Multiple definitions in dictionary at byte "
                    f"{hex_str(stream.tell())} for key {key}"
                )
                if pdf is not None and pdf.strict:
                    raise PdfReadError(msg)
                logger_warning(msg, __name__)

        pos = stream.tell()
        s = read_non_whitespace(stream)
        if s == b"s" and stream.read(5) == b"tream":
            eol = stream.read(1)
            # odd PDF file output has spaces after 'stream' keyword but before EOL.
            # patch provided by Danial Sandler
            while eol == b" ":
                eol = stream.read(1)
            if eol not in (b"\n", b"\r"):
                raise PdfStreamError("Stream data must be followed by a newline")
            if eol == b"\r":
                # read \n after
                if stream.read(1) != b"\n":
                    stream.seek(-1, 1)
            # this is a stream object, not a dictionary
            if SA.LENGTH not in data:
                raise PdfStreamError("Stream length not defined")
            length = data[SA.LENGTH]
            if isinstance(length, IndirectObject):
                t = stream.tell()
                length = pdf.get_object(length)
                stream.seek(t, 0)
            pstart = stream.tell()
            data["__streamdata__"] = stream.read(length)
            e = read_non_whitespace(stream)
            ndstream = stream.read(8)
            if (e + ndstream) != b"endstream":
                # (sigh) - the odd PDF file has a length that is too long, so
                # we need to read backwards to find the "endstream" ending.
                # ReportLab (unknown version) generates files with this bug,
                # and Python users into PDF files tend to be our audience.
                # we need to do this to correct the streamdata and chop off
                # an extra character.
                pos = stream.tell()
                stream.seek(-10, 1)
                end = stream.read(9)
                if end == b"endstream":
                    # we found it by looking back one character further.
                    data["__streamdata__"] = data["__streamdata__"][:-1]
                elif not pdf.strict:
                    stream.seek(pstart, 0)
                    data["__streamdata__"] = read_unsized_from_steam(stream, pdf)
                    pos = stream.tell()
                else:
                    stream.seek(pos, 0)
                    raise PdfReadError(
                        "Unable to find 'endstream' marker after stream at byte "
                        f"{hex_str(stream.tell())} (nd='{ndstream!r}', end='{end!r}')."
                    )
        else:
            stream.seek(pos, 0)
        if "__streamdata__" in data:
            return StreamObject.initialize_from_dictionary(data)
        else:
            retval = DictionaryObject()
            retval.update(data)
            return retval

    @staticmethod
    def readFromStream(
        stream: StreamType, pdf: Any  # PdfReader
    ) -> "DictionaryObject":  # pragma: no cover
        deprecation_with_replacement("readFromStream", "read_from_stream", "3.0.0")
        return DictionaryObject.read_from_stream(stream, pdf)


class TreeObject(DictionaryObject):
    def __init__(self) -> None:
        DictionaryObject.__init__(self)

    def hasChildren(self) -> bool:  # pragma: no cover
        deprecate_with_replacement("hasChildren", "has_children", "4.0.0")
        return self.has_children()

    def has_children(self) -> bool:
        return "/First" in self

    def __iter__(self) -> Any:
        return self.children()

    def children(self) -> Iterable[Any]:
        if not self.has_children():
            return

        child_ref = self[NameObject("/First")]
        child = child_ref.get_object()
        while True:
            yield child
            if child == self[NameObject("/Last")]:
                return
            child_ref = child.get(NameObject("/Next"))  # type: ignore
            if child_ref is None:
                return
            child = child_ref.get_object()

    def addChild(self, child: Any, pdf: Any) -> None:  # pragma: no cover
        deprecation_with_replacement("addChild", "add_child", "3.0.0")
        self.add_child(child, pdf)

    def add_child(self, child: Any, pdf: PdfWriterProtocol) -> None:
        self.insert_child(child, None, pdf)

    def insert_child(self, child: Any, before: Any, pdf: PdfWriterProtocol) -> None:
        def inc_parent_counter(
            parent: Union[None, IndirectObject, TreeObject], n: int
        ) -> None:
            if parent is None:
                return
            parent = cast("TreeObject", parent.get_object())
            if "/Count" in parent:
                parent[NameObject("/Count")] = NumberObject(
                    cast(int, parent[NameObject("/Count")]) + n
                )
                inc_parent_counter(parent.get("/Parent", None), n)

        child_obj = child.get_object()
        child = child.indirect_reference  # get_reference(child_obj)
        # assert isinstance(child, IndirectObject)

        prev: Optional[DictionaryObject]
        if "/First" not in self:  # no child yet
            self[NameObject("/First")] = child
            self[NameObject("/Count")] = NumberObject(0)
            self[NameObject("/Last")] = child
            child_obj[NameObject("/Parent")] = self.indirect_reference
            inc_parent_counter(self, child_obj.get("/Count", 1))
            if "/Next" in child_obj:
                del child_obj["/Next"]
            if "/Prev" in child_obj:
                del child_obj["/Prev"]
            return
        else:
            prev = cast("DictionaryObject", self["/Last"])

        while prev.indirect_reference != before:
            if "/Next" in prev:
                prev = cast("TreeObject", prev["/Next"])
            else:  # append at the end
                prev[NameObject("/Next")] = cast("TreeObject", child)
                child_obj[NameObject("/Prev")] = prev.indirect_reference
                child_obj[NameObject("/Parent")] = self.indirect_reference
                if "/Next" in child_obj:
                    del child_obj["/Next"]
                self[NameObject("/Last")] = child
                inc_parent_counter(self, child_obj.get("/Count", 1))
                return
        try:  # insert as first or in the middle
            assert isinstance(prev["/Prev"], DictionaryObject)
            prev["/Prev"][NameObject("/Next")] = child
            child_obj[NameObject("/Prev")] = prev["/Prev"]
        except Exception:  # it means we are inserting in first position
            del child_obj["/Next"]
        child_obj[NameObject("/Next")] = prev
        prev[NameObject("/Prev")] = child
        child_obj[NameObject("/Parent")] = self.indirect_reference
        inc_parent_counter(self, child_obj.get("/Count", 1))

    def removeChild(self, child: Any) -> None:  # pragma: no cover
        deprecation_with_replacement("removeChild", "remove_child", "3.0.0")
        self.remove_child(child)

    def _remove_node_from_tree(
        self, prev: Any, prev_ref: Any, cur: Any, last: Any
    ) -> None:
        """Adjust the pointers of the linked list and tree node count."""
        next_ref = cur.get(NameObject("/Next"), None)
        if prev is None:
            if next_ref:
                # Removing first tree node
                next_obj = next_ref.get_object()
                del next_obj[NameObject("/Prev")]
                self[NameObject("/First")] = next_ref
                self[NameObject("/Count")] = NumberObject(
                    self[NameObject("/Count")] - 1  # type: ignore
                )

            else:
                # Removing only tree node
                assert self[NameObject("/Count")] == 1
                del self[NameObject("/Count")]
                del self[NameObject("/First")]
                if NameObject("/Last") in self:
                    del self[NameObject("/Last")]
        else:
            if next_ref:
                # Removing middle tree node
                next_obj = next_ref.get_object()
                next_obj[NameObject("/Prev")] = prev_ref
                prev[NameObject("/Next")] = next_ref
            else:
                # Removing last tree node
                assert cur == last
                del prev[NameObject("/Next")]
                self[NameObject("/Last")] = prev_ref
            self[NameObject("/Count")] = NumberObject(self[NameObject("/Count")] - 1)  # type: ignore

    def remove_child(self, child: Any) -> None:
        child_obj = child.get_object()
        child = child_obj.indirect_reference

        if NameObject("/Parent") not in child_obj:
            raise ValueError("Removed child does not appear to be a tree item")
        elif child_obj[NameObject("/Parent")] != self:
            raise ValueError("Removed child is not a member of this tree")

        found = False
        prev_ref = None
        prev = None
        cur_ref: Optional[Any] = self[NameObject("/First")]
        cur: Optional[Dict[str, Any]] = cur_ref.get_object()  # type: ignore
        last_ref = self[NameObject("/Last")]
        last = last_ref.get_object()
        while cur is not None:
            if cur == child_obj:
                self._remove_node_from_tree(prev, prev_ref, cur, last)
                found = True
                break

            # Go to the next node
            prev_ref = cur_ref
            prev = cur
            if NameObject("/Next") in cur:
                cur_ref = cur[NameObject("/Next")]
                cur = cur_ref.get_object()
            else:
                cur_ref = None
                cur = None

        if not found:
            raise ValueError("Removal couldn't find item in tree")

        _reset_node_tree_relationship(child_obj)

    def remove_from_tree(self) -> None:
        """
        remove the object from the tree it is in
        """
        if NameObject("/Parent") not in self:
            raise ValueError("Removed child does not appear to be a tree item")
        else:
            cast("TreeObject", self["/Parent"]).remove_child(self)

    def emptyTree(self) -> None:  # pragma: no cover
        deprecate_with_replacement("emptyTree", "empty_tree", "4.0.0")
        self.empty_tree()

    def empty_tree(self) -> None:
        for child in self:
            child_obj = child.get_object()
            _reset_node_tree_relationship(child_obj)

        if NameObject("/Count") in self:
            del self[NameObject("/Count")]
        if NameObject("/First") in self:
            del self[NameObject("/First")]
        if NameObject("/Last") in self:
            del self[NameObject("/Last")]


def _reset_node_tree_relationship(child_obj: Any) -> None:
    """
    Call this after a node has been removed from a tree.

    This resets the nodes attributes in respect to that tree.
    """
    del child_obj[NameObject("/Parent")]
    if NameObject("/Next") in child_obj:
        del child_obj[NameObject("/Next")]
    if NameObject("/Prev") in child_obj:
        del child_obj[NameObject("/Prev")]


class StreamObject(DictionaryObject):
    def __init__(self) -> None:
        self.__data: Optional[str] = None
        self.decoded_self: Optional["DecodedStreamObject"] = None

    def _clone(
        self,
        src: DictionaryObject,
        pdf_dest: PdfWriterProtocol,
        force_duplicate: bool,
        ignore_fields: Union[Tuple[str, ...], List[str]],
    ) -> None:
        """update the object from src"""
        self._data = cast("StreamObject", src)._data
        try:
            decoded_self = cast("StreamObject", src).decoded_self
            if decoded_self is None:
                self.decoded_self = None
            else:
                self.decoded_self = decoded_self.clone(pdf_dest, True, ignore_fields)  # type: ignore[assignment]
        except Exception:
            pass
        super()._clone(src, pdf_dest, force_duplicate, ignore_fields)
        return

    def hash_value_data(self) -> bytes:
        data = super().hash_value_data()
        data += b_(self._data)
        return data

    @property
    def decodedSelf(self) -> Optional["DecodedStreamObject"]:  # pragma: no cover
        deprecation_with_replacement("decodedSelf", "decoded_self", "3.0.0")
        return self.decoded_self

    @decodedSelf.setter
    def decodedSelf(self, value: "DecodedStreamObject") -> None:  # pragma: no cover
        deprecation_with_replacement("decodedSelf", "decoded_self", "3.0.0")
        self.decoded_self = value

    @property
    def _data(self) -> Any:
        return self.__data

    @_data.setter
    def _data(self, value: Any) -> None:
        self.__data = value

    def write_to_stream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:
        self[NameObject(SA.LENGTH)] = NumberObject(len(self._data))
        DictionaryObject.write_to_stream(self, stream, encryption_key)
        del self[SA.LENGTH]
        stream.write(b"\nstream\n")
        data = self._data
        if encryption_key:
            from .._security import RC4_encrypt

            data = RC4_encrypt(encryption_key, data)
        stream.write(data)
        stream.write(b"\nendstream")

    @staticmethod
    def initializeFromDictionary(
        data: Dict[str, Any]
    ) -> Union["EncodedStreamObject", "DecodedStreamObject"]:  # pragma: no cover
        return StreamObject.initialize_from_dictionary(data)

    @staticmethod
    def initialize_from_dictionary(
        data: Dict[str, Any]
    ) -> Union["EncodedStreamObject", "DecodedStreamObject"]:
        retval: Union["EncodedStreamObject", "DecodedStreamObject"]
        if SA.FILTER in data:
            retval = EncodedStreamObject()
        else:
            retval = DecodedStreamObject()
        retval._data = data["__streamdata__"]
        del data["__streamdata__"]
        del data[SA.LENGTH]
        retval.update(data)
        return retval

    def flateEncode(self) -> "EncodedStreamObject":  # pragma: no cover
        deprecation_with_replacement("flateEncode", "flate_encode", "3.0.0")
        return self.flate_encode()

    def flate_encode(self) -> "EncodedStreamObject":
        from ..filters import FlateDecode

        if SA.FILTER in self:
            f = self[SA.FILTER]
            if isinstance(f, ArrayObject):
                f.insert(0, NameObject(FT.FLATE_DECODE))
            else:
                newf = ArrayObject()
                newf.append(NameObject("/FlateDecode"))
                newf.append(f)
                f = newf
        else:
            f = NameObject("/FlateDecode")
        retval = EncodedStreamObject()
        retval[NameObject(SA.FILTER)] = f
        retval._data = FlateDecode.encode(self._data)
        return retval


class DecodedStreamObject(StreamObject):
    def get_data(self) -> Any:
        return self._data

    def set_data(self, data: Any) -> Any:
        self._data = data

    def getData(self) -> Any:  # pragma: no cover
        deprecation_with_replacement("getData", "get_data", "3.0.0")
        return self._data

    def setData(self, data: Any) -> None:  # pragma: no cover
        deprecation_with_replacement("setData", "set_data", "3.0.0")
        self.set_data(data)


class EncodedStreamObject(StreamObject):
    def __init__(self) -> None:
        self.decoded_self: Optional["DecodedStreamObject"] = None

    @property
    def decodedSelf(self) -> Optional["DecodedStreamObject"]:  # pragma: no cover
        deprecation_with_replacement("decodedSelf", "decoded_self", "3.0.0")
        return self.decoded_self

    @decodedSelf.setter
    def decodedSelf(self, value: DecodedStreamObject) -> None:  # pragma: no cover
        deprecation_with_replacement("decodedSelf", "decoded_self", "3.0.0")
        self.decoded_self = value

    def get_data(self) -> Union[None, str, bytes]:
        from ..filters import decode_stream_data

        if self.decoded_self is not None:
            # cached version of decoded object
            return self.decoded_self.get_data()
        else:
            # create decoded object
            decoded = DecodedStreamObject()

            decoded._data = decode_stream_data(self)
            for key, value in list(self.items()):
                if key not in (SA.LENGTH, SA.FILTER, SA.DECODE_PARMS):
                    decoded[key] = value
            self.decoded_self = decoded
            return decoded._data

    def getData(self) -> Union[None, str, bytes]:  # pragma: no cover
        deprecation_with_replacement("getData", "get_data", "3.0.0")
        return self.get_data()

    def set_data(self, data: Any) -> None:  # pragma: no cover
        raise PdfReadError("Creating EncodedStreamObject is not currently supported")

    def setData(self, data: Any) -> None:  # pragma: no cover
        deprecation_with_replacement("setData", "set_data", "3.0.0")
        return self.set_data(data)


class ContentStream(DecodedStreamObject):
    def __init__(
        self,
        stream: Any,
        pdf: Any,
        forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
    ) -> None:
        self.pdf = pdf

        # The inner list has two elements:
        #  [0] : List
        #  [1] : str
        self.operations: List[Tuple[Any, Any]] = []

        # stream may be a StreamObject or an ArrayObject containing
        # multiple StreamObjects to be cat'd together.
        if stream is not None:
            stream = stream.get_object()
            if isinstance(stream, ArrayObject):
                data = b""
                for s in stream:
                    data += b_(s.get_object().get_data())
                    if len(data) == 0 or data[-1] != b"\n":
                        data += b"\n"
                stream_bytes = BytesIO(data)
            else:
                stream_data = stream.get_data()
                assert stream_data is not None
                stream_data_bytes = b_(stream_data)
                stream_bytes = BytesIO(stream_data_bytes)
            self.forced_encoding = forced_encoding
            self.__parse_content_stream(stream_bytes)

    def clone(
        self,
        pdf_dest: Any,
        force_duplicate: bool = False,
        ignore_fields: Union[Tuple[str, ...], List[str], None] = (),
    ) -> "ContentStream":
        """clone object into pdf_dest"""
        try:
            if self.indirect_reference.pdf == pdf_dest and not force_duplicate:  # type: ignore
                return self
        except Exception:
            pass

        d__ = cast(
            "ContentStream", self._reference_clone(self.__class__(None, None), pdf_dest)
        )
        if ignore_fields is None:
            ignore_fields = []
        d__._clone(self, pdf_dest, force_duplicate, ignore_fields)
        return d__

    def _clone(
        self,
        src: DictionaryObject,
        pdf_dest: PdfWriterProtocol,
        force_duplicate: bool,
        ignore_fields: Union[Tuple[str, ...], List[str]],
    ) -> None:
        """update the object from src"""
        self.pdf = pdf_dest
        self.operations = list(cast("ContentStream", src).operations)
        self.forced_encoding = cast("ContentStream", src).forced_encoding
        # no need to call DictionaryObjection or any
        # super(DictionaryObject,self)._clone(src, pdf_dest, force_duplicate, ignore_fields)
        return

    def __parse_content_stream(self, stream: StreamType) -> None:
        stream.seek(0, 0)
        operands: List[Union[int, str, PdfObject]] = []
        while True:
            peek = read_non_whitespace(stream)
            if peek == b"" or peek == 0:
                break
            stream.seek(-1, 1)
            if peek.isalpha() or peek in (b"'", b'"'):
                operator = read_until_regex(stream, NameObject.delimiter_pattern, True)
                if operator == b"BI":
                    # begin inline image - a completely different parsing
                    # mechanism is required, of course... thanks buddy...
                    assert operands == []
                    ii = self._read_inline_image(stream)
                    self.operations.append((ii, b"INLINE IMAGE"))
                else:
                    self.operations.append((operands, operator))
                    operands = []
            elif peek == b"%":
                # If we encounter a comment in the content stream, we have to
                # handle it here.  Typically, read_object will handle
                # encountering a comment -- but read_object assumes that
                # following the comment must be the object we're trying to
                # read.  In this case, it could be an operator instead.
                while peek not in (b"\r", b"\n"):
                    peek = stream.read(1)
            else:
                operands.append(read_object(stream, None, self.forced_encoding))

    def _read_inline_image(self, stream: StreamType) -> Dict[str, Any]:
        # begin reading just after the "BI" - begin image
        # first read the dictionary of settings.
        settings = DictionaryObject()
        while True:
            tok = read_non_whitespace(stream)
            stream.seek(-1, 1)
            if tok == b"I":
                # "ID" - begin of image data
                break
            key = read_object(stream, self.pdf)
            tok = read_non_whitespace(stream)
            stream.seek(-1, 1)
            value = read_object(stream, self.pdf)
            settings[key] = value
        # left at beginning of ID
        tmp = stream.read(3)
        assert tmp[:2] == b"ID"
        data = BytesIO()
        # Read the inline image, while checking for EI (End Image) operator.
        while True:
            # Read 8 kB at a time and check if the chunk contains the E operator.
            buf = stream.read(8192)
            # We have reached the end of the stream, but haven't found the EI operator.
            if not buf:
                raise PdfReadError("Unexpected end of stream")
            loc = buf.find(b"E")

            if loc == -1:
                data.write(buf)
            else:
                # Write out everything before the E.
                data.write(buf[0:loc])

                # Seek back in the stream to read the E next.
                stream.seek(loc - len(buf), 1)
                tok = stream.read(1)
                # Check for End Image
                tok2 = stream.read(1)
                if tok2 == b"I" and buf[loc - 1 : loc] in WHITESPACES:
                    # Data can contain [\s]EI,  so check for the separator \s; 4 chars suffisent Q operator not required.
                    tok3 = stream.read(1)
                    info = tok + tok2
                    # We need to find at least one whitespace after.
                    has_q_whitespace = False
                    while tok3 in WHITESPACES:
                        has_q_whitespace = True
                        info += tok3
                        tok3 = stream.read(1)
                    if has_q_whitespace:
                        stream.seek(-1, 1)
                        break
                    else:
                        stream.seek(-1, 1)
                        data.write(info)
                else:
                    stream.seek(-1, 1)
                    data.write(tok)
        return {"settings": settings, "data": data.getvalue()}

    @property
    def _data(self) -> bytes:
        newdata = BytesIO()
        for operands, operator in self.operations:
            if operator == b"INLINE IMAGE":
                newdata.write(b"BI")
                dicttext = BytesIO()
                operands["settings"].write_to_stream(dicttext, None)
                newdata.write(dicttext.getvalue()[2:-2])
                newdata.write(b"ID ")
                newdata.write(operands["data"])
                newdata.write(b"EI")
            else:
                for op in operands:
                    op.write_to_stream(newdata, None)
                    newdata.write(b" ")
                newdata.write(b_(operator))
            newdata.write(b"\n")
        return newdata.getvalue()

    @_data.setter
    def _data(self, value: Union[str, bytes]) -> None:
        self.__parse_content_stream(BytesIO(b_(value)))


def read_object(
    stream: StreamType,
    pdf: Any,  # PdfReader
    forced_encoding: Union[None, str, List[str], Dict[int, str]] = None,
) -> Union[PdfObject, int, str, ContentStream]:
    tok = stream.read(1)
    stream.seek(-1, 1)  # reset to start
    if tok == b"/":
        return NameObject.read_from_stream(stream, pdf)
    elif tok == b"<":
        # hexadecimal string OR dictionary
        peek = stream.read(2)
        stream.seek(-2, 1)  # reset to start

        if peek == b"<<":
            return DictionaryObject.read_from_stream(stream, pdf, forced_encoding)
        else:
            return read_hex_string_from_stream(stream, forced_encoding)
    elif tok == b"[":
        return ArrayObject.read_from_stream(stream, pdf, forced_encoding)
    elif tok == b"t" or tok == b"f":
        return BooleanObject.read_from_stream(stream)
    elif tok == b"(":
        return read_string_from_stream(stream, forced_encoding)
    elif tok == b"e" and stream.read(6) == b"endobj":
        stream.seek(-6, 1)
        return NullObject()
    elif tok == b"n":
        return NullObject.read_from_stream(stream)
    elif tok == b"%":
        # comment
        while tok not in (b"\r", b"\n"):
            tok = stream.read(1)
            # Prevents an infinite loop by raising an error if the stream is at
            # the EOF
            if len(tok) <= 0:
                raise PdfStreamError("File ended unexpectedly.")
        tok = read_non_whitespace(stream)
        stream.seek(-1, 1)
        return read_object(stream, pdf, forced_encoding)
    elif tok in b"0123456789+-.":
        # number object OR indirect reference
        peek = stream.read(20)
        stream.seek(-len(peek), 1)  # reset to start
        if IndirectPattern.match(peek) is not None:
            return IndirectObject.read_from_stream(stream, pdf)
        else:
            return NumberObject.read_from_stream(stream)
    else:
        stream.seek(-20, 1)
        raise PdfReadError(
            f"Invalid Elementary Object starting with {tok!r} @{stream.tell()}: {stream.read(80).__repr__()}"
        )


class Field(TreeObject):
    """
    A class representing a field dictionary.

    This class is accessed through
    :meth:`get_fields()<PyPDF2.PdfReader.get_fields>`
    """

    def __init__(self, data: Dict[str, Any]) -> None:
        DictionaryObject.__init__(self)
        field_attributes = (
            FieldDictionaryAttributes.attributes()
            + CheckboxRadioButtonAttributes.attributes()
        )
        for attr in field_attributes:
            try:
                self[NameObject(attr)] = data[attr]
            except KeyError:
                pass

    # TABLE 8.69 Entries common to all field dictionaries
    @property
    def field_type(self) -> Optional[NameObject]:
        """Read-only property accessing the type of this field."""
        return self.get(FieldDictionaryAttributes.FT)

    @property
    def fieldType(self) -> Optional[NameObject]:  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :py:attr:`field_type` instead.
        """
        deprecation_with_replacement("fieldType", "field_type", "3.0.0")
        return self.field_type

    @property
    def parent(self) -> Optional[DictionaryObject]:
        """Read-only property accessing the parent of this field."""
        return self.get(FieldDictionaryAttributes.Parent)

    @property
    def kids(self) -> Optional["ArrayObject"]:
        """Read-only property accessing the kids of this field."""
        return self.get(FieldDictionaryAttributes.Kids)

    @property
    def name(self) -> Optional[str]:
        """Read-only property accessing the name of this field."""
        return self.get(FieldDictionaryAttributes.T)

    @property
    def alternate_name(self) -> Optional[str]:
        """Read-only property accessing the alternate name of this field."""
        return self.get(FieldDictionaryAttributes.TU)

    @property
    def altName(self) -> Optional[str]:  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :py:attr:`alternate_name` instead.
        """
        deprecation_with_replacement("altName", "alternate_name", "3.0.0")
        return self.alternate_name

    @property
    def mapping_name(self) -> Optional[str]:
        """
        Read-only property accessing the mapping name of this field. This
        name is used by PyPDF2 as a key in the dictionary returned by
        :meth:`get_fields()<PyPDF2.PdfReader.get_fields>`
        """
        return self.get(FieldDictionaryAttributes.TM)

    @property
    def mappingName(self) -> Optional[str]:  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :py:attr:`mapping_name` instead.
        """
        deprecation_with_replacement("mappingName", "mapping_name", "3.0.0")
        return self.mapping_name

    @property
    def flags(self) -> Optional[int]:
        """
        Read-only property accessing the field flags, specifying various
        characteristics of the field (see Table 8.70 of the PDF 1.7 reference).
        """
        return self.get(FieldDictionaryAttributes.Ff)

    @property
    def value(self) -> Optional[Any]:
        """
        Read-only property accessing the value of this field. Format
        varies based on field type.
        """
        return self.get(FieldDictionaryAttributes.V)

    @property
    def default_value(self) -> Optional[Any]:
        """Read-only property accessing the default value of this field."""
        return self.get(FieldDictionaryAttributes.DV)

    @property
    def defaultValue(self) -> Optional[Any]:  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :py:attr:`default_value` instead.
        """
        deprecation_with_replacement("defaultValue", "default_value", "3.0.0")
        return self.default_value

    @property
    def additional_actions(self) -> Optional[DictionaryObject]:
        """
        Read-only property accessing the additional actions dictionary.
        This dictionary defines the field's behavior in response to trigger events.
        See Section 8.5.2 of the PDF 1.7 reference.
        """
        return self.get(FieldDictionaryAttributes.AA)

    @property
    def additionalActions(self) -> Optional[DictionaryObject]:  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :py:attr:`additional_actions` instead.
        """
        deprecation_with_replacement("additionalActions", "additional_actions", "3.0.0")
        return self.additional_actions


class Destination(TreeObject):
    """
    A class representing a destination within a PDF file.
    See section 8.2.1 of the PDF 1.6 reference.

    :param str title: Title of this destination.
    :param IndirectObject page: Reference to the page of this destination. Should
        be an instance of :class:`IndirectObject<PyPDF2.generic.IndirectObject>`.
    :param Fit fit: How the destination is displayed.
    :raises PdfReadError: If destination type is invalid.


    """

    node: Optional[
        DictionaryObject
    ] = None  # node provide access to the original Object
    childs: List[Any] = []  # used in PdfWriter

    def __init__(
        self,
        title: str,
        page: Union[NumberObject, IndirectObject, NullObject, DictionaryObject],
        fit: Fit,
    ) -> None:
        typ = fit.fit_type
        args = fit.fit_args

        DictionaryObject.__init__(self)
        self[NameObject("/Title")] = TextStringObject(title)
        self[NameObject("/Page")] = page
        self[NameObject("/Type")] = typ

        # from table 8.2 of the PDF 1.7 reference.
        if typ == "/XYZ":
            (
                self[NameObject(TA.LEFT)],
                self[NameObject(TA.TOP)],
                self[NameObject("/Zoom")],
            ) = args
        elif typ == TF.FIT_R:
            (
                self[NameObject(TA.LEFT)],
                self[NameObject(TA.BOTTOM)],
                self[NameObject(TA.RIGHT)],
                self[NameObject(TA.TOP)],
            ) = args
        elif typ in [TF.FIT_H, TF.FIT_BH]:
            try:  # Prefered to be more robust not only to null parameters
                (self[NameObject(TA.TOP)],) = args
            except Exception:
                (self[NameObject(TA.TOP)],) = (NullObject(),)
        elif typ in [TF.FIT_V, TF.FIT_BV]:
            try:  # Prefered to be more robust not only to null parameters
                (self[NameObject(TA.LEFT)],) = args
            except Exception:
                (self[NameObject(TA.LEFT)],) = (NullObject(),)
        elif typ in [TF.FIT, TF.FIT_B]:
            pass
        else:
            raise PdfReadError(f"Unknown Destination Type: {typ!r}")

    @property
    def dest_array(self) -> "ArrayObject":
        return ArrayObject(
            [self.raw_get("/Page"), self["/Type"]]
            + [
                self[x]
                for x in ["/Left", "/Bottom", "/Right", "/Top", "/Zoom"]
                if x in self
            ]
        )

    def getDestArray(self) -> "ArrayObject":  # pragma: no cover
        """
        .. deprecated:: 1.28.3

            Use :py:attr:`dest_array` instead.
        """
        deprecation_with_replacement("getDestArray", "dest_array", "3.0.0")
        return self.dest_array

    def write_to_stream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:
        stream.write(b"<<\n")
        key = NameObject("/D")
        key.write_to_stream(stream, encryption_key)
        stream.write(b" ")
        value = self.dest_array
        value.write_to_stream(stream, encryption_key)

        key = NameObject("/S")
        key.write_to_stream(stream, encryption_key)
        stream.write(b" ")
        value_s = NameObject("/GoTo")
        value_s.write_to_stream(stream, encryption_key)

        stream.write(b"\n")
        stream.write(b">>")

    @property
    def title(self) -> Optional[str]:
        """Read-only property accessing the destination title."""
        return self.get("/Title")

    @property
    def page(self) -> Optional[int]:
        """Read-only property accessing the destination page number."""
        return self.get("/Page")

    @property
    def typ(self) -> Optional[str]:
        """Read-only property accessing the destination type."""
        return self.get("/Type")

    @property
    def zoom(self) -> Optional[int]:
        """Read-only property accessing the zoom factor."""
        return self.get("/Zoom", None)

    @property
    def left(self) -> Optional[FloatObject]:
        """Read-only property accessing the left horizontal coordinate."""
        return self.get("/Left", None)

    @property
    def right(self) -> Optional[FloatObject]:
        """Read-only property accessing the right horizontal coordinate."""
        return self.get("/Right", None)

    @property
    def top(self) -> Optional[FloatObject]:
        """Read-only property accessing the top vertical coordinate."""
        return self.get("/Top", None)

    @property
    def bottom(self) -> Optional[FloatObject]:
        """Read-only property accessing the bottom vertical coordinate."""
        return self.get("/Bottom", None)

    @property
    def color(self) -> Optional["ArrayObject"]:
        """Read-only property accessing the color in (R, G, B) with values 0.0-1.0"""
        return self.get(
            "/C", ArrayObject([FloatObject(0), FloatObject(0), FloatObject(0)])
        )

    @property
    def font_format(self) -> Optional[OutlineFontFlag]:
        """Read-only property accessing the font type. 1=italic, 2=bold, 3=both"""
        return self.get("/F", 0)

    @property
    def outline_count(self) -> Optional[int]:
        """
        Read-only property accessing the outline count.
        positive = expanded
        negative = collapsed
        absolute value = number of visible descendents at all levels
        """
        return self.get("/Count", None)
