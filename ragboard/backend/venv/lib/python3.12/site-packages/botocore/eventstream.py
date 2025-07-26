# Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
"""Binary Event Stream Decoding"""

from binascii import crc32
from struct import unpack

from botocore.exceptions import EventStreamError

# byte length of the prelude (total_length + header_length + prelude_crc)
_PRELUDE_LENGTH = 12
_MAX_HEADERS_LENGTH = 128 * 1024  # 128 Kb
_MAX_PAYLOAD_LENGTH = 16 * 1024**2  # 16 Mb


class ParserError(Exception):
    """Base binary flow encoding parsing exception."""

    pass


class DuplicateHeader(ParserError):
    """Duplicate header found in the event."""

    def __init__(self, header):
        message = f'Duplicate header present: "{header}"'
        super().__init__(message)


class InvalidHeadersLength(ParserError):
    """Headers length is longer than the maximum."""

    def __init__(self, length):
        message = f'Header length of {length} exceeded the maximum of {_MAX_HEADERS_LENGTH}'
        super().__init__(message)


class InvalidPayloadLength(ParserError):
    """Payload length is longer than the maximum."""

    def __init__(self, length):
        message = f'Payload length of {length} exceeded the maximum of {_MAX_PAYLOAD_LENGTH}'
        super().__init__(message)


class ChecksumMismatch(ParserError):
    """Calculated checksum did not match the expected checksum."""

    def __init__(self, expected, calculated):
        message = f'Checksum mismatch: expected 0x{expected:08x}, calculated 0x{calculated:08x}'
        super().__init__(message)


class NoInitialResponseError(ParserError):
    """An event of type initial-response was not received.

    This exception is raised when the event stream produced no events or
    the first event in the stream was not of the initial-response type.
    """

    def __init__(self):
        message = 'First event was not of the initial-response type'
        super().__init__(message)


