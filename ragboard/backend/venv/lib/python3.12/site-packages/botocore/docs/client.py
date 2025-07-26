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
from botocore.docs.example import ResponseExampleDocumenter
from botocore.docs.method import (
    document_custom_method,
    document_model_driven_method,
    get_instance_public_methods,
)
from botocore.docs.params import ResponseParamsDocumenter
from botocore.docs.sharedexample import document_shared_examples
from botocore.docs.utils import DocumentedShape, get_official_service_name


def _allowlist_generate_presigned_url(method_name, service_name, **kwargs):
    if method_name != 'generate_presigned_url':
        return None
    return service_name in ['s3']


class ClientDocumenter:
    _CLIENT_METHODS_FILTERS = [
        _allowlist_generate_presigned_url,
    ]

    def __init__(self, client, root_docs_path, shared_examples=None):
        self._client = client
        self._client_class_name = self._client.__class__.__name__
        self._root_docs_path = root_docs_path
        self._shared_examples = shared_examples
        if self._shared_examples is None:
            self._shared_examples = {}
        self._service_name = self._client.meta.service_model.service_name

    def document_client(self, section):
        """Documents a client and its methods

        :param section: The section to write to.
        """
        self._add_title(section)
        self._add_class_signature(section)
        client_methods = self._get_client_methods()
        self._add_client_intro(section, client_methods)
        self._add_client_methods(client_methods)

    def _get_client_methods(self):
        client_methods = get_instance_public_methods(self._client)
        return self._filter_client_methods(client_methods)

    def _filter_client_methods(self, client_methods):
        filtered_methods = {}
        for method_name, method in client_methods.items():
            include = self._filter_client_method(
                method=method,
                method_name=method_name,
                service_name=self._service_name,
            )
            if include:
                filtered_methods[method_name] = method
        return filtered_methods

    def _filter_client_method(self, **kwargs):
        # Apply each filter to the method
        for filter in self._CLIENT_METHODS_FILTERS:
            filter_include = filter(**kwargs)
            # Use the first non-None value returned by any of the filters
            if filter_include is not None:
                return filter_include
        # Otherwise default to including it
        return True

    def _add_title(self, section):
        section.style.h2('Client')

    def _add_client_intro(self, section, client_methods):
        section = section.add_new_section('intro')
        # Write out the top level description for the client.
        official_service_name = get_official_service_name(
            self._client.meta.service_model
        )
        section.write(
            f"A low-level client representing {official_service_name}"
        )
        section.style.new_line()
        section.include_doc_string(
            self._client.meta.service_model.documentation
        )

        # Write out the client example instantiation.
        self._add_client_creation_example(section)

        # List out all of the possible client methods.
        section.style.dedent()
        section.style.new_paragraph()
        section.writeln('These are the available methods:')
        section.style.toctree()
        for method_name in sorted(client_methods):
            section.style.tocitem(f'{self._service_name}/client/{method_name}')

    def _add_class_signature(self, section):
        section.style.start_sphinx_py_class(
            class_name=f'{self._client_class_name}.Client'
        )

    def _add_client_creation_example(self, section):
        section.style.start_codeblock()
        section.style.new_line()
        section.write(
            f'client = session.create_client(\'{self._service_name}\')'
        )
        section.style.end_codeblock()

    def _add_client_methods(self, client_methods):
        for method_name in sorted(client_methods):
            # Create a new DocumentStructure for each client method and add contents.
            method_doc_structure = DocumentStructure(
                method_name, target='html'
            )
            self._add_client_method(
                method_doc_structure, method_name, client_methods[method_name]
            )
            # Write client methods in individual/nested files.
            # Path: <root>/reference/services/<service>/client/<method_name>.rst
            client_dir_path = os.path.join(
                self._root_docs_path, self._service_name, 'client'
            )
            method_doc_structure.write_to_file(client_dir_path, method_name)

    def _add_client_method(self, section, method_name, method):
        breadcrumb_section = section.add_new_section('breadcrumb')
        breadcrumb_section.style.ref(
            self._client_class_name, f'../../{self._service_name}'
        )
        breadcrumb_section.write(f' / Client / {method_name}')
        section.add_title_section(method_name)
        method_section = section.add_new_section(
            method_name,
            context={'qualifier': f'{self._client_class_name}.Client.'},
        )
        if self._is_custom_method(method_name):
            self._add_custom_method(
                method_section,
                method_name,
                method,
            )
        else:
            self._add_model_driven_method(method_section, method_name)

    def _is_custom_method(self, method_name):
        return method_name not in self._client.meta.method_to_api_mapping

    def _add_custom_method(self, section, method_name, method):
        document_custom_method(section, method_name, method)

    def _add_method_exceptions_list(self, section, operation_model):
        error_section = section.add_new_section('exceptions')
        error_section.style.new_line()
        error_section.style.bold('Exceptions')
        error_section.style.new_line()
        for error in operation_model.error_shapes:
            class_name = (
                f'{self._client_class_name}.Client.exceptions.{error.name}'
            )
            error_section.style.li(f':py:class:`{class_name}`')

    def _add_model_driven_method(self, section, method_name):
        service_model = self._client.meta.service_model
        operation_name = self._client.meta.method_to_api_mapping[method_name]
        operation_model = service_model.operation_model(operation_name)

        example_prefix = f'response = client.{method_name}'
        full_method_name = (
            f"{section.context.get('qualifier', '')}{method_name}"
        )
        document_model_driven_method(
            section,
            full_method_name,
            operation_model,
            event_emitter=self._client.meta.events,
            method_description=operation_model.documentation,
            example_prefix=example_prefix,
        )

        # Add any modeled exceptions
        if operation_model.error_shapes:
            self._add_method_exceptions_list(section, operation_model)

        # Add the shared examples
        shared_examples = self._shared_examples.get(operation_name)
        if shared_examples:
            document_shared_examples(
                section, operation_model, example_prefix, shared_examples
            )


