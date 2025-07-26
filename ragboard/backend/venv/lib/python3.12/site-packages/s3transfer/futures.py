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
import copy
import logging
import sys
import threading
from collections import namedtuple
from concurrent import futures

from s3transfer.compat import MAXINT
from s3transfer.exceptions import CancelledError, TransferNotDoneError
from s3transfer.utils import FunctionContainer, TaskSemaphore

logger = logging.getLogger(__name__)


class BaseTransferFuture:
    @property
    def meta(self):
        """The metadata associated to the TransferFuture"""
        raise NotImplementedError('meta')

    def done(self):
        """Determines if a TransferFuture has completed

        :returns: True if completed. False, otherwise.
        """
        raise NotImplementedError('done()')

    def result(self):
        """Waits until TransferFuture is done and returns the result

        If the TransferFuture succeeded, it will return the result. If the
        TransferFuture failed, it will raise the exception associated to the
        failure.
        """
        raise NotImplementedError('result()')

    def cancel(self):
        """Cancels the request associated with the TransferFuture"""
        raise NotImplementedError('cancel()')


class BaseTransferMeta:
    @property
    def call_args(self):
        """The call args used in the transfer request"""
        raise NotImplementedError('call_args')

    @property
    def transfer_id(self):
        """The unique id of the transfer"""
        raise NotImplementedError('transfer_id')

    @property
    def user_context(self):
        """A dictionary that requesters can store data in"""
        raise NotImplementedError('user_context')


class TransferFuture(BaseTransferFuture):
    def __init__(self, meta=None, coordinator=None):
        """The future associated to a submitted transfer request

        :type meta: TransferMeta
        :param meta: The metadata associated to the request. This object
            is visible to the requester.

        :type coordinator: TransferCoordinator
        :param coordinator: The coordinator associated to the request. This
            object is not visible to the requester.
        """
        self._meta = meta
        if meta is None:
            self._meta = TransferMeta()

        self._coordinator = coordinator
        if coordinator is None:
            self._coordinator = TransferCoordinator()

    @property
    def meta(self):
        return self._meta

    def done(self):
        return self._coordinator.done()

    def result(self):
        try:
            # Usually the result() method blocks until the transfer is done,
            # however if a KeyboardInterrupt is raised we want want to exit
            # out of this and propagate the exception.
            return self._coordinator.result()
        except KeyboardInterrupt as e:
            self.cancel()
            raise e

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


class TransferMeta(BaseTransferMeta):
    """Holds metadata about the TransferFuture"""

    def __init__(self, call_args=None, transfer_id=None):
        self._call_args = call_args
        self._transfer_id = transfer_id
        self._size = None
        self._user_context = {}

    @property
    def call_args(self):
        """The call args used in the transfer request"""
        return self._call_args

    @property
    def transfer_id(self):
        """The unique id of the transfer"""
        return self._transfer_id

    @property
    def size(self):
        """The size of the transfer request if known"""
        return self._size

    @property
    def user_context(self):
        """A dictionary that requesters can store data in"""
        return self._user_context

    def provide_transfer_size(self, size):
        """A method to provide the size of a transfer request

        By providing this value, the TransferManager will not try to
        call HeadObject or use the use OS to determine the size of the
        transfer.
        """
        self._size = size


