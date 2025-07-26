# Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
"""This module contains the interface for controlling how configuration
is loaded.
"""

import copy
import logging
import os

from botocore import utils
from botocore.exceptions import InvalidConfigError

logger = logging.getLogger(__name__)


#: A default dictionary that maps the logical names for session variables
#: to the specific environment variables and configuration file names
#: that contain the values for these variables.
#: When creating a new Session object, you can pass in your own dictionary
#: to remap the logical names or to add new logical names.  You can then
#: get the current value for these variables by using the
#: ``get_config_variable`` method of the :class:`botocore.session.Session`
#: class.
#: These form the keys of the dictionary.  The values in the dictionary
#: are tuples of (<config_name>, <environment variable>, <default value>,
#: <conversion func>).
#: The conversion func is a function that takes the configuration value
#: as an argument and returns the converted value.  If this value is
#: None, then the configuration value is returned unmodified.  This
#: conversion function can be used to type convert config values to
#: values other than the default values of strings.
#: The ``profile`` and ``config_file`` variables should always have a
#: None value for the first entry in the tuple because it doesn't make
#: sense to look inside the config file for the location of the config
#: file or for the default profile to use.
#: The ``config_name`` is the name to look for in the configuration file,
#: the ``env var`` is the OS environment variable (``os.environ``) to
#: use, and ``default_value`` is the value to use if no value is otherwise
#: found.
#: NOTE: Fixing the spelling of this variable would be a breaking change.
#: Please leave as is.
BOTOCORE_DEFAUT_SESSION_VARIABLES = {
    # logical:  config_file, env_var,        default_value, conversion_func
    'profile': (None, ['AWS_DEFAULT_PROFILE', 'AWS_PROFILE'], None, None),
    'region': ('region', 'AWS_DEFAULT_REGION', None, None),
    'data_path': ('data_path', 'AWS_DATA_PATH', None, None),
    'config_file': (None, 'AWS_CONFIG_FILE', '~/.aws/config', None),
    'ca_bundle': ('ca_bundle', 'AWS_CA_BUNDLE', None, None),
    'api_versions': ('api_versions', None, {}, None),
    # This is the shared credentials file amongst sdks.
    'credentials_file': (
        None,
        'AWS_SHARED_CREDENTIALS_FILE',
        '~/.aws/credentials',
        None,
    ),
    # These variables only exist in the config file.
    # This is the number of seconds until we time out a request to
    # the instance metadata service.
    'metadata_service_timeout': (
        'metadata_service_timeout',
        'AWS_METADATA_SERVICE_TIMEOUT',
        1,
        int,
    ),
    # This is the number of request attempts we make until we give
    # up trying to retrieve data from the instance metadata service.
    'metadata_service_num_attempts': (
        'metadata_service_num_attempts',
        'AWS_METADATA_SERVICE_NUM_ATTEMPTS',
        1,
        int,
    ),
    'ec2_metadata_service_endpoint': (
        'ec2_metadata_service_endpoint',
        'AWS_EC2_METADATA_SERVICE_ENDPOINT',
        None,
        None,
    ),
    'ec2_metadata_service_endpoint_mode': (
        'ec2_metadata_service_endpoint_mode',
        'AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE',
        None,
        None,
    ),
    'ec2_metadata_v1_disabled': (
        'ec2_metadata_v1_disabled',
        'AWS_EC2_METADATA_V1_DISABLED',
        False,
        utils.ensure_boolean,
    ),
    'imds_use_ipv6': (
        'imds_use_ipv6',
        'AWS_IMDS_USE_IPV6',
        False,
        utils.ensure_boolean,
    ),
    'use_dualstack_endpoint': (
        'use_dualstack_endpoint',
        'AWS_USE_DUALSTACK_ENDPOINT',
        None,
        utils.ensure_boolean,
    ),
    'use_fips_endpoint': (
        'use_fips_endpoint',
        'AWS_USE_FIPS_ENDPOINT',
        None,
        utils.ensure_boolean,
    ),
    'ignore_configured_endpoint_urls': (
        'ignore_configured_endpoint_urls',
        'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
        None,
        utils.ensure_boolean,
    ),
    'parameter_validation': ('parameter_validation', None, True, None),
    # Client side monitoring configurations.
    # Note: These configurations are considered internal to botocore.
    # Do not use them until publicly documented.
    'csm_enabled': (
        'csm_enabled',
        'AWS_CSM_ENABLED',
        False,
        utils.ensure_boolean,
    ),
    'csm_host': ('csm_host', 'AWS_CSM_HOST', '127.0.0.1', None),
    'csm_port': ('csm_port', 'AWS_CSM_PORT', 31000, int),
    'csm_client_id': ('csm_client_id', 'AWS_CSM_CLIENT_ID', '', None),
    # Endpoint discovery configuration
    'endpoint_discovery_enabled': (
        'endpoint_discovery_enabled',
        'AWS_ENDPOINT_DISCOVERY_ENABLED',
        'auto',
        None,
    ),
    'sts_regional_endpoints': (
        'sts_regional_endpoints',
        'AWS_STS_REGIONAL_ENDPOINTS',
        'legacy',
        None,
    ),
    'retry_mode': ('retry_mode', 'AWS_RETRY_MODE', 'legacy', None),
    'defaults_mode': ('defaults_mode', 'AWS_DEFAULTS_MODE', 'legacy', None),
    # We can't have a default here for v1 because we need to defer to
    # whatever the defaults are in _retry.json.
    'max_attempts': ('max_attempts', 'AWS_MAX_ATTEMPTS', None, int),
    'user_agent_appid': ('sdk_ua_app_id', 'AWS_SDK_UA_APP_ID', None, None),
    'request_min_compression_size_bytes': (
        'request_min_compression_size_bytes',
        'AWS_REQUEST_MIN_COMPRESSION_SIZE_BYTES',
        10240,
        None,
    ),
    'disable_request_compression': (
        'disable_request_compression',
        'AWS_DISABLE_REQUEST_COMPRESSION',
        False,
        utils.ensure_boolean,
    ),
}
# A mapping for the s3 specific configuration vars. These are the configuration
# vars that typically go in the s3 section of the config file. This mapping
# follows the same schema as the previous session variable mapping.
DEFAULT_S3_CONFIG_VARS = {
    'addressing_style': (('s3', 'addressing_style'), None, None, None),
    'use_accelerate_endpoint': (
        ('s3', 'use_accelerate_endpoint'),
        None,
        None,
        utils.ensure_boolean,
    ),
    'use_dualstack_endpoint': (
        ('s3', 'use_dualstack_endpoint'),
        None,
        None,
        utils.ensure_boolean,
    ),
    'payload_signing_enabled': (
        ('s3', 'payload_signing_enabled'),
        None,
        None,
        utils.ensure_boolean,
    ),
    'use_arn_region': (
        ['s3_use_arn_region', ('s3', 'use_arn_region')],
        'AWS_S3_USE_ARN_REGION',
        None,
        utils.ensure_boolean,
    ),
    'us_east_1_regional_endpoint': (
        [
            's3_us_east_1_regional_endpoint',
            ('s3', 'us_east_1_regional_endpoint'),
        ],
        'AWS_S3_US_EAST_1_REGIONAL_ENDPOINT',
        None,
        None,
    ),
    's3_disable_multiregion_access_points': (
        ('s3', 's3_disable_multiregion_access_points'),
        'AWS_S3_DISABLE_MULTIREGION_ACCESS_POINTS',
        None,
        utils.ensure_boolean,
    ),
}
# A mapping for the proxy specific configuration vars. These are
# used to configure how botocore interacts with proxy setups while
# sending requests.
DEFAULT_PROXIES_CONFIG_VARS = {
    'proxy_ca_bundle': ('proxy_ca_bundle', None, None, None),
    'proxy_client_cert': ('proxy_client_cert', None, None, None),
    'proxy_use_forwarding_for_https': (
        'proxy_use_forwarding_for_https',
        None,
        None,
        utils.normalize_boolean,
    ),
}


