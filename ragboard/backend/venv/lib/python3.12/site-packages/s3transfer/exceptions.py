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
from concurrent.futures import CancelledError


class RetriesExceededError(Exception):
    def __init__(self, last_exception, msg='Max Retries Exceeded'):
        super().__init__(msg)
        self.last_exception = last_exception


class S3UploadFailedError(Exception):
    pass


class InvalidSubscriberMethodError(Exception):
    pass


class TransferNotDoneError(Exception):
    pass


class FatalError(CancelledError):
    """A CancelledError raised from an error in the TransferManager"""

    pass
