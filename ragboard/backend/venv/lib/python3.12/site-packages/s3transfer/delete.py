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
from s3transfer.tasks import SubmissionTask, Task


class DeleteSubmissionTask(SubmissionTask):
    """Task for submitting tasks to execute an object deletion."""

    def _submit(self, client, request_executor, transfer_future, **kwargs):
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
        call_args = transfer_future.meta.call_args

        self._transfer_coordinator.submit(
            request_executor,
            DeleteObjectTask(
                transfer_coordinator=self._transfer_coordinator,
                main_kwargs={
                    'client': client,
                    'bucket': call_args.bucket,
                    'key': call_args.key,
                    'extra_args': call_args.extra_args,
                },
                is_final=True,
            ),
        )


class DeleteObjectTask(Task):
    def _main(self, client, bucket, key, extra_args):
        """

        :param client: The S3 client to use when calling DeleteObject

        :type bucket: str
        :param bucket: The name of the bucket.

        :type key: str
        :param key: The name of the object to delete.

        :type extra_args: dict
        :param extra_args: Extra arguments to pass to the DeleteObject call.

        """
        client.delete_object(Bucket=bucket, Key=key, **extra_args)