def create_botocore_default_config_mapping(session):
    chain_builder = ConfigChainFactory(session=session)
    config_mapping = _create_config_chain_mapping(
        chain_builder, BOTOCORE_DEFAUT_SESSION_VARIABLES
    )
    config_mapping['s3'] = SectionConfigProvider(
        's3',
        session,
        _create_config_chain_mapping(chain_builder, DEFAULT_S3_CONFIG_VARS),
    )
    config_mapping['proxies_config'] = SectionConfigProvider(
        'proxies_config',
        session,
        _create_config_chain_mapping(
            chain_builder, DEFAULT_PROXIES_CONFIG_VARS
        ),
    )
    return config_mapping


def _create_config_chain_mapping(chain_builder, config_variables):
    mapping = {}
    for logical_name, config in config_variables.items():
        mapping[logical_name] = chain_builder.create_config_chain(
            instance_name=logical_name,
            env_var_names=config[1],
            config_property_names=config[0],
            default=config[2],
            conversion_func=config[3],
        )
    return mapping


class DefaultConfigResolver:
    def __init__(self, default_config_data):
        self._base_default_config = default_config_data['base']
        self._modes = default_config_data['modes']
        self._resolved_default_configurations = {}

    def _resolve_default_values_by_mode(self, mode):
        default_config = self._base_default_config.copy()
        modifications = self._modes.get(mode)

        for config_var in modifications:
            default_value = default_config[config_var]
            modification_dict = modifications[config_var]
            modification = list(modification_dict.keys())[0]
            modification_value = modification_dict[modification]
            if modification == 'multiply':
                default_value *= modification_value
            elif modification == 'add':
                default_value += modification_value
            elif modification == 'override':
                default_value = modification_value
            default_config[config_var] = default_value
        return default_config

    def get_default_modes(self):
        default_modes = ['legacy', 'auto']
        default_modes.extend(self._modes.keys())
        return default_modes

    def get_default_config_values(self, mode):
        if mode not in self._resolved_default_configurations:
            defaults = self._resolve_default_values_by_mode(mode)
            self._resolved_default_configurations[mode] = defaults
        return self._resolved_default_configurations[mode]


