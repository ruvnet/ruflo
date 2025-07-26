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
import functools
import logging
import math
import os
import random
import socket
import stat
import string
import threading
from collections import defaultdict

from botocore.exceptions import (
    IncompleteReadError,
    ReadTimeoutError,
    ResponseStreamingError,
)
from botocore.httpchecksum import AwsChunkedWrapper
from botocore.utils import is_s3express_bucket

from s3transfer.compat import SOCKET_ERROR, fallocate, rename_file

MAX_PARTS = 10000
# The maximum file size you can upload via S3 per request.
# See: http://docs.aws.amazon.com/AmazonS3/latest/dev/UploadingObjects.html
# and: http://docs.aws.amazon.com/AmazonS3/latest/dev/qfacts.html
MAX_SINGLE_UPLOAD_SIZE = 5 * (1024**3)
MIN_UPLOAD_CHUNKSIZE = 5 * (1024**2)
logger = logging.getLogger(__name__)


S3_RETRYABLE_DOWNLOAD_ERRORS = (
    socket.timeout,
    SOCKET_ERROR,
    ReadTimeoutError,
    IncompleteReadError,
    ResponseStreamingError,
)


def random_file_extension(num_digits=8):
    return ''.join(random.choice(string.hexdigits) for _ in range(num_digits))


def signal_not_transferring(request, operation_name, **kwargs):
    if operation_name in ['PutObject', 'UploadPart'] and hasattr(
        request.body, 'signal_not_transferring'
    ):
        request.body.signal_not_transferring()


def signal_transferring(request, operation_name, **kwargs):
    if operation_name in ['PutObject', 'UploadPart']:
        body = request.body
        if isinstance(body, AwsChunkedWrapper):
            body = getattr(body, '_raw', None)
        if hasattr(body, 'signal_transferring'):
            body.signal_transferring()


def calculate_num_parts(size, part_size):
    return int(math.ceil(size / float(part_size)))


def calculate_range_parameter(
    part_size, part_index, num_parts, total_size=None
):
    """Calculate the range parameter for multipart downloads/copies

    :type part_size: int
    :param part_size: The size of the part

    :type part_index: int
    :param part_index: The index for which this parts starts. This index starts
        at zero

    :type num_parts: int
    :param num_parts: The total number of parts in the transfer

    :returns: The value to use for Range parameter on downloads or
        the CopySourceRange parameter for copies
    """
    # Used to calculate the Range parameter
    start_range = part_index * part_size
    if part_index == num_parts - 1:
        end_range = ''
        if total_size is not None:
            end_range = str(total_size - 1)
    else:
        end_range = start_range + part_size - 1
    range_param = f'bytes={start_range}-{end_range}'
    return range_param


def get_callbacks(transfer_future, callback_type):
    """Retrieves callbacks from a subscriber

    :type transfer_future: s3transfer.futures.TransferFuture
    :param transfer_future: The transfer future the subscriber is associated
        to.

    :type callback_type: str
    :param callback_type: The type of callback to retrieve from the subscriber.
        Valid types include:
            * 'queued'
            * 'progress'
            * 'done'

    :returns: A list of callbacks for the type specified. All callbacks are
        preinjected with the transfer future.
    """
    callbacks = []
    for subscriber in transfer_future.meta.call_args.subscribers:
        callback_name = 'on_' + callback_type
        if hasattr(subscriber, callback_name):
            callbacks.append(
                functools.partial(
                    getattr(subscriber, callback_name), future=transfer_future
                )
            )
    return callbacks


def invoke_progress_callbacks(callbacks, bytes_transferred):
    """Calls all progress callbacks

    :param callbacks: A list of progress callbacks to invoke
    :param bytes_transferred: The number of bytes transferred. This is passed
        to the callbacks. If no bytes were transferred the callbacks will not
        be invoked because no progress was achieved. It is also possible
        to receive a negative amount which comes from retrying a transfer
        request.
    """
    # Only invoke the callbacks if bytes were actually transferred.
    if bytes_transferred:
        for callback in callbacks:
            callback(bytes_transferred=bytes_transferred)


