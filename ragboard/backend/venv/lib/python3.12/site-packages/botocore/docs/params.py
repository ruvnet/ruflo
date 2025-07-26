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
from botocore.docs.shape import ShapeDocumenter
from botocore.docs.utils import py_type_name


class BaseParamsDocumenter(ShapeDocumenter):
    def document_params(self, section, shape, include=None, exclude=None):
        """Fills out the documentation for a section given a model shape.

        :param section: The section to write the documentation to.

        :param shape: The shape of the operation.

        :type include: Dictionary where keys are parameter names and
            values are the shapes of the parameter names.
        :param include: The parameter shapes to include in the documentation.

        :type exclude: List of the names of the parameters to exclude.
        :param exclude: The names of the parameters to exclude from
            documentation.
        """
        history = []
        self.traverse_and_document_shape(
            section=section,
            shape=shape,
            history=history,
            name=None,
            include=include,
            exclude=exclude,
        )

    def document_recursive_shape(self, section, shape, **kwargs):
        self._add_member_documentation(section, shape, **kwargs)

    def document_shape_default(
        self, section, shape, history, include=None, exclude=None, **kwargs
    ):
        self._add_member_documentation(section, shape, **kwargs)

    def document_shape_type_list(
        self, section, shape, history, include=None, exclude=None, **kwargs
    ):
        self._add_member_documentation(section, shape, **kwargs)
        param_shape = shape.member
        param_section = section.add_new_section(
            param_shape.name, context={'shape': shape.member.name}
        )
        self._start_nested_param(param_section)
        self.traverse_and_document_shape(
            section=param_section,
            shape=param_shape,
            history=history,
            name=None,
        )
        section = section.add_new_section('end-list')
        self._end_nested_param(section)

    def document_shape_type_map(
        self, section, shape, history, include=None, exclude=None, **kwargs
    ):
        self._add_member_documentation(section, shape, **kwargs)

        key_section = section.add_new_section(
            'key', context={'shape': shape.key.name}
        )
        self._start_nested_param(key_section)
        self._add_member_documentation(key_section, shape.key)

        param_section = section.add_new_section(
            shape.value.name, context={'shape': shape.value.name}
        )
        param_section.style.indent()
        self._start_nested_param(param_section)
        self.traverse_and_document_shape(
            section=param_section,
            shape=shape.value,
            history=history,
            name=None,
        )

        end_section = section.add_new_section('end-map')
        self._end_nested_param(end_section)
        self._end_nested_param(end_section)

    def document_shape_type_structure(
        self,
        section,
        shape,
        history,
        include=None,
        exclude=None,
        name=None,
        **kwargs,
    ):
        members = self._add_members_to_shape(shape.members, include)
        self._add_member_documentation(section, shape, name=name)
        for param in members:
            if exclude and param in exclude:
                continue
            param_shape = members[param]
            param_section = section.add_new_section(
                param, context={'shape': param_shape.name}
            )
            self._start_nested_param(param_section)
            self.traverse_and_document_shape(
                section=param_section,
                shape=param_shape,
                history=history,
                name=param,
            )
        section = section.add_new_section('end-structure')
        self._end_nested_param(section)

    def _add_member_documentation(self, section, shape, **kwargs):
        pass

    def _add_members_to_shape(self, members, include):
        if include:
            members = members.copy()
            for param in include:
                members[param.name] = param
        return members

    def _document_non_top_level_param_type(self, type_section, shape):
        special_py_type = self._get_special_py_type_name(shape)
        py_type = py_type_name(shape.type_name)

        type_format = '(%s) --'
        if special_py_type is not None:
            # Special type can reference a linked class.
            # Italicizing it blows away the link.
            type_section.write(type_format % special_py_type)
        else:
            type_section.style.italics(type_format % py_type)
        type_section.write(' ')

    def _start_nested_param(self, section):
        section.style.indent()
        section.style.new_line()

    def _end_nested_param(self, section):
        section.style.dedent()
        section.style.new_line()


