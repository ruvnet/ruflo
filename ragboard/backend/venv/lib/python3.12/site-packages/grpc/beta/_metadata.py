# Copyright 2017 gRPC authors.
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
"""API metadata conversion utilities."""

import collections

_Metadatum = collections.namedtuple(
    "_Metadatum",
    (
        "key",
        "value",
    ),
)


def _beta_metadatum(key, value):
    beta_key = key if isinstance(key, (bytes,)) else key.encode("ascii")
    beta_value = value if isinstance(value, (bytes,)) else value.encode("ascii")
    return _Metadatum(beta_key, beta_value)


def _metadatum(beta_key, beta_value):
    key = beta_key if isinstance(beta_key, (str,)) else beta_key.decode("utf8")
    if isinstance(beta_value, (str,)) or key[-4:] == "-bin":
        value = beta_value
    else:
        value = beta_value.decode("utf8")
    return _Metadatum(key, value)


def beta(metadata):
    if metadata is None:
        return ()
    else:
        return tuple(_beta_metadatum(key, value) for key, value in metadata)


def unbeta(beta_metadata):
    if beta_metadata is None:
        return ()
    else:
        return tuple(
            _metadatum(beta_key, beta_value)
            for beta_key, beta_value in beta_metadata
        )
