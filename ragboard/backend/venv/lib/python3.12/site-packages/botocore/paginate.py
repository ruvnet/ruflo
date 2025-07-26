# Copyright 2012-2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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

import base64
import json
import logging
from itertools import tee

import jmespath

from botocore.exceptions import PaginationError
from botocore.utils import merge_dicts, set_value_from_jmespath

log = logging.getLogger(__name__)


class TokenEncoder:
    """Encodes dictionaries into opaque strings.

    This for the most part json dumps + base64 encoding, but also supports
    having bytes in the dictionary in addition to the types that json can
    handle by default.

    This is intended for use in encoding pagination tokens, which in some
    cases can be complex structures and / or contain bytes.
    """

    def encode(self, token):
        """Encodes a dictionary to an opaque string.

        :type token: dict
        :param token: A dictionary containing pagination information,
            particularly the service pagination token(s) but also other boto
            metadata.

        :rtype: str
        :returns: An opaque string
        """
        try:
            # Try just using json dumps first to avoid having to traverse
            # and encode the dict. In 99.9999% of cases this will work.
            json_string = json.dumps(token)
        except (TypeError, UnicodeDecodeError):
            # If normal dumping failed, go through and base64 encode all bytes.
            encoded_token, encoded_keys = self._encode(token, [])

            # Save the list of all the encoded key paths. We can safely
            # assume that no service will ever use this key.
            encoded_token['boto_encoded_keys'] = encoded_keys

            # Now that the bytes are all encoded, dump the json.
            json_string = json.dumps(encoded_token)

        # base64 encode the json string to produce an opaque token string.
        return base64.b64encode(json_string.encode('utf-8')).decode('utf-8')

    def _encode(self, data, path):
        """Encode bytes in given data, keeping track of the path traversed."""
        if isinstance(data, dict):
            return self._encode_dict(data, path)
        elif isinstance(data, list):
            return self._encode_list(data, path)
        elif isinstance(data, bytes):
            return self._encode_bytes(data, path)
        else:
            return data, []

    def _encode_list(self, data, path):
        """Encode any bytes in a list, noting the index of what is encoded."""
        new_data = []
        encoded = []
        for i, value in enumerate(data):
            new_path = path + [i]
            new_value, new_encoded = self._encode(value, new_path)
            new_data.append(new_value)
            encoded.extend(new_encoded)
        return new_data, encoded

    def _encode_dict(self, data, path):
        """Encode any bytes in a dict, noting the index of what is encoded."""
        new_data = {}
        encoded = []
        for key, value in data.items():
            new_path = path + [key]
            new_value, new_encoded = self._encode(value, new_path)
            new_data[key] = new_value
            encoded.extend(new_encoded)
        return new_data, encoded

    def _encode_bytes(self, data, path):
        """Base64 encode a byte string."""
        return base64.b64encode(data).decode('utf-8'), [path]


class TokenDecoder:
    """Decodes token strings back into dictionaries.

    This performs the inverse operation to the TokenEncoder, accepting
    opaque strings and decoding them into a useable form.
    """

    def decode(self, token):
        """Decodes an opaque string to a dictionary.

        :type token: str
        :param token: A token string given by the botocore pagination
            interface.

        :rtype: dict
        :returns: A dictionary containing pagination information,
            particularly the service pagination token(s) but also other boto
            metadata.
        """
        json_string = base64.b64decode(token.encode('utf-8')).decode('utf-8')
        decoded_token = json.loads(json_string)

        # Remove the encoding metadata as it is read since it will no longer
        # be needed.
        encoded_keys = decoded_token.pop('boto_encoded_keys', None)
        if encoded_keys is None:
            return decoded_token
        else:
            return self._decode(decoded_token, encoded_keys)

    def _decode(self, token, encoded_keys):
        """Find each encoded value and decode it."""
        for key in encoded_keys:
            encoded = self._path_get(token, key)
            decoded = base64.b64decode(encoded.encode('utf-8'))
            self._path_set(token, key, decoded)
        return token

    def _path_get(self, data, path):
        """Return the nested data at the given path.

        For instance:
            data = {'foo': ['bar', 'baz']}
            path = ['foo', 0]
            ==> 'bar'
        """
        # jmespath isn't used here because it would be difficult to actually
        # create the jmespath query when taking all of the unknowns of key
        # structure into account. Gross though this is, it is simple and not
        # very error prone.
        d = data
        for step in path:
            d = d[step]
        return d

    def _path_set(self, data, path, value):
        """Set the value of a key in the given data.

        Example:
            data = {'foo': ['bar', 'baz']}
            path = ['foo', 1]
            value = 'bin'
            ==> data = {'foo': ['bar', 'bin']}
        """
        container = self._path_get(data, path[:-1])
        container[path[-1]] = value


