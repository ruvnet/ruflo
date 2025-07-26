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
import math
from io import BytesIO

from s3transfer.compat import readable, seekable
from s3transfer.futures import IN_MEMORY_UPLOAD_TAG
from s3transfer.tasks import (
    CompleteMultipartUploadTask,
    CreateMultipartUploadTask,
    SubmissionTask,
    Task,
)
from s3transfer.utils import (
    ChunksizeAdjuster,
    DeferredOpenFile,
    get_callbacks,
    get_filtered_dict,
)


class AggregatedProgressCallback:
    def __init__(self, callbacks, threshold=1024 * 256):
        """Aggregates progress updates for every provided progress callback

        :type callbacks: A list of functions that accepts bytes_transferred
            as a single argument
        :param callbacks: The callbacks to invoke when threshold is reached

        :type threshold: int
        :param threshold: The progress threshold in which to take the
            aggregated progress and invoke the progress callback with that
            aggregated progress total
        """
        self._callbacks = callbacks
        self._threshold = threshold
        self._bytes_seen = 0

    def __call__(self, bytes_transferred):
        self._bytes_seen += bytes_transferred
        if self._bytes_seen >= self._threshold:
            self._trigger_callbacks()

    def flush(self):
        """Flushes out any progress that has not been sent to its callbacks"""
        if self._bytes_seen > 0:
            self._trigger_callbacks()

    def _trigger_callbacks(self):
        for callback in self._callbacks:
            callback(bytes_transferred=self._bytes_seen)
        self._bytes_seen = 0


class InterruptReader:
    """Wrapper that can interrupt reading using an error

    It uses a transfer coordinator to propagate an error if it notices
    that a read is being made while the file is being read from.

    :type fileobj: file-like obj
    :param fileobj: The file-like object to read from

    :type transfer_coordinator: s3transfer.futures.TransferCoordinator
    :param transfer_coordinator: The transfer coordinator to use if the
        reader needs to be interrupted.
    """

    def __init__(self, fileobj, transfer_coordinator):
        self._fileobj = fileobj
        self._transfer_coordinator = transfer_coordinator

    def read(self, amount=None):
        # If there is an exception, then raise the exception.
        # We raise an error instead of returning no bytes because for
        # requests where the content length and md5 was sent, it will
        # cause md5 mismatches and retries as there was no indication that
        # the stream being read from encountered any issues.
        if self._transfer_coordinator.exception:
            raise self._transfer_coordinator.exception
        return self._fileobj.read(amount)

    def seek(self, where, whence=0):
        self._fileobj.seek(where, whence)

    def tell(self):
        return self._fileobj.tell()

    def close(self):
        self._fileobj.close()

    def __enter__(self):
        return self

    def __exit__(self, *args, **kwargs):
        self.close()


