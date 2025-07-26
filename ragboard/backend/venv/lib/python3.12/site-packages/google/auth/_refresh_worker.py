# Copyright 2023 Google LLC
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

import copy
import logging
import threading

import google.auth.exceptions as e

_LOGGER = logging.getLogger(__name__)


class RefreshThreadManager:
    """
    Organizes exactly one background job that refresh a token.
    """

    def __init__(self):
        """Initializes the manager."""

        self._worker = None
        self._lock = threading.Lock()  # protects access to worker threads.

    def start_refresh(self, cred, request):
        """Starts a refresh thread for the given credentials.
        The credentials are refreshed using the request parameter.
        request and cred MUST not be None

        Returns True if a background refresh was kicked off. False otherwise.

        Args:
            cred: A credentials object.
            request: A request object.
        Returns:
          bool
        """
        if cred is None or request is None:
            raise e.InvalidValue(
                "Unable to start refresh. cred and request must be valid and instantiated objects."
            )

        with self._lock:
            if self._worker is not None and self._worker._error_info is not None:
                return False

            if self._worker is None or not self._worker.is_alive():  # pragma: NO COVER
                self._worker = RefreshThread(cred=cred, request=copy.deepcopy(request))
                self._worker.start()
        return True

    def clear_error(self):
        """
      Removes any errors that were stored from previous background refreshes.
      """
        with self._lock:
            if self._worker:
                self._worker._error_info = None

    def __getstate__(self):
        """Pickle helper that serializes the _lock attribute."""
        state = self.__dict__.copy()
        state["_lock"] = None
        return state

    def __setstate__(self, state):
        """Pickle helper that deserializes the _lock attribute."""
        state["_lock"] = threading.Lock()
        self.__dict__.update(state)


class RefreshThread(threading.Thread):
    """
    Thread that refreshes credentials.
    """

    def __init__(self, cred, request, **kwargs):
        """Initializes the thread.

        Args:
            cred: A Credential object to refresh.
            request: A Request object used to perform a credential refresh.
            **kwargs: Additional keyword arguments.
        """

        super().__init__(**kwargs)
        self._cred = cred
        self._request = request
        self._error_info = None

    def run(self):
        """
        Perform the credential refresh.
        """
        try:
            self._cred.refresh(self._request)
        except Exception as err:  # pragma: NO COVER
            _LOGGER.error(f"Background refresh failed due to: {err}")
            self._error_info = err
