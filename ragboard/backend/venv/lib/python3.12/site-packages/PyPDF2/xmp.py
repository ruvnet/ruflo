"""
Anything related to XMP metadata.

See https://en.wikipedia.org/wiki/Extensible_Metadata_Platform
"""

import datetime
import decimal
import re
from typing import (
    Any,
    Callable,
    Dict,
    Iterator,
    List,
    Optional,
    TypeVar,
    Union,
    cast,
)
from xml.dom.minidom import Document
from xml.dom.minidom import Element as XmlElement
from xml.dom.minidom import parseString
from xml.parsers.expat import ExpatError

from ._utils import (
    StreamType,
    deprecate_with_replacement,
    deprecation_with_replacement,
)
from .errors import PdfReadError
from .generic import ContentStream, PdfObject

RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
DC_NAMESPACE = "http://purl.org/dc/elements/1.1/"
XMP_NAMESPACE = "http://ns.adobe.com/xap/1.0/"
PDF_NAMESPACE = "http://ns.adobe.com/pdf/1.3/"
XMPMM_NAMESPACE = "http://ns.adobe.com/xap/1.0/mm/"

# What is the PDFX namespace, you might ask?  I might ask that too.  It's
# a completely undocumented namespace used to place "custom metadata"
# properties, which are arbitrary metadata properties with no semantic or
# documented meaning.  Elements in the namespace are key/value-style storage,
# where the element name is the key and the content is the value.  The keys
# are transformed into valid XML identifiers by substituting an invalid
# identifier character with \u2182 followed by the unicode hex ID of the
# original character.  A key like "my car" is therefore "my\u21820020car".
#
# \u2182, in case you're wondering, is the unicode character
# \u{ROMAN NUMERAL TEN THOUSAND}, a straightforward and obvious choice for
# escaping characters.
#
# Intentional users of the pdfx namespace should be shot on sight.  A
# custom data schema and sensical XML elements could be used instead, as is
# suggested by Adobe's own documentation on XMP (under "Extensibility of
# Schemas").
#
# Information presented here on the /pdfx/ schema is a result of limited
# reverse engineering, and does not constitute a full specification.
PDFX_NAMESPACE = "http://ns.adobe.com/pdfx/1.3/"

iso8601 = re.compile(
    """
        (?P<year>[0-9]{4})
        (-
            (?P<month>[0-9]{2})
            (-
                (?P<day>[0-9]+)
                (T
                    (?P<hour>[0-9]{2}):
                    (?P<minute>[0-9]{2})
                    (:(?P<second>[0-9]{2}(.[0-9]+)?))?
                    (?P<tzd>Z|[-+][0-9]{2}:[0-9]{2})
                )?
            )?
        )?
        """,
    re.VERBOSE,
)


K = TypeVar("K")


def _identity(value: K) -> K:
    return value


def _converter_date(value: str) -> datetime.datetime:
    matches = iso8601.match(value)
    if matches is None:
        raise ValueError(f"Invalid date format: {value}")
    year = int(matches.group("year"))
    month = int(matches.group("month") or "1")
    day = int(matches.group("day") or "1")
    hour = int(matches.group("hour") or "0")
    minute = int(matches.group("minute") or "0")
    second = decimal.Decimal(matches.group("second") or "0")
    seconds_dec = second.to_integral(decimal.ROUND_FLOOR)
    milliseconds_dec = (second - seconds_dec) * 1000000

    seconds = int(seconds_dec)
    milliseconds = int(milliseconds_dec)

    tzd = matches.group("tzd") or "Z"
    dt = datetime.datetime(year, month, day, hour, minute, seconds, milliseconds)
    if tzd != "Z":
        tzd_hours, tzd_minutes = (int(x) for x in tzd.split(":"))
        tzd_hours *= -1
        if tzd_hours < 0:
            tzd_minutes *= -1
        dt = dt + datetime.timedelta(hours=tzd_hours, minutes=tzd_minutes)
    return dt


def _getter_bag(
    namespace: str, name: str
) -> Callable[["XmpInformation"], Optional[List[str]]]:
    def get(self: "XmpInformation") -> Optional[List[str]]:
        cached = self.cache.get(namespace, {}).get(name)
        if cached:
            return cached
        retval = []
        for element in self.get_element("", namespace, name):
            bags = element.getElementsByTagNameNS(RDF_NAMESPACE, "Bag")
            if len(bags):
                for bag in bags:
                    for item in bag.getElementsByTagNameNS(RDF_NAMESPACE, "li"):
                        value = self._get_text(item)
                        retval.append(value)
        ns_cache = self.cache.setdefault(namespace, {})
        ns_cache[name] = retval
        return retval

    return get


