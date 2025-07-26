# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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

import datetime
from io import BytesIO

from botocore.auth import (
    SIGNED_HEADERS_BLACKLIST,
    STREAMING_UNSIGNED_PAYLOAD_TRAILER,
    UNSIGNED_PAYLOAD,
    BaseSigner,
    _get_body_as_dict,
    _host_from_url,
)
from botocore.compat import HTTPHeaders, awscrt, parse_qs, urlsplit, urlunsplit
from botocore.exceptions import NoCredentialsError
from botocore.utils import percent_encode_sequence


class CrtSigV4Auth(BaseSigner):
    REQUIRES_REGION = True
    _PRESIGNED_HEADERS_BLOCKLIST = [
        'Authorization',
        'X-Amz-Date',
        'X-Amz-Content-SHA256',
        'X-Amz-Security-Token',
    ]
    _SIGNATURE_TYPE = awscrt.auth.AwsSignatureType.HTTP_REQUEST_HEADERS
    _USE_DOUBLE_URI_ENCODE = True
    _SHOULD_NORMALIZE_URI_PATH = True

    def __init__(self, credentials, service_name, region_name):
        self.credentials = credentials
        self._service_name = service_name
        self._region_name = region_name
        self._expiration_in_seconds = None

    def _is_streaming_checksum_payload(self, request):
        checksum_context = request.context.get('checksum', {})
        algorithm = checksum_context.get('request_algorithm')
        return isinstance(algorithm, dict) and algorithm.get('in') == 'trailer'

    def add_auth(self, request):
        if self.credentials is None:
            raise NoCredentialsError()

        # Use utcnow() because that's what gets mocked by tests, but set
        # timezone because CRT assumes naive datetime is local time.
        datetime_now = datetime.datetime.utcnow().replace(
            tzinfo=datetime.timezone.utc
        )

        # Use existing 'X-Amz-Content-SHA256' header if able
        existing_sha256 = self._get_existing_sha256(request)

        self._modify_request_before_signing(request)

        credentials_provider = awscrt.auth.AwsCredentialsProvider.new_static(
            access_key_id=self.credentials.access_key,
            secret_access_key=self.credentials.secret_key,
            session_token=self.credentials.token,
        )

        if self._is_streaming_checksum_payload(request):
            explicit_payload = STREAMING_UNSIGNED_PAYLOAD_TRAILER
        elif self._should_sha256_sign_payload(request):
            if existing_sha256:
                explicit_payload = existing_sha256
            else:
                explicit_payload = None  # to be calculated during signing
        else:
            explicit_payload = UNSIGNED_PAYLOAD

        if self._should_add_content_sha256_header(explicit_payload):
            body_header = (
                awscrt.auth.AwsSignedBodyHeaderType.X_AMZ_CONTENT_SHA_256
            )
        else:
            body_header = awscrt.auth.AwsSignedBodyHeaderType.NONE

        signing_config = awscrt.auth.AwsSigningConfig(
            algorithm=awscrt.auth.AwsSigningAlgorithm.V4,
            signature_type=self._SIGNATURE_TYPE,
            credentials_provider=credentials_provider,
            region=self._region_name,
            service=self._service_name,
            date=datetime_now,
            should_sign_header=self._should_sign_header,
            use_double_uri_encode=self._USE_DOUBLE_URI_ENCODE,
            should_normalize_uri_path=self._SHOULD_NORMALIZE_URI_PATH,
            signed_body_value=explicit_payload,
            signed_body_header_type=body_header,
            expiration_in_seconds=self._expiration_in_seconds,
        )
        crt_request = self._crt_request_from_aws_request(request)
        future = awscrt.auth.aws_sign_request(crt_request, signing_config)
        future.result()
        self._apply_signing_changes(request, crt_request)

    def _crt_request_from_aws_request(self, aws_request):
        url_parts = urlsplit(aws_request.url)
        crt_path = url_parts.path if url_parts.path else '/'
        if aws_request.params:
            array = []
            for param, value in aws_request.params.items():
                value = str(value)
                array.append(f'{param}={value}')
            crt_path = crt_path + '?' + '&'.join(array)
        elif url_parts.query:
            crt_path = f'{crt_path}?{url_parts.query}'

        crt_headers = awscrt.http.HttpHeaders(aws_request.headers.items())

        # CRT requires body (if it exists) to be an I/O stream.
        crt_body_stream = None
        if aws_request.body:
            if hasattr(aws_request.body, 'seek'):
                crt_body_stream = aws_request.body
            else:
                crt_body_stream = BytesIO(aws_request.body)

        crt_request = awscrt.http.HttpRequest(
            method=aws_request.method,
            path=crt_path,
            headers=crt_headers,
            body_stream=crt_body_stream,
        )
        return crt_request

    def _apply_signing_changes(self, aws_request, signed_crt_request):
        # Apply changes from signed CRT request to the AWSRequest
        aws_request.headers = HTTPHeaders.from_pairs(
            list(signed_crt_request.headers)
        )

    def _should_sign_header(self, name, **kwargs):
        return name.lower() not in SIGNED_HEADERS_BLACKLIST

    def _modify_request_before_signing(self, request):
        # This could be a retry. Make sure the previous
        # authorization headers are removed first.
        for h in self._PRESIGNED_HEADERS_BLOCKLIST:
            if h in request.headers:
                del request.headers[h]
        # If necessary, add the host header
        if 'host' not in request.headers:
            request.headers['host'] = _host_from_url(request.url)

    def _get_existing_sha256(self, request):
        return request.headers.get('X-Amz-Content-SHA256')

    def _should_sha256_sign_payload(self, request):
        # Payloads will always be signed over insecure connections.
        if not request.url.startswith('https'):
            return True

        # Certain operations may have payload signing disabled by default.
        # Since we don't have access to the operation model, we pass in this
        # bit of metadata through the request context.
        return request.context.get('payload_signing_enabled', True)

    def _should_add_content_sha256_header(self, explicit_payload):
        # only add X-Amz-Content-SHA256 header if payload is explicitly set
        return explicit_payload is not None


