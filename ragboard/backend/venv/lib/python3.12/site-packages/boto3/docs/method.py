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
from botocore.docs.method import document_model_driven_method


def document_model_driven_resource_method(
    section,
    method_name,
    operation_model,
    event_emitter,
    method_description=None,
    example_prefix=None,
    include_input=None,
    include_output=None,
    exclude_input=None,
    exclude_output=None,
    document_output=True,
    resource_action_model=None,
    include_signature=True,
):
    document_model_driven_method(
        section=section,
        method_name=method_name,
        operation_model=operation_model,
        event_emitter=event_emitter,
        method_description=method_description,
        example_prefix=example_prefix,
        include_input=include_input,
        include_output=include_output,
        exclude_input=exclude_input,
        exclude_output=exclude_output,
        document_output=document_output,
        include_signature=include_signature,
    )

    # If this action returns a resource modify the return example to
    # appropriately reflect that.
    if resource_action_model.resource:
        if 'return' in section.available_sections:
            section.delete_section('return')
        resource_type = resource_action_model.resource.type

        new_return_section = section.add_new_section('return')
        return_resource_type = '{}.{}'.format(
            operation_model.service_model.service_name, resource_type
        )

        return_type = f':py:class:`{return_resource_type}`'
        return_description = f'{resource_type} resource'

        if _method_returns_resource_list(resource_action_model.resource):
            return_type = f'list({return_type})'
            return_description = f'A list of {resource_type} resources'

        new_return_section.style.new_line()
        new_return_section.write(f':rtype: {return_type}')
        new_return_section.style.new_line()
        new_return_section.write(f':returns: {return_description}')
        new_return_section.style.new_line()


def _method_returns_resource_list(resource):
    for identifier in resource.identifiers:
        if identifier.path and '[]' in identifier.path:
            return True

    return False
