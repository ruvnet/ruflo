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
from botocore.compat import OrderedDict


class BaseDocumenter:
    def __init__(self, resource):
        self._resource = resource
        self._client = self._resource.meta.client
        self._resource_model = self._resource.meta.resource_model
        self._service_model = self._client.meta.service_model
        self._resource_name = self._resource.meta.resource_model.name
        self._service_name = self._service_model.service_name
        self._service_docs_name = self._client.__class__.__name__
        self.member_map = OrderedDict()
        self.represents_service_resource = (
            self._service_name == self._resource_name
        )
        self._resource_class_name = self._resource_name
        if self._resource_name == self._service_name:
            self._resource_class_name = 'ServiceResource'

    @property
    def class_name(self):
        return f'{self._service_docs_name}.{self._resource_name}'


class NestedDocumenter(BaseDocumenter):
    def __init__(self, resource, root_docs_path):
        super().__init__(resource)
        self._root_docs_path = root_docs_path
        self._resource_sub_path = self._resource_name.lower()
        if self._resource_name == self._service_name:
            self._resource_sub_path = 'service-resource'

    @property
    def class_name(self):
        resource_class_name = self._resource_name
        if self._resource_name == self._service_name:
            resource_class_name = 'ServiceResource'
        return f'{self._service_docs_name}.{resource_class_name}'