class TransferCoordinator:
    """A helper class for managing TransferFuture"""

    def __init__(self, transfer_id=None):
        self.transfer_id = transfer_id
        self._status = 'not-started'
        self._result = None
        self._exception = None
        self._associated_futures = set()
        self._failure_cleanups = []
        self._done_callbacks = []
        self._done_event = threading.Event()
        self._lock = threading.Lock()
        self._associated_futures_lock = threading.Lock()
        self._done_callbacks_lock = threading.Lock()
        self._failure_cleanups_lock = threading.Lock()

    def __repr__(self):
        return f'{self.__class__.__name__}(transfer_id={self.transfer_id})'

    @property
    def exception(self):
        return self._exception

    @property
    def associated_futures(self):
        """The list of futures associated to the inprogress TransferFuture

        Once the transfer finishes this list becomes empty as the transfer
        is considered done and there should be no running futures left.
        """
        with self._associated_futures_lock:
            # We return a copy of the list because we do not want to
            # processing the returned list while another thread is adding
            # more futures to the actual list.
            return copy.copy(self._associated_futures)

    @property
    def failure_cleanups(self):
        """The list of callbacks to call when the TransferFuture fails"""
        return self._failure_cleanups

    @property
    def status(self):
        """The status of the TransferFuture

        The currently supported states are:
            * not-started - Has yet to start. If in this state, a transfer
              can be canceled immediately and nothing will happen.
            * queued - SubmissionTask is about to submit tasks
            * running - Is inprogress. In-progress as of now means that
              the SubmissionTask that runs the transfer is being executed. So
              there is no guarantee any transfer requests had been made to
              S3 if this state is reached.
            * cancelled - Was cancelled
            * failed - An exception other than CancelledError was thrown
            * success - No exceptions were thrown and is done.
        """
        return self._status

    def set_result(self, result):
        """Set a result for the TransferFuture

        Implies that the TransferFuture succeeded. This will always set a
        result because it is invoked on the final task where there is only
        ever one final task and it is ran at the very end of a transfer
        process. So if a result is being set for this final task, the transfer
        succeeded even if something came a long and canceled the transfer
        on the final task.
        """
        with self._lock:
            self._exception = None
            self._result = result
            self._status = 'success'

    def set_exception(self, exception, override=False):
        """Set an exception for the TransferFuture

        Implies the TransferFuture failed.

        :param exception: The exception that cause the transfer to fail.
        :param override: If True, override any existing state.
        """
        with self._lock:
            if not self.done() or override:
                self._exception = exception
                self._status = 'failed'

    def result(self):
        """Waits until TransferFuture is done and returns the result

        If the TransferFuture succeeded, it will return the result. If the
        TransferFuture failed, it will raise the exception associated to the
        failure.
        """
        # Doing a wait() with no timeout cannot be interrupted in python2 but
        # can be interrupted in python3 so we just wait with the largest
        # possible value integer value, which is on the scale of billions of
        # years...
        self._done_event.wait(MAXINT)

        # Once done waiting, raise an exception if present or return the
        # final result.
        if self._exception:
            raise self._exception
        return self._result

    def cancel(self, msg='', exc_type=CancelledError):
        """Cancels the TransferFuture

        :param msg: The message to attach to the cancellation
        :param exc_type: The type of exception to set for the cancellation
        """
        with self._lock:
            if not self.done():
                should_announce_done = False
                logger.debug('%s cancel(%s) called', self, msg)
                self._exception = exc_type(msg)
                if self._status == 'not-started':
                    should_announce_done = True
                self._status = 'cancelled'
                if should_announce_done:
                    self.announce_done()

    def set_status_to_queued(self):
        """Sets the TransferFutrue's status to running"""
        self._transition_to_non_done_state('queued')

    def set_status_to_running(self):
        """Sets the TransferFuture's status to running"""
        self._transition_to_non_done_state('running')

    def _transition_to_non_done_state(self, desired_state):
        with self._lock:
            if self.done():
                raise RuntimeError(
                    f'Unable to transition from done state {self.status} to non-done '
                    f'state {desired_state}.'
                )
            self._status = desired_state

    def submit(self, executor, task, tag=None):
        """Submits a task to a provided executor

        :type executor: s3transfer.futures.BoundedExecutor
        :param executor: The executor to submit the callable to

        :type task: s3transfer.tasks.Task
        :param task: The task to submit to the executor

        :type tag: s3transfer.futures.TaskTag
        :param tag: A tag to associate to the submitted task

        :rtype: concurrent.futures.Future
        :returns: A future representing the submitted task
        """
        logger.debug(
            f"Submitting task {task} to executor {executor} for transfer request: {self.transfer_id}."
        )
        future = executor.submit(task, tag=tag)
        # Add this created future to the list of associated future just
        # in case it is needed during cleanups.
        self.add_associated_future(future)
        future.add_done_callback(
            FunctionContainer(self.remove_associated_future, future)
        )
        return future

    def done(self):
        """Determines if a TransferFuture has completed

        :returns: False if status is equal to 'failed', 'cancelled', or
            'success'. True, otherwise
        """
        return self.status in ['failed', 'cancelled', 'success']

    def add_associated_future(self, future):
        """Adds a future to be associated with the TransferFuture"""
        with self._associated_futures_lock:
            self._associated_futures.add(future)

    def remove_associated_future(self, future):
        """Removes a future's association to the TransferFuture"""
        with self._associated_futures_lock:
            self._associated_futures.remove(future)

    def add_done_callback(self, function, *args, **kwargs):
        """Add a done callback to be invoked when transfer is done"""
        with self._done_callbacks_lock:
            self._done_callbacks.append(
                FunctionContainer(function, *args, **kwargs)
            )

    def add_failure_cleanup(self, function, *args, **kwargs):
        """Adds a callback to call upon failure"""
        with self._failure_cleanups_lock:
            self._failure_cleanups.append(
                FunctionContainer(function, *args, **kwargs)
            )

    def announce_done(self):
        """Announce that future is done running and run associated callbacks

        This will run any failure cleanups if the transfer failed if not
        they have not been run, allows the result() to be unblocked, and will
        run any done callbacks associated to the TransferFuture if they have
        not already been ran.
        """
        if self.status != 'success':
            self._run_failure_cleanups()
        self._done_event.set()
        self._run_done_callbacks()

    def _run_done_callbacks(self):
        # Run the callbacks and remove the callbacks from the internal
        # list so they do not get ran again if done is announced more than
        # once.
        with self._done_callbacks_lock:
            self._run_callbacks(self._done_callbacks)
            self._done_callbacks = []

    def _run_failure_cleanups(self):
        # Run the cleanup callbacks and remove the callbacks from the internal
        # list so they do not get ran again if done is announced more than
        # once.
        with self._failure_cleanups_lock:
            self._run_callbacks(self.failure_cleanups)
            self._failure_cleanups = []

    def _run_callbacks(self, callbacks):
        for callback in callbacks:
            self._run_callback(callback)

    def _run_callback(self, callback):
        try:
            callback()
        # We do not want a callback interrupting the process, especially
        # in the failure cleanups. So log and catch, the exception.
        except Exception:
            logger.debug(f"Exception raised in {callback}.", exc_info=True)