class DecodeUtils:
    """Unpacking utility functions used in the decoder.

    All methods on this class take raw bytes and return  a tuple containing
    the value parsed from the bytes and the number of bytes consumed to parse
    that value.
    """

    UINT8_BYTE_FORMAT = '!B'
    UINT16_BYTE_FORMAT = '!H'
    UINT32_BYTE_FORMAT = '!I'
    INT8_BYTE_FORMAT = '!b'
    INT16_BYTE_FORMAT = '!h'
    INT32_BYTE_FORMAT = '!i'
    INT64_BYTE_FORMAT = '!q'
    PRELUDE_BYTE_FORMAT = '!III'

    # uint byte size to unpack format
    UINT_BYTE_FORMAT = {
        1: UINT8_BYTE_FORMAT,
        2: UINT16_BYTE_FORMAT,
        4: UINT32_BYTE_FORMAT,
    }

    @staticmethod
    def unpack_true(data):
        """This method consumes none of the provided bytes and returns True.

        :type data: bytes
        :param data: The bytes to parse from. This is ignored in this method.

        :rtype: tuple
        :rtype: (bool, int)
        :returns: The tuple (True, 0)
        """
        return True, 0

    @staticmethod
    def unpack_false(data):
        """This method consumes none of the provided bytes and returns False.

        :type data: bytes
        :param data: The bytes to parse from. This is ignored in this method.

        :rtype: tuple
        :rtype: (bool, int)
        :returns: The tuple (False, 0)
        """
        return False, 0

    @staticmethod
    def unpack_uint8(data):
        """Parse an unsigned 8-bit integer from the bytes.

        :type data: bytes
        :param data: The bytes to parse from.

        :rtype: (int, int)
        :returns: A tuple containing the (parsed integer value, bytes consumed)
        """
        value = unpack(DecodeUtils.UINT8_BYTE_FORMAT, data[:1])[0]
        return value, 1

    @staticmethod
    def unpack_uint32(data):
        """Parse an unsigned 32-bit integer from the bytes.

        :type data: bytes
        :param data: The bytes to parse from.

        :rtype: (int, int)
        :returns: A tuple containing the (parsed integer value, bytes consumed)
        """
        value = unpack(DecodeUtils.UINT32_BYTE_FORMAT, data[:4])[0]
        return value, 4

    @staticmethod
    def unpack_int8(data):
        """Parse a signed 8-bit integer from the bytes.

        :type data: bytes
        :param data: The bytes to parse from.

        :rtype: (int, int)
        :returns: A tuple containing the (parsed integer value, bytes consumed)
        """
        value = unpack(DecodeUtils.INT8_BYTE_FORMAT, data[:1])[0]
        return value, 1

    @staticmethod
    def unpack_int16(data):
        """Parse a signed 16-bit integer from the bytes.

        :type data: bytes
        :param data: The bytes to parse from.

        :rtype: tuple
        :rtype: (int, int)
        :returns: A tuple containing the (parsed integer value, bytes consumed)
        """
        value = unpack(DecodeUtils.INT16_BYTE_FORMAT, data[:2])[0]
        return value, 2

    @staticmethod
    def unpack_int32(data):
        """Parse a signed 32-bit integer from the bytes.

        :type data: bytes
        :param data: The bytes to parse from.

        :rtype: tuple
        :rtype: (int, int)
        :returns: A tuple containing the (parsed integer value, bytes consumed)
        """
        value = unpack(DecodeUtils.INT32_BYTE_FORMAT, data[:4])[0]
        return value, 4

    @staticmethod
    def unpack_int64(data):
        """Parse a signed 64-bit integer from the bytes.

        :type data: bytes
        :param data: The bytes to parse from.

        :rtype: tuple
        :rtype: (int, int)
        :returns: A tuple containing the (parsed integer value, bytes consumed)
        """
        value = unpack(DecodeUtils.INT64_BYTE_FORMAT, data[:8])[0]
        return value, 8

    @staticmethod
    def unpack_byte_array(data, length_byte_size=2):
        """Parse a variable length byte array from the bytes.

        The bytes are expected to be in the following format:
            [ length ][0 ... length bytes]
        where length is an unsigned integer represented in the smallest number
        of bytes to hold the maximum length of the array.

        :type data: bytes
        :param data: The bytes to parse from.

        :type length_byte_size: int
        :param length_byte_size: The byte size of the preceding integer that
        represents the length of the array. Supported values are 1, 2, and 4.

        :rtype: (bytes, int)
        :returns: A tuple containing the (parsed byte array, bytes consumed).
        """
        uint_byte_format = DecodeUtils.UINT_BYTE_FORMAT[length_byte_size]
        length = unpack(uint_byte_format, data[:length_byte_size])[0]
        bytes_end = length + length_byte_size
        array_bytes = data[length_byte_size:bytes_end]
        return array_bytes, bytes_end

    @staticmethod
    def unpack_utf8_string(data, length_byte_size=2):
        """Parse a variable length utf-8 string from the bytes.

        The bytes are expected to be in the following format:
            [ length ][0 ... length bytes]
        where length is an unsigned integer represented in the smallest number
        of bytes to hold the maximum length of the array and the following
        bytes are a valid utf-8 string.

        :type data: bytes
        :param bytes: The bytes to parse from.

        :type length_byte_size: int
        :param length_byte_size: The byte size of the preceding integer that
        represents the length of the array. Supported values are 1, 2, and 4.

        :rtype: (str, int)
        :returns: A tuple containing the (utf-8 string, bytes consumed).
        """
        array_bytes, consumed = DecodeUtils.unpack_byte_array(
            data, length_byte_size
        )
        return array_bytes.decode('utf-8'), consumed

    @staticmethod
    def unpack_uuid(data):
        """Parse a 16-byte uuid from the bytes.

        :type data: bytes
        :param data: The bytes to parse from.

        :rtype: (bytes, int)
        :returns: A tuple containing the (uuid bytes, bytes consumed).
        """
        return data[:16], 16

    @staticmethod
    def unpack_prelude(data):
        """Parse the prelude for an event stream message from the bytes.

        The prelude for an event stream message has the following format:
            [total_length][header_length][prelude_crc]
        where each field is an unsigned 32-bit integer.

        :rtype: ((int, int, int), int)
        :returns: A tuple of ((total_length, headers_length, prelude_crc),
        consumed)
        """
        return (unpack(DecodeUtils.PRELUDE_BYTE_FORMAT, data), _PRELUDE_LENGTH)


def _validate_checksum(data, checksum, crc=0):
    # To generate the same numeric value across all Python versions and
    # platforms use crc32(data) & 0xffffffff.
    computed_checksum = crc32(data, crc) & 0xFFFFFFFF
    if checksum != computed_checksum:
        raise ChecksumMismatch(checksum, computed_checksum)


