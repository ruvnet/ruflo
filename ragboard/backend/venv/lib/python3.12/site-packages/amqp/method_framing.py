"""Convert between frames and higher-level AMQP methods."""
# Copyright (C) 2007-2008 Barry Pederson <bp@barryp.org>

from collections import defaultdict
from struct import pack, pack_into, unpack_from

from . import spec
from .basic_message import Message
from .exceptions import UnexpectedFrame
from .utils import str_to_bytes

__all__ = ('frame_handler', 'frame_writer')

#: Set of methods that require both a content frame and a body frame.
_CONTENT_METHODS = frozenset([
    spec.Basic.Return,
    spec.Basic.Deliver,
    spec.Basic.GetOk,
])


#: Number of bytes reserved for protocol in a content frame.
#: We use this to calculate when a frame exceeeds the max frame size,
#: and if it does not the message will fit into the preallocated buffer.
FRAME_OVERHEAD = 40


def frame_handler(connection, callback,
                  unpack_from=unpack_from, content_methods=_CONTENT_METHODS):
    """Create closure that reads frames."""
    expected_types = defaultdict(lambda: 1)
    partial_messages = {}

    def on_frame(frame):
        frame_type, channel, buf = frame
        connection.bytes_recv += 1
        if frame_type not in (expected_types[channel], 8):
            raise UnexpectedFrame(
                'Received frame {} while expecting type: {}'.format(
                    frame_type, expected_types[channel]),
            )
        elif frame_type == 1:
            method_sig = unpack_from('>HH', buf, 0)

            if method_sig in content_methods:
                # Save what we've got so far and wait for the content-header
                partial_messages[channel] = Message(
                    frame_method=method_sig, frame_args=buf,
                )
                expected_types[channel] = 2
                return False

            callback(channel, method_sig, buf, None)

        elif frame_type == 2:
            msg = partial_messages[channel]
            msg.inbound_header(buf)

            if not msg.ready:
                # wait for the content-body
                expected_types[channel] = 3
                return False

            # bodyless message, we're done
            expected_types[channel] = 1
            partial_messages.pop(channel, None)
            callback(channel, msg.frame_method, msg.frame_args, msg)

        elif frame_type == 3:
            msg = partial_messages[channel]
            msg.inbound_body(buf)
            if not msg.ready:
                # wait for the rest of the content-body
                return False
            expected_types[channel] = 1
            partial_messages.pop(channel, None)
            callback(channel, msg.frame_method, msg.frame_args, msg)
        elif frame_type == 8:
            # bytes_recv already updated
            return False
        return True

    return on_frame


class Buffer:
    def __init__(self, buf):
        self.buf = buf

    @property
    def buf(self):
        return self._buf

    @buf.setter
    def buf(self, buf):
        self._buf = buf
        # Using a memoryview allows slicing without copying underlying data.
        # Slicing this is much faster than slicing the bytearray directly.
        # More details: https://stackoverflow.com/a/34257357
        self.view = memoryview(buf)


def frame_writer(connection, transport,
                 pack=pack, pack_into=pack_into, range=range, len=len,
                 bytes=bytes, str_to_bytes=str_to_bytes, text_t=str):
    """Create closure that writes frames."""
    write = transport.write

    buffer_store = Buffer(bytearray(connection.frame_max - 8))

    def write_frame(type_, channel, method_sig, args, content):
        chunk_size = connection.frame_max - 8
        offset = 0
        properties = None
        args = str_to_bytes(args)
        if content:
            body = content.body
            if isinstance(body, str):
                encoding = content.properties.setdefault(
                    'content_encoding', 'utf-8')
                body = body.encode(encoding)
            properties = content._serialize_properties()
            bodylen = len(body)
            properties_len = len(properties) or 0
            framelen = len(args) + properties_len + bodylen + FRAME_OVERHEAD
            bigbody = framelen > chunk_size
        else:
            body, bodylen, bigbody = None, 0, 0

        if bigbody:
            # ## SLOW: string copy and write for every frame
            frame = (b''.join([pack('>HH', *method_sig), args])
                     if type_ == 1 else b'')  # encode method frame
            framelen = len(frame)
            write(pack('>BHI%dsB' % framelen,
                       type_, channel, framelen, frame, 0xce))
            if body:
                frame = b''.join([
                    pack('>HHQ', method_sig[0], 0, len(body)),
                    properties,
                ])
                framelen = len(frame)
                write(pack('>BHI%dsB' % framelen,
                           2, channel, framelen, frame, 0xce))

                for i in range(0, bodylen, chunk_size):
                    frame = body[i:i + chunk_size]
                    framelen = len(frame)
                    write(pack('>BHI%dsB' % framelen,
                               3, channel, framelen,
                               frame, 0xce))

        else:
            # frame_max can be updated via connection._on_tune. If
            # it became larger, then we need to resize the buffer
            # to prevent overflow.
            if chunk_size > len(buffer_store.buf):
                buffer_store.buf = bytearray(chunk_size)
            buf = buffer_store.buf

            # ## FAST: pack into buffer and single write
            frame = (b''.join([pack('>HH', *method_sig), args])
                     if type_ == 1 else b'')
            framelen = len(frame)
            pack_into('>BHI%dsB' % framelen, buf, offset,
                      type_, channel, framelen, frame, 0xce)
            offset += 8 + framelen
            if body is not None:
                frame = b''.join([
                    pack('>HHQ', method_sig[0], 0, len(body)),
                    properties,
                ])
                framelen = len(frame)

                pack_into('>BHI%dsB' % framelen, buf, offset,
                          2, channel, framelen, frame, 0xce)
                offset += 8 + framelen

                bodylen = len(body)
                if bodylen > 0:
                    framelen = bodylen
                    pack_into('>BHI%dsB' % framelen, buf, offset,
                              3, channel, framelen, body, 0xce)
                    offset += 8 + framelen

            write(buffer_store.view[:offset])

        connection.bytes_sent += 1
    return write_frame
