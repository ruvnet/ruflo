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

import collections
import logging
import threading
from typing import Callable, Optional, Type

import grpc
from grpc import _common
from grpc._cython import cygrpc
from grpc._typing import MetadataType

_LOGGER = logging.getLogger(__name__)


class _AuthMetadataContext(
    collections.namedtuple(
        "AuthMetadataContext",
        (
            "service_url",
            "method_name",
        ),
    ),
    grpc.AuthMetadataContext,
):
    pass


class _CallbackState(object):
    def __init__(self):
        self.lock = threading.Lock()
        self.called = False
        self.exception = None


class _AuthMetadataPluginCallback(grpc.AuthMetadataPluginCallback):
    _state: _CallbackState
    _callback: Callable

    def __init__(self, state: _CallbackState, callback: Callable):
        self._state = state
        self._callback = callback

    def __call__(
        self, metadata: MetadataType, error: Optional[Type[BaseException]]
    ):
        with self._state.lock:
            if self._state.exception is None:
                if self._state.called:
                    raise RuntimeError(
                        "AuthMetadataPluginCallback invoked more than once!"
                    )
                else:
                    self._state.called = True
            else:
                raise RuntimeError(
                    'AuthMetadataPluginCallback raised exception "{}"!'.format(
                        self._state.exception
                    )
                )
        if error is None:
            self._callback(metadata, cygrpc.StatusCode.ok, None)
        else:
            self._callback(
                None, cygrpc.StatusCode.internal, _common.encode(str(error))
            )


class _Plugin(object):
    _metadata_plugin: grpc.AuthMetadataPlugin

    def __init__(self, metadata_plugin: grpc.AuthMetadataPlugin):
        self._metadata_plugin = metadata_plugin
        self._stored_ctx = None

        try:
            import contextvars  # pylint: disable=wrong-import-position

            # The plugin may be invoked on a thread created by Core, which will not
            # have the context propagated. This context is stored and installed in
            # the thread invoking the plugin.
            self._stored_ctx = contextvars.copy_context()
        except ImportError:
            # Support versions predating contextvars.
            pass

    def __call__(self, service_url: str, method_name: str, callback: Callable):
        context = _AuthMetadataContext(
            _common.decode(service_url), _common.decode(method_name)
        )
        callback_state = _CallbackState()
        try:
            self._metadata_plugin(
                context, _AuthMetadataPluginCallback(callback_state, callback)
            )
        except Exception as exception:  # pylint: disable=broad-except
            _LOGGER.exception(
                'AuthMetadataPluginCallback "%s" raised exception!',
                self._metadata_plugin,
            )
            with callback_state.lock:
                callback_state.exception = exception
                if callback_state.called:
                    return
            callback(
                None, cygrpc.StatusCode.internal, _common.encode(str(exception))
            )


def metadata_plugin_call_credentials(
    metadata_plugin: grpc.AuthMetadataPlugin, name: Optional[str]
) -> grpc.CallCredentials:
    if name is None:
        try:
            effective_name = metadata_plugin.__name__
        except AttributeError:
            effective_name = metadata_plugin.__class__.__name__
    else:
        effective_name = name
    return grpc.CallCredentials(
        cygrpc.MetadataPluginCallCredentials(
            _Plugin(metadata_plugin), _common.encode(effective_name)
        )
    )