class CrtS3SigV4Auth(CrtSigV4Auth):
    # For S3, we do not normalize the path.
    _USE_DOUBLE_URI_ENCODE = False
    _SHOULD_NORMALIZE_URI_PATH = False

    def _get_existing_sha256(self, request):
        # always recalculate
        return None

    def _should_sha256_sign_payload(self, request):
        # S3 allows optional body signing, so to minimize the performance
        # impact, we opt to not SHA256 sign the body on streaming uploads,
        # provided that we're on https.
        client_config = request.context.get('client_config')
        s3_config = getattr(client_config, 's3', None)

        # The config could be None if it isn't set, or if the customer sets it
        # to None.
        if s3_config is None:
            s3_config = {}

        # The explicit configuration takes precedence over any implicit
        # configuration.
        sign_payload = s3_config.get('payload_signing_enabled', None)
        if sign_payload is not None:
            return sign_payload

        # We require that both a checksum be present and https be enabled
        # to implicitly disable body signing. The combination of TLS and
        # a checksum is sufficiently secure and durable for us to be
        # confident in the request without body signing.
        checksum_header = 'Content-MD5'
        checksum_context = request.context.get('checksum', {})
        algorithm = checksum_context.get('request_algorithm')
        if isinstance(algorithm, dict) and algorithm.get('in') == 'header':
            checksum_header = algorithm['name']
        if (
            not request.url.startswith('https')
            or checksum_header not in request.headers
        ):
            return True

        # If the input is streaming we disable body signing by default.
        if request.context.get('has_streaming_input', False):
            return False

        # If the S3-specific checks had no results, delegate to the generic
        # checks.
        return super()._should_sha256_sign_payload(request)

    def _should_add_content_sha256_header(self, explicit_payload):
        # Always add X-Amz-Content-SHA256 header
        return True