def _getter_seq(
    namespace: str, name: str, converter: Callable[[Any], Any] = _identity
) -> Callable[["XmpInformation"], Optional[List[Any]]]:
    def get(self: "XmpInformation") -> Optional[List[Any]]:
        cached = self.cache.get(namespace, {}).get(name)
        if cached:
            return cached
        retval = []
        for element in self.get_element("", namespace, name):
            seqs = element.getElementsByTagNameNS(RDF_NAMESPACE, "Seq")
            if len(seqs):
                for seq in seqs:
                    for item in seq.getElementsByTagNameNS(RDF_NAMESPACE, "li"):
                        value = self._get_text(item)
                        value = converter(value)
                        retval.append(value)
            else:
                value = converter(self._get_text(element))
                retval.append(value)
        ns_cache = self.cache.setdefault(namespace, {})
        ns_cache[name] = retval
        return retval

    return get


def _getter_langalt(
    namespace: str, name: str
) -> Callable[["XmpInformation"], Optional[Dict[Any, Any]]]:
    def get(self: "XmpInformation") -> Optional[Dict[Any, Any]]:
        cached = self.cache.get(namespace, {}).get(name)
        if cached:
            return cached
        retval = {}
        for element in self.get_element("", namespace, name):
            alts = element.getElementsByTagNameNS(RDF_NAMESPACE, "Alt")
            if len(alts):
                for alt in alts:
                    for item in alt.getElementsByTagNameNS(RDF_NAMESPACE, "li"):
                        value = self._get_text(item)
                        retval[item.getAttribute("xml:lang")] = value
            else:
                retval["x-default"] = self._get_text(element)
        ns_cache = self.cache.setdefault(namespace, {})
        ns_cache[name] = retval
        return retval

    return get


def _getter_single(
    namespace: str, name: str, converter: Callable[[str], Any] = _identity
) -> Callable[["XmpInformation"], Optional[Any]]:
    def get(self: "XmpInformation") -> Optional[Any]:
        cached = self.cache.get(namespace, {}).get(name)
        if cached:
            return cached
        value = None
        for element in self.get_element("", namespace, name):
            if element.nodeType == element.ATTRIBUTE_NODE:
                value = element.nodeValue
            else:
                value = self._get_text(element)
            break
        if value is not None:
            value = converter(value)
        ns_cache = self.cache.setdefault(namespace, {})
        ns_cache[name] = value
        return value

    return get