class ConfigChainFactory:
    """Factory class to create our most common configuration chain case.

    This is a convenience class to construct configuration chains that follow
    our most common pattern. This is to prevent ordering them incorrectly,
    and to make the config chain construction more readable.
    """

    def __init__(self, session, environ=None):
        """Initialize a ConfigChainFactory.

        :type session: :class:`botocore.session.Session`
        :param session: This is the session that should be used to look up
            values from the config file.

        :type environ: dict
        :param environ: A mapping to use for environment variables. If this
            is not provided it will default to use os.environ.
        """
        self._session = session
        if environ is None:
            environ = os.environ
        self._environ = environ

    def create_config_chain(
        self,
        instance_name=None,
        env_var_names=None,
        config_property_names=None,
        default=None,
        conversion_func=None,
    ):
        """Build a config chain following the standard botocore pattern.

        In botocore most of our config chains follow the the precendence:
        session_instance_variables, environment, config_file, default_value.

        This is a convenience function for creating a chain that follow
        that precendence.

        :type instance_name: str
        :param instance_name: This indicates what session instance variable
            corresponds to this config value. If it is None it will not be
            added to the chain.

        :type env_var_names: str or list of str or None
        :param env_var_names: One or more environment variable names to
            search for this value. They are searched in order. If it is None
            it will not be added to the chain.

        :type config_property_names: str/tuple or list of str/tuple or None
        :param config_property_names: One of more strings or tuples
            representing the name of the key in the config file for this
            config option. They are searched in order. If it is None it will
            not be added to the chain.

        :type default: Any
        :param default: Any constant value to be returned.

        :type conversion_func: None or callable
        :param conversion_func: If this value is None then it has no effect on
            the return type. Otherwise, it is treated as a function that will
            conversion_func our provided type.

        :rvalue: ConfigChain
        :returns: A ConfigChain that resolves in the order env_var_names ->
            config_property_name -> default. Any values that were none are
            omitted form the chain.
        """
        providers = []
        if instance_name is not None:
            providers.append(
                InstanceVarProvider(
                    instance_var=instance_name, session=self._session
                )
            )
        if env_var_names is not None:
            providers.extend(self._get_env_providers(env_var_names))
        if config_property_names is not None:
            providers.extend(
                self._get_scoped_config_providers(config_property_names)
            )
        if default is not None:
            providers.append(ConstantProvider(value=default))

        return ChainProvider(
            providers=providers,
            conversion_func=conversion_func,
        )

    def _get_env_providers(self, env_var_names):
        env_var_providers = []
        if not isinstance(env_var_names, list):
            env_var_names = [env_var_names]
        for env_var_name in env_var_names:
            env_var_providers.append(
                EnvironmentProvider(name=env_var_name, env=self._environ)
            )
        return env_var_providers

    def _get_scoped_config_providers(self, config_property_names):
        scoped_config_providers = []
        if not isinstance(config_property_names, list):
            config_property_names = [config_property_names]
        for config_property_name in config_property_names:
            scoped_config_providers.append(
                ScopedConfigProvider(
                    config_var_name=config_property_name,
                    session=self._session,
                )
            )
        return scoped_config_providers


