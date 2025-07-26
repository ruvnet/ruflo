# Copyright 2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
"""Protocol input serializes.

This module contains classes that implement input serialization
for the various AWS protocol types.

These classes essentially take user input, a model object that
represents what the expected input should look like, and it returns
a dictionary that contains the various parts of a request.  A few
high level design decisions:


* Each protocol type maps to a separate class, all inherit from
  ``Serializer``.
* The return value for ``serialize_to_request`` (the main entry
  point) returns a dictionary that represents a request.  This
  will have keys like ``url_path``, ``query_string``, etc.  This
  is done so that it's a) easy to test and b) not tied to a
  particular HTTP library.  See the ``serialize_to_request`` docstring
  for more details.

Unicode
-------

The input to the serializers should be text (str/unicode), not bytes,
with the exception of blob types.  Those are assumed to be binary,
and if a str/unicode type is passed in, it will be encoded as utf-8.
"""

import base64
import calendar
import datetime
import json
import re
from xml.etree import ElementTree

from botocore import validate
from botocore.compat import formatdate
from botocore.exceptions import ParamValidationError
from botocore.utils import (
    has_header,
    is_json_value_header,
    parse_to_aware_datetime,
    percent_encode,
)

# From the spec, the default timestamp format if not specified is iso8601.
DEFAULT_TIMESTAMP_FORMAT = 'iso8601'
ISO8601 = '%Y-%m-%dT%H:%M:%SZ'
# Same as ISO8601, but with microsecond precision.
ISO8601_MICRO = '%Y-%m-%dT%H:%M:%S.%fZ'
HOST_PREFIX_RE = re.compile(r"^[A-Za-z0-9\.\-]+$")


def create_serializer(protocol_name, include_validation=True):
    # TODO: Unknown protocols.
    serializer = SERIALIZERS[protocol_name]()
    if include_validation:
        validator = validate.ParamValidator()
        serializer = validate.ParamValidationDecorator(validator, serializer)
    return serializer


