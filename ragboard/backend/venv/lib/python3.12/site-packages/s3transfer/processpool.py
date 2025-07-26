# Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
"""Speeds up S3 throughput by using processes

Getting Started
===============

The :class:`ProcessPoolDownloader` can be used to download a single file by
calling :meth:`ProcessPoolDownloader.download_file`:

.. code:: python

     from s3transfer.processpool import ProcessPoolDownloader

     with ProcessPoolDownloader() as downloader:
          downloader.download_file('mybucket', 'mykey', 'myfile')


This snippet downloads the S3 object located in the bucket ``mybucket`` at the
key ``mykey`` to the local file ``myfile``. Any errors encountered during the
transfer are not propagated. To determine if a transfer succeeded or
failed, use the `Futures`_ interface.


The :class:`ProcessPoolDownloader` can be used to download multiple files as
well:

.. code:: python

     from s3transfer.processpool import ProcessPoolDownloader

     with ProcessPoolDownloader() as downloader:
          downloader.download_file('mybucket', 'mykey', 'myfile')
          downloader.download_file('mybucket', 'myotherkey', 'myotherfile')


When running this snippet, the downloading of ``mykey`` and ``myotherkey``
happen in parallel. The first ``download_file`` call does not block the
second ``download_file`` call. The snippet blocks when exiting
the context manager and blocks until both downloads are complete.

Alternatively, the ``ProcessPoolDownloader`` can be instantiated
and explicitly be shutdown using :meth:`ProcessPoolDownloader.shutdown`:

.. code:: python

     from s3transfer.processpool import ProcessPoolDownloader

     downloader = ProcessPoolDownloader()
     downloader.download_file('mybucket', 'mykey', 'myfile')
     downloader.download_file('mybucket', 'myotherkey', 'myotherfile')
     downloader.shutdown()


For this code snippet, the call to ``shutdown`` blocks until both
downloads are complete.


Additional Parameters
=====================

Additional parameters can be provided to the ``download_file`` method:

* ``extra_args``: A dictionary containing any additional client arguments
  to include in the
  `GetObject <https://botocore.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html#S3.Client.get_object>`_
  API request. For example:

  .. code:: python

     from s3transfer.processpool import ProcessPoolDownloader

     with ProcessPoolDownloader() as downloader:
          downloader.download_file(
               'mybucket', 'mykey', 'myfile',
               extra_args={'VersionId': 'myversion'})


* ``expected_size``: By default, the downloader will make a HeadObject
  call to determine the size of the object. To opt-out of this additional
  API call, you can provide the size of the object in bytes:

  .. code:: python

     from s3transfer.processpool import ProcessPoolDownloader

     MB = 1024 * 1024
     with ProcessPoolDownloader() as downloader:
          downloader.download_file(
               'mybucket', 'mykey', 'myfile', expected_size=2 * MB)


Futures
=======

When ``download_file`` is called, it immediately returns a
:class:`ProcessPoolTransferFuture`. The future can be used to poll the state
of a particular transfer. To get the result of the download,
call :meth:`ProcessPoolTransferFuture.result`. The method blocks
until the transfer completes, whether it succeeds or fails. For example:

.. code:: python

     from s3transfer.processpool import ProcessPoolDownloader

     with ProcessPoolDownloader() as downloader:
          future = downloader.download_file('mybucket', 'mykey', 'myfile')
          print(future.result())


If the download succeeds, the future returns ``None``:

.. code:: python

     None


If the download fails, the exception causing the failure is raised. For
example, if ``mykey`` did not exist, the following error would be raised


.. code:: python

     botocore.exceptions.ClientError: An error occurred (404) when calling the HeadObject operation: Not Found


.. note::

    :meth:`ProcessPoolTransferFuture.result` can only be called while the
    ``ProcessPoolDownloader`` is running (e.g. before calling ``shutdown`` or
    inside the context manager).


Process Pool Configuration
==========================

By default, the downloader has the following configuration options:

* ``multipart_threshold``: The threshold size for performing ranged downloads
  in bytes. By default, ranged downloads happen for S3 objects that are
  greater than or equal to 8 MB in size.

* ``multipart_chunksize``: The size of each ranged download in bytes. By
  default, the size of each ranged download is 8 MB.

* ``max_request_processes``: The maximum number of processes used to download
  S3 objects. By default, the maximum is 10 processes.


To change the default configuration, use the :class:`ProcessTransferConfig`:

.. code:: python

     from s3transfer.processpool import ProcessPoolDownloader
     from s3transfer.processpool import ProcessTransferConfig

     config = ProcessTransferConfig(
          multipart_threshold=64 * 1024 * 1024,  # 64 MB
          max_request_processes=50
     )
     downloader = ProcessPoolDownloader(config=config)


Client Configuration
====================

The process pool downloader creates ``botocore`` clients on your behalf. In
order to affect how the client is created, pass the keyword arguments
that would have been used in the :meth:`botocore.Session.create_client` call:

.. code:: python


     from s3transfer.processpool import ProcessPoolDownloader
     from s3transfer.processpool import ProcessTransferConfig

     downloader = ProcessPoolDownloader(
          client_kwargs={'region_name': 'us-west-2'})


This snippet ensures that all clients created by the ``ProcessPoolDownloader``
are using ``us-west-2`` as their region.

"""

