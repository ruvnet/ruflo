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
from botocore.utils import get_service_module_name

from boto3.docs.base import NestedDocumenter
from boto3.docs.utils import (
    add_resource_type_overview,
    get_identifier_args_for_signature,
    get_identifier_description,
    get_identifier_values_for_example,
)


class SubResourceDocumenter(NestedDocumenter):
    def document_sub_resources(self, section):
        add_resource_type_overview(
            section=section,
            resource_type='Sub-resources',
            description=(
                'Sub-resources are methods that create a new instance of a'
                ' child resource. This resource\'s identifiers get passed'
                ' along to the child.'
            ),
            intro_link='subresources_intro',
        )
        sub_resources = sorted(
            self._resource.meta.resource_model.subresources,
            key=lambda sub_resource: sub_resource.name,
        )
        sub_resources_list = []
        self.member_map['sub-resources'] = sub_resources_list
        for sub_resource in sub_resources:
            sub_resources_list.append(sub_resource.name)
            # Create a new DocumentStructure for each sub_resource and add contents.
            sub_resource_doc = DocumentStructure(
                sub_resource.name, target='html'
            )
            breadcrumb_section = sub_resource_doc.add_new_section('breadcrumb')
            breadcrumb_section.style.ref(self._resource_class_name, 'index')
            breadcrumb_section.write(f' / Sub-Resource / {sub_resource.name}')
            sub_resource_doc.add_title_section(sub_resource.name)
            sub_resource_section = sub_resource_doc.add_new_section(
                sub_resource.name,
                context={'qualifier': f'{self.class_name}.'},
            )
            document_sub_resource(
                section=sub_resource_section,
                resource_name=self._resource_name,
                sub_resource_model=sub_resource,
                service_model=self._service_model,
            )

            # Write sub_resources in individual/nested files.
            # Path: <root>/reference/services/<service>/<resource_name>/<sub_resource_name>.rst
            sub_resources_dir_path = os.path.join(
                self._root_docs_path,
                f'{self._service_name}',
                f'{self._resource_sub_path}',
            )
            sub_resource_doc.write_to_file(
                sub_resources_dir_path, sub_resource.name
            )


def document_sub_resource(
    section,
    resource_name,
    sub_resource_model,
    service_model,
    include_signature=True,
):
    """Documents a resource action

    :param section: The section to write to

    :param resource_name: The name of the resource

    :param sub_resource_model: The model of the subresource

    :param service_model: The model of the service

    :param include_signature: Whether or not to include the signature.
        It is useful for generating docstrings.
    """
    identifiers_needed = []
    for identifier in sub_resource_model.resource.identifiers:
        if identifier.source == 'input':
            identifiers_needed.append(xform_name(identifier.target))

    if include_signature:
        signature_args = get_identifier_args_for_signature(identifiers_needed)
        full_sub_resource_name = (
            f"{section.context.get('qualifier', '')}{sub_resource_model.name}"
        )
        section.style.start_sphinx_py_method(
            full_sub_resource_name, signature_args
        )

    method_intro_section = section.add_new_section('method-intro')
    description = f'Creates a {sub_resource_model.resource.type} resource.'
    method_intro_section.include_doc_string(description)
    example_section = section.add_new_section('example')
    example_values = get_identifier_values_for_example(identifiers_needed)
    example_resource_name = xform_name(resource_name)
    if service_model.service_name == resource_name:
        example_resource_name = resource_name
    example = '{} = {}.{}({})'.format(
        xform_name(sub_resource_model.resource.type),
        example_resource_name,
        sub_resource_model.name,
        example_values,
    )
    example_section.style.start_codeblock()
    example_section.write(example)
    example_section.style.end_codeblock()

    param_section = section.add_new_section('params')
    for identifier in identifiers_needed:
        description = get_identifier_description(
            sub_resource_model.name, identifier
        )
        param_section.write(f':type {identifier}: string')
        param_section.style.new_line()
        param_section.write(f':param {identifier}: {description}')
        param_section.style.new_line()

    return_section = section.add_new_section('return')
    return_section.style.new_line()
    return_section.write(
        ':rtype: :py:class:`{}.{}`'.format(
            get_service_module_name(service_model),
            sub_resource_model.resource.type,
        )
    )
    return_section.style.new_line()
    return_section.write(
        f':returns: A {sub_resource_model.resource.type} resource'
    )
    return_section.style.new_line()
