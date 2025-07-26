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

import warnings
from io import BytesIO, FileIO, IOBase
from pathlib import Path
from types import TracebackType
from typing import (
    Any,
    Dict,
    Iterable,
    List,
    Optional,
    Tuple,
    Type,
    Union,
    cast,
)

from ._encryption import Encryption
from ._page import PageObject
from ._reader import PdfReader
from ._utils import (
    StrByteType,
    deprecation_bookmark,
    deprecation_with_replacement,
    str_,
)
from ._writer import PdfWriter
from .constants import GoToActionArguments
from .constants import PagesAttributes as PA
from .constants import TypArguments, TypFitArguments
from .generic import (
    PAGE_FIT,
    ArrayObject,
    Destination,
    DictionaryObject,
    Fit,
    FloatObject,
    IndirectObject,
    NameObject,
    NullObject,
    NumberObject,
    OutlineItem,
    TextStringObject,
    TreeObject,
)
from .pagerange import PageRange, PageRangeSpec
from .types import FitType, LayoutType, OutlineType, PagemodeType, ZoomArgType

ERR_CLOSED_WRITER = "close() was called and thus the writer cannot be used anymore"


class _MergedPage:
    """Collect necessary information on each page that is being merged."""

    def __init__(self, pagedata: PageObject, src: PdfReader, id: int) -> None:
        self.src = src
        self.pagedata = pagedata
        self.out_pagedata = None
        self.id = id


