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
import logging
import re
import threading
from io import BytesIO

import awscrt.http
import awscrt.s3
import botocore.awsrequest
import botocore.session
from awscrt.auth import (
    AwsCredentials,
    AwsCredentialsProvider,
    AwsSigningAlgorithm,
    AwsSigningConfig,
)
from awscrt.io import (
    ClientBootstrap,
    ClientTlsContext,
    DefaultHostResolver,
    EventLoopGroup,
    TlsContextOptions,
)
from awscrt.s3 import S3Client, S3RequestTlsMode, S3RequestType
from botocore import UNSIGNED
from botocore.compat import urlsplit
from botocore.config import Config
from botocore.exceptions import NoCredentialsError
from botocore.utils import ArnParser, InvalidArnException

from s3transfer.constants import MB
from s3transfer.exceptions import TransferNotDoneError
from s3transfer.futures import BaseTransferFuture, BaseTransferMeta
from s3transfer.manager import TransferManager
from s3transfer.utils import (
    CallArgs,
    OSUtils,
    get_callbacks,
    is_s3express_bucket,
)

logger = logging.getLogger(__name__)

CRT_S3_PROCESS_LOCK = None


def acquire_crt_s3_process_lock(name):
    # Currently, the CRT S3 client performs best when there is only one
    # instance of it running on a host. This lock allows an application to
    # signal across processes whether there is another process of the same
    # application using the CRT S3 client and prevent spawning more than one
    # CRT S3 clients running on the system for that application.
    #
    # NOTE: When acquiring the CRT process lock, the lock automatically is
    # released when the lock object is garbage collected. So, the CRT process
    # lock is set as a global so that it is not unintentionally garbage
    # collected/released if reference of the lock is lost.
    global CRT_S3_PROCESS_LOCK
    if CRT_S3_PROCESS_LOCK is None:
        crt_lock = awscrt.s3.CrossProcessLock(name)
        try:
            crt_lock.acquire()
        except RuntimeError:
            # If there is another process that is holding the lock, the CRT
            # returns a RuntimeError. We return None here to signal that our
            # current process was not able to acquire the lock.
            return None
        CRT_S3_PROCESS_LOCK = crt_lock
    return CRT_S3_PROCESS_LOCK


def create_s3_crt_client(
    region,
    crt_credentials_provider=None,
    num_threads=None,
    target_throughput=None,
    part_size=8 * MB,
    use_ssl=True,
    verify=None,
):
    """
    :type region: str
    :param region: The region used for signing

    :type crt_credentials_provider:
        Optional[awscrt.auth.AwsCredentialsProvider]
    :param crt_credentials_provider: CRT AWS credentials provider
        to use to sign requests. If not set, requests will not be signed.

    :type num_threads: Optional[int]
    :param num_threads: Number of worker threads generated. Default
        is the number of processors in the machine.

    :type target_throughput: Optional[int]
    :param target_throughput: Throughput target in bytes per second.
        By default, CRT will automatically attempt to choose a target
        throughput that matches the system's maximum network throughput.
        Currently, if CRT is unable to determine the maximum network
        throughput, a fallback target throughput of ``1_250_000_000`` bytes
        per second (which translates to 10 gigabits per second, or 1.16
        gibibytes per second) is used. To set a specific target
        throughput, set a value for this parameter.

    :type part_size: Optional[int]
    :param part_size: Size, in Bytes, of parts that files will be downloaded
        or uploaded in.

    :type use_ssl: boolean
    :param use_ssl: Whether or not to use SSL.  By default, SSL is used.
        Note that not all services support non-ssl connections.

    :type verify: Optional[boolean/string]
    :param verify: Whether or not to verify SSL certificates.
        By default SSL certificates are verified.  You can provide the
        following values:

        * False - do not validate SSL certificates.  SSL will still be
            used (unless use_ssl is False), but SSL certificates
            will not be verified.
        * path/to/cert/bundle.pem - A filename of the CA cert bundle to
            use. Specify this argument if you want to use a custom CA cert
            bundle instead of the default one on your system.
    """
    event_loop_group = EventLoopGroup(num_threads)
    host_resolver = DefaultHostResolver(event_loop_group)
    bootstrap = ClientBootstrap(event_loop_group, host_resolver)
    tls_connection_options = None

    tls_mode = (
        S3RequestTlsMode.ENABLED if use_ssl else S3RequestTlsMode.DISABLED
    )
    if verify is not None:
        tls_ctx_options = TlsContextOptions()
        if verify:
            tls_ctx_options.override_default_trust_store_from_path(
                ca_filepath=verify
            )
        else:
            tls_ctx_options.verify_peer = False
        client_tls_option = ClientTlsContext(tls_ctx_options)
        tls_connection_options = client_tls_option.new_connection_options()
    target_gbps = _get_crt_throughput_target_gbps(
        provided_throughput_target_bytes=target_throughput
    )
    return S3Client(
        bootstrap=bootstrap,
        region=region,
        credential_provider=crt_credentials_provider,
        part_size=part_size,
        tls_mode=tls_mode,
        tls_connection_options=tls_connection_options,
        throughput_target_gbps=target_gbps,
        enable_s3express=True,
    )


