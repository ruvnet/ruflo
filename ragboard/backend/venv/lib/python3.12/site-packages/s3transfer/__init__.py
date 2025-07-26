# Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
"""Abstractions over S3's upload/download operations.

This module provides high level abstractions for efficient
uploads/downloads.  It handles several things for the user:

* Automatically switching to multipart transfers when
  a file is over a specific size threshold
* Uploading/downloading a file in parallel
* Throttling based on max bandwidth
* Progress callbacks to monitor transfers
* Retries.  While botocore handles retries for streaming uploads,
  it is not possible for it to handle retries for streaming
  downloads.  This module handles retries for both cases so
  you don't need to implement any retry logic yourself.

This module has a reasonable set of defaults.  It also allows you
to configure many aspects of the transfer process including:

* Multipart threshold size
* Max parallel downloads
* Max bandwidth
* Socket timeouts
* Retry amounts

There is no support for s3->s3 multipart copies at this
time.


.. _ref_s3transfer_usage:

Usage
=====

The simplest way to use this module is:

.. code-block:: python

    client = boto3.client('s3', 'us-west-2')
    transfer = S3Transfer(client)
    # Upload /tmp/myfile to s3://bucket/key
    transfer.upload_file('/tmp/myfile', 'bucket', 'key')

    # Download s3://bucket/key to /tmp/myfile
    transfer.download_file('bucket', 'key', '/tmp/myfile')

The ``upload_file`` and ``download_file`` methods also accept
``**kwargs``, which will be forwarded through to the corresponding
client operation.  Here are a few examples using ``upload_file``::

    # Making the object public
    transfer.upload_file('/tmp/myfile', 'bucket', 'key',
                         extra_args={'ACL': 'public-read'})

    # Setting metadata
    transfer.upload_file('/tmp/myfile', 'bucket', 'key',
                         extra_args={'Metadata': {'a': 'b', 'c': 'd'}})

    # Setting content type
    transfer.upload_file('/tmp/myfile.json', 'bucket', 'key',
                         extra_args={'ContentType': "application/json"})


The ``S3Transfer`` class also supports progress callbacks so you can
provide transfer progress to users.  Both the ``upload_file`` and
``download_file`` methods take an optional ``callback`` parameter.
Here's an example of how to print a simple progress percentage
to the user:

.. code-block:: python

    class ProgressPercentage(object):
        def __init__(self, filename):
            self._filename = filename
            self._size = float(os.path.getsize(filename))
            self._seen_so_far = 0
            self._lock = threading.Lock()

        def __call__(self, bytes_amount):
            # To simplify we'll assume this is hooked up
            # to a single filename.
            with self._lock:
                self._seen_so_far += bytes_amount
                percentage = (self._seen_so_far / self._size) * 100
                sys.stdout.write(
                    "\r%s  %s / %s  (%.2f%%)" % (self._filename, self._seen_so_far,
                                                 self._size, percentage))
                sys.stdout.flush()


    transfer = S3Transfer(boto3.client('s3', 'us-west-2'))
    # Upload /tmp/myfile to s3://bucket/key and print upload progress.
    transfer.upload_file('/tmp/myfile', 'bucket', 'key',
                         callback=ProgressPercentage('/tmp/myfile'))



You can also provide a TransferConfig object to the S3Transfer
object that gives you more fine grained control over the
transfer.  For example:

.. code-block:: python

    client = boto3.client('s3', 'us-west-2')
    config = TransferConfig(
        multipart_threshold=8 * 1024 * 1024,
        max_concurrency=10,
        num_download_attempts=10,
    )
    transfer = S3Transfer(client, config)
    transfer.upload_file('/tmp/foo', 'bucket', 'key')


"""

import concurrent.futures
import functools
import logging
import math
import os
import queue
import random
import socket
import string
import threading

from botocore.compat import six  # noqa: F401
from botocore.exceptions import IncompleteReadError, ResponseStreamingError
from botocore.vendored.requests.packages.urllib3.exceptions import (
    ReadTimeoutError,
)

