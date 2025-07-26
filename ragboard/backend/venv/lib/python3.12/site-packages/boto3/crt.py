# Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# https://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
"""
This file contains private functionality for interacting with the AWS
Common Runtime library (awscrt) in boto3.

All code contained within this file is for internal usage within this
project and is not intended for external consumption. All interfaces
contained within are subject to abrupt breaking changes.
"""

import threading

import botocore.exceptions
from botocore.session import Session
from s3transfer.crt import (
    BotocoreCRTCredentialsWrapper,
    BotocoreCRTRequestSerializer,
    CRTTransferManager,
    acquire_crt_s3_process_lock,
    create_s3_crt_client,
)

# Singletons for CRT-backed transfers
CRT_S3_CLIENT = None
BOTOCORE_CRT_SERIALIZER = None

CLIENT_CREATION_LOCK = threading.Lock()
PROCESS_LOCK_NAME = 'boto3'


def _create_crt_client(session, config, region_name, cred_provider):
    """Create a CRT S3 Client for file transfer.

    Instantiating many of these may lead to degraded performance or
    system resource exhaustion.
    """
    create_crt_client_kwargs = {
        'region': region_name,
        'use_ssl': True,
        'crt_credentials_provider': cred_provider,
    }
    return create_s3_crt_client(**create_crt_client_kwargs)


def _create_crt_request_serializer(session, region_name):
    return BotocoreCRTRequestSerializer(
        session, {'region_name': region_name, 'endpoint_url': None}
    )


def _create_crt_s3_client(
    session, config, region_name, credentials, lock, **kwargs
):
    """Create boto3 wrapper class to manage crt lock reference and S3 client."""
    cred_wrapper = BotocoreCRTCredentialsWrapper(credentials)
    cred_provider = cred_wrapper.to_crt_credentials_provider()
    return CRTS3Client(
        _create_crt_client(session, config, region_name, cred_provider),
        lock,
        region_name,
        cred_wrapper,
    )


def _initialize_crt_transfer_primatives(client, config):
    lock = acquire_crt_s3_process_lock(PROCESS_LOCK_NAME)
    if lock is None:
        # If we're unable to acquire the lock, we cannot
        # use the CRT in this process and should default to
        # the classic s3transfer manager.
        return None, None

    session = Session()
    region_name = client.meta.region_name
    credentials = client._get_credentials()

    serializer = _create_crt_request_serializer(session, region_name)
    s3_client = _create_crt_s3_client(
        session, config, region_name, credentials, lock
    )
    return serializer, s3_client


def get_crt_s3_client(client, config):
    global CRT_S3_CLIENT
    global BOTOCORE_CRT_SERIALIZER

    with CLIENT_CREATION_LOCK:
        if CRT_S3_CLIENT is None:
            serializer, s3_client = _initialize_crt_transfer_primatives(
                client, config
            )
            BOTOCORE_CRT_SERIALIZER = serializer
            CRT_S3_CLIENT = s3_client

    return CRT_S3_CLIENT


class CRTS3Client:
    """
    This wrapper keeps track of our underlying CRT client, the lock used to
    acquire it and the region we've used to instantiate the client.

    Due to limitations in the existing CRT interfaces, we can only make calls
    in a single region and does not support redirects. We track the region to
    ensure we don't use the CRT client when a successful request cannot be made.
    """

    def __init__(self, crt_client, process_lock, region, cred_provider):
        self.crt_client = crt_client
        self.process_lock = process_lock
        self.region = region
        self.cred_provider = cred_provider


def is_crt_compatible_request(client, crt_s3_client):
    """
    Boto3 client must use same signing region and credentials
    as the CRT_S3_CLIENT singleton. Otherwise fallback to classic.
    """
    if crt_s3_client is None:
        return False

    boto3_creds = client._get_credentials()
    if boto3_creds is None:
        return False

    is_same_identity = compare_identity(
        boto3_creds.get_frozen_credentials(), crt_s3_client.cred_provider
    )
    is_same_region = client.meta.region_name == crt_s3_client.region
    return is_same_region and is_same_identity


def compare_identity(boto3_creds, crt_s3_creds):
    try:
        crt_creds = crt_s3_creds()
    except botocore.exceptions.NoCredentialsError:
        return False

    is_matching_identity = (
        boto3_creds.access_key == crt_creds.access_key_id
        and boto3_creds.secret_key == crt_creds.secret_access_key
        and boto3_creds.token == crt_creds.session_token
    )
    return is_matching_identity


def create_crt_transfer_manager(client, config):
    """Create a CRTTransferManager for optimized data transfer."""
    crt_s3_client = get_crt_s3_client(client, config)
    if is_crt_compatible_request(client, crt_s3_client):
        return CRTTransferManager(
            crt_s3_client.crt_client, BOTOCORE_CRT_SERIALIZER
        )
    return None