class BoundedExecutor:
    EXECUTOR_CLS = futures.ThreadPoolExecutor

    def __init__(
        self, max_size, max_num_threads, tag_semaphores=None, executor_cls=None
    ):
        """An executor implementation that has a maximum queued up tasks

        The executor will block if the number of tasks that have been
        submitted and is currently working on is past its maximum.

        :params max_size: The maximum number of inflight futures. An inflight
            future means that the task is either queued up or is currently
            being executed. A size of None or 0 means that the executor will
            have no bound in terms of the number of inflight futures.

        :params max_num_threads: The maximum number of threads the executor
            uses.

        :type tag_semaphores: dict
        :params tag_semaphores: A dictionary where the key is the name of the
            tag and the value is the semaphore to use when limiting the
            number of tasks the executor is processing at a time.

        :type executor_cls: BaseExecutor
        :param underlying_executor_cls: The executor class that
            get bounded by this executor. If None is provided, the
            concurrent.futures.ThreadPoolExecutor class is used.
        """
        self._max_num_threads = max_num_threads
        if executor_cls is None:
            executor_cls = self.EXECUTOR_CLS
        self._executor = executor_cls(max_workers=self._max_num_threads)
        self._semaphore = TaskSemaphore(max_size)
        self._tag_semaphores = tag_semaphores

    def submit(self, task, tag=None, block=True):
        """Submit a task to complete

        :type task: s3transfer.tasks.Task
        :param task: The task to run __call__ on


        :type tag: s3transfer.futures.TaskTag
        :param tag: An optional tag to associate to the task. This
            is used to override which semaphore to use.

        :type block: boolean
        :param block: True if to wait till it is possible to submit a task.
            False, if not to wait and raise an error if not able to submit
            a task.

        :returns: The future associated to the submitted task
        """
        semaphore = self._semaphore
        # If a tag was provided, use the semaphore associated to that
        # tag.
        if tag:
            semaphore = self._tag_semaphores[tag]

        # Call acquire on the semaphore.
        acquire_token = semaphore.acquire(task.transfer_id, block)
        # Create a callback to invoke when task is done in order to call
        # release on the semaphore.
        release_callback = FunctionContainer(
            semaphore.release, task.transfer_id, acquire_token
        )
        # Submit the task to the underlying executor.
        future = ExecutorFuture(self._executor.submit(task))
        # Add the Semaphore.release() callback to the future such that
        # it is invoked once the future completes.
        future.add_done_callback(release_callback)
        return future

    def shutdown(self, wait=True):
        self._executor.shutdown(wait)