import s3transfer.compat
from s3transfer.exceptions import RetriesExceededError, S3UploadFailedError

__author__ = 'Amazon Web Services'
__version__ = '0.10.4'


class NullHandler(logging.Handler):
    def emit(self, record):
        pass


logger = logging.getLogger(__name__)
logger.addHandler(NullHandler())

MB = 1024 * 1024
SHUTDOWN_SENTINEL = object()


def random_file_extension(num_digits=8):
    return ''.join(random.choice(string.hexdigits) for _ in range(num_digits))


def disable_upload_callbacks(request, operation_name, **kwargs):
    if operation_name in ['PutObject', 'UploadPart'] and hasattr(
        request.body, 'disable_callback'
    ):
        request.body.disable_callback()


def enable_upload_callbacks(request, operation_name, **kwargs):
    if operation_name in ['PutObject', 'UploadPart'] and hasattr(
        request.body, 'enable_callback'
    ):
        request.body.enable_callback()


class QueueShutdownError(Exception):
    pass


class ReadFileChunk:
    def __init__(
        self,
        fileobj,
        start_byte,
        chunk_size,
        full_file_size,
        callback=None,
        enable_callback=True,
    ):
        """

        Given a file object shown below:

            |___________________________________________________|
            0          |                 |                 full_file_size
                       |----chunk_size---|
                 start_byte

        :type fileobj: file
        :param fileobj: File like object

        :type start_byte: int
        :param start_byte: The first byte from which to start reading.

        :type chunk_size: int
        :param chunk_size: The max chunk size to read.  Trying to read
            pass the end of the chunk size will behave like you've
            reached the end of the file.

        :type full_file_size: int
        :param full_file_size: The entire content length associated
            with ``fileobj``.

        :type callback: function(amount_read)
        :param callback: Called whenever data is read from this object.

        """
        self._fileobj = fileobj
        self._start_byte = start_byte
        self._size = self._calculate_file_size(
            self._fileobj,
            requested_size=chunk_size,
            start_byte=start_byte,
            actual_file_size=full_file_size,
        )
        self._fileobj.seek(self._start_byte)
        self._amount_read = 0
        self._callback = callback
        self._callback_enabled = enable_callback

    @classmethod
    def from_filename(
        cls,
        filename,
        start_byte,
        chunk_size,
        callback=None,
        enable_callback=True,
    ):
        """Convenience factory function to create from a filename.

        :type start_byte: int
        :param start_byte: The first byte from which to start reading.

        :type chunk_size: int
        :param chunk_size: The max chunk size to read.  Trying to read
            pass the end of the chunk size will behave like you've
            reached the end of the file.

        :type full_file_size: int
        :param full_file_size: The entire content length associated
            with ``fileobj``.

        :type callback: function(amount_read)
        :param callback: Called whenever data is read from this object.

        :type enable_callback: bool
        :param enable_callback: Indicate whether to invoke callback
            during read() calls.

        :rtype: ``ReadFileChunk``
        :return: A new instance of ``ReadFileChunk``

        """
        f = open(filename, 'rb')
        file_size = os.fstat(f.fileno()).st_size
        return cls(
            f, start_byte, chunk_size, file_size, callback, enable_callback
        )

    def _calculate_file_size(
        self, fileobj, requested_size, start_byte, actual_file_size
    ):
        max_chunk_size = actual_file_size - start_byte
        return min(max_chunk_size, requested_size)

    def read(self, amount=None):
        if amount is None:
            amount_to_read = self._size - self._amount_read
        else:
            amount_to_read = min(self._size - self._amount_read, amount)
        data = self._fileobj.read(amount_to_read)
        self._amount_read += len(data)
        if self._callback is not None and self._callback_enabled:
            self._callback(len(data))
        return data

    def enable_callback(self):
        self._callback_enabled = True

    def disable_callback(self):
        self._callback_enabled = False

    def seek(self, where):
        self._fileobj.seek(self._start_byte + where)
        if self._callback is not None and self._callback_enabled:
            # To also rewind the callback() for an accurate progress report
            self._callback(where - self._amount_read)
        self._amount_read = where

    def close(self):
        self._fileobj.close()

    def tell(self):
        return self._amount_read

    def __len__(self):
        # __len__ is defined because requests will try to determine the length
        # of the stream to set a content length.  In the normal case
        # of the file it will just stat the file, but we need to change that
        # behavior.  By providing a __len__, requests will use that instead
        # of stat'ing the file.
        return self._size

    def __enter__(self):
        return self

    def __exit__(self, *args, **kwargs):
        self.close()

    def __iter__(self):
        # This is a workaround for http://bugs.python.org/issue17575
        # Basically httplib will try to iterate over the contents, even
        # if its a file like object.  This wasn't noticed because we've
        # already exhausted the stream so iterating over the file immediately
        # stops, which is what we're simulating here.
        return iter([])