class PaginatorModel:
    def __init__(self, paginator_config):
        self._paginator_config = paginator_config['pagination']

    def get_paginator(self, operation_name):
        try:
            single_paginator_config = self._paginator_config[operation_name]
        except KeyError:
            raise ValueError(
                f"Paginator for operation does not exist: {operation_name}"
            )
        return single_paginator_config


class PageIterator:
    """An iterable object to paginate API results.
    Please note it is NOT a python iterator.
    Use ``iter`` to wrap this as a generator.
    """

    def __init__(
        self,
        method,
        input_token,
        output_token,
        more_results,
        result_keys,
        non_aggregate_keys,
        limit_key,
        max_items,
        starting_token,
        page_size,
        op_kwargs,
    ):
        self._method = method
        self._input_token = input_token
        self._output_token = output_token
        self._more_results = more_results
        self._result_keys = result_keys
        self._max_items = max_items
        self._limit_key = limit_key
        self._starting_token = starting_token
        self._page_size = page_size
        self._op_kwargs = op_kwargs
        self._resume_token = None
        self._non_aggregate_key_exprs = non_aggregate_keys
        self._non_aggregate_part = {}
        self._token_encoder = TokenEncoder()
        self._token_decoder = TokenDecoder()

    @property
    def result_keys(self):
        return self._result_keys

    @property
    def resume_token(self):
        """Token to specify to resume pagination."""
        return self._resume_token

    @resume_token.setter
    def resume_token(self, value):
        if not isinstance(value, dict):
            raise ValueError(f"Bad starting token: {value}")

        if 'boto_truncate_amount' in value:
            token_keys = sorted(self._input_token + ['boto_truncate_amount'])
        else:
            token_keys = sorted(self._input_token)
        dict_keys = sorted(value.keys())

        if token_keys == dict_keys:
            self._resume_token = self._token_encoder.encode(value)
        else:
            raise ValueError(f"Bad starting token: {value}")

    @property
    def non_aggregate_part(self):
        return self._non_aggregate_part

    def __iter__(self):
        current_kwargs = self._op_kwargs
        previous_next_token = None
        next_token = {key: None for key in self._input_token}
        if self._starting_token is not None:
            # If the starting token exists, populate the next_token with the
            # values inside it. This ensures that we have the service's
            # pagination token on hand if we need to truncate after the
            # first response.
            next_token = self._parse_starting_token()[0]
        # The number of items from result_key we've seen so far.
        total_items = 0
        first_request = True
        primary_result_key = self.result_keys[0]
        starting_truncation = 0
        self._inject_starting_params(current_kwargs)
        while True:
            response = self._make_request(current_kwargs)
            parsed = self._extract_parsed_response(response)
            if first_request:
                # The first request is handled differently.  We could
                # possibly have a resume/starting token that tells us where
                # to index into the retrieved page.
                if self._starting_token is not None:
                    starting_truncation = self._handle_first_request(
                        parsed, primary_result_key, starting_truncation
                    )
                first_request = False
                self._record_non_aggregate_key_values(parsed)
            else:
                # If this isn't the first request, we have already sliced into
                # the first request and had to make additional requests after.
                # We no longer need to add this to truncation.
                starting_truncation = 0
            current_response = primary_result_key.search(parsed)
            if current_response is None:
                current_response = []
            num_current_response = len(current_response)
            truncate_amount = 0
            if self._max_items is not None:
                truncate_amount = (
                    total_items + num_current_response - self._max_items
                )
            if truncate_amount > 0:
                self._truncate_response(
                    parsed,
                    primary_result_key,
                    truncate_amount,
                    starting_truncation,
                    next_token,
                )
                yield response
                break
            else:
                yield response
                total_items += num_current_response
                next_token = self._get_next_token(parsed)
                if all(t is None for t in next_token.values()):
                    break
                if (
                    self._max_items is not None
                    and total_items == self._max_items
                ):
                    # We're on a page boundary so we can set the current
                    # next token to be the resume token.
                    self.resume_token = next_token
                    break
                if (
                    previous_next_token is not None
                    and previous_next_token == next_token
                ):
                    message = (
                        f"The same next token was received "
                        f"twice: {next_token}"
                    )
                    raise PaginationError(message=message)
                self._inject_token_into_kwargs(current_kwargs, next_token)
                previous_next_token = next_token

    def search(self, expression):
        """Applies a JMESPath expression to a paginator

        Each page of results is searched using the provided JMESPath
        expression. If the result is not a list, it is yielded
        directly. If the result is a list, each element in the result
        is yielded individually (essentially implementing a flatmap in
        which the JMESPath search is the mapping function).

        :type expression: str
        :param expression: JMESPath expression to apply to each page.

        :return: Returns an iterator that yields the individual
            elements of applying a JMESPath expression to each page of
            results.
        """
        compiled = jmespath.compile(expression)
        for page in self:
            results = compiled.search(page)
            if isinstance(results, list):
                yield from results
            else:
                # Yield result directly if it is not a list.
                yield results

    def _make_request(self, current_kwargs):
        return self._method(**current_kwargs)

    def _extract_parsed_response(self, response):
        return response

    def _record_non_aggregate_key_values(self, response):
        non_aggregate_keys = {}
        for expression in self._non_aggregate_key_exprs:
            result = expression.search(response)
            set_value_from_jmespath(
                non_aggregate_keys, expression.expression, result
            )
        self._non_aggregate_part = non_aggregate_keys

    def _inject_starting_params(self, op_kwargs):
        # If the user has specified a starting token we need to
        # inject that into the operation's kwargs.
        if self._starting_token is not None:
            # Don't need to do anything special if there is no starting
            # token specified.
            next_token = self._parse_starting_token()[0]
            self._inject_token_into_kwargs(op_kwargs, next_token)
        if self._page_size is not None:
            # Pass the page size as the parameter name for limiting
            # page size, also known as the limit_key.
            op_kwargs[self._limit_key] = self._page_size

    def _inject_token_into_kwargs(self, op_kwargs, next_token):
        for name, token in next_token.items():
            if (token is not None) and (token != 'None'):
                op_kwargs[name] = token
            elif name in op_kwargs:
                del op_kwargs[name]

    def _handle_first_request(
        self, parsed, primary_result_key, starting_truncation
    ):
        # If the payload is an array or string, we need to slice into it
        # and only return the truncated amount.
        starting_truncation = self._parse_starting_token()[1]
        all_data = primary_result_key.search(parsed)
        if isinstance(all_data, (list, str)):
            data = all_data[starting_truncation:]
        else:
            data = None
        set_value_from_jmespath(parsed, primary_result_key.expression, data)
        # We also need to truncate any secondary result keys
        # because they were not truncated in the previous last
        # response.
        for token in self.result_keys:
            if token == primary_result_key:
                continue
            sample = token.search(parsed)
            if isinstance(sample, list):
                empty_value = []
            elif isinstance(sample, str):
                empty_value = ''
            elif isinstance(sample, (int, float)):
                empty_value = 0
            else:
                empty_value = None
            set_value_from_jmespath(parsed, token.expression, empty_value)
        return starting_truncation

    def _truncate_response(
        self,
        parsed,
        primary_result_key,
        truncate_amount,
        starting_truncation,
        next_token,
    ):
        original = primary_result_key.search(parsed)
        if original is None:
            original = []
        amount_to_keep = len(original) - truncate_amount
        truncated = original[:amount_to_keep]
        set_value_from_jmespath(
            parsed, primary_result_key.expression, truncated
        )
        # The issue here is that even though we know how much we've truncated
        # we need to account for this globally including any starting
        # left truncation. For example:
        # Raw response: [0,1,2,3]
        # Starting index: 1
        # Max items: 1
        # Starting left truncation: [1, 2, 3]
        # End right truncation for max items: [1]
        # However, even though we only kept 1, this is post
        # left truncation so the next starting index should be 2, not 1
        # (left_truncation + amount_to_keep).
        next_token['boto_truncate_amount'] = (
            amount_to_keep + starting_truncation
        )
        self.resume_token = next_token

    def _get_next_token(self, parsed):
        if self._more_results is not None:
            if not self._more_results.search(parsed):
                return {}
        next_tokens = {}
        for output_token, input_key in zip(
            self._output_token, self._input_token
        ):
            next_token = output_token.search(parsed)
            # We do not want to include any empty strings as actual tokens.
            # Treat them as None.
            if next_token:
                next_tokens[input_key] = next_token
            else:
                next_tokens[input_key] = None
        return next_tokens

    def result_key_iters(self):
        teed_results = tee(self, len(self.result_keys))
        return [
            ResultKeyIterator(i, result_key)
            for i, result_key in zip(teed_results, self.result_keys)
        ]

    def build_full_result(self):
        complete_result = {}
        for response in self:
            page = response
            # We want to try to catch operation object pagination
            # and format correctly for those. They come in the form
            # of a tuple of two elements: (http_response, parsed_responsed).
            # We want the parsed_response as that is what the page iterator
            # uses. We can remove it though once operation objects are removed.
            if isinstance(response, tuple) and len(response) == 2:
                page = response[1]
            # We're incrementally building the full response page
            # by page.  For each page in the response we need to
            # inject the necessary components from the page
            # into the complete_result.
            for result_expression in self.result_keys:
                # In order to incrementally update a result key
                # we need to search the existing value from complete_result,
                # then we need to search the _current_ page for the
                # current result key value.  Then we append the current
                # value onto the existing value, and re-set that value
                # as the new value.
                result_value = result_expression.search(page)
                if result_value is None:
                    continue
                existing_value = result_expression.search(complete_result)
                if existing_value is None:
                    # Set the initial result
                    set_value_from_jmespath(
                        complete_result,
                        result_expression.expression,
                        result_value,
                    )
                    continue
                # Now both result_value and existing_value contain something
                if isinstance(result_value, list):
                    existing_value.extend(result_value)
                elif isinstance(result_value, (int, float, str)):
                    # Modify the existing result with the sum or concatenation
                    set_value_from_jmespath(
                        complete_result,
                        result_expression.expression,
                        existing_value + result_value,
                    )
        merge_dicts(complete_result, self.non_aggregate_part)
        if self.resume_token is not None:
            complete_result['NextToken'] = self.resume_token
        return complete_result

    def _parse_starting_token(self):
        if self._starting_token is None:
            return None

        # The starting token is a dict passed as a base64 encoded string.
        next_token = self._starting_token
        try:
            next_token = self._token_decoder.decode(next_token)
            index = 0
            if 'boto_truncate_amount' in next_token:
                index = next_token.get('boto_truncate_amount')
                del next_token['boto_truncate_amount']
        except (ValueError, TypeError):
            next_token, index = self._parse_starting_token_deprecated()
        return next_token, index

    def _parse_starting_token_deprecated(self):
        """
        This handles parsing of old style starting tokens, and attempts to
        coerce them into the new style.
        """
        log.debug(
            "Attempting to fall back to old starting token parser. For "
            f"token: {self._starting_token}"
        )
        if self._starting_token is None:
            return None

        parts = self._starting_token.split('___')
        next_token = []
        index = 0
        if len(parts) == len(self._input_token) + 1:
            try:
                index = int(parts.pop())
            except ValueError:
                # This doesn't look like a valid old-style token, so we're
                # passing it along as an opaque service token.
                parts = [self._starting_token]

        for part in parts:
            if part == 'None':
                next_token.append(None)
            else:
                next_token.append(part)
        return self._convert_deprecated_starting_token(next_token), index

    def _convert_deprecated_starting_token(self, deprecated_token):
        """
        This attempts to convert a deprecated starting token into the new
        style.
        """
        len_deprecated_token = len(deprecated_token)
        len_input_token = len(self._input_token)
        if len_deprecated_token > len_input_token:
            raise ValueError(f"Bad starting token: {self._starting_token}")
        elif len_deprecated_token < len_input_token:
            log.debug(
                "Old format starting token does not contain all input "
                "tokens. Setting the rest, in order, as None."
            )
            for i in range(len_input_token - len_deprecated_token):
                deprecated_token.append(None)
        return dict(zip(self._input_token, deprecated_token))