class ConfigValueStore:
    """The ConfigValueStore object stores configuration values."""

    def __init__(self, mapping=None):
        """Initialize a ConfigValueStore.

        :type mapping: dict
        :param mapping: The mapping parameter is a map of string to a subclass
            of BaseProvider. When a config variable is asked for via the
            get_config_variable method, the corresponding provider will be
            invoked to load the value.
        """
        self._overrides = {}
        self._mapping = {}
        if mapping is not None:
            for logical_name, provider in mapping.items():
                self.set_config_provider(logical_name, provider)

    def __deepcopy__(self, memo):
        config_store = ConfigValueStore(copy.deepcopy(self._mapping, memo))
        for logical_name, override_value in self._overrides.items():
            config_store.set_config_variable(logical_name, override_value)

        return config_store

    def __copy__(self):
        config_store = ConfigValueStore(copy.copy(self._mapping))
        for logical_name, override_value in self._overrides.items():
            config_store.set_config_variable(logical_name, override_value)

        return config_store

    def get_config_variable(self, logical_name):
        """
        Retrieve the value associeated with the specified logical_name
        from the corresponding provider. If no value is found None will
        be returned.

        :type logical_name: str
        :param logical_name: The logical name of the session variable
            you want to retrieve.  This name will be mapped to the
            appropriate environment variable name for this session as
            well as the appropriate config file entry.

        :returns: value of variable or None if not defined.
        """
        if logical_name in self._overrides:
            return self._overrides[logical_name]
        if logical_name not in self._mapping:
            return None
        provider = self._mapping[logical_name]
        return provider.provide()

    def get_config_provider(self, logical_name):
        """
        Retrieve the provider associated with the specified logical_name.
        If no provider is found None will be returned.

        :type logical_name: str
        :param logical_name: The logical name of the session variable
            you want to retrieve.  This name will be mapped to the
            appropriate environment variable name for this session as
            well as the appropriate config file entry.

        :returns: configuration provider or None if not defined.
        """
        if (
            logical_name in self._overrides
            or logical_name not in self._mapping
        ):
            return None
        provider = self._mapping[logical_name]
        return provider

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
        self._overrides[logical_name] = value

    def clear_config_variable(self, logical_name):
        """Remove an override config variable from the session.

        :type logical_name: str
        :param logical_name: The name of the parameter to clear the override
            value from.
        """
        self._overrides.pop(logical_name, None)

    def set_config_provider(self, logical_name, provider):
        """Set the provider for a config value.

        This provides control over how a particular configuration value is
        loaded. This replaces the provider for ``logical_name`` with the new
        ``provider``.

        :type logical_name: str
        :param logical_name: The name of the config value to change the config
            provider for.

        :type provider: :class:`botocore.configprovider.BaseProvider`
        :param provider: The new provider that should be responsible for
            providing a value for the config named ``logical_name``.
        """
        self._mapping[logical_name] = provider