class StreamReaderProgress:
    """Wrapper for a read only stream that adds progress callbacks."""

    def __init__(self, stream, callback=None):
        self._stream = stream
        self._callback = callback

    def read(self, *args, **kwargs):
        value = self._stream.read(*args, **kwargs)
        if self._callback is not None:
            self._callback(len(value))
        return value


class OSUtils:
    def get_file_size(self, filename):
        return os.path.getsize(filename)

    def open_file_chunk_reader(self, filename, start_byte, size, callback):
        return ReadFileChunk.from_filename(
            filename, start_byte, size, callback, enable_callback=False
        )

    def open(self, filename, mode):
        return open(filename, mode)

    def remove_file(self, filename):
        """Remove a file, noop if file does not exist."""
        # Unlike os.remove, if the file does not exist,
        # then this method does nothing.
        try:
            os.remove(filename)
        except OSError:
            pass

    def rename_file(self, current_filename, new_filename):
        s3transfer.compat.rename_file(current_filename, new_filename)


class MultipartUploader:
    # These are the extra_args that need to be forwarded onto
    # subsequent upload_parts.
    UPLOAD_PART_ARGS = [
        'SSECustomerKey',
        'SSECustomerAlgorithm',
        'SSECustomerKeyMD5',
        'RequestPayer',
    ]

    def __init__(
        self,
        client,
        config,
        osutil,
        executor_cls=concurrent.futures.ThreadPoolExecutor,
    ):
        self._client = client
        self._config = config
        self._os = osutil
        self._executor_cls = executor_cls

    def _extra_upload_part_args(self, extra_args):
        # Only the args in UPLOAD_PART_ARGS actually need to be passed
        # onto the upload_part calls.
        upload_parts_args = {}
        for key, value in extra_args.items():
            if key in self.UPLOAD_PART_ARGS:
                upload_parts_args[key] = value
        return upload_parts_args

    def upload_file(self, filename, bucket, key, callback, extra_args):
        response = self._client.create_multipart_upload(
            Bucket=bucket, Key=key, **extra_args
        )
        upload_id = response['UploadId']
        try:
            parts = self._upload_parts(
                upload_id, filename, bucket, key, callback, extra_args
            )
        except Exception as e:
            logger.debug(
                "Exception raised while uploading parts, "
                "aborting multipart upload.",
                exc_info=True,
            )
            self._client.abort_multipart_upload(
                Bucket=bucket, Key=key, UploadId=upload_id
            )
            raise S3UploadFailedError(
                "Failed to upload {} to {}: {}".format(
                    filename, '/'.join([bucket, key]), e
                )
            )
        self._client.complete_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={'Parts': parts},
        )

    def _upload_parts(
        self, upload_id, filename, bucket, key, callback, extra_args
    ):
        upload_parts_extra_args = self._extra_upload_part_args(extra_args)
        parts = []
        part_size = self._config.multipart_chunksize
        num_parts = int(
            math.ceil(self._os.get_file_size(filename) / float(part_size))
        )
        max_workers = self._config.max_concurrency
        with self._executor_cls(max_workers=max_workers) as executor:
            upload_partial = functools.partial(
                self._upload_one_part,
                filename,
                bucket,
                key,
                upload_id,
                part_size,
                upload_parts_extra_args,
                callback,
            )
            for part in executor.map(upload_partial, range(1, num_parts + 1)):
                parts.append(part)
        return parts

    def _upload_one_part(
        self,
        filename,
        bucket,
        key,
        upload_id,
        part_size,
        extra_args,
        callback,
        part_number,
    ):
        open_chunk_reader = self._os.open_file_chunk_reader
        with open_chunk_reader(
            filename, part_size * (part_number - 1), part_size, callback
        ) as body:
            response = self._client.upload_part(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                PartNumber=part_number,
                Body=body,
                **extra_args,
            )
            etag = response['ETag']
            return {'ETag': etag, 'PartNumber': part_number}


