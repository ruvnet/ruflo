# Copyright 2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
from botocore.docs.client import ClientDocumenter


class Boto3ClientDocumenter(ClientDocumenter):
    def _add_client_creation_example(self, section):
        section.style.start_codeblock()
        section.style.new_line()
        section.write('import boto3')
        section.style.new_line()
        section.style.new_line()
        section.write(
            'client = boto3.client(\'{service}\')'.format(
                service=self._service_name
            )
        )
        section.style.end_codeblock()