import collections
import contextlib
import logging
import multiprocessing
import signal
import threading
from copy import deepcopy

import botocore.session
from botocore.config import Config

from s3transfer.compat import MAXINT, BaseManager
from s3transfer.constants import ALLOWED_DOWNLOAD_ARGS, MB, PROCESS_USER_AGENT
from s3transfer.exceptions import CancelledError, RetriesExceededError
from s3transfer.futures import BaseTransferFuture, BaseTransferMeta
from s3transfer.utils import (
    S3_RETRYABLE_DOWNLOAD_ERRORS,
    CallArgs,
    OSUtils,
    calculate_num_parts,
    calculate_range_parameter,
)

logger = logging.getLogger(__name__)

SHUTDOWN_SIGNAL = 'SHUTDOWN'

# The DownloadFileRequest tuple is submitted from the ProcessPoolDownloader
# to the GetObjectSubmitter in order for the submitter to begin submitting
# GetObjectJobs to the GetObjectWorkers.
DownloadFileRequest = collections.namedtuple(
    'DownloadFileRequest',
    [
        'transfer_id',  # The unique id for the transfer
        'bucket',  # The bucket to download the object from
        'key',  # The key to download the object from
        'filename',  # The user-requested download location
        'extra_args',  # Extra arguments to provide to client calls
        'expected_size',  # The user-provided expected size of the download
    ],
)

# The GetObjectJob tuple is submitted from the GetObjectSubmitter
# to the GetObjectWorkers to download the file or parts of the file.
GetObjectJob = collections.namedtuple(
    'GetObjectJob',
    [
        'transfer_id',  # The unique id for the transfer
        'bucket',  # The bucket to download the object from
        'key',  # The key to download the object from
        'temp_filename',  # The temporary file to write the content to via
        # completed GetObject calls.
        'extra_args',  # Extra arguments to provide to the GetObject call
        'offset',  # The offset to write the content for the temp file.
        'filename',  # The user-requested download location. The worker
        # of final GetObjectJob will move the file located at
        # temp_filename to the location of filename.
    ],
)


@contextlib.contextmanager
def ignore_ctrl_c():
    original_handler = _add_ignore_handler_for_interrupts()
    yield
    signal.signal(signal.SIGINT, original_handler)


def _add_ignore_handler_for_interrupts():
    # Windows is unable to pickle signal.signal directly so it needs to
    # be wrapped in a function defined at the module level
    return signal.signal(signal.SIGINT, signal.SIG_IGN)


class ProcessTransferConfig:
    def __init__(
        self,
        multipart_threshold=8 * MB,
        multipart_chunksize=8 * MB,
        max_request_processes=10,
    ):
        """Configuration for the ProcessPoolDownloader

        :param multipart_threshold: The threshold for which ranged downloads
            occur.

        :param multipart_chunksize: The chunk size of each ranged download.

        :param max_request_processes: The maximum number of processes that
            will be making S3 API transfer-related requests at a time.
        """
        self.multipart_threshold = multipart_threshold
        self.multipart_chunksize = multipart_chunksize
        self.max_request_processes = max_request_processes


