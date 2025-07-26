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
import re
from collections import namedtuple

from boto3.exceptions import (
    DynamoDBNeedsConditionError,
    DynamoDBNeedsKeyConditionError,
    DynamoDBOperationNotSupportedError,
)

ATTR_NAME_REGEX = re.compile(r'[^.\[\]]+(?![^\[]*\])')


class ConditionBase:
    expression_format = ''
    expression_operator = ''
    has_grouped_values = False

    def __init__(self, *values):
        self._values = values

    def __and__(self, other):
        if not isinstance(other, ConditionBase):
            raise DynamoDBOperationNotSupportedError('AND', other)
        return And(self, other)

    def __or__(self, other):
        if not isinstance(other, ConditionBase):
            raise DynamoDBOperationNotSupportedError('OR', other)
        return Or(self, other)

    def __invert__(self):
        return Not(self)

    def get_expression(self):
        return {
            'format': self.expression_format,
            'operator': self.expression_operator,
            'values': self._values,
        }

    def __eq__(self, other):
        if isinstance(other, type(self)):
            if self._values == other._values:
                return True
        return False

    def __ne__(self, other):
        return not self.__eq__(other)


class AttributeBase:
    def __init__(self, name):
        self.name = name

    def __and__(self, value):
        raise DynamoDBOperationNotSupportedError('AND', self)

    def __or__(self, value):
        raise DynamoDBOperationNotSupportedError('OR', self)

    def __invert__(self):
        raise DynamoDBOperationNotSupportedError('NOT', self)

    def eq(self, value):
        """Creates a condition where the attribute is equal to the value.

        :param value: The value that the attribute is equal to.
        """
        return Equals(self, value)

    def lt(self, value):
        """Creates a condition where the attribute is less than the value.

        :param value: The value that the attribute is less than.
        """
        return LessThan(self, value)

    def lte(self, value):
        """Creates a condition where the attribute is less than or equal to the
           value.

        :param value: The value that the attribute is less than or equal to.
        """
        return LessThanEquals(self, value)

    def gt(self, value):
        """Creates a condition where the attribute is greater than the value.

        :param value: The value that the attribute is greater than.
        """
        return GreaterThan(self, value)

    def gte(self, value):
        """Creates a condition where the attribute is greater than or equal to
           the value.

        :param value: The value that the attribute is greater than or equal to.
        """
        return GreaterThanEquals(self, value)

    def begins_with(self, value):
        """Creates a condition where the attribute begins with the value.

        :param value: The value that the attribute begins with.
        """
        return BeginsWith(self, value)

    def between(self, low_value, high_value):
        """Creates a condition where the attribute is greater than or equal
        to the low value and less than or equal to the high value.

        :param low_value: The value that the attribute is greater than or equal to.
        :param high_value: The value that the attribute is less than or equal to.
        """
        return Between(self, low_value, high_value)

    def __eq__(self, other):
        return isinstance(other, type(self)) and self.name == other.name

    def __ne__(self, other):
        return not self.__eq__(other)


class ConditionAttributeBase(ConditionBase, AttributeBase):
    """This base class is for conditions that can have attribute methods.

    One example is the Size condition. To complete a condition, you need
    to apply another AttributeBase method like eq().
    """

    def __init__(self, *values):
        ConditionBase.__init__(self, *values)
        # This is assuming the first value to the condition is the attribute
        # in which can be used to generate its attribute base.
        AttributeBase.__init__(self, values[0].name)

    def __eq__(self, other):
        return ConditionBase.__eq__(self, other) and AttributeBase.__eq__(
            self, other
        )

    def __ne__(self, other):
        return not self.__eq__(other)


class ComparisonCondition(ConditionBase):
    expression_format = '{0} {operator} {1}'


class Equals(ComparisonCondition):
    expression_operator = '='


class NotEquals(ComparisonCondition):
    expression_operator = '<>'


class LessThan(ComparisonCondition):
    expression_operator = '<'


class LessThanEquals(ComparisonCondition):
    expression_operator = '<='


