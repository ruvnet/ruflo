# Copyright 2018 gRPC authors.
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
"""gRPC's APIs for TLS Session Resumption support"""

from grpc._cython import cygrpc as _cygrpc


def ssl_session_cache_lru(capacity):
    """Creates an SSLSessionCache with LRU replacement policy

    Args:
      capacity: Size of the cache

    Returns:
      An SSLSessionCache with LRU replacement policy that can be passed as a value for
      the grpc.ssl_session_cache option to a grpc.Channel. SSL session caches are used
      to store session tickets, which clients can present to resume previous TLS sessions
      with a server.
    """
    return SSLSessionCache(_cygrpc.SSLSessionCacheLRU(capacity))


class SSLSessionCache(object):
    """An encapsulation of a session cache used for TLS session resumption.

    Instances of this class can be passed to a Channel as values for the
    grpc.ssl_session_cache option
    """

    def __init__(self, cache):
        self._cache = cache

    def __int__(self):
        return int(self._cache)
