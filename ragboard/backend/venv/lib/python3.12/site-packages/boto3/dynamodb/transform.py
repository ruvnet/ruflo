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
import copy

from boto3.compat import collections_abc
from boto3.docs.utils import DocumentModifiedShape
from boto3.dynamodb.conditions import ConditionBase, ConditionExpressionBuilder
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer


def register_high_level_interface(base_classes, **kwargs):
    base_classes.insert(0, DynamoDBHighLevelResource)


class _ForgetfulDict(dict):
    """A dictionary that discards any items set on it. For use as `memo` in
    `copy.deepcopy()` when every instance of a repeated object in the deepcopied
    data structure should result in a separate copy.
    """

    def __setitem__(self, key, value):
        pass


def copy_dynamodb_params(params, **kwargs):
    return copy.deepcopy(params, memo=_ForgetfulDict())


class DynamoDBHighLevelResource:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Apply handler that creates a copy of the user provided dynamodb
        # item such that it can be modified.
        self.meta.client.meta.events.register(
            'provide-client-params.dynamodb',
            copy_dynamodb_params,
            unique_id='dynamodb-create-params-copy',
        )

        self._injector = TransformationInjector()
        # Apply the handler that generates condition expressions including
        # placeholders.
        self.meta.client.meta.events.register(
            'before-parameter-build.dynamodb',
            self._injector.inject_condition_expressions,
            unique_id='dynamodb-condition-expression',
        )

        # Apply the handler that serializes the request from python
        # types to dynamodb types.
        self.meta.client.meta.events.register(
            'before-parameter-build.dynamodb',
            self._injector.inject_attribute_value_input,
            unique_id='dynamodb-attr-value-input',
        )

        # Apply the handler that deserializes the response from dynamodb
        # types to python types.
        self.meta.client.meta.events.register(
            'after-call.dynamodb',
            self._injector.inject_attribute_value_output,
            unique_id='dynamodb-attr-value-output',
        )

        # Apply the documentation customizations to account for
        # the transformations.
        attr_value_shape_docs = DocumentModifiedShape(
            'AttributeValue',
            new_type='valid DynamoDB type',
            new_description=(
                '- The value of the attribute. The valid value types are '
                'listed in the '
                ':ref:`DynamoDB Reference Guide<ref_valid_dynamodb_types>`.'
            ),
            new_example_value=(
                '\'string\'|123|Binary(b\'bytes\')|True|None|set([\'string\'])'
                '|set([123])|set([Binary(b\'bytes\')])|[]|{}'
            ),
        )

        key_expression_shape_docs = DocumentModifiedShape(
            'KeyExpression',
            new_type=(
                'condition from :py:class:`boto3.dynamodb.conditions.Key` '
                'method'
            ),
            new_description=(
                'The condition(s) a key(s) must meet. Valid conditions are '
                'listed in the '
                ':ref:`DynamoDB Reference Guide<ref_dynamodb_conditions>`.'
            ),
            new_example_value='Key(\'mykey\').eq(\'myvalue\')',
        )

        con_expression_shape_docs = DocumentModifiedShape(
            'ConditionExpression',
            new_type=(
                'condition from :py:class:`boto3.dynamodb.conditions.Attr` '
                'method'
            ),
            new_description=(
                'The condition(s) an attribute(s) must meet. Valid conditions '
                'are listed in the '
                ':ref:`DynamoDB Reference Guide<ref_dynamodb_conditions>`.'
            ),
            new_example_value='Attr(\'myattribute\').eq(\'myvalue\')',
        )

        self.meta.client.meta.events.register(
            'docs.*.dynamodb.*.complete-section',
            attr_value_shape_docs.replace_documentation_for_matching_shape,
            unique_id='dynamodb-attr-value-docs',
        )

        self.meta.client.meta.events.register(
            'docs.*.dynamodb.*.complete-section',
            key_expression_shape_docs.replace_documentation_for_matching_shape,
            unique_id='dynamodb-key-expression-docs',
        )

        self.meta.client.meta.events.register(
            'docs.*.dynamodb.*.complete-section',
            con_expression_shape_docs.replace_documentation_for_matching_shape,
            unique_id='dynamodb-cond-expression-docs',
        )


