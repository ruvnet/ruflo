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
import heapq
import logging
import threading

from s3transfer.compat import seekable
from s3transfer.exceptions import RetriesExceededError
from s3transfer.futures import IN_MEMORY_DOWNLOAD_TAG
from s3transfer.tasks import SubmissionTask, Task
from s3transfer.utils import (
    S3_RETRYABLE_DOWNLOAD_ERRORS,
    CountCallbackInvoker,
    DeferredOpenFile,
    FunctionContainer,
    StreamReaderProgress,
    calculate_num_parts,
    calculate_range_parameter,
    get_callbacks,
    invoke_progress_callbacks,
)

logger = logging.getLogger(__name__)


class DownloadOutputManager:
    """Base manager class for handling various types of files for downloads

    This class is typically used for the DownloadSubmissionTask class to help
    determine the following:

        * Provides the fileobj to write to downloads to
        * Get a task to complete once everything downloaded has been written

    The answers/implementations differ for the various types of file outputs
    that may be accepted. All implementations must subclass and override
    public methods from this class.
    """

    def __init__(self, osutil, transfer_coordinator, io_executor):
        self._osutil = osutil
        self._transfer_coordinator = transfer_coordinator
        self._io_executor = io_executor

    @classmethod
    def is_compatible(cls, download_target, osutil):
        """Determines if the target for the download is compatible with manager

        :param download_target: The target for which the upload will write
            data to.

        :param osutil: The os utility to be used for the transfer

        :returns: True if the manager can handle the type of target specified
            otherwise returns False.
        """
        raise NotImplementedError('must implement is_compatible()')

    def get_download_task_tag(self):
        """Get the tag (if any) to associate all GetObjectTasks

        :rtype: s3transfer.futures.TaskTag
        :returns: The tag to associate all GetObjectTasks with
        """
        return None

    def get_fileobj_for_io_writes(self, transfer_future):
        """Get file-like object to use for io writes in the io executor

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The future associated with upload request

        returns: A file-like object to write to
        """
        raise NotImplementedError('must implement get_fileobj_for_io_writes()')

    def queue_file_io_task(self, fileobj, data, offset):
        """Queue IO write for submission to the IO executor.

        This method accepts an IO executor and information about the
        downloaded data, and handles submitting this to the IO executor.

        This method may defer submission to the IO executor if necessary.

        """
        self._transfer_coordinator.submit(
            self._io_executor, self.get_io_write_task(fileobj, data, offset)
        )

    def get_io_write_task(self, fileobj, data, offset):
        """Get an IO write task for the requested set of data

        This task can be ran immediately or be submitted to the IO executor
        for it to run.

        :type fileobj: file-like object
        :param fileobj: The file-like object to write to

        :type data: bytes
        :param data: The data to write out

        :type offset: integer
        :param offset: The offset to write the data to in the file-like object

        :returns: An IO task to be used to write data to a file-like object
        """
        return IOWriteTask(
            self._transfer_coordinator,
            main_kwargs={
                'fileobj': fileobj,
                'data': data,
                'offset': offset,
            },
        )

    def get_final_io_task(self):
        """Get the final io task to complete the download

        This is needed because based on the architecture of the TransferManager
        the final tasks will be sent to the IO executor, but the executor
        needs a final task for it to signal that the transfer is done and
        all done callbacks can be run.

        :rtype: s3transfer.tasks.Task
        :returns: A final task to completed in the io executor
        """
        raise NotImplementedError('must implement get_final_io_task()')

    def _get_fileobj_from_filename(self, filename):
        f = DeferredOpenFile(
            filename, mode='wb', open_function=self._osutil.open
        )
        # Make sure the file gets closed and we remove the temporary file
        # if anything goes wrong during the process.
        self._transfer_coordinator.add_failure_cleanup(f.close)
        return f