def _get_crt_throughput_target_gbps(provided_throughput_target_bytes=None):
    if provided_throughput_target_bytes is None:
        target_gbps = awscrt.s3.get_recommended_throughput_target_gbps()
        logger.debug(
            'Recommended CRT throughput target in gbps: %s', target_gbps
        )
        if target_gbps is None:
            target_gbps = 10.0
    else:
        # NOTE: The GB constant in s3transfer is technically a gibibyte. The
        # GB constant is not used here because the CRT interprets gigabits
        # for networking as a base power of 10
        # (i.e. 1000 ** 3 instead of 1024 ** 3).
        target_gbps = provided_throughput_target_bytes * 8 / 1_000_000_000
    logger.debug('Using CRT throughput target in gbps: %s', target_gbps)
    return target_gbps


class CRTTransferManager:
    ALLOWED_DOWNLOAD_ARGS = TransferManager.ALLOWED_DOWNLOAD_ARGS
    ALLOWED_UPLOAD_ARGS = TransferManager.ALLOWED_UPLOAD_ARGS
    ALLOWED_DELETE_ARGS = TransferManager.ALLOWED_DELETE_ARGS

    VALIDATE_SUPPORTED_BUCKET_VALUES = True

    _UNSUPPORTED_BUCKET_PATTERNS = TransferManager._UNSUPPORTED_BUCKET_PATTERNS

    def __init__(self, crt_s3_client, crt_request_serializer, osutil=None):
        """A transfer manager interface for Amazon S3 on CRT s3 client.

        :type crt_s3_client: awscrt.s3.S3Client
        :param crt_s3_client: The CRT s3 client, handling all the
            HTTP requests and functions under then hood

        :type crt_request_serializer: s3transfer.crt.BaseCRTRequestSerializer
        :param crt_request_serializer: Serializer, generates unsigned crt HTTP
            request.

        :type osutil: s3transfer.utils.OSUtils
        :param osutil: OSUtils object to use for os-related behavior when
            using with transfer manager.
        """
        if osutil is None:
            self._osutil = OSUtils()
        self._crt_s3_client = crt_s3_client
        self._s3_args_creator = S3ClientArgsCreator(
            crt_request_serializer, self._osutil
        )
        self._crt_exception_translator = (
            crt_request_serializer.translate_crt_exception
        )
        self._future_coordinators = []
        self._semaphore = threading.Semaphore(128)  # not configurable
        # A counter to create unique id's for each transfer submitted.
        self._id_counter = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, *args):
        cancel = False
        if exc_type:
            cancel = True
        self._shutdown(cancel)

    def download(
        self, bucket, key, fileobj, extra_args=None, subscribers=None
    ):
        if extra_args is None:
            extra_args = {}
        if subscribers is None:
            subscribers = {}
        self._validate_all_known_args(extra_args, self.ALLOWED_DOWNLOAD_ARGS)
        self._validate_if_bucket_supported(bucket)
        callargs = CallArgs(
            bucket=bucket,
            key=key,
            fileobj=fileobj,
            extra_args=extra_args,
            subscribers=subscribers,
        )
        return self._submit_transfer("get_object", callargs)

    def upload(self, fileobj, bucket, key, extra_args=None, subscribers=None):
        if extra_args is None:
            extra_args = {}
        if subscribers is None:
            subscribers = {}
        self._validate_all_known_args(extra_args, self.ALLOWED_UPLOAD_ARGS)
        self._validate_if_bucket_supported(bucket)
        self._validate_checksum_algorithm_supported(extra_args)
        callargs = CallArgs(
            bucket=bucket,
            key=key,
            fileobj=fileobj,
            extra_args=extra_args,
            subscribers=subscribers,
        )
        return self._submit_transfer("put_object", callargs)

    def delete(self, bucket, key, extra_args=None, subscribers=None):
        if extra_args is None:
            extra_args = {}
        if subscribers is None:
            subscribers = {}
        self._validate_all_known_args(extra_args, self.ALLOWED_DELETE_ARGS)
        self._validate_if_bucket_supported(bucket)
        callargs = CallArgs(
            bucket=bucket,
            key=key,
            extra_args=extra_args,
            subscribers=subscribers,
        )
        return self._submit_transfer("delete_object", callargs)

    def shutdown(self, cancel=False):
        self._shutdown(cancel)

    def _validate_if_bucket_supported(self, bucket):
        # s3 high level operations don't support some resources
        # (eg. S3 Object Lambda) only direct API calls are available
        # for such resources
        if self.VALIDATE_SUPPORTED_BUCKET_VALUES:
            for resource, pattern in self._UNSUPPORTED_BUCKET_PATTERNS.items():
                match = pattern.match(bucket)
                if match:
                    raise ValueError(
                        f'TransferManager methods do not support {resource} '
                        'resource. Use direct client calls instead.'
                    )

    def _validate_all_known_args(self, actual, allowed):
        for kwarg in actual:
            if kwarg not in allowed:
                raise ValueError(
                    f"Invalid extra_args key '{kwarg}', "
                    f"must be one of: {', '.join(allowed)}"
                )

    def _validate_checksum_algorithm_supported(self, extra_args):
        checksum_algorithm = extra_args.get('ChecksumAlgorithm')
        if checksum_algorithm is None:
            return
        supported_algorithms = list(awscrt.s3.S3ChecksumAlgorithm.__members__)
        if checksum_algorithm.upper() not in supported_algorithms:
            raise ValueError(
                f'ChecksumAlgorithm: {checksum_algorithm} not supported. '
                f'Supported algorithms are: {supported_algorithms}'
            )

    def _cancel_transfers(self):
        for coordinator in self._future_coordinators:
            if not coordinator.done():
                coordinator.cancel()

    def _finish_transfers(self):
        for coordinator in self._future_coordinators:
            coordinator.result()

    def _wait_transfers_done(self):
        for coordinator in self._future_coordinators:
            coordinator.wait_until_on_done_callbacks_complete()

    def _shutdown(self, cancel=False):
        if cancel:
            self._cancel_transfers()
        try:
            self._finish_transfers()

        except KeyboardInterrupt:
            self._cancel_transfers()
        except Exception:
            pass
        finally:
            self._wait_transfers_done()

    def _release_semaphore(self, **kwargs):
        self._semaphore.release()

    def _submit_transfer(self, request_type, call_args):
        on_done_after_calls = [self._release_semaphore]
        coordinator = CRTTransferCoordinator(
            transfer_id=self._id_counter,
            exception_translator=self._crt_exception_translator,
        )
        components = {
            'meta': CRTTransferMeta(self._id_counter, call_args),
            'coordinator': coordinator,
        }
        future = CRTTransferFuture(**components)
        afterdone = AfterDoneHandler(coordinator)
        on_done_after_calls.append(afterdone)

        try:
            self._semaphore.acquire()
            on_queued = self._s3_args_creator.get_crt_callback(
                future, 'queued'
            )
            on_queued()
            crt_callargs = self._s3_args_creator.get_make_request_args(
                request_type,
                call_args,
                coordinator,
                future,
                on_done_after_calls,
            )
            crt_s3_request = self._crt_s3_client.make_request(**crt_callargs)
        except Exception as e:
            coordinator.set_exception(e, True)
            on_done = self._s3_args_creator.get_crt_callback(
                future, 'done', after_subscribers=on_done_after_calls
            )
            on_done(error=e)
        else:
            coordinator.set_s3_request(crt_s3_request)
        self._future_coordinators.append(coordinator)

        self._id_counter += 1
        return future