class GreaterThan(ComparisonCondition):
    expression_operator = '>'


class GreaterThanEquals(ComparisonCondition):
    expression_operator = '>='


class In(ComparisonCondition):
    expression_operator = 'IN'
    has_grouped_values = True


class Between(ConditionBase):
    expression_operator = 'BETWEEN'
    expression_format = '{0} {operator} {1} AND {2}'


class BeginsWith(ConditionBase):
    expression_operator = 'begins_with'
    expression_format = '{operator}({0}, {1})'


class Contains(ConditionBase):
    expression_operator = 'contains'
    expression_format = '{operator}({0}, {1})'


class Size(ConditionAttributeBase):
    expression_operator = 'size'
    expression_format = '{operator}({0})'


class AttributeType(ConditionBase):
    expression_operator = 'attribute_type'
    expression_format = '{operator}({0}, {1})'


class AttributeExists(ConditionBase):
    expression_operator = 'attribute_exists'
    expression_format = '{operator}({0})'


class AttributeNotExists(ConditionBase):
    expression_operator = 'attribute_not_exists'
    expression_format = '{operator}({0})'


class And(ConditionBase):
    expression_operator = 'AND'
    expression_format = '({0} {operator} {1})'


class Or(ConditionBase):
    expression_operator = 'OR'
    expression_format = '({0} {operator} {1})'


class Not(ConditionBase):
    expression_operator = 'NOT'
    expression_format = '({operator} {0})'


class Key(AttributeBase):
    pass


class Attr(AttributeBase):
    """Represents an DynamoDB item's attribute."""

    def ne(self, value):
        """Creates a condition where the attribute is not equal to the value

        :param value: The value that the attribute is not equal to.
        """
        return NotEquals(self, value)

    def is_in(self, value):
        """Creates a condition where the attribute is in the value,

        :type value: list
        :param value: The value that the attribute is in.
        """
        return In(self, value)

    def exists(self):
        """Creates a condition where the attribute exists."""
        return AttributeExists(self)

    def not_exists(self):
        """Creates a condition where the attribute does not exist."""
        return AttributeNotExists(self)

    def contains(self, value):
        """Creates a condition where the attribute contains the value.

        :param value: The value the attribute contains.
        """
        return Contains(self, value)

    def size(self):
        """Creates a condition for the attribute size.

        Note another AttributeBase method must be called on the returned
        size condition to be a valid DynamoDB condition.
        """
        return Size(self)

    def attribute_type(self, value):
        """Creates a condition for the attribute type.

        :param value: The type of the attribute.
        """
        return AttributeType(self, value)


BuiltConditionExpression = namedtuple(
    'BuiltConditionExpression',
    [
        'condition_expression',
        'attribute_name_placeholders',
        'attribute_value_placeholders',
    ],
)