class ShutdownQueue(queue.Queue):
    """A queue implementation that can be shutdown.

    Shutting down a queue means that this class adds a
    trigger_shutdown method that will trigger all subsequent
    calls to put() to fail with a ``QueueShutdownError``.

    It purposefully deviates from queue.Queue, and is *not* meant
    to be a drop in replacement for ``queue.Queue``.

    """

    def _init(self, maxsize):
        self._shutdown = False
        self._shutdown_lock = threading.Lock()
        # queue.Queue is an old style class so we don't use super().
        return queue.Queue._init(self, maxsize)

    def trigger_shutdown(self):
        with self._shutdown_lock:
            self._shutdown = True
            logger.debug("The IO queue is now shutdown.")

    def put(self, item):
        # Note: this is not sufficient, it's still possible to deadlock!
        # Need to hook into the condition vars used by this class.
        with self._shutdown_lock:
            if self._shutdown:
                raise QueueShutdownError(
                    "Cannot put item to queue when " "queue has been shutdown."
                )
        return queue.Queue.put(self, item)


class MultipartDownloader:
    def __init__(
        self,
        client,
        config,
        osutil,
        executor_cls=concurrent.futures.ThreadPoolExecutor,
    ):
        self._client = client
        self._config = config
        self._os = osutil
        self._executor_cls = executor_cls
        self._ioqueue = ShutdownQueue(self._config.max_io_queue)

    def download_file(
        self, bucket, key, filename, object_size, extra_args, callback=None
    ):
        with self._executor_cls(max_workers=2) as controller:
            # 1 thread for the future that manages the uploading of files
            # 1 thread for the future that manages IO writes.
            download_parts_handler = functools.partial(
                self._download_file_as_future,
                bucket,
                key,
                filename,
                object_size,
                callback,
            )
            parts_future = controller.submit(download_parts_handler)

            io_writes_handler = functools.partial(
                self._perform_io_writes, filename
            )
            io_future = controller.submit(io_writes_handler)
            results = concurrent.futures.wait(
                [parts_future, io_future],
                return_when=concurrent.futures.FIRST_EXCEPTION,
            )
            self._process_future_results(results)

    def _process_future_results(self, futures):
        finished, unfinished = futures
        for future in finished:
            future.result()

    def _download_file_as_future(
        self, bucket, key, filename, object_size, callback
    ):
        part_size = self._config.multipart_chunksize
        num_parts = int(math.ceil(object_size / float(part_size)))
        max_workers = self._config.max_concurrency
        download_partial = functools.partial(
            self._download_range,
            bucket,
            key,
            filename,
            part_size,
            num_parts,
            callback,
        )
        try:
            with self._executor_cls(max_workers=max_workers) as executor:
                list(executor.map(download_partial, range(num_parts)))
        finally:
            self._ioqueue.put(SHUTDOWN_SENTINEL)

    def _calculate_range_param(self, part_size, part_index, num_parts):
        start_range = part_index * part_size
        if part_index == num_parts - 1:
            end_range = ''
        else:
            end_range = start_range + part_size - 1
        range_param = f'bytes={start_range}-{end_range}'
        return range_param

    def _download_range(
        self, bucket, key, filename, part_size, num_parts, callback, part_index
    ):
        try:
            range_param = self._calculate_range_param(
                part_size, part_index, num_parts
            )

            max_attempts = self._config.num_download_attempts
            last_exception = None
            for i in range(max_attempts):
                try:
                    logger.debug("Making get_object call.")
                    response = self._client.get_object(
                        Bucket=bucket, Key=key, Range=range_param
                    )
                    streaming_body = StreamReaderProgress(
                        response['Body'], callback
                    )
                    buffer_size = 1024 * 16
                    current_index = part_size * part_index
                    for chunk in iter(
                        lambda: streaming_body.read(buffer_size), b''
                    ):
                        self._ioqueue.put((current_index, chunk))
                        current_index += len(chunk)
                    return
                except (
                    socket.timeout,
                    OSError,
                    ReadTimeoutError,
                    IncompleteReadError,
                    ResponseStreamingError,
                ) as e:
                    logger.debug(
                        "Retrying exception caught (%s), "
                        "retrying request, (attempt %s / %s)",
                        e,
                        i,
                        max_attempts,
                        exc_info=True,
                    )
                    last_exception = e
                    continue
            raise RetriesExceededError(last_exception)
        finally:
            logger.debug("EXITING _download_range for part: %s", part_index)

    def _perform_io_writes(self, filename):
        with self._os.open(filename, 'wb') as f:
            while True:
                task = self._ioqueue.get()
                if task is SHUTDOWN_SENTINEL:
                    logger.debug(
                        "Shutdown sentinel received in IO handler, "
                        "shutting down IO handler."
                    )
                    return
                else:
                    try:
                        offset, data = task
                        f.seek(offset)
                        f.write(data)
                    except Exception as e:
                        logger.debug(
                            "Caught exception in IO thread: %s",
                            e,
                            exc_info=True,
                        )
                        self._ioqueue.trigger_shutdown()
                        raise


