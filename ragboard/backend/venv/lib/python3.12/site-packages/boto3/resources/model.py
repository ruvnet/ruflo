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

"""
The models defined in this file represent the resource JSON description
format and provide a layer of abstraction from the raw JSON. The advantages
of this are:

* Pythonic interface (e.g. ``action.request.operation``)
* Consumers need not change for minor JSON changes (e.g. renamed field)

These models are used both by the resource factory to generate resource
classes as well as by the documentation generator.
"""

import logging

from botocore import xform_name

logger = logging.getLogger(__name__)


class Identifier:
    """
    A resource identifier, given by its name.

    :type name: string
    :param name: The name of the identifier
    """

    def __init__(self, name, member_name=None):
        #: (``string``) The name of the identifier
        self.name = name
        self.member_name = member_name


class Action:
    """
    A service operation action.

    :type name: string
    :param name: The name of the action
    :type definition: dict
    :param definition: The JSON definition
    :type resource_defs: dict
    :param resource_defs: All resources defined in the service
    """

    def __init__(self, name, definition, resource_defs):
        self._definition = definition

        #: (``string``) The name of the action
        self.name = name
        #: (:py:class:`Request`) This action's request or ``None``
        self.request = None
        if 'request' in definition:
            self.request = Request(definition.get('request', {}))
        #: (:py:class:`ResponseResource`) This action's resource or ``None``
        self.resource = None
        if 'resource' in definition:
            self.resource = ResponseResource(
                definition.get('resource', {}), resource_defs
            )
        #: (``string``) The JMESPath search path or ``None``
        self.path = definition.get('path')


class DefinitionWithParams:
    """
    An item which has parameters exposed via the ``params`` property.
    A request has an operation and parameters, while a waiter has
    a name, a low-level waiter name and parameters.

    :type definition: dict
    :param definition: The JSON definition
    """

    def __init__(self, definition):
        self._definition = definition

    @property
    def params(self):
        """
        Get a list of auto-filled parameters for this request.

        :type: list(:py:class:`Parameter`)
        """
        params = []

        for item in self._definition.get('params', []):
            params.append(Parameter(**item))

        return params


class Parameter:
    """
    An auto-filled parameter which has a source and target. For example,
    the ``QueueUrl`` may be auto-filled from a resource's ``url`` identifier
    when making calls to ``queue.receive_messages``.

    :type target: string
    :param target: The destination parameter name, e.g. ``QueueUrl``
    :type source_type: string
    :param source_type: Where the source is defined.
    :type source: string
    :param source: The source name, e.g. ``Url``
    """

    def __init__(
        self, target, source, name=None, path=None, value=None, **kwargs
    ):
        #: (``string``) The destination parameter name
        self.target = target
        #: (``string``) Where the source is defined
        self.source = source
        #: (``string``) The name of the source, if given
        self.name = name
        #: (``string``) The JMESPath query of the source
        self.path = path
        #: (``string|int|float|bool``) The source constant value
        self.value = value

        # Complain if we encounter any unknown values.
        if kwargs:
            logger.warning('Unknown parameter options found: %s', kwargs)


class Request(DefinitionWithParams):
    """
    A service operation action request.

    :type definition: dict
    :param definition: The JSON definition
    """

    def __init__(self, definition):
        super().__init__(definition)

        #: (``string``) The name of the low-level service operation
        self.operation = definition.get('operation')


class Waiter(DefinitionWithParams):
    """
    An event waiter specification.

    :type name: string
    :param name: Name of the waiter
    :type definition: dict
    :param definition: The JSON definition
    """

    PREFIX = 'WaitUntil'

    def __init__(self, name, definition):
        super().__init__(definition)

        #: (``string``) The name of this waiter
        self.name = name

        #: (``string``) The name of the underlying event waiter
        self.waiter_name = definition.get('waiterName')


class ResponseResource:
    """
    A resource response to create after performing an action.

    :type definition: dict
    :param definition: The JSON definition
    :type resource_defs: dict
    :param resource_defs: All resources defined in the service
    """

    def __init__(self, definition, resource_defs):
        self._definition = definition
        self._resource_defs = resource_defs

        #: (``string``) The name of the response resource type
        self.type = definition.get('type')

        #: (``string``) The JMESPath search query or ``None``
        self.path = definition.get('path')

    @property
    def identifiers(self):
        """
        A list of resource identifiers.

        :type: list(:py:class:`Identifier`)
        """
        identifiers = []

        for item in self._definition.get('identifiers', []):
            identifiers.append(Parameter(**item))

        return identifiers

    @property
    def model(self):
        """
        Get the resource model for the response resource.

        :type: :py:class:`ResourceModel`
        """
        return ResourceModel(
            self.type, self._resource_defs[self.type], self._resource_defs
        )


class Collection(Action):
    """
    A group of resources. See :py:class:`Action`.

    :type name: string
    :param name: The name of the collection
    :type definition: dict
    :param definition: The JSON definition
    :type resource_defs: dict
    :param resource_defs: All resources defined in the service
    """

    @property
    def batch_actions(self):
        """
        Get a list of batch actions supported by the resource type
        contained in this action. This is a shortcut for accessing
        the same information through the resource model.

        :rtype: list(:py:class:`Action`)
        """
        return self.resource.model.batch_actions


