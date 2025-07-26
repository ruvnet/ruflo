# Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
import copy
import math

from s3transfer.tasks import (
    CompleteMultipartUploadTask,
    CreateMultipartUploadTask,
    SubmissionTask,
    Task,
)
from s3transfer.utils import (
    ChunksizeAdjuster,
    calculate_range_parameter,
    get_callbacks,
    get_filtered_dict,
)


class CopySubmissionTask(SubmissionTask):
    """Task for submitting tasks to execute a copy"""

    EXTRA_ARGS_TO_HEAD_ARGS_MAPPING = {
        'CopySourceIfMatch': 'IfMatch',
        'CopySourceIfModifiedSince': 'IfModifiedSince',
        'CopySourceIfNoneMatch': 'IfNoneMatch',
        'CopySourceIfUnmodifiedSince': 'IfUnmodifiedSince',
        'CopySourceSSECustomerKey': 'SSECustomerKey',
        'CopySourceSSECustomerAlgorithm': 'SSECustomerAlgorithm',
        'CopySourceSSECustomerKeyMD5': 'SSECustomerKeyMD5',
        'RequestPayer': 'RequestPayer',
        'ExpectedBucketOwner': 'ExpectedBucketOwner',
    }

    UPLOAD_PART_COPY_ARGS = [
        'CopySourceIfMatch',
        'CopySourceIfModifiedSince',
        'CopySourceIfNoneMatch',
        'CopySourceIfUnmodifiedSince',
        'CopySourceSSECustomerKey',
        'CopySourceSSECustomerAlgorithm',
        'CopySourceSSECustomerKeyMD5',
        'SSECustomerKey',
        'SSECustomerAlgorithm',
        'SSECustomerKeyMD5',
        'RequestPayer',
        'ExpectedBucketOwner',
    ]

    CREATE_MULTIPART_ARGS_BLACKLIST = [
        'CopySourceIfMatch',
        'CopySourceIfModifiedSince',
        'CopySourceIfNoneMatch',
        'CopySourceIfUnmodifiedSince',
        'CopySourceSSECustomerKey',
        'CopySourceSSECustomerAlgorithm',
        'CopySourceSSECustomerKeyMD5',
        'MetadataDirective',
        'TaggingDirective',
    ]

    COMPLETE_MULTIPART_ARGS = [
        'SSECustomerKey',
        'SSECustomerAlgorithm',
        'SSECustomerKeyMD5',
        'RequestPayer',
        'ExpectedBucketOwner',
    ]

    def _submit(
        self, client, config, osutil, request_executor, transfer_future
    ):
        """
        :param client: The client associated with the transfer manager

        :type config: s3transfer.manager.TransferConfig
        :param config: The transfer config associated with the transfer
            manager

        :type osutil: s3transfer.utils.OSUtil
        :param osutil: The os utility associated to the transfer manager

        :type request_executor: s3transfer.futures.BoundedExecutor
        :param request_executor: The request executor associated with the
            transfer manager

        :type transfer_future: s3transfer.futures.TransferFuture
        :param transfer_future: The transfer future associated with the
            transfer request that tasks are being submitted for
        """
        # Determine the size if it was not provided
        if transfer_future.meta.size is None:
            # If a size was not provided figure out the size for the
            # user. Note that we will only use the client provided to
            # the TransferManager. If the object is outside of the region
            # of the client, they may have to provide the file size themselves
            # with a completely new client.
            call_args = transfer_future.meta.call_args
            head_object_request = (
                self._get_head_object_request_from_copy_source(
                    call_args.copy_source
                )
            )
            extra_args = call_args.extra_args

            # Map any values that may be used in the head object that is
            # used in the copy object
            for param, value in extra_args.items():
                if param in self.EXTRA_ARGS_TO_HEAD_ARGS_MAPPING:
                    head_object_request[
                        self.EXTRA_ARGS_TO_HEAD_ARGS_MAPPING[param]
                    ] = value

            response = call_args.source_client.head_object(
                **head_object_request
            )
            transfer_future.meta.provide_transfer_size(
                response['ContentLength']
            )

        # If it is greater than threshold do a multipart copy, otherwise
        # do a regular copy object.
        if transfer_future.meta.size < config.multipart_threshold:
            self._submit_copy_request(
                client, config, osutil, request_executor, transfer_future
            )
        else:
            self._submit_multipart_request(
                client, config, osutil, request_executor, transfer_future
            )

    def _submit_copy_request(
        self, client, config, osutil, request_executor, transfer_future
    ):
        call_args = transfer_future.meta.call_args

        # Get the needed progress callbacks for the task
        progress_callbacks = get_callbacks(transfer_future, 'progress')

        # Submit the request of a single copy.
        self._transfer_coordinator.submit(
            request_executor,
            CopyObjectTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'copy_source': call_args.copy_source,
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'extra_args': call_args.extra_args,
                    'callbacks': progress_callbacks,
                    'size': transfer_future.meta.size,
                },
                is_final=True,
            ),
        )

    def _submit_multipart_request(
        self, client, config, osutil, request_executor, transfer_future
    ):
        call_args = transfer_future.meta.call_args

        # Submit the request to create a multipart upload and make sure it
        # does not include any of the arguments used for copy part.
        create_multipart_extra_args = {}
        for param, val in call_args.extra_args.items():
            if param not in self.CREATE_MULTIPART_ARGS_BLACKLIST:
                create_multipart_extra_args[param] = val

        create_multipart_future = self._transfer_coordinator.submit(
            request_executor,
            CreateMultipartUploadTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'extra_args': create_multipart_extra_args,
                },
            ),
        )

        # Determine how many parts are needed based on filesize and
        # desired chunksize.
        part_size = config.multipart_chunksize
        adjuster = ChunksizeAdjuster()
        part_size = adjuster.adjust_chunksize(
            part_size, transfer_future.meta.size
        )
        num_parts = int(
            math.ceil(transfer_future.meta.size / float(part_size))
        )

        # Submit requests to upload the parts of the file.
        part_futures = []
        progress_callbacks = get_callbacks(transfer_future, 'progress')

        for part_number in range(1, num_parts + 1):
            extra_part_args = self._extra_upload_part_args(
                call_args.extra_args
            )
            # The part number for upload part starts at 1 while the
            # range parameter starts at zero, so just subtract 1 off of
            # the part number
            extra_part_args['CopySourceRange'] = calculate_range_parameter(
                part_size,
                part_number - 1,
                num_parts,
                transfer_future.meta.size,
            )
            # Get the size of the part copy as well for the progress
            # callbacks.
            size = self._get_transfer_size(
                part_size,
                part_number - 1,
                num_parts,
                transfer_future.meta.size,
            )
            # Get the checksum algorithm of the multipart request.
            checksum_algorithm = call_args.extra_args.get("ChecksumAlgorithm")
            part_futures.append(
                self._transfer_coordinator.submit(
                    request_executor,
                    CopyPartTask(
                        transfer_coordinator=self._transfer_coordinator,
                        main_kwargs={
                            'client': client,
                            'copy_source': call_args.copy_source,
                            'bucket': call_args.bucket,
                            'key': call_args.key,
                            'part_number': part_number,
                            'extra_args': extra_part_args,
                            'callbacks': progress_callbacks,
                            'size': size,
                            'checksum_algorithm': checksum_algorithm,
                        },
                        pending_main_kwargs={
                            'upload_id': create_multipart_future
                        },
                    ),
                )
            )

        complete_multipart_extra_args = self._extra_complete_multipart_args(
            call_args.extra_args
        )
        # Submit the request to complete the multipart upload.
        self._transfer_coordinator.submit(
            request_executor,
            CompleteMultipartUploadTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'extra_args': complete_multipart_extra_args,
                },
                pending_main_kwargs={
                    'upload_id': create_multipart_future,
                    'parts': part_futures,
                },
                is_final=True,
            ),
        )

    def _get_head_object_request_from_copy_source(self, copy_source):
        if isinstance(copy_source, dict):
            return copy.copy(copy_source)
        else:
            raise TypeError(
                'Expecting dictionary formatted: '
                '{"Bucket": bucket_name, "Key": key} '
                f'but got {copy_source} or type {type(copy_source)}.'
            )

    def _extra_upload_part_args(self, extra_args):
        # Only the args in COPY_PART_ARGS actually need to be passed
        # onto the upload_part_copy calls.
        return get_filtered_dict(extra_args, self.UPLOAD_PART_COPY_ARGS)

    def _extra_complete_multipart_args(self, extra_args):
        return get_filtered_dict(extra_args, self.COMPLETE_MULTIPART_ARGS)

    def _get_transfer_size(
        self, part_size, part_index, num_parts, total_transfer_size
    ):
        if part_index == num_parts - 1:
            # The last part may be different in size then the rest of the
            # parts.
            return total_transfer_size - (part_index * part_size)
        return part_size


