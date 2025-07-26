# Copyright 2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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

import jmespath
from botocore import xform_name

from ..exceptions import ResourceLoadException

INDEX_RE = re.compile(r'\[(.*)\]$')


def get_data_member(parent, path):
    """
    Get a data member from a parent using a JMESPath search query,
    loading the parent if required. If the parent cannot be loaded
    and no data is present then an exception is raised.

    :type parent: ServiceResource
    :param parent: The resource instance to which contains data we
                   are interested in.
    :type path: string
    :param path: The JMESPath expression to query
    :raises ResourceLoadException: When no data is present and the
                                   resource cannot be loaded.
    :returns: The queried data or ``None``.
    """
    # Ensure the parent has its data loaded, if possible.
    if parent.meta.data is None:
        if hasattr(parent, 'load'):
            parent.load()
        else:
            raise ResourceLoadException(
                f'{parent.__class__.__name__} has no load method!'
            )

    return jmespath.search(path, parent.meta.data)


def create_request_parameters(parent, request_model, params=None, index=None):
    """
    Handle request parameters that can be filled in from identifiers,
    resource data members or constants.

    By passing ``params``, you can invoke this method multiple times and
    build up a parameter dict over time, which is particularly useful
    for reverse JMESPath expressions that append to lists.

    :type parent: ServiceResource
    :param parent: The resource instance to which this action is attached.
    :type request_model: :py:class:`~boto3.resources.model.Request`
    :param request_model: The action request model.
    :type params: dict
    :param params: If set, then add to this existing dict. It is both
                   edited in-place and returned.
    :type index: int
    :param index: The position of an item within a list
    :rtype: dict
    :return: Pre-filled parameters to be sent to the request operation.
    """
    if params is None:
        params = {}

    for param in request_model.params:
        source = param.source
        target = param.target

        if source == 'identifier':
            # Resource identifier, e.g. queue.url
            value = getattr(parent, xform_name(param.name))
        elif source == 'data':
            # If this is a data member then it may incur a load
            # action before returning the value.
            value = get_data_member(parent, param.path)
        elif source in ['string', 'integer', 'boolean']:
            # These are hard-coded values in the definition
            value = param.value
        elif source == 'input':
            # This is provided by the user, so ignore it here
            continue
        else:
            raise NotImplementedError(f'Unsupported source type: {source}')

        build_param_structure(params, target, value, index)

    return params


def build_param_structure(params, target, value, index=None):
    """
    This method provides a basic reverse JMESPath implementation that
    lets you go from a JMESPath-like string to a possibly deeply nested
    object. The ``params`` are mutated in-place, so subsequent calls
    can modify the same element by its index.

        >>> build_param_structure(params, 'test[0]', 1)
        >>> print(params)
        {'test': [1]}

        >>> build_param_structure(params, 'foo.bar[0].baz', 'hello world')
        >>> print(params)
        {'test': [1], 'foo': {'bar': [{'baz': 'hello, world'}]}}

    """
    pos = params
    parts = target.split('.')

    # First, split into parts like 'foo', 'bar[0]', 'baz' and process
    # each piece. It can either be a list or a dict, depending on if
    # an index like `[0]` is present. We detect this via a regular
    # expression, and keep track of where we are in params via the
    # pos variable, walking down to the last item. Once there, we
    # set the value.
    for i, part in enumerate(parts):
        # Is it indexing an array?
        result = INDEX_RE.search(part)
        if result:
            if result.group(1):
                if result.group(1) == '*':
                    part = part[:-3]
                else:
                    # We have an explicit index
                    index = int(result.group(1))
                    part = part[: -len(str(index) + '[]')]
            else:
                # Index will be set after we know the proper part
                # name and that it's a list instance.
                index = None
                part = part[:-2]

            if part not in pos or not isinstance(pos[part], list):
                pos[part] = []

            # This means we should append, e.g. 'foo[]'
            if index is None:
                index = len(pos[part])

            while len(pos[part]) <= index:
                # Assume it's a dict until we set the final value below
                pos[part].append({})

            # Last item? Set the value, otherwise set the new position
            if i == len(parts) - 1:
                pos[part][index] = value
            else:
                # The new pos is the *item* in the array, not the array!
                pos = pos[part][index]
        else:
            if part not in pos:
                pos[part] = {}

            # Last item? Set the value, otherwise set the new position
            if i == len(parts) - 1:
                pos[part] = value
            else:
                pos = pos[part]