class Serializer:
    DEFAULT_METHOD = 'POST'
    # Clients can change this to a different MutableMapping
    # (i.e OrderedDict) if they want.  This is used in the
    # compliance test to match the hash ordering used in the
    # tests.
    MAP_TYPE = dict
    DEFAULT_ENCODING = 'utf-8'

    def serialize_to_request(self, parameters, operation_model):
        """Serialize parameters into an HTTP request.

        This method takes user provided parameters and a shape
        model and serializes the parameters to an HTTP request.
        More specifically, this method returns information about
        parts of the HTTP request, it does not enforce a particular
        interface or standard for an HTTP request.  It instead returns
        a dictionary of:

            * 'url_path'
            * 'host_prefix'
            * 'query_string'
            * 'headers'
            * 'body'
            * 'method'

        It is then up to consumers to decide how to map this to a Request
        object of their HTTP library of choice.  Below is an example
        return value::

            {'body': {'Action': 'OperationName',
                      'Bar': 'val2',
                      'Foo': 'val1',
                      'Version': '2014-01-01'},
             'headers': {},
             'method': 'POST',
             'query_string': '',
             'host_prefix': 'value.',
             'url_path': '/'}

        :param parameters: The dictionary input parameters for the
            operation (i.e the user input).
        :param operation_model: The OperationModel object that describes
            the operation.
        """
        raise NotImplementedError("serialize_to_request")

    def _create_default_request(self):
        # Creates a boilerplate default request dict that subclasses
        # can use as a starting point.
        serialized = {
            'url_path': '/',
            'query_string': '',
            'method': self.DEFAULT_METHOD,
            'headers': {},
            # An empty body is represented as an empty byte string.
            'body': b'',
        }
        return serialized

    # Some extra utility methods subclasses can use.

    def _timestamp_iso8601(self, value):
        if value.microsecond > 0:
            timestamp_format = ISO8601_MICRO
        else:
            timestamp_format = ISO8601
        return value.strftime(timestamp_format)

    def _timestamp_unixtimestamp(self, value):
        return int(calendar.timegm(value.timetuple()))

    def _timestamp_rfc822(self, value):
        if isinstance(value, datetime.datetime):
            value = self._timestamp_unixtimestamp(value)
        return formatdate(value, usegmt=True)

    def _convert_timestamp_to_str(self, value, timestamp_format=None):
        if timestamp_format is None:
            timestamp_format = self.TIMESTAMP_FORMAT
        timestamp_format = timestamp_format.lower()
        datetime_obj = parse_to_aware_datetime(value)
        converter = getattr(self, f'_timestamp_{timestamp_format}')
        final_value = converter(datetime_obj)
        return final_value

    def _get_serialized_name(self, shape, default_name):
        # Returns the serialized name for the shape if it exists.
        # Otherwise it will return the passed in default_name.
        return shape.serialization.get('name', default_name)

    def _get_base64(self, value):
        # Returns the base64-encoded version of value, handling
        # both strings and bytes. The returned value is a string
        # via the default encoding.
        if isinstance(value, str):
            value = value.encode(self.DEFAULT_ENCODING)
        return base64.b64encode(value).strip().decode(self.DEFAULT_ENCODING)

    def _expand_host_prefix(self, parameters, operation_model):
        operation_endpoint = operation_model.endpoint
        if (
            operation_endpoint is None
            or 'hostPrefix' not in operation_endpoint
        ):
            return None

        host_prefix_expression = operation_endpoint['hostPrefix']
        input_members = operation_model.input_shape.members
        host_labels = [
            member
            for member, shape in input_members.items()
            if shape.serialization.get('hostLabel')
        ]
        format_kwargs = {}
        bad_labels = []
        for name in host_labels:
            param = parameters[name]
            if not HOST_PREFIX_RE.match(param):
                bad_labels.append(name)
            format_kwargs[name] = param
        if bad_labels:
            raise ParamValidationError(
                report=(
                    f"Invalid value for parameter(s): {', '.join(bad_labels)}. "
                    "Must contain only alphanumeric characters, hyphen, "
                    "or period."
                )
            )
        return host_prefix_expression.format(**format_kwargs)