class ClientExceptionsDocumenter:
    _USER_GUIDE_LINK = (
        'https://boto3.amazonaws.com/'
        'v1/documentation/api/latest/guide/error-handling.html'
    )
    _GENERIC_ERROR_SHAPE = DocumentedShape(
        name='Error',
        type_name='structure',
        documentation=('Normalized access to common exception attributes.'),
        members=OrderedDict(
            [
                (
                    'Code',
                    DocumentedShape(
                        name='Code',
                        type_name='string',
                        documentation=(
                            'An identifier specifying the exception type.'
                        ),
                    ),
                ),
                (
                    'Message',
                    DocumentedShape(
                        name='Message',
                        type_name='string',
                        documentation=(
                            'A descriptive message explaining why the exception '
                            'occured.'
                        ),
                    ),
                ),
            ]
        ),
    )

    def __init__(self, client, root_docs_path):
        self._client = client
        self._client_class_name = self._client.__class__.__name__
        self._service_name = self._client.meta.service_model.service_name
        self._root_docs_path = root_docs_path

    def document_exceptions(self, section):
        self._add_title(section)
        self._add_overview(section)
        self._add_exceptions_list(section)
        self._add_exception_classes()

    def _add_title(self, section):
        section.style.h2('Client Exceptions')

    def _add_overview(self, section):
        section.style.new_line()
        section.write(
            'Client exceptions are available on a client instance '
            'via the ``exceptions`` property. For more detailed instructions '
            'and examples on the exact usage of client exceptions, see the '
            'error handling '
        )
        section.style.external_link(
            title='user guide',
            link=self._USER_GUIDE_LINK,
        )
        section.write('.')
        section.style.new_line()

    def _exception_class_name(self, shape):
        return f'{self._client_class_name}.Client.exceptions.{shape.name}'

    def _add_exceptions_list(self, section):
        error_shapes = self._client.meta.service_model.error_shapes
        if not error_shapes:
            section.style.new_line()
            section.write('This client has no modeled exception classes.')
            section.style.new_line()
            return
        section.style.new_line()
        section.writeln('The available client exceptions are:')
        section.style.toctree()
        for shape in error_shapes:
            section.style.tocitem(
                f'{self._service_name}/client/exceptions/{shape.name}'
            )

    def _add_exception_classes(self):
        for shape in self._client.meta.service_model.error_shapes:
            # Create a new DocumentStructure for each exception method and add contents.
            exception_doc_structure = DocumentStructure(
                shape.name, target='html'
            )
            self._add_exception_class(exception_doc_structure, shape)
            # Write exceptions in individual/nested files.
            # Path: <root>/reference/services/<service>/client/exceptions/<exception_name>.rst
            exception_dir_path = os.path.join(
                self._root_docs_path,
                self._service_name,
                'client',
                'exceptions',
            )
            exception_doc_structure.write_to_file(
                exception_dir_path, shape.name
            )

    def _add_exception_class(self, section, shape):
        breadcrumb_section = section.add_new_section('breadcrumb')
        breadcrumb_section.style.ref(
            self._client_class_name, f'../../../{self._service_name}'
        )
        breadcrumb_section.write(f' / Client / exceptions / {shape.name}')
        section.add_title_section(shape.name)
        class_section = section.add_new_section(shape.name)
        class_name = self._exception_class_name(shape)
        class_section.style.start_sphinx_py_class(class_name=class_name)
        self._add_top_level_documentation(class_section, shape)
        self._add_exception_catch_example(class_section, shape)
        self._add_response_attr(class_section, shape)
        class_section.style.end_sphinx_py_class()

    def _add_top_level_documentation(self, section, shape):
        if shape.documentation:
            section.style.new_line()
            section.include_doc_string(shape.documentation)
            section.style.new_line()

    def _add_exception_catch_example(self, section, shape):
        section.style.new_line()
        section.style.bold('Example')
        section.style.new_paragraph()
        section.style.start_codeblock()
        section.write('try:')
        section.style.indent()
        section.style.new_line()
        section.write('...')
        section.style.dedent()
        section.style.new_line()
        section.write(f'except client.exceptions.{shape.name} as e:')
        section.style.indent()
        section.style.new_line()
        section.write('print(e.response)')
        section.style.dedent()
        section.style.end_codeblock()

    def _add_response_attr(self, section, shape):
        response_section = section.add_new_section('response')
        response_section.style.start_sphinx_py_attr('response')
        self._add_response_attr_description(response_section)
        self._add_response_example(response_section, shape)
        self._add_response_params(response_section, shape)
        response_section.style.end_sphinx_py_attr()

    def _add_response_attr_description(self, section):
        section.style.new_line()
        section.include_doc_string(
            'The parsed error response. All exceptions have a top level '
            '``Error`` key that provides normalized access to common '
            'exception atrributes. All other keys are specific to this '
            'service or exception class.'
        )
        section.style.new_line()

    def _add_response_example(self, section, shape):
        example_section = section.add_new_section('syntax')
        example_section.style.new_line()
        example_section.style.bold('Syntax')
        example_section.style.new_paragraph()
        documenter = ResponseExampleDocumenter(
            service_name=self._service_name,
            operation_name=None,
            event_emitter=self._client.meta.events,
        )
        documenter.document_example(
            example_section,
            shape,
            include=[self._GENERIC_ERROR_SHAPE],
        )

    def _add_response_params(self, section, shape):
        params_section = section.add_new_section('Structure')
        params_section.style.new_line()
        params_section.style.bold('Structure')
        params_section.style.new_paragraph()
        documenter = ResponseParamsDocumenter(
            service_name=self._service_name,
            operation_name=None,
            event_emitter=self._client.meta.events,
        )
        documenter.document_params(
            params_section,
            shape,
            include=[self._GENERIC_ERROR_SHAPE],
        )