class SmartDefaultsConfigStoreFactory:
    def __init__(self, default_config_resolver, imds_region_provider):
        self._default_config_resolver = default_config_resolver
        self._imds_region_provider = imds_region_provider
        # Initializing _instance_metadata_region as None so we
        # can fetch region in a lazy fashion only when needed.
        self._instance_metadata_region = None

    def merge_smart_defaults(self, config_store, mode, region_name):
        if mode == 'auto':
            mode = self.resolve_auto_mode(region_name)
        default_configs = (
            self._default_config_resolver.get_default_config_values(mode)
        )
        for config_var in default_configs:
            config_value = default_configs[config_var]
            method = getattr(self, f'_set_{config_var}', None)
            if method:
                method(config_store, config_value)

    def resolve_auto_mode(self, region_name):
        current_region = None
        if os.environ.get('AWS_EXECUTION_ENV'):
            default_region = os.environ.get('AWS_DEFAULT_REGION')
            current_region = os.environ.get('AWS_REGION', default_region)
        if not current_region:
            if self._instance_metadata_region:
                current_region = self._instance_metadata_region
            else:
                try:
                    current_region = self._imds_region_provider.provide()
                    self._instance_metadata_region = current_region
                except Exception:
                    pass

        if current_region:
            if region_name == current_region:
                return 'in-region'
            else:
                return 'cross-region'
        return 'standard'

    def _update_provider(self, config_store, variable, value):
        original_provider = config_store.get_config_provider(variable)
        default_provider = ConstantProvider(value)
        if isinstance(original_provider, ChainProvider):
            chain_provider_copy = copy.deepcopy(original_provider)
            chain_provider_copy.set_default_provider(default_provider)
            default_provider = chain_provider_copy
        elif isinstance(original_provider, BaseProvider):
            default_provider = ChainProvider(
                providers=[original_provider, default_provider]
            )
        config_store.set_config_provider(variable, default_provider)

    def _update_section_provider(
        self, config_store, section_name, variable, value
    ):
        section_provider_copy = copy.deepcopy(
            config_store.get_config_provider(section_name)
        )
        section_provider_copy.set_default_provider(
            variable, ConstantProvider(value)
        )
        config_store.set_config_provider(section_name, section_provider_copy)

    def _set_retryMode(self, config_store, value):
        self._update_provider(config_store, 'retry_mode', value)

    def _set_stsRegionalEndpoints(self, config_store, value):
        self._update_provider(config_store, 'sts_regional_endpoints', value)

    def _set_s3UsEast1RegionalEndpoints(self, config_store, value):
        self._update_section_provider(
            config_store, 's3', 'us_east_1_regional_endpoint', value
        )

    def _set_connectTimeoutInMillis(self, config_store, value):
        self._update_provider(config_store, 'connect_timeout', value / 1000)


class BaseProvider:
    """Base class for configuration value providers.

    A configuration provider has some method of providing a configuration
    value.
    """

    def provide(self):
        """Provide a config value."""
        raise NotImplementedError('provide')


class ChainProvider(BaseProvider):
    """This provider wraps one or more other providers.

    Each provider in the chain is called, the first one returning a non-None
    value is then returned.
    """

    def __init__(self, providers=None, conversion_func=None):
        """Initalize a ChainProvider.

        :type providers: list
        :param providers: The initial list of providers to check for values
            when invoked.

        :type conversion_func: None or callable
        :param conversion_func: If this value is None then it has no affect on
            the return type. Otherwise, it is treated as a function that will
            transform provided value.
        """
        if providers is None:
            providers = []
        self._providers = providers
        self._conversion_func = conversion_func

    def __deepcopy__(self, memo):
        return ChainProvider(
            copy.deepcopy(self._providers, memo), self._conversion_func
        )

    def provide(self):
        """Provide the value from the first provider to return non-None.

        Each provider in the chain has its provide method called. The first
        one in the chain to return a non-None value is the returned from the
        ChainProvider. When no non-None value is found, None is returned.
        """
        for provider in self._providers:
            value = provider.provide()
            if value is not None:
                return self._convert_type(value)
        return None

    def set_default_provider(self, default_provider):
        if self._providers and isinstance(
            self._providers[-1], ConstantProvider
        ):
            self._providers[-1] = default_provider
        else:
            self._providers.append(default_provider)

        num_of_constants = sum(
            isinstance(provider, ConstantProvider)
            for provider in self._providers
        )
        if num_of_constants > 1:
            logger.info(
                'ChainProvider object contains multiple '
                'instances of ConstantProvider objects'
            )

    def _convert_type(self, value):
        if self._conversion_func is not None:
            return self._conversion_func(value)
        return value

    def __repr__(self):
        return '[{}]'.format(', '.join([str(p) for p in self._providers]))


