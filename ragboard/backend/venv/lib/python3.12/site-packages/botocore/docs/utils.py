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
import re
from collections import namedtuple


def py_type_name(type_name):
    """Get the Python type name for a given model type.

        >>> py_type_name('list')
        'list'
        >>> py_type_name('structure')
        'dict'

    :rtype: string
    """
    return {
        'blob': 'bytes',
        'character': 'string',
        'double': 'float',
        'long': 'integer',
        'map': 'dict',
        'structure': 'dict',
        'timestamp': 'datetime',
    }.get(type_name, type_name)


def py_default(type_name):
    """Get the Python default value for a given model type.

        >>> py_default('string')
        '\'string\''
        >>> py_default('list')
        '[...]'
        >>> py_default('unknown')
        '...'

    :rtype: string
    """
    return {
        'double': '123.0',
        'long': '123',
        'integer': '123',
        'string': "'string'",
        'blob': "b'bytes'",
        'boolean': 'True|False',
        'list': '[...]',
        'map': '{...}',
        'structure': '{...}',
        'timestamp': 'datetime(2015, 1, 1)',
    }.get(type_name, '...')


def get_official_service_name(service_model):
    """Generate the official name of an AWS Service

    :param service_model: The service model representing the service
    """
    official_name = service_model.metadata.get('serviceFullName')
    short_name = service_model.metadata.get('serviceAbbreviation', '')
    if short_name.startswith('Amazon'):
        short_name = short_name[7:]
    if short_name.startswith('AWS'):
        short_name = short_name[4:]
    if short_name and short_name.lower() not in official_name.lower():
        official_name += f' ({short_name})'
    return official_name


_DocumentedShape = namedtuple(
    'DocumentedShape',
    [
        'name',
        'type_name',
        'documentation',
        'metadata',
        'members',
        'required_members',
    ],
)


class DocumentedShape(_DocumentedShape):
    """Use this class to inject new shapes into a model for documentation"""

    def __new__(
        cls,
        name,
        type_name,
        documentation,
        metadata=None,
        members=None,
        required_members=None,
    ):
        if metadata is None:
            metadata = []
        if members is None:
            members = []
        if required_members is None:
            required_members = []
        return super().__new__(
            cls,
            name,
            type_name,
            documentation,
            metadata,
            members,
            required_members,
        )


class AutoPopulatedParam:
    def __init__(self, name, param_description=None):
        self.name = name
        self.param_description = param_description
        if param_description is None:
            self.param_description = (
                'Please note that this parameter is automatically populated '
                'if it is not provided. Including this parameter is not '
                'required\n'
            )

    def document_auto_populated_param(self, event_name, section, **kwargs):
        """Documents auto populated parameters

        It will remove any required marks for the parameter, remove the
        parameter from the example, and add a snippet about the parameter
        being autopopulated in the description.
        """
        if event_name.startswith('docs.request-params'):
            if self.name in section.available_sections:
                section = section.get_section(self.name)
                if 'is-required' in section.available_sections:
                    section.delete_section('is-required')
                description_section = section.get_section(
                    'param-documentation'
                )
                description_section.writeln(self.param_description)
        elif event_name.startswith('docs.request-example'):
            section = section.get_section('structure-value')
            if self.name in section.available_sections:
                section.delete_section(self.name)


class HideParamFromOperations:
    """Hides a single parameter from multiple operations.

    This method will remove a parameter from documentation and from
    examples. This method is typically used for things that are
    automatically populated because a user would be unable to provide
    a value (e.g., a checksum of a serialized XML request body)."""

    def __init__(self, service_name, parameter_name, operation_names):
        """
        :type service_name: str
        :param service_name: Name of the service to modify.

        :type parameter_name: str
        :param parameter_name: Name of the parameter to modify.

        :type operation_names: list
        :param operation_names: Operation names to modify.
        """
        self._parameter_name = parameter_name
        self._params_events = set()
        self._example_events = set()
        # Build up the sets of relevant event names.
        param_template = 'docs.request-params.%s.%s.complete-section'
        example_template = 'docs.request-example.%s.%s.complete-section'
        for name in operation_names:
            self._params_events.add(param_template % (service_name, name))
            self._example_events.add(example_template % (service_name, name))

    def hide_param(self, event_name, section, **kwargs):
        if event_name in self._example_events:
            # Modify the structure value for example events.
            section = section.get_section('structure-value')
        elif event_name not in self._params_events:
            return
        if self._parameter_name in section.available_sections:
            section.delete_section(self._parameter_name)


class AppendParamDocumentation:
    """Appends documentation to a specific parameter"""

    def __init__(self, parameter_name, doc_string):
        self._parameter_name = parameter_name
        self._doc_string = doc_string

    def append_documentation(self, event_name, section, **kwargs):
        if self._parameter_name in section.available_sections:
            section = section.get_section(self._parameter_name)
            description_section = section.get_section('param-documentation')
            description_section.writeln(self._doc_string)


_CONTROLS = {
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\b': '\\b',
    '\f': '\\f',
}
# Combines all CONTROLS keys into a big or regular expression
_ESCAPE_CONTROLS_RE = re.compile('|'.join(map(re.escape, _CONTROLS)))


# Based on the match get the appropriate replacement from CONTROLS
def _CONTROLS_MATCH_HANDLER(match):
    return _CONTROLS[match.group(0)]


def escape_controls(value):
    return _ESCAPE_CONTROLS_RE.sub(_CONTROLS_MATCH_HANDLER, value)
