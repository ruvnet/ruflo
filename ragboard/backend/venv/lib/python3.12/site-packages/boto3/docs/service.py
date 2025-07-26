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

from botocore.docs.bcdoc.restdoc import DocumentStructure
from botocore.docs.service import ServiceDocumenter as BaseServiceDocumenter
from botocore.exceptions import DataNotFoundError

import boto3
from boto3.docs.client import Boto3ClientDocumenter
from boto3.docs.resource import ResourceDocumenter, ServiceResourceDocumenter
from boto3.utils import ServiceContext


class ServiceDocumenter(BaseServiceDocumenter):
    # The path used to find examples
    EXAMPLE_PATH = os.path.join(os.path.dirname(boto3.__file__), 'examples')

    def __init__(self, service_name, session, root_docs_path):
        super().__init__(
            service_name=service_name,
            # I know that this is an internal attribute, but the botocore session
            # is needed to load the paginator and waiter models.
            session=session._session,
            root_docs_path=root_docs_path,
        )
        self._boto3_session = session
        self._client = self._boto3_session.client(service_name)
        self._service_resource = None
        if self._service_name in self._boto3_session.get_available_resources():
            self._service_resource = self._boto3_session.resource(service_name)
        self.sections = [
            'title',
            'client',
            'paginators',
            'waiters',
            'resources',
            'examples',
            'context-params',
        ]
        self._root_docs_path = root_docs_path
        self._USER_GUIDE_LINK = (
            'https://boto3.amazonaws.com/'
            'v1/documentation/api/latest/guide/resources.html'
        )

    def document_service(self):
        """Documents an entire service.

        :returns: The reStructured text of the documented service.
        """
        doc_structure = DocumentStructure(
            self._service_name, section_names=self.sections, target='html'
        )
        self.title(doc_structure.get_section('title'))

        self.client_api(doc_structure.get_section('client'))
        self.paginator_api(doc_structure.get_section('paginators'))
        self.waiter_api(doc_structure.get_section('waiters'))
        if self._service_resource:
            self.resource_section(doc_structure.get_section('resources'))
        self._document_examples(doc_structure.get_section('examples'))
        context_params_section = doc_structure.get_section('context-params')
        self.client_context_params(context_params_section)
        return doc_structure.flush_structure()

    def client_api(self, section):
        examples = None
        try:
            examples = self.get_examples(self._service_name)
        except DataNotFoundError:
            pass

        Boto3ClientDocumenter(
            self._client, self._root_docs_path, examples
        ).document_client(section)

    def resource_section(self, section):
        section.style.h2('Resources')
        section.style.new_line()
        section.write(
            'Resources are available in boto3 via the '
            '``resource`` method. For more detailed instructions '
            'and examples on the usage of resources, see the '
            'resources '
        )
        section.style.external_link(
            title='user guide',
            link=self._USER_GUIDE_LINK,
        )
        section.write('.')
        section.style.new_line()
        section.style.new_line()
        section.write('The available resources are:')
        section.style.new_line()
        section.style.toctree()
        self._document_service_resource(section)
        self._document_resources(section)

    def _document_service_resource(self, section):
        # Create a new DocumentStructure for each Service Resource and add contents.
        service_resource_doc = DocumentStructure(
            'service-resource', target='html'
        )
        breadcrumb_section = service_resource_doc.add_new_section('breadcrumb')
        breadcrumb_section.style.ref(
            self._client.__class__.__name__, f'../../{self._service_name}'
        )
        breadcrumb_section.write(' / Resource / ServiceResource')
        ServiceResourceDocumenter(
            self._service_resource, self._session, self._root_docs_path
        ).document_resource(service_resource_doc)
        # Write collections in individual/nested files.
        # Path: <root>/reference/services/<service>/<resource_name>/<collection_name>.rst
        resource_name = self._service_resource.meta.resource_model.name
        if resource_name == self._service_name:
            resource_name = 'service-resource'
        service_resource_dir_path = os.path.join(
            self._root_docs_path,
            f'{self._service_name}',
            f'{resource_name.lower()}',
        )
        service_resource_doc.write_to_file(service_resource_dir_path, 'index')
        section.style.tocitem(f'{self._service_name}/{resource_name}/index')

    def _document_resources(self, section):
        temp_identifier_value = 'foo'
        loader = self._session.get_component('data_loader')
        json_resource_model = loader.load_service_model(
            self._service_name, 'resources-1'
        )
        service_model = self._service_resource.meta.client.meta.service_model
        for resource_name in json_resource_model['resources']:
            resource_model = json_resource_model['resources'][resource_name]
            resource_cls = (
                self._boto3_session.resource_factory.load_from_definition(
                    resource_name=resource_name,
                    single_resource_json_definition=resource_model,
                    service_context=ServiceContext(
                        service_name=self._service_name,
                        resource_json_definitions=json_resource_model[
                            'resources'
                        ],
                        service_model=service_model,
                        service_waiter_model=None,
                    ),
                )
            )
            identifiers = resource_cls.meta.resource_model.identifiers
            args = []
            for _ in identifiers:
                args.append(temp_identifier_value)
            resource = resource_cls(*args, client=self._client)
            # Create a new DocumentStructure for each Resource and add contents.
            resource_name = resource.meta.resource_model.name.lower()
            resource_doc = DocumentStructure(resource_name, target='html')
            breadcrumb_section = resource_doc.add_new_section('breadcrumb')
            breadcrumb_section.style.ref(
                self._client.__class__.__name__, f'../../{self._service_name}'
            )
            breadcrumb_section.write(
                f' / Resource / {resource.meta.resource_model.name}'
            )
            ResourceDocumenter(
                resource, self._session, self._root_docs_path
            ).document_resource(
                resource_doc.add_new_section(resource.meta.resource_model.name)
            )
            # Write collections in individual/nested files.
            # Path: <root>/reference/services/<service>/<resource_name>/<index>.rst
            service_resource_dir_path = os.path.join(
                self._root_docs_path,
                f'{self._service_name}',
                f'{resource_name}',
            )
            resource_doc.write_to_file(service_resource_dir_path, 'index')
            section.style.tocitem(
                f'{self._service_name}/{resource_name}/index'
            )

    def _get_example_file(self):
        return os.path.realpath(
            os.path.join(self.EXAMPLE_PATH, self._service_name + '.rst')
        )

    def _document_examples(self, section):
        examples_file = self._get_example_file()
        if os.path.isfile(examples_file):
            section.style.h2('Examples')
            section.style.new_line()
            with open(examples_file) as f:
                section.write(f.read())