class QuerySerializer(Serializer):
    TIMESTAMP_FORMAT = 'iso8601'

    def serialize_to_request(self, parameters, operation_model):
        shape = operation_model.input_shape
        serialized = self._create_default_request()
        serialized['method'] = operation_model.http.get(
            'method', self.DEFAULT_METHOD
        )
        serialized['headers'] = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        }
        # The query serializer only deals with body params so
        # that's what we hand off the _serialize_* methods.
        body_params = self.MAP_TYPE()
        body_params['Action'] = operation_model.name
        body_params['Version'] = operation_model.metadata['apiVersion']
        if shape is not None:
            self._serialize(body_params, parameters, shape)
        serialized['body'] = body_params

        host_prefix = self._expand_host_prefix(parameters, operation_model)
        if host_prefix is not None:
            serialized['host_prefix'] = host_prefix

        return serialized

    def _serialize(self, serialized, value, shape, prefix=''):
        # serialized: The dict that is incrementally added to with the
        #             final serialized parameters.
        # value: The current user input value.
        # shape: The shape object that describes the structure of the
        #        input.
        # prefix: The incrementally built up prefix for the serialized
        #         key (i.e Foo.bar.members.1).
        method = getattr(
            self,
            f'_serialize_type_{shape.type_name}',
            self._default_serialize,
        )
        method(serialized, value, shape, prefix=prefix)

    def _serialize_type_structure(self, serialized, value, shape, prefix=''):
        members = shape.members
        for key, value in value.items():
            member_shape = members[key]
            member_prefix = self._get_serialized_name(member_shape, key)
            if prefix:
                member_prefix = f'{prefix}.{member_prefix}'
            self._serialize(serialized, value, member_shape, member_prefix)

    def _serialize_type_list(self, serialized, value, shape, prefix=''):
        if not value:
            # The query protocol serializes empty lists.
            serialized[prefix] = ''
            return
        if self._is_shape_flattened(shape):
            list_prefix = prefix
            if shape.member.serialization.get('name'):
                name = self._get_serialized_name(shape.member, default_name='')
                # Replace '.Original' with '.{name}'.
                list_prefix = '.'.join(prefix.split('.')[:-1] + [name])
        else:
            list_name = shape.member.serialization.get('name', 'member')
            list_prefix = f'{prefix}.{list_name}'
        for i, element in enumerate(value, 1):
            element_prefix = f'{list_prefix}.{i}'
            element_shape = shape.member
            self._serialize(serialized, element, element_shape, element_prefix)

    def _serialize_type_map(self, serialized, value, shape, prefix=''):
        if self._is_shape_flattened(shape):
            full_prefix = prefix
        else:
            full_prefix = f'{prefix}.entry'
        template = full_prefix + '.{i}.{suffix}'
        key_shape = shape.key
        value_shape = shape.value
        key_suffix = self._get_serialized_name(key_shape, default_name='key')
        value_suffix = self._get_serialized_name(value_shape, 'value')
        for i, key in enumerate(value, 1):
            key_prefix = template.format(i=i, suffix=key_suffix)
            value_prefix = template.format(i=i, suffix=value_suffix)
            self._serialize(serialized, key, key_shape, key_prefix)
            self._serialize(serialized, value[key], value_shape, value_prefix)

    def _serialize_type_blob(self, serialized, value, shape, prefix=''):
        # Blob args must be base64 encoded.
        serialized[prefix] = self._get_base64(value)

    def _serialize_type_timestamp(self, serialized, value, shape, prefix=''):
        serialized[prefix] = self._convert_timestamp_to_str(
            value, shape.serialization.get('timestampFormat')
        )

    def _serialize_type_boolean(self, serialized, value, shape, prefix=''):
        if value:
            serialized[prefix] = 'true'
        else:
            serialized[prefix] = 'false'

    def _default_serialize(self, serialized, value, shape, prefix=''):
        serialized[prefix] = value

    def _is_shape_flattened(self, shape):
        return shape.serialization.get('flattened')


class EC2Serializer(QuerySerializer):
    """EC2 specific customizations to the query protocol serializers.

    The EC2 model is almost, but not exactly, similar to the query protocol
    serializer.  This class encapsulates those differences.  The model
    will have be marked with a ``protocol`` of ``ec2``, so you don't need
    to worry about wiring this class up correctly.

    """

    def _get_serialized_name(self, shape, default_name):
        # Returns the serialized name for the shape if it exists.
        # Otherwise it will return the passed in default_name.
        if 'queryName' in shape.serialization:
            return shape.serialization['queryName']
        elif 'name' in shape.serialization:
            # A locationName is always capitalized
            # on input for the ec2 protocol.
            name = shape.serialization['name']
            return name[0].upper() + name[1:]
        else:
            return default_name

    def _serialize_type_list(self, serialized, value, shape, prefix=''):
        for i, element in enumerate(value, 1):
            element_prefix = f'{prefix}.{i}'
            element_shape = shape.member
            self._serialize(serialized, element, element_shape, element_prefix)