class CRTTransferMeta(BaseTransferMeta):
    """Holds metadata about the CRTTransferFuture"""

    def __init__(self, transfer_id=None, call_args=None):
        self._transfer_id = transfer_id
        self._call_args = call_args
        self._user_context = {}

    @property
    def call_args(self):
        return self._call_args

    @property
    def transfer_id(self):
        return self._transfer_id

    @property
    def user_context(self):
        return self._user_context


class CRTTransferFuture(BaseTransferFuture):
    def __init__(self, meta=None, coordinator=None):
        """The future associated to a submitted transfer request via CRT S3 client

        :type meta: s3transfer.crt.CRTTransferMeta
        :param meta: The metadata associated to the transfer future.

        :type coordinator: s3transfer.crt.CRTTransferCoordinator
        :param coordinator: The coordinator associated to the transfer future.
        """
        self._meta = meta
        if meta is None:
            self._meta = CRTTransferMeta()
        self._coordinator = coordinator

    @property
    def meta(self):
        return self._meta

    def done(self):
        return self._coordinator.done()

    def result(self, timeout=None):
        self._coordinator.result(timeout)

    def cancel(self):
        self._coordinator.cancel()

    def set_exception(self, exception):
        """Sets the exception on the future."""
        if not self.done():
            raise TransferNotDoneError(
                'set_exception can only be called once the transfer is '
                'complete.'
            )
        self._coordinator.set_exception(exception, override=True)


