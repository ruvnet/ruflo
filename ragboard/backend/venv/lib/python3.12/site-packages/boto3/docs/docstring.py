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
from botocore.docs.docstring import LazyLoadedDocstring

from boto3.docs.action import document_action, document_load_reload_action
from boto3.docs.attr import (
    document_attribute,
    document_identifier,
    document_reference,
)
from boto3.docs.collection import (
    document_batch_action,
    document_collection_method,
    document_collection_object,
)
from boto3.docs.subresource import document_sub_resource
from boto3.docs.waiter import document_resource_waiter


class ActionDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_action(*args, **kwargs)


class LoadReloadDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_load_reload_action(*args, **kwargs)


class SubResourceDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_sub_resource(*args, **kwargs)


class AttributeDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_attribute(*args, **kwargs)


class IdentifierDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_identifier(*args, **kwargs)


class ReferenceDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_reference(*args, **kwargs)


class CollectionDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_collection_object(*args, **kwargs)


class CollectionMethodDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_collection_method(*args, **kwargs)


class BatchActionDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_batch_action(*args, **kwargs)


class ResourceWaiterDocstring(LazyLoadedDocstring):
    def _write_docstring(self, *args, **kwargs):
        document_resource_waiter(*args, **kwargs)