class JSONSerializer(Serializer):
    TIMESTAMP_FORMAT = 'unixtimestamp'

    def serialize_to_request(self, parameters, operation_model):
        target = '{}.{}'.format(
            operation_model.metadata['targetPrefix'],
            operation_model.name,
        )
        json_version = operation_model.metadata['jsonVersion']
        serialized = self._create_default_request()
        serialized['method'] = operation_model.http.get(
            'method', self.DEFAULT_METHOD
        )
        serialized['headers'] = {
            'X-Amz-Target': target,
            'Content-Type': f'application/x-amz-json-{json_version}',
        }
        body = self.MAP_TYPE()
        input_shape = operation_model.input_shape
        if input_shape is not None:
            self._serialize(body, parameters, input_shape)
        serialized['body'] = json.dumps(body).encode(self.DEFAULT_ENCODING)

        host_prefix = self._expand_host_prefix(parameters, operation_model)
        if host_prefix is not None:
            serialized['host_prefix'] = host_prefix

        return serialized

    def _serialize(self, serialized, value, shape, key=None):
        method = getattr(
            self,
            f'_serialize_type_{shape.type_name}',
            self._default_serialize,
        )
        method(serialized, value, shape, key)

    def _serialize_type_structure(self, serialized, value, shape, key):
        if shape.is_document_type:
            serialized[key] = value
        else:
            if key is not None:
                # If a key is provided, this is a result of a recursive
                # call so we need to add a new child dict as the value
                # of the passed in serialized dict.  We'll then add
                # all the structure members as key/vals in the new serialized
                # dictionary we just created.
                new_serialized = self.MAP_TYPE()
                serialized[key] = new_serialized
                serialized = new_serialized
            members = shape.members
            for member_key, member_value in value.items():
                member_shape = members[member_key]
                if 'name' in member_shape.serialization:
                    member_key = member_shape.serialization['name']
                self._serialize(
                    serialized, member_value, member_shape, member_key
                )

    def _serialize_type_map(self, serialized, value, shape, key):
        map_obj = self.MAP_TYPE()
        serialized[key] = map_obj
        for sub_key, sub_value in value.items():
            self._serialize(map_obj, sub_value, shape.value, sub_key)

    def _serialize_type_list(self, serialized, value, shape, key):
        list_obj = []
        serialized[key] = list_obj
        for list_item in value:
            wrapper = {}
            # The JSON list serialization is the only case where we aren't
            # setting a key on a dict.  We handle this by using
            # a __current__ key on a wrapper dict to serialize each
            # list item before appending it to the serialized list.
            self._serialize(wrapper, list_item, shape.member, "__current__")
            list_obj.append(wrapper["__current__"])

    def _default_serialize(self, serialized, value, shape, key):
        serialized[key] = value

    def _serialize_type_timestamp(self, serialized, value, shape, key):
        serialized[key] = self._convert_timestamp_to_str(
            value, shape.serialization.get('timestampFormat')
        )

    def _serialize_type_blob(self, serialized, value, shape, key):
        serialized[key] = self._get_base64(value)


