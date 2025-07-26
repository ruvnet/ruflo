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
from functools import lru_cache

from s3transfer.compat import accepts_kwargs
from s3transfer.exceptions import InvalidSubscriberMethodError


class BaseSubscriber:
    """The base subscriber class

    It is recommended that all subscriber implementations subclass and then
    override the subscription methods (i.e. on_{subsribe_type}() methods).
    """

    VALID_SUBSCRIBER_TYPES = ['queued', 'progress', 'done']

    def __new__(cls, *args, **kwargs):
        cls._validate_subscriber_methods()
        return super().__new__(cls)

    @classmethod
    @lru_cache
    def _validate_subscriber_methods(cls):
        for subscriber_type in cls.VALID_SUBSCRIBER_TYPES:
            subscriber_method = getattr(cls, 'on_' + subscriber_type)
            if not callable(subscriber_method):
                raise InvalidSubscriberMethodError(
                    f'Subscriber method {subscriber_method} must be callable.'
                )

            if not accepts_kwargs(subscriber_method):
                raise InvalidSubscriberMethodError(
                    f'Subscriber method {subscriber_method} must accept keyword '
                    'arguments (**kwargs)'
                )

    def on_queued(self, future, **kwargs):
        """Callback to be invoked when transfer request gets queued

        This callback can be useful for:

            * Keeping track of how many transfers have been requested
            * Providing the expected transfer size through
              future.meta.provide_transfer_size() so a HeadObject would not
              need to be made for copies and downloads.

        :type future: s3transfer.futures.TransferFuture
        :param future: The TransferFuture representing the requested transfer.
        """
        pass

    def on_progress(self, future, bytes_transferred, **kwargs):
        """Callback to be invoked when progress is made on transfer

        This callback can be useful for:

            * Recording and displaying progress

        :type future: s3transfer.futures.TransferFuture
        :param future: The TransferFuture representing the requested transfer.

        :type bytes_transferred: int
        :param bytes_transferred: The number of bytes transferred for that
            invocation of the callback. Note that a negative amount can be
            provided, which usually indicates that an in-progress request
            needed to be retried and thus progress was rewound.
        """
        pass

    def on_done(self, future, **kwargs):
        """Callback to be invoked once a transfer is done

        This callback can be useful for:

            * Recording and displaying whether the transfer succeeded or
              failed using future.result()
            * Running some task after the transfer completed like changing
              the last modified time of a downloaded file.

        :type future: s3transfer.futures.TransferFuture
        :param future: The TransferFuture representing the requested transfer.
        """
        pass