class ConditionExpressionBuilder:
    """This class is used to build condition expressions with placeholders"""

    def __init__(self):
        self._name_count = 0
        self._value_count = 0
        self._name_placeholder = 'n'
        self._value_placeholder = 'v'

    def _get_name_placeholder(self):
        return '#' + self._name_placeholder + str(self._name_count)

    def _get_value_placeholder(self):
        return ':' + self._value_placeholder + str(self._value_count)

    def reset(self):
        """Resets the placeholder name and values"""
        self._name_count = 0
        self._value_count = 0

    def build_expression(self, condition, is_key_condition=False):
        """Builds the condition expression and the dictionary of placeholders.

        :type condition: ConditionBase
        :param condition: A condition to be built into a condition expression
            string with any necessary placeholders.

        :type is_key_condition: Boolean
        :param is_key_condition: True if the expression is for a
            KeyConditionExpression. False otherwise.

        :rtype: (string, dict, dict)
        :returns: Will return a string representing the condition with
            placeholders inserted where necessary, a dictionary of
            placeholders for attribute names, and a dictionary of
            placeholders for attribute values. Here is a sample return value:

            ('#n0 = :v0', {'#n0': 'myattribute'}, {':v1': 'myvalue'})
        """
        if not isinstance(condition, ConditionBase):
            raise DynamoDBNeedsConditionError(condition)
        attribute_name_placeholders = {}
        attribute_value_placeholders = {}
        condition_expression = self._build_expression(
            condition,
            attribute_name_placeholders,
            attribute_value_placeholders,
            is_key_condition=is_key_condition,
        )
        return BuiltConditionExpression(
            condition_expression=condition_expression,
            attribute_name_placeholders=attribute_name_placeholders,
            attribute_value_placeholders=attribute_value_placeholders,
        )

    def _build_expression(
        self,
        condition,
        attribute_name_placeholders,
        attribute_value_placeholders,
        is_key_condition,
    ):
        expression_dict = condition.get_expression()
        replaced_values = []
        for value in expression_dict['values']:
            # Build the necessary placeholders for that value.
            # Placeholders are built for both attribute names and values.
            replaced_value = self._build_expression_component(
                value,
                attribute_name_placeholders,
                attribute_value_placeholders,
                condition.has_grouped_values,
                is_key_condition,
            )
            replaced_values.append(replaced_value)
        # Fill out the expression using the operator and the
        # values that have been replaced with placeholders.
        return expression_dict['format'].format(
            *replaced_values, operator=expression_dict['operator']
        )

    def _build_expression_component(
        self,
        value,
        attribute_name_placeholders,
        attribute_value_placeholders,
        has_grouped_values,
        is_key_condition,
    ):
        # Continue to recurse if the value is a ConditionBase in order
        # to extract out all parts of the expression.
        if isinstance(value, ConditionBase):
            return self._build_expression(
                value,
                attribute_name_placeholders,
                attribute_value_placeholders,
                is_key_condition,
            )
        # If it is not a ConditionBase, we can recurse no further.
        # So we check if it is an attribute and add placeholders for
        # its name
        elif isinstance(value, AttributeBase):
            if is_key_condition and not isinstance(value, Key):
                raise DynamoDBNeedsKeyConditionError(
                    f'Attribute object {value.name} is of type {type(value)}. '
                    f'KeyConditionExpression only supports Attribute objects '
                    f'of type Key'
                )
            return self._build_name_placeholder(
                value, attribute_name_placeholders
            )
        # If it is anything else, we treat it as a value and thus placeholders
        # are needed for the value.
        else:
            return self._build_value_placeholder(
                value, attribute_value_placeholders, has_grouped_values
            )

    def _build_name_placeholder(self, value, attribute_name_placeholders):
        attribute_name = value.name
        # Figure out which parts of the attribute name that needs replacement.
        attribute_name_parts = ATTR_NAME_REGEX.findall(attribute_name)

        # Add a temporary placeholder for each of these parts.
        placeholder_format = ATTR_NAME_REGEX.sub('%s', attribute_name)
        str_format_args = []
        for part in attribute_name_parts:
            name_placeholder = self._get_name_placeholder()
            self._name_count += 1
            str_format_args.append(name_placeholder)
            # Add the placeholder and value to dictionary of name placeholders.
            attribute_name_placeholders[name_placeholder] = part
        # Replace the temporary placeholders with the designated placeholders.
        return placeholder_format % tuple(str_format_args)

    def _build_value_placeholder(
        self, value, attribute_value_placeholders, has_grouped_values=False
    ):
        # If the values are grouped, we need to add a placeholder for
        # each element inside of the actual value.
        if has_grouped_values:
            placeholder_list = []
            for v in value:
                value_placeholder = self._get_value_placeholder()
                self._value_count += 1
                placeholder_list.append(value_placeholder)
                attribute_value_placeholders[value_placeholder] = v
            # Assuming the values are grouped by parenthesis.
            # IN is the currently the only one that uses this so it maybe
            # needed to be changed in future.
            return '(' + ', '.join(placeholder_list) + ')'
        # Otherwise, treat the value as a single value that needs only
        # one placeholder.
        else:
            value_placeholder = self._get_value_placeholder()
            self._value_count += 1
            attribute_value_placeholders[value_placeholder] = value
            return value_placeholder