class BaseRestSerializer(Serializer):
    """Base class for rest protocols.

    The only variance between the various rest protocols is the
    way that the body is serialized.  All other aspects (headers, uri, etc.)
    are the same and logic for serializing those aspects lives here.

    Subclasses must implement the ``_serialize_body_params`` method.

    """

    QUERY_STRING_TIMESTAMP_FORMAT = 'iso8601'
    HEADER_TIMESTAMP_FORMAT = 'rfc822'
    # This is a list of known values for the "location" key in the
    # serialization dict.  The location key tells us where on the request
    # to put the serialized value.
    KNOWN_LOCATIONS = ['uri', 'querystring', 'header', 'headers']

    def serialize_to_request(self, parameters, operation_model):
        serialized = self._create_default_request()
        serialized['method'] = operation_model.http.get(
            'method', self.DEFAULT_METHOD
        )
        shape = operation_model.input_shape
        if shape is None:
            serialized['url_path'] = operation_model.http['requestUri']
            return serialized
        shape_members = shape.members
        # While the ``serialized`` key holds the final serialized request
        # data, we need interim dicts for the various locations of the
        # request.  We need this for the uri_path_kwargs and the
        # query_string_kwargs because they are templated, so we need
        # to gather all the needed data for the string template,
        # then we render the template.  The body_kwargs is needed
        # because once we've collected them all, we run them through
        # _serialize_body_params, which for rest-json, creates JSON,
        # and for rest-xml, will create XML.  This is what the
        # ``partitioned`` dict below is for.
        partitioned = {
            'uri_path_kwargs': self.MAP_TYPE(),
            'query_string_kwargs': self.MAP_TYPE(),
            'body_kwargs': self.MAP_TYPE(),
            'headers': self.MAP_TYPE(),
        }
        for param_name, param_value in parameters.items():
            if param_value is None:
                # Don't serialize any parameter with a None value.
                continue
            self._partition_parameters(
                partitioned, param_name, param_value, shape_members
            )
        serialized['url_path'] = self._render_uri_template(
            operation_model.http['requestUri'], partitioned['uri_path_kwargs']
        )

        if 'authPath' in operation_model.http:
            serialized['auth_path'] = self._render_uri_template(
                operation_model.http['authPath'],
                partitioned['uri_path_kwargs'],
            )
        # Note that we lean on the http implementation to handle the case
        # where the requestUri path already has query parameters.
        # The bundled http client, requests, already supports this.
        serialized['query_string'] = partitioned['query_string_kwargs']
        if partitioned['headers']:
            serialized['headers'] = partitioned['headers']
        self._serialize_payload(
            partitioned, parameters, serialized, shape, shape_members
        )
        self._serialize_content_type(serialized, shape, shape_members)

        host_prefix = self._expand_host_prefix(parameters, operation_model)
        if host_prefix is not None:
            serialized['host_prefix'] = host_prefix

        return serialized

    def _render_uri_template(self, uri_template, params):
        # We need to handle two cases::
        #
        # /{Bucket}/foo
        # /{Key+}/bar
        # A label ending with '+' is greedy.  There can only
        # be one greedy key.
        encoded_params = {}
        for template_param in re.findall(r'{(.*?)}', uri_template):
            if template_param.endswith('+'):
                encoded_params[template_param] = percent_encode(
                    params[template_param[:-1]], safe='/~'
                )
            else:
                encoded_params[template_param] = percent_encode(
                    params[template_param]
                )
        return uri_template.format(**encoded_params)

    def _serialize_payload(
        self, partitioned, parameters, serialized, shape, shape_members
    ):
        # partitioned - The user input params partitioned by location.
        # parameters - The user input params.
        # serialized - The final serialized request dict.
        # shape - Describes the expected input shape
        # shape_members - The members of the input struct shape
        payload_member = shape.serialization.get('payload')
        if self._has_streaming_payload(payload_member, shape_members):
            # If it's streaming, then the body is just the
            # value of the payload.
            body_payload = parameters.get(payload_member, b'')
            body_payload = self._encode_payload(body_payload)
            serialized['body'] = body_payload
        elif payload_member is not None:
            # If there's a payload member, we serialized that
            # member to they body.
            body_params = parameters.get(payload_member)
            if body_params is not None:
                serialized['body'] = self._serialize_body_params(
                    body_params, shape_members[payload_member]
                )
            else:
                serialized['body'] = self._serialize_empty_body()
        elif partitioned['body_kwargs']:
            serialized['body'] = self._serialize_body_params(
                partitioned['body_kwargs'], shape
            )
        elif self._requires_empty_body(shape):
            serialized['body'] = self._serialize_empty_body()

    def _serialize_empty_body(self):
        return b''

    def _serialize_content_type(self, serialized, shape, shape_members):
        """
        Some protocols require varied Content-Type headers
        depending on user input. This allows subclasses to apply
        this conditionally.
        """
        pass

    def _requires_empty_body(self, shape):
        """
        Some protocols require a specific body to represent an empty
        payload. This allows subclasses to apply this conditionally.
        """
        return False

    def _has_streaming_payload(self, payload, shape_members):
        """Determine if payload is streaming (a blob or string)."""
        return payload is not None and shape_members[payload].type_name in (
            'blob',
            'string',
        )

    def _encode_payload(self, body):
        if isinstance(body, str):
            return body.encode(self.DEFAULT_ENCODING)
        return body

    def _partition_parameters(
        self, partitioned, param_name, param_value, shape_members
    ):
        # This takes the user provided input parameter (``param``)
        # and figures out where they go in the request dict.
        # Some params are HTTP headers, some are used in the URI, some
        # are in the request body.  This method deals with this.
        member = shape_members[param_name]
        location = member.serialization.get('location')
        key_name = member.serialization.get('name', param_name)
        if location == 'uri':
            partitioned['uri_path_kwargs'][key_name] = param_value
        elif location == 'querystring':
            if isinstance(param_value, dict):
                partitioned['query_string_kwargs'].update(param_value)
            elif isinstance(param_value, bool):
                bool_str = str(param_value).lower()
                partitioned['query_string_kwargs'][key_name] = bool_str
            elif member.type_name == 'timestamp':
                timestamp_format = member.serialization.get(
                    'timestampFormat', self.QUERY_STRING_TIMESTAMP_FORMAT
                )
                timestamp = self._convert_timestamp_to_str(
                    param_value, timestamp_format
                )
                partitioned['query_string_kwargs'][key_name] = timestamp
            else:
                partitioned['query_string_kwargs'][key_name] = param_value
        elif location == 'header':
            shape = shape_members[param_name]
            if not param_value and shape.type_name == 'list':
                # Empty lists should not be set on the headers
                return
            value = self._convert_header_value(shape, param_value)
            partitioned['headers'][key_name] = str(value)
        elif location == 'headers':
            # 'headers' is a bit of an oddball.  The ``key_name``
            # is actually really a prefix for the header names:
            header_prefix = key_name
            # The value provided by the user is a dict so we'll be
            # creating multiple header key/val pairs.  The key
            # name to use for each header is the header_prefix (``key_name``)
            # plus the key provided by the user.
            self._do_serialize_header_map(
                header_prefix, partitioned['headers'], param_value
            )
        else:
            partitioned['body_kwargs'][param_name] = param_value

    def _do_serialize_header_map(self, header_prefix, headers, user_input):
        for key, val in user_input.items():
            full_key = header_prefix + key
            headers[full_key] = val

    def _serialize_body_params(self, params, shape):
        raise NotImplementedError('_serialize_body_params')

    def _convert_header_value(self, shape, value):
        if shape.type_name == 'timestamp':
            datetime_obj = parse_to_aware_datetime(value)
            timestamp = calendar.timegm(datetime_obj.utctimetuple())
            timestamp_format = shape.serialization.get(
                'timestampFormat', self.HEADER_TIMESTAMP_FORMAT
            )
            return self._convert_timestamp_to_str(timestamp, timestamp_format)
        elif shape.type_name == 'list':
            converted_value = [
                self._convert_header_value(shape.member, v)
                for v in value
                if v is not None
            ]
            return ",".join(converted_value)
        elif is_json_value_header(shape):
            # Serialize with no spaces after separators to save space in
            # the header.
            return self._get_base64(json.dumps(value, separators=(',', ':')))
        else:
            return value