class MessagePrelude:
    """Represents the prelude of an event stream message."""

    def __init__(self, total_length, headers_length, crc):
        self.total_length = total_length
        self.headers_length = headers_length
        self.crc = crc

    @property
    def payload_length(self):
        """Calculates the total payload length.

        The extra minus 4 bytes is for the message CRC.

        :rtype: int
        :returns: The total payload length.
        """
        return self.total_length - self.headers_length - _PRELUDE_LENGTH - 4

    @property
    def payload_end(self):
        """Calculates the byte offset for the end of the message payload.

        The extra minus 4 bytes is for the message CRC.

        :rtype: int
        :returns: The byte offset from the beginning of the event stream
        message to the end of the payload.
        """
        return self.total_length - 4

    @property
    def headers_end(self):
        """Calculates the byte offset for the end of the message headers.

        :rtype: int
        :returns: The byte offset from the beginning of the event stream
        message to the end of the headers.
        """
        return _PRELUDE_LENGTH + self.headers_length


class EventStreamMessage:
    """Represents an event stream message."""

    def __init__(self, prelude, headers, payload, crc):
        self.prelude = prelude
        self.headers = headers
        self.payload = payload
        self.crc = crc

    def to_response_dict(self, status_code=200):
        message_type = self.headers.get(':message-type')
        if message_type == 'error' or message_type == 'exception':
            status_code = 400
        return {
            'status_code': status_code,
            'headers': self.headers,
            'body': self.payload,
        }


class EventStreamHeaderParser:
    """Parses the event headers from an event stream message.

    Expects all of the header data upfront and creates a dictionary of headers
    to return. This object can be reused multiple times to parse the headers
    from multiple event stream messages.
    """

    # Maps header type to appropriate unpacking function
    # These unpacking functions return the value and the amount unpacked
    _HEADER_TYPE_MAP = {
        # boolean_true
        0: DecodeUtils.unpack_true,
        # boolean_false
        1: DecodeUtils.unpack_false,
        # byte
        2: DecodeUtils.unpack_int8,
        # short
        3: DecodeUtils.unpack_int16,
        # integer
        4: DecodeUtils.unpack_int32,
        # long
        5: DecodeUtils.unpack_int64,
        # byte_array
        6: DecodeUtils.unpack_byte_array,
        # string
        7: DecodeUtils.unpack_utf8_string,
        # timestamp
        8: DecodeUtils.unpack_int64,
        # uuid
        9: DecodeUtils.unpack_uuid,
    }

    def __init__(self):
        self._data = None

    def parse(self, data):
        """Parses the event stream headers from an event stream message.

        :type data: bytes
        :param data: The bytes that correspond to the headers section of an
        event stream message.

        :rtype: dict
        :returns: A dictionary of header key, value pairs.
        """
        self._data = data
        return self._parse_headers()

    def _parse_headers(self):
        headers = {}
        while self._data:
            name, value = self._parse_header()
            if name in headers:
                raise DuplicateHeader(name)
            headers[name] = value
        return headers

    def _parse_header(self):
        name = self._parse_name()
        value = self._parse_value()
        return name, value

    def _parse_name(self):
        name, consumed = DecodeUtils.unpack_utf8_string(self._data, 1)
        self._advance_data(consumed)
        return name

    def _parse_type(self):
        type, consumed = DecodeUtils.unpack_uint8(self._data)
        self._advance_data(consumed)
        return type

    def _parse_value(self):
        header_type = self._parse_type()
        value_unpacker = self._HEADER_TYPE_MAP[header_type]
        value, consumed = value_unpacker(self._data)
        self._advance_data(consumed)
        return value

    def _advance_data(self, consumed):
        self._data = self._data[consumed:]