class ProcessPoolDownloader:
    def __init__(self, client_kwargs=None, config=None):
        """Downloads S3 objects using process pools

        :type client_kwargs: dict
        :param client_kwargs: The keyword arguments to provide when
            instantiating S3 clients. The arguments must match the keyword
            arguments provided to the
            `botocore.session.Session.create_client()` method.

        :type config: ProcessTransferConfig
        :param config: Configuration for the downloader
        """
        if client_kwargs is None:
            client_kwargs = {}
        self._client_factory = ClientFactory(client_kwargs)

        self._transfer_config = config
        if config is None:
            self._transfer_config = ProcessTransferConfig()

        self._download_request_queue = multiprocessing.Queue(1000)
        self._worker_queue = multiprocessing.Queue(1000)
        self._osutil = OSUtils()

        self._started = False
        self._start_lock = threading.Lock()

        # These below are initialized in the start() method
        self._manager = None
        self._transfer_monitor = None
        self._submitter = None
        self._workers = []

    def download_file(
        self, bucket, key, filename, extra_args=None, expected_size=None
    ):
        """Downloads the object's contents to a file

        :type bucket: str
        :param bucket: The name of the bucket to download from

        :type key: str
        :param key: The name of the key to download from

        :type filename: str
        :param filename: The name of a file to download to.

        :type extra_args: dict
        :param extra_args: Extra arguments that may be passed to the
            client operation

        :type expected_size: int
        :param expected_size: The expected size in bytes of the download. If
            provided, the downloader will not call HeadObject to determine the
            object's size and use the provided value instead. The size is
            needed to determine whether to do a multipart download.

        :rtype: s3transfer.futures.TransferFuture
        :returns: Transfer future representing the download
        """
        self._start_if_needed()
        if extra_args is None:
            extra_args = {}
        self._validate_all_known_args(extra_args)
        transfer_id = self._transfer_monitor.notify_new_transfer()
        download_file_request = DownloadFileRequest(
            transfer_id=transfer_id,
            bucket=bucket,
            key=key,
            filename=filename,
            extra_args=extra_args,
            expected_size=expected_size,
        )
        logger.debug(
            'Submitting download file request: %s.', download_file_request
        )
        self._download_request_queue.put(download_file_request)
        call_args = CallArgs(
            bucket=bucket,
            key=key,
            filename=filename,
            extra_args=extra_args,
            expected_size=expected_size,
        )
        future = self._get_transfer_future(transfer_id, call_args)
        return future

    def shutdown(self):
        """Shutdown the downloader

        It will wait till all downloads are complete before returning.
        """
        self._shutdown_if_needed()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, *args):
        if isinstance(exc_value, KeyboardInterrupt):
            if self._transfer_monitor is not None:
                self._transfer_monitor.notify_cancel_all_in_progress()
        self.shutdown()

    def _start_if_needed(self):
        with self._start_lock:
            if not self._started:
                self._start()

    def _start(self):
        self._start_transfer_monitor_manager()
        self._start_submitter()
        self._start_get_object_workers()
        self._started = True

    def _validate_all_known_args(self, provided):
        for kwarg in provided:
            if kwarg not in ALLOWED_DOWNLOAD_ARGS:
                download_args = ', '.join(ALLOWED_DOWNLOAD_ARGS)
                raise ValueError(
                    f"Invalid extra_args key '{kwarg}', "
                    f"must be one of: {download_args}"
                )

    def _get_transfer_future(self, transfer_id, call_args):
        meta = ProcessPoolTransferMeta(
            call_args=call_args, transfer_id=transfer_id
        )
        future = ProcessPoolTransferFuture(
            monitor=self._transfer_monitor, meta=meta
        )
        return future

    def _start_transfer_monitor_manager(self):
        logger.debug('Starting the TransferMonitorManager.')
        self._manager = TransferMonitorManager()
        # We do not want Ctrl-C's to cause the manager to shutdown immediately
        # as worker processes will still need to communicate with it when they
        # are shutting down. So instead we ignore Ctrl-C and let the manager
        # be explicitly shutdown when shutting down the downloader.
        self._manager.start(_add_ignore_handler_for_interrupts)
        self._transfer_monitor = self._manager.TransferMonitor()

    def _start_submitter(self):
        logger.debug('Starting the GetObjectSubmitter.')
        self._submitter = GetObjectSubmitter(
            transfer_config=self._transfer_config,
            client_factory=self._client_factory,
            transfer_monitor=self._transfer_monitor,
            osutil=self._osutil,
            download_request_queue=self._download_request_queue,
            worker_queue=self._worker_queue,
        )
        self._submitter.start()

    def _start_get_object_workers(self):
        logger.debug(
            'Starting %s GetObjectWorkers.',
            self._transfer_config.max_request_processes,
        )
        for _ in range(self._transfer_config.max_request_processes):
            worker = GetObjectWorker(
                queue=self._worker_queue,
                client_factory=self._client_factory,
                transfer_monitor=self._transfer_monitor,
                osutil=self._osutil,
            )
            worker.start()
            self._workers.append(worker)

    def _shutdown_if_needed(self):
        with self._start_lock:
            if self._started:
                self._shutdown()

    def _shutdown(self):
        self._shutdown_submitter()
        self._shutdown_get_object_workers()
        self._shutdown_transfer_monitor_manager()
        self._started = False

    def _shutdown_transfer_monitor_manager(self):
        logger.debug('Shutting down the TransferMonitorManager.')
        self._manager.shutdown()

    def _shutdown_submitter(self):
        logger.debug('Shutting down the GetObjectSubmitter.')
        self._download_request_queue.put(SHUTDOWN_SIGNAL)
        self._submitter.join()

    def _shutdown_get_object_workers(self):
        logger.debug('Shutting down the GetObjectWorkers.')
        for _ in self._workers:
            self._worker_queue.put(SHUTDOWN_SIGNAL)
        for worker in self._workers:
            worker.join()