class RestJSONSerializer(BaseRestSerializer, JSONSerializer):
    def _serialize_empty_body(self):
        return b'{}'

    def _requires_empty_body(self, shape):
        """
        Serialize an empty JSON object whenever the shape has
        members not targeting a location.
        """
        for member, val in shape.members.items():
            if 'location' not in val.serialization:
                return True
        return False

    def _serialize_content_type(self, serialized, shape, shape_members):
        """Set Content-Type to application/json for all structured bodies."""
        payload = shape.serialization.get('payload')
        if self._has_streaming_payload(payload, shape_members):
            # Don't apply content-type to streaming bodies
            return

        has_body = serialized['body'] != b''
        has_content_type = has_header('Content-Type', serialized['headers'])
        if has_body and not has_content_type:
            serialized['headers']['Content-Type'] = 'application/json'

    def _serialize_body_params(self, params, shape):
        serialized_body = self.MAP_TYPE()
        self._serialize(serialized_body, params, shape)
        return json.dumps(serialized_body).encode(self.DEFAULT_ENCODING)


class RestXMLSerializer(BaseRestSerializer):
    TIMESTAMP_FORMAT = 'iso8601'

    def _serialize_body_params(self, params, shape):
        root_name = shape.serialization['name']
        pseudo_root = ElementTree.Element('')
        self._serialize(shape, params, pseudo_root, root_name)
        real_root = list(pseudo_root)[0]
        return ElementTree.tostring(real_root, encoding=self.DEFAULT_ENCODING)

    def _serialize(self, shape, params, xmlnode, name):
        method = getattr(
            self,
            f'_serialize_type_{shape.type_name}',
            self._default_serialize,
        )
        method(xmlnode, params, shape, name)

    def _serialize_type_structure(self, xmlnode, params, shape, name):
        structure_node = ElementTree.SubElement(xmlnode, name)

        if 'xmlNamespace' in shape.serialization:
            namespace_metadata = shape.serialization['xmlNamespace']
            attribute_name = 'xmlns'
            if namespace_metadata.get('prefix'):
                attribute_name += f":{namespace_metadata['prefix']}"
            structure_node.attrib[attribute_name] = namespace_metadata['uri']
        for key, value in params.items():
            member_shape = shape.members[key]
            member_name = member_shape.serialization.get('name', key)
            # We need to special case member shapes that are marked as an
            # xmlAttribute.  Rather than serializing into an XML child node,
            # we instead serialize the shape to an XML attribute of the
            # *current* node.
            if value is None:
                # Don't serialize any param whose value is None.
                return
            if member_shape.serialization.get('xmlAttribute'):
                # xmlAttributes must have a serialization name.
                xml_attribute_name = member_shape.serialization['name']
                structure_node.attrib[xml_attribute_name] = value
                continue
            self._serialize(member_shape, value, structure_node, member_name)

    def _serialize_type_list(self, xmlnode, params, shape, name):
        member_shape = shape.member
        if shape.serialization.get('flattened'):
            element_name = name
            list_node = xmlnode
        else:
            element_name = member_shape.serialization.get('name', 'member')
            list_node = ElementTree.SubElement(xmlnode, name)
        for item in params:
            self._serialize(member_shape, item, list_node, element_name)

    def _serialize_type_map(self, xmlnode, params, shape, name):
        # Given the ``name`` of MyMap, and input of {"key1": "val1"}
        # we serialize this as:
        #   <MyMap>
        #     <entry>
        #       <key>key1</key>
        #       <value>val1</value>
        #     </entry>
        #  </MyMap>
        node = ElementTree.SubElement(xmlnode, name)
        # TODO: handle flattened maps.
        for key, value in params.items():
            entry_node = ElementTree.SubElement(node, 'entry')
            key_name = self._get_serialized_name(shape.key, default_name='key')
            val_name = self._get_serialized_name(
                shape.value, default_name='value'
            )
            self._serialize(shape.key, key, entry_node, key_name)
            self._serialize(shape.value, value, entry_node, val_name)

    def _serialize_type_boolean(self, xmlnode, params, shape, name):
        # For scalar types, the 'params' attr is actually just a scalar
        # value representing the data we need to serialize as a boolean.
        # It will either be 'true' or 'false'
        node = ElementTree.SubElement(xmlnode, name)
        if params:
            str_value = 'true'
        else:
            str_value = 'false'
        node.text = str_value

    def _serialize_type_blob(self, xmlnode, params, shape, name):
        node = ElementTree.SubElement(xmlnode, name)
        node.text = self._get_base64(params)

    def _serialize_type_timestamp(self, xmlnode, params, shape, name):
        node = ElementTree.SubElement(xmlnode, name)
        node.text = self._convert_timestamp_to_str(
            params, shape.serialization.get('timestampFormat')
        )

    def _default_serialize(self, xmlnode, params, shape, name):
        node = ElementTree.SubElement(xmlnode, name)
        node.text = str(params)


SERIALIZERS = {
    'ec2': EC2Serializer,
    'query': QuerySerializer,
    'json': JSONSerializer,
    'rest-json': RestJSONSerializer,
    'rest-xml': RestXMLSerializer,
}