class BaseCRTRequestSerializer:
    def serialize_http_request(self, transfer_type, future):
        """Serialize CRT HTTP requests.

        :type transfer_type: string
        :param transfer_type: the type of transfer made,
            e.g 'put_object', 'get_object', 'delete_object'

        :type future: s3transfer.crt.CRTTransferFuture

        :rtype: awscrt.http.HttpRequest
        :returns: An unsigned HTTP request to be used for the CRT S3 client
        """
        raise NotImplementedError('serialize_http_request()')

    def translate_crt_exception(self, exception):
        raise NotImplementedError('translate_crt_exception()')


class BotocoreCRTRequestSerializer(BaseCRTRequestSerializer):
    def __init__(self, session, client_kwargs=None):
        """Serialize CRT HTTP request using botocore logic
        It also takes into account configuration from both the session
        and any keyword arguments that could be passed to
        `Session.create_client()` when serializing the request.

        :type session: botocore.session.Session

        :type client_kwargs: Optional[Dict[str, str]])
        :param client_kwargs: The kwargs for the botocore
            s3 client initialization.
        """
        self._session = session
        if client_kwargs is None:
            client_kwargs = {}
        self._resolve_client_config(session, client_kwargs)
        self._client = session.create_client(**client_kwargs)
        self._client.meta.events.register(
            'request-created.s3.*', self._capture_http_request
        )
        self._client.meta.events.register(
            'after-call.s3.*', self._change_response_to_serialized_http_request
        )
        self._client.meta.events.register(
            'before-send.s3.*', self._make_fake_http_response
        )

    def _resolve_client_config(self, session, client_kwargs):
        user_provided_config = None
        if session.get_default_client_config():
            user_provided_config = session.get_default_client_config()
        if 'config' in client_kwargs:
            user_provided_config = client_kwargs['config']

        client_config = Config(signature_version=UNSIGNED)
        if user_provided_config:
            client_config = user_provided_config.merge(client_config)
        client_kwargs['config'] = client_config
        client_kwargs["service_name"] = "s3"

    def _crt_request_from_aws_request(self, aws_request):
        url_parts = urlsplit(aws_request.url)
        crt_path = url_parts.path
        if url_parts.query:
            crt_path = f'{crt_path}?{url_parts.query}'
        headers_list = []
        for name, value in aws_request.headers.items():
            if isinstance(value, str):
                headers_list.append((name, value))
            else:
                headers_list.append((name, str(value, 'utf-8')))

        crt_headers = awscrt.http.HttpHeaders(headers_list)

        crt_request = awscrt.http.HttpRequest(
            method=aws_request.method,
            path=crt_path,
            headers=crt_headers,
            body_stream=aws_request.body,
        )
        return crt_request

    def _convert_to_crt_http_request(self, botocore_http_request):
        # Logic that does CRTUtils.crt_request_from_aws_request
        crt_request = self._crt_request_from_aws_request(botocore_http_request)
        if crt_request.headers.get("host") is None:
            # If host is not set, set it for the request before using CRT s3
            url_parts = urlsplit(botocore_http_request.url)
            crt_request.headers.set("host", url_parts.netloc)
        if crt_request.headers.get('Content-MD5') is not None:
            crt_request.headers.remove("Content-MD5")

        # In general, the CRT S3 client expects a content length header. It
        # only expects a missing content length header if the body is not
        # seekable. However, botocore does not set the content length header
        # for GetObject API requests and so we set the content length to zero
        # to meet the CRT S3 client's expectation that the content length
        # header is set even if there is no body.
        if crt_request.headers.get('Content-Length') is None:
            if botocore_http_request.body is None:
                crt_request.headers.add('Content-Length', "0")

        # Botocore sets the Transfer-Encoding header when it cannot determine
        # the content length of the request body (e.g. it's not seekable).
        # However, CRT does not support this header, but it supports
        # non-seekable bodies. So we remove this header to not cause issues
        # in the downstream CRT S3 request.
        if crt_request.headers.get('Transfer-Encoding') is not None:
            crt_request.headers.remove('Transfer-Encoding')

        return crt_request

    def _capture_http_request(self, request, **kwargs):
        request.context['http_request'] = request

    def _change_response_to_serialized_http_request(
        self, context, parsed, **kwargs
    ):
        request = context['http_request']
        parsed['HTTPRequest'] = request.prepare()

    def _make_fake_http_response(self, request, **kwargs):
        return botocore.awsrequest.AWSResponse(
            None,
            200,
            {},
            FakeRawResponse(b""),
        )

    def _get_botocore_http_request(self, client_method, call_args):
        return getattr(self._client, client_method)(
            Bucket=call_args.bucket, Key=call_args.key, **call_args.extra_args
        )['HTTPRequest']

    def serialize_http_request(self, transfer_type, future):
        botocore_http_request = self._get_botocore_http_request(
            transfer_type, future.meta.call_args
        )
        crt_request = self._convert_to_crt_http_request(botocore_http_request)
        return crt_request

    def translate_crt_exception(self, exception):
        if isinstance(exception, awscrt.s3.S3ResponseError):
            return self._translate_crt_s3_response_error(exception)
        else:
            return None

    def _translate_crt_s3_response_error(self, s3_response_error):
        status_code = s3_response_error.status_code
        if status_code < 301:
            # Botocore's exception parsing only
            # runs on status codes >= 301
            return None

        headers = {k: v for k, v in s3_response_error.headers}
        operation_name = s3_response_error.operation_name
        if operation_name is not None:
            service_model = self._client.meta.service_model
            shape = service_model.operation_model(operation_name).output_shape
        else:
            shape = None

        response_dict = {
            'headers': botocore.awsrequest.HeadersDict(headers),
            'status_code': status_code,
            'body': s3_response_error.body,
        }
        parsed_response = self._client._response_parser.parse(
            response_dict, shape=shape
        )

        error_code = parsed_response.get("Error", {}).get("Code")
        error_class = self._client.exceptions.from_code(error_code)
        return error_class(parsed_response, operation_name=operation_name)


