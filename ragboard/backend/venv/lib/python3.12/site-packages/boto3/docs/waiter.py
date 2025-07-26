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
from botocore.docs.method import document_model_driven_method
from botocore.utils import get_service_module_name

from boto3.docs.base import NestedDocumenter
from boto3.docs.utils import (
    add_resource_type_overview,
    get_resource_ignore_params,
)


class WaiterResourceDocumenter(NestedDocumenter):
    def __init__(self, resource, service_waiter_model, root_docs_path):
        super().__init__(resource, root_docs_path)
        self._service_waiter_model = service_waiter_model

    def document_resource_waiters(self, section):
        waiters = self._resource.meta.resource_model.waiters
        add_resource_type_overview(
            section=section,
            resource_type='Waiters',
            description=(
                'Waiters provide an interface to wait for a resource'
                ' to reach a specific state.'
            ),
            intro_link='waiters_intro',
        )
        waiter_list = []
        self.member_map['waiters'] = waiter_list
        for waiter in waiters:
            waiter_list.append(waiter.name)
            # Create a new DocumentStructure for each waiter and add contents.
            waiter_doc = DocumentStructure(waiter.name, target='html')
            breadcrumb_section = waiter_doc.add_new_section('breadcrumb')
            breadcrumb_section.style.ref(self._resource_class_name, 'index')
            breadcrumb_section.write(f' / Waiter / {waiter.name}')
            waiter_doc.add_title_section(waiter.name)
            waiter_section = waiter_doc.add_new_section(
                waiter.name,
                context={'qualifier': f'{self.class_name}.'},
            )
            document_resource_waiter(
                section=waiter_section,
                resource_name=self._resource_name,
                event_emitter=self._resource.meta.client.meta.events,
                service_model=self._service_model,
                resource_waiter_model=waiter,
                service_waiter_model=self._service_waiter_model,
            )
            # Write waiters in individual/nested files.
            # Path: <root>/reference/services/<service>/<resource_name>/<waiter_name>.rst
            waiters_dir_path = os.path.join(
                self._root_docs_path,
                f'{self._service_name}',
                f'{self._resource_sub_path}',
            )
            waiter_doc.write_to_file(waiters_dir_path, waiter.name)


def document_resource_waiter(
    section,
    resource_name,
    event_emitter,
    service_model,
    resource_waiter_model,
    service_waiter_model,
    include_signature=True,
):
    waiter_model = service_waiter_model.get_waiter(
        resource_waiter_model.waiter_name
    )
    operation_model = service_model.operation_model(waiter_model.operation)

    ignore_params = get_resource_ignore_params(resource_waiter_model.params)
    service_module_name = get_service_module_name(service_model)
    description = (
        'Waits until this {} is {}. This method calls '
        ':py:meth:`{}.Waiter.{}.wait` which polls '
        ':py:meth:`{}.Client.{}` every {} seconds until '
        'a successful state is reached. An error is returned '
        'after {} failed checks.'.format(
            resource_name,
            ' '.join(resource_waiter_model.name.split('_')[2:]),
            service_module_name,
            xform_name(resource_waiter_model.waiter_name),
            service_module_name,
            xform_name(waiter_model.operation),
            waiter_model.delay,
            waiter_model.max_attempts,
        )
    )
    example_prefix = '{}.{}'.format(
        xform_name(resource_name), resource_waiter_model.name
    )
    full_waiter_name = (
        f"{section.context.get('qualifier', '')}{resource_waiter_model.name}"
    )
    document_model_driven_method(
        section=section,
        method_name=full_waiter_name,
        operation_model=operation_model,
        event_emitter=event_emitter,
        example_prefix=example_prefix,
        method_description=description,
        exclude_input=ignore_params,
        include_signature=include_signature,
    )
    if 'return' in section.available_sections:
        # Waiters do not return anything so we should remove
        # any sections that may document the underlying return
        # value of the client method.
        return_section = section.get_section('return')
        return_section.clear_text()
        return_section.remove_all_sections()
        return_section.write(':returns: None')