class DownloadFilenameOutputManager(DownloadOutputManager):
    def __init__(self, osutil, transfer_coordinator, io_executor):
        super().__init__(osutil, transfer_coordinator, io_executor)
        self._final_filename = None
        self._temp_filename = None
        self._temp_fileobj = None

    @classmethod
    def is_compatible(cls, download_target, osutil):
        return isinstance(download_target, str)

    def get_fileobj_for_io_writes(self, transfer_future):
        fileobj = transfer_future.meta.call_args.fileobj
        self._final_filename = fileobj
        self._temp_filename = self._osutil.get_temp_filename(fileobj)
        self._temp_fileobj = self._get_temp_fileobj()
        return self._temp_fileobj

    def get_final_io_task(self):
        # A task to rename the file from the temporary file to its final
        # location is needed. This should be the last task needed to complete
        # the download.
        return IORenameFileTask(
            transfer_coordinator=self._transfer_coordinator,
            main_kwargs={
                'fileobj': self._temp_fileobj,
                'final_filename': self._final_filename,
                'osutil': self._osutil,
            },
            is_final=True,
        )

    def _get_temp_fileobj(self):
        f = self._get_fileobj_from_filename(self._temp_filename)
        self._transfer_coordinator.add_failure_cleanup(
            self._osutil.remove_file, self._temp_filename
        )
        return f


class DownloadSeekableOutputManager(DownloadOutputManager):
    @classmethod
    def is_compatible(cls, download_target, osutil):
        return seekable(download_target)

    def get_fileobj_for_io_writes(self, transfer_future):
        # Return the fileobj provided to the future.
        return transfer_future.meta.call_args.fileobj

    def get_final_io_task(self):
        # This task will serve the purpose of signaling when all of the io
        # writes have finished so done callbacks can be called.
        return CompleteDownloadNOOPTask(
            transfer_coordinator=self._transfer_coordinator
        )


class DownloadNonSeekableOutputManager(DownloadOutputManager):
    def __init__(
        self, osutil, transfer_coordinator, io_executor, defer_queue=None
    ):
        super().__init__(osutil, transfer_coordinator, io_executor)
        if defer_queue is None:
            defer_queue = DeferQueue()
        self._defer_queue = defer_queue
        self._io_submit_lock = threading.Lock()

    @classmethod
    def is_compatible(cls, download_target, osutil):
        return hasattr(download_target, 'write')

    def get_download_task_tag(self):
        return IN_MEMORY_DOWNLOAD_TAG

    def get_fileobj_for_io_writes(self, transfer_future):
        return transfer_future.meta.call_args.fileobj

    def get_final_io_task(self):
        return CompleteDownloadNOOPTask(
            transfer_coordinator=self._transfer_coordinator
        )

    def queue_file_io_task(self, fileobj, data, offset):
        with self._io_submit_lock:
            writes = self._defer_queue.request_writes(offset, data)
            for write in writes:
                data = write['data']
                logger.debug(
                    "Queueing IO offset %s for fileobj: %s",
                    write['offset'],
                    fileobj,
                )
                super().queue_file_io_task(fileobj, data, offset)

    def get_io_write_task(self, fileobj, data, offset):
        return IOStreamingWriteTask(
            self._transfer_coordinator,
            main_kwargs={
                'fileobj': fileobj,
                'data': data,
            },
        )


class DownloadSpecialFilenameOutputManager(DownloadNonSeekableOutputManager):
    def __init__(
        self, osutil, transfer_coordinator, io_executor, defer_queue=None
    ):
        super().__init__(
            osutil, transfer_coordinator, io_executor, defer_queue
        )
        self._fileobj = None

    @classmethod
    def is_compatible(cls, download_target, osutil):
        return isinstance(download_target, str) and osutil.is_special_file(
            download_target
        )

    def get_fileobj_for_io_writes(self, transfer_future):
        filename = transfer_future.meta.call_args.fileobj
        self._fileobj = self._get_fileobj_from_filename(filename)
        return self._fileobj

    def get_final_io_task(self):
        # Make sure the file gets closed once the transfer is done.
        return IOCloseTask(
            transfer_coordinator=self._transfer_coordinator,
            is_final=True,
            main_kwargs={'fileobj': self._fileobj},
        )