def get_filtered_dict(original_dict, whitelisted_keys):
    """Gets a dictionary filtered by whitelisted keys

    :param original_dict: The original dictionary of arguments to source keys
        and values.
    :param whitelisted_key: A list of keys to include in the filtered
        dictionary.

    :returns: A dictionary containing key/values from the original dictionary
        whose key was included in the whitelist
    """
    filtered_dict = {}
    for key, value in original_dict.items():
        if key in whitelisted_keys:
            filtered_dict[key] = value
    return filtered_dict


class CallArgs:
    def __init__(self, **kwargs):
        """A class that records call arguments

        The call arguments must be passed as keyword arguments. It will set
        each keyword argument as an attribute of the object along with its
        associated value.
        """
        for arg, value in kwargs.items():
            setattr(self, arg, value)


class FunctionContainer:
    """An object that contains a function and any args or kwargs to call it

    When called the provided function will be called with provided args
    and kwargs.
    """

    def __init__(self, func, *args, **kwargs):
        self._func = func
        self._args = args
        self._kwargs = kwargs

    def __repr__(self):
        return f'Function: {self._func} with args {self._args} and kwargs {self._kwargs}'

    def __call__(self):
        return self._func(*self._args, **self._kwargs)


class CountCallbackInvoker:
    """An abstraction to invoke a callback when a shared count reaches zero

    :param callback: Callback invoke when finalized count reaches zero
    """

    def __init__(self, callback):
        self._lock = threading.Lock()
        self._callback = callback
        self._count = 0
        self._is_finalized = False

    @property
    def current_count(self):
        with self._lock:
            return self._count

    def increment(self):
        """Increment the count by one"""
        with self._lock:
            if self._is_finalized:
                raise RuntimeError(
                    'Counter has been finalized it can no longer be '
                    'incremented.'
                )
            self._count += 1

    def decrement(self):
        """Decrement the count by one"""
        with self._lock:
            if self._count == 0:
                raise RuntimeError(
                    'Counter is at zero. It cannot dip below zero'
                )
            self._count -= 1
            if self._is_finalized and self._count == 0:
                self._callback()

    def finalize(self):
        """Finalize the counter

        Once finalized, the counter never be incremented and the callback
        can be invoked once the count reaches zero
        """
        with self._lock:
            self._is_finalized = True
            if self._count == 0:
                self._callback()