class UploadInputManager:
    """Base manager class for handling various types of files for uploads

    This class is typically used for the UploadSubmissionTask class to help
    determine the following:

        * How to determine the size of the file
        * How to determine if a multipart upload is required
        * How to retrieve the body for a PutObject
        * How to retrieve the bodies for a set of UploadParts

    The answers/implementations differ for the various types of file inputs
    that may be accepted. All implementations must subclass and override
    public methods from this class.
    """

    def __init__(self, osutil, transfer_coordinator, bandwidth_limiter=None):
        self._osutil = osutil
        self._transfer_coordinator = transfer_coordinator
        self._bandwidth_limiter = bandwidth_limiter

    @classmethod
    def is_compatible(cls, upload_source):
        """Determines if the source for the upload is compatible with manager

        :param upload_source: The source for which the upload will pull data
            from.

        :returns: True if the manager can handle the type of source specified
            otherwise returns False.
        """
        raise NotImplementedError('must implement _is_compatible()')

    def stores_body_in_memory(self, operation_name):
        """Whether the body it provides are stored in-memory

        :type operation_name: str
        :param operation_name: The name of the client operation that the body
            is being used for. Valid operation_names are ``put_object`` and
            ``upload_part``.

        :rtype: boolean
        :returns: True if the body returned by the manager will be stored in
            memory. False if the manager will not directly store the body in
            memory.
        """
        raise NotImplementedError('must implement store_body_in_memory()')

    def provide_transfer_size(self, transfer_future):
        """Provides the transfer size of an upload

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The future associated with upload request
        """
        raise NotImplementedError('must implement provide_transfer_size()')

    def requires_multipart_upload(self, transfer_future, config):
        """Determines where a multipart upload is required

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The future associated with upload request

        :type config: s3transfer.manager.TransferConfig
        :param config: The config associated to the transfer manager

        :rtype: boolean
        :returns: True, if the upload should be multipart based on
            configuration and size. False, otherwise.
        """
        raise NotImplementedError('must implement requires_multipart_upload()')

    def get_put_object_body(self, transfer_future):
        """Returns the body to use for PutObject

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The future associated with upload request

        :type config: s3transfer.manager.TransferConfig
        :param config: The config associated to the transfer manager

        :rtype: s3transfer.utils.ReadFileChunk
        :returns: A ReadFileChunk including all progress callbacks
            associated with the transfer future.
        """
        raise NotImplementedError('must implement get_put_object_body()')

    def yield_upload_part_bodies(self, transfer_future, chunksize):
        """Yields the part number and body to use for each UploadPart

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The future associated with upload request

        :type chunksize: int
        :param chunksize: The chunksize to use for this upload.

        :rtype: int, s3transfer.utils.ReadFileChunk
        :returns: Yields the part number and the ReadFileChunk including all
            progress callbacks associated with the transfer future for that
            specific yielded part.
        """
        raise NotImplementedError('must implement yield_upload_part_bodies()')

    def _wrap_fileobj(self, fileobj):
        fileobj = InterruptReader(fileobj, self._transfer_coordinator)
        if self._bandwidth_limiter:
            fileobj = self._bandwidth_limiter.get_bandwith_limited_stream(
                fileobj, self._transfer_coordinator, enabled=False
            )
        return fileobj

    def _get_progress_callbacks(self, transfer_future):
        callbacks = get_callbacks(transfer_future, 'progress')
        # We only want to be wrapping the callbacks if there are callbacks to
        # invoke because we do not want to be doing any unnecessary work if
        # there are no callbacks to invoke.
        if callbacks:
            return [AggregatedProgressCallback(callbacks)]
        return []

    def _get_close_callbacks(self, aggregated_progress_callbacks):
        return [callback.flush for callback in aggregated_progress_callbacks]