class InstanceVarProvider(BaseProvider):
    """This class loads config values from the session instance vars."""

    def __init__(self, instance_var, session):
        """Initialize InstanceVarProvider.

        :type instance_var: str
        :param instance_var: The instance variable to load from the session.

        :type session: :class:`botocore.session.Session`
        :param session: The botocore session to get the loaded configuration
            file variables from.
        """
        self._instance_var = instance_var
        self._session = session

    def __deepcopy__(self, memo):
        return InstanceVarProvider(
            copy.deepcopy(self._instance_var, memo), self._session
        )

    def provide(self):
        """Provide a config value from the session instance vars."""
        instance_vars = self._session.instance_variables()
        value = instance_vars.get(self._instance_var)
        return value

    def __repr__(self):
        return f'InstanceVarProvider(instance_var={self._instance_var}, session={self._session})'


class ScopedConfigProvider(BaseProvider):
    def __init__(self, config_var_name, session):
        """Initialize ScopedConfigProvider.

        :type config_var_name: str or tuple
        :param config_var_name: The name of the config variable to load from
            the configuration file. If the value is a tuple, it must only
            consist of two items, where the first item represents the section
            and the second item represents the config var name in the section.

        :type session: :class:`botocore.session.Session`
        :param session: The botocore session to get the loaded configuration
            file variables from.
        """
        self._config_var_name = config_var_name
        self._session = session

    def __deepcopy__(self, memo):
        return ScopedConfigProvider(
            copy.deepcopy(self._config_var_name, memo), self._session
        )

    def provide(self):
        """Provide a value from a config file property."""
        scoped_config = self._session.get_scoped_config()
        if isinstance(self._config_var_name, tuple):
            section_config = scoped_config.get(self._config_var_name[0])
            if not isinstance(section_config, dict):
                return None
            return section_config.get(self._config_var_name[1])
        return scoped_config.get(self._config_var_name)

    def __repr__(self):
        return f'ScopedConfigProvider(config_var_name={self._config_var_name}, session={self._session})'


class EnvironmentProvider(BaseProvider):
    """This class loads config values from environment variables."""

    def __init__(self, name, env):
        """Initialize with the keys in the dictionary to check.

        :type name: str
        :param name: The key with that name will be loaded and returned.

        :type env: dict
        :param env: Environment variables dictionary to get variables from.
        """
        self._name = name
        self._env = env

    def __deepcopy__(self, memo):
        return EnvironmentProvider(
            copy.deepcopy(self._name, memo), copy.deepcopy(self._env, memo)
        )

    def provide(self):
        """Provide a config value from a source dictionary."""
        if self._name in self._env:
            return self._env[self._name]
        return None

    def __repr__(self):
        return f'EnvironmentProvider(name={self._name}, env={self._env})'


class SectionConfigProvider(BaseProvider):
    """Provides a dictionary from a section in the scoped config

    This is useful for retrieving scoped config variables (i.e. s3) that have
    their own set of config variables and resolving logic.
    """

    def __init__(self, section_name, session, override_providers=None):
        self._section_name = section_name
        self._session = session
        self._scoped_config_provider = ScopedConfigProvider(
            self._section_name, self._session
        )
        self._override_providers = override_providers
        if self._override_providers is None:
            self._override_providers = {}

    def __deepcopy__(self, memo):
        return SectionConfigProvider(
            copy.deepcopy(self._section_name, memo),
            self._session,
            copy.deepcopy(self._override_providers, memo),
        )

    def provide(self):
        section_config = self._scoped_config_provider.provide()
        if section_config and not isinstance(section_config, dict):
            logger.debug(
                "The %s config key is not a dictionary type, "
                "ignoring its value of: %s",
                self._section_name,
                section_config,
            )
            return None
        for section_config_var, provider in self._override_providers.items():
            provider_val = provider.provide()
            if provider_val is not None:
                if section_config is None:
                    section_config = {}
                section_config[section_config_var] = provider_val
        return section_config

    def set_default_provider(self, key, default_provider):
        provider = self._override_providers.get(key)
        if isinstance(provider, ChainProvider):
            provider.set_default_provider(default_provider)
            return
        elif isinstance(provider, BaseProvider):
            default_provider = ChainProvider(
                providers=[provider, default_provider]
            )
        self._override_providers[key] = default_provider

    def __repr__(self):
        return (
            f'SectionConfigProvider(section_name={self._section_name}, '
            f'session={self._session}, '
            f'override_providers={self._override_providers})'
        )


