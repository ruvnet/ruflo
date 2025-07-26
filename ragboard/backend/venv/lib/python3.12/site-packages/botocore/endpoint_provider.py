# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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

"""
NOTE: All classes and functions in this module are considered private and are
subject to abrupt breaking changes. Please do not use them directly.

To view the raw JSON that the objects in this module represent, please
go to any `endpoint-rule-set.json` file in /botocore/data/<service>/<api version>/
or you can look at the test files in /tests/unit/data/endpoints/valid-rules/
"""

import logging
import re
from enum import Enum
from string import Formatter
from typing import NamedTuple

from botocore import xform_name
from botocore.compat import IPV4_RE, quote, urlparse
from botocore.exceptions import EndpointResolutionError
from botocore.utils import (
    ArnParser,
    InvalidArnException,
    is_valid_ipv4_endpoint_url,
    is_valid_ipv6_endpoint_url,
    lru_cache_weakref,
    normalize_url_path,
    percent_encode,
)

logger = logging.getLogger(__name__)

TEMPLATE_STRING_RE = re.compile(r"\{[a-zA-Z#]+\}")
GET_ATTR_RE = re.compile(r"(\w+)\[(\d+)\]")
VALID_HOST_LABEL_RE = re.compile(
    r"^(?!-)[a-zA-Z\d-]{1,63}(?<!-)$",
)
CACHE_SIZE = 100
ARN_PARSER = ArnParser()
STRING_FORMATTER = Formatter()


