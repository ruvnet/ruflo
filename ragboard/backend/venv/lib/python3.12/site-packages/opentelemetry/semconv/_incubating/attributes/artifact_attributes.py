# Copyright The OpenTelemetry Authors
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

from typing import Final

ARTIFACT_ATTESTATION_FILENAME: Final = "artifact.attestation.filename"
"""
The provenance filename of the built attestation which directly relates to the build artifact filename. This filename SHOULD accompany the artifact at publish time. See the [SLSA Relationship](https://slsa.dev/spec/v1.0/distributing-provenance#relationship-between-artifacts-and-attestations) specification for more information.
"""

ARTIFACT_ATTESTATION_HASH: Final = "artifact.attestation.hash"
"""
The full [hash value (see glossary)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf), of the built attestation. Some envelopes in the [software attestation space](https://github.com/in-toto/attestation/tree/main/spec) also refer to this as the **digest**.
"""

ARTIFACT_ATTESTATION_ID: Final = "artifact.attestation.id"
"""
The id of the build [software attestation](https://slsa.dev/attestation-model).
"""

ARTIFACT_FILENAME: Final = "artifact.filename"
"""
The human readable file name of the artifact, typically generated during build and release processes. Often includes the package name and version in the file name.
Note: This file name can also act as the [Package Name](https://slsa.dev/spec/v1.0/terminology#package-model)
in cases where the package ecosystem maps accordingly.
Additionally, the artifact [can be published](https://slsa.dev/spec/v1.0/terminology#software-supply-chain)
for others, but that is not a guarantee.
"""

ARTIFACT_HASH: Final = "artifact.hash"
"""
The full [hash value (see glossary)](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf), often found in checksum.txt on a release of the artifact and used to verify package integrity.
Note: The specific algorithm used to create the cryptographic hash value is
not defined. In situations where an artifact has multiple
cryptographic hashes, it is up to the implementer to choose which
hash value to set here; this should be the most secure hash algorithm
that is suitable for the situation and consistent with the
corresponding attestation. The implementer can then provide the other
hash values through an additional set of attribute extensions as they
deem necessary.
"""

ARTIFACT_PURL: Final = "artifact.purl"
"""
The [Package URL](https://github.com/package-url/purl-spec) of the [package artifact](https://slsa.dev/spec/v1.0/terminology#package-model) provides a standard way to identify and locate the packaged artifact.
"""

ARTIFACT_VERSION: Final = "artifact.version"
"""
The version of the artifact.
"""
