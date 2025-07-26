# Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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

"""The interfaces in this module are not intended for public use.

This module defines interfaces for applying checksums to HTTP requests within
the context of botocore. This involves both resolving the checksum to be used
based on client configuration and environment, as well as application of the
checksum to the request.
"""

import base64
import io
import logging
from binascii import crc32
from hashlib import sha1, sha256

from botocore.compat import HAS_CRT
from botocore.exceptions import (
    AwsChunkedWrapperError,
    FlexibleChecksumError,
    MissingDependencyException,
)
from botocore.response import StreamingBody
from botocore.utils import (
    conditionally_calculate_md5,
    determine_content_length,
)

if HAS_CRT:
    from awscrt import checksums as crt_checksums
else:
    crt_checksums = None

logger = logging.getLogger(__name__)


class BaseChecksum:
    _CHUNK_SIZE = 1024 * 1024

    def update(self, chunk):
        pass

    def digest(self):
        pass

    def b64digest(self):
        bs = self.digest()
        return base64.b64encode(bs).decode("ascii")

    def _handle_fileobj(self, fileobj):
        start_position = fileobj.tell()
        for chunk in iter(lambda: fileobj.read(self._CHUNK_SIZE), b""):
            self.update(chunk)
        fileobj.seek(start_position)

    def handle(self, body):
        if isinstance(body, (bytes, bytearray)):
            self.update(body)
        else:
            self._handle_fileobj(body)
        return self.b64digest()


class Crc32Checksum(BaseChecksum):
    def __init__(self):
        self._int_crc32 = 0

    def update(self, chunk):
        self._int_crc32 = crc32(chunk, self._int_crc32) & 0xFFFFFFFF

    def digest(self):
        return self._int_crc32.to_bytes(4, byteorder="big")


class CrtCrc32Checksum(BaseChecksum):
    # Note: This class is only used if the CRT is available
    def __init__(self):
        self._int_crc32 = 0

    def update(self, chunk):
        new_checksum = crt_checksums.crc32(chunk, self._int_crc32)
        self._int_crc32 = new_checksum & 0xFFFFFFFF

    def digest(self):
        return self._int_crc32.to_bytes(4, byteorder="big")


class CrtCrc32cChecksum(BaseChecksum):
    # Note: This class is only used if the CRT is available
    def __init__(self):
        self._int_crc32c = 0

    def update(self, chunk):
        new_checksum = crt_checksums.crc32c(chunk, self._int_crc32c)
        self._int_crc32c = new_checksum & 0xFFFFFFFF

    def digest(self):
        return self._int_crc32c.to_bytes(4, byteorder="big")


class Sha1Checksum(BaseChecksum):
    def __init__(self):
        self._checksum = sha1()

    def update(self, chunk):
        self._checksum.update(chunk)

    def digest(self):
        return self._checksum.digest()


class Sha256Checksum(BaseChecksum):
    def __init__(self):
        self._checksum = sha256()

    def update(self, chunk):
        self._checksum.update(chunk)

    def digest(self):
        return self._checksum.digest()


class AwsChunkedWrapper:
    _DEFAULT_CHUNK_SIZE = 1024 * 1024

    def __init__(
        self,
        raw,
        checksum_cls=None,
        checksum_name="x-amz-checksum",
        chunk_size=None,
    ):
        self._raw = raw
        self._checksum_name = checksum_name
        self._checksum_cls = checksum_cls
        self._reset()

        if chunk_size is None:
            chunk_size = self._DEFAULT_CHUNK_SIZE
        self._chunk_size = chunk_size

    def _reset(self):
        self._remaining = b""
        self._complete = False
        self._checksum = None
        if self._checksum_cls:
            self._checksum = self._checksum_cls()

    def seek(self, offset, whence=0):
        if offset != 0 or whence != 0:
            raise AwsChunkedWrapperError(
                error_msg="Can only seek to start of stream"
            )
        self._reset()
        self._raw.seek(0)

    def read(self, size=None):
        # Normalize "read all" size values to None
        if size is not None and size <= 0:
            size = None

        # If the underlying body is done and we have nothing left then
        # end the stream
        if self._complete and not self._remaining:
            return b""

        # While we're not done and want more bytes
        want_more_bytes = size is None or size > len(self._remaining)
        while not self._complete and want_more_bytes:
            self._remaining += self._make_chunk()
            want_more_bytes = size is None or size > len(self._remaining)

        # If size was None, we want to return everything
        if size is None:
            size = len(self._remaining)

        # Return a chunk up to the size asked for
        to_return = self._remaining[:size]
        self._remaining = self._remaining[size:]
        return to_return

    def _make_chunk(self):
        # NOTE: Chunk size is not deterministic as read could return less. This
        # means we cannot know the content length of the encoded aws-chunked
        # stream ahead of time without ensuring a consistent chunk size
        raw_chunk = self._raw.read(self._chunk_size)
        hex_len = hex(len(raw_chunk))[2:].encode("ascii")
        self._complete = not raw_chunk

        if self._checksum:
            self._checksum.update(raw_chunk)

        if self._checksum and self._complete:
            name = self._checksum_name.encode("ascii")
            checksum = self._checksum.b64digest().encode("ascii")
            return b"0\r\n%s:%s\r\n\r\n" % (name, checksum)

        return b"%s\r\n%s\r\n" % (hex_len, raw_chunk)

    def __iter__(self):
        while not self._complete:
            yield self._make_chunk()