class RuleSetStandardLibrary:
    """Rule actions to be performed by the EndpointProvider."""

    def __init__(self, partitions_data):
        self.partitions_data = partitions_data

    def is_func(self, argument):
        """Determine if an object is a function object.

        :type argument: Any
        :rtype: bool
        """
        return isinstance(argument, dict) and "fn" in argument

    def is_ref(self, argument):
        """Determine if an object is a reference object.

        :type argument: Any
        :rtype: bool
        """
        return isinstance(argument, dict) and "ref" in argument

    def is_template(self, argument):
        """Determine if an object contains a template string.

        :type argument: Any
        :rtpe: bool
        """
        return (
            isinstance(argument, str)
            and TEMPLATE_STRING_RE.search(argument) is not None
        )

    def resolve_template_string(self, value, scope_vars):
        """Resolve and inject values into a template string.

        :type value: str
        :type scope_vars: dict
        :rtype: str
        """
        result = ""
        for literal, reference, _, _ in STRING_FORMATTER.parse(value):
            if reference is not None:
                template_value = scope_vars
                template_params = reference.split("#")
                for param in template_params:
                    template_value = template_value[param]
                result += f"{literal}{template_value}"
            else:
                result += literal
        return result

    def resolve_value(self, value, scope_vars):
        """Return evaluated value based on type.

        :type value: Any
        :type scope_vars: dict
        :rtype: Any
        """
        if self.is_func(value):
            return self.call_function(value, scope_vars)
        elif self.is_ref(value):
            return scope_vars.get(value["ref"])
        elif self.is_template(value):
            return self.resolve_template_string(value, scope_vars)

        return value

    def convert_func_name(self, value):
        """Normalize function names.

        :type value: str
        :rtype: str
        """
        normalized_name = f"{xform_name(value)}"
        if normalized_name == "not":
            normalized_name = f"_{normalized_name}"
        return normalized_name.replace(".", "_")

    def call_function(self, func_signature, scope_vars):
        """Call the function with the resolved arguments and assign to `scope_vars`
        when applicable.

        :type func_signature: dict
        :type scope_vars: dict
        :rtype: Any
        """
        func_args = [
            self.resolve_value(arg, scope_vars)
            for arg in func_signature["argv"]
        ]
        func_name = self.convert_func_name(func_signature["fn"])
        func = getattr(self, func_name)
        result = func(*func_args)
        if "assign" in func_signature:
            assign = func_signature["assign"]
            if assign in scope_vars:
                raise EndpointResolutionError(
                    msg=f"Assignment {assign} already exists in "
                    "scoped variables and cannot be overwritten"
                )
            scope_vars[assign] = result
        return result

    def is_set(self, value):
        """Evaluates whether a value is set.

        :type value: Any
        :rytpe: bool
        """
        return value is not None

    def get_attr(self, value, path):
        """Find an attribute within a value given a path string. The path can contain
        the name of the attribute and an index in brackets. A period separating attribute
        names indicates the one to the right is nested. The index will always occur at
        the end of the path.

        :type value: dict or list
        :type path: str
        :rtype: Any
        """
        for part in path.split("."):
            match = GET_ATTR_RE.search(part)
            if match is not None:
                name, index = match.groups()
                index = int(index)
                value = value.get(name)
                if value is None or index >= len(value):
                    return None
                return value[index]
            else:
                value = value[part]
        return value

    def format_partition_output(self, partition):
        output = partition["outputs"]
        output["name"] = partition["id"]
        return output

    def is_partition_match(self, region, partition):
        matches_regex = re.match(partition["regionRegex"], region) is not None
        return region in partition["regions"] or matches_regex

    def aws_partition(self, value):
        """Match a region string to an AWS partition.

        :type value: str
        :rtype: dict
        """
        partitions = self.partitions_data['partitions']

        if value is not None:
            for partition in partitions:
                if self.is_partition_match(value, partition):
                    return self.format_partition_output(partition)

        # return the default partition if no matches were found
        aws_partition = partitions[0]
        return self.format_partition_output(aws_partition)

    def aws_parse_arn(self, value):
        """Parse and validate string for ARN components.

        :type value: str
        :rtype: dict
        """
        if value is None or not value.startswith("arn:"):
            return None

        try:
            arn_dict = ARN_PARSER.parse_arn(value)
        except InvalidArnException:
            return None

        # partition, resource, and service are required
        if not all(
            (arn_dict["partition"], arn_dict["service"], arn_dict["resource"])
        ):
            return None

        arn_dict["accountId"] = arn_dict.pop("account")

        resource = arn_dict.pop("resource")
        arn_dict["resourceId"] = resource.replace(":", "/").split("/")

        return arn_dict

    def is_valid_host_label(self, value, allow_subdomains):
        """Evaluates whether a value is a valid host label per
        RFC 1123. If allow_subdomains is True, split on `.` and validate
        each component separately.

        :type value: str
        :type allow_subdomains: bool
        :rtype: bool
        """
        if value is None or allow_subdomains is False and value.count(".") > 0:
            return False

        if allow_subdomains is True:
            return all(
                self.is_valid_host_label(label, False)
                for label in value.split(".")
            )

        return VALID_HOST_LABEL_RE.match(value) is not None

    def string_equals(self, value1, value2):
        """Evaluates two string values for equality.

        :type value1: str
        :type value2: str
        :rtype: bool
        """
        if not all(isinstance(val, str) for val in (value1, value2)):
            msg = f"Both values must be strings, not {type(value1)} and {type(value2)}."
            raise EndpointResolutionError(msg=msg)
        return value1 == value2

    def uri_encode(self, value):
        """Perform percent-encoding on an input string.

        :type value: str
        :rytpe: str
        """
        if value is None:
            return None

        return percent_encode(value)

    def parse_url(self, value):
        """Parse a URL string into components.

        :type value: str
        :rtype: dict
        """
        if value is None:
            return None

        url_components = urlparse(value)
        try:
            # url_parse may assign non-integer values to
            # `port` and will fail when accessed.
            url_components.port
        except ValueError:
            return None

        scheme = url_components.scheme
        query = url_components.query
        # URLs with queries are not supported
        if scheme not in ("https", "http") or len(query) > 0:
            return None

        path = url_components.path
        normalized_path = quote(normalize_url_path(path))
        if not normalized_path.endswith("/"):
            normalized_path = f"{normalized_path}/"

        return {
            "scheme": scheme,
            "authority": url_components.netloc,
            "path": path,
            "normalizedPath": normalized_path,
            "isIp": is_valid_ipv4_endpoint_url(value)
            or is_valid_ipv6_endpoint_url(value),
        }

    def boolean_equals(self, value1, value2):
        """Evaluates two boolean values for equality.

        :type value1: bool
        :type value2: bool
        :rtype: bool
        """
        if not all(isinstance(val, bool) for val in (value1, value2)):
            msg = f"Both arguments must be bools, not {type(value1)} and {type(value2)}."
            raise EndpointResolutionError(msg=msg)
        return value1 is value2

    def is_ascii(self, value):
        """Evaluates if a string only contains ASCII characters.

        :type value: str
        :rtype: bool
        """
        try:
            value.encode("ascii")
            return True
        except UnicodeEncodeError:
            return False

    def substring(self, value, start, stop, reverse):
        """Computes a substring given the start index and end index. If `reverse` is
        True, slice the string from the end instead.

        :type value: str
        :type start: int
        :type end: int
        :type reverse: bool
        :rtype: str
        """
        if not isinstance(value, str):
            msg = f"Input must be a string, not {type(value)}."
            raise EndpointResolutionError(msg=msg)
        if start >= stop or len(value) < stop or not self.is_ascii(value):
            return None

        if reverse is True:
            r_start = len(value) - stop
            r_stop = len(value) - start
            return value[r_start:r_stop]

        return value[start:stop]

    def _not(self, value):
        """A function implementation of the logical operator `not`.

        :type value: Any
        :rtype: bool
        """
        return not value

    def aws_is_virtual_hostable_s3_bucket(self, value, allow_subdomains):
        """Evaluates whether a value is a valid bucket name for virtual host
        style bucket URLs. To pass, the value must meet the following criteria:
        1. is_valid_host_label(value) is True
        2. length between 3 and 63 characters (inclusive)
        3. does not contain uppercase characters
        4. is not formatted as an IP address

        If allow_subdomains is True, split on `.` and validate
        each component separately.

        :type value: str
        :type allow_subdomains: bool
        :rtype: bool
        """
        if (
            value is None
            or len(value) < 3
            or value.lower() != value
            or IPV4_RE.match(value) is not None
        ):
            return False

        return self.is_valid_host_label(
            value, allow_subdomains=allow_subdomains
        )