class FakeRawResponse(BytesIO):
    def stream(self, amt=1024, decode_content=None):
        while True:
            chunk = self.read(amt)
            if not chunk:
                break
            yield chunk


class BotocoreCRTCredentialsWrapper:
    def __init__(self, resolved_botocore_credentials):
        self._resolved_credentials = resolved_botocore_credentials

    def __call__(self):
        credentials = self._get_credentials().get_frozen_credentials()
        return AwsCredentials(
            credentials.access_key, credentials.secret_key, credentials.token
        )

    def to_crt_credentials_provider(self):
        return AwsCredentialsProvider.new_delegate(self)

    def _get_credentials(self):
        if self._resolved_credentials is None:
            raise NoCredentialsError()
        return self._resolved_credentials


class CRTTransferCoordinator:
    """A helper class for managing CRTTransferFuture"""

    def __init__(
        self, transfer_id=None, s3_request=None, exception_translator=None
    ):
        self.transfer_id = transfer_id
        self._exception_translator = exception_translator
        self._s3_request = s3_request
        self._lock = threading.Lock()
        self._exception = None
        self._crt_future = None
        self._done_event = threading.Event()

    @property
    def s3_request(self):
        return self._s3_request

    def set_done_callbacks_complete(self):
        self._done_event.set()

    def wait_until_on_done_callbacks_complete(self, timeout=None):
        self._done_event.wait(timeout)

    def set_exception(self, exception, override=False):
        with self._lock:
            if not self.done() or override:
                self._exception = exception

    def cancel(self):
        if self._s3_request:
            self._s3_request.cancel()

    def result(self, timeout=None):
        if self._exception:
            raise self._exception
        try:
            self._crt_future.result(timeout)
        except KeyboardInterrupt:
            self.cancel()
            self._crt_future.result(timeout)
            raise
        except Exception as e:
            self.handle_exception(e)
        finally:
            if self._s3_request:
                self._s3_request = None

    def handle_exception(self, exc):
        translated_exc = None
        if self._exception_translator:
            try:
                translated_exc = self._exception_translator(exc)
            except Exception as e:
                # Bail out if we hit an issue translating
                # and raise the original error.
                logger.debug("Unable to translate exception.", exc_info=e)
                pass
        if translated_exc is not None:
            raise translated_exc from exc
        else:
            raise exc

    def done(self):
        if self._crt_future is None:
            return False
        return self._crt_future.done()

    def set_s3_request(self, s3_request):
        self._s3_request = s3_request
        self._crt_future = self._s3_request.finished_future


