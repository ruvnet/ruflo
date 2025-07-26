# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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

# A list of auth types supported by the signers in botocore/crt/auth.py. This
# should always match the keys of botocore.crt.auth.CRT_AUTH_TYPE_MAPS. The
# information is duplicated here so that it can be accessed in environments
# where `awscrt` is not present and any import from botocore.crt.auth would
# fail.
CRT_SUPPORTED_AUTH_TYPES = (
    'v4',
    'v4-query',
    'v4a',
    's3v4',
    's3v4-query',
    's3v4a',
    's3v4a-query',
)