class ClientContextParamsDocumenter:
    _CONFIG_GUIDE_LINK = (
        'https://boto3.amazonaws.com/'
        'v1/documentation/api/latest/guide/configuration.html'
    )

    OMITTED_CONTEXT_PARAMS = {
        's3': (
            'Accelerate',
            'DisableMultiRegionAccessPoints',
            'ForcePathStyle',
            'UseArnRegion',
        ),
        's3control': ('UseArnRegion',),
    }

    def __init__(self, service_name, context_params):
        self._service_name = service_name
        self._context_params = context_params

    def document_context_params(self, section):
        self._add_title(section)
        self._add_overview(section)
        self._add_context_params_list(section)

    def _add_title(self, section):
        section.style.h2('Client Context Parameters')

    def _add_overview(self, section):
        section.style.new_line()
        section.write(
            'Client context parameters are configurable on a client '
            'instance via the ``client_context_params`` parameter in the '
            '``Config`` object. For more detailed instructions and examples '
            'on the exact usage of context params see the '
        )
        section.style.external_link(
            title='configuration guide',
            link=self._CONFIG_GUIDE_LINK,
        )
        section.write('.')
        section.style.new_line()

    def _add_context_params_list(self, section):
        section.style.new_line()
        sn = f'``{self._service_name}``'
        section.writeln(f'The available {sn} client context params are:')
        for param in self._context_params:
            section.style.new_line()
            name = f'``{xform_name(param.name)}``'
            section.write(f'* {name} ({param.type}) - {param.documentation}')
