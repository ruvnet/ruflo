# Copyright (c) 2012-2013 Mitch Garnaat http://garnaat.org/
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
"""
This module contains the main interface to the botocore package, the
Session object.
"""

import copy
import logging
import os
import platform
import socket
import warnings

import botocore.client
import botocore.configloader
import botocore.credentials
import botocore.tokens
from botocore import (
    UNSIGNED,
    __version__,
    handlers,
    invoke_initializers,
    monitoring,
    paginate,
    retryhandler,
    translate,
    waiter,
)
from botocore.compat import HAS_CRT, MutableMapping
from botocore.configprovider import (
    BOTOCORE_DEFAUT_SESSION_VARIABLES,
    ConfigChainFactory,
    ConfiguredEndpointProvider,
    ConfigValueStore,
    DefaultConfigResolver,
    SmartDefaultsConfigStoreFactory,
    create_botocore_default_config_mapping,
)
from botocore.errorfactory import ClientExceptionsFactory
from botocore.exceptions import (
    ConfigNotFound,
    InvalidDefaultsMode,
    PartialCredentialsError,
    ProfileNotFound,
    UnknownServiceError,
)
from botocore.hooks import (
    EventAliaser,
    HierarchicalEmitter,
    first_non_none_response,
)
from botocore.loaders import create_loader
from botocore.model import ServiceModel
from botocore.parsers import ResponseParserFactory
from botocore.regions import EndpointResolver
from botocore.useragent import UserAgentString
from botocore.utils import (
    EVENT_ALIASES,
    IMDSRegionProvider,
    validate_region_name,
)

from botocore.compat import HAS_CRT  # noqa


logger = logging.getLogger(__name__)