class CopyObjectTask(Task):
    """Task to do a nonmultipart copy"""

    def _main(
        self, client, copy_source, bucket, key, extra_args, callbacks, size
    ):
        """
        :param client: The client to use when calling PutObject
        :param copy_source: The CopySource parameter to use
        :param bucket: The name of the bucket to copy to
        :param key: The name of the key to copy to
        :param extra_args: A dictionary of any extra arguments that may be
            used in the upload.
        :param callbacks: List of callbacks to call after copy
        :param size: The size of the transfer. This value is passed into
            the callbacks

        """
        client.copy_object(
            CopySource=copy_source, Bucket=bucket, Key=key, **extra_args
        )
        for callback in callbacks:
            callback(bytes_transferred=size)


class CopyPartTask(Task):
    """Task to upload a part in a multipart copy"""

    def _main(
        self,
        client,
        copy_source,
        bucket,
        key,
        upload_id,
        part_number,
        extra_args,
        callbacks,
        size,
        checksum_algorithm=None,
    ):
        """
        :param client: The client to use when calling PutObject
        :param copy_source: The CopySource parameter to use
        :param bucket: The name of the bucket to upload to
        :param key: The name of the key to upload to
        :param upload_id: The id of the upload
        :param part_number: The number representing the part of the multipart
            upload
        :param extra_args: A dictionary of any extra arguments that may be
            used in the upload.
        :param callbacks: List of callbacks to call after copy part
        :param size: The size of the transfer. This value is passed into
            the callbacks
        :param checksum_algorithm: The algorithm that was used to create the multipart
            upload

        :rtype: dict
        :returns: A dictionary representing a part::

            {'Etag': etag_value, 'PartNumber': part_number}

            This value can be appended to a list to be used to complete
            the multipart upload. If a checksum is in the response,
            it will also be included.
        """
        response = client.upload_part_copy(
            CopySource=copy_source,
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            PartNumber=part_number,
            **extra_args,
        )
        for callback in callbacks:
            callback(bytes_transferred=size)
        etag = response['CopyPartResult']['ETag']
        part_metadata = {'ETag': etag, 'PartNumber': part_number}
        if checksum_algorithm:
            checksum_member = f'Checksum{checksum_algorithm.upper()}'
            if checksum_member in response['CopyPartResult']:
                part_metadata[checksum_member] = response['CopyPartResult'][
                    checksum_member
                ]
        return part_metadata
