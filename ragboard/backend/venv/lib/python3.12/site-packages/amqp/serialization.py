"""Convert between bytestreams and higher-level AMQP types.

2007-11-05 Barry Pederson <bp@barryp.org>

"""
# Copyright (C) 2007 Barry Pederson <bp@barryp.org>

import calendar
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from struct import pack, unpack_from

from .exceptions import FrameSyntaxError
from .spec import Basic
from .utils import bytes_to_str as pstr_t
from .utils import str_to_bytes

ILLEGAL_TABLE_TYPE = """\
    Table type {0!r} not handled by amqp.
"""

ILLEGAL_TABLE_TYPE_WITH_KEY = """\
Table type {0!r} for key {1!r} not handled by amqp. [value: {2!r}]
"""

ILLEGAL_TABLE_TYPE_WITH_VALUE = """\
    Table type {0!r} not handled by amqp. [value: {1!r}]
"""


def _read_item(buf, offset):
    ftype = chr(buf[offset])
    offset += 1

    # 'S': long string
    if ftype == 'S':
        slen, = unpack_from('>I', buf, offset)
        offset += 4
        try:
            val = pstr_t(buf[offset:offset + slen])
        except UnicodeDecodeError:
            val = buf[offset:offset + slen]

        offset += slen
    # 's': short string
    elif ftype == 's':
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        val = pstr_t(buf[offset:offset + slen])
        offset += slen
    # 'x': Bytes Array
    elif ftype == 'x':
        blen, = unpack_from('>I', buf, offset)
        offset += 4
        val = buf[offset:offset + blen]
        offset += blen
    # 'b': short-short int
    elif ftype == 'b':
        val, = unpack_from('>B', buf, offset)
        offset += 1
    # 'B': short-short unsigned int
    elif ftype == 'B':
        val, = unpack_from('>b', buf, offset)
        offset += 1
    # 'U': short int
    elif ftype == 'U':
        val, = unpack_from('>h', buf, offset)
        offset += 2
    # 'u': short unsigned int
    elif ftype == 'u':
        val, = unpack_from('>H', buf, offset)
        offset += 2
    # 'I': long int
    elif ftype == 'I':
        val, = unpack_from('>i', buf, offset)
        offset += 4
    # 'i': long unsigned int
    elif ftype == 'i':
        val, = unpack_from('>I', buf, offset)
        offset += 4
    # 'L': long long int
    elif ftype == 'L':
        val, = unpack_from('>q', buf, offset)
        offset += 8
    # 'l': long long unsigned int
    elif ftype == 'l':
        val, = unpack_from('>Q', buf, offset)
        offset += 8
    # 'f': float
    elif ftype == 'f':
        val, = unpack_from('>f', buf, offset)
        offset += 4
    # 'd': double
    elif ftype == 'd':
        val, = unpack_from('>d', buf, offset)
        offset += 8
    # 'D': decimal
    elif ftype == 'D':
        d, = unpack_from('>B', buf, offset)
        offset += 1
        n, = unpack_from('>i', buf, offset)
        offset += 4
        val = Decimal(n) / Decimal(10 ** d)
    # 'F': table
    elif ftype == 'F':
        tlen, = unpack_from('>I', buf, offset)
        offset += 4
        limit = offset + tlen
        val = {}
        while offset < limit:
            keylen, = unpack_from('>B', buf, offset)
            offset += 1
            key = pstr_t(buf[offset:offset + keylen])
            offset += keylen
            val[key], offset = _read_item(buf, offset)
    # 'A': array
    elif ftype == 'A':
        alen, = unpack_from('>I', buf, offset)
        offset += 4
        limit = offset + alen
        val = []
        while offset < limit:
            v, offset = _read_item(buf, offset)
            val.append(v)
    # 't' (bool)
    elif ftype == 't':
        val, = unpack_from('>B', buf, offset)
        val = bool(val)
        offset += 1
    # 'T': timestamp
    elif ftype == 'T':
        val, = unpack_from('>Q', buf, offset)
        offset += 8
        val = datetime.utcfromtimestamp(val)
    # 'V': void
    elif ftype == 'V':
        val = None
    else:
        raise FrameSyntaxError(
            'Unknown value in table: {!r} ({!r})'.format(
                ftype, type(ftype)))
    return val, offset