class UploadFilenameInputManager(UploadInputManager):
    """Upload utility for filenames"""

    @classmethod
    def is_compatible(cls, upload_source):
        return isinstance(upload_source, str)

    def stores_body_in_memory(self, operation_name):
        return False

    def provide_transfer_size(self, transfer_future):
        transfer_future.meta.provide_transfer_size(
            self._osutil.get_file_size(transfer_future.meta.call_args.fileobj)
        )

    def requires_multipart_upload(self, transfer_future, config):
        return transfer_future.meta.size >= config.multipart_threshold

    def get_put_object_body(self, transfer_future):
        # Get a file-like object for the given input
        fileobj, full_size = self._get_put_object_fileobj_with_full_size(
            transfer_future
        )

        # Wrap fileobj with interrupt reader that will quickly cancel
        # uploads if needed instead of having to wait for the socket
        # to completely read all of the data.
        fileobj = self._wrap_fileobj(fileobj)

        callbacks = self._get_progress_callbacks(transfer_future)
        close_callbacks = self._get_close_callbacks(callbacks)
        size = transfer_future.meta.size
        # Return the file-like object wrapped into a ReadFileChunk to get
        # progress.
        return self._osutil.open_file_chunk_reader_from_fileobj(
            fileobj=fileobj,
            chunk_size=size,
            full_file_size=full_size,
            callbacks=callbacks,
            close_callbacks=close_callbacks,
        )

    def yield_upload_part_bodies(self, transfer_future, chunksize):
        full_file_size = transfer_future.meta.size
        num_parts = self._get_num_parts(transfer_future, chunksize)
        for part_number in range(1, num_parts + 1):
            callbacks = self._get_progress_callbacks(transfer_future)
            close_callbacks = self._get_close_callbacks(callbacks)
            start_byte = chunksize * (part_number - 1)
            # Get a file-like object for that part and the size of the full
            # file size for the associated file-like object for that part.
            fileobj, full_size = self._get_upload_part_fileobj_with_full_size(
                transfer_future.meta.call_args.fileobj,
                start_byte=start_byte,
                part_size=chunksize,
                full_file_size=full_file_size,
            )

            # Wrap fileobj with interrupt reader that will quickly cancel
            # uploads if needed instead of having to wait for the socket
            # to completely read all of the data.
            fileobj = self._wrap_fileobj(fileobj)

            # Wrap the file-like object into a ReadFileChunk to get progress.
            read_file_chunk = self._osutil.open_file_chunk_reader_from_fileobj(
                fileobj=fileobj,
                chunk_size=chunksize,
                full_file_size=full_size,
                callbacks=callbacks,
                close_callbacks=close_callbacks,
            )
            yield part_number, read_file_chunk

    def _get_deferred_open_file(self, fileobj, start_byte):
        fileobj = DeferredOpenFile(
            fileobj, start_byte, open_function=self._osutil.open
        )
        return fileobj

    def _get_put_object_fileobj_with_full_size(self, transfer_future):
        fileobj = transfer_future.meta.call_args.fileobj
        size = transfer_future.meta.size
        return self._get_deferred_open_file(fileobj, 0), size

    def _get_upload_part_fileobj_with_full_size(self, fileobj, **kwargs):
        start_byte = kwargs['start_byte']
        full_size = kwargs['full_file_size']
        return self._get_deferred_open_file(fileobj, start_byte), full_size

    def _get_num_parts(self, transfer_future, part_size):
        return int(math.ceil(transfer_future.meta.size / float(part_size)))


class UploadSeekableInputManager(UploadFilenameInputManager):
    """Upload utility for an open file object"""

    @classmethod
    def is_compatible(cls, upload_source):
        return readable(upload_source) and seekable(upload_source)

    def stores_body_in_memory(self, operation_name):
        if operation_name == 'put_object':
            return False
        else:
            return True

    def provide_transfer_size(self, transfer_future):
        fileobj = transfer_future.meta.call_args.fileobj
        # To determine size, first determine the starting position
        # Seek to the end and then find the difference in the length
        # between the end and start positions.
        start_position = fileobj.tell()
        fileobj.seek(0, 2)
        end_position = fileobj.tell()
        fileobj.seek(start_position)
        transfer_future.meta.provide_transfer_size(
            end_position - start_position
        )

    def _get_upload_part_fileobj_with_full_size(self, fileobj, **kwargs):
        # Note: It is unfortunate that in order to do a multithreaded
        # multipart upload we cannot simply copy the filelike object
        # since there is not really a mechanism in python (i.e. os.dup
        # points to the same OS filehandle which causes concurrency
        # issues). So instead we need to read from the fileobj and
        # chunk the data out to separate file-like objects in memory.
        data = fileobj.read(kwargs['part_size'])
        # We return the length of the data instead of the full_file_size
        # because we partitioned the data into separate BytesIO objects
        # meaning the BytesIO object has no knowledge of its start position
        # relative the input source nor access to the rest of the input
        # source. So we must treat it as its own standalone file.
        return BytesIO(data), len(data)

    def _get_put_object_fileobj_with_full_size(self, transfer_future):
        fileobj = transfer_future.meta.call_args.fileobj
        # The current position needs to be taken into account when retrieving
        # the full size of the file.
        size = fileobj.tell() + transfer_future.meta.size
        return fileobj, size