class Session:
    """
    The Session object collects together useful functionality
    from `botocore` as well as important data such as configuration
    information and credentials into a single, easy-to-use object.

    :ivar available_profiles: A list of profiles defined in the config
        file associated with this session.
    :ivar profile: The current profile.
    """

    SESSION_VARIABLES = copy.copy(BOTOCORE_DEFAUT_SESSION_VARIABLES)

    #: The default format string to use when configuring the botocore logger.
    LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

    def __init__(
        self,
        session_vars=None,
        event_hooks=None,
        include_builtin_handlers=True,
        profile=None,
    ):
        """
        Create a new Session object.

        :type session_vars: dict
        :param session_vars: A dictionary that is used to override some or all
            of the environment variables associated with this session.  The
            key/value pairs defined in this dictionary will override the
            corresponding variables defined in ``SESSION_VARIABLES``.

        :type event_hooks: BaseEventHooks
        :param event_hooks: The event hooks object to use. If one is not
            provided, an event hooks object will be automatically created
            for you.

        :type include_builtin_handlers: bool
        :param include_builtin_handlers: Indicates whether or not to
            automatically register builtin handlers.

        :type profile: str
        :param profile: The name of the profile to use for this
            session.  Note that the profile can only be set when
            the session is created.

        """
        if event_hooks is None:
            self._original_handler = HierarchicalEmitter()
        else:
            self._original_handler = event_hooks
        self._events = EventAliaser(self._original_handler)
        if include_builtin_handlers:
            self._register_builtin_handlers(self._events)
        self.user_agent_name = 'Botocore'
        self.user_agent_version = __version__
        self.user_agent_extra = ''
        # The _profile attribute is just used to cache the value
        # of the current profile to avoid going through the normal
        # config lookup process each access time.
        self._profile = None
        self._config = None
        self._credentials = None
        self._auth_token = None
        self._profile_map = None
        # This is a dict that stores per session specific config variable
        # overrides via set_config_variable().
        self._session_instance_vars = {}
        if profile is not None:
            self._session_instance_vars['profile'] = profile
        self._client_config = None
        self._last_client_region_used = None
        self._components = ComponentLocator()
        self._internal_components = ComponentLocator()
        self._register_components()
        self.session_var_map = SessionVarDict(self, self.SESSION_VARIABLES)
        if session_vars is not None:
            self.session_var_map.update(session_vars)
        invoke_initializers(self)

    def _register_components(self):
        self._register_credential_provider()
        self._register_token_provider()
        self._register_data_loader()
        self._register_endpoint_resolver()
        self._register_event_emitter()
        self._register_response_parser_factory()
        self._register_exceptions_factory()
        self._register_config_store()
        self._register_monitor()
        self._register_default_config_resolver()
        self._register_smart_defaults_factory()
        self._register_user_agent_creator()

    def _register_event_emitter(self):
        self._components.register_component('event_emitter', self._events)

    def _register_token_provider(self):
        self._components.lazy_register_component(
            'token_provider', self._create_token_resolver
        )

    def _create_token_resolver(self):
        return botocore.tokens.create_token_resolver(self)

    def _register_credential_provider(self):
        self._components.lazy_register_component(
            'credential_provider', self._create_credential_resolver
        )

    def _create_credential_resolver(self):
        return botocore.credentials.create_credential_resolver(
            self, region_name=self._last_client_region_used
        )

    def _register_data_loader(self):
        self._components.lazy_register_component(
            'data_loader',
            lambda: create_loader(self.get_config_variable('data_path')),
        )

    def _register_endpoint_resolver(self):
        def create_default_resolver():
            loader = self.get_component('data_loader')
            endpoints, path = loader.load_data_with_path('endpoints')
            uses_builtin = loader.is_builtin_path(path)
            return EndpointResolver(endpoints, uses_builtin_data=uses_builtin)

        self._internal_components.lazy_register_component(
            'endpoint_resolver', create_default_resolver
        )

    def _register_default_config_resolver(self):
        def create_default_config_resolver():
            loader = self.get_component('data_loader')
            defaults = loader.load_data('sdk-default-configuration')
            return DefaultConfigResolver(defaults)

        self._internal_components.lazy_register_component(
            'default_config_resolver', create_default_config_resolver
        )

    def _register_smart_defaults_factory(self):
        def create_smart_defaults_factory():
            default_config_resolver = self._get_internal_component(
                'default_config_resolver'
            )
            imds_region_provider = IMDSRegionProvider(session=self)
            return SmartDefaultsConfigStoreFactory(
                default_config_resolver, imds_region_provider
            )

        self._internal_components.lazy_register_component(
            'smart_defaults_factory', create_smart_defaults_factory
        )

    def _register_response_parser_factory(self):
        self._components.register_component(
            'response_parser_factory', ResponseParserFactory()
        )

    def _register_exceptions_factory(self):
        self._internal_components.register_component(
            'exceptions_factory', ClientExceptionsFactory()
        )

    def _register_builtin_handlers(self, events):
        for spec in handlers.BUILTIN_HANDLERS:
            if len(spec) == 2:
                event_name, handler = spec
                self.register(event_name, handler)
            else:
                event_name, handler, register_type = spec
                if register_type is handlers.REGISTER_FIRST:
                    self._events.register_first(event_name, handler)
                elif register_type is handlers.REGISTER_LAST:
                    self._events.register_last(event_name, handler)

    def _register_config_store(self):
        config_store_component = ConfigValueStore(
            mapping=create_botocore_default_config_mapping(self)
        )
        self._components.register_component(
            'config_store', config_store_component
        )

    def _register_monitor(self):
        self._internal_components.lazy_register_component(
            'monitor', self._create_csm_monitor
        )

    def _register_user_agent_creator(self):
        uas = UserAgentString.from_environment()
        self._components.register_component('user_agent_creator', uas)

    def _create_csm_monitor(self):
        if self.get_config_variable('csm_enabled'):
            client_id = self.get_config_variable('csm_client_id')
            host = self.get_config_variable('csm_host')
            port = self.get_config_variable('csm_port')
            handler = monitoring.Monitor(
                adapter=monitoring.MonitorEventAdapter(),
                publisher=monitoring.SocketPublisher(
                    socket=socket.socket(socket.AF_INET, socket.SOCK_DGRAM),
                    host=host,
                    port=port,
                    serializer=monitoring.CSMSerializer(
                        csm_client_id=client_id
                    ),
                ),
            )
            return handler
        return None

    def _get_crt_version(self):
        user_agent_creator = self.get_component('user_agent_creator')
        return user_agent_creator._crt_version or 'Unknown'

    @property
    def available_profiles(self):
        return list(self._build_profile_map().keys())

    def _build_profile_map(self):
        # This will build the profile map if it has not been created,
        # otherwise it will return the cached value.  The profile map
        # is a list of profile names, to the config values for the profile.
        if self._profile_map is None:
            self._profile_map = self.full_config['profiles']
        return self._profile_map

    @property
    def profile(self):
        if self._profile is None:
            profile = self.get_config_variable('profile')
            self._profile = profile
        return self._profile

    def get_config_variable(self, logical_name, methods=None):
        if methods is not None:
            return self._get_config_variable_with_custom_methods(
                logical_name, methods
            )
        return self.get_component('config_store').get_config_variable(
            logical_name
        )

    def _get_config_variable_with_custom_methods(self, logical_name, methods):
        # If a custom list of methods was supplied we need to perserve the
        # behavior with the new system. To do so a new chain that is a copy of
        # the old one will be constructed, but only with the supplied methods
        # being added to the chain. This chain will be consulted for a value
        # and then thrown out. This is not efficient, nor is the methods arg
        # used in botocore, this is just for backwards compatibility.
        chain_builder = SubsetChainConfigFactory(session=self, methods=methods)
        mapping = create_botocore_default_config_mapping(self)
        for name, config_options in self.session_var_map.items():
            config_name, env_vars, default, typecast = config_options
            build_chain_config_args = {
                'conversion_func': typecast,
                'default': default,
            }
            if 'instance' in methods:
                build_chain_config_args['instance_name'] = name
            if 'env' in methods:
                build_chain_config_args['env_var_names'] = env_vars
            if 'config' in methods:
                build_chain_config_args['config_property_name'] = config_name
            mapping[name] = chain_builder.create_config_chain(
                **build_chain_config_args
            )
        config_store_component = ConfigValueStore(mapping=mapping)
        value = config_store_component.get_config_variable(logical_name)
        return value

    def set_config_variable(self, logical_name, value):
        """Set a configuration variable to a specific value.

        By using this method, you can override the normal lookup
        process used in ``get_config_variable`` by explicitly setting
        a value.  Subsequent calls to ``get_config_variable`` will
        use the ``value``.  This gives you per-session specific
        configuration values.

        ::
            >>> # Assume logical name 'foo' maps to env var 'FOO'
            >>> os.environ['FOO'] = 'myvalue'
            >>> s.get_config_variable('foo')
            'myvalue'
            >>> s.set_config_variable('foo', 'othervalue')
            >>> s.get_config_variable('foo')
            'othervalue'

        :type logical_name: str
        :param logical_name: The logical name of the session variable
            you want to set.  These are the keys in ``SESSION_VARIABLES``.
        :param value: The value to associate with the config variable.

        """
        logger.debug(
            "Setting config variable for %s to %r",
            logical_name,
            value,
        )
        self._session_instance_vars[logical_name] = value

    def instance_variables(self):
        return copy.copy(self._session_instance_vars)

    def get_scoped_config(self):
        """
        Returns the config values from the config file scoped to the current
        profile.

        The configuration data is loaded **only** from the config file.
        It does not resolve variables based on different locations
        (e.g. first from the session instance, then from environment
        variables, then from the config file).  If you want this lookup
        behavior, use the ``get_config_variable`` method instead.

        Note that this configuration is specific to a single profile (the
        ``profile`` session variable).

        If the ``profile`` session variable is set and the profile does
        not exist in the config file, a ``ProfileNotFound`` exception
        will be raised.

        :raises: ConfigNotFound, ConfigParseError, ProfileNotFound
        :rtype: dict

        """
        profile_name = self.get_config_variable('profile')
        profile_map = self._build_profile_map()
        # If a profile is not explicitly set return the default
        # profile config or an empty config dict if we don't have
        # a default profile.
        if profile_name is None:
            return profile_map.get('default', {})
        elif profile_name not in profile_map:
            # Otherwise if they specified a profile, it has to
            # exist (even if it's the default profile) otherwise
            # we complain.
            raise ProfileNotFound(profile=profile_name)
        else:
            return profile_map[profile_name]

    @property
    def full_config(self):
        """Return the parsed config file.

        The ``get_config`` method returns the config associated with the
        specified profile.  This property returns the contents of the
        **entire** config file.

        :rtype: dict
        """
        if self._config is None:
            try:
                config_file = self.get_config_variable('config_file')
                self._config = botocore.configloader.load_config(config_file)
            except ConfigNotFound:
                self._config = {'profiles': {}}
            try:
                # Now we need to inject the profiles from the
                # credentials file.  We don't actually need the values
                # in the creds file, only the profile names so that we
                # can validate the user is not referring to a nonexistent
                # profile.
                cred_file = self.get_config_variable('credentials_file')
                cred_profiles = botocore.configloader.raw_config_parse(
                    cred_file
                )
                for profile in cred_profiles:
                    cred_vars = cred_profiles[profile]
                    if profile not in self._config['profiles']:
                        self._config['profiles'][profile] = cred_vars
                    else:
                        self._config['profiles'][profile].update(cred_vars)
            except ConfigNotFound:
                pass
        return self._config

    def get_default_client_config(self):
        """Retrieves the default config for creating clients

        :rtype: botocore.client.Config
        :returns: The default client config object when creating clients. If
            the value is ``None`` then there is no default config object
            attached to the session.
        """
        return self._client_config

    def set_default_client_config(self, client_config):
        """Sets the default config for creating clients

        :type client_config: botocore.client.Config
        :param client_config: The default client config object when creating
            clients. If the value is ``None`` then there is no default config
            object attached to the session.
        """
        self._client_config = client_config

    def set_credentials(self, access_key, secret_key, token=None):
        """
        Manually create credentials for this session.  If you would
        prefer to use botocore without a config file, environment variables,
        or IAM roles, you can pass explicit credentials into this
        method to establish credentials for this session.

        :type access_key: str
        :param access_key: The access key part of the credentials.

        :type secret_key: str
        :param secret_key: The secret key part of the credentials.

        :type token: str
        :param token: An option session token used by STS session
            credentials.
        """
        self._credentials = botocore.credentials.Credentials(
            access_key, secret_key, token
        )

    def get_credentials(self):
        """
        Return the :class:`botocore.credential.Credential` object
        associated with this session.  If the credentials have not
        yet been loaded, this will attempt to load them.  If they
        have already been loaded, this will return the cached
        credentials.

        """
        if self._credentials is None:
            self._credentials = self._components.get_component(
                'credential_provider'
            ).load_credentials()
        return self._credentials

    def get_auth_token(self):
        """
        Return the :class:`botocore.tokens.AuthToken` object associated with
        this session. If the authorization token has not yet been loaded, this
        will attempt to load it. If it has already been loaded, this will
        return the cached authorization token.

        """
        if self._auth_token is None:
            provider = self._components.get_component('token_provider')
            self._auth_token = provider.load_token()
        return self._auth_token

    def user_agent(self):
        """
        Return a string suitable for use as a User-Agent header.
        The string will be of the form:

        <agent_name>/<agent_version> Python/<py_ver> <plat_name>/<plat_ver> <exec_env>

        Where:

         - agent_name is the value of the `user_agent_name` attribute
           of the session object (`Botocore` by default).
         - agent_version is the value of the `user_agent_version`
           attribute of the session object (the botocore version by default).
           by default.
         - py_ver is the version of the Python interpreter beng used.
         - plat_name is the name of the platform (e.g. Darwin)
         - plat_ver is the version of the platform
         - exec_env is exec-env/$AWS_EXECUTION_ENV

        If ``user_agent_extra`` is not empty, then this value will be
        appended to the end of the user agent string.

        """
        base = (
            f'{self.user_agent_name}/{self.user_agent_version} '
            f'Python/{platform.python_version()} '
            f'{platform.system()}/{platform.release()}'
        )
        if HAS_CRT:
            base += f' awscrt/{self._get_crt_version()}'
        if os.environ.get('AWS_EXECUTION_ENV') is not None:
            base += ' exec-env/{}'.format(os.environ.get('AWS_EXECUTION_ENV'))
        if self.user_agent_extra:
            base += f' {self.user_agent_extra}'

        return base

    def get_data(self, data_path):
        """
        Retrieve the data associated with `data_path`.

        :type data_path: str
        :param data_path: The path to the data you wish to retrieve.
        """
        return self.get_component('data_loader').load_data(data_path)

    def get_service_model(self, service_name, api_version=None):
        """Get the service model object.

        :type service_name: string
        :param service_name: The service name

        :type api_version: string
        :param api_version: The API version of the service.  If none is
            provided, then the latest API version will be used.

        :rtype: L{botocore.model.ServiceModel}
        :return: The botocore service model for the service.

        """
        service_description = self.get_service_data(service_name, api_version)
        return ServiceModel(service_description, service_name=service_name)

    def get_waiter_model(self, service_name, api_version=None):
        loader = self.get_component('data_loader')
        waiter_config = loader.load_service_model(
            service_name, 'waiters-2', api_version
        )
        return waiter.WaiterModel(waiter_config)

    def get_paginator_model(self, service_name, api_version=None):
        loader = self.get_component('data_loader')
        paginator_config = loader.load_service_model(
            service_name, 'paginators-1', api_version
        )
        return paginate.PaginatorModel(paginator_config)

    def get_service_data(self, service_name, api_version=None):
        """
        Retrieve the fully merged data associated with a service.
        """
        data_path = service_name
        service_data = self.get_component('data_loader').load_service_model(
            data_path, type_name='service-2', api_version=api_version
        )
        service_id = EVENT_ALIASES.get(service_name, service_name)
        self._events.emit(
            f'service-data-loaded.{service_id}',
            service_data=service_data,
            service_name=service_name,
            session=self,
        )
        return service_data

    def get_available_services(self):
        """
        Return a list of names of available services.
        """
        return self.get_component('data_loader').list_available_services(
            type_name='service-2'
        )

    def set_debug_logger(self, logger_name='botocore'):
        """
        Convenience function to quickly configure full debug output
        to go to the console.
        """
        self.set_stream_logger(logger_name, logging.DEBUG)

    def set_stream_logger(
        self, logger_name, log_level, stream=None, format_string=None
    ):
        """
        Convenience method to configure a stream logger.

        :type logger_name: str
        :param logger_name: The name of the logger to configure

        :type log_level: str
        :param log_level: The log level to set for the logger.  This
            is any param supported by the ``.setLevel()`` method of
            a ``Log`` object.

        :type stream: file
        :param stream: A file like object to log to.  If none is provided
            then sys.stderr will be used.

        :type format_string: str
        :param format_string: The format string to use for the log
            formatter.  If none is provided this will default to
            ``self.LOG_FORMAT``.

        """
        log = logging.getLogger(logger_name)
        log.setLevel(logging.DEBUG)

        ch = logging.StreamHandler(stream)
        ch.setLevel(log_level)

        # create formatter
        if format_string is None:
            format_string = self.LOG_FORMAT
        formatter = logging.Formatter(format_string)

        # add formatter to ch
        ch.setFormatter(formatter)

        # add ch to logger
        log.addHandler(ch)

    def set_file_logger(self, log_level, path, logger_name='botocore'):
        """
        Convenience function to quickly configure any level of logging
        to a file.

        :type log_level: int
        :param log_level: A log level as specified in the `logging` module

        :type path: string
        :param path: Path to the log file.  The file will be created
            if it doesn't already exist.
        """
        log = logging.getLogger(logger_name)
        log.setLevel(logging.DEBUG)

        # create console handler and set level to debug
        ch = logging.FileHandler(path)
        ch.setLevel(log_level)

        # create formatter
        formatter = logging.Formatter(self.LOG_FORMAT)

        # add formatter to ch
        ch.setFormatter(formatter)

        # add ch to logger
        log.addHandler(ch)

    def register(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        """Register a handler with an event.

        :type event_name: str
        :param event_name: The name of the event.

        :type handler: callable
        :param handler: The callback to invoke when the event
            is emitted.  This object must be callable, and must
            accept ``**kwargs``.  If either of these preconditions are
            not met, a ``ValueError`` will be raised.

        :type unique_id: str
        :param unique_id: An optional identifier to associate with the
            registration.  A unique_id can only be used once for
            the entire session registration (unless it is unregistered).
            This can be used to prevent an event handler from being
            registered twice.

        :param unique_id_uses_count: boolean
        :param unique_id_uses_count: Specifies if the event should maintain
            a count when a ``unique_id`` is registered and unregisted. The
            event can only be completely unregistered once every register call
            using the unique id has been matched by an ``unregister`` call.
            If ``unique_id`` is specified, subsequent ``register``
            calls must use the same value for  ``unique_id_uses_count``
            as the ``register`` call that first registered the event.

        :raises ValueError: If the call to ``register`` uses ``unique_id``
            but the value for ``unique_id_uses_count`` differs from the
            ``unique_id_uses_count`` value declared by the very first
            ``register`` call for that ``unique_id``.
        """
        self._events.register(
            event_name,
            handler,
            unique_id,
            unique_id_uses_count=unique_id_uses_count,
        )

    def unregister(
        self,
        event_name,
        handler=None,
        unique_id=None,
        unique_id_uses_count=False,
    ):
        """Unregister a handler with an event.

        :type event_name: str
        :param event_name: The name of the event.

        :type handler: callable
        :param handler: The callback to unregister.

        :type unique_id: str
        :param unique_id: A unique identifier identifying the callback
            to unregister.  You can provide either the handler or the
            unique_id, you do not have to provide both.

        :param unique_id_uses_count: boolean
        :param unique_id_uses_count: Specifies if the event should maintain
            a count when a ``unique_id`` is registered and unregisted. The
            event can only be completely unregistered once every ``register``
            call using the ``unique_id`` has been matched by an ``unregister``
            call. If the ``unique_id`` is specified, subsequent
            ``unregister`` calls must use the same value for
            ``unique_id_uses_count`` as the ``register`` call that first
            registered the event.

        :raises ValueError: If the call to ``unregister`` uses ``unique_id``
            but the value for ``unique_id_uses_count`` differs from the
            ``unique_id_uses_count`` value declared by the very first
            ``register`` call for that ``unique_id``.
        """
        self._events.unregister(
            event_name,
            handler=handler,
            unique_id=unique_id,
            unique_id_uses_count=unique_id_uses_count,
        )

    def emit(self, event_name, **kwargs):
        return self._events.emit(event_name, **kwargs)

    def emit_first_non_none_response(self, event_name, **kwargs):
        responses = self._events.emit(event_name, **kwargs)
        return first_non_none_response(responses)

    def get_component(self, name):
        try:
            return self._components.get_component(name)
        except ValueError:
            if name in ['endpoint_resolver', 'exceptions_factory']:
                warnings.warn(
                    f'Fetching the {name} component with the get_component() '
                    'method is deprecated as the component has always been '
                    'considered an internal interface of botocore',
                    DeprecationWarning,
                )
                return self._internal_components.get_component(name)
            raise

    def _get_internal_component(self, name):
        # While this method may be called by botocore classes outside of the
        # Session, this method should **never** be used by a class that lives
        # outside of botocore.
        return self._internal_components.get_component(name)

    def _register_internal_component(self, name, component):
        # While this method may be called by botocore classes outside of the
        # Session, this method should **never** be used by a class that lives
        # outside of botocore.
        return self._internal_components.register_component(name, component)

    def register_component(self, name, component):
        self._components.register_component(name, component)

    def lazy_register_component(self, name, component):
        self._components.lazy_register_component(name, component)

    def create_client(
        self,
        service_name,
        region_name=None,
        api_version=None,
        use_ssl=True,
        verify=None,
        endpoint_url=None,
        aws_access_key_id=None,
        aws_secret_access_key=None,
        aws_session_token=None,
        config=None,
    ):
        """Create a botocore client.

        :type service_name: string
        :param service_name: The name of the service for which a client will
            be created.  You can use the ``Session.get_available_services()``
            method to get a list of all available service names.

        :type region_name: string
        :param region_name: The name of the region associated with the client.
            A client is associated with a single region.

        :type api_version: string
        :param api_version: The API version to use.  By default, botocore will
            use the latest API version when creating a client.  You only need
            to specify this parameter if you want to use a previous API version
            of the client.

        :type use_ssl: boolean
        :param use_ssl: Whether or not to use SSL.  By default, SSL is used.
            Note that not all services support non-ssl connections.

        :type verify: boolean/string
        :param verify: Whether or not to verify SSL certificates.
            By default SSL certificates are verified.  You can provide the
            following values:

            * False - do not validate SSL certificates.  SSL will still be
              used (unless use_ssl is False), but SSL certificates
              will not be verified.
            * path/to/cert/bundle.pem - A filename of the CA cert bundle to
              uses.  You can specify this argument if you want to use a
              different CA cert bundle than the one used by botocore.

        :type endpoint_url: string
        :param endpoint_url: The complete URL to use for the constructed
            client.  Normally, botocore will automatically construct the
            appropriate URL to use when communicating with a service.  You can
            specify a complete URL (including the "http/https" scheme) to
            override this behavior.  If this value is provided, then
            ``use_ssl`` is ignored.

        :type aws_access_key_id: string
        :param aws_access_key_id: The access key to use when creating
            the client.  This is entirely optional, and if not provided,
            the credentials configured for the session will automatically
            be used.  You only need to provide this argument if you want
            to override the credentials used for this specific client.

        :type aws_secret_access_key: string
        :param aws_secret_access_key: The secret key to use when creating
            the client.  Same semantics as aws_access_key_id above.

        :type aws_session_token: string
        :param aws_session_token: The session token to use when creating
            the client.  Same semantics as aws_access_key_id above.

        :type config: botocore.client.Config
        :param config: Advanced client configuration options. If a value
            is specified in the client config, its value will take precedence
            over environment variables and configuration values, but not over
            a value passed explicitly to the method. If a default config
            object is set on the session, the config object used when creating
            the client will be the result of calling ``merge()`` on the
            default config with the config provided to this call.

        :rtype: botocore.client.BaseClient
        :return: A botocore client instance

        """
        default_client_config = self.get_default_client_config()
        # If a config is provided and a default config is set, then
        # use the config resulting from merging the two.
        if config is not None and default_client_config is not None:
            config = default_client_config.merge(config)
        # If a config was not provided then use the default
        # client config from the session
        elif default_client_config is not None:
            config = default_client_config

        region_name = self._resolve_region_name(region_name, config)

        # Figure out the verify value base on the various
        # configuration options.
        if verify is None:
            verify = self.get_config_variable('ca_bundle')

        if api_version is None:
            api_version = self.get_config_variable('api_versions').get(
                service_name, None
            )

        loader = self.get_component('data_loader')
        event_emitter = self.get_component('event_emitter')
        response_parser_factory = self.get_component('response_parser_factory')
        if config is not None and config.signature_version is UNSIGNED:
            credentials = None
        elif (
            aws_access_key_id is not None and aws_secret_access_key is not None
        ):
            credentials = botocore.credentials.Credentials(
                access_key=aws_access_key_id,
                secret_key=aws_secret_access_key,
                token=aws_session_token,
            )
        elif self._missing_cred_vars(aws_access_key_id, aws_secret_access_key):
            raise PartialCredentialsError(
                provider='explicit',
                cred_var=self._missing_cred_vars(
                    aws_access_key_id, aws_secret_access_key
                ),
            )
        else:
            credentials = self.get_credentials()
        auth_token = self.get_auth_token()
        endpoint_resolver = self._get_internal_component('endpoint_resolver')
        exceptions_factory = self._get_internal_component('exceptions_factory')
        config_store = copy.copy(self.get_component('config_store'))
        user_agent_creator = self.get_component('user_agent_creator')
        # Session configuration values for the user agent string are applied
        # just before each client creation because they may have been modified
        # at any time between session creation and client creation.
        user_agent_creator.set_session_config(
            session_user_agent_name=self.user_agent_name,
            session_user_agent_version=self.user_agent_version,
            session_user_agent_extra=self.user_agent_extra,
        )
        defaults_mode = self._resolve_defaults_mode(config, config_store)
        if defaults_mode != 'legacy':
            smart_defaults_factory = self._get_internal_component(
                'smart_defaults_factory'
            )
            smart_defaults_factory.merge_smart_defaults(
                config_store, defaults_mode, region_name
            )

        self._add_configured_endpoint_provider(
            client_name=service_name,
            config_store=config_store,
        )

        client_creator = botocore.client.ClientCreator(
            loader,
            endpoint_resolver,
            self.user_agent(),
            event_emitter,
            retryhandler,
            translate,
            response_parser_factory,
            exceptions_factory,
            config_store,
            user_agent_creator=user_agent_creator,
        )
        client = client_creator.create_client(
            service_name=service_name,
            region_name=region_name,
            is_secure=use_ssl,
            endpoint_url=endpoint_url,
            verify=verify,
            credentials=credentials,
            scoped_config=self.get_scoped_config(),
            client_config=config,
            api_version=api_version,
            auth_token=auth_token,
        )
        monitor = self._get_internal_component('monitor')
        if monitor is not None:
            monitor.register(client.meta.events)
        return client

    def _resolve_region_name(self, region_name, config):
        # Figure out the user-provided region based on the various
        # configuration options.
        if region_name is None:
            if config and config.region_name is not None:
                region_name = config.region_name
            else:
                region_name = self.get_config_variable('region')

        validate_region_name(region_name)
        # For any client that we create in retrieving credentials
        # we want to create it using the same region as specified in
        # creating this client. It is important to note though that the
        # credentials client is only created once per session. So if a new
        # client is created with a different region, its credential resolver
        # will use the region of the first client. However, that is not an
        # issue as of now because the credential resolver uses only STS and
        # the credentials returned at regional endpoints are valid across
        # all regions in the partition.
        self._last_client_region_used = region_name
        return region_name

    def _resolve_defaults_mode(self, client_config, config_store):
        mode = config_store.get_config_variable('defaults_mode')

        if client_config and client_config.defaults_mode:
            mode = client_config.defaults_mode

        default_config_resolver = self._get_internal_component(
            'default_config_resolver'
        )
        default_modes = default_config_resolver.get_default_modes()
        lmode = mode.lower()
        if lmode not in default_modes:
            raise InvalidDefaultsMode(
                mode=mode, valid_modes=', '.join(default_modes)
            )

        return lmode

    def _add_configured_endpoint_provider(self, client_name, config_store):
        chain = ConfiguredEndpointProvider(
            full_config=self.full_config,
            scoped_config=self.get_scoped_config(),
            client_name=client_name,
        )
        config_store.set_config_provider(
            logical_name='endpoint_url',
            provider=chain,
        )

    def _missing_cred_vars(self, access_key, secret_key):
        if access_key is not None and secret_key is None:
            return 'aws_secret_access_key'
        if secret_key is not None and access_key is None:
            return 'aws_access_key_id'
        return None

    def get_available_partitions(self):
        """Lists the available partitions found on disk

        :rtype: list
        :return: Returns a list of partition names (e.g., ["aws", "aws-cn"])
        """
        resolver = self._get_internal_component('endpoint_resolver')
        return resolver.get_available_partitions()

    def get_partition_for_region(self, region_name):
        """Lists the partition name of a particular region.

        :type region_name: string
        :param region_name: Name of the region to list partition for (e.g.,
             us-east-1).

        :rtype: string
        :return: Returns the respective partition name (e.g., aws).
        """
        resolver = self._get_internal_component('endpoint_resolver')
        return resolver.get_partition_for_region(region_name)

    def get_available_regions(
        self, service_name, partition_name='aws', allow_non_regional=False
    ):
        """Lists the region and endpoint names of a particular partition.

        :type service_name: string
        :param service_name: Name of a service to list endpoint for (e.g., s3).
            This parameter accepts a service name (e.g., "elb") or endpoint
            prefix (e.g., "elasticloadbalancing").

        :type partition_name: string
        :param partition_name: Name of the partition to limit endpoints to.
            (e.g., aws for the public AWS endpoints, aws-cn for AWS China
            endpoints, aws-us-gov for AWS GovCloud (US) Endpoints, etc.

        :type allow_non_regional: bool
        :param allow_non_regional: Set to True to include endpoints that are
             not regional endpoints (e.g., s3-external-1,
             fips-us-gov-west-1, etc).
        :return: Returns a list of endpoint names (e.g., ["us-east-1"]).
        """
        resolver = self._get_internal_component('endpoint_resolver')
        results = []
        try:
            service_data = self.get_service_data(service_name)
            endpoint_prefix = service_data['metadata'].get(
                'endpointPrefix', service_name
            )
            results = resolver.get_available_endpoints(
                endpoint_prefix, partition_name, allow_non_regional
            )
        except UnknownServiceError:
            pass
        return results


class ComponentLocator:
    """Service locator for session components."""

    def __init__(self):
        self._components = {}
        self._deferred = {}

    def get_component(self, name):
        if name in self._deferred:
            factory = self._deferred[name]
            self._components[name] = factory()
            # Only delete the component from the deferred dict after
            # successfully creating the object from the factory as well as
            # injecting the instantiated value into the _components dict.
            try:
                del self._deferred[name]
            except KeyError:
                # If we get here, it's likely that get_component was called
                # concurrently from multiple threads, and another thread
                # already deleted the entry. This means the factory was
                # probably called twice, but cleaning up the deferred entry
                # should not crash outright.
                pass
        try:
            return self._components[name]
        except KeyError:
            raise ValueError(f"Unknown component: {name}")

    def register_component(self, name, component):
        self._components[name] = component
        try:
            del self._deferred[name]
        except KeyError:
            pass

    def lazy_register_component(self, name, no_arg_factory):
        self._deferred[name] = no_arg_factory
        try:
            del self._components[name]
        except KeyError:
            pass


class SessionVarDict(MutableMapping):
    def __init__(self, session, session_vars):
        self._session = session
        self._store = copy.copy(session_vars)

    def __getitem__(self, key):
        return self._store[key]

    def __setitem__(self, key, value):
        self._store[key] = value
        self._update_config_store_from_session_vars(key, value)

    def __delitem__(self, key):
        del self._store[key]

    def __iter__(self):
        return iter(self._store)

    def __len__(self):
        return len(self._store)

    def _update_config_store_from_session_vars(
        self, logical_name, config_options
    ):
        # This is for backwards compatibility. The new preferred way to
        # modify configuration logic is to use the component system to get
        # the config_store component from the session, and then update
        # a key with a custom config provider(s).
        # This backwards compatibility method takes the old session_vars
        # list of tuples and and transforms that into a set of updates to
        # the config_store component.
        config_chain_builder = ConfigChainFactory(session=self._session)
        config_name, env_vars, default, typecast = config_options
        config_store = self._session.get_component('config_store')
        config_store.set_config_provider(
            logical_name,
            config_chain_builder.create_config_chain(
                instance_name=logical_name,
                env_var_names=env_vars,
                config_property_names=config_name,
                default=default,
                conversion_func=typecast,
            ),
        )


class SubsetChainConfigFactory:
    """A class for creating backwards compatible configuration chains.

    This class can be used instead of
    :class:`botocore.configprovider.ConfigChainFactory` to make it honor the
    methods argument to get_config_variable. This class can be used to filter
    out providers that are not in the methods tuple when creating a new config
    chain.
    """

    def __init__(self, session, methods, environ=None):
        self._factory = ConfigChainFactory(session, environ)
        self._supported_methods = methods

    def create_config_chain(
        self,
        instance_name=None,
        env_var_names=None,
        config_property_name=None,
        default=None,
        conversion_func=None,
    ):
        """Build a config chain following the standard botocore pattern.

        This config chain factory will omit any providers not in the methods
        tuple provided at initialization. For example if given the tuple
        ('instance', 'config',) it will not inject the environment provider
        into the standard config chain. This lets the botocore session support
        the custom ``methods`` argument for all the default botocore config
        variables when calling ``get_config_variable``.
        """
        if 'instance' not in self._supported_methods:
            instance_name = None
        if 'env' not in self._supported_methods:
            env_var_names = None
        if 'config' not in self._supported_methods:
            config_property_name = None
        return self._factory.create_config_chain(
            instance_name=instance_name,
            env_var_names=env_var_names,
            config_property_names=config_property_name,
            default=default,
            conversion_func=conversion_func,
        )


def get_session(env_vars=None):
    """
    Return a new session object.
    """
    return Session(env_vars)