class CrtSigV4AsymAuth(BaseSigner):
    REQUIRES_REGION = True
    _PRESIGNED_HEADERS_BLOCKLIST = [
        'Authorization',
        'X-Amz-Date',
        'X-Amz-Content-SHA256',
        'X-Amz-Security-Token',
    ]
    _SIGNATURE_TYPE = awscrt.auth.AwsSignatureType.HTTP_REQUEST_HEADERS
    _USE_DOUBLE_URI_ENCODE = True
    _SHOULD_NORMALIZE_URI_PATH = True

    def __init__(self, credentials, service_name, region_name):
        self.credentials = credentials
        self._service_name = service_name
        self._region_name = region_name
        self._expiration_in_seconds = None

    def add_auth(self, request):
        if self.credentials is None:
            raise NoCredentialsError()

        # Use utcnow() because that's what gets mocked by tests, but set
        # timezone because CRT assumes naive datetime is local time.
        datetime_now = datetime.datetime.utcnow().replace(
            tzinfo=datetime.timezone.utc
        )

        # Use existing 'X-Amz-Content-SHA256' header if able
        existing_sha256 = self._get_existing_sha256(request)

        self._modify_request_before_signing(request)

        credentials_provider = awscrt.auth.AwsCredentialsProvider.new_static(
            access_key_id=self.credentials.access_key,
            secret_access_key=self.credentials.secret_key,
            session_token=self.credentials.token,
        )

        if self._is_streaming_checksum_payload(request):
            explicit_payload = STREAMING_UNSIGNED_PAYLOAD_TRAILER
        elif self._should_sha256_sign_payload(request):
            if existing_sha256:
                explicit_payload = existing_sha256
            else:
                explicit_payload = None  # to be calculated during signing
        else:
            explicit_payload = UNSIGNED_PAYLOAD

        if self._should_add_content_sha256_header(explicit_payload):
            body_header = (
                awscrt.auth.AwsSignedBodyHeaderType.X_AMZ_CONTENT_SHA_256
            )
        else:
            body_header = awscrt.auth.AwsSignedBodyHeaderType.NONE

        signing_config = awscrt.auth.AwsSigningConfig(
            algorithm=awscrt.auth.AwsSigningAlgorithm.V4_ASYMMETRIC,
            signature_type=self._SIGNATURE_TYPE,
            credentials_provider=credentials_provider,
            region=self._region_name,
            service=self._service_name,
            date=datetime_now,
            should_sign_header=self._should_sign_header,
            use_double_uri_encode=self._USE_DOUBLE_URI_ENCODE,
            should_normalize_uri_path=self._SHOULD_NORMALIZE_URI_PATH,
            signed_body_value=explicit_payload,
            signed_body_header_type=body_header,
            expiration_in_seconds=self._expiration_in_seconds,
        )
        crt_request = self._crt_request_from_aws_request(request)
        future = awscrt.auth.aws_sign_request(crt_request, signing_config)
        future.result()
        self._apply_signing_changes(request, crt_request)

    def _crt_request_from_aws_request(self, aws_request):
        url_parts = urlsplit(aws_request.url)
        crt_path = url_parts.path if url_parts.path else '/'
        if aws_request.params:
            array = []
            for param, value in aws_request.params.items():
                value = str(value)
                array.append(f'{param}={value}')
            crt_path = crt_path + '?' + '&'.join(array)
        elif url_parts.query:
            crt_path = f'{crt_path}?{url_parts.query}'

        crt_headers = awscrt.http.HttpHeaders(aws_request.headers.items())

        # CRT requires body (if it exists) to be an I/O stream.
        crt_body_stream = None
        if aws_request.body:
            if hasattr(aws_request.body, 'seek'):
                crt_body_stream = aws_request.body
            else:
                crt_body_stream = BytesIO(aws_request.body)

        crt_request = awscrt.http.HttpRequest(
            method=aws_request.method,
            path=crt_path,
            headers=crt_headers,
            body_stream=crt_body_stream,
        )
        return crt_request

    def _apply_signing_changes(self, aws_request, signed_crt_request):
        # Apply changes from signed CRT request to the AWSRequest
        aws_request.headers = HTTPHeaders.from_pairs(
            list(signed_crt_request.headers)
        )

    def _should_sign_header(self, name, **kwargs):
        return name.lower() not in SIGNED_HEADERS_BLACKLIST

    def _modify_request_before_signing(self, request):
        # This could be a retry. Make sure the previous
        # authorization headers are removed first.
        for h in self._PRESIGNED_HEADERS_BLOCKLIST:
            if h in request.headers:
                del request.headers[h]
        # If necessary, add the host header
        if 'host' not in request.headers:
            request.headers['host'] = _host_from_url(request.url)

    def _get_existing_sha256(self, request):
        return request.headers.get('X-Amz-Content-SHA256')

    def _is_streaming_checksum_payload(self, request):
        checksum_context = request.context.get('checksum', {})
        algorithm = checksum_context.get('request_algorithm')
        return isinstance(algorithm, dict) and algorithm.get('in') == 'trailer'

    def _should_sha256_sign_payload(self, request):
        # Payloads will always be signed over insecure connections.
        if not request.url.startswith('https'):
            return True

        # Certain operations may have payload signing disabled by default.
        # Since we don't have access to the operation model, we pass in this
        # bit of metadata through the request context.
        return request.context.get('payload_signing_enabled', True)

    def _should_add_content_sha256_header(self, explicit_payload):
        # only add X-Amz-Content-SHA256 header if payload is explicitly set
        return explicit_payload is not None