class ExecutorFuture:
    def __init__(self, future):
        """A future returned from the executor

        Currently, it is just a wrapper around a concurrent.futures.Future.
        However, this can eventually grow to implement the needed functionality
        of concurrent.futures.Future if we move off of the library and not
        affect the rest of the codebase.

        :type future: concurrent.futures.Future
        :param future: The underlying future
        """
        self._future = future

    def result(self):
        return self._future.result()

    def add_done_callback(self, fn):
        """Adds a callback to be completed once future is done

        :param fn: A callable that takes no arguments. Note that is different
            than concurrent.futures.Future.add_done_callback that requires
            a single argument for the future.
        """

        # The done callback for concurrent.futures.Future will always pass a
        # the future in as the only argument. So we need to create the
        # proper signature wrapper that will invoke the callback provided.
        def done_callback(future_passed_to_callback):
            return fn()

        self._future.add_done_callback(done_callback)

    def done(self):
        return self._future.done()


class BaseExecutor:
    """Base Executor class implementation needed to work with s3transfer"""

    def __init__(self, max_workers=None):
        pass

    def submit(self, fn, *args, **kwargs):
        raise NotImplementedError('submit()')

    def shutdown(self, wait=True):
        raise NotImplementedError('shutdown()')


class NonThreadedExecutor(BaseExecutor):
    """A drop-in replacement non-threaded version of ThreadPoolExecutor"""

    def submit(self, fn, *args, **kwargs):
        future = NonThreadedExecutorFuture()
        try:
            result = fn(*args, **kwargs)
            future.set_result(result)
        except Exception:
            e, tb = sys.exc_info()[1:]
            logger.debug(
                'Setting exception for %s to %s with traceback %s',
                future,
                e,
                tb,
            )
            future.set_exception_info(e, tb)
        return future

    def shutdown(self, wait=True):
        pass


class NonThreadedExecutorFuture:
    """The Future returned from NonThreadedExecutor

    Note that this future is **not** thread-safe as it is being used
    from the context of a non-threaded environment.
    """

    def __init__(self):
        self._result = None
        self._exception = None
        self._traceback = None
        self._done = False
        self._done_callbacks = []

    def set_result(self, result):
        self._result = result
        self._set_done()

    def set_exception_info(self, exception, traceback):
        self._exception = exception
        self._traceback = traceback
        self._set_done()

    def result(self, timeout=None):
        if self._exception:
            raise self._exception.with_traceback(self._traceback)
        return self._result

    def _set_done(self):
        self._done = True
        for done_callback in self._done_callbacks:
            self._invoke_done_callback(done_callback)
        self._done_callbacks = []

    def _invoke_done_callback(self, done_callback):
        return done_callback(self)

    def done(self):
        return self._done

    def add_done_callback(self, fn):
        if self._done:
            self._invoke_done_callback(fn)
        else:
            self._done_callbacks.append(fn)


TaskTag = namedtuple('TaskTag', ['name'])

IN_MEMORY_UPLOAD_TAG = TaskTag('in_memory_upload')
IN_MEMORY_DOWNLOAD_TAG = TaskTag('in_memory_download')
