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
from botocore.docs.utils import get_official_service_name

from boto3.docs.action import ActionDocumenter
from boto3.docs.attr import (
    document_attribute,
    document_identifier,
    document_reference,
)
from boto3.docs.base import BaseDocumenter
from boto3.docs.collection import CollectionDocumenter
from boto3.docs.subresource import SubResourceDocumenter
from boto3.docs.utils import (
    add_resource_type_overview,
    get_identifier_args_for_signature,
    get_identifier_description,
    get_identifier_values_for_example,
)
from boto3.docs.waiter import WaiterResourceDocumenter


class ResourceDocumenter(BaseDocumenter):
    def __init__(self, resource, botocore_session, root_docs_path):
        super().__init__(resource)
        self._botocore_session = botocore_session
        self._root_docs_path = root_docs_path
        self._resource_sub_path = self._resource_name.lower()
        if self._resource_name == self._service_name:
            self._resource_sub_path = 'service-resource'

    def document_resource(self, section):
        self._add_title(section)
        self._add_resource_note(section)
        self._add_intro(section)
        self._add_identifiers(section)
        self._add_attributes(section)
        self._add_references(section)
        self._add_actions(section)
        self._add_sub_resources(section)
        self._add_collections(section)
        self._add_waiters(section)

    def _add_title(self, section):
        title_section = section.add_new_section('title')
        title_section.style.h2(self._resource_name)

    def _add_intro(self, section):
        identifier_names = []
        if self._resource_model.identifiers:
            for identifier in self._resource_model.identifiers:
                identifier_names.append(identifier.name)

        # Write out the class signature.
        class_args = get_identifier_args_for_signature(identifier_names)
        start_class = section.add_new_section('start_class')
        start_class.style.start_sphinx_py_class(
            class_name=f'{self.class_name}({class_args})'
        )

        # Add as short description about the resource
        description_section = start_class.add_new_section('description')
        self._add_description(description_section)

        # Add an example of how to instantiate the resource
        example_section = start_class.add_new_section('example')
        self._add_example(example_section, identifier_names)

        # Add the description for the parameters to instantiate the
        # resource.
        param_section = start_class.add_new_section('params')
        self._add_params_description(param_section, identifier_names)

        end_class = section.add_new_section('end_class')
        end_class.style.end_sphinx_py_class()

    def _add_description(self, section):
        official_service_name = get_official_service_name(self._service_model)
        section.write(
            'A resource representing an {} {}'.format(
                official_service_name, self._resource_name
            )
        )

    def _add_example(self, section, identifier_names):
        section.style.start_codeblock()
        section.style.new_line()
        section.write('import boto3')
        section.style.new_line()
        section.style.new_line()
        section.write(
            '{} = boto3.resource(\'{}\')'.format(
                self._service_name, self._service_name
            )
        )
        section.style.new_line()
        example_values = get_identifier_values_for_example(identifier_names)
        section.write(
            '{} = {}.{}({})'.format(
                xform_name(self._resource_name),
                self._service_name,
                self._resource_name,
                example_values,
            )
        )
        section.style.end_codeblock()

    def _add_params_description(self, section, identifier_names):
        for identifier_name in identifier_names:
            description = get_identifier_description(
                self._resource_name, identifier_name
            )
            section.write(f':type {identifier_name}: string')
            section.style.new_line()
            section.write(f':param {identifier_name}: {description}')
            section.style.new_line()

    def _add_overview_of_member_type(self, section, resource_member_type):
        section.style.new_line()
        section.write(
            f'These are the resource\'s available {resource_member_type}:'
        )
        section.style.new_line()
        section.style.toctree()
        for member in self.member_map[resource_member_type]:
            section.style.tocitem(f'{member}')

    def _add_identifiers(self, section):
        identifiers = self._resource.meta.resource_model.identifiers
        section = section.add_new_section('identifiers')
        member_list = []
        if identifiers:
            self.member_map['identifiers'] = member_list
            add_resource_type_overview(
                section=section,
                resource_type='Identifiers',
                description=(
                    'Identifiers are properties of a resource that are '
                    'set upon instantiation of the resource.'
                ),
                intro_link='identifiers_attributes_intro',
            )
        for identifier in identifiers:
            member_list.append(identifier.name)
            # Create a new DocumentStructure for each identifier and add contents.
            identifier_doc = DocumentStructure(identifier.name, target='html')
            breadcrumb_section = identifier_doc.add_new_section('breadcrumb')
            breadcrumb_section.style.ref(self._resource_class_name, 'index')
            breadcrumb_section.write(f' / Identifier / {identifier.name}')
            identifier_doc.add_title_section(identifier.name)
            identifier_section = identifier_doc.add_new_section(
                identifier.name,
                context={'qualifier': f'{self.class_name}.'},
            )
            document_identifier(
                section=identifier_section,
                resource_name=self._resource_name,
                identifier_model=identifier,
            )
            # Write identifiers in individual/nested files.
            # Path: <root>/reference/services/<service>/<resource_name>/<identifier_name>.rst
            identifiers_dir_path = os.path.join(
                self._root_docs_path,
                f'{self._service_name}',
                f'{self._resource_sub_path}',
            )
            identifier_doc.write_to_file(identifiers_dir_path, identifier.name)

        if identifiers:
            self._add_overview_of_member_type(section, 'identifiers')

    def _add_attributes(self, section):
        service_model = self._resource.meta.client.meta.service_model
        attributes = {}
        if self._resource.meta.resource_model.shape:
            shape = service_model.shape_for(
                self._resource.meta.resource_model.shape
            )
            attributes = self._resource.meta.resource_model.get_attributes(
                shape
            )
        section = section.add_new_section('attributes')
        attribute_list = []
        if attributes:
            add_resource_type_overview(
                section=section,
                resource_type='Attributes',
                description=(
                    'Attributes provide access'
                    ' to the properties of a resource. Attributes are lazy-'
                    'loaded the first time one is accessed via the'
                    ' :py:meth:`load` method.'
                ),
                intro_link='identifiers_attributes_intro',
            )
            self.member_map['attributes'] = attribute_list
        for attr_name in sorted(attributes):
            _, attr_shape = attributes[attr_name]
            attribute_list.append(attr_name)
            # Create a new DocumentStructure for each attribute and add contents.
            attribute_doc = DocumentStructure(attr_name, target='html')
            breadcrumb_section = attribute_doc.add_new_section('breadcrumb')
            breadcrumb_section.style.ref(self._resource_class_name, 'index')
            breadcrumb_section.write(f' / Attribute / {attr_name}')
            attribute_doc.add_title_section(attr_name)
            attribute_section = attribute_doc.add_new_section(
                attr_name,
                context={'qualifier': f'{self.class_name}.'},
            )
            document_attribute(
                section=attribute_section,
                service_name=self._service_name,
                resource_name=self._resource_name,
                attr_name=attr_name,
                event_emitter=self._resource.meta.client.meta.events,
                attr_model=attr_shape,
            )
            # Write attributes in individual/nested files.
            # Path: <root>/reference/services/<service>/<resource_name>/<attribute_name>.rst
            attributes_dir_path = os.path.join(
                self._root_docs_path,
                f'{self._service_name}',
                f'{self._resource_sub_path}',
            )
            attribute_doc.write_to_file(attributes_dir_path, attr_name)
        if attributes:
            self._add_overview_of_member_type(section, 'attributes')

    def _add_references(self, section):
        section = section.add_new_section('references')
        references = self._resource.meta.resource_model.references
        reference_list = []
        if references:
            add_resource_type_overview(
                section=section,
                resource_type='References',
                description=(
                    'References are related resource instances that have '
                    'a belongs-to relationship.'
                ),
                intro_link='references_intro',
            )
            self.member_map['references'] = reference_list
            self._add_overview_of_member_type(section, 'references')
        for reference in references:
            reference_list.append(reference.name)
            # Create a new DocumentStructure for each reference and add contents.
            reference_doc = DocumentStructure(reference.name, target='html')
            breadcrumb_section = reference_doc.add_new_section('breadcrumb')
            breadcrumb_section.style.ref(self._resource_class_name, 'index')
            breadcrumb_section.write(f' / Reference / {reference.name}')
            reference_doc.add_title_section(reference.name)
            reference_section = reference_doc.add_new_section(
                reference.name,
                context={'qualifier': f'{self.class_name}.'},
            )
            document_reference(
                section=reference_section,
                reference_model=reference,
            )
            # Write references in individual/nested files.
            # Path: <root>/reference/services/<service>/<resource_name>/<reference_name>.rst
            references_dir_path = os.path.join(
                self._root_docs_path,
                f'{self._service_name}',
                f'{self._resource_sub_path}',
            )
            reference_doc.write_to_file(references_dir_path, reference.name)
        if references:
            self._add_overview_of_member_type(section, 'references')

    def _add_actions(self, section):
        section = section.add_new_section('actions')
        actions = self._resource.meta.resource_model.actions
        if actions:
            documenter = ActionDocumenter(self._resource, self._root_docs_path)
            documenter.member_map = self.member_map
            documenter.document_actions(section)
            self._add_overview_of_member_type(section, 'actions')

    def _add_sub_resources(self, section):
        section = section.add_new_section('sub-resources')
        sub_resources = self._resource.meta.resource_model.subresources
        if sub_resources:
            documenter = SubResourceDocumenter(
                self._resource, self._root_docs_path
            )
            documenter.member_map = self.member_map
            documenter.document_sub_resources(section)
            self._add_overview_of_member_type(section, 'sub-resources')

    def _add_collections(self, section):
        section = section.add_new_section('collections')
        collections = self._resource.meta.resource_model.collections
        if collections:
            documenter = CollectionDocumenter(
                self._resource, self._root_docs_path
            )
            documenter.member_map = self.member_map
            documenter.document_collections(section)
            self._add_overview_of_member_type(section, 'collections')

    def _add_waiters(self, section):
        section = section.add_new_section('waiters')
        waiters = self._resource.meta.resource_model.waiters
        if waiters:
            service_waiter_model = self._botocore_session.get_waiter_model(
                self._service_name
            )
            documenter = WaiterResourceDocumenter(
                self._resource, service_waiter_model, self._root_docs_path
            )
            documenter.member_map = self.member_map
            documenter.document_resource_waiters(section)
            self._add_overview_of_member_type(section, 'waiters')

    def _add_resource_note(self, section):
        section = section.add_new_section('feature-freeze')
        section.style.start_note()
        section.write(
            "Before using anything on this page, please refer to the resources "
            ":doc:`user guide <../../../../guide/resources>` for the most recent "
            "guidance on using resources."
        )
        section.style.end_note()


class ServiceResourceDocumenter(ResourceDocumenter):
    @property
    def class_name(self):
        return f'{self._service_docs_name}.ServiceResource'

    def _add_title(self, section):
        title_section = section.add_new_section('title')
        title_section.style.h2('Service Resource')

    def _add_description(self, section):
        official_service_name = get_official_service_name(self._service_model)
        section.write(f'A resource representing {official_service_name}')

    def _add_example(self, section, identifier_names):
        section.style.start_codeblock()
        section.style.new_line()
        section.write('import boto3')
        section.style.new_line()
        section.style.new_line()
        section.write(
            f'{self._service_name} = boto3.resource(\'{self._service_name}\')'
        )
        section.style.end_codeblock()
