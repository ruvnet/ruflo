# Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
import s3transfer

KB = 1024
MB = KB * KB
GB = MB * KB

ALLOWED_DOWNLOAD_ARGS = [
    'ChecksumMode',
    'VersionId',
    'SSECustomerAlgorithm',
    'SSECustomerKey',
    'SSECustomerKeyMD5',
    'RequestPayer',
    'ExpectedBucketOwner',
]

USER_AGENT = f's3transfer/{s3transfer.__version__}'
PROCESS_USER_AGENT = f'{USER_AGENT} processpool'