class UploadNonSeekableInputManager(UploadInputManager):
    """Upload utility for a file-like object that cannot seek."""

    def __init__(self, osutil, transfer_coordinator, bandwidth_limiter=None):
        super().__init__(osutil, transfer_coordinator, bandwidth_limiter)
        self._initial_data = b''

    @classmethod
    def is_compatible(cls, upload_source):
        return readable(upload_source)

    def stores_body_in_memory(self, operation_name):
        return True

    def provide_transfer_size(self, transfer_future):
        # No-op because there is no way to do this short of reading the entire
        # body into memory.
        return

    def requires_multipart_upload(self, transfer_future, config):
        # If the user has set the size, we can use that.
        if transfer_future.meta.size is not None:
            return transfer_future.meta.size >= config.multipart_threshold

        # This is tricky to determine in this case because we can't know how
        # large the input is. So to figure it out, we read data into memory
        # up until the threshold and compare how much data was actually read
        # against the threshold.
        fileobj = transfer_future.meta.call_args.fileobj
        threshold = config.multipart_threshold
        self._initial_data = self._read(fileobj, threshold, False)
        if len(self._initial_data) < threshold:
            return False
        else:
            return True

    def get_put_object_body(self, transfer_future):
        callbacks = self._get_progress_callbacks(transfer_future)
        close_callbacks = self._get_close_callbacks(callbacks)
        fileobj = transfer_future.meta.call_args.fileobj

        body = self._wrap_data(
            self._initial_data + fileobj.read(), callbacks, close_callbacks
        )

        # Zero out the stored data so we don't have additional copies
        # hanging around in memory.
        self._initial_data = None
        return body

    def yield_upload_part_bodies(self, transfer_future, chunksize):
        file_object = transfer_future.meta.call_args.fileobj
        part_number = 0

        # Continue reading parts from the file-like object until it is empty.
        while True:
            callbacks = self._get_progress_callbacks(transfer_future)
            close_callbacks = self._get_close_callbacks(callbacks)
            part_number += 1
            part_content = self._read(file_object, chunksize)
            if not part_content:
                break
            part_object = self._wrap_data(
                part_content, callbacks, close_callbacks
            )

            # Zero out part_content to avoid hanging on to additional data.
            part_content = None
            yield part_number, part_object

    def _read(self, fileobj, amount, truncate=True):
        """
        Reads a specific amount of data from a stream and returns it. If there
        is any data in initial_data, that will be popped out first.

        :type fileobj: A file-like object that implements read
        :param fileobj: The stream to read from.

        :type amount: int
        :param amount: The number of bytes to read from the stream.

        :type truncate: bool
        :param truncate: Whether or not to truncate initial_data after
            reading from it.

        :return: Generator which generates part bodies from the initial data.
        """
        # If the the initial data is empty, we simply read from the fileobj
        if len(self._initial_data) == 0:
            return fileobj.read(amount)

        # If the requested number of bytes is less than the amount of
        # initial data, pull entirely from initial data.
        if amount <= len(self._initial_data):
            data = self._initial_data[:amount]
            # Truncate initial data so we don't hang onto the data longer
            # than we need.
            if truncate:
                self._initial_data = self._initial_data[amount:]
            return data

        # At this point there is some initial data left, but not enough to
        # satisfy the number of bytes requested. Pull out the remaining
        # initial data and read the rest from the fileobj.
        amount_to_read = amount - len(self._initial_data)
        data = self._initial_data + fileobj.read(amount_to_read)

        # Zero out initial data so we don't hang onto the data any more.
        if truncate:
            self._initial_data = b''
        return data

    def _wrap_data(self, data, callbacks, close_callbacks):
        """
        Wraps data with the interrupt reader and the file chunk reader.

        :type data: bytes
        :param data: The data to wrap.

        :type callbacks: list
        :param callbacks: The callbacks associated with the transfer future.

        :type close_callbacks: list
        :param close_callbacks: The callbacks to be called when closing the
            wrapper for the data.

        :return: Fully wrapped data.
        """
        fileobj = self._wrap_fileobj(BytesIO(data))
        return self._osutil.open_file_chunk_reader_from_fileobj(
            fileobj=fileobj,
            chunk_size=len(data),
            full_file_size=len(data),
            callbacks=callbacks,
            close_callbacks=close_callbacks,
        )