class StreamingChecksumBody(StreamingBody):
    def __init__(self, raw_stream, content_length, checksum, expected):
        super().__init__(raw_stream, content_length)
        self._checksum = checksum
        self._expected = expected

    def read(self, amt=None):
        chunk = super().read(amt=amt)
        self._checksum.update(chunk)
        if amt is None or (not chunk and amt > 0):
            self._validate_checksum()
        return chunk

    def _validate_checksum(self):
        if self._checksum.digest() != base64.b64decode(self._expected):
            error_msg = (
                f"Expected checksum {self._expected} did not match calculated "
                f"checksum: {self._checksum.b64digest()}"
            )
            raise FlexibleChecksumError(error_msg=error_msg)


def resolve_checksum_context(request, operation_model, params):
    resolve_request_checksum_algorithm(request, operation_model, params)
    resolve_response_checksum_algorithms(request, operation_model, params)


def resolve_request_checksum_algorithm(
    request,
    operation_model,
    params,
    supported_algorithms=None,
):
    http_checksum = operation_model.http_checksum
    algorithm_member = http_checksum.get("requestAlgorithmMember")
    if algorithm_member and algorithm_member in params:
        # If the client has opted into using flexible checksums and the
        # request supports it, use that instead of checksum required
        if supported_algorithms is None:
            supported_algorithms = _SUPPORTED_CHECKSUM_ALGORITHMS

        algorithm_name = params[algorithm_member].lower()
        if algorithm_name not in supported_algorithms:
            if not HAS_CRT and algorithm_name in _CRT_CHECKSUM_ALGORITHMS:
                raise MissingDependencyException(
                    msg=(
                        f"Using {algorithm_name.upper()} requires an "
                        "additional dependency. You will need to pip install "
                        "botocore[crt] before proceeding."
                    )
                )
            raise FlexibleChecksumError(
                error_msg=f"Unsupported checksum algorithm: {algorithm_name}"
            )

        location_type = "header"
        if operation_model.has_streaming_input:
            # Operations with streaming input must support trailers.
            if request["url"].startswith("https:"):
                # We only support unsigned trailer checksums currently. As this
                # disables payload signing we'll only use trailers over TLS.
                location_type = "trailer"

        algorithm = {
            "algorithm": algorithm_name,
            "in": location_type,
            "name": f"x-amz-checksum-{algorithm_name}",
        }

        if algorithm["name"] in request["headers"]:
            # If the header is already set by the customer, skip calculation
            return

        checksum_context = request["context"].get("checksum", {})
        checksum_context["request_algorithm"] = algorithm
        request["context"]["checksum"] = checksum_context
    elif operation_model.http_checksum_required or http_checksum.get(
        "requestChecksumRequired"
    ):
        # Otherwise apply the old http checksum behavior via Content-MD5
        checksum_context = request["context"].get("checksum", {})
        checksum_context["request_algorithm"] = "conditional-md5"
        request["context"]["checksum"] = checksum_context


def apply_request_checksum(request):
    checksum_context = request.get("context", {}).get("checksum", {})
    algorithm = checksum_context.get("request_algorithm")

    if not algorithm:
        return

    if algorithm == "conditional-md5":
        # Special case to handle the http checksum required trait
        conditionally_calculate_md5(request)
    elif algorithm["in"] == "header":
        _apply_request_header_checksum(request)
    elif algorithm["in"] == "trailer":
        _apply_request_trailer_checksum(request)
    else:
        raise FlexibleChecksumError(
            error_msg="Unknown checksum variant: {}".format(algorithm["in"])
        )


def _apply_request_header_checksum(request):
    checksum_context = request.get("context", {}).get("checksum", {})
    algorithm = checksum_context.get("request_algorithm")
    location_name = algorithm["name"]
    if location_name in request["headers"]:
        # If the header is already set by the customer, skip calculation
        return
    checksum_cls = _CHECKSUM_CLS.get(algorithm["algorithm"])
    digest = checksum_cls().handle(request["body"])
    request["headers"][location_name] = digest