class S3ClientArgsCreator:
    def __init__(self, crt_request_serializer, os_utils):
        self._request_serializer = crt_request_serializer
        self._os_utils = os_utils

    def get_make_request_args(
        self, request_type, call_args, coordinator, future, on_done_after_calls
    ):
        request_args_handler = getattr(
            self,
            f'_get_make_request_args_{request_type}',
            self._default_get_make_request_args,
        )
        return request_args_handler(
            request_type=request_type,
            call_args=call_args,
            coordinator=coordinator,
            future=future,
            on_done_before_calls=[],
            on_done_after_calls=on_done_after_calls,
        )

    def get_crt_callback(
        self,
        future,
        callback_type,
        before_subscribers=None,
        after_subscribers=None,
    ):
        def invoke_all_callbacks(*args, **kwargs):
            callbacks_list = []
            if before_subscribers is not None:
                callbacks_list += before_subscribers
            callbacks_list += get_callbacks(future, callback_type)
            if after_subscribers is not None:
                callbacks_list += after_subscribers
            for callback in callbacks_list:
                # The get_callbacks helper will set the first augment
                # by keyword, the other augments need to be set by keyword
                # as well
                if callback_type == "progress":
                    callback(bytes_transferred=args[0])
                else:
                    callback(*args, **kwargs)

        return invoke_all_callbacks

    def _get_make_request_args_put_object(
        self,
        request_type,
        call_args,
        coordinator,
        future,
        on_done_before_calls,
        on_done_after_calls,
    ):
        send_filepath = None
        if isinstance(call_args.fileobj, str):
            send_filepath = call_args.fileobj
            data_len = self._os_utils.get_file_size(send_filepath)
            call_args.extra_args["ContentLength"] = data_len
        else:
            call_args.extra_args["Body"] = call_args.fileobj

        checksum_algorithm = call_args.extra_args.pop(
            'ChecksumAlgorithm', 'CRC32'
        ).upper()
        checksum_config = awscrt.s3.S3ChecksumConfig(
            algorithm=awscrt.s3.S3ChecksumAlgorithm[checksum_algorithm],
            location=awscrt.s3.S3ChecksumLocation.TRAILER,
        )
        # Suppress botocore's automatic MD5 calculation by setting an override
        # value that will get deleted in the BotocoreCRTRequestSerializer.
        # As part of the CRT S3 request, we request the CRT S3 client to
        # automatically add trailing checksums to its uploads.
        call_args.extra_args["ContentMD5"] = "override-to-be-removed"

        make_request_args = self._default_get_make_request_args(
            request_type=request_type,
            call_args=call_args,
            coordinator=coordinator,
            future=future,
            on_done_before_calls=on_done_before_calls,
            on_done_after_calls=on_done_after_calls,
        )
        make_request_args['send_filepath'] = send_filepath
        make_request_args['checksum_config'] = checksum_config
        return make_request_args

    def _get_make_request_args_get_object(
        self,
        request_type,
        call_args,
        coordinator,
        future,
        on_done_before_calls,
        on_done_after_calls,
    ):
        recv_filepath = None
        on_body = None
        checksum_config = awscrt.s3.S3ChecksumConfig(validate_response=True)
        if isinstance(call_args.fileobj, str):
            final_filepath = call_args.fileobj
            recv_filepath = self._os_utils.get_temp_filename(final_filepath)
            on_done_before_calls.append(
                RenameTempFileHandler(
                    coordinator, final_filepath, recv_filepath, self._os_utils
                )
            )
        else:
            on_body = OnBodyFileObjWriter(call_args.fileobj)

        make_request_args = self._default_get_make_request_args(
            request_type=request_type,
            call_args=call_args,
            coordinator=coordinator,
            future=future,
            on_done_before_calls=on_done_before_calls,
            on_done_after_calls=on_done_after_calls,
        )
        make_request_args['recv_filepath'] = recv_filepath
        make_request_args['on_body'] = on_body
        make_request_args['checksum_config'] = checksum_config
        return make_request_args

    def _default_get_make_request_args(
        self,
        request_type,
        call_args,
        coordinator,
        future,
        on_done_before_calls,
        on_done_after_calls,
    ):
        make_request_args = {
            'request': self._request_serializer.serialize_http_request(
                request_type, future
            ),
            'type': getattr(
                S3RequestType, request_type.upper(), S3RequestType.DEFAULT
            ),
            'on_done': self.get_crt_callback(
                future, 'done', on_done_before_calls, on_done_after_calls
            ),
            'on_progress': self.get_crt_callback(future, 'progress'),
        }

        # For DEFAULT requests, CRT requires the official S3 operation name.
        # So transform string like "delete_object" -> "DeleteObject".
        if make_request_args['type'] == S3RequestType.DEFAULT:
            make_request_args['operation_name'] = ''.join(
                x.title() for x in request_type.split('_')
            )

        arn_handler = _S3ArnParamHandler()
        if (
            accesspoint_arn_details := arn_handler.handle_arn(call_args.bucket)
        ) and accesspoint_arn_details['region'] == "":
            # Configure our region to `*` to propogate in `x-amz-region-set`
            # for multi-region support in MRAP accesspoints.
            make_request_args['signing_config'] = AwsSigningConfig(
                algorithm=AwsSigningAlgorithm.V4_ASYMMETRIC,
                region="*",
            )
            call_args.bucket = accesspoint_arn_details['resource_name']
        elif is_s3express_bucket(call_args.bucket):
            make_request_args['signing_config'] = AwsSigningConfig(
                algorithm=AwsSigningAlgorithm.V4_S3EXPRESS
            )
        return make_request_args


