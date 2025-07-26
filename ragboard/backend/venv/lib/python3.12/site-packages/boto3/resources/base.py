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

import logging

import boto3

logger = logging.getLogger(__name__)


class ResourceMeta:
    """
    An object containing metadata about a resource.
    """

    def __init__(
        self,
        service_name,
        identifiers=None,
        client=None,
        data=None,
        resource_model=None,
    ):
        #: (``string``) The service name, e.g. 's3'
        self.service_name = service_name

        if identifiers is None:
            identifiers = []
        #: (``list``) List of identifier names
        self.identifiers = identifiers

        #: (:py:class:`~botocore.client.BaseClient`) Low-level Botocore client
        self.client = client
        #: (``dict``) Loaded resource data attributes
        self.data = data

        # The resource model for that resource
        self.resource_model = resource_model

    def __repr__(self):
        return 'ResourceMeta(\'{}\', identifiers={})'.format(
            self.service_name, self.identifiers
        )

    def __eq__(self, other):
        # Two metas are equal if their components are all equal
        if other.__class__.__name__ != self.__class__.__name__:
            return False

        return self.__dict__ == other.__dict__

    def copy(self):
        """
        Create a copy of this metadata object.
        """
        params = self.__dict__.copy()
        service_name = params.pop('service_name')
        return ResourceMeta(service_name, **params)


class ServiceResource:
    """
    A base class for resources.

    :type client: botocore.client
    :param client: A low-level Botocore client instance
    """

    meta = None
    """
    Stores metadata about this resource instance, such as the
    ``service_name``, the low-level ``client`` and any cached ``data``
    from when the instance was hydrated. For example::

        # Get a low-level client from a resource instance
        client = resource.meta.client
        response = client.operation(Param='foo')

        # Print the resource instance's service short name
        print(resource.meta.service_name)

    See :py:class:`ResourceMeta` for more information.
    """

    def __init__(self, *args, **kwargs):
        # Always work on a copy of meta, otherwise we would affect other
        # instances of the same subclass.
        self.meta = self.meta.copy()

        # Create a default client if none was passed
        if kwargs.get('client') is not None:
            self.meta.client = kwargs.get('client')
        else:
            self.meta.client = boto3.client(self.meta.service_name)

        # Allow setting identifiers as positional arguments in the order
        # in which they were defined in the ResourceJSON.
        for i, value in enumerate(args):
            setattr(self, '_' + self.meta.identifiers[i], value)

        # Allow setting identifiers via keyword arguments. Here we need
        # extra logic to ignore other keyword arguments like ``client``.
        for name, value in kwargs.items():
            if name == 'client':
                continue

            if name not in self.meta.identifiers:
                raise ValueError(f'Unknown keyword argument: {name}')

            setattr(self, '_' + name, value)

        # Validate that all identifiers have been set.
        for identifier in self.meta.identifiers:
            if getattr(self, identifier) is None:
                raise ValueError(f'Required parameter {identifier} not set')

    def __repr__(self):
        identifiers = []
        for identifier in self.meta.identifiers:
            identifiers.append(
                f'{identifier}={repr(getattr(self, identifier))}'
            )
        return "{}({})".format(
            self.__class__.__name__,
            ', '.join(identifiers),
        )

    def __eq__(self, other):
        # Should be instances of the same resource class
        if other.__class__.__name__ != self.__class__.__name__:
            return False

        # Each of the identifiers should have the same value in both
        # instances, e.g. two buckets need the same name to be equal.
        for identifier in self.meta.identifiers:
            if getattr(self, identifier) != getattr(other, identifier):
                return False

        return True

    def __hash__(self):
        identifiers = []
        for identifier in self.meta.identifiers:
            identifiers.append(getattr(self, identifier))
        return hash((self.__class__.__name__, tuple(identifiers)))