class ProcessPoolTransferFuture(BaseTransferFuture):
    def __init__(self, monitor, meta):
        """The future associated to a submitted process pool transfer request

        :type monitor: TransferMonitor
        :param monitor: The monitor associated to the process pool downloader

        :type meta: ProcessPoolTransferMeta
        :param meta: The metadata associated to the request. This object
            is visible to the requester.
        """
        self._monitor = monitor
        self._meta = meta

    @property
    def meta(self):
        return self._meta

    def done(self):
        return self._monitor.is_done(self._meta.transfer_id)

    def result(self):
        try:
            return self._monitor.poll_for_result(self._meta.transfer_id)
        except KeyboardInterrupt:
            # For the multiprocessing Manager, a thread is given a single
            # connection to reuse in communicating between the thread in the
            # main process and the Manager's process. If a Ctrl-C happens when
            # polling for the result, it will make the main thread stop trying
            # to receive from the connection, but the Manager process will not
            # know that the main process has stopped trying to receive and
            # will not close the connection. As a result if another message is
            # sent to the Manager process, the listener in the Manager
            # processes will not process the new message as it is still trying
            # trying to process the previous message (that was Ctrl-C'd) and
            # thus cause the thread in the main process to hang on its send.
            # The only way around this is to create a new connection and send
            # messages from that new connection instead.
            self._monitor._connect()
            self.cancel()
            raise

    def cancel(self):
        self._monitor.notify_exception(
            self._meta.transfer_id, CancelledError()
        )


class ProcessPoolTransferMeta(BaseTransferMeta):
    """Holds metadata about the ProcessPoolTransferFuture"""

    def __init__(self, transfer_id, call_args):
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


class ClientFactory:
    def __init__(self, client_kwargs=None):
        """Creates S3 clients for processes

        Botocore sessions and clients are not pickleable so they cannot be
        inherited across Process boundaries. Instead, they must be instantiated
        once a process is running.
        """
        self._client_kwargs = client_kwargs
        if self._client_kwargs is None:
            self._client_kwargs = {}

        client_config = deepcopy(self._client_kwargs.get('config', Config()))
        if not client_config.user_agent_extra:
            client_config.user_agent_extra = PROCESS_USER_AGENT
        else:
            client_config.user_agent_extra += " " + PROCESS_USER_AGENT
        self._client_kwargs['config'] = client_config

    def create_client(self):
        """Create a botocore S3 client"""
        return botocore.session.Session().create_client(
            's3', **self._client_kwargs
        )