class DownloadSubmissionTask(SubmissionTask):
    """Task for submitting tasks to execute a download"""

    def _get_download_output_manager_cls(self, transfer_future, osutil):
        """Retrieves a class for managing output for a download

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The transfer future for the request

        :type osutil: s3transfer.utils.OSUtils
        :param osutil: The os utility associated to the transfer

        :rtype: class of DownloadOutputManager
        :returns: The appropriate class to use for managing a specific type of
            input for downloads.
        """
        download_manager_resolver_chain = [
            DownloadSpecialFilenameOutputManager,
            DownloadFilenameOutputManager,
            DownloadSeekableOutputManager,
            DownloadNonSeekableOutputManager,
        ]

        fileobj = transfer_future.meta.call_args.fileobj
        for download_manager_cls in download_manager_resolver_chain:
            if download_manager_cls.is_compatible(fileobj, osutil):
                return download_manager_cls
        raise RuntimeError(
            f'Output {fileobj} of type: {type(fileobj)} is not supported.'
        )

    def _submit(
        self,
        client,
        config,
        osutil,
        request_executor,
        io_executor,
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

        :type io_executor: s3transfer.futures.BoundedExecutor
        :param io_executor: The io executor associated with the
            transfer manager

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The transfer future associated with the
            transfer request that tasks are being submitted for

        :type bandwidth_limiter: s3transfer.bandwidth.BandwidthLimiter
        :param bandwidth_limiter: The bandwidth limiter to use when
            downloading streams
        """
        if transfer_future.meta.size is None:
            # If a size was not provided figure out the size for the
            # user.
            response = client.head_object(
                Bucket=transfer_future.meta.call_args.bucket,
                Key=transfer_future.meta.call_args.key,
                **transfer_future.meta.call_args.extra_args,
            )
            transfer_future.meta.provide_transfer_size(
                response['ContentLength']
            )

        download_output_manager = self._get_download_output_manager_cls(
            transfer_future, osutil
        )(osutil, self._transfer_coordinator, io_executor)

        # If it is greater than threshold do a ranged download, otherwise
        # do a regular GetObject download.
        if transfer_future.meta.size < config.multipart_threshold:
            self._submit_download_request(
                client,
                config,
                osutil,
                request_executor,
                io_executor,
                download_output_manager,
                transfer_future,
                bandwidth_limiter,
            )
        else:
            self._submit_ranged_download_request(
                client,
                config,
                osutil,
                request_executor,
                io_executor,
                download_output_manager,
                transfer_future,
                bandwidth_limiter,
            )

    def _submit_download_request(
        self,
        client,
        config,
        osutil,
        request_executor,
        io_executor,
        download_output_manager,
        transfer_future,
        bandwidth_limiter,
    ):
        call_args = transfer_future.meta.call_args

        # Get a handle to the file that will be used for writing downloaded
        # contents
        fileobj = download_output_manager.get_fileobj_for_io_writes(
            transfer_future
        )

        # Get the needed callbacks for the task
        progress_callbacks = get_callbacks(transfer_future, 'progress')

        # Get any associated tags for the get object task.
        get_object_tag = download_output_manager.get_download_task_tag()

        # Get the final io task to run once the download is complete.
        final_task = download_output_manager.get_final_io_task()

        # Submit the task to download the object.
        self._transfer_coordinator.submit(
            request_executor,
            ImmediatelyWriteIOGetObjectTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'fileobj': fileobj,
                    'extra_args': call_args.extra_args,
                    'callbacks': progress_callbacks,
                    'max_attempts': config.num_download_attempts,
                    'download_output_manager': download_output_manager,
                    'io_chunksize': config.io_chunksize,
                    'bandwidth_limiter': bandwidth_limiter,
                },
                done_callbacks=[final_task],
            ),
            tag=get_object_tag,
        )

    def _submit_ranged_download_request(
        self,
        client,
        config,
        osutil,
        request_executor,
        io_executor,
        download_output_manager,
        transfer_future,
        bandwidth_limiter,
    ):
        call_args = transfer_future.meta.call_args

        # Get the needed progress callbacks for the task
        progress_callbacks = get_callbacks(transfer_future, 'progress')

        # Get a handle to the file that will be used for writing downloaded
        # contents
        fileobj = download_output_manager.get_fileobj_for_io_writes(
            transfer_future
        )

        # Determine the number of parts
        part_size = config.multipart_chunksize
        num_parts = calculate_num_parts(transfer_future.meta.size, part_size)

        # Get any associated tags for the get object task.
        get_object_tag = download_output_manager.get_download_task_tag()

        # Callback invoker to submit the final io task once all downloads
        # are complete.
        finalize_download_invoker = CountCallbackInvoker(
            self._get_final_io_task_submission_callback(
                download_output_manager, io_executor
            )
        )
        for i in range(num_parts):
            # Calculate the range parameter
            range_parameter = calculate_range_parameter(
                part_size, i, num_parts
            )

            # Inject the Range parameter to the parameters to be passed in
            # as extra args
            extra_args = {'Range': range_parameter}
            extra_args.update(call_args.extra_args)
            finalize_download_invoker.increment()
            # Submit the ranged downloads
            self._transfer_coordinator.submit(
                request_executor,
                GetObjectTask(
                    transfer_coordinator=self._transfer_coordinator,
                    main_kwargs={
                        'client': client,
                        'bucket': call_args.bucket,
                        'key': call_args.key,
                        'fileobj': fileobj,
                        'extra_args': extra_args,
                        'callbacks': progress_callbacks,
                        'max_attempts': config.num_download_attempts,
                        'start_index': i * part_size,
                        'download_output_manager': download_output_manager,
                        'io_chunksize': config.io_chunksize,
                        'bandwidth_limiter': bandwidth_limiter,
                    },
                    done_callbacks=[finalize_download_invoker.decrement],
                ),
                tag=get_object_tag,
            )
        finalize_download_invoker.finalize()

    def _get_final_io_task_submission_callback(
        self, download_manager, io_executor
    ):
        final_task = download_manager.get_final_io_task()
        return FunctionContainer(
            self._transfer_coordinator.submit, io_executor, final_task
        )

    def _calculate_range_param(self, part_size, part_index, num_parts):
        # Used to calculate the Range parameter
        start_range = part_index * part_size
        if part_index == num_parts - 1:
            end_range = ''
        else:
            end_range = start_range + part_size - 1
        range_param = f'bytes={start_range}-{end_range}'
        return range_param


class GetObjectTask(Task):
    def _main(
        self,
        client,
        bucket,
        key,
        fileobj,
        extra_args,
        callbacks,
        max_attempts,
        download_output_manager,
        io_chunksize,
        start_index=0,
        bandwidth_limiter=None,
    ):
        """Downloads an object and places content into io queue

        :param client: The client to use when calling GetObject
        :param bucket: The bucket to download from
        :param key: The key to download from
        :param fileobj: The file handle to write content to
        :param exta_args: Any extra arguments to include in GetObject request
        :param callbacks: List of progress callbacks to invoke on download
        :param max_attempts: The number of retries to do when downloading
        :param download_output_manager: The download output manager associated
            with the current download.
        :param io_chunksize: The size of each io chunk to read from the
            download stream and queue in the io queue.
        :param start_index: The location in the file to start writing the
            content of the key to.
        :param bandwidth_limiter: The bandwidth limiter to use when throttling
            the downloading of data in streams.
        """
        last_exception = None
        for i in range(max_attempts):
            try:
                current_index = start_index
                response = client.get_object(
                    Bucket=bucket, Key=key, **extra_args
                )
                streaming_body = StreamReaderProgress(
                    response['Body'], callbacks
                )
                if bandwidth_limiter:
                    streaming_body = (
                        bandwidth_limiter.get_bandwith_limited_stream(
                            streaming_body, self._transfer_coordinator
                        )
                    )

                chunks = DownloadChunkIterator(streaming_body, io_chunksize)
                for chunk in chunks:
                    # If the transfer is done because of a cancellation
                    # or error somewhere else, stop trying to submit more
                    # data to be written and break out of the download.
                    if not self._transfer_coordinator.done():
                        self._handle_io(
                            download_output_manager,
                            fileobj,
                            chunk,
                            current_index,
                        )
                        current_index += len(chunk)
                    else:
                        return
                return
            except S3_RETRYABLE_DOWNLOAD_ERRORS as e:
                logger.debug(
                    "Retrying exception caught (%s), "
                    "retrying request, (attempt %s / %s)",
                    e,
                    i,
                    max_attempts,
                    exc_info=True,
                )
                last_exception = e
                # Also invoke the progress callbacks to indicate that we
                # are trying to download the stream again and all progress
                # for this GetObject has been lost.
                invoke_progress_callbacks(
                    callbacks, start_index - current_index
                )
                continue
        raise RetriesExceededError(last_exception)

    def _handle_io(self, download_output_manager, fileobj, chunk, index):
        download_output_manager.queue_file_io_task(fileobj, chunk, index)


class ImmediatelyWriteIOGetObjectTask(GetObjectTask):
    """GetObjectTask that immediately writes to the provided file object

    This is useful for downloads where it is known only one thread is
    downloading the object so there is no reason to go through the
    overhead of using an IO queue and executor.
    """

    def _handle_io(self, download_output_manager, fileobj, chunk, index):
        task = download_output_manager.get_io_write_task(fileobj, chunk, index)
        task()


class IOWriteTask(Task):
    def _main(self, fileobj, data, offset):
        """Pulls off an io queue to write contents to a file

        :param fileobj: The file handle to write content to
        :param data: The data to write
        :param offset: The offset to write the data to.
        """
        fileobj.seek(offset)
        fileobj.write(data)


class IOStreamingWriteTask(Task):
    """Task for writing data to a non-seekable stream."""

    def _main(self, fileobj, data):
        """Write data to a fileobj.

        Data will be written directly to the fileobj without
        any prior seeking.

        :param fileobj: The fileobj to write content to
        :param data: The data to write

        """
        fileobj.write(data)


class IORenameFileTask(Task):
    """A task to rename a temporary file to its final filename

    :param fileobj: The file handle that content was written to.
    :param final_filename: The final name of the file to rename to
        upon completion of writing the contents.
    :param osutil: OS utility
    """

    def _main(self, fileobj, final_filename, osutil):
        fileobj.close()
        osutil.rename_file(fileobj.name, final_filename)


class IOCloseTask(Task):
    """A task to close out a file once the download is complete.

    :param fileobj: The fileobj to close.
    """

    def _main(self, fileobj):
        fileobj.close()


class CompleteDownloadNOOPTask(Task):
    """A NOOP task to serve as an indicator that the download is complete

    Note that the default for is_final is set to True because this should
    always be the last task.
    """

    def __init__(
        self,
        transfer_coordinator,
        main_kwargs=None,
        pending_main_kwargs=None,
        done_callbacks=None,
        is_final=True,
    ):
        super().__init__(
            transfer_coordinator=transfer_coordinator,
            main_kwargs=main_kwargs,
            pending_main_kwargs=pending_main_kwargs,
            done_callbacks=done_callbacks,
            is_final=is_final,
        )

    def _main(self):
        pass


class DownloadChunkIterator:
    def __init__(self, body, chunksize):
        """Iterator to chunk out a downloaded S3 stream

        :param body: A readable file-like object
        :param chunksize: The amount to read each time
        """
        self._body = body
        self._chunksize = chunksize
        self._num_reads = 0

    def __iter__(self):
        return self

    def __next__(self):
        chunk = self._body.read(self._chunksize)
        self._num_reads += 1
        if chunk:
            return chunk
        elif self._num_reads == 1:
            # Even though the response may have not had any
            # content, we still want to account for an empty object's
            # existence so return the empty chunk for that initial
            # read.
            return chunk
        raise StopIteration()

    next = __next__


class DeferQueue:
    """IO queue that defers write requests until they are queued sequentially.

    This class is used to track IO data for a *single* fileobj.

    You can send data to this queue, and it will defer any IO write requests
    until it has the next contiguous block available (starting at 0).

    """

    def __init__(self):
        self._writes = []
        self._pending_offsets = set()
        self._next_offset = 0

    def request_writes(self, offset, data):
        """Request any available writes given new incoming data.

        You call this method by providing new data along with the
        offset associated with the data.  If that new data unlocks
        any contiguous writes that can now be submitted, this
        method will return all applicable writes.

        This is done with 1 method call so you don't have to
        make two method calls (put(), get()) which acquires a lock
        each method call.

        """
        if offset < self._next_offset:
            # This is a request for a write that we've already
            # seen.  This can happen in the event of a retry
            # where if we retry at at offset N/2, we'll requeue
            # offsets 0-N/2 again.
            return []
        writes = []
        if offset in self._pending_offsets:
            # We've already queued this offset so this request is
            # a duplicate.  In this case we should ignore
            # this request and prefer what's already queued.
            return []
        heapq.heappush(self._writes, (offset, data))
        self._pending_offsets.add(offset)
        while self._writes and self._writes[0][0] == self._next_offset:
            next_write = heapq.heappop(self._writes)
            writes.append({'offset': next_write[0], 'data': next_write[1]})
            self._pending_offsets.remove(next_write[0])
            self._next_offset += len(next_write[1])
        return writes