class Paginator:
    PAGE_ITERATOR_CLS = PageIterator

    def __init__(self, method, pagination_config, model):
        self._model = model
        self._method = method
        self._pagination_cfg = pagination_config
        self._output_token = self._get_output_tokens(self._pagination_cfg)
        self._input_token = self._get_input_tokens(self._pagination_cfg)
        self._more_results = self._get_more_results_token(self._pagination_cfg)
        self._non_aggregate_keys = self._get_non_aggregate_keys(
            self._pagination_cfg
        )
        self._result_keys = self._get_result_keys(self._pagination_cfg)
        self._limit_key = self._get_limit_key(self._pagination_cfg)

    @property
    def result_keys(self):
        return self._result_keys

    def _get_non_aggregate_keys(self, config):
        keys = []
        for key in config.get('non_aggregate_keys', []):
            keys.append(jmespath.compile(key))
        return keys

    def _get_output_tokens(self, config):
        output = []
        output_token = config['output_token']
        if not isinstance(output_token, list):
            output_token = [output_token]
        for config in output_token:
            output.append(jmespath.compile(config))
        return output

    def _get_input_tokens(self, config):
        input_token = self._pagination_cfg['input_token']
        if not isinstance(input_token, list):
            input_token = [input_token]
        return input_token

    def _get_more_results_token(self, config):
        more_results = config.get('more_results')
        if more_results is not None:
            return jmespath.compile(more_results)

    def _get_result_keys(self, config):
        result_key = config.get('result_key')
        if result_key is not None:
            if not isinstance(result_key, list):
                result_key = [result_key]
            result_key = [jmespath.compile(rk) for rk in result_key]
            return result_key

    def _get_limit_key(self, config):
        return config.get('limit_key')

    def paginate(self, **kwargs):
        """Create paginator object for an operation.

        This returns an iterable object.  Iterating over
        this object will yield a single page of a response
        at a time.

        """
        page_params = self._extract_paging_params(kwargs)
        return self.PAGE_ITERATOR_CLS(
            self._method,
            self._input_token,
            self._output_token,
            self._more_results,
            self._result_keys,
            self._non_aggregate_keys,
            self._limit_key,
            page_params['MaxItems'],
            page_params['StartingToken'],
            page_params['PageSize'],
            kwargs,
        )

    def _extract_paging_params(self, kwargs):
        pagination_config = kwargs.pop('PaginationConfig', {})
        max_items = pagination_config.get('MaxItems', None)
        if max_items is not None:
            max_items = int(max_items)
        page_size = pagination_config.get('PageSize', None)
        if page_size is not None:
            if self._limit_key is None:
                raise PaginationError(
                    message="PageSize parameter is not supported for the "
                    "pagination interface for this operation."
                )
            input_members = self._model.input_shape.members
            limit_key_shape = input_members.get(self._limit_key)
            if limit_key_shape.type_name == 'string':
                if not isinstance(page_size, str):
                    page_size = str(page_size)
            else:
                page_size = int(page_size)
        return {
            'MaxItems': max_items,
            'StartingToken': pagination_config.get('StartingToken', None),
            'PageSize': page_size,
        }


class ResultKeyIterator:
    """Iterates over the results of paginated responses.

    Each iterator is associated with a single result key.
    Iterating over this object will give you each element in
    the result key list.

    :param pages_iterator: An iterator that will give you
        pages of results (a ``PageIterator`` class).
    :param result_key: The JMESPath expression representing
        the result key.

    """

    def __init__(self, pages_iterator, result_key):
        self._pages_iterator = pages_iterator
        self.result_key = result_key

    def __iter__(self):
        for page in self._pages_iterator:
            results = self.result_key.search(page)
            if results is None:
                results = []
            yield from results