class TransferMonitor:
    def __init__(self):
        """Monitors transfers for cross-process communication

        Notifications can be sent to the monitor and information can be
        retrieved from the monitor for a particular transfer. This abstraction
        is ran in a ``multiprocessing.managers.BaseManager`` in order to be
        shared across processes.
        """
        # TODO: Add logic that removes the TransferState if the transfer is
        #  marked as done and the reference to the future is no longer being
        #  held onto. Without this logic, this dictionary will continue to
        #  grow in size with no limit.
        self._transfer_states = {}
        self._id_count = 0
        self._init_lock = threading.Lock()

    def notify_new_transfer(self):
        with self._init_lock:
            transfer_id = self._id_count
            self._transfer_states[transfer_id] = TransferState()
            self._id_count += 1
            return transfer_id

    def is_done(self, transfer_id):
        """Determine a particular transfer is complete

        :param transfer_id: Unique identifier for the transfer
        :return: True, if done. False, otherwise.
        """
        return self._transfer_states[transfer_id].done

    def notify_done(self, transfer_id):
        """Notify a particular transfer is complete

        :param transfer_id: Unique identifier for the transfer
        """
        self._transfer_states[transfer_id].set_done()

    def poll_for_result(self, transfer_id):
        """Poll for the result of a transfer

        :param transfer_id: Unique identifier for the transfer
        :return: If the transfer succeeded, it will return the result. If the
            transfer failed, it will raise the exception associated to the
            failure.
        """
        self._transfer_states[transfer_id].wait_till_done()
        exception = self._transfer_states[transfer_id].exception
        if exception:
            raise exception
        return None

    def notify_exception(self, transfer_id, exception):
        """Notify an exception was encountered for a transfer

        :param transfer_id: Unique identifier for the transfer
        :param exception: The exception encountered for that transfer
        """
        # TODO: Not all exceptions are pickleable so if we are running
        # this in a multiprocessing.BaseManager we will want to
        # make sure to update this signature to ensure pickleability of the
        # arguments or have the ProxyObject do the serialization.
        self._transfer_states[transfer_id].exception = exception

    def notify_cancel_all_in_progress(self):
        for transfer_state in self._transfer_states.values():
            if not transfer_state.done:
                transfer_state.exception = CancelledError()

    def get_exception(self, transfer_id):
        """Retrieve the exception encountered for the transfer

        :param transfer_id: Unique identifier for the transfer
        :return: The exception encountered for that transfer. Otherwise
            if there were no exceptions, returns None.
        """
        return self._transfer_states[transfer_id].exception

    def notify_expected_jobs_to_complete(self, transfer_id, num_jobs):
        """Notify the amount of jobs expected for a transfer

        :param transfer_id: Unique identifier for the transfer
        :param num_jobs: The number of jobs to complete the transfer
        """
        self._transfer_states[transfer_id].jobs_to_complete = num_jobs

    def notify_job_complete(self, transfer_id):
        """Notify that a single job is completed for a transfer

        :param transfer_id: Unique identifier for the transfer
        :return: The number of jobs remaining to complete the transfer
        """
        return self._transfer_states[transfer_id].decrement_jobs_to_complete()


class TransferState:
    """Represents the current state of an individual transfer"""

    # NOTE: Ideally the TransferState object would be used directly by the
    # various different abstractions in the ProcessPoolDownloader and remove
    # the need for the TransferMonitor. However, it would then impose the
    # constraint that two hops are required to make or get any changes in the
    # state of a transfer across processes: one hop to get a proxy object for
    # the TransferState and then a second hop to communicate calling the
    # specific TransferState method.
    def __init__(self):
        self._exception = None
        self._done_event = threading.Event()
        self._job_lock = threading.Lock()
        self._jobs_to_complete = 0

    @property
    def done(self):
        return self._done_event.is_set()

    def set_done(self):
        self._done_event.set()

    def wait_till_done(self):
        self._done_event.wait(MAXINT)

    @property
    def exception(self):
        return self._exception

    @exception.setter
    def exception(self, val):
        self._exception = val

    @property
    def jobs_to_complete(self):
        return self._jobs_to_complete

    @jobs_to_complete.setter
    def jobs_to_complete(self, val):
        self._jobs_to_complete = val

    def decrement_jobs_to_complete(self):
        with self._job_lock:
            self._jobs_to_complete -= 1
            return self._jobs_to_complete


class TransferMonitorManager(BaseManager):
    pass


TransferMonitorManager.register('TransferMonitor', TransferMonitor)