class XmpInformation(PdfObject):
    """
    An object that represents Adobe XMP metadata.
    Usually accessed by :py:attr:`xmp_metadata()<PyPDF2.PdfReader.xmp_metadata>`

    :raises PdfReadError: if XML is invalid
    """

    def __init__(self, stream: ContentStream) -> None:
        self.stream = stream
        try:
            data = self.stream.get_data()
            doc_root: Document = parseString(data)
        except ExpatError as e:
            raise PdfReadError(f"XML in XmpInformation was invalid: {e}")
        self.rdf_root: XmlElement = doc_root.getElementsByTagNameNS(
            RDF_NAMESPACE, "RDF"
        )[0]
        self.cache: Dict[Any, Any] = {}

    @property
    def rdfRoot(self) -> XmlElement:  # pragma: no cover
        deprecate_with_replacement("rdfRoot", "rdf_root", "4.0.0")
        return self.rdf_root

    def write_to_stream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:
        self.stream.write_to_stream(stream, encryption_key)

    def writeToStream(
        self, stream: StreamType, encryption_key: Union[None, str, bytes]
    ) -> None:  # pragma: no cover
        """
        .. deprecated:: 1.28.0

            Use :meth:`write_to_stream` instead.
        """
        deprecation_with_replacement("writeToStream", "write_to_stream", "3.0.0")
        self.write_to_stream(stream, encryption_key)

    def get_element(self, about_uri: str, namespace: str, name: str) -> Iterator[Any]:
        for desc in self.rdf_root.getElementsByTagNameNS(RDF_NAMESPACE, "Description"):
            if desc.getAttributeNS(RDF_NAMESPACE, "about") == about_uri:
                attr = desc.getAttributeNodeNS(namespace, name)
                if attr is not None:
                    yield attr
                yield from desc.getElementsByTagNameNS(namespace, name)

    def getElement(
        self, aboutUri: str, namespace: str, name: str
    ) -> Iterator[Any]:  # pragma: no cover
        """
        .. deprecated:: 1.28.0

            Use :meth:`get_element` instead.
        """
        deprecation_with_replacement("getElement", "get_element", "3.0.0")
        return self.get_element(aboutUri, namespace, name)

    def get_nodes_in_namespace(self, about_uri: str, namespace: str) -> Iterator[Any]:
        for desc in self.rdf_root.getElementsByTagNameNS(RDF_NAMESPACE, "Description"):
            if desc.getAttributeNS(RDF_NAMESPACE, "about") == about_uri:
                for i in range(desc.attributes.length):
                    attr = desc.attributes.item(i)
                    if attr.namespaceURI == namespace:
                        yield attr
                for child in desc.childNodes:
                    if child.namespaceURI == namespace:
                        yield child

    def getNodesInNamespace(
        self, aboutUri: str, namespace: str
    ) -> Iterator[Any]:  # pragma: no cover
        """
        .. deprecated:: 1.28.0

            Use :meth:`get_nodes_in_namespace` instead.
        """
        deprecation_with_replacement(
            "getNodesInNamespace", "get_nodes_in_namespace", "3.0.0"
        )
        return self.get_nodes_in_namespace(aboutUri, namespace)

    def _get_text(self, element: XmlElement) -> str:
        text = ""
        for child in element.childNodes:
            if child.nodeType == child.TEXT_NODE:
                text += child.data
        return text

    dc_contributor = property(_getter_bag(DC_NAMESPACE, "contributor"))
    """
    Contributors to the resource (other than the authors). An unsorted
    array of names.
    """

    dc_coverage = property(_getter_single(DC_NAMESPACE, "coverage"))
    """
    Text describing the extent or scope of the resource.
    """

    dc_creator = property(_getter_seq(DC_NAMESPACE, "creator"))
    """
    A sorted array of names of the authors of the resource, listed in order
    of precedence.
    """

    dc_date = property(_getter_seq(DC_NAMESPACE, "date", _converter_date))
    """
    A sorted array of dates (datetime.datetime instances) of significance to
    the resource.  The dates and times are in UTC.
    """

    dc_description = property(_getter_langalt(DC_NAMESPACE, "description"))
    """
    A language-keyed dictionary of textual descriptions of the content of the
    resource.
    """

    dc_format = property(_getter_single(DC_NAMESPACE, "format"))
    """
    The mime-type of the resource.
    """

    dc_identifier = property(_getter_single(DC_NAMESPACE, "identifier"))
    """
    Unique identifier of the resource.
    """

    dc_language = property(_getter_bag(DC_NAMESPACE, "language"))
    """
    An unordered array specifying the languages used in the resource.
    """

    dc_publisher = property(_getter_bag(DC_NAMESPACE, "publisher"))
    """
    An unordered array of publisher names.
    """

    dc_relation = property(_getter_bag(DC_NAMESPACE, "relation"))
    """
    An unordered array of text descriptions of relationships to other
    documents.
    """

    dc_rights = property(_getter_langalt(DC_NAMESPACE, "rights"))
    """
    A language-keyed dictionary of textual descriptions of the rights the
    user has to this resource.
    """

    dc_source = property(_getter_single(DC_NAMESPACE, "source"))
    """
    Unique identifier of the work from which this resource was derived.
    """

    dc_subject = property(_getter_bag(DC_NAMESPACE, "subject"))
    """
    An unordered array of descriptive phrases or keywrods that specify the
    topic of the content of the resource.
    """

    dc_title = property(_getter_langalt(DC_NAMESPACE, "title"))
    """
    A language-keyed dictionary of the title of the resource.
    """

    dc_type = property(_getter_bag(DC_NAMESPACE, "type"))
    """
    An unordered array of textual descriptions of the document type.
    """

    pdf_keywords = property(_getter_single(PDF_NAMESPACE, "Keywords"))
    """
    An unformatted text string representing document keywords.
    """

    pdf_pdfversion = property(_getter_single(PDF_NAMESPACE, "PDFVersion"))
    """
    The PDF file version, for example 1.0, 1.3.
    """

    pdf_producer = property(_getter_single(PDF_NAMESPACE, "Producer"))
    """
    The name of the tool that created the PDF document.
    """

    xmp_create_date = property(
        _getter_single(XMP_NAMESPACE, "CreateDate", _converter_date)
    )
    """
    The date and time the resource was originally created.  The date and
    time are returned as a UTC datetime.datetime object.
    """

    @property
    def xmp_createDate(self) -> datetime.datetime:  # pragma: no cover
        deprecate_with_replacement("xmp_createDate", "xmp_create_date", "4.0.0")
        return self.xmp_create_date

    @xmp_createDate.setter
    def xmp_createDate(self, value: datetime.datetime) -> None:  # pragma: no cover
        deprecate_with_replacement("xmp_createDate", "xmp_create_date", "4.0.0")
        self.xmp_create_date = value

    xmp_modify_date = property(
        _getter_single(XMP_NAMESPACE, "ModifyDate", _converter_date)
    )
    """
    The date and time the resource was last modified.  The date and time
    are returned as a UTC datetime.datetime object.
    """

    @property
    def xmp_modifyDate(self) -> datetime.datetime:  # pragma: no cover
        deprecate_with_replacement("xmp_modifyDate", "xmp_modify_date", "4.0.0")
        return self.xmp_modify_date

    @xmp_modifyDate.setter
    def xmp_modifyDate(self, value: datetime.datetime) -> None:  # pragma: no cover
        deprecate_with_replacement("xmp_modifyDate", "xmp_modify_date", "4.0.0")
        self.xmp_modify_date = value

    xmp_metadata_date = property(
        _getter_single(XMP_NAMESPACE, "MetadataDate", _converter_date)
    )
    """
    The date and time that any metadata for this resource was last changed.

    The date and time are returned as a UTC datetime.datetime object.
    """

    @property
    def xmp_metadataDate(self) -> datetime.datetime:  # pragma: no cover
        deprecate_with_replacement("xmp_metadataDate", "xmp_metadata_date", "4.0.0")
        return self.xmp_metadata_date

    @xmp_metadataDate.setter
    def xmp_metadataDate(self, value: datetime.datetime) -> None:  # pragma: no cover
        deprecate_with_replacement("xmp_metadataDate", "xmp_metadata_date", "4.0.0")
        self.xmp_metadata_date = value

    xmp_creator_tool = property(_getter_single(XMP_NAMESPACE, "CreatorTool"))
    """The name of the first known tool used to create the resource."""

    @property
    def xmp_creatorTool(self) -> str:  # pragma: no cover
        deprecation_with_replacement("xmp_creatorTool", "xmp_creator_tool", "3.0.0")
        return self.xmp_creator_tool

    @xmp_creatorTool.setter
    def xmp_creatorTool(self, value: str) -> None:  # pragma: no cover
        deprecation_with_replacement("xmp_creatorTool", "xmp_creator_tool", "3.0.0")
        self.xmp_creator_tool = value

    xmpmm_document_id = property(_getter_single(XMPMM_NAMESPACE, "DocumentID"))
    """
    The common identifier for all versions and renditions of this resource.
    """

    @property
    def xmpmm_documentId(self) -> str:  # pragma: no cover
        deprecation_with_replacement("xmpmm_documentId", "xmpmm_document_id", "3.0.0")
        return self.xmpmm_document_id

    @xmpmm_documentId.setter
    def xmpmm_documentId(self, value: str) -> None:  # pragma: no cover
        deprecation_with_replacement("xmpmm_documentId", "xmpmm_document_id", "3.0.0")
        self.xmpmm_document_id = value

    xmpmm_instance_id = property(_getter_single(XMPMM_NAMESPACE, "InstanceID"))
    """
    An identifier for a specific incarnation of a document, updated each
    time a file is saved.
    """

    @property
    def xmpmm_instanceId(self) -> str:  # pragma: no cover
        deprecation_with_replacement("xmpmm_instanceId", "xmpmm_instance_id", "3.0.0")
        return cast(str, self.xmpmm_instance_id)

    @xmpmm_instanceId.setter
    def xmpmm_instanceId(self, value: str) -> None:  # pragma: no cover
        deprecation_with_replacement("xmpmm_instanceId", "xmpmm_instance_id", "3.0.0")
        self.xmpmm_instance_id = value

    @property
    def custom_properties(self) -> Dict[Any, Any]:
        """
        Retrieve custom metadata properties defined in the undocumented pdfx
        metadata schema.

        :return: a dictionary of key/value items for custom metadata properties.
        """
        if not hasattr(self, "_custom_properties"):
            self._custom_properties = {}
            for node in self.get_nodes_in_namespace("", PDFX_NAMESPACE):
                key = node.localName
                while True:
                    # see documentation about PDFX_NAMESPACE earlier in file
                    idx = key.find("\u2182")
                    if idx == -1:
                        break
                    key = (
                        key[:idx]
                        + chr(int(key[idx + 1 : idx + 5], base=16))
                        + key[idx + 5 :]
                    )
                if node.nodeType == node.ATTRIBUTE_NODE:
                    value = node.nodeValue
                else:
                    value = self._get_text(node)
                self._custom_properties[key] = value
        return self._custom_properties