class TransformationInjector:
    """Injects the transformations into the user provided parameters."""

    def __init__(
        self,
        transformer=None,
        condition_builder=None,
        serializer=None,
        deserializer=None,
    ):
        self._transformer = transformer
        if transformer is None:
            self._transformer = ParameterTransformer()

        self._condition_builder = condition_builder
        if condition_builder is None:
            self._condition_builder = ConditionExpressionBuilder()

        self._serializer = serializer
        if serializer is None:
            self._serializer = TypeSerializer()

        self._deserializer = deserializer
        if deserializer is None:
            self._deserializer = TypeDeserializer()

    def inject_condition_expressions(self, params, model, **kwargs):
        """Injects the condition expression transformation into the parameters

        This injection includes transformations for ConditionExpression shapes
        and KeyExpression shapes. It also handles any placeholder names and
        values that are generated when transforming the condition expressions.
        """
        self._condition_builder.reset()
        generated_names = {}
        generated_values = {}

        # Create and apply the Condition Expression transformation.
        transformation = ConditionExpressionTransformation(
            self._condition_builder,
            placeholder_names=generated_names,
            placeholder_values=generated_values,
            is_key_condition=False,
        )
        self._transformer.transform(
            params, model.input_shape, transformation, 'ConditionExpression'
        )

        # Create and apply the Key Condition Expression transformation.
        transformation = ConditionExpressionTransformation(
            self._condition_builder,
            placeholder_names=generated_names,
            placeholder_values=generated_values,
            is_key_condition=True,
        )
        self._transformer.transform(
            params, model.input_shape, transformation, 'KeyExpression'
        )

        expr_attr_names_input = 'ExpressionAttributeNames'
        expr_attr_values_input = 'ExpressionAttributeValues'

        # Now that all of the condition expression transformation are done,
        # update the placeholder dictionaries in the request.
        if expr_attr_names_input in params:
            params[expr_attr_names_input].update(generated_names)
        else:
            if generated_names:
                params[expr_attr_names_input] = generated_names

        if expr_attr_values_input in params:
            params[expr_attr_values_input].update(generated_values)
        else:
            if generated_values:
                params[expr_attr_values_input] = generated_values

    def inject_attribute_value_input(self, params, model, **kwargs):
        """Injects DynamoDB serialization into parameter input"""
        self._transformer.transform(
            params,
            model.input_shape,
            self._serializer.serialize,
            'AttributeValue',
        )

    def inject_attribute_value_output(self, parsed, model, **kwargs):
        """Injects DynamoDB deserialization into responses"""
        if model.output_shape is not None:
            self._transformer.transform(
                parsed,
                model.output_shape,
                self._deserializer.deserialize,
                'AttributeValue',
            )


class ConditionExpressionTransformation:
    """Provides a transformation for condition expressions

    The ``ParameterTransformer`` class can call this class directly
    to transform the condition expressions in the parameters provided.
    """

    def __init__(
        self,
        condition_builder,
        placeholder_names,
        placeholder_values,
        is_key_condition=False,
    ):
        self._condition_builder = condition_builder
        self._placeholder_names = placeholder_names
        self._placeholder_values = placeholder_values
        self._is_key_condition = is_key_condition

    def __call__(self, value):
        if isinstance(value, ConditionBase):
            # Create a conditional expression string with placeholders
            # for the provided condition.
            built_expression = self._condition_builder.build_expression(
                value, is_key_condition=self._is_key_condition
            )

            self._placeholder_names.update(
                built_expression.attribute_name_placeholders
            )
            self._placeholder_values.update(
                built_expression.attribute_value_placeholders
            )

            return built_expression.condition_expression
        # Use the user provided value if it is not a ConditonBase object.
        return value


class ParameterTransformer:
    """Transforms the input to and output from botocore based on shape"""

    def transform(self, params, model, transformation, target_shape):
        """Transforms the dynamodb input to or output from botocore

        It applies a specified transformation whenever a specific shape name
        is encountered while traversing the parameters in the dictionary.

        :param params: The parameters structure to transform.
        :param model: The operation model.
        :param transformation: The function to apply the parameter
        :param target_shape: The name of the shape to apply the
            transformation to
        """
        self._transform_parameters(model, params, transformation, target_shape)

    def _transform_parameters(
        self, model, params, transformation, target_shape
    ):
        type_name = model.type_name
        if type_name in ('structure', 'map', 'list'):
            getattr(self, f'_transform_{type_name}')(
                model, params, transformation, target_shape
            )

    def _transform_structure(
        self, model, params, transformation, target_shape
    ):
        if not isinstance(params, collections_abc.Mapping):
            return
        for param in params:
            if param in model.members:
                member_model = model.members[param]
                member_shape = member_model.name
                if member_shape == target_shape:
                    params[param] = transformation(params[param])
                else:
                    self._transform_parameters(
                        member_model,
                        params[param],
                        transformation,
                        target_shape,
                    )

    def _transform_map(self, model, params, transformation, target_shape):
        if not isinstance(params, collections_abc.Mapping):
            return
        value_model = model.value
        value_shape = value_model.name
        for key, value in params.items():
            if value_shape == target_shape:
                params[key] = transformation(value)
            else:
                self._transform_parameters(
                    value_model, params[key], transformation, target_shape
                )

    def _transform_list(self, model, params, transformation, target_shape):
        if not isinstance(params, collections_abc.MutableSequence):
            return
        member_model = model.member
        member_shape = member_model.name
        for i, item in enumerate(params):
            if member_shape == target_shape:
                params[i] = transformation(item)
            else:
                self._transform_parameters(
                    member_model, params[i], transformation, target_shape
                )