# maintains backwards compatibility as `Library` was misspelled
# in earlier versions
RuleSetStandardLibary = RuleSetStandardLibrary


class BaseRule:
    """Base interface for individual endpoint rules."""

    def __init__(self, conditions, documentation=None):
        self.conditions = conditions
        self.documentation = documentation

    def evaluate(self, scope_vars, rule_lib):
        raise NotImplementedError()

    def evaluate_conditions(self, scope_vars, rule_lib):
        """Determine if all conditions in a rule are met.

        :type scope_vars: dict
        :type rule_lib: RuleSetStandardLibrary
        :rtype: bool
        """
        for func_signature in self.conditions:
            result = rule_lib.call_function(func_signature, scope_vars)
            if result is False or result is None:
                return False
        return True


class RuleSetEndpoint(NamedTuple):
    """A resolved endpoint object returned by a rule."""

    url: str
    properties: dict
    headers: dict


class EndpointRule(BaseRule):
    def __init__(self, endpoint, **kwargs):
        super().__init__(**kwargs)
        self.endpoint = endpoint

    def evaluate(self, scope_vars, rule_lib):
        """Determine if conditions are met to provide a valid endpoint.

        :type scope_vars: dict
        :rtype: RuleSetEndpoint
        """
        if self.evaluate_conditions(scope_vars, rule_lib):
            url = rule_lib.resolve_value(self.endpoint["url"], scope_vars)
            properties = self.resolve_properties(
                self.endpoint.get("properties", {}),
                scope_vars,
                rule_lib,
            )
            headers = self.resolve_headers(scope_vars, rule_lib)
            return RuleSetEndpoint(
                url=url, properties=properties, headers=headers
            )

        return None

    def resolve_properties(self, properties, scope_vars, rule_lib):
        """Traverse `properties` attribute, resolving any template strings.

        :type properties: dict/list/str
        :type scope_vars: dict
        :type rule_lib: RuleSetStandardLibrary
        :rtype: dict
        """
        if isinstance(properties, list):
            return [
                self.resolve_properties(prop, scope_vars, rule_lib)
                for prop in properties
            ]
        elif isinstance(properties, dict):
            return {
                key: self.resolve_properties(value, scope_vars, rule_lib)
                for key, value in properties.items()
            }
        elif rule_lib.is_template(properties):
            return rule_lib.resolve_template_string(properties, scope_vars)

        return properties

    def resolve_headers(self, scope_vars, rule_lib):
        """Iterate through headers attribute resolving all values.

        :type scope_vars: dict
        :type rule_lib: RuleSetStandardLibrary
        :rtype: dict
        """
        resolved_headers = {}
        headers = self.endpoint.get("headers", {})

        for header, values in headers.items():
            resolved_headers[header] = [
                rule_lib.resolve_value(item, scope_vars) for item in values
            ]
        return resolved_headers


class ErrorRule(BaseRule):
    def __init__(self, error, **kwargs):
        super().__init__(**kwargs)
        self.error = error

    def evaluate(self, scope_vars, rule_lib):
        """If an error rule's conditions are met, raise an error rule.

        :type scope_vars: dict
        :type rule_lib: RuleSetStandardLibrary
        :rtype: EndpointResolutionError
        """
        if self.evaluate_conditions(scope_vars, rule_lib):
            error = rule_lib.resolve_value(self.error, scope_vars)
            raise EndpointResolutionError(msg=error)
        return None


class TreeRule(BaseRule):
    """A tree rule is non-terminal meaning it will never be returned to a provider.
    Additionally this means it has no attributes that need to be resolved.
    """

    def __init__(self, rules, **kwargs):
        super().__init__(**kwargs)
        self.rules = [RuleCreator.create(**rule) for rule in rules]

    def evaluate(self, scope_vars, rule_lib):
        """If a tree rule's conditions are met, iterate its sub-rules
        and return first result found.

        :type scope_vars: dict
        :type rule_lib: RuleSetStandardLibrary
        :rtype: RuleSetEndpoint/EndpointResolutionError
        """
        if self.evaluate_conditions(scope_vars, rule_lib):
            for rule in self.rules:
                # don't share scope_vars between rules
                rule_result = rule.evaluate(scope_vars.copy(), rule_lib)
                if rule_result:
                    return rule_result
        return None


