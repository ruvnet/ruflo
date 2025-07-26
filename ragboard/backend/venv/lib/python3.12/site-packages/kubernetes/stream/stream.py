# Copyright 2018 The Kubernetes Authors.
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

import functools

from . import ws_client


def _websocket_request(websocket_request, force_kwargs, api_method, *args, **kwargs):
    """Override the ApiClient.request method with an alternative websocket based
    method and call the supplied Kubernetes API method with that in place."""
    if force_kwargs:
        for kwarg, value in force_kwargs.items():
            kwargs[kwarg] = value
    api_client = api_method.__self__.api_client
    # old generated code's api client has config. new ones has configuration
    try:
        configuration = api_client.configuration
    except AttributeError:
        configuration = api_client.config
    prev_request = api_client.request
    binary = kwargs.pop('binary', False)
    try:
        api_client.request = functools.partial(websocket_request, configuration, binary=binary)
        out = api_method(*args, **kwargs)
        # The api_client insists on converting this to a string using its representation, so we have
        # to do this dance to strip it of the b' prefix and ' suffix, encode it byte-per-byte (latin1),
        # escape all of the unicode \x*'s, then encode it back byte-by-byte
        # However, if _preload_content=False is passed, then the entire WSClient is returned instead
        # of a response, and we want to leave it alone
        if binary and kwargs.get('_preload_content', True):
            out = out[2:-1].encode('latin1').decode('unicode_escape').encode('latin1')
        return out
    finally:
        api_client.request = prev_request


stream = functools.partial(_websocket_request, ws_client.websocket_call, None)
portforward = functools.partial(_websocket_request, ws_client.portforward_call, {'_preload_content':False})