class TransferConfig:
    def __init__(
        self,
        multipart_threshold=8 * MB,
        max_concurrency=10,
        multipart_chunksize=8 * MB,
        num_download_attempts=5,
        max_io_queue=100,
    ):
        self.multipart_threshold = multipart_threshold
        self.max_concurrency = max_concurrency
        self.multipart_chunksize = multipart_chunksize
        self.num_download_attempts = num_download_attempts
        self.max_io_queue = max_io_queue


class S3Transfer:
    ALLOWED_DOWNLOAD_ARGS = [
        'VersionId',
        'SSECustomerAlgorithm',
        'SSECustomerKey',
        'SSECustomerKeyMD5',
        'RequestPayer',
    ]

    ALLOWED_UPLOAD_ARGS = [
        'ACL',
        'CacheControl',
        'ContentDisposition',
        'ContentEncoding',
        'ContentLanguage',
        'ContentType',
        'Expires',
        'GrantFullControl',
        'GrantRead',
        'GrantReadACP',
        'GrantWriteACL',
        'Metadata',
        'RequestPayer',
        'ServerSideEncryption',
        'StorageClass',
        'SSECustomerAlgorithm',
        'SSECustomerKey',
        'SSECustomerKeyMD5',
        'SSEKMSKeyId',
        'SSEKMSEncryptionContext',
        'Tagging',
    ]

    def __init__(self, client, config=None, osutil=None):
        self._client = client
        if config is None:
            config = TransferConfig()
        self._config = config
        if osutil is None:
            osutil = OSUtils()
        self._osutil = osutil

    def upload_file(
        self, filename, bucket, key, callback=None, extra_args=None
    ):
        """Upload a file to an S3 object.

        Variants have also been injected into S3 client, Bucket and Object.
        You don't have to use S3Transfer.upload_file() directly.
        """
        if extra_args is None:
            extra_args = {}
        self._validate_all_known_args(extra_args, self.ALLOWED_UPLOAD_ARGS)
        events = self._client.meta.events
        events.register_first(
            'request-created.s3',
            disable_upload_callbacks,
            unique_id='s3upload-callback-disable',
        )
        events.register_last(
            'request-created.s3',
            enable_upload_callbacks,
            unique_id='s3upload-callback-enable',
        )
        if (
            self._osutil.get_file_size(filename)
            >= self._config.multipart_threshold
        ):
            self._multipart_upload(filename, bucket, key, callback, extra_args)
        else:
            self._put_object(filename, bucket, key, callback, extra_args)

    def _put_object(self, filename, bucket, key, callback, extra_args):
        # We're using open_file_chunk_reader so we can take advantage of the
        # progress callback functionality.
        open_chunk_reader = self._osutil.open_file_chunk_reader
        with open_chunk_reader(
            filename,
            0,
            self._osutil.get_file_size(filename),
            callback=callback,
        ) as body:
            self._client.put_object(
                Bucket=bucket, Key=key, Body=body, **extra_args
            )

    def download_file(
        self, bucket, key, filename, extra_args=None, callback=None
    ):
        """Download an S3 object to a file.

        Variants have also been injected into S3 client, Bucket and Object.
        You don't have to use S3Transfer.download_file() directly.
        """
        # This method will issue a ``head_object`` request to determine
        # the size of the S3 object.  This is used to determine if the
        # object is downloaded in parallel.
        if extra_args is None:
            extra_args = {}
        self._validate_all_known_args(extra_args, self.ALLOWED_DOWNLOAD_ARGS)
        object_size = self._object_size(bucket, key, extra_args)
        temp_filename = filename + os.extsep + random_file_extension()
        try:
            self._download_file(
                bucket, key, temp_filename, object_size, extra_args, callback
            )
        except Exception:
            logger.debug(
                "Exception caught in download_file, removing partial "
                "file: %s",
                temp_filename,
                exc_info=True,
            )
            self._osutil.remove_file(temp_filename)
            raise
        else:
            self._osutil.rename_file(temp_filename, filename)

    def _download_file(
        self, bucket, key, filename, object_size, extra_args, callback
    ):
        if object_size >= self._config.multipart_threshold:
            self._ranged_download(
                bucket, key, filename, object_size, extra_args, callback
            )
        else:
            self._get_object(bucket, key, filename, extra_args, callback)

    def _validate_all_known_args(self, actual, allowed):
        for kwarg in actual:
            if kwarg not in allowed:
                raise ValueError(
                    f"Invalid extra_args key '{kwarg}', "
                    f"must be one of: {', '.join(allowed)}"
                )

    def _ranged_download(
        self, bucket, key, filename, object_size, extra_args, callback
    ):
        downloader = MultipartDownloader(
            self._client, self._config, self._osutil
        )
        downloader.download_file(
            bucket, key, filename, object_size, extra_args, callback
        )

    def _get_object(self, bucket, key, filename, extra_args, callback):
        # precondition: num_download_attempts > 0
        max_attempts = self._config.num_download_attempts
        last_exception = None
        for i in range(max_attempts):
            try:
                return self._do_get_object(
                    bucket, key, filename, extra_args, callback
                )
            except (
                socket.timeout,
                OSError,
                ReadTimeoutError,
                IncompleteReadError,
                ResponseStreamingError,
            ) as e:
                # TODO: we need a way to reset the callback if the
                # download failed.
                logger.debug(
                    "Retrying exception caught (%s), "
                    "retrying request, (attempt %s / %s)",
                    e,
                    i,
                    max_attempts,
                    exc_info=True,
                )
                last_exception = e
                continue
        raise RetriesExceededError(last_exception)

    def _do_get_object(self, bucket, key, filename, extra_args, callback):
        response = self._client.get_object(
            Bucket=bucket, Key=key, **extra_args
        )
        streaming_body = StreamReaderProgress(response['Body'], callback)
        with self._osutil.open(filename, 'wb') as f:
            for chunk in iter(lambda: streaming_body.read(8192), b''):
                f.write(chunk)

    def _object_size(self, bucket, key, extra_args):
        return self._client.head_object(Bucket=bucket, Key=key, **extra_args)[
            'ContentLength'
        ]

    def _multipart_upload(self, filename, bucket, key, callback, extra_args):
        uploader = MultipartUploader(self._client, self._config, self._osutil)
        uploader.upload_file(filename, bucket, key, callback, extra_args)
