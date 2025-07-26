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
import os

from botocore import xform_name
from botocore.docs.bcdoc.restdoc import DocumentStructure
from botocore.docs.method import get_instance_public_methods
from botocore.docs.utils import DocumentedShape

from boto3.docs.base import NestedDocumenter
from boto3.docs.method import document_model_driven_resource_method
from boto3.docs.utils import (
    add_resource_type_overview,
    get_resource_ignore_params,
)


class CollectionDocumenter(NestedDocumenter):
    def document_collections(self, section):
        collections = self._resource.meta.resource_model.collections
        collections_list = []
        add_resource_type_overview(
            section=section,
            resource_type='Collections',
            description=(
                'Collections provide an interface to iterate over and '
                'manipulate groups of resources. '
            ),
            intro_link='guide_collections',
        )
        self.member_map['collections'] = collections_list
        for collection in collections:
            collections_list.append(collection.name)
            # Create a new DocumentStructure for each collection and add contents.
            collection_doc = DocumentStructure(collection.name, target='html')
            breadcrumb_section = collection_doc.add_new_section('breadcrumb')
            breadcrumb_section.style.ref(self._resource_class_name, 'index')
            breadcrumb_section.write(f' / Collection / {collection.name}')
            collection_doc.add_title_section(collection.name)
            collection_section = collection_doc.add_new_section(
                collection.name,
                context={'qualifier': f'{self.class_name}.'},
            )
            self._document_collection(collection_section, collection)

            # Write collections in individual/nested files.
            # Path: <root>/reference/services/<service>/<resource_name>/<collection_name>.rst
            collections_dir_path = os.path.join(
                self._root_docs_path,
                f'{self._service_name}',
                f'{self._resource_sub_path}',
            )
            collection_doc.write_to_file(collections_dir_path, collection.name)

    def _document_collection(self, section, collection):
        methods = get_instance_public_methods(
            getattr(self._resource, collection.name)
        )
        document_collection_object(section, collection)
        batch_actions = {}
        for batch_action in collection.batch_actions:
            batch_actions[batch_action.name] = batch_action

        for method in sorted(methods):
            method_section = section.add_new_section(method)
            if method in batch_actions:
                document_batch_action(
                    section=method_section,
                    resource_name=self._resource_name,
                    event_emitter=self._resource.meta.client.meta.events,
                    batch_action_model=batch_actions[method],
                    collection_model=collection,
                    service_model=self._resource.meta.client.meta.service_model,
                )
            else:
                document_collection_method(
                    section=method_section,
                    resource_name=self._resource_name,
                    action_name=method,
                    event_emitter=self._resource.meta.client.meta.events,
                    collection_model=collection,
                    service_model=self._resource.meta.client.meta.service_model,
                )


def document_collection_object(
    section,
    collection_model,
    include_signature=True,
):
    """Documents a collection resource object

    :param section: The section to write to

    :param collection_model: The model of the collection

    :param include_signature: Whether or not to include the signature.
        It is useful for generating docstrings.
    """
    if include_signature:
        full_collection_name = (
            f"{section.context.get('qualifier', '')}{collection_model.name}"
        )
        section.style.start_sphinx_py_attr(full_collection_name)
    section.include_doc_string(
        f'A collection of {collection_model.resource.type} resources.'
    )
    section.include_doc_string(
        f'A {collection_model.resource.type} Collection will include all '
        f'resources by default, and extreme caution should be taken when '
        f'performing actions on all resources.'
    )