class BaseS3TransferProcess(multiprocessing.Process):
    def __init__(self, client_factory):
        super().__init__()
        self._client_factory = client_factory
        self._client = None

    def run(self):
        # Clients are not pickleable so their instantiation cannot happen
        # in the __init__ for processes that are created under the
        # spawn method.
        self._client = self._client_factory.create_client()
        with ignore_ctrl_c():
            # By default these processes are ran as child processes to the
            # main process. Any Ctrl-c encountered in the main process is
            # propagated to the child process and interrupt it at any time.
            # To avoid any potentially bad states caused from an interrupt
            # (i.e. a transfer failing to notify its done or making the
            # communication protocol become out of sync with the
            # TransferMonitor), we ignore all Ctrl-C's and allow the main
            # process to notify these child processes when to stop processing
            # jobs.
            self._do_run()

    def _do_run(self):
        raise NotImplementedError('_do_run()')


class GetObjectSubmitter(BaseS3TransferProcess):
    def __init__(
        self,
        transfer_config,
        client_factory,
        transfer_monitor,
        osutil,
        download_request_queue,
        worker_queue,
    ):
        """Submit GetObjectJobs to fulfill a download file request

        :param transfer_config: Configuration for transfers.
        :param client_factory: ClientFactory for creating S3 clients.
        :param transfer_monitor: Monitor for notifying and retrieving state
            of transfer.
        :param osutil: OSUtils object to use for os-related behavior when
            performing the transfer.
        :param download_request_queue: Queue to retrieve download file
            requests.
        :param worker_queue: Queue to submit GetObjectJobs for workers
            to perform.
        """
        super().__init__(client_factory)
        self._transfer_config = transfer_config
        self._transfer_monitor = transfer_monitor
        self._osutil = osutil
        self._download_request_queue = download_request_queue
        self._worker_queue = worker_queue

    def _do_run(self):
        while True:
            download_file_request = self._download_request_queue.get()
            if download_file_request == SHUTDOWN_SIGNAL:
                logger.debug('Submitter shutdown signal received.')
                return
            try:
                self._submit_get_object_jobs(download_file_request)
            except Exception as e:
                logger.debug(
                    'Exception caught when submitting jobs for '
                    'download file request %s: %s',
                    download_file_request,
                    e,
                    exc_info=True,
                )
                self._transfer_monitor.notify_exception(
                    download_file_request.transfer_id, e
                )
                self._transfer_monitor.notify_done(
                    download_file_request.transfer_id
                )

    def _submit_get_object_jobs(self, download_file_request):
        size = self._get_size(download_file_request)
        temp_filename = self._allocate_temp_file(download_file_request, size)
        if size < self._transfer_config.multipart_threshold:
            self._submit_single_get_object_job(
                download_file_request, temp_filename
            )
        else:
            self._submit_ranged_get_object_jobs(
                download_file_request, temp_filename, size
            )

    def _get_size(self, download_file_request):
        expected_size = download_file_request.expected_size
        if expected_size is None:
            expected_size = self._client.head_object(
                Bucket=download_file_request.bucket,
                Key=download_file_request.key,
                **download_file_request.extra_args,
            )['ContentLength']
        return expected_size

    def _allocate_temp_file(self, download_file_request, size):
        temp_filename = self._osutil.get_temp_filename(
            download_file_request.filename
        )
        self._osutil.allocate(temp_filename, size)
        return temp_filename

    def _submit_single_get_object_job(
        self, download_file_request, temp_filename
    ):
        self._notify_jobs_to_complete(download_file_request.transfer_id, 1)
        self._submit_get_object_job(
            transfer_id=download_file_request.transfer_id,
            bucket=download_file_request.bucket,
            key=download_file_request.key,
            temp_filename=temp_filename,
            offset=0,
            extra_args=download_file_request.extra_args,
            filename=download_file_request.filename,
        )

    def _submit_ranged_get_object_jobs(
        self, download_file_request, temp_filename, size
    ):
        part_size = self._transfer_config.multipart_chunksize
        num_parts = calculate_num_parts(size, part_size)
        self._notify_jobs_to_complete(
            download_file_request.transfer_id, num_parts
        )
        for i in range(num_parts):
            offset = i * part_size
            range_parameter = calculate_range_parameter(
                part_size, i, num_parts
            )
            get_object_kwargs = {'Range': range_parameter}
            get_object_kwargs.update(download_file_request.extra_args)
            self._submit_get_object_job(
                transfer_id=download_file_request.transfer_id,
                bucket=download_file_request.bucket,
                key=download_file_request.key,
                temp_filename=temp_filename,
                offset=offset,
                extra_args=get_object_kwargs,
                filename=download_file_request.filename,
            )

    def _submit_get_object_job(self, **get_object_job_kwargs):
        self._worker_queue.put(GetObjectJob(**get_object_job_kwargs))

    def _notify_jobs_to_complete(self, transfer_id, jobs_to_complete):
        logger.debug(
            'Notifying %s job(s) to complete for transfer_id %s.',
            jobs_to_complete,
            transfer_id,
        )
        self._transfer_monitor.notify_expected_jobs_to_complete(
            transfer_id, jobs_to_complete
        )