def _apply_request_trailer_checksum(request):
    checksum_context = request.get("context", {}).get("checksum", {})
    algorithm = checksum_context.get("request_algorithm")
    location_name = algorithm["name"]
    checksum_cls = _CHECKSUM_CLS.get(algorithm["algorithm"])

    headers = request["headers"]
    body = request["body"]

    if location_name in headers:
        # If the header is already set by the customer, skip calculation
        return

    headers["Transfer-Encoding"] = "chunked"
    if "Content-Encoding" in headers:
        # We need to preserve the existing content encoding and add
        # aws-chunked as a new content encoding.
        headers["Content-Encoding"] += ",aws-chunked"
    else:
        headers["Content-Encoding"] = "aws-chunked"
    headers["X-Amz-Trailer"] = location_name

    content_length = determine_content_length(body)
    if content_length is not None:
        # Send the decoded content length if we can determine it. Some
        # services such as S3 may require the decoded content length
        headers["X-Amz-Decoded-Content-Length"] = str(content_length)

    if isinstance(body, (bytes, bytearray)):
        body = io.BytesIO(body)

    request["body"] = AwsChunkedWrapper(
        body,
        checksum_cls=checksum_cls,
        checksum_name=location_name,
    )


def resolve_response_checksum_algorithms(
    request, operation_model, params, supported_algorithms=None
):
    http_checksum = operation_model.http_checksum
    mode_member = http_checksum.get("requestValidationModeMember")
    if mode_member and mode_member in params:
        if supported_algorithms is None:
            supported_algorithms = _SUPPORTED_CHECKSUM_ALGORITHMS
        response_algorithms = {
            a.lower() for a in http_checksum.get("responseAlgorithms", [])
        }

        usable_algorithms = []
        for algorithm in _ALGORITHMS_PRIORITY_LIST:
            if algorithm not in response_algorithms:
                continue
            if algorithm in supported_algorithms:
                usable_algorithms.append(algorithm)

        checksum_context = request["context"].get("checksum", {})
        checksum_context["response_algorithms"] = usable_algorithms
        request["context"]["checksum"] = checksum_context


def handle_checksum_body(http_response, response, context, operation_model):
    headers = response["headers"]
    checksum_context = context.get("checksum", {})
    algorithms = checksum_context.get("response_algorithms")

    if not algorithms:
        return

    for algorithm in algorithms:
        header_name = f"x-amz-checksum-{algorithm}"
        # If the header is not found, check the next algorithm
        if header_name not in headers:
            continue

        # If a - is in the checksum this is not valid Base64. S3 returns
        # checksums that include a -# suffix to indicate a checksum derived
        # from the hash of all part checksums. We cannot wrap this response
        if "-" in headers[header_name]:
            continue

        if operation_model.has_streaming_output:
            response["body"] = _handle_streaming_response(
                http_response, response, algorithm
            )
        else:
            response["body"] = _handle_bytes_response(
                http_response, response, algorithm
            )

        # Expose metadata that the checksum check actually occurred
        checksum_context = response["context"].get("checksum", {})
        checksum_context["response_algorithm"] = algorithm
        response["context"]["checksum"] = checksum_context
        return

    logger.info(
        f'Skipping checksum validation. Response did not contain one of the '
        f'following algorithms: {algorithms}.'
    )


def _handle_streaming_response(http_response, response, algorithm):
    checksum_cls = _CHECKSUM_CLS.get(algorithm)
    header_name = f"x-amz-checksum-{algorithm}"
    return StreamingChecksumBody(
        http_response.raw,
        response["headers"].get("content-length"),
        checksum_cls(),
        response["headers"][header_name],
    )


def _handle_bytes_response(http_response, response, algorithm):
    body = http_response.content
    header_name = f"x-amz-checksum-{algorithm}"
    checksum_cls = _CHECKSUM_CLS.get(algorithm)
    checksum = checksum_cls()
    checksum.update(body)
    expected = response["headers"][header_name]
    if checksum.digest() != base64.b64decode(expected):
        error_msg = (
            f"Expected checksum {expected} did not match calculated "
            f"checksum: {checksum.b64digest()}"
        )
        raise FlexibleChecksumError(error_msg=error_msg)
    return body


_CHECKSUM_CLS = {
    "crc32": Crc32Checksum,
    "sha1": Sha1Checksum,
    "sha256": Sha256Checksum,
}
_CRT_CHECKSUM_ALGORITHMS = ["crc32", "crc32c"]
if HAS_CRT:
    # Use CRT checksum implementations if available
    _CRT_CHECKSUM_CLS = {
        "crc32": CrtCrc32Checksum,
        "crc32c": CrtCrc32cChecksum,
    }
    _CHECKSUM_CLS.update(_CRT_CHECKSUM_CLS)
    # Validate this list isn't out of sync with _CRT_CHECKSUM_CLS keys
    assert all(
        name in _CRT_CHECKSUM_ALGORITHMS for name in _CRT_CHECKSUM_CLS.keys()
    )
_SUPPORTED_CHECKSUM_ALGORITHMS = list(_CHECKSUM_CLS.keys())
_ALGORITHMS_PRIORITY_LIST = ['crc32c', 'crc32', 'sha1', 'sha256']