class CrtS3SigV4AsymAuth(CrtSigV4AsymAuth):
    # For S3, we do not normalize the path.
    _USE_DOUBLE_URI_ENCODE = False
    _SHOULD_NORMALIZE_URI_PATH = False

    def _get_existing_sha256(self, request):
        # always recalculate
        return None

    def _should_sha256_sign_payload(self, request):
        # S3 allows optional body signing, so to minimize the performance
        # impact, we opt to not SHA256 sign the body on streaming uploads,
        # provided that we're on https.
        client_config = request.context.get('client_config')
        s3_config = getattr(client_config, 's3', None)

        # The config could be None if it isn't set, or if the customer sets it
        # to None.
        if s3_config is None:
            s3_config = {}

        # The explicit configuration takes precedence over any implicit
        # configuration.
        sign_payload = s3_config.get('payload_signing_enabled', None)
        if sign_payload is not None:
            return sign_payload

        # We require that both content-md5 be present and https be enabled
        # to implicitly disable body signing. The combination of TLS and
        # content-md5 is sufficiently secure and durable for us to be
        # confident in the request without body signing.
        if (
            not request.url.startswith('https')
            or 'Content-MD5' not in request.headers
        ):
            return True

        # If the input is streaming we disable body signing by default.
        if request.context.get('has_streaming_input', False):
            return False

        # If the S3-specific checks had no results, delegate to the generic
        # checks.
        return super()._should_sha256_sign_payload(request)

    def _should_add_content_sha256_header(self, explicit_payload):
        # Always add X-Amz-Content-SHA256 header
        return True


class CrtSigV4AsymQueryAuth(CrtSigV4AsymAuth):
    DEFAULT_EXPIRES = 3600
    _SIGNATURE_TYPE = awscrt.auth.AwsSignatureType.HTTP_REQUEST_QUERY_PARAMS

    def __init__(
        self, credentials, service_name, region_name, expires=DEFAULT_EXPIRES
    ):
        super().__init__(credentials, service_name, region_name)
        self._expiration_in_seconds = expires

    def _modify_request_before_signing(self, request):
        super()._modify_request_before_signing(request)

        # We automatically set this header, so if it's the auto-set value we
        # want to get rid of it since it doesn't make sense for presigned urls.
        content_type = request.headers.get('content-type')
        if content_type == 'application/x-www-form-urlencoded; charset=utf-8':
            del request.headers['content-type']

        # Now parse the original query string to a dict, inject our new query
        # params, and serialize back to a query string.
        url_parts = urlsplit(request.url)
        # parse_qs makes each value a list, but in our case we know we won't
        # have repeated keys so we know we have single element lists which we
        # can convert back to scalar values.
        query_string_parts = parse_qs(url_parts.query, keep_blank_values=True)
        query_dict = {k: v[0] for k, v in query_string_parts.items()}

        # The spec is particular about this.  It *has* to be:
        # https://<endpoint>?<operation params>&<auth params>
        # You can't mix the two types of params together, i.e just keep doing
        # new_query_params.update(op_params)
        # new_query_params.update(auth_params)
        # percent_encode_sequence(new_query_params)
        if request.data:
            # We also need to move the body params into the query string. To
            # do this, we first have to convert it to a dict.
            query_dict.update(_get_body_as_dict(request))
            request.data = ''
        new_query_string = percent_encode_sequence(query_dict)
        # url_parts is a tuple (and therefore immutable) so we need to create
        # a new url_parts with the new query string.
        # <part>   - <index>
        # scheme   - 0
        # netloc   - 1
        # path     - 2
        # query    - 3  <-- we're replacing this.
        # fragment - 4
        p = url_parts
        new_url_parts = (p[0], p[1], p[2], new_query_string, p[4])
        request.url = urlunsplit(new_url_parts)

    def _apply_signing_changes(self, aws_request, signed_crt_request):
        # Apply changes from signed CRT request to the AWSRequest
        super()._apply_signing_changes(aws_request, signed_crt_request)

        signed_query = urlsplit(signed_crt_request.path).query
        p = urlsplit(aws_request.url)
        # urlsplit() returns a tuple (and therefore immutable) so we
        # need to create new url with the new query string.
        # <part>   - <index>
        # scheme   - 0
        # netloc   - 1
        # path     - 2
        # query    - 3  <-- we're replacing this.
        # fragment - 4
        aws_request.url = urlunsplit((p[0], p[1], p[2], signed_query, p[4]))


class CrtS3SigV4AsymQueryAuth(CrtSigV4AsymQueryAuth):
    """S3 SigV4A auth using query parameters.
    This signer will sign a request using query parameters and signature
    version 4A, i.e a "presigned url" signer.
    """

    # For S3, we do not normalize the path.
    _USE_DOUBLE_URI_ENCODE = False
    _SHOULD_NORMALIZE_URI_PATH = False

    def _should_sha256_sign_payload(self, request):
        # From the doc link above:
        # "You don't include a payload hash in the Canonical Request, because
        # when you create a presigned URL, you don't know anything about the
        # payload. Instead, you use a constant string "UNSIGNED-PAYLOAD".
        return False

    def _should_add_content_sha256_header(self, explicit_payload):
        # Never add X-Amz-Content-SHA256 header
        return False


