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
import numbers
import re

from botocore.docs.utils import escape_controls
from botocore.utils import parse_timestamp


class SharedExampleDocumenter:
    def document_shared_example(
        self, example, prefix, section, operation_model
    ):
        """Documents a single shared example based on its definition.

        :param example: The model of the example

        :param prefix: The prefix to use in the method example.

        :param section: The section to write to.

        :param operation_model: The model of the operation used in the example
        """
        section.style.new_paragraph()
        section.write(example.get('description'))
        section.style.new_line()
        self.document_input(
            section, example, prefix, operation_model.input_shape
        )
        self.document_output(section, example, operation_model.output_shape)

    def document_input(self, section, example, prefix, shape):
        input_section = section.add_new_section('input')
        input_section.style.start_codeblock()
        if prefix is not None:
            input_section.write(prefix)
        params = example.get('input', {})
        comments = example.get('comments')
        if comments:
            comments = comments.get('input')
        param_section = input_section.add_new_section('parameters')
        self._document_params(param_section, params, comments, [], shape)
        closing_section = input_section.add_new_section('input-close')
        closing_section.style.new_line()
        closing_section.style.new_line()
        closing_section.write('print(response)')
        closing_section.style.end_codeblock()

    def document_output(self, section, example, shape):
        output_section = section.add_new_section('output')
        output_section.style.new_line()
        output_section.write('Expected Output:')
        output_section.style.new_line()
        output_section.style.start_codeblock()
        params = example.get('output', {})

        # There might not be an output, but we will return metadata anyway
        params['ResponseMetadata'] = {"...": "..."}
        comments = example.get('comments')
        if comments:
            comments = comments.get('output')
        self._document_dict(output_section, params, comments, [], shape, True)
        closing_section = output_section.add_new_section('output-close')
        closing_section.style.end_codeblock()

    def _document(self, section, value, comments, path, shape):
        """
        :param section: The section to add the docs to.

        :param value: The input / output values representing the parameters that
                      are included in the example.

        :param comments: The dictionary containing all the comments to be
                         applied to the example.

        :param path: A list describing where the documenter is in traversing the
                     parameters. This is used to find the equivalent location
                     in the comments dictionary.
        """
        if isinstance(value, dict):
            self._document_dict(section, value, comments, path, shape)
        elif isinstance(value, list):
            self._document_list(section, value, comments, path, shape)
        elif isinstance(value, numbers.Number):
            self._document_number(section, value, path)
        elif shape and shape.type_name == 'timestamp':
            self._document_datetime(section, value, path)
        else:
            self._document_str(section, value, path)

    def _document_dict(
        self, section, value, comments, path, shape, top_level=False
    ):
        dict_section = section.add_new_section('dict-value')
        self._start_nested_value(dict_section, '{')
        for key, val in value.items():
            path.append(f'.{key}')
            item_section = dict_section.add_new_section(key)
            item_section.style.new_line()
            item_comment = self._get_comment(path, comments)
            if item_comment:
                item_section.write(item_comment)
                item_section.style.new_line()
            item_section.write(f"'{key}': ")

            # Shape could be none if there is no output besides ResponseMetadata
            item_shape = None
            if shape:
                if shape.type_name == 'structure':
                    item_shape = shape.members.get(key)
                elif shape.type_name == 'map':
                    item_shape = shape.value
            self._document(item_section, val, comments, path, item_shape)
            path.pop()
        dict_section_end = dict_section.add_new_section('ending-brace')
        self._end_nested_value(dict_section_end, '}')
        if not top_level:
            dict_section_end.write(',')

    def _document_params(self, section, value, comments, path, shape):
        param_section = section.add_new_section('param-values')
        self._start_nested_value(param_section, '(')
        for key, val in value.items():
            path.append(f'.{key}')
            item_section = param_section.add_new_section(key)
            item_section.style.new_line()
            item_comment = self._get_comment(path, comments)
            if item_comment:
                item_section.write(item_comment)
                item_section.style.new_line()
            item_section.write(key + '=')

            # Shape could be none if there are no input parameters
            item_shape = None
            if shape:
                item_shape = shape.members.get(key)
            self._document(item_section, val, comments, path, item_shape)
            path.pop()
        param_section_end = param_section.add_new_section('ending-parenthesis')
        self._end_nested_value(param_section_end, ')')

    def _document_list(self, section, value, comments, path, shape):
        list_section = section.add_new_section('list-section')
        self._start_nested_value(list_section, '[')
        item_shape = shape.member
        for index, val in enumerate(value):
            item_section = list_section.add_new_section(index)
            item_section.style.new_line()
            path.append(f'[{index}]')
            item_comment = self._get_comment(path, comments)
            if item_comment:
                item_section.write(item_comment)
                item_section.style.new_line()
            self._document(item_section, val, comments, path, item_shape)
            path.pop()
        list_section_end = list_section.add_new_section('ending-bracket')
        self._end_nested_value(list_section_end, '],')

    def _document_str(self, section, value, path):
        # We do the string conversion because this might accept a type that
        # we don't specifically address.
        safe_value = escape_controls(value)
        section.write(f"'{safe_value}',")

    def _document_number(self, section, value, path):
        section.write(f"{str(value)},")

    def _document_datetime(self, section, value, path):
        datetime_tuple = parse_timestamp(value).timetuple()
        datetime_str = str(datetime_tuple[0])
        for i in range(1, len(datetime_tuple)):
            datetime_str += ", " + str(datetime_tuple[i])
        section.write(f"datetime({datetime_str}),")

    def _get_comment(self, path, comments):
        key = re.sub(r'^\.', '', ''.join(path))
        if comments and key in comments:
            return '# ' + comments[key]
        else:
            return ''

    def _start_nested_value(self, section, start):
        section.write(start)
        section.style.indent()
        section.style.indent()

    def _end_nested_value(self, section, end):
        section.style.dedent()
        section.style.dedent()
        section.style.new_line()
        section.write(end)


def document_shared_examples(
    section, operation_model, example_prefix, shared_examples
):
    """Documents the shared examples

    :param section: The section to write to.

    :param operation_model: The model of the operation.

    :param example_prefix: The prefix to use in the method example.

    :param shared_examples: The shared JSON examples from the model.
    """
    container_section = section.add_new_section('shared-examples')
    container_section.style.new_paragraph()
    container_section.style.bold('Examples')
    documenter = SharedExampleDocumenter()
    for example in shared_examples:
        documenter.document_shared_example(
            example=example,
            section=container_section.add_new_section(example['id']),
            prefix=example_prefix,
            operation_model=operation_model,
        )