class RenameTempFileHandler:
    def __init__(self, coordinator, final_filename, temp_filename, osutil):
        self._coordinator = coordinator
        self._final_filename = final_filename
        self._temp_filename = temp_filename
        self._osutil = osutil

    def __call__(self, **kwargs):
        error = kwargs['error']
        if error:
            self._osutil.remove_file(self._temp_filename)
        else:
            try:
                self._osutil.rename_file(
                    self._temp_filename, self._final_filename
                )
            except Exception as e:
                self._osutil.remove_file(self._temp_filename)
                # the CRT future has done already at this point
                self._coordinator.set_exception(e)


class AfterDoneHandler:
    def __init__(self, coordinator):
        self._coordinator = coordinator

    def __call__(self, **kwargs):
        self._coordinator.set_done_callbacks_complete()


class OnBodyFileObjWriter:
    def __init__(self, fileobj):
        self._fileobj = fileobj

    def __call__(self, chunk, **kwargs):
        self._fileobj.write(chunk)


class _S3ArnParamHandler:
    """Partial port of S3ArnParamHandler from botocore.

    This is used to make a determination on MRAP accesspoints for signing
    purposes. This should be safe to remove once we properly integrate auth
    resolution from Botocore into the CRT transfer integration.
    """

    _RESOURCE_REGEX = re.compile(
        r'^(?P<resource_type>accesspoint|outpost)[/:](?P<resource_name>.+)$'
    )

    def __init__(self):
        self._arn_parser = ArnParser()

    def handle_arn(self, bucket):
        arn_details = self._get_arn_details_from_bucket(bucket)
        if arn_details is None:
            return
        if arn_details['resource_type'] == 'accesspoint':
            return arn_details

    def _get_arn_details_from_bucket(self, bucket):
        try:
            arn_details = self._arn_parser.parse_arn(bucket)
            self._add_resource_type_and_name(arn_details)
            return arn_details
        except InvalidArnException:
            pass
        return None

    def _add_resource_type_and_name(self, arn_details):
        match = self._RESOURCE_REGEX.match(arn_details['resource'])
        if match:
            arn_details['resource_type'] = match.group('resource_type')
            arn_details['resource_name'] = match.group('resource_name')