class CrtSigV4QueryAuth(CrtSigV4Auth):
    DEFAULT_EXPIRES = 3600
    _SIGNATURE_TYPE = awscrt.auth.AwsSignatureType.HTTP_REQUEST_QUERY_PARAMS

    def __init__(
        self, credentials, service_name, region_name, expires=DEFAULT_EXPIRES
    ):
        super().__init__(credentials, service_name, region_name)
        self._expiration_in_seconds = expires

    def _modify_request_before_signing(self, request):
        super()._modify_request_before_signing(request)

        # We automatically set this header, so if it's the auto-set value we
        # want to get rid of it since it doesn't make sense for presigned urls.
        content_type = request.headers.get('content-type')
        if content_type == 'application/x-www-form-urlencoded; charset=utf-8':
            del request.headers['content-type']

        # Now parse the original query string to a dict, inject our new query
        # params, and serialize back to a query string.
        url_parts = urlsplit(request.url)
        # parse_qs makes each value a list, but in our case we know we won't
        # have repeated keys so we know we have single element lists which we
        # can convert back to scalar values.
        query_dict = {
            k: v[0]
            for k, v in parse_qs(
                url_parts.query, keep_blank_values=True
            ).items()
        }
        if request.params:
            query_dict.update(request.params)
            request.params = {}
        # The spec is particular about this.  It *has* to be:
        # https://<endpoint>?<operation params>&<auth params>
        # You can't mix the two types of params together, i.e just keep doing
        # new_query_params.update(op_params)
        # new_query_params.update(auth_params)
        # percent_encode_sequence(new_query_params)
        if request.data:
            # We also need to move the body params into the query string. To
            # do this, we first have to convert it to a dict.
            query_dict.update(_get_body_as_dict(request))
            request.data = ''
        new_query_string = percent_encode_sequence(query_dict)
        # url_parts is a tuple (and therefore immutable) so we need to create
        # a new url_parts with the new query string.
        # <part>   - <index>
        # scheme   - 0
        # netloc   - 1
        # path     - 2
        # query    - 3  <-- we're replacing this.
        # fragment - 4
        p = url_parts
        new_url_parts = (p[0], p[1], p[2], new_query_string, p[4])
        request.url = urlunsplit(new_url_parts)

    def _apply_signing_changes(self, aws_request, signed_crt_request):
        # Apply changes from signed CRT request to the AWSRequest
        super()._apply_signing_changes(aws_request, signed_crt_request)

        signed_query = urlsplit(signed_crt_request.path).query
        p = urlsplit(aws_request.url)
        # urlsplit() returns a tuple (and therefore immutable) so we
        # need to create new url with the new query string.
        # <part>   - <index>
        # scheme   - 0
        # netloc   - 1
        # path     - 2
        # query    - 3  <-- we're replacing this.
        # fragment - 4
        aws_request.url = urlunsplit((p[0], p[1], p[2], signed_query, p[4]))


class CrtS3SigV4QueryAuth(CrtSigV4QueryAuth):
    """S3 SigV4 auth using query parameters.
    This signer will sign a request using query parameters and signature
    version 4, i.e a "presigned url" signer.
    Based off of:
    http://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    """

    # For S3, we do not normalize the path.
    _USE_DOUBLE_URI_ENCODE = False
    _SHOULD_NORMALIZE_URI_PATH = False

    def _should_sha256_sign_payload(self, request):
        # From the doc link above:
        # "You don't include a payload hash in the Canonical Request, because
        # when you create a presigned URL, you don't know anything about the
        # payload. Instead, you use a constant string "UNSIGNED-PAYLOAD".
        return False

    def _should_add_content_sha256_header(self, explicit_payload):
        # Never add X-Amz-Content-SHA256 header
        return False


# Defined at the bottom of module to ensure all Auth
# classes are defined.
CRT_AUTH_TYPE_MAPS = {
    'v4': CrtSigV4Auth,
    'v4-query': CrtSigV4QueryAuth,
    'v4a': CrtSigV4AsymAuth,
    's3v4': CrtS3SigV4Auth,
    's3v4-query': CrtS3SigV4QueryAuth,
    's3v4a': CrtS3SigV4AsymAuth,
    's3v4a-query': CrtS3SigV4AsymQueryAuth,
}