class UploadSubmissionTask(SubmissionTask):
    """Task for submitting tasks to execute an upload"""

    UPLOAD_PART_ARGS = [
        'ChecksumAlgorithm',
        'SSECustomerKey',
        'SSECustomerAlgorithm',
        'SSECustomerKeyMD5',
        'RequestPayer',
        'ExpectedBucketOwner',
    ]

    COMPLETE_MULTIPART_ARGS = [
        'SSECustomerKey',
        'SSECustomerAlgorithm',
        'SSECustomerKeyMD5',
        'RequestPayer',
        'ExpectedBucketOwner',
    ]

    def _get_upload_input_manager_cls(self, transfer_future):
        """Retrieves a class for managing input for an upload based on file type

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The transfer future for the request

        :rtype: class of UploadInputManager
        :returns: The appropriate class to use for managing a specific type of
            input for uploads.
        """
        upload_manager_resolver_chain = [
            UploadFilenameInputManager,
            UploadSeekableInputManager,
            UploadNonSeekableInputManager,
        ]

        fileobj = transfer_future.meta.call_args.fileobj
        for upload_manager_cls in upload_manager_resolver_chain:
            if upload_manager_cls.is_compatible(fileobj):
                return upload_manager_cls
        raise RuntimeError(
            f'Input {fileobj} of type: {type(fileobj)} is not supported.'
        )

    def _submit(
        self,
        client,
        config,
        osutil,
        request_executor,
        transfer_future,
        bandwidth_limiter=None,
    ):
        """
        :param client: The client associated with the transfer manager

        :type config: s3transfer.manager.TransferConfig
        :param config: The transfer config associated with the transfer
            manager

        :type osutil: s3transfer.utils.OSUtil
        :param osutil: The os utility associated to the transfer manager

        :type request_executor: s3transfer.futures.BoundedExecutor
        :param request_executor: The request executor associated with the
            transfer manager

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The transfer future associated with the
            transfer request that tasks are being submitted for
        """
        upload_input_manager = self._get_upload_input_manager_cls(
            transfer_future
        )(osutil, self._transfer_coordinator, bandwidth_limiter)

        # Determine the size if it was not provided
        if transfer_future.meta.size is None:
            upload_input_manager.provide_transfer_size(transfer_future)

        # Do a multipart upload if needed, otherwise do a regular put object.
        if not upload_input_manager.requires_multipart_upload(
            transfer_future, config
        ):
            self._submit_upload_request(
                client,
                config,
                osutil,
                request_executor,
                transfer_future,
                upload_input_manager,
            )
        else:
            self._submit_multipart_request(
                client,
                config,
                osutil,
                request_executor,
                transfer_future,
                upload_input_manager,
            )

    def _submit_upload_request(
        self,
        client,
        config,
        osutil,
        request_executor,
        transfer_future,
        upload_input_manager,
    ):
        call_args = transfer_future.meta.call_args

        # Get any tags that need to be associated to the put object task
        put_object_tag = self._get_upload_task_tag(
            upload_input_manager, 'put_object'
        )

        # Submit the request of a single upload.
        self._transfer_coordinator.submit(
            request_executor,
            PutObjectTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'fileobj': upload_input_manager.get_put_object_body(
                        transfer_future
                    ),
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'extra_args': call_args.extra_args,
                },
                is_final=True,
            ),
            tag=put_object_tag,
        )

    def _submit_multipart_request(
        self,
        client,
        config,
        osutil,
        request_executor,
        transfer_future,
        upload_input_manager,
    ):
        call_args = transfer_future.meta.call_args

        # Submit the request to create a multipart upload.
        create_multipart_future = self._transfer_coordinator.submit(
            request_executor,
            CreateMultipartUploadTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'extra_args': call_args.extra_args,
                },
            ),
        )

        # Submit requests to upload the parts of the file.
        part_futures = []
        extra_part_args = self._extra_upload_part_args(call_args.extra_args)

        # Get any tags that need to be associated to the submitted task
        # for upload the data
        upload_part_tag = self._get_upload_task_tag(
            upload_input_manager, 'upload_part'
        )

        size = transfer_future.meta.size
        adjuster = ChunksizeAdjuster()
        chunksize = adjuster.adjust_chunksize(config.multipart_chunksize, size)
        part_iterator = upload_input_manager.yield_upload_part_bodies(
            transfer_future, chunksize
        )

        for part_number, fileobj in part_iterator:
            part_futures.append(
                self._transfer_coordinator.submit(
                    request_executor,
                    UploadPartTask(
                        transfer_coordinator=self._transfer_coordinator,
                        main_kwargs={
                            'client': client,
                            'fileobj': fileobj,
                            'bucket': call_args.bucket,
                            'key': call_args.key,
                            'part_number': part_number,
                            'extra_args': extra_part_args,
                        },
                        pending_main_kwargs={
                            'upload_id': create_multipart_future
                        },
                    ),
                    tag=upload_part_tag,
                )
            )

        complete_multipart_extra_args = self._extra_complete_multipart_args(
            call_args.extra_args
        )
        # Submit the request to complete the multipart upload.
        self._transfer_coordinator.submit(
            request_executor,
            CompleteMultipartUploadTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'extra_args': complete_multipart_extra_args,
                },
                pending_main_kwargs={
                    'upload_id': create_multipart_future,
                    'parts': part_futures,
                },
                is_final=True,
            ),
        )

    def _extra_upload_part_args(self, extra_args):
        # Only the args in UPLOAD_PART_ARGS actually need to be passed
        # onto the upload_part calls.
        return get_filtered_dict(extra_args, self.UPLOAD_PART_ARGS)

    def _extra_complete_multipart_args(self, extra_args):
        return get_filtered_dict(extra_args, self.COMPLETE_MULTIPART_ARGS)

    def _get_upload_task_tag(self, upload_input_manager, operation_name):
        tag = None
        if upload_input_manager.stores_body_in_memory(operation_name):
            tag = IN_MEMORY_UPLOAD_TAG
        return tag