class GetObjectWorker(BaseS3TransferProcess):
    # TODO: It may make sense to expose these class variables as configuration
    # options if users want to tweak them.
    _MAX_ATTEMPTS = 5
    _IO_CHUNKSIZE = 2 * MB

    def __init__(self, queue, client_factory, transfer_monitor, osutil):
        """Fulfills GetObjectJobs

        Downloads the S3 object, writes it to the specified file, and
        renames the file to its final location if it completes the final
        job for a particular transfer.

        :param queue: Queue for retrieving GetObjectJob's
        :param client_factory: ClientFactory for creating S3 clients
        :param transfer_monitor: Monitor for notifying
        :param osutil: OSUtils object to use for os-related behavior when
            performing the transfer.
        """
        super().__init__(client_factory)
        self._queue = queue
        self._client_factory = client_factory
        self._transfer_monitor = transfer_monitor
        self._osutil = osutil

    def _do_run(self):
        while True:
            job = self._queue.get()
            if job == SHUTDOWN_SIGNAL:
                logger.debug('Worker shutdown signal received.')
                return
            if not self._transfer_monitor.get_exception(job.transfer_id):
                self._run_get_object_job(job)
            else:
                logger.debug(
                    'Skipping get object job %s because there was a previous '
                    'exception.',
                    job,
                )
            remaining = self._transfer_monitor.notify_job_complete(
                job.transfer_id
            )
            logger.debug(
                '%s jobs remaining for transfer_id %s.',
                remaining,
                job.transfer_id,
            )
            if not remaining:
                self._finalize_download(
                    job.transfer_id, job.temp_filename, job.filename
                )

    def _run_get_object_job(self, job):
        try:
            self._do_get_object(
                bucket=job.bucket,
                key=job.key,
                temp_filename=job.temp_filename,
                extra_args=job.extra_args,
                offset=job.offset,
            )
        except Exception as e:
            logger.debug(
                'Exception caught when downloading object for '
                'get object job %s: %s',
                job,
                e,
                exc_info=True,
            )
            self._transfer_monitor.notify_exception(job.transfer_id, e)

    def _do_get_object(self, bucket, key, extra_args, temp_filename, offset):
        last_exception = None
        for i in range(self._MAX_ATTEMPTS):
            try:
                response = self._client.get_object(
                    Bucket=bucket, Key=key, **extra_args
                )
                self._write_to_file(temp_filename, offset, response['Body'])
                return
            except S3_RETRYABLE_DOWNLOAD_ERRORS as e:
                logger.debug(
                    'Retrying exception caught (%s), '
                    'retrying request, (attempt %s / %s)',
                    e,
                    i + 1,
                    self._MAX_ATTEMPTS,
                    exc_info=True,
                )
                last_exception = e
        raise RetriesExceededError(last_exception)

    def _write_to_file(self, filename, offset, body):
        with open(filename, 'rb+') as f:
            f.seek(offset)
            chunks = iter(lambda: body.read(self._IO_CHUNKSIZE), b'')
            for chunk in chunks:
                f.write(chunk)

    def _finalize_download(self, transfer_id, temp_filename, filename):
        if self._transfer_monitor.get_exception(transfer_id):
            self._osutil.remove_file(temp_filename)
        else:
            self._do_file_rename(transfer_id, temp_filename, filename)
        self._transfer_monitor.notify_done(transfer_id)

    def _do_file_rename(self, transfer_id, temp_filename, filename):
        try:
            self._osutil.rename_file(temp_filename, filename)
        except Exception as e:
            self._transfer_monitor.notify_exception(transfer_id, e)
            self._osutil.remove_file(temp_filename)