def loads(format, buf, offset):
    """Deserialize amqp format.

    bit = b
    octet = o
    short = B
    long = l
    long long = L
    float = f
    shortstr = s
    longstr = S
    table = F
    array = A
    timestamp = T
    """
    bitcount = bits = 0

    values = []
    append = values.append
    format = pstr_t(format)

    for p in format:
        if p == 'b':
            if not bitcount:
                bits = ord(buf[offset:offset + 1])
                offset += 1
                bitcount = 8
            val = (bits & 1) == 1
            bits >>= 1
            bitcount -= 1
        elif p == 'o':
            bitcount = bits = 0
            val, = unpack_from('>B', buf, offset)
            offset += 1
        elif p == 'B':
            bitcount = bits = 0
            val, = unpack_from('>H', buf, offset)
            offset += 2
        elif p == 'l':
            bitcount = bits = 0
            val, = unpack_from('>I', buf, offset)
            offset += 4
        elif p == 'L':
            bitcount = bits = 0
            val, = unpack_from('>Q', buf, offset)
            offset += 8
        elif p == 'f':
            bitcount = bits = 0
            val, = unpack_from('>f', buf, offset)
            offset += 4
        elif p == 's':
            bitcount = bits = 0
            slen, = unpack_from('B', buf, offset)
            offset += 1
            val = buf[offset:offset + slen].decode('utf-8', 'surrogatepass')
            offset += slen
        elif p == 'S':
            bitcount = bits = 0
            slen, = unpack_from('>I', buf, offset)
            offset += 4
            val = buf[offset:offset + slen].decode('utf-8', 'surrogatepass')
            offset += slen
        elif p == 'x':
            blen, = unpack_from('>I', buf, offset)
            offset += 4
            val = buf[offset:offset + blen]
            offset += blen
        elif p == 'F':
            bitcount = bits = 0
            tlen, = unpack_from('>I', buf, offset)
            offset += 4
            limit = offset + tlen
            val = {}
            while offset < limit:
                keylen, = unpack_from('>B', buf, offset)
                offset += 1
                key = pstr_t(buf[offset:offset + keylen])
                offset += keylen
                val[key], offset = _read_item(buf, offset)
        elif p == 'A':
            bitcount = bits = 0
            alen, = unpack_from('>I', buf, offset)
            offset += 4
            limit = offset + alen
            val = []
            while offset < limit:
                aval, offset = _read_item(buf, offset)
                val.append(aval)
        elif p == 'T':
            bitcount = bits = 0
            val, = unpack_from('>Q', buf, offset)
            offset += 8
            val = datetime.utcfromtimestamp(val)
        else:
            raise FrameSyntaxError(ILLEGAL_TABLE_TYPE.format(p))
        append(val)
    return values, offset


def _flushbits(bits, write):
    if bits:
        write(pack('B' * len(bits), *bits))
        bits[:] = []
    return 0


