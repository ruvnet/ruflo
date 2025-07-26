"""
PyPDF2 is a free and open-source pure-python PDF library capable of splitting,
merging, cropping, and transforming the pages of PDF files. It can also add
custom data, viewing options, and passwords to PDF files. PyPDF2 can retrieve
text and metadata from PDFs as well.

You can read the full docs at https://pypdf2.readthedocs.io/.
"""

import warnings

from ._encryption import PasswordType
from ._merger import PdfFileMerger, PdfMerger
from ._page import PageObject, Transformation
from ._reader import DocumentInformation, PdfFileReader, PdfReader
from ._version import __version__
from ._writer import PdfFileWriter, PdfWriter
from .pagerange import PageRange, parse_filename_page_ranges
from .papersizes import PaperSize

warnings.warn(
    message="PyPDF2 is deprecated. Please move to the pypdf library instead.",
    category=DeprecationWarning,
)

__all__ = [
    "__version__",
    "PageRange",
    "PaperSize",
    "DocumentInformation",
    "parse_filename_page_ranges",
    "PdfFileMerger",  # will be removed in PyPDF2 3.0.0; use PdfMerger instead
    "PdfFileReader",  # will be removed in PyPDF2 3.0.0; use PdfReader instead
    "PdfFileWriter",  # will be removed in PyPDF2 3.0.0; use PdfWriter instead
    "PdfMerger",
    "PdfReader",
    "PdfWriter",
    "Transformation",
    "PageObject",
    "PasswordType",
]