class PutObjectTask(Task):
    """Task to do a nonmultipart upload"""

    def _main(self, client, fileobj, bucket, key, extra_args):
        """
        :param client: The client to use when calling PutObject
        :param fileobj: The file to upload.
        :param bucket: The name of the bucket to upload to
        :param key: The name of the key to upload to
        :param extra_args: A dictionary of any extra arguments that may be
            used in the upload.
        """
        with fileobj as body:
            client.put_object(Bucket=bucket, Key=key, Body=body, **extra_args)


class UploadPartTask(Task):
    """Task to upload a part in a multipart upload"""

    def _main(
        self, client, fileobj, bucket, key, upload_id, part_number, extra_args
    ):
        """
        :param client: The client to use when calling PutObject
        :param fileobj: The file to upload.
        :param bucket: The name of the bucket to upload to
        :param key: The name of the key to upload to
        :param upload_id: The id of the upload
        :param part_number: The number representing the part of the multipart
            upload
        :param extra_args: A dictionary of any extra arguments that may be
            used in the upload.

        :rtype: dict
        :returns: A dictionary representing a part::

            {'Etag': etag_value, 'PartNumber': part_number}

            This value can be appended to a list to be used to complete
            the multipart upload.
        """
        with fileobj as body:
            response = client.upload_part(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                PartNumber=part_number,
                Body=body,
                **extra_args,
            )
        etag = response['ETag']
        part_metadata = {'ETag': etag, 'PartNumber': part_number}
        if 'ChecksumAlgorithm' in extra_args:
            algorithm_name = extra_args['ChecksumAlgorithm'].upper()
            checksum_member = f'Checksum{algorithm_name}'
            if checksum_member in response:
                part_metadata[checksum_member] = response[checksum_member]
        return part_metadata