class ResponseParamsDocumenter(BaseParamsDocumenter):
    """Generates the description for the response parameters"""

    EVENT_NAME = 'response-params'

    def _add_member_documentation(self, section, shape, name=None, **kwargs):
        name_section = section.add_new_section('param-name')
        name_section.write('- ')
        if name is not None:
            name_section.style.bold(f'{name}')
            name_section.write(' ')
        type_section = section.add_new_section('param-type')
        self._document_non_top_level_param_type(type_section, shape)

        documentation_section = section.add_new_section('param-documentation')
        if shape.documentation:
            documentation_section.style.indent()
            if getattr(shape, 'is_tagged_union', False):
                tagged_union_docs = section.add_new_section(
                    'param-tagged-union-docs'
                )
                note = (
                    '.. note::'
                    '    This is a Tagged Union structure. Only one of the '
                    '    following top level keys will be set: %s. '
                    '    If a client receives an unknown member it will '
                    '    set ``SDK_UNKNOWN_MEMBER`` as the top level key, '
                    '    which maps to the name or tag of the unknown '
                    '    member. The structure of ``SDK_UNKNOWN_MEMBER`` is '
                    '    as follows'
                )
                tagged_union_members_str = ', '.join(
                    [f'``{key}``' for key in shape.members.keys()]
                )
                unknown_code_example = (
                    '\'SDK_UNKNOWN_MEMBER\': '
                    '{\'name\': \'UnknownMemberName\'}'
                )
                tagged_union_docs.write(note % (tagged_union_members_str))
                example = section.add_new_section('param-unknown-example')
                example.style.codeblock(unknown_code_example)
            documentation_section.include_doc_string(shape.documentation)
        section.style.new_paragraph()

    def document_shape_type_event_stream(
        self, section, shape, history, **kwargs
    ):
        self.document_shape_type_structure(section, shape, history, **kwargs)


class RequestParamsDocumenter(BaseParamsDocumenter):
    """Generates the description for the request parameters"""

    EVENT_NAME = 'request-params'

    def document_shape_type_structure(
        self, section, shape, history, include=None, exclude=None, **kwargs
    ):
        if len(history) > 1:
            self._add_member_documentation(section, shape, **kwargs)
            section.style.indent()
        members = self._add_members_to_shape(shape.members, include)
        for i, param in enumerate(members):
            if exclude and param in exclude:
                continue
            param_shape = members[param]
            param_section = section.add_new_section(
                param, context={'shape': param_shape.name}
            )
            param_section.style.new_line()
            is_required = param in shape.required_members
            self.traverse_and_document_shape(
                section=param_section,
                shape=param_shape,
                history=history,
                name=param,
                is_required=is_required,
            )
        section = section.add_new_section('end-structure')
        if len(history) > 1:
            section.style.dedent()
        section.style.new_line()

    def _add_member_documentation(
        self,
        section,
        shape,
        name=None,
        is_top_level_param=False,
        is_required=False,
        **kwargs,
    ):
        py_type = self._get_special_py_type_name(shape)
        if py_type is None:
            py_type = py_type_name(shape.type_name)
        if is_top_level_param:
            type_section = section.add_new_section('param-type')
            type_section.write(f':type {name}: {py_type}')
            end_type_section = type_section.add_new_section('end-param-type')
            end_type_section.style.new_line()
            name_section = section.add_new_section('param-name')
            name_section.write(f':param {name}: ')

        else:
            name_section = section.add_new_section('param-name')
            name_section.write('- ')
            if name is not None:
                name_section.style.bold(f'{name}')
                name_section.write(' ')
            type_section = section.add_new_section('param-type')
            self._document_non_top_level_param_type(type_section, shape)

        if is_required:
            is_required_section = section.add_new_section('is-required')
            is_required_section.style.indent()
            is_required_section.style.bold('[REQUIRED]')
            is_required_section.write(' ')
        if shape.documentation:
            documentation_section = section.add_new_section(
                'param-documentation'
            )
            documentation_section.style.indent()
            if getattr(shape, 'is_tagged_union', False):
                tagged_union_docs = section.add_new_section(
                    'param-tagged-union-docs'
                )
                note = (
                    '.. note::'
                    '    This is a Tagged Union structure. Only one of the '
                    '    following top level keys can be set: %s. '
                )
                tagged_union_members_str = ', '.join(
                    [f'``{key}``' for key in shape.members.keys()]
                )
                tagged_union_docs.write(note % (tagged_union_members_str))
            documentation_section.include_doc_string(shape.documentation)
            self._add_special_trait_documentation(documentation_section, shape)
        end_param_section = section.add_new_section('end-param')
        end_param_section.style.new_paragraph()

    def _add_special_trait_documentation(self, section, shape):
        if 'idempotencyToken' in shape.metadata:
            self._append_idempotency_documentation(section)

    def _append_idempotency_documentation(self, section):
        docstring = 'This field is autopopulated if not provided.'
        section.write(docstring)
