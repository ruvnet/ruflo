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

from botocore import xform_name
from botocore.compat import OrderedDict
from botocore.docs.bcdoc.restdoc import DocumentStructure
from botocore.docs.method import document_model_driven_method
from botocore.docs.utils import DocumentedShape
from botocore.utils import get_service_module_name


class WaiterDocumenter:
    def __init__(self, client, service_waiter_model, root_docs_path):
        self._client = client
        self._client_class_name = self._client.__class__.__name__
        self._service_name = self._client.meta.service_model.service_name
        self._service_waiter_model = service_waiter_model
        self._root_docs_path = root_docs_path
        self._USER_GUIDE_LINK = (
            'https://boto3.amazonaws.com/'
            'v1/documentation/api/latest/guide/clients.html#waiters'
        )

    def document_waiters(self, section):
        """Documents the various waiters for a service.

        :param section: The section to write to.
        """
        section.style.h2('Waiters')
        self._add_overview(section)
        section.style.new_line()
        section.writeln('The available waiters are:')
        section.style.toctree()
        for waiter_name in self._service_waiter_model.waiter_names:
            section.style.tocitem(f'{self._service_name}/waiter/{waiter_name}')
            # Create a new DocumentStructure for each waiter and add contents.
            waiter_doc_structure = DocumentStructure(
                waiter_name, target='html'
            )
            self._add_single_waiter(waiter_doc_structure, waiter_name)
            # Write waiters in individual/nested files.
            # Path: <root>/reference/services/<service>/waiter/<waiter_name>.rst
            waiter_dir_path = os.path.join(
                self._root_docs_path, self._service_name, 'waiter'
            )
            waiter_doc_structure.write_to_file(waiter_dir_path, waiter_name)

    def _add_single_waiter(self, section, waiter_name):
        breadcrumb_section = section.add_new_section('breadcrumb')
        breadcrumb_section.style.ref(
            self._client_class_name, f'../../{self._service_name}'
        )
        breadcrumb_section.write(f' / Waiter / {waiter_name}')
        section.add_title_section(waiter_name)
        waiter_section = section.add_new_section(waiter_name)
        waiter_section.style.start_sphinx_py_class(
            class_name=f"{self._client_class_name}.Waiter.{waiter_name}"
        )

        # Add example on how to instantiate waiter.
        waiter_section.style.start_codeblock()
        waiter_section.style.new_line()
        waiter_section.write(
            f'waiter = client.get_waiter(\'{xform_name(waiter_name)}\')'
        )
        waiter_section.style.end_codeblock()

        # Add information on the wait() method
        waiter_section.style.new_line()
        document_wait_method(
            section=waiter_section,
            waiter_name=waiter_name,
            event_emitter=self._client.meta.events,
            service_model=self._client.meta.service_model,
            service_waiter_model=self._service_waiter_model,
        )

    def _add_overview(self, section):
        section.style.new_line()
        section.write(
            'Waiters are available on a client instance '
            'via the ``get_waiter`` method. For more detailed instructions '
            'and examples on the usage or waiters, see the '
            'waiters '
        )
        section.style.external_link(
            title='user guide',
            link=self._USER_GUIDE_LINK,
        )
        section.write('.')
        section.style.new_line()


def document_wait_method(
    section,
    waiter_name,
    event_emitter,
    service_model,
    service_waiter_model,
    include_signature=True,
):
    """Documents a the wait method of a waiter

    :param section: The section to write to

    :param waiter_name: The name of the waiter

    :param event_emitter: The event emitter to use to emit events

    :param service_model: The service model

    :param service_waiter_model: The waiter model associated to the service

    :param include_signature: Whether or not to include the signature.
        It is useful for generating docstrings.
    """
    waiter_model = service_waiter_model.get_waiter(waiter_name)
    operation_model = service_model.operation_model(waiter_model.operation)

    waiter_config_members = OrderedDict()

    waiter_config_members['Delay'] = DocumentedShape(
        name='Delay',
        type_name='integer',
        documentation=(
            '<p>The amount of time in seconds to wait between '
            f'attempts. Default: {waiter_model.delay}</p>'
        ),
    )

    waiter_config_members['MaxAttempts'] = DocumentedShape(
        name='MaxAttempts',
        type_name='integer',
        documentation=(
            '<p>The maximum number of attempts to be made. '
            f'Default: {waiter_model.max_attempts}</p>'
        ),
    )

    botocore_waiter_params = [
        DocumentedShape(
            name='WaiterConfig',
            type_name='structure',
            documentation=(
                '<p>A dictionary that provides parameters to control '
                'waiting behavior.</p>'
            ),
            members=waiter_config_members,
        )
    ]

    wait_description = (
        f'Polls :py:meth:`{get_service_module_name(service_model)}.Client.'
        f'{xform_name(waiter_model.operation)}` every {waiter_model.delay} '
        'seconds until a successful state is reached. An error is '
        f'returned after {waiter_model.max_attempts} failed checks.'
    )

    document_model_driven_method(
        section,
        'wait',
        operation_model,
        event_emitter=event_emitter,
        method_description=wait_description,
        example_prefix='waiter.wait',
        include_input=botocore_waiter_params,
        document_output=False,
        include_signature=include_signature,
    )