def dumps(format, values):
    """Serialize AMQP arguments.

    Notes:
        bit = b
        octet = o
        short = B
        long = l
        long long = L
        shortstr = s
        longstr = S
        byte array = x
        table = F
        array = A
    """
    bitcount = 0
    bits = []
    out = BytesIO()
    write = out.write

    format = pstr_t(format)

    for i, val in enumerate(values):
        p = format[i]
        if p == 'b':
            val = 1 if val else 0
            shift = bitcount % 8
            if shift == 0:
                bits.append(0)
            bits[-1] |= (val << shift)
            bitcount += 1
        elif p == 'o':
            bitcount = _flushbits(bits, write)
            write(pack('B', val))
        elif p == 'B':
            bitcount = _flushbits(bits, write)
            write(pack('>H', int(val)))
        elif p == 'l':
            bitcount = _flushbits(bits, write)
            write(pack('>I', val))
        elif p == 'L':
            bitcount = _flushbits(bits, write)
            write(pack('>Q', val))
        elif p == 'f':
            bitcount = _flushbits(bits, write)
            write(pack('>f', val))
        elif p == 's':
            val = val or ''
            bitcount = _flushbits(bits, write)
            if isinstance(val, str):
                val = val.encode('utf-8', 'surrogatepass')
            write(pack('B', len(val)))
            write(val)
        elif p == 'S' or p == 'x':
            val = val or ''
            bitcount = _flushbits(bits, write)
            if isinstance(val, str):
                val = val.encode('utf-8', 'surrogatepass')
            write(pack('>I', len(val)))
            write(val)
        elif p == 'F':
            bitcount = _flushbits(bits, write)
            _write_table(val or {}, write, bits)
        elif p == 'A':
            bitcount = _flushbits(bits, write)
            _write_array(val or [], write, bits)
        elif p == 'T':
            write(pack('>Q', int(calendar.timegm(val.utctimetuple()))))
    _flushbits(bits, write)

    return out.getvalue()


def _write_table(d, write, bits):
    out = BytesIO()
    twrite = out.write
    for k, v in d.items():
        if isinstance(k, str):
            k = k.encode('utf-8', 'surrogatepass')
        twrite(pack('B', len(k)))
        twrite(k)
        try:
            _write_item(v, twrite, bits)
        except ValueError:
            raise FrameSyntaxError(
                ILLEGAL_TABLE_TYPE_WITH_KEY.format(type(v), k, v))
    table_data = out.getvalue()
    write(pack('>I', len(table_data)))
    write(table_data)


def _write_array(list_, write, bits):
    out = BytesIO()
    awrite = out.write
    for v in list_:
        try:
            _write_item(v, awrite, bits)
        except ValueError:
            raise FrameSyntaxError(
                ILLEGAL_TABLE_TYPE_WITH_VALUE.format(type(v), v))
    array_data = out.getvalue()
    write(pack('>I', len(array_data)))
    write(array_data)


def _write_item(v, write, bits):
    if isinstance(v, (str, bytes)):
        if isinstance(v, str):
            v = v.encode('utf-8', 'surrogatepass')
        write(pack('>cI', b'S', len(v)))
        write(v)
    elif isinstance(v, bool):
        write(pack('>cB', b't', int(v)))
    elif isinstance(v, float):
        write(pack('>cd', b'd', v))
    elif isinstance(v, int):
        if v > 2147483647 or v < -2147483647:
            write(pack('>cq', b'L', v))
        else:
            write(pack('>ci', b'I', v))
    elif isinstance(v, Decimal):
        sign, digits, exponent = v.as_tuple()
        v = 0
        for d in digits:
            v = (v * 10) + d
        if sign:
            v = -v
        write(pack('>cBi', b'D', -exponent, v))
    elif isinstance(v, datetime):
        write(
            pack('>cQ', b'T', int(calendar.timegm(v.utctimetuple()))))
    elif isinstance(v, dict):
        write(b'F')
        _write_table(v, write, bits)
    elif isinstance(v, (list, tuple)):
        write(b'A')
        _write_array(v, write, bits)
    elif v is None:
        write(b'V')
    else:
        raise ValueError()