class ResourceModel:
    """
    A model representing a resource, defined via a JSON description
    format. A resource has identifiers, attributes, actions,
    sub-resources, references and collections. For more information
    on resources, see :ref:`guide_resources`.

    :type name: string
    :param name: The name of this resource, e.g. ``sqs`` or ``Queue``
    :type definition: dict
    :param definition: The JSON definition
    :type resource_defs: dict
    :param resource_defs: All resources defined in the service
    """

    def __init__(self, name, definition, resource_defs):
        self._definition = definition
        self._resource_defs = resource_defs
        self._renamed = {}

        #: (``string``) The name of this resource
        self.name = name
        #: (``string``) The service shape name for this resource or ``None``
        self.shape = definition.get('shape')

    def load_rename_map(self, shape=None):
        """
        Load a name translation map given a shape. This will set
        up renamed values for any collisions, e.g. if the shape,
        an action, and a subresource all are all named ``foo``
        then the resource will have an action ``foo``, a subresource
        named ``Foo`` and a property named ``foo_attribute``.
        This is the order of precedence, from most important to
        least important:

        * Load action (resource.load)
        * Identifiers
        * Actions
        * Subresources
        * References
        * Collections
        * Waiters
        * Attributes (shape members)

        Batch actions are only exposed on collections, so do not
        get modified here. Subresources use upper camel casing, so
        are unlikely to collide with anything but other subresources.

        Creates a structure like this::

            renames = {
                ('action', 'id'): 'id_action',
                ('collection', 'id'): 'id_collection',
                ('attribute', 'id'): 'id_attribute'
            }

            # Get the final name for an action named 'id'
            name = renames.get(('action', 'id'), 'id')

        :type shape: botocore.model.Shape
        :param shape: The underlying shape for this resource.
        """
        # Meta is a reserved name for resources
        names = {'meta'}
        self._renamed = {}

        if self._definition.get('load'):
            names.add('load')

        for item in self._definition.get('identifiers', []):
            self._load_name_with_category(names, item['name'], 'identifier')

        for name in self._definition.get('actions', {}):
            self._load_name_with_category(names, name, 'action')

        for name, ref in self._get_has_definition().items():
            # Subresources require no data members, just typically
            # identifiers and user input.
            data_required = False
            for identifier in ref['resource']['identifiers']:
                if identifier['source'] == 'data':
                    data_required = True
                    break

            if not data_required:
                self._load_name_with_category(
                    names, name, 'subresource', snake_case=False
                )
            else:
                self._load_name_with_category(names, name, 'reference')

        for name in self._definition.get('hasMany', {}):
            self._load_name_with_category(names, name, 'collection')

        for name in self._definition.get('waiters', {}):
            self._load_name_with_category(
                names, Waiter.PREFIX + name, 'waiter'
            )

        if shape is not None:
            for name in shape.members.keys():
                self._load_name_with_category(names, name, 'attribute')

    def _load_name_with_category(self, names, name, category, snake_case=True):
        """
        Load a name with a given category, possibly renaming it
        if that name is already in use. The name will be stored
        in ``names`` and possibly be set up in ``self._renamed``.

        :type names: set
        :param names: Existing names (Python attributes, properties, or
                      methods) on the resource.
        :type name: string
        :param name: The original name of the value.
        :type category: string
        :param category: The value type, such as 'identifier' or 'action'
        :type snake_case: bool
        :param snake_case: True (default) if the name should be snake cased.
        """
        if snake_case:
            name = xform_name(name)

        if name in names:
            logger.debug(f'Renaming {self.name} {category} {name}')
            self._renamed[(category, name)] = name + '_' + category
            name += '_' + category

            if name in names:
                # This isn't good, let's raise instead of trying to keep
                # renaming this value.
                raise ValueError(
                    'Problem renaming {} {} to {}!'.format(
                        self.name, category, name
                    )
                )

        names.add(name)

    def _get_name(self, category, name, snake_case=True):
        """
        Get a possibly renamed value given a category and name. This
        uses the rename map set up in ``load_rename_map``, so that
        method must be called once first.

        :type category: string
        :param category: The value type, such as 'identifier' or 'action'
        :type name: string
        :param name: The original name of the value
        :type snake_case: bool
        :param snake_case: True (default) if the name should be snake cased.
        :rtype: string
        :return: Either the renamed value if it is set, otherwise the
                 original name.
        """
        if snake_case:
            name = xform_name(name)

        return self._renamed.get((category, name), name)

    def get_attributes(self, shape):
        """
        Get a dictionary of attribute names to original name and shape
        models that represent the attributes of this resource. Looks
        like the following:

            {
                'some_name': ('SomeName', <Shape...>)
            }

        :type shape: botocore.model.Shape
        :param shape: The underlying shape for this resource.
        :rtype: dict
        :return: Mapping of resource attributes.
        """
        attributes = {}
        identifier_names = [i.name for i in self.identifiers]

        for name, member in shape.members.items():
            snake_cased = xform_name(name)
            if snake_cased in identifier_names:
                # Skip identifiers, these are set through other means
                continue
            snake_cased = self._get_name(
                'attribute', snake_cased, snake_case=False
            )
            attributes[snake_cased] = (name, member)

        return attributes

    @property
    def identifiers(self):
        """
        Get a list of resource identifiers.

        :type: list(:py:class:`Identifier`)
        """
        identifiers = []

        for item in self._definition.get('identifiers', []):
            name = self._get_name('identifier', item['name'])
            member_name = item.get('memberName', None)
            if member_name:
                member_name = self._get_name('attribute', member_name)
            identifiers.append(Identifier(name, member_name))

        return identifiers

    @property
    def load(self):
        """
        Get the load action for this resource, if it is defined.

        :type: :py:class:`Action` or ``None``
        """
        action = self._definition.get('load')

        if action is not None:
            action = Action('load', action, self._resource_defs)

        return action

    @property
    def actions(self):
        """
        Get a list of actions for this resource.

        :type: list(:py:class:`Action`)
        """
        actions = []

        for name, item in self._definition.get('actions', {}).items():
            name = self._get_name('action', name)
            actions.append(Action(name, item, self._resource_defs))

        return actions

    @property
    def batch_actions(self):
        """
        Get a list of batch actions for this resource.

        :type: list(:py:class:`Action`)
        """
        actions = []

        for name, item in self._definition.get('batchActions', {}).items():
            name = self._get_name('batch_action', name)
            actions.append(Action(name, item, self._resource_defs))

        return actions

    def _get_has_definition(self):
        """
        Get a ``has`` relationship definition from a model, where the
        service resource model is treated special in that it contains
        a relationship to every resource defined for the service. This
        allows things like ``s3.Object('bucket-name', 'key')`` to
        work even though the JSON doesn't define it explicitly.

        :rtype: dict
        :return: Mapping of names to subresource and reference
                 definitions.
        """
        if self.name not in self._resource_defs:
            # This is the service resource, so let us expose all of
            # the defined resources as subresources.
            definition = {}

            for name, resource_def in self._resource_defs.items():
                # It's possible for the service to have renamed a
                # resource or to have defined multiple names that
                # point to the same resource type, so we need to
                # take that into account.
                found = False
                has_items = self._definition.get('has', {}).items()
                for has_name, has_def in has_items:
                    if has_def.get('resource', {}).get('type') == name:
                        definition[has_name] = has_def
                        found = True

                if not found:
                    # Create a relationship definition and attach it
                    # to the model, such that all identifiers must be
                    # supplied by the user. It will look something like:
                    #
                    # {
                    #   'resource': {
                    #     'type': 'ResourceName',
                    #     'identifiers': [
                    #       {'target': 'Name1', 'source': 'input'},
                    #       {'target': 'Name2', 'source': 'input'},
                    #       ...
                    #     ]
                    #   }
                    # }
                    #
                    fake_has = {'resource': {'type': name, 'identifiers': []}}

                    for identifier in resource_def.get('identifiers', []):
                        fake_has['resource']['identifiers'].append(
                            {'target': identifier['name'], 'source': 'input'}
                        )

                    definition[name] = fake_has
        else:
            definition = self._definition.get('has', {})

        return definition

    def _get_related_resources(self, subresources):
        """
        Get a list of sub-resources or references.

        :type subresources: bool
        :param subresources: ``True`` to get sub-resources, ``False`` to
                             get references.
        :rtype: list(:py:class:`Action`)
        """
        resources = []

        for name, definition in self._get_has_definition().items():
            if subresources:
                name = self._get_name('subresource', name, snake_case=False)
            else:
                name = self._get_name('reference', name)
            action = Action(name, definition, self._resource_defs)

            data_required = False
            for identifier in action.resource.identifiers:
                if identifier.source == 'data':
                    data_required = True
                    break

            if subresources and not data_required:
                resources.append(action)
            elif not subresources and data_required:
                resources.append(action)

        return resources

    @property
    def subresources(self):
        """
        Get a list of sub-resources.

        :type: list(:py:class:`Action`)
        """
        return self._get_related_resources(True)

    @property
    def references(self):
        """
        Get a list of reference resources.

        :type: list(:py:class:`Action`)
        """
        return self._get_related_resources(False)

    @property
    def collections(self):
        """
        Get a list of collections for this resource.

        :type: list(:py:class:`Collection`)
        """
        collections = []

        for name, item in self._definition.get('hasMany', {}).items():
            name = self._get_name('collection', name)
            collections.append(Collection(name, item, self._resource_defs))

        return collections

    @property
    def waiters(self):
        """
        Get a list of waiters for this resource.

        :type: list(:py:class:`Waiter`)
        """
        waiters = []

        for name, item in self._definition.get('waiters', {}).items():
            name = self._get_name('waiter', Waiter.PREFIX + name)
            waiters.append(Waiter(name, item))

        return waiters
