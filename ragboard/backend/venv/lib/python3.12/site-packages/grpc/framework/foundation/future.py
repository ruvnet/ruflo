# Copyright 2015 gRPC authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""A Future interface.

Python doesn't have a Future interface in its standard library. In the absence
of such a standard, three separate, incompatible implementations
(concurrent.futures.Future, ndb.Future, and asyncio.Future) have appeared. This
interface attempts to be as compatible as possible with
concurrent.futures.Future. From ndb.Future it adopts a traceback-object accessor
method.

Unlike the concrete and implemented Future classes listed above, the Future
class defined in this module is an entirely abstract interface that anyone may
implement and use.

The one known incompatibility between this interface and the interface of
concurrent.futures.Future is that this interface defines its own CancelledError
and TimeoutError exceptions rather than raising the implementation-private
concurrent.futures._base.CancelledError and the
built-in-but-only-in-3.3-and-later TimeoutError.
"""

import abc


class TimeoutError(Exception):
    """Indicates that a particular call timed out."""


class CancelledError(Exception):
    """Indicates that the computation underlying a Future was cancelled."""


class Future(abc.ABC):
    """A representation of a computation in another control flow.

    Computations represented by a Future may be yet to be begun, may be ongoing,
    or may have already completed.
    """

    # NOTE(nathaniel): This isn't the return type that I would want to have if it
    # were up to me. Were this interface being written from scratch, the return
    # type of this method would probably be a sum type like:
    #
    # NOT_COMMENCED
    # COMMENCED_AND_NOT_COMPLETED
    # PARTIAL_RESULT<Partial_Result_Type>
    # COMPLETED<Result_Type>
    # UNCANCELLABLE
    # NOT_IMMEDIATELY_DETERMINABLE
    @abc.abstractmethod
    def cancel(self):
        """Attempts to cancel the computation.

        This method does not block.

        Returns:
          True if the computation has not yet begun, will not be allowed to take
            place, and determination of both was possible without blocking. False
            under all other circumstances including but not limited to the
            computation's already having begun, the computation's already having
            finished, and the computation's having been scheduled for execution on a
            remote system for which a determination of whether or not it commenced
            before being cancelled cannot be made without blocking.
        """
        raise NotImplementedError()

    # NOTE(nathaniel): Here too this isn't the return type that I'd want this
    # method to have if it were up to me. I think I'd go with another sum type
    # like:
    #
    # NOT_CANCELLED (this object's cancel method hasn't been called)
    # NOT_COMMENCED
    # COMMENCED_AND_NOT_COMPLETED
    # PARTIAL_RESULT<Partial_Result_Type>
    # COMPLETED<Result_Type>
    # UNCANCELLABLE
    # NOT_IMMEDIATELY_DETERMINABLE
    #
    # Notice how giving the cancel method the right semantics obviates most
    # reasons for this method to exist.
    @abc.abstractmethod
    def cancelled(self):
        """Describes whether the computation was cancelled.

        This method does not block.

        Returns:
          True if the computation was cancelled any time before its result became
            immediately available. False under all other circumstances including but
            not limited to this object's cancel method not having been called and
            the computation's result having become immediately available.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def running(self):
        """Describes whether the computation is taking place.

        This method does not block.

        Returns:
          True if the computation is scheduled to take place in the future or is
            taking place now, or False if the computation took place in the past or
            was cancelled.
        """
        raise NotImplementedError()

    # NOTE(nathaniel): These aren't quite the semantics I'd like here either. I
    # would rather this only returned True in cases in which the underlying
    # computation completed successfully. A computation's having been cancelled
    # conflicts with considering that computation "done".
    @abc.abstractmethod
    def done(self):
        """Describes whether the computation has taken place.

        This method does not block.

        Returns:
          True if the computation is known to have either completed or have been
            unscheduled or interrupted. False if the computation may possibly be
            executing or scheduled to execute later.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def result(self, timeout=None):
        """Accesses the outcome of the computation or raises its exception.

        This method may return immediately or may block.

        Args:
          timeout: The length of time in seconds to wait for the computation to
            finish or be cancelled, or None if this method should block until the
            computation has finished or is cancelled no matter how long that takes.

        Returns:
          The return value of the computation.

        Raises:
          TimeoutError: If a timeout value is passed and the computation does not
            terminate within the allotted time.
          CancelledError: If the computation was cancelled.
          Exception: If the computation raised an exception, this call will raise
            the same exception.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def exception(self, timeout=None):
        """Return the exception raised by the computation.

        This method may return immediately or may block.

        Args:
          timeout: The length of time in seconds to wait for the computation to
            terminate or be cancelled, or None if this method should block until
            the computation is terminated or is cancelled no matter how long that
            takes.

        Returns:
          The exception raised by the computation, or None if the computation did
            not raise an exception.

        Raises:
          TimeoutError: If a timeout value is passed and the computation does not
            terminate within the allotted time.
          CancelledError: If the computation was cancelled.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def traceback(self, timeout=None):
        """Access the traceback of the exception raised by the computation.

        This method may return immediately or may block.

        Args:
          timeout: The length of time in seconds to wait for the computation to
            terminate or be cancelled, or None if this method should block until
            the computation is terminated or is cancelled no matter how long that
            takes.

        Returns:
          The traceback of the exception raised by the computation, or None if the
            computation did not raise an exception.

        Raises:
          TimeoutError: If a timeout value is passed and the computation does not
            terminate within the allotted time.
          CancelledError: If the computation was cancelled.
        """
        raise NotImplementedError()

    @abc.abstractmethod
    def add_done_callback(self, fn):
        """Adds a function to be called at completion of the computation.

        The callback will be passed this Future object describing the outcome of
        the computation.

        If the computation has already completed, the callback will be called
        immediately.

        Args:
          fn: A callable taking this Future object as its single parameter.
        """
        raise NotImplementedError()
