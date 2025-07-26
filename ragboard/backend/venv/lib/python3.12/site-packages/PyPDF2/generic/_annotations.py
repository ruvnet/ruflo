from typing import Optional, Tuple, Union

from ._base import (
    BooleanObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)
from ._data_structures import ArrayObject, DictionaryObject
from ._fit import DEFAULT_FIT, Fit
from ._rectangle import RectangleObject
from ._utils import hex_to_rgb


class AnnotationBuilder:
    """
    The AnnotationBuilder creates dictionaries representing PDF annotations.

    Those dictionaries can be modified before they are added to a PdfWriter
    instance via `writer.add_annotation`.

    See `adding PDF annotations <../user/adding-pdf-annotations.html>`_ for
    it's usage combined with PdfWriter.
    """

    from ..types import FitType, ZoomArgType

    @staticmethod
    def text(
        rect: Union[RectangleObject, Tuple[float, float, float, float]],
        text: str,
        open: bool = False,
        flags: int = 0,
    ) -> DictionaryObject:
        """
        Add text annotation.

        :param Tuple[int, int, int, int] rect:
            or array of four integers specifying the clickable rectangular area
            ``[xLL, yLL, xUR, yUR]``
        :param bool open:
        :param int flags:
        """
        # TABLE 8.23 Additional entries specific to a text annotation
        text_obj = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Text"),
                NameObject("/Rect"): RectangleObject(rect),
                NameObject("/Contents"): TextStringObject(text),
                NameObject("/Open"): BooleanObject(open),
                NameObject("/Flags"): NumberObject(flags),
            }
        )
        return text_obj

    @staticmethod
    def free_text(
        text: str,
        rect: Union[RectangleObject, Tuple[float, float, float, float]],
        font: str = "Helvetica",
        bold: bool = False,
        italic: bool = False,
        font_size: str = "14pt",
        font_color: str = "000000",
        border_color: str = "000000",
        background_color: str = "ffffff",
    ) -> DictionaryObject:
        """
        Add text in a rectangle to a page.

        :param str text: Text to be added
        :param RectangleObject rect: or array of four integers
            specifying the clickable rectangular area ``[xLL, yLL, xUR, yUR]``
        :param str font: Name of the Font, e.g. 'Helvetica'
        :param bool bold: Print the text in bold
        :param bool italic: Print the text in italic
        :param str font_size: How big the text will be, e.g. '14pt'
        :param str font_color: Hex-string for the color
        :param str border_color: Hex-string for the border color
        :param str background_color: Hex-string for the background of the annotation
        """
        font_str = "font: "
        if bold is True:
            font_str = font_str + "bold "
        if italic is True:
            font_str = font_str + "italic "
        font_str = font_str + font + " " + font_size
        font_str = font_str + ";text-align:left;color:#" + font_color

        bg_color_str = ""
        for st in hex_to_rgb(border_color):
            bg_color_str = bg_color_str + str(st) + " "
        bg_color_str = bg_color_str + "rg"

        free_text = DictionaryObject()
        free_text.update(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/FreeText"),
                NameObject("/Rect"): RectangleObject(rect),
                NameObject("/Contents"): TextStringObject(text),
                # font size color
                NameObject("/DS"): TextStringObject(font_str),
                # border color
                NameObject("/DA"): TextStringObject(bg_color_str),
                # background color
                NameObject("/C"): ArrayObject(
                    [FloatObject(n) for n in hex_to_rgb(background_color)]
                ),
            }
        )
        return free_text

    @staticmethod
    def line(
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        rect: Union[RectangleObject, Tuple[float, float, float, float]],
        text: str = "",
        title_bar: str = "",
    ) -> DictionaryObject:
        """
        Draw a line on the PDF.

        :param Tuple[float, float] p1: First point
        :param Tuple[float, float] p2: Second point
        :param RectangleObject rect: or array of four
                integers specifying the clickable rectangular area
                ``[xLL, yLL, xUR, yUR]``
        :param str text: Text to be displayed as the line annotation
        :param str title_bar: Text to be displayed in the title bar of the
            annotation; by convention this is the name of the author
        """
        line_obj = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Line"),
                NameObject("/Rect"): RectangleObject(rect),
                NameObject("/T"): TextStringObject(title_bar),
                NameObject("/L"): ArrayObject(
                    [
                        FloatObject(p1[0]),
                        FloatObject(p1[1]),
                        FloatObject(p2[0]),
                        FloatObject(p2[1]),
                    ]
                ),
                NameObject("/LE"): ArrayObject(
                    [
                        NameObject(None),
                        NameObject(None),
                    ]
                ),
                NameObject("/IC"): ArrayObject(
                    [
                        FloatObject(0.5),
                        FloatObject(0.5),
                        FloatObject(0.5),
                    ]
                ),
                NameObject("/Contents"): TextStringObject(text),
            }
        )
        return line_obj

    @staticmethod
    def rectangle(
        rect: Union[RectangleObject, Tuple[float, float, float, float]],
        interiour_color: Optional[str] = None,
    ) -> DictionaryObject:
        """
        Draw a rectangle on the PDF.

        :param RectangleObject rect: or array of four
                integers specifying the clickable rectangular area
                ``[xLL, yLL, xUR, yUR]``
        """
        square_obj = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Square"),
                NameObject("/Rect"): RectangleObject(rect),
            }
        )

        if interiour_color:
            square_obj[NameObject("/IC")] = ArrayObject(
                [FloatObject(n) for n in hex_to_rgb(interiour_color)]
            )

        return square_obj

    @staticmethod
    def link(
        rect: Union[RectangleObject, Tuple[float, float, float, float]],
        border: Optional[ArrayObject] = None,
        url: Optional[str] = None,
        target_page_index: Optional[int] = None,
        fit: Fit = DEFAULT_FIT,
    ) -> DictionaryObject:
        """
        Add a link to the document.

        The link can either be an external link or an internal link.

        An external link requires the URL parameter.
        An internal link requires the target_page_index, fit, and fit args.


        :param RectangleObject rect: or array of four
            integers specifying the clickable rectangular area
            ``[xLL, yLL, xUR, yUR]``
        :param border: if provided, an array describing border-drawing
            properties. See the PDF spec for details. No border will be
            drawn if this argument is omitted.
            - horizontal corner radius,
            - vertical corner radius, and
            - border width
            - Optionally: Dash
        :param str url: Link to a website (if you want to make an external link)
        :param int target_page_index: index of the page to which the link should go
                                (if you want to make an internal link)
        :param Fit fit: Page fit or 'zoom' option.
        """
        from ..types import BorderArrayType

        is_external = url is not None
        is_internal = target_page_index is not None
        if not is_external and not is_internal:
            raise ValueError(
                "Either 'url' or 'target_page_index' have to be provided. Both were None."
            )
        if is_external and is_internal:
            raise ValueError(
                f"Either 'url' or 'target_page_index' have to be provided. url={url}, target_page_index={target_page_index}"
            )

        border_arr: BorderArrayType
        if border is not None:
            border_arr = [NameObject(n) for n in border[:3]]
            if len(border) == 4:
                dash_pattern = ArrayObject([NameObject(n) for n in border[3]])
                border_arr.append(dash_pattern)
        else:
            border_arr = [NumberObject(0)] * 3

        link_obj = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Link"),
                NameObject("/Rect"): RectangleObject(rect),
                NameObject("/Border"): ArrayObject(border_arr),
            }
        )
        if is_external:
            link_obj[NameObject("/A")] = DictionaryObject(
                {
                    NameObject("/S"): NameObject("/URI"),
                    NameObject("/Type"): NameObject("/Action"),
                    NameObject("/URI"): TextStringObject(url),
                }
            )
        if is_internal:
            # This needs to be updated later!
            dest_deferred = DictionaryObject(
                {
                    "target_page_index": NumberObject(target_page_index),
                    "fit": NameObject(fit.fit_type),
                    "fit_args": fit.fit_args,
                }
            )
            link_obj[NameObject("/Dest")] = dest_deferred
        return link_obj
