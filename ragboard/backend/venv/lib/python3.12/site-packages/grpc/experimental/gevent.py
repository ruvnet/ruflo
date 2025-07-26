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
"""gRPC's Python gEvent APIs."""

from grpc._cython import cygrpc as _cygrpc


def init_gevent():
    """Patches gRPC's libraries to be compatible with gevent.

    This must be called AFTER the python standard lib has been patched,
    but BEFORE creating and gRPC objects.

    In order for progress to be made, the application must drive the event loop.
    """
    _cygrpc.init_grpc_gevent()