class EventStreamBuffer:
    """Streaming based event stream buffer

    A buffer class that wraps bytes from an event stream providing parsed
    messages as they become available via an iterable interface.
    """

    def __init__(self):
        self._data = b''
        self._prelude = None
        self._header_parser = EventStreamHeaderParser()

    def add_data(self, data):
        """Add data to the buffer.

        :type data: bytes
        :param data: The bytes to add to the buffer to be used when parsing
        """
        self._data += data

    def _validate_prelude(self, prelude):
        if prelude.headers_length > _MAX_HEADERS_LENGTH:
            raise InvalidHeadersLength(prelude.headers_length)

        if prelude.payload_length > _MAX_PAYLOAD_LENGTH:
            raise InvalidPayloadLength(prelude.payload_length)

    def _parse_prelude(self):
        prelude_bytes = self._data[:_PRELUDE_LENGTH]
        raw_prelude, _ = DecodeUtils.unpack_prelude(prelude_bytes)
        prelude = MessagePrelude(*raw_prelude)
        self._validate_prelude(prelude)
        # The minus 4 removes the prelude crc from the bytes to be checked
        _validate_checksum(prelude_bytes[: _PRELUDE_LENGTH - 4], prelude.crc)
        return prelude

    def _parse_headers(self):
        header_bytes = self._data[_PRELUDE_LENGTH : self._prelude.headers_end]
        return self._header_parser.parse(header_bytes)

    def _parse_payload(self):
        prelude = self._prelude
        payload_bytes = self._data[prelude.headers_end : prelude.payload_end]
        return payload_bytes

    def _parse_message_crc(self):
        prelude = self._prelude
        crc_bytes = self._data[prelude.payload_end : prelude.total_length]
        message_crc, _ = DecodeUtils.unpack_uint32(crc_bytes)
        return message_crc

    def _parse_message_bytes(self):
        # The minus 4 includes the prelude crc to the bytes to be checked
        message_bytes = self._data[
            _PRELUDE_LENGTH - 4 : self._prelude.payload_end
        ]
        return message_bytes

    def _validate_message_crc(self):
        message_crc = self._parse_message_crc()
        message_bytes = self._parse_message_bytes()
        _validate_checksum(message_bytes, message_crc, crc=self._prelude.crc)
        return message_crc

    def _parse_message(self):
        crc = self._validate_message_crc()
        headers = self._parse_headers()
        payload = self._parse_payload()
        message = EventStreamMessage(self._prelude, headers, payload, crc)
        self._prepare_for_next_message()
        return message

    def _prepare_for_next_message(self):
        # Advance the data and reset the current prelude
        self._data = self._data[self._prelude.total_length :]
        self._prelude = None

    def next(self):
        """Provides the next available message parsed from the stream

        :rtype: EventStreamMessage
        :returns: The next event stream message
        """
        if len(self._data) < _PRELUDE_LENGTH:
            raise StopIteration()

        if self._prelude is None:
            self._prelude = self._parse_prelude()

        if len(self._data) < self._prelude.total_length:
            raise StopIteration()

        return self._parse_message()

    def __next__(self):
        return self.next()

    def __iter__(self):
        return self


class EventStream:
    """Wrapper class for an event stream body.

    This wraps the underlying streaming body, parsing it for individual events
    and yielding them as they come available through the iterator interface.

    The following example uses the S3 select API to get structured data out of
    an object stored in S3 using an event stream.

    **Example:**
    ::
        from botocore.session import Session

        s3 = Session().create_client('s3')
        response = s3.select_object_content(
            Bucket='bucketname',
            Key='keyname',
            ExpressionType='SQL',
            RequestProgress={'Enabled': True},
            Expression="SELECT * FROM S3Object s",
            InputSerialization={'CSV': {}},
            OutputSerialization={'CSV': {}},
        )
        # This is the event stream in the response
        event_stream = response['Payload']
        end_event_received = False
        with open('output', 'wb') as f:
            # Iterate over events in the event stream as they come
            for event in event_stream:
                # If we received a records event, write the data to a file
                if 'Records' in event:
                    data = event['Records']['Payload']
                    f.write(data)
                # If we received a progress event, print the details
                elif 'Progress' in event:
                    print(event['Progress']['Details'])
                # End event indicates that the request finished successfully
                elif 'End' in event:
                    print('Result is complete')
                    end_event_received = True
        if not end_event_received:
            raise Exception("End event not received, request incomplete.")
    """

    def __init__(self, raw_stream, output_shape, parser, operation_name):
        self._raw_stream = raw_stream
        self._output_shape = output_shape
        self._operation_name = operation_name
        self._parser = parser
        self._event_generator = self._create_raw_event_generator()

    def __iter__(self):
        for event in self._event_generator:
            parsed_event = self._parse_event(event)
            if parsed_event:
                yield parsed_event

    def _create_raw_event_generator(self):
        event_stream_buffer = EventStreamBuffer()
        for chunk in self._raw_stream.stream():
            event_stream_buffer.add_data(chunk)
            yield from event_stream_buffer

    def _parse_event(self, event):
        response_dict = event.to_response_dict()
        parsed_response = self._parser.parse(response_dict, self._output_shape)
        if response_dict['status_code'] == 200:
            return parsed_response
        else:
            raise EventStreamError(parsed_response, self._operation_name)

    def get_initial_response(self):
        try:
            initial_event = next(self._event_generator)
            event_type = initial_event.headers.get(':event-type')
            if event_type == 'initial-response':
                return initial_event
        except StopIteration:
            pass
        raise NoInitialResponseError()

    def close(self):
        """Closes the underlying streaming body."""
        self._raw_stream.close()