class PdfMerger:
    """
    Initialize a ``PdfMerger`` object.

    ``PdfMerger`` merges multiple PDFs into a single PDF.
    It can concatenate, slice, insert, or any combination of the above.

    See the functions :meth:`merge()<merge>` (or :meth:`append()<append>`)
    and :meth:`write()<write>` for usage information.

    :param bool strict: Determines whether user should be warned of all
            problems and also causes some correctable problems to be fatal.
            Defaults to ``False``.
    :param fileobj: Output file. Can be a filename or any kind of
            file-like object.
    """

    @deprecation_bookmark(bookmarks="outline")
    def __init__(
        self, strict: bool = False, fileobj: Union[Path, StrByteType] = ""
    ) -> None:
        self.inputs: List[Tuple[Any, PdfReader]] = []
        self.pages: List[Any] = []
        self.output: Optional[PdfWriter] = PdfWriter()
        self.outline: OutlineType = []
        self.named_dests: List[Any] = []
        self.id_count = 0
        self.fileobj = fileobj
        self.strict = strict

    def __enter__(self) -> "PdfMerger":
        # There is nothing to do.
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        traceback: Optional[TracebackType],
    ) -> None:
        """Write to the fileobj and close the merger."""
        if self.fileobj:
            self.write(self.fileobj)
        self.close()

    @deprecation_bookmark(bookmark="outline_item", import_bookmarks="import_outline")
    def merge(
        self,
        page_number: Optional[int] = None,
        fileobj: Union[Path, StrByteType, PdfReader] = None,
        outline_item: Optional[str] = None,
        pages: Optional[PageRangeSpec] = None,
        import_outline: bool = True,
        position: Optional[int] = None,  # deprecated
    ) -> None:
        """
        Merge the pages from the given file into the output file at the
        specified page number.

        :param int page_number: The *page number* to insert this file. File will
            be inserted after the given number.

        :param fileobj: A File Object or an object that supports the standard
            read and seek methods similar to a File Object. Could also be a
            string representing a path to a PDF file.

        :param str outline_item: Optionally, you may specify an outline item
            (previously referred to as a 'bookmark') to be applied at the
            beginning of the included file by supplying the text of the outline item.

        :param pages: can be a :class:`PageRange<PyPDF2.pagerange.PageRange>`
            or a ``(start, stop[, step])`` tuple
            to merge only the specified range of pages from the source
            document into the output document.
            Can also be a list of pages to merge.

        :param bool import_outline: You may prevent the source document's
            outline (collection of outline items, previously referred to as
            'bookmarks') from being imported by specifying this as ``False``.
        """
        if position is not None:  # deprecated
            if page_number is None:
                page_number = position
                old_term = "position"
                new_term = "page_number"
                warnings.warn(
                    (
                        f"{old_term} is deprecated as an argument and will be "
                        f"removed in PyPDF2=4.0.0. Use {new_term} instead"
                    ),
                    DeprecationWarning,
                )
            else:
                raise ValueError(
                    "The argument position of merge is deprecated. Use page_number only."
                )

        if page_number is None:  # deprecated
            # The paremter is only marked as Optional as long as
            # position is not fully deprecated
            raise ValueError("page_number may not be None")
        if fileobj is None:  # deprecated
            # The argument is only Optional due to the deprecated position
            # argument
            raise ValueError("fileobj may not be None")

        stream, encryption_obj = self._create_stream(fileobj)

        # Create a new PdfReader instance using the stream
        # (either file or BytesIO or StringIO) created above
        reader = PdfReader(stream, strict=self.strict)  # type: ignore[arg-type]
        self.inputs.append((stream, reader))
        if encryption_obj is not None:
            reader._encryption = encryption_obj

        # Find the range of pages to merge.
        if pages is None:
            pages = (0, len(reader.pages))
        elif isinstance(pages, PageRange):
            pages = pages.indices(len(reader.pages))
        elif isinstance(pages, list):
            pass
        elif not isinstance(pages, tuple):
            raise TypeError('"pages" must be a tuple of (start, stop[, step])')

        srcpages = []

        outline = []
        if import_outline:
            outline = reader.outline
            outline = self._trim_outline(reader, outline, pages)

        if outline_item:
            outline_item_typ = OutlineItem(
                TextStringObject(outline_item),
                NumberObject(self.id_count),
                Fit.fit(),
            )
            self.outline += [outline_item_typ, outline]  # type: ignore
        else:
            self.outline += outline

        dests = reader.named_destinations
        trimmed_dests = self._trim_dests(reader, dests, pages)
        self.named_dests += trimmed_dests

        # Gather all the pages that are going to be merged
        for i in range(*pages):
            page = reader.pages[i]

            id = self.id_count
            self.id_count += 1

            mp = _MergedPage(page, reader, id)

            srcpages.append(mp)

        self._associate_dests_to_pages(srcpages)
        self._associate_outline_items_to_pages(srcpages)

        # Slice to insert the pages at the specified page_number
        self.pages[page_number:page_number] = srcpages

    def _create_stream(
        self, fileobj: Union[Path, StrByteType, PdfReader]
    ) -> Tuple[IOBase, Optional[Encryption]]:
        # If the fileobj parameter is a string, assume it is a path
        # and create a file object at that location. If it is a file,
        # copy the file's contents into a BytesIO stream object; if
        # it is a PdfReader, copy that reader's stream into a
        # BytesIO stream.
        # If fileobj is none of the above types, it is not modified
        encryption_obj = None
        stream: IOBase
        if isinstance(fileobj, (str, Path)):
            stream = FileIO(fileobj, "rb")
        elif isinstance(fileobj, PdfReader):
            if fileobj._encryption:
                encryption_obj = fileobj._encryption
            orig_tell = fileobj.stream.tell()
            fileobj.stream.seek(0)
            stream = BytesIO(fileobj.stream.read())

            # reset the stream to its original location
            fileobj.stream.seek(orig_tell)
        elif hasattr(fileobj, "seek") and hasattr(fileobj, "read"):
            fileobj.seek(0)
            filecontent = fileobj.read()
            stream = BytesIO(filecontent)
        else:
            raise NotImplementedError(
                "PdfMerger.merge requires an object that PdfReader can parse. "
                "Typically, that is a Path or a string representing a Path, "
                "a file object, or an object implementing .seek and .read. "
                "Passing a PdfReader directly works as well."
            )
        return stream, encryption_obj

    @deprecation_bookmark(bookmark="outline_item", import_bookmarks="import_outline")
    def append(
        self,
        fileobj: Union[StrByteType, PdfReader, Path],
        outline_item: Optional[str] = None,
        pages: Union[
            None, PageRange, Tuple[int, int], Tuple[int, int, int], List[int]
        ] = None,
        import_outline: bool = True,
    ) -> None:
        """
        Identical to the :meth:`merge()<merge>` method, but assumes you want to
        concatenate all pages onto the end of the file instead of specifying a
        position.

        :param fileobj: A File Object or an object that supports the standard
            read and seek methods similar to a File Object. Could also be a
            string representing a path to a PDF file.

        :param str outline_item: Optionally, you may specify an outline item
            (previously referred to as a 'bookmark') to be applied at the
            beginning of the included file by supplying the text of the outline item.

        :param pages: can be a :class:`PageRange<PyPDF2.pagerange.PageRange>`
            or a ``(start, stop[, step])`` tuple
            to merge only the specified range of pages from the source
            document into the output document.
            Can also be a list of pages to append.

        :param bool import_outline: You may prevent the source document's
            outline (collection of outline items, previously referred to as
            'bookmarks') from being imported by specifying this as ``False``.
        """
        self.merge(len(self.pages), fileobj, outline_item, pages, import_outline)

    def write(self, fileobj: Union[Path, StrByteType]) -> None:
        """
        Write all data that has been merged to the given output file.

        :param fileobj: Output file. Can be a filename or any kind of
            file-like object.
        """
        if self.output is None:
            raise RuntimeError(ERR_CLOSED_WRITER)

        # Add pages to the PdfWriter
        # The commented out line below was replaced with the two lines below it
        # to allow PdfMerger to work with PyPdf 1.13
        for page in self.pages:
            self.output.add_page(page.pagedata)
            pages_obj = cast(Dict[str, Any], self.output._pages.get_object())
            page.out_pagedata = self.output.get_reference(
                pages_obj[PA.KIDS][-1].get_object()
            )
            # idnum = self.output._objects.index(self.output._pages.get_object()[PA.KIDS][-1].get_object()) + 1
            # page.out_pagedata = IndirectObject(idnum, 0, self.output)

        # Once all pages are added, create outline items to point at those pages
        self._write_dests()
        self._write_outline()

        # Write the output to the file
        my_file, ret_fileobj = self.output.write(fileobj)

        if my_file:
            ret_fileobj.close()

    def close(self) -> None:
        """Shut all file descriptors (input and output) and clear all memory usage."""
        self.pages = []
        for fo, _reader in self.inputs:
            fo.close()

        self.inputs = []
        self.output = None

    def add_metadata(self, infos: Dict[str, Any]) -> None:
        """
        Add custom metadata to the output.

        :param dict infos: a Python dictionary where each key is a field
            and each value is your new metadata.
            Example: ``{u'/Title': u'My title'}``
        """
        if self.output is None:
            raise RuntimeError(ERR_CLOSED_WRITER)
        self.output.add_metadata(infos)

    def addMetadata(self, infos: Dict[str, Any]) -> None:  # pragma: no cover
        """
        .. deprecated:: 1.28.0

            Use :meth:`add_metadata` instead.
        """
        deprecation_with_replacement("addMetadata", "add_metadata")
        self.add_metadata(infos)

    def setPageLayout(self, layout: LayoutType) -> None:  # pragma: no cover
        """
        .. deprecated:: 1.28.0

            Use :meth:`set_page_layout` instead.
        """
        deprecation_with_replacement("setPageLayout", "set_page_layout")
        self.set_page_layout(layout)

    def set_page_layout(self, layout: LayoutType) -> None:
        """
        Set the page layout.

        :param str layout: The page layout to be used

        .. list-table:: Valid ``layout`` arguments
           :widths: 50 200

           * - /NoLayout
             - Layout explicitly not specified
           * - /SinglePage
             - Show one page at a time
           * - /OneColumn
             - Show one column at a time
           * - /TwoColumnLeft
             - Show pages in two columns, odd-numbered pages on the left
           * - /TwoColumnRight
             - Show pages in two columns, odd-numbered pages on the right
           * - /TwoPageLeft
             - Show two pages at a time, odd-numbered pages on the left
           * - /TwoPageRight
             - Show two pages at a time, odd-numbered pages on the right
        """
        if self.output is None:
            raise RuntimeError(ERR_CLOSED_WRITER)
        self.output._set_page_layout(layout)

    def setPageMode(self, mode: PagemodeType) -> None:  # pragma: no cover
        """
        .. deprecated:: 1.28.0

            Use :meth:`set_page_mode` instead.
        """
        deprecation_with_replacement("setPageMode", "set_page_mode", "3.0.0")
        self.set_page_mode(mode)

    def set_page_mode(self, mode: PagemodeType) -> None:
        """
        Set the page mode.

        :param str mode: The page mode to use.

        .. list-table:: Valid ``mode`` arguments
           :widths: 50 200

           * - /UseNone
             - Do not show outline or thumbnails panels
           * - /UseOutlines
             - Show outline (aka bookmarks) panel
           * - /UseThumbs
             - Show page thumbnails panel
           * - /FullScreen
             - Fullscreen view
           * - /UseOC
             - Show Optional Content Group (OCG) panel
           * - /UseAttachments
             - Show attachments panel
        """
        if self.output is None:
            raise RuntimeError(ERR_CLOSED_WRITER)
        self.output.set_page_mode(mode)

    def _trim_dests(
        self,
        pdf: PdfReader,
        dests: Dict[str, Dict[str, Any]],
        pages: Union[Tuple[int, int], Tuple[int, int, int], List[int]],
    ) -> List[Dict[str, Any]]:
        """Remove named destinations that are not a part of the specified page set."""
        new_dests = []
        lst = pages if isinstance(pages, list) else list(range(*pages))
        for key, obj in dests.items():
            for j in lst:
                if pdf.pages[j].get_object() == obj["/Page"].get_object():
                    obj[NameObject("/Page")] = obj["/Page"].get_object()
                    assert str_(key) == str_(obj["/Title"])
                    new_dests.append(obj)
                    break
        return new_dests

    def _trim_outline(
        self,
        pdf: PdfReader,
        outline: OutlineType,
        pages: Union[Tuple[int, int], Tuple[int, int, int], List[int]],
    ) -> OutlineType:
        """Remove outline item entries that are not a part of the specified page set."""
        new_outline = []
        prev_header_added = True
        lst = pages if isinstance(pages, list) else list(range(*pages))
        for i, outline_item in enumerate(outline):
            if isinstance(outline_item, list):
                sub = self._trim_outline(pdf, outline_item, lst)  # type: ignore
                if sub:
                    if not prev_header_added:
                        new_outline.append(outline[i - 1])
                    new_outline.append(sub)  # type: ignore
            else:
                prev_header_added = False
                for j in lst:
                    if outline_item["/Page"] is None:
                        continue
                    if pdf.pages[j].get_object() == outline_item["/Page"].get_object():
                        outline_item[NameObject("/Page")] = outline_item[
                            "/Page"
                        ].get_object()
                        new_outline.append(outline_item)
                        prev_header_added = True
                        break
        return new_outline

    def _write_dests(self) -> None:
        if self.output is None:
            raise RuntimeError(ERR_CLOSED_WRITER)
        for named_dest in self.named_dests:
            pageno = None
            if "/Page" in named_dest:
                for pageno, page in enumerate(self.pages):  # noqa: B007
                    if page.id == named_dest["/Page"]:
                        named_dest[NameObject("/Page")] = page.out_pagedata
                        break

            if pageno is not None:
                self.output.add_named_destination_object(named_dest)

    @deprecation_bookmark(bookmarks="outline")
    def _write_outline(
        self,
        outline: Optional[Iterable[OutlineItem]] = None,
        parent: Optional[TreeObject] = None,
    ) -> None:
        if self.output is None:
            raise RuntimeError(ERR_CLOSED_WRITER)
        if outline is None:
            outline = self.outline  # type: ignore
        assert outline is not None, "hint for mypy"  # TODO: is that true?

        last_added = None
        for outline_item in outline:
            if isinstance(outline_item, list):
                self._write_outline(outline_item, last_added)
                continue

            page_no = None
            if "/Page" in outline_item:
                for page_no, page in enumerate(self.pages):  # noqa: B007
                    if page.id == outline_item["/Page"]:
                        self._write_outline_item_on_page(outline_item, page)
                        break
            if page_no is not None:
                del outline_item["/Page"], outline_item["/Type"]
                last_added = self.output.add_outline_item_dict(outline_item, parent)

    @deprecation_bookmark(bookmark="outline_item")
    def _write_outline_item_on_page(
        self, outline_item: Union[OutlineItem, Destination], page: _MergedPage
    ) -> None:
        oi_type = cast(str, outline_item["/Type"])
        args = [NumberObject(page.id), NameObject(oi_type)]
        fit2arg_keys: Dict[str, Tuple[str, ...]] = {
            TypFitArguments.FIT_H: (TypArguments.TOP,),
            TypFitArguments.FIT_BH: (TypArguments.TOP,),
            TypFitArguments.FIT_V: (TypArguments.LEFT,),
            TypFitArguments.FIT_BV: (TypArguments.LEFT,),
            TypFitArguments.XYZ: (TypArguments.LEFT, TypArguments.TOP, "/Zoom"),
            TypFitArguments.FIT_R: (
                TypArguments.LEFT,
                TypArguments.BOTTOM,
                TypArguments.RIGHT,
                TypArguments.TOP,
            ),
        }
        for arg_key in fit2arg_keys.get(oi_type, tuple()):
            if arg_key in outline_item and not isinstance(
                outline_item[arg_key], NullObject
            ):
                args.append(FloatObject(outline_item[arg_key]))
            else:
                args.append(FloatObject(0))
            del outline_item[arg_key]

        outline_item[NameObject("/A")] = DictionaryObject(
            {
                NameObject(GoToActionArguments.S): NameObject("/GoTo"),
                NameObject(GoToActionArguments.D): ArrayObject(args),
            }
        )

    def _associate_dests_to_pages(self, pages: List[_MergedPage]) -> None:
        for named_dest in self.named_dests:
            pageno = None
            np = named_dest["/Page"]

            if isinstance(np, NumberObject):
                continue

            for page in pages:
                if np.get_object() == page.pagedata.get_object():
                    pageno = page.id

            if pageno is None:
                raise ValueError(
                    f"Unresolved named destination '{named_dest['/Title']}'"
                )
            named_dest[NameObject("/Page")] = NumberObject(pageno)

    @deprecation_bookmark(bookmarks="outline")
    def _associate_outline_items_to_pages(
        self, pages: List[_MergedPage], outline: Optional[Iterable[OutlineItem]] = None
    ) -> None:
        if outline is None:
            outline = self.outline  # type: ignore # TODO: self.bookmarks can be None!
        assert outline is not None, "hint for mypy"
        for outline_item in outline:
            if isinstance(outline_item, list):
                self._associate_outline_items_to_pages(pages, outline_item)
                continue

            pageno = None
            outline_item_page = outline_item["/Page"]

            if isinstance(outline_item_page, NumberObject):
                continue

            for p in pages:
                if outline_item_page.get_object() == p.pagedata.get_object():
                    pageno = p.id

            if pageno is not None:
                outline_item[NameObject("/Page")] = NumberObject(pageno)

    @deprecation_bookmark(bookmark="outline_item")
    def find_outline_item(
        self,
        outline_item: Dict[str, Any],
        root: Optional[OutlineType] = None,
    ) -> Optional[List[int]]:
        if root is None:
            root = self.outline

        for i, oi_enum in enumerate(root):
            if isinstance(oi_enum, list):
                # oi_enum is still an inner node
                # (OutlineType, if recursive types were supported by mypy)
                res = self.find_outline_item(outline_item, oi_enum)  # type: ignore
                if res:
                    return [i] + res
            elif (
                oi_enum == outline_item
                or cast(Dict[Any, Any], oi_enum["/Title"]) == outline_item
            ):
                # we found a leaf node
                return [i]

        return None

    @deprecation_bookmark(bookmark="outline_item")
    def find_bookmark(
        self,
        outline_item: Dict[str, Any],
        root: Optional[OutlineType] = None,
    ) -> Optional[List[int]]:  # pragma: no cover
        """
        .. deprecated:: 2.9.0
            Use :meth:`find_outline_item` instead.
        """
        return self.find_outline_item(outline_item, root)

    def add_outline_item(
        self,
        title: str,
        page_number: Optional[int] = None,
        parent: Union[None, TreeObject, IndirectObject] = None,
        color: Optional[Tuple[float, float, float]] = None,
        bold: bool = False,
        italic: bool = False,
        fit: Fit = PAGE_FIT,
        pagenum: Optional[int] = None,  # deprecated
    ) -> IndirectObject:
        """
        Add an outline item (commonly referred to as a "Bookmark") to this PDF file.

        :param str title: Title to use for this outline item.
        :param int page_number: Page number this outline item will point to.
        :param parent: A reference to a parent outline item to create nested
            outline items.
        :param tuple color: Color of the outline item's font as a red, green, blue tuple
            from 0.0 to 1.0
        :param bool bold: Outline item font is bold
        :param bool italic: Outline item font is italic
        :param Fit fit: The fit of the destination page.
        """
        if page_number is not None and pagenum is not None:
            raise ValueError(
                "The argument pagenum of add_outline_item is deprecated. Use page_number only."
            )
        if pagenum is not None:
            old_term = "pagenum"
            new_term = "page_number"
            warnings.warn(
                (
                    f"{old_term} is deprecated as an argument and will be "
                    f"removed in PyPDF2==4.0.0. Use {new_term} instead"
                ),
                DeprecationWarning,
            )
            page_number = pagenum
        if page_number is None:
            raise ValueError("page_number may not be None")
        writer = self.output
        if writer is None:
            raise RuntimeError(ERR_CLOSED_WRITER)
        return writer.add_outline_item(
            title,
            page_number,
            parent,
            None,
            color,
            bold,
            italic,
            fit,
        )

    def addBookmark(
        self,
        title: str,
        pagenum: int,  # deprecated, but the whole method is deprecated
        parent: Union[None, TreeObject, IndirectObject] = None,
        color: Optional[Tuple[float, float, float]] = None,
        bold: bool = False,
        italic: bool = False,
        fit: FitType = "/Fit",
        *args: ZoomArgType,
    ) -> IndirectObject:  # pragma: no cover
        """
        .. deprecated:: 1.28.0
            Use :meth:`add_outline_item` instead.
        """
        deprecation_with_replacement("addBookmark", "add_outline_item", "3.0.0")
        return self.add_outline_item(
            title,
            pagenum,
            parent,
            color,
            bold,
            italic,
            Fit(fit_type=fit, fit_args=args),
        )

    def add_bookmark(
        self,
        title: str,
        pagenum: int,  # deprecated, but the whole method is deprecated already
        parent: Union[None, TreeObject, IndirectObject] = None,
        color: Optional[Tuple[float, float, float]] = None,
        bold: bool = False,
        italic: bool = False,
        fit: FitType = "/Fit",
        *args: ZoomArgType,
    ) -> IndirectObject:  # pragma: no cover
        """
        .. deprecated:: 2.9.0
            Use :meth:`add_outline_item` instead.
        """
        deprecation_with_replacement("addBookmark", "add_outline_item", "3.0.0")
        return self.add_outline_item(
            title,
            pagenum,
            parent,
            color,
            bold,
            italic,
            Fit(fit_type=fit, fit_args=args),
        )

    def addNamedDestination(self, title: str, pagenum: int) -> None:  # pragma: no cover
        """
        .. deprecated:: 1.28.0
            Use :meth:`add_named_destination` instead.
        """
        deprecation_with_replacement(
            "addNamedDestination", "add_named_destination", "3.0.0"
        )
        return self.add_named_destination(title, pagenum)

    def add_named_destination(
        self,
        title: str,
        page_number: Optional[int] = None,
        pagenum: Optional[int] = None,
    ) -> None:
        """
        Add a destination to the output.

        :param str title: Title to use
        :param int page_number: Page number this destination points at.
        """
        if page_number is not None and pagenum is not None:
            raise ValueError(
                "The argument pagenum of add_named_destination is deprecated. Use page_number only."
            )
        if pagenum is not None:
            old_term = "pagenum"
            new_term = "page_number"
            warnings.warn(
                (
                    f"{old_term} is deprecated as an argument and will be "
                    f"removed in PyPDF2==4.0.0. Use {new_term} instead"
                ),
                DeprecationWarning,
            )
            page_number = pagenum
        if page_number is None:
            raise ValueError("page_number may not be None")
        dest = Destination(
            TextStringObject(title),
            NumberObject(page_number),
            Fit.fit_horizontally(top=826),
        )
        self.named_dests.append(dest)


class PdfFileMerger(PdfMerger):  # pragma: no cover
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        deprecation_with_replacement("PdfFileMerger", "PdfMerger", "3.0.0")

        if "strict" not in kwargs and len(args) < 1:
            kwargs["strict"] = True  # maintain the default
        super().__init__(*args, **kwargs)
