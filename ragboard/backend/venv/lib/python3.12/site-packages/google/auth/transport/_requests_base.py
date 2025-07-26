# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Transport adapter for Base Requests."""
# NOTE: The coverage for this file is temporarily disabled in `.coveragerc`
# since it is currently unused.

import abc


_DEFAULT_TIMEOUT = 120  # in second


class _BaseAuthorizedSession(metaclass=abc.ABCMeta):
    """Base class for a Request Session with credentials. This class is intended to capture
    the common logic between synchronous and asynchronous request sessions and is not intended to
    be instantiated directly.

    Args:
        credentials (google.auth._credentials_base.BaseCredentials): The credentials to
            add to the request.
    """

    def __init__(self, credentials):
        self.credentials = credentials

    @abc.abstractmethod
    def request(
        self,
        method,
        url,
        data=None,
        headers=None,
        max_allowed_time=None,
        timeout=_DEFAULT_TIMEOUT,
        **kwargs
    ):
        raise NotImplementedError("Request must be implemented")

    @abc.abstractmethod
    def close(self):
        raise NotImplementedError("Close must be implemented")