def decode_properties_basic(buf, offset):
    """Decode basic properties."""
    properties = {}

    flags, = unpack_from('>H', buf, offset)
    offset += 2

    if flags & 0x8000:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['content_type'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x4000:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['content_encoding'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x2000:
        _f, offset = loads('F', buf, offset)
        properties['application_headers'], = _f
    if flags & 0x1000:
        properties['delivery_mode'], = unpack_from('>B', buf, offset)
        offset += 1
    if flags & 0x0800:
        properties['priority'], = unpack_from('>B', buf, offset)
        offset += 1
    if flags & 0x0400:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['correlation_id'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x0200:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['reply_to'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x0100:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['expiration'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x0080:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['message_id'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x0040:
        properties['timestamp'], = unpack_from('>Q', buf, offset)
        offset += 8
    if flags & 0x0020:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['type'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x0010:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['user_id'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x0008:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['app_id'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    if flags & 0x0004:
        slen, = unpack_from('>B', buf, offset)
        offset += 1
        properties['cluster_id'] = pstr_t(buf[offset:offset + slen])
        offset += slen
    return properties, offset


PROPERTY_CLASSES = {
    Basic.CLASS_ID: decode_properties_basic,
}


class GenericContent:
    """Abstract base class for AMQP content.

    Subclasses should override the PROPERTIES attribute.
    """

    CLASS_ID = None
    PROPERTIES = [('dummy', 's')]

    def __init__(self, frame_method=None, frame_args=None, **props):
        self.frame_method = frame_method
        self.frame_args = frame_args

        self.properties = props
        self._pending_chunks = []
        self.body_received = 0
        self.body_size = 0
        self.ready = False

    __slots__ = (
        "frame_method",
        "frame_args",
        "properties",
        "_pending_chunks",
        "body_received",
        "body_size",
        "ready",
        # adding '__dict__' to get dynamic assignment
        "__dict__",
        "__weakref__",
        )

    def __getattr__(self, name):
        # Look for additional properties in the 'properties'
        # dictionary, and if present - the 'delivery_info' dictionary.
        if name == '__setstate__':
            # Allows pickling/unpickling to work
            raise AttributeError('__setstate__')

        if name in self.properties:
            return self.properties[name]
        raise AttributeError(name)

    def _load_properties(self, class_id, buf, offset):
        """Load AMQP properties.

        Given the raw bytes containing the property-flags and property-list
        from a content-frame-header, parse and insert into a dictionary
        stored in this object as an attribute named 'properties'.
        """
        # Read 16-bit shorts until we get one with a low bit set to zero
        props, offset = PROPERTY_CLASSES[class_id](buf, offset)
        self.properties = props
        return offset

    def _serialize_properties(self):
        """Serialize AMQP properties.

        Serialize the 'properties' attribute (a dictionary) into
        the raw bytes making up a set of property flags and a
        property list, suitable for putting into a content frame header.
        """
        shift = 15
        flag_bits = 0
        flags = []
        sformat, svalues = [], []
        props = self.properties
        for key, proptype in self.PROPERTIES:
            val = props.get(key, None)
            if val is not None:
                if shift == 0:
                    flags.append(flag_bits)
                    flag_bits = 0
                    shift = 15

                flag_bits |= (1 << shift)
                if proptype != 'bit':
                    sformat.append(str_to_bytes(proptype))
                    svalues.append(val)

            shift -= 1
        flags.append(flag_bits)
        result = BytesIO()
        write = result.write
        for flag_bits in flags:
            write(pack('>H', flag_bits))
        write(dumps(b''.join(sformat), svalues))

        return result.getvalue()

    def inbound_header(self, buf, offset=0):
        class_id, self.body_size = unpack_from('>HxxQ', buf, offset)
        offset += 12
        self._load_properties(class_id, buf, offset)
        if not self.body_size:
            self.ready = True
        return offset

    def inbound_body(self, buf):
        chunks = self._pending_chunks
        self.body_received += len(buf)
        if self.body_received >= self.body_size:
            if chunks:
                chunks.append(buf)
                self.body = bytes().join(chunks)
                chunks[:] = []
            else:
                self.body = buf
            self.ready = True
        else:
            chunks.append(buf)