def document_batch_action(
    section,
    resource_name,
    event_emitter,
    batch_action_model,
    service_model,
    collection_model,
    include_signature=True,
):
    """Documents a collection's batch action

    :param section: The section to write to

    :param resource_name: The name of the resource

    :param action_name: The name of collection action. Currently only
        can be all, filter, limit, or page_size

    :param event_emitter: The event emitter to use to emit events

    :param batch_action_model: The model of the batch action

    :param collection_model: The model of the collection

    :param service_model: The model of the service

    :param include_signature: Whether or not to include the signature.
        It is useful for generating docstrings.
    """
    operation_model = service_model.operation_model(
        batch_action_model.request.operation
    )
    ignore_params = get_resource_ignore_params(
        batch_action_model.request.params
    )

    example_return_value = 'response'
    if batch_action_model.resource:
        example_return_value = xform_name(batch_action_model.resource.type)

    example_resource_name = xform_name(resource_name)
    if service_model.service_name == resource_name:
        example_resource_name = resource_name
    example_prefix = '{} = {}.{}.{}'.format(
        example_return_value,
        example_resource_name,
        collection_model.name,
        batch_action_model.name,
    )
    document_model_driven_resource_method(
        section=section,
        method_name=batch_action_model.name,
        operation_model=operation_model,
        event_emitter=event_emitter,
        method_description=operation_model.documentation,
        example_prefix=example_prefix,
        exclude_input=ignore_params,
        resource_action_model=batch_action_model,
        include_signature=include_signature,
    )


def document_collection_method(
    section,
    resource_name,
    action_name,
    event_emitter,
    collection_model,
    service_model,
    include_signature=True,
):
    """Documents a collection method

    :param section: The section to write to

    :param resource_name: The name of the resource

    :param action_name: The name of collection action. Currently only
        can be all, filter, limit, or page_size

    :param event_emitter: The event emitter to use to emit events

    :param collection_model: The model of the collection

    :param service_model: The model of the service

    :param include_signature: Whether or not to include the signature.
        It is useful for generating docstrings.
    """
    operation_model = service_model.operation_model(
        collection_model.request.operation
    )

    underlying_operation_members = []
    if operation_model.input_shape:
        underlying_operation_members = operation_model.input_shape.members

    example_resource_name = xform_name(resource_name)
    if service_model.service_name == resource_name:
        example_resource_name = resource_name

    custom_action_info_dict = {
        'all': {
            'method_description': (
                f'Creates an iterable of all {collection_model.resource.type} '
                f'resources in the collection.'
            ),
            'example_prefix': '{}_iterator = {}.{}.all'.format(
                xform_name(collection_model.resource.type),
                example_resource_name,
                collection_model.name,
            ),
            'exclude_input': underlying_operation_members,
        },
        'filter': {
            'method_description': (
                f'Creates an iterable of all {collection_model.resource.type} '
                f'resources in the collection filtered by kwargs passed to '
                f'method. A {collection_model.resource.type} collection will '
                f'include all resources by default if no filters are provided, '
                f'and extreme caution should be taken when performing actions '
                f'on all resources.'
            ),
            'example_prefix': '{}_iterator = {}.{}.filter'.format(
                xform_name(collection_model.resource.type),
                example_resource_name,
                collection_model.name,
            ),
            'exclude_input': get_resource_ignore_params(
                collection_model.request.params
            ),
        },
        'limit': {
            'method_description': (
                f'Creates an iterable up to a specified amount of '
                f'{collection_model.resource.type} resources in the collection.'
            ),
            'example_prefix': '{}_iterator = {}.{}.limit'.format(
                xform_name(collection_model.resource.type),
                example_resource_name,
                collection_model.name,
            ),
            'include_input': [
                DocumentedShape(
                    name='count',
                    type_name='integer',
                    documentation=(
                        'The limit to the number of resources '
                        'in the iterable.'
                    ),
                )
            ],
            'exclude_input': underlying_operation_members,
        },
        'page_size': {
            'method_description': (
                f'Creates an iterable of all {collection_model.resource.type} '
                f'resources in the collection, but limits the number of '
                f'items returned by each service call by the specified amount.'
            ),
            'example_prefix': '{}_iterator = {}.{}.page_size'.format(
                xform_name(collection_model.resource.type),
                example_resource_name,
                collection_model.name,
            ),
            'include_input': [
                DocumentedShape(
                    name='count',
                    type_name='integer',
                    documentation=(
                        'The number of items returned by each ' 'service call'
                    ),
                )
            ],
            'exclude_input': underlying_operation_members,
        },
    }
    if action_name in custom_action_info_dict:
        action_info = custom_action_info_dict[action_name]
        document_model_driven_resource_method(
            section=section,
            method_name=action_name,
            operation_model=operation_model,
            event_emitter=event_emitter,
            resource_action_model=collection_model,
            include_signature=include_signature,
            **action_info,
        )
