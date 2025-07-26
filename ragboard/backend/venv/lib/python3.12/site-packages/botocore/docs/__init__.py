# Copyright 2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
import os

from botocore.docs.service import ServiceDocumenter

DEPRECATED_SERVICE_NAMES = {'sms-voice'}


def generate_docs(root_dir, session):
    """Generates the reference documentation for botocore

    This will go through every available AWS service and output ReSTructured
    text files documenting each service.

    :param root_dir: The directory to write the reference files to. Each
        service's reference documentation is loacated at
        root_dir/reference/services/service-name.rst
    """
    # Create the root directory where all service docs live.
    services_dir_path = os.path.join(root_dir, 'reference', 'services')
    if not os.path.exists(services_dir_path):
        os.makedirs(services_dir_path)

    # Prevents deprecated service names from being generated in docs.
    available_services = [
        service
        for service in session.get_available_services()
        if service not in DEPRECATED_SERVICE_NAMES
    ]

    # Generate reference docs and write them out.
    for service_name in available_services:
        docs = ServiceDocumenter(
            service_name, session, services_dir_path
        ).document_service()

        # Write the main service documentation page.
        # Path: <root>/reference/services/<service>/index.rst
        service_file_path = os.path.join(
            services_dir_path, f'{service_name}.rst'
        )
        with open(service_file_path, 'wb') as f:
            f.write(docs)
