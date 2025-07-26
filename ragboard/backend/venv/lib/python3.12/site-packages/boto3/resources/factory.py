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
from functools import partial

from ..docs import docstring
from ..exceptions import ResourceLoadException
from .action import ServiceAction, WaiterAction
from .base import ResourceMeta, ServiceResource
from .collection import CollectionFactory
from .model import ResourceModel
from .response import ResourceHandler, build_identifiers

logger = logging.getLogger(__name__)


class ResourceFactory:
    """
    A factory to create new :py:class:`~boto3.resources.base.ServiceResource`
    classes from a :py:class:`~boto3.resources.model.ResourceModel`. There are
    two types of lookups that can be done: one on the service itself (e.g. an
    SQS resource) and another on models contained within the service (e.g. an
    SQS Queue resource).
    """

    def __init__(self, emitter):
        self._collection_factory = CollectionFactory()
        self._emitter = emitter

    def load_from_definition(
        self, resource_name, single_resource_json_definition, service_context
    ):
        """
        Loads a resource from a model, creating a new
        :py:class:`~boto3.resources.base.ServiceResource` subclass
        with the correct properties and methods, named based on the service
        and resource name, e.g. EC2.Instance.

        :type resource_name: string
        :param resource_name: Name of the resource to look up. For services,
                              this should match the ``service_name``.

        :type single_resource_json_definition: dict
        :param single_resource_json_definition:
            The loaded json of a single service resource or resource
            definition.

        :type service_context: :py:class:`~boto3.utils.ServiceContext`
        :param service_context: Context about the AWS service

        :rtype: Subclass of :py:class:`~boto3.resources.base.ServiceResource`
        :return: The service or resource class.
        """
        logger.debug(
            'Loading %s:%s', service_context.service_name, resource_name
        )

        # Using the loaded JSON create a ResourceModel object.
        resource_model = ResourceModel(
            resource_name,
            single_resource_json_definition,
            service_context.resource_json_definitions,
        )

        # Do some renaming of the shape if there was a naming collision
        # that needed to be accounted for.
        shape = None
        if resource_model.shape:
            shape = service_context.service_model.shape_for(
                resource_model.shape
            )
        resource_model.load_rename_map(shape)

        # Set some basic info
        meta = ResourceMeta(
            service_context.service_name, resource_model=resource_model
        )
        attrs = {
            'meta': meta,
        }

        # Create and load all of attributes of the resource class based
        # on the models.

        # Identifiers
        self._load_identifiers(
            attrs=attrs,
            meta=meta,
            resource_name=resource_name,
            resource_model=resource_model,
        )

        # Load/Reload actions
        self._load_actions(
            attrs=attrs,
            resource_name=resource_name,
            resource_model=resource_model,
            service_context=service_context,
        )

        # Attributes that get auto-loaded
        self._load_attributes(
            attrs=attrs,
            meta=meta,
            resource_name=resource_name,
            resource_model=resource_model,
            service_context=service_context,
        )

        # Collections and their corresponding methods
        self._load_collections(
            attrs=attrs,
            resource_model=resource_model,
            service_context=service_context,
        )

        # References and Subresources
        self._load_has_relations(
            attrs=attrs,
            resource_name=resource_name,
            resource_model=resource_model,
            service_context=service_context,
        )

        # Waiter resource actions
        self._load_waiters(
            attrs=attrs,
            resource_name=resource_name,
            resource_model=resource_model,
            service_context=service_context,
        )

        # Create the name based on the requested service and resource
        cls_name = resource_name
        if service_context.service_name == resource_name:
            cls_name = 'ServiceResource'
        cls_name = service_context.service_name + '.' + cls_name

        base_classes = [ServiceResource]
        if self._emitter is not None:
            self._emitter.emit(
                f'creating-resource-class.{cls_name}',
                class_attributes=attrs,
                base_classes=base_classes,
                service_context=service_context,
            )
        return type(str(cls_name), tuple(base_classes), attrs)

    def _load_identifiers(self, attrs, meta, resource_model, resource_name):
        """
        Populate required identifiers. These are arguments without which
        the resource cannot be used. Identifiers become arguments for
        operations on the resource.
        """
        for identifier in resource_model.identifiers:
            meta.identifiers.append(identifier.name)
            attrs[identifier.name] = self._create_identifier(
                identifier, resource_name
            )

    def _load_actions(
        self, attrs, resource_name, resource_model, service_context
    ):
        """
        Actions on the resource become methods, with the ``load`` method
        being a special case which sets internal data for attributes, and
        ``reload`` is an alias for ``load``.
        """
        if resource_model.load:
            attrs['load'] = self._create_action(
                action_model=resource_model.load,
                resource_name=resource_name,
                service_context=service_context,
                is_load=True,
            )
            attrs['reload'] = attrs['load']

        for action in resource_model.actions:
            attrs[action.name] = self._create_action(
                action_model=action,
                resource_name=resource_name,
                service_context=service_context,
            )

    def _load_attributes(
        self, attrs, meta, resource_name, resource_model, service_context
    ):
        """
        Load resource attributes based on the resource shape. The shape
        name is referenced in the resource JSON, but the shape itself
        is defined in the Botocore service JSON, hence the need for
        access to the ``service_model``.
        """
        if not resource_model.shape:
            return

        shape = service_context.service_model.shape_for(resource_model.shape)

        identifiers = {
            i.member_name: i
            for i in resource_model.identifiers
            if i.member_name
        }
        attributes = resource_model.get_attributes(shape)
        for name, (orig_name, member) in attributes.items():
            if name in identifiers:
                prop = self._create_identifier_alias(
                    resource_name=resource_name,
                    identifier=identifiers[name],
                    member_model=member,
                    service_context=service_context,
                )
            else:
                prop = self._create_autoload_property(
                    resource_name=resource_name,
                    name=orig_name,
                    snake_cased=name,
                    member_model=member,
                    service_context=service_context,
                )
            attrs[name] = prop

    def _load_collections(self, attrs, resource_model, service_context):
        """
        Load resource collections from the model. Each collection becomes
        a :py:class:`~boto3.resources.collection.CollectionManager` instance
        on the resource instance, which allows you to iterate and filter
        through the collection's items.
        """
        for collection_model in resource_model.collections:
            attrs[collection_model.name] = self._create_collection(
                resource_name=resource_model.name,
                collection_model=collection_model,
                service_context=service_context,
            )

    def _load_has_relations(
        self, attrs, resource_name, resource_model, service_context
    ):
        """
        Load related resources, which are defined via a ``has``
        relationship but conceptually come in two forms:

        1. A reference, which is a related resource instance and can be
           ``None``, such as an EC2 instance's ``vpc``.
        2. A subresource, which is a resource constructor that will always
           return a resource instance which shares identifiers/data with
           this resource, such as ``s3.Bucket('name').Object('key')``.
        """
        for reference in resource_model.references:
            # This is a dangling reference, i.e. we have all
            # the data we need to create the resource, so
            # this instance becomes an attribute on the class.
            attrs[reference.name] = self._create_reference(
                reference_model=reference,
                resource_name=resource_name,
                service_context=service_context,
            )

        for subresource in resource_model.subresources:
            # This is a sub-resource class you can create
            # by passing in an identifier, e.g. s3.Bucket(name).
            attrs[subresource.name] = self._create_class_partial(
                subresource_model=subresource,
                resource_name=resource_name,
                service_context=service_context,
            )

        self._create_available_subresources_command(
            attrs, resource_model.subresources
        )

    def _create_available_subresources_command(self, attrs, subresources):
        _subresources = [subresource.name for subresource in subresources]
        _subresources = sorted(_subresources)

        def get_available_subresources(factory_self):
            """
            Returns a list of all the available sub-resources for this
            Resource.

            :returns: A list containing the name of each sub-resource for this
                resource
            :rtype: list of str
            """
            return _subresources

        attrs['get_available_subresources'] = get_available_subresources

    def _load_waiters(
        self, attrs, resource_name, resource_model, service_context
    ):
        """
        Load resource waiters from the model. Each waiter allows you to
        wait until a resource reaches a specific state by polling the state
        of the resource.
        """
        for waiter in resource_model.waiters:
            attrs[waiter.name] = self._create_waiter(
                resource_waiter_model=waiter,
                resource_name=resource_name,
                service_context=service_context,
            )

    def _create_identifier(factory_self, identifier, resource_name):
        """
        Creates a read-only property for identifier attributes.
        """

        def get_identifier(self):
            # The default value is set to ``None`` instead of
            # raising an AttributeError because when resources are
            # instantiated a check is made such that none of the
            # identifiers have a value ``None``. If any are ``None``,
            # a more informative user error than a generic AttributeError
            # is raised.
            return getattr(self, '_' + identifier.name, None)

        get_identifier.__name__ = str(identifier.name)
        get_identifier.__doc__ = docstring.IdentifierDocstring(
            resource_name=resource_name,
            identifier_model=identifier,
            include_signature=False,
        )

        return property(get_identifier)

    def _create_identifier_alias(
        factory_self, resource_name, identifier, member_model, service_context
    ):
        """
        Creates a read-only property that aliases an identifier.
        """

        def get_identifier(self):
            return getattr(self, '_' + identifier.name, None)

        get_identifier.__name__ = str(identifier.member_name)
        get_identifier.__doc__ = docstring.AttributeDocstring(
            service_name=service_context.service_name,
            resource_name=resource_name,
            attr_name=identifier.member_name,
            event_emitter=factory_self._emitter,
            attr_model=member_model,
            include_signature=False,
        )

        return property(get_identifier)

    def _create_autoload_property(
        factory_self,
        resource_name,
        name,
        snake_cased,
        member_model,
        service_context,
    ):
        """
        Creates a new property on the resource to lazy-load its value
        via the resource's ``load`` method (if it exists).
        """

        # The property loader will check to see if this resource has already
        # been loaded and return the cached value if possible. If not, then
        # it first checks to see if it CAN be loaded (raise if not), then
        # calls the load before returning the value.
        def property_loader(self):
            if self.meta.data is None:
                if hasattr(self, 'load'):
                    self.load()
                else:
                    raise ResourceLoadException(
                        f'{self.__class__.__name__} has no load method'
                    )

            return self.meta.data.get(name)

        property_loader.__name__ = str(snake_cased)
        property_loader.__doc__ = docstring.AttributeDocstring(
            service_name=service_context.service_name,
            resource_name=resource_name,
            attr_name=snake_cased,
            event_emitter=factory_self._emitter,
            attr_model=member_model,
            include_signature=False,
        )

        return property(property_loader)

    def _create_waiter(
        factory_self, resource_waiter_model, resource_name, service_context
    ):
        """
        Creates a new wait method for each resource where both a waiter and
        resource model is defined.
        """
        waiter = WaiterAction(
            resource_waiter_model,
            waiter_resource_name=resource_waiter_model.name,
        )

        def do_waiter(self, *args, **kwargs):
            waiter(self, *args, **kwargs)

        do_waiter.__name__ = str(resource_waiter_model.name)
        do_waiter.__doc__ = docstring.ResourceWaiterDocstring(
            resource_name=resource_name,
            event_emitter=factory_self._emitter,
            service_model=service_context.service_model,
            resource_waiter_model=resource_waiter_model,
            service_waiter_model=service_context.service_waiter_model,
            include_signature=False,
        )
        return do_waiter

    def _create_collection(
        factory_self, resource_name, collection_model, service_context
    ):
        """
        Creates a new property on the resource to lazy-load a collection.
        """
        cls = factory_self._collection_factory.load_from_definition(
            resource_name=resource_name,
            collection_model=collection_model,
            service_context=service_context,
            event_emitter=factory_self._emitter,
        )

        def get_collection(self):
            return cls(
                collection_model=collection_model,
                parent=self,
                factory=factory_self,
                service_context=service_context,
            )

        get_collection.__name__ = str(collection_model.name)
        get_collection.__doc__ = docstring.CollectionDocstring(
            collection_model=collection_model, include_signature=False
        )
        return property(get_collection)

    def _create_reference(
        factory_self, reference_model, resource_name, service_context
    ):
        """
        Creates a new property on the resource to lazy-load a reference.
        """
        # References are essentially an action with no request
        # or response, so we can re-use the response handlers to
        # build up resources from identifiers and data members.
        handler = ResourceHandler(
            search_path=reference_model.resource.path,
            factory=factory_self,
            resource_model=reference_model.resource,
            service_context=service_context,
        )

        # Are there any identifiers that need access to data members?
        # This is important when building the resource below since
        # it requires the data to be loaded.
        needs_data = any(
            i.source == 'data' for i in reference_model.resource.identifiers
        )

        def get_reference(self):
            # We need to lazy-evaluate the reference to handle circular
            # references between resources. We do this by loading the class
            # when first accessed.
            # This is using a *response handler* so we need to make sure
            # our data is loaded (if possible) and pass that data into
            # the handler as if it were a response. This allows references
            # to have their data loaded properly.
            if needs_data and self.meta.data is None and hasattr(self, 'load'):
                self.load()
            return handler(self, {}, self.meta.data)

        get_reference.__name__ = str(reference_model.name)
        get_reference.__doc__ = docstring.ReferenceDocstring(
            reference_model=reference_model, include_signature=False
        )
        return property(get_reference)

    def _create_class_partial(
        factory_self, subresource_model, resource_name, service_context
    ):
        """
        Creates a new method which acts as a functools.partial, passing
        along the instance's low-level `client` to the new resource
        class' constructor.
        """
        name = subresource_model.resource.type

        def create_resource(self, *args, **kwargs):
            # We need a new method here because we want access to the
            # instance's client.
            positional_args = []

            # We lazy-load the class to handle circular references.
            json_def = service_context.resource_json_definitions.get(name, {})
            resource_cls = factory_self.load_from_definition(
                resource_name=name,
                single_resource_json_definition=json_def,
                service_context=service_context,
            )

            # Assumes that identifiers are in order, which lets you do
            # e.g. ``sqs.Queue('foo').Message('bar')`` to create a new message
            # linked with the ``foo`` queue and which has a ``bar`` receipt
            # handle. If we did kwargs here then future positional arguments
            # would lead to failure.
            identifiers = subresource_model.resource.identifiers
            if identifiers is not None:
                for identifier, value in build_identifiers(identifiers, self):
                    positional_args.append(value)

            return partial(
                resource_cls, *positional_args, client=self.meta.client
            )(*args, **kwargs)

        create_resource.__name__ = str(name)
        create_resource.__doc__ = docstring.SubResourceDocstring(
            resource_name=resource_name,
            sub_resource_model=subresource_model,
            service_model=service_context.service_model,
            include_signature=False,
        )
        return create_resource

    def _create_action(
        factory_self,
        action_model,
        resource_name,
        service_context,
        is_load=False,
    ):
        """
        Creates a new method which makes a request to the underlying
        AWS service.
        """
        # Create the action in in this closure but before the ``do_action``
        # method below is invoked, which allows instances of the resource
        # to share the ServiceAction instance.
        action = ServiceAction(
            action_model, factory=factory_self, service_context=service_context
        )

        # A resource's ``load`` method is special because it sets
        # values on the resource instead of returning the response.
        if is_load:
            # We need a new method here because we want access to the
            # instance via ``self``.
            def do_action(self, *args, **kwargs):
                response = action(self, *args, **kwargs)
                self.meta.data = response

            # Create the docstring for the load/reload methods.
            lazy_docstring = docstring.LoadReloadDocstring(
                action_name=action_model.name,
                resource_name=resource_name,
                event_emitter=factory_self._emitter,
                load_model=action_model,
                service_model=service_context.service_model,
                include_signature=False,
            )
        else:
            # We need a new method here because we want access to the
            # instance via ``self``.
            def do_action(self, *args, **kwargs):
                response = action(self, *args, **kwargs)

                if hasattr(self, 'load'):
                    # Clear cached data. It will be reloaded the next
                    # time that an attribute is accessed.
                    # TODO: Make this configurable in the future?
                    self.meta.data = None

                return response

            lazy_docstring = docstring.ActionDocstring(
                resource_name=resource_name,
                event_emitter=factory_self._emitter,
                action_model=action_model,
                service_model=service_context.service_model,
                include_signature=False,
            )

        do_action.__name__ = str(action_model.name)
        do_action.__doc__ = lazy_docstring
        return do_action