class ConstantProvider(BaseProvider):
    """This provider provides a constant value."""

    def __init__(self, value):
        self._value = value

    def __deepcopy__(self, memo):
        return ConstantProvider(copy.deepcopy(self._value, memo))

    def provide(self):
        """Provide the constant value given during initialization."""
        return self._value

    def __repr__(self):
        return f'ConstantProvider(value={self._value})'


class ConfiguredEndpointProvider(BaseProvider):
    """Lookup an endpoint URL from environment variable or shared config file.

    NOTE: This class is considered private and is subject to abrupt breaking
    changes or removal without prior announcement. Please do not use it
    directly.
    """

    _ENDPOINT_URL_LOOKUP_ORDER = [
        'environment_service',
        'environment_global',
        'config_service',
        'config_global',
    ]

    def __init__(
        self,
        full_config,
        scoped_config,
        client_name,
        environ=None,
    ):
        """Initialize a ConfiguredEndpointProviderChain.

        :type full_config: dict
        :param full_config: This is the dict representing the full
            configuration file.

        :type scoped_config: dict
        :param scoped_config: This is the dict representing the configuration
            for the current profile for the session.

        :type client_name: str
        :param client_name: The name used to instantiate a client using
            botocore.session.Session.create_client.

        :type environ: dict
        :param environ: A mapping to use for environment variables. If this
            is not provided it will default to use os.environ.
        """
        self._full_config = full_config
        self._scoped_config = scoped_config
        self._client_name = client_name
        self._transformed_service_id = self._get_snake_case_service_id(
            self._client_name
        )
        if environ is None:
            environ = os.environ
        self._environ = environ

    def provide(self):
        """Lookup the configured endpoint URL.

        The order is:

        1. The value provided by a service-specific environment variable.
        2. The value provided by the global endpoint environment variable
           (AWS_ENDPOINT_URL).
        3. The value provided by a service-specific parameter from a services
           definition section in the shared configuration file.
        4. The value provided by the global parameter from a services
           definition section in the shared configuration file.
        """
        for location in self._ENDPOINT_URL_LOOKUP_ORDER:
            logger.debug(
                'Looking for endpoint for %s via: %s',
                self._client_name,
                location,
            )

            endpoint_url = getattr(self, f'_get_endpoint_url_{location}')()

            if endpoint_url:
                logger.info(
                    'Found endpoint for %s via: %s.',
                    self._client_name,
                    location,
                )
                return endpoint_url

        logger.debug('No configured endpoint found.')
        return None

    def _get_snake_case_service_id(self, client_name):
        # Get the service ID without loading the service data file, accounting
        # for any aliases and standardizing the names with hyphens.
        client_name = utils.SERVICE_NAME_ALIASES.get(client_name, client_name)
        hyphenized_service_id = (
            utils.CLIENT_NAME_TO_HYPHENIZED_SERVICE_ID_OVERRIDES.get(
                client_name, client_name
            )
        )
        return hyphenized_service_id.replace('-', '_')

    def _get_service_env_var_name(self):
        transformed_service_id_env = self._transformed_service_id.upper()
        return f'AWS_ENDPOINT_URL_{transformed_service_id_env}'

    def _get_services_config(self):
        if 'services' not in self._scoped_config:
            return {}

        section_name = self._scoped_config['services']
        services_section = self._full_config.get('services', {}).get(
            section_name
        )

        if not services_section:
            error_msg = (
                f'The profile is configured to use the services '
                f'section but the "{section_name}" services '
                f'configuration does not exist.'
            )
            raise InvalidConfigError(error_msg=error_msg)

        return services_section

    def _get_endpoint_url_config_service(self):
        snakecase_service_id = self._transformed_service_id.lower()
        return (
            self._get_services_config()
            .get(snakecase_service_id, {})
            .get('endpoint_url')
        )

    def _get_endpoint_url_config_global(self):
        return self._scoped_config.get('endpoint_url')

    def _get_endpoint_url_environment_service(self):
        return EnvironmentProvider(
            name=self._get_service_env_var_name(), env=self._environ
        ).provide()

    def _get_endpoint_url_environment_global(self):
        return EnvironmentProvider(
            name='AWS_ENDPOINT_URL', env=self._environ
        ).provide()