class RuleCreator:
    endpoint = EndpointRule
    error = ErrorRule
    tree = TreeRule

    @classmethod
    def create(cls, **kwargs):
        """Create a rule instance from metadata.

        :rtype: TreeRule/EndpointRule/ErrorRule
        """
        rule_type = kwargs.pop("type")
        try:
            rule_class = getattr(cls, rule_type)
        except AttributeError:
            raise EndpointResolutionError(
                msg=f"Unknown rule type: {rule_type}. A rule must "
                "be of type tree, endpoint or error."
            )
        else:
            return rule_class(**kwargs)


class ParameterType(Enum):
    """Translation from `type` attribute to native Python type."""

    string = str
    boolean = bool


class ParameterDefinition:
    """The spec of an individual parameter defined in a RuleSet."""

    def __init__(
        self,
        name,
        parameter_type,
        documentation=None,
        builtIn=None,
        default=None,
        required=None,
        deprecated=None,
    ):
        self.name = name
        try:
            self.parameter_type = getattr(
                ParameterType, parameter_type.lower()
            ).value
        except AttributeError:
            raise EndpointResolutionError(
                msg=f"Unknown parameter type: {parameter_type}. "
                "A parameter must be of type string or boolean."
            )
        self.documentation = documentation
        self.builtin = builtIn
        self.default = default
        self.required = required
        self.deprecated = deprecated

    def validate_input(self, value):
        """Perform base validation on parameter input.

        :type value: Any
        :raises: EndpointParametersError
        """

        if not isinstance(value, self.parameter_type):
            raise EndpointResolutionError(
                msg=f"Value ({self.name}) is the wrong "
                f"type. Must be {self.parameter_type}."
            )
        if self.deprecated is not None:
            depr_str = f"{self.name} has been deprecated."
            msg = self.deprecated.get("message")
            since = self.deprecated.get("since")
            if msg:
                depr_str += f"\n{msg}"
            if since:
                depr_str += f"\nDeprecated since {since}."
            logger.info(depr_str)

        return None

    def process_input(self, value):
        """Process input against spec, applying default if value is None."""
        if value is None:
            if self.default is not None:
                return self.default
            if self.required:
                raise EndpointResolutionError(
                    f"Cannot find value for required parameter {self.name}"
                )
            # in all other cases, the parameter will keep the value None
        else:
            self.validate_input(value)
        return value


class RuleSet:
    """Collection of rules to derive a routable service endpoint."""

    def __init__(
        self, version, parameters, rules, partitions, documentation=None
    ):
        self.version = version
        self.parameters = self._ingest_parameter_spec(parameters)
        self.rules = [RuleCreator.create(**rule) for rule in rules]
        self.rule_lib = RuleSetStandardLibrary(partitions)
        self.documentation = documentation

    def _ingest_parameter_spec(self, parameters):
        return {
            name: ParameterDefinition(
                name,
                spec["type"],
                spec.get("documentation"),
                spec.get("builtIn"),
                spec.get("default"),
                spec.get("required"),
                spec.get("deprecated"),
            )
            for name, spec in parameters.items()
        }

    def process_input_parameters(self, input_params):
        """Process each input parameter against its spec.

        :type input_params: dict
        """
        for name, spec in self.parameters.items():
            value = spec.process_input(input_params.get(name))
            if value is not None:
                input_params[name] = value
        return None

    def evaluate(self, input_parameters):
        """Evaluate input parameters against rules returning first match.

        :type input_parameters: dict
        """
        self.process_input_parameters(input_parameters)
        for rule in self.rules:
            evaluation = rule.evaluate(input_parameters.copy(), self.rule_lib)
            if evaluation is not None:
                return evaluation
        return None


class EndpointProvider:
    """Derives endpoints from a RuleSet for given input parameters."""

    def __init__(self, ruleset_data, partition_data):
        self.ruleset = RuleSet(**ruleset_data, partitions=partition_data)

    @lru_cache_weakref(maxsize=CACHE_SIZE)
    def resolve_endpoint(self, **input_parameters):
        """Match input parameters to a rule.

        :type input_parameters: dict
        :rtype: RuleSetEndpoint
        """
        params_for_error = input_parameters.copy()
        endpoint = self.ruleset.evaluate(input_parameters)
        if endpoint is None:
            param_string = "\n".join(
                [f"{key}: {value}" for key, value in params_for_error.items()]
            )
            raise EndpointResolutionError(
                msg=f"No endpoint found for parameters:\n{param_string}"
            )
        return endpoint