class OSUtils:
    _MAX_FILENAME_LEN = 255

    def get_file_size(self, filename):
        return os.path.getsize(filename)

    def open_file_chunk_reader(self, filename, start_byte, size, callbacks):
        return ReadFileChunk.from_filename(
            filename, start_byte, size, callbacks, enable_callbacks=False
        )

    def open_file_chunk_reader_from_fileobj(
        self,
        fileobj,
        chunk_size,
        full_file_size,
        callbacks,
        close_callbacks=None,
    ):
        return ReadFileChunk(
            fileobj,
            chunk_size,
            full_file_size,
            callbacks=callbacks,
            enable_callbacks=False,
            close_callbacks=close_callbacks,
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
        rename_file(current_filename, new_filename)

    def is_special_file(cls, filename):
        """Checks to see if a file is a special UNIX file.

        It checks if the file is a character special device, block special
        device, FIFO, or socket.

        :param filename: Name of the file

        :returns: True if the file is a special file. False, if is not.
        """
        # If it does not exist, it must be a new file so it cannot be
        # a special file.
        if not os.path.exists(filename):
            return False
        mode = os.stat(filename).st_mode
        # Character special device.
        if stat.S_ISCHR(mode):
            return True
        # Block special device
        if stat.S_ISBLK(mode):
            return True
        # Named pipe / FIFO
        if stat.S_ISFIFO(mode):
            return True
        # Socket.
        if stat.S_ISSOCK(mode):
            return True
        return False

    def get_temp_filename(self, filename):
        suffix = os.extsep + random_file_extension()
        path = os.path.dirname(filename)
        name = os.path.basename(filename)
        temp_filename = name[: self._MAX_FILENAME_LEN - len(suffix)] + suffix
        return os.path.join(path, temp_filename)

    def allocate(self, filename, size):
        try:
            with self.open(filename, 'wb') as f:
                fallocate(f, size)
        except OSError:
            self.remove_file(filename)
            raise


class DeferredOpenFile:
    def __init__(self, filename, start_byte=0, mode='rb', open_function=open):
        """A class that defers the opening of a file till needed

        This is useful for deferring opening of a file till it is needed
        in a separate thread, as there is a limit of how many open files
        there can be in a single thread for most operating systems. The
        file gets opened in the following methods: ``read()``, ``seek()``,
        and ``__enter__()``

        :type filename: str
        :param filename: The name of the file to open

        :type start_byte: int
        :param start_byte: The byte to seek to when the file is opened.

        :type mode: str
        :param mode: The mode to use to open the file

        :type open_function: function
        :param open_function: The function to use to open the file
        """
        self._filename = filename
        self._fileobj = None
        self._start_byte = start_byte
        self._mode = mode
        self._open_function = open_function

    def _open_if_needed(self):
        if self._fileobj is None:
            self._fileobj = self._open_function(self._filename, self._mode)
            if self._start_byte != 0:
                self._fileobj.seek(self._start_byte)

    @property
    def name(self):
        return self._filename

    def read(self, amount=None):
        self._open_if_needed()
        return self._fileobj.read(amount)

    def write(self, data):
        self._open_if_needed()
        self._fileobj.write(data)

    def seek(self, where, whence=0):
        self._open_if_needed()
        self._fileobj.seek(where, whence)

    def tell(self):
        if self._fileobj is None:
            return self._start_byte
        return self._fileobj.tell()

    def close(self):
        if self._fileobj:
            self._fileobj.close()

    def __enter__(self):
        self._open_if_needed()
        return self

    def __exit__(self, *args, **kwargs):
        self.close()


class ReadFileChunk:
    def __init__(
        self,
        fileobj,
        chunk_size,
        full_file_size,
        callbacks=None,
        enable_callbacks=True,
        close_callbacks=None,
    ):
        """

        Given a file object shown below::

            |___________________________________________________|
            0          |                 |                 full_file_size
                       |----chunk_size---|
                    f.tell()

        :type fileobj: file
        :param fileobj: File like object

        :type chunk_size: int
        :param chunk_size: The max chunk size to read.  Trying to read
            pass the end of the chunk size will behave like you've
            reached the end of the file.

        :type full_file_size: int
        :param full_file_size: The entire content length associated
            with ``fileobj``.

        :type callbacks: A list of function(amount_read)
        :param callbacks: Called whenever data is read from this object in the
            order provided.

        :type enable_callbacks: boolean
        :param enable_callbacks: True if to run callbacks. Otherwise, do not
            run callbacks

        :type close_callbacks: A list of function()
        :param close_callbacks: Called when close is called. The function
            should take no arguments.
        """
        self._fileobj = fileobj
        self._start_byte = self._fileobj.tell()
        self._size = self._calculate_file_size(
            self._fileobj,
            requested_size=chunk_size,
            start_byte=self._start_byte,
            actual_file_size=full_file_size,
        )
        # _amount_read represents the position in the chunk and may exceed
        # the chunk size, but won't allow reads out of bounds.
        self._amount_read = 0
        self._callbacks = callbacks
        if callbacks is None:
            self._callbacks = []
        self._callbacks_enabled = enable_callbacks
        self._close_callbacks = close_callbacks
        if close_callbacks is None:
            self._close_callbacks = close_callbacks

    @classmethod
    def from_filename(
        cls,
        filename,
        start_byte,
        chunk_size,
        callbacks=None,
        enable_callbacks=True,
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

        :type callbacks: function(amount_read)
        :param callbacks: Called whenever data is read from this object.

        :type enable_callbacks: bool
        :param enable_callbacks: Indicate whether to invoke callback
            during read() calls.

        :rtype: ``ReadFileChunk``
        :return: A new instance of ``ReadFileChunk``

        """
        f = open(filename, 'rb')
        f.seek(start_byte)
        file_size = os.fstat(f.fileno()).st_size
        return cls(f, chunk_size, file_size, callbacks, enable_callbacks)

    def _calculate_file_size(
        self, fileobj, requested_size, start_byte, actual_file_size
    ):
        max_chunk_size = actual_file_size - start_byte
        return min(max_chunk_size, requested_size)

    def read(self, amount=None):
        amount_left = max(self._size - self._amount_read, 0)
        if amount is None:
            amount_to_read = amount_left
        else:
            amount_to_read = min(amount_left, amount)
        data = self._fileobj.read(amount_to_read)
        self._amount_read += len(data)
        if self._callbacks is not None and self._callbacks_enabled:
            invoke_progress_callbacks(self._callbacks, len(data))
        return data

    def signal_transferring(self):
        self.enable_callback()
        if hasattr(self._fileobj, 'signal_transferring'):
            self._fileobj.signal_transferring()

    def signal_not_transferring(self):
        self.disable_callback()
        if hasattr(self._fileobj, 'signal_not_transferring'):
            self._fileobj.signal_not_transferring()

    def enable_callback(self):
        self._callbacks_enabled = True

    def disable_callback(self):
        self._callbacks_enabled = False

    def seek(self, where, whence=0):
        if whence not in (0, 1, 2):
            # Mimic io's error for invalid whence values
            raise ValueError(f"invalid whence ({whence}, should be 0, 1 or 2)")

        # Recalculate where based on chunk attributes so seek from file
        # start (whence=0) is always used
        where += self._start_byte
        if whence == 1:
            where += self._amount_read
        elif whence == 2:
            where += self._size

        self._fileobj.seek(max(where, self._start_byte))
        if self._callbacks is not None and self._callbacks_enabled:
            # To also rewind the callback() for an accurate progress report
            bounded_where = max(min(where - self._start_byte, self._size), 0)
            bounded_amount_read = min(self._amount_read, self._size)
            amount = bounded_where - bounded_amount_read
            invoke_progress_callbacks(
                self._callbacks, bytes_transferred=amount
            )
        self._amount_read = max(where - self._start_byte, 0)

    def close(self):
        if self._close_callbacks is not None and self._callbacks_enabled:
            for callback in self._close_callbacks:
                callback()
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

    def __init__(self, stream, callbacks=None):
        self._stream = stream
        self._callbacks = callbacks
        if callbacks is None:
            self._callbacks = []

    def read(self, *args, **kwargs):
        value = self._stream.read(*args, **kwargs)
        invoke_progress_callbacks(self._callbacks, len(value))
        return value


class NoResourcesAvailable(Exception):
    pass


class TaskSemaphore:
    def __init__(self, count):
        """A semaphore for the purpose of limiting the number of tasks

        :param count: The size of semaphore
        """
        self._semaphore = threading.Semaphore(count)

    def acquire(self, tag, blocking=True):
        """Acquire the semaphore

        :param tag: A tag identifying what is acquiring the semaphore. Note
            that this is not really needed to directly use this class but is
            needed for API compatibility with the SlidingWindowSemaphore
            implementation.
        :param block: If True, block until it can be acquired. If False,
            do not block and raise an exception if cannot be acquired.

        :returns: A token (can be None) to use when releasing the semaphore
        """
        logger.debug("Acquiring %s", tag)
        if not self._semaphore.acquire(blocking):
            raise NoResourcesAvailable(f"Cannot acquire tag '{tag}'")

    def release(self, tag, acquire_token):
        """Release the semaphore

        :param tag: A tag identifying what is releasing the semaphore
        :param acquire_token:  The token returned from when the semaphore was
            acquired. Note that this is not really needed to directly use this
            class but is needed for API compatibility with the
            SlidingWindowSemaphore implementation.
        """
        logger.debug(f"Releasing acquire {tag}/{acquire_token}")
        self._semaphore.release()


class SlidingWindowSemaphore(TaskSemaphore):
    """A semaphore used to coordinate sequential resource access.

    This class is similar to the stdlib BoundedSemaphore:

    * It's initialized with a count.
    * Each call to ``acquire()`` decrements the counter.
    * If the count is at zero, then ``acquire()`` will either block until the
      count increases, or if ``blocking=False``, then it will raise
      a NoResourcesAvailable exception indicating that it failed to acquire the
      semaphore.

    The main difference is that this semaphore is used to limit
    access to a resource that requires sequential access.  For example,
    if I want to access resource R that has 20 subresources R_0 - R_19,
    this semaphore can also enforce that you only have a max range of
    10 at any given point in time.  You must also specify a tag name
    when you acquire the semaphore.  The sliding window semantics apply
    on a per tag basis.  The internal count will only be incremented
    when the minimum sequence number for a tag is released.

    """

    def __init__(self, count):
        self._count = count
        # Dict[tag, next_sequence_number].
        self._tag_sequences = defaultdict(int)
        self._lowest_sequence = {}
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        # Dict[tag, List[sequence_number]]
        self._pending_release = {}

    def current_count(self):
        with self._lock:
            return self._count

    def acquire(self, tag, blocking=True):
        logger.debug("Acquiring %s", tag)
        self._condition.acquire()
        try:
            if self._count == 0:
                if not blocking:
                    raise NoResourcesAvailable(f"Cannot acquire tag '{tag}'")
                else:
                    while self._count == 0:
                        self._condition.wait()
            # self._count is no longer zero.
            # First, check if this is the first time we're seeing this tag.
            sequence_number = self._tag_sequences[tag]
            if sequence_number == 0:
                # First time seeing the tag, so record we're at 0.
                self._lowest_sequence[tag] = sequence_number
            self._tag_sequences[tag] += 1
            self._count -= 1
            return sequence_number
        finally:
            self._condition.release()

    def release(self, tag, acquire_token):
        sequence_number = acquire_token
        logger.debug("Releasing acquire %s/%s", tag, sequence_number)
        self._condition.acquire()
        try:
            if tag not in self._tag_sequences:
                raise ValueError(f"Attempted to release unknown tag: {tag}")
            max_sequence = self._tag_sequences[tag]
            if self._lowest_sequence[tag] == sequence_number:
                # We can immediately process this request and free up
                # resources.
                self._lowest_sequence[tag] += 1
                self._count += 1
                self._condition.notify()
                queued = self._pending_release.get(tag, [])
                while queued:
                    if self._lowest_sequence[tag] == queued[-1]:
                        queued.pop()
                        self._lowest_sequence[tag] += 1
                        self._count += 1
                    else:
                        break
            elif self._lowest_sequence[tag] < sequence_number < max_sequence:
                # We can't do anything right now because we're still waiting
                # for the min sequence for the tag to be released.  We have
                # to queue this for pending release.
                self._pending_release.setdefault(tag, []).append(
                    sequence_number
                )
                self._pending_release[tag].sort(reverse=True)
            else:
                raise ValueError(
                    "Attempted to release unknown sequence number "
                    f"{sequence_number} for tag: {tag}"
                )
        finally:
            self._condition.release()


class ChunksizeAdjuster:
    def __init__(
        self,
        max_size=MAX_SINGLE_UPLOAD_SIZE,
        min_size=MIN_UPLOAD_CHUNKSIZE,
        max_parts=MAX_PARTS,
    ):
        self.max_size = max_size
        self.min_size = min_size
        self.max_parts = max_parts

    def adjust_chunksize(self, current_chunksize, file_size=None):
        """Get a chunksize close to current that fits within all S3 limits.

        :type current_chunksize: int
        :param current_chunksize: The currently configured chunksize.

        :type file_size: int or None
        :param file_size: The size of the file to upload. This might be None
            if the object being transferred has an unknown size.

        :returns: A valid chunksize that fits within configured limits.
        """
        chunksize = current_chunksize
        if file_size is not None:
            chunksize = self._adjust_for_max_parts(chunksize, file_size)
        return self._adjust_for_chunksize_limits(chunksize)

    def _adjust_for_chunksize_limits(self, current_chunksize):
        if current_chunksize > self.max_size:
            logger.debug(
                "Chunksize greater than maximum chunksize. "
                f"Setting to {self.max_size} from {current_chunksize}."
            )
            return self.max_size
        elif current_chunksize < self.min_size:
            logger.debug(
                "Chunksize less than minimum chunksize. "
                f"Setting to {self.min_size} from {current_chunksize}."
            )
            return self.min_size
        else:
            return current_chunksize

    def _adjust_for_max_parts(self, current_chunksize, file_size):
        chunksize = current_chunksize
        num_parts = int(math.ceil(file_size / float(chunksize)))

        while num_parts > self.max_parts:
            chunksize *= 2
            num_parts = int(math.ceil(file_size / float(chunksize)))

        if chunksize != current_chunksize:
            logger.debug(
                "Chunksize would result in the number of parts exceeding the "
                f"maximum. Setting to {chunksize} from {current_chunksize}."
            )

        return chunksize


def add_s3express_defaults(bucket, extra_args):
    if is_s3express_bucket(bucket) and "ChecksumAlgorithm" not in extra_args:
        # Default Transfer Operations to S3Express to use CRC32
        extra_args["ChecksumAlgorithm"] = "crc32"
