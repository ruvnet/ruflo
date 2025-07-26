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


# NOTE: This class should not be instantiated and its
# ``traverse_and_document_shape`` method called directly. It should be
# inherited from a Documenter class with the appropriate methods
# and attributes.
from botocore.utils import is_json_value_header


class ShapeDocumenter:
    EVENT_NAME = ''

    def __init__(
        self, service_name, operation_name, event_emitter, context=None
    ):
        self._service_name = service_name
        self._operation_name = operation_name
        self._event_emitter = event_emitter
        self._context = context
        if context is None:
            self._context = {'special_shape_types': {}}

    def traverse_and_document_shape(
        self,
        section,
        shape,
        history,
        include=None,
        exclude=None,
        name=None,
        is_required=False,
    ):
        """Traverses and documents a shape

        Will take a self class and call its appropriate methods as a shape
        is traversed.

        :param section: The section to document.

        :param history: A list of the names of the shapes that have been
            traversed.

        :type include: Dictionary where keys are parameter names and
            values are the shapes of the parameter names.
        :param include: The parameter shapes to include in the documentation.

        :type exclude: List of the names of the parameters to exclude.
        :param exclude: The names of the parameters to exclude from
            documentation.

        :param name: The name of the shape.

        :param is_required: If the shape is a required member.
        """
        param_type = shape.type_name
        if getattr(shape, 'serialization', {}).get('eventstream'):
            param_type = 'event_stream'
        if shape.name in history:
            self.document_recursive_shape(section, shape, name=name)
        else:
            history.append(shape.name)
            is_top_level_param = len(history) == 2
            if hasattr(shape, 'is_document_type') and shape.is_document_type:
                param_type = 'document'
            getattr(
                self,
                f"document_shape_type_{param_type}",
                self.document_shape_default,
            )(
                section,
                shape,
                history=history,
                name=name,
                include=include,
                exclude=exclude,
                is_top_level_param=is_top_level_param,
                is_required=is_required,
            )
            if is_top_level_param:
                self._event_emitter.emit(
                    f"docs.{self.EVENT_NAME}.{self._service_name}.{self._operation_name}.{name}",
                    section=section,
                )
            at_overlying_method_section = len(history) == 1
            if at_overlying_method_section:
                self._event_emitter.emit(
                    f"docs.{self.EVENT_NAME}.{self._service_name}.{self._operation_name}.complete-section",
                    section=section,
                )
            history.pop()

    def _get_special_py_default(self, shape):
        special_defaults = {
            'document_type': '{...}|[...]|123|123.4|\'string\'|True|None',
            'jsonvalue_header': '{...}|[...]|123|123.4|\'string\'|True|None',
            'streaming_input_shape': 'b\'bytes\'|file',
            'streaming_output_shape': 'StreamingBody()',
            'eventstream_output_shape': 'EventStream()',
        }
        return self._get_value_for_special_type(shape, special_defaults)

    def _get_special_py_type_name(self, shape):
        special_type_names = {
            'document_type': ':ref:`document<document>`',
            'jsonvalue_header': 'JSON serializable',
            'streaming_input_shape': 'bytes or seekable file-like object',
            'streaming_output_shape': ':class:`.StreamingBody`',
            'eventstream_output_shape': ':class:`.EventStream`',
        }
        return self._get_value_for_special_type(shape, special_type_names)

    def _get_value_for_special_type(self, shape, special_type_map):
        if is_json_value_header(shape):
            return special_type_map['jsonvalue_header']
        if hasattr(shape, 'is_document_type') and shape.is_document_type:
            return special_type_map['document_type']
        for special_type, marked_shape in self._context[
            'special_shape_types'
        ].items():
            if special_type in special_type_map:
                if shape == marked_shape:
                    return special_type_map[special_type]
        return None
