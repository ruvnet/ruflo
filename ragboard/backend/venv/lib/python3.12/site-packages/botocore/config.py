# Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
import copy

from botocore.compat import OrderedDict
from botocore.endpoint import DEFAULT_TIMEOUT, MAX_POOL_CONNECTIONS
from botocore.exceptions import (
    InvalidMaxRetryAttemptsError,
    InvalidRetryConfigurationError,
    InvalidRetryModeError,
    InvalidS3AddressingStyleError,
)


class Config:
    """Advanced configuration for Botocore clients.

    :type region_name: str
    :param region_name: The region to use in instantiating the client

    :type signature_version: str
    :param signature_version: The signature version when signing requests.

    :type user_agent: str
    :param user_agent: The value to use in the User-Agent header.

    :type user_agent_extra: str
    :param user_agent_extra: The value to append to the current User-Agent
        header value.

    :type user_agent_appid: str
    :param user_agent_appid: A value that gets included in the User-Agent
        string in the format "app/<user_agent_appid>". Allowed characters are
        ASCII alphanumerics and ``!$%&'*+-.^_`|~``. All other characters will
        be replaced by a ``-``.

    :type connect_timeout: float or int
    :param connect_timeout: The time in seconds till a timeout exception is
        thrown when attempting to make a connection. The default is 60
        seconds.

    :type read_timeout: float or int
    :param read_timeout: The time in seconds till a timeout exception is
        thrown when attempting to read from a connection. The default is
        60 seconds.

    :type parameter_validation: bool
    :param parameter_validation: Whether parameter validation should occur
        when serializing requests. The default is True.  You can disable
        parameter validation for performance reasons.  Otherwise, it's
        recommended to leave parameter validation enabled.

    :type max_pool_connections: int
    :param max_pool_connections: The maximum number of connections to
        keep in a connection pool.  If this value is not set, the default
        value of 10 is used.

    :type proxies: dict
    :param proxies: A dictionary of proxy servers to use by protocol or
        endpoint, e.g.:
        ``{'http': 'foo.bar:3128', 'http://hostname': 'foo.bar:4012'}``.
        The proxies are used on each request.

    :type proxies_config: dict
    :param proxies_config: A dictionary of additional proxy configurations.
        Valid keys are:

        * ``proxy_ca_bundle`` -- The path to a custom certificate bundle to use
          when establishing SSL/TLS connections with proxy.

        * ``proxy_client_cert`` -- The path to a certificate for proxy
          TLS client authentication.

          When a string is provided it is treated as a path to a proxy client
          certificate. When a two element tuple is provided, it will be
          interpreted as the path to the client certificate, and the path
          to the certificate key.

        * ``proxy_use_forwarding_for_https`` -- For HTTPS proxies,
          forward your requests to HTTPS destinations with an absolute
          URI. We strongly recommend you only use this option with
          trusted or corporate proxies. Value must be boolean.

    :type s3: dict
    :param s3: A dictionary of S3 specific configurations.
        Valid keys are:

        * ``use_accelerate_endpoint`` -- Refers to whether to use the S3
          Accelerate endpoint. The value must be a boolean. If True, the
          client will use the S3 Accelerate endpoint. If the S3 Accelerate
          endpoint is being used then the addressing style will always
          be virtual.

        * ``payload_signing_enabled`` -- Refers to whether or not to SHA256
          sign sigv4 payloads. By default, this is disabled for streaming
          uploads (UploadPart and PutObject).

        * ``addressing_style`` -- Refers to the style in which to address
          s3 endpoints. Values must be a string that equals one of:

          * ``auto`` -- Addressing style is chosen for user. Depending
            on the configuration of client, the endpoint may be addressed in
            the virtual or the path style. Note that this is the default
            behavior if no style is specified.

          * ``virtual`` -- Addressing style is always virtual. The name of the
            bucket must be DNS compatible or an exception will be thrown.
            Endpoints will be addressed as such: ``mybucket.s3.amazonaws.com``

          * ``path`` -- Addressing style is always by path. Endpoints will be
            addressed as such: ``s3.amazonaws.com/mybucket``

        * ``us_east_1_regional_endpoint`` -- Refers to what S3 endpoint to use
          when the region is configured to be us-east-1. Values must be a
          string that equals:

          * ``regional`` -- Use the us-east-1.amazonaws.com endpoint if the
            client is configured to use the us-east-1 region.

          * ``legacy`` -- Use the s3.amazonaws.com endpoint if the client is
            configured to use the us-east-1 region. This is the default if
            the configuration option is not specified.


    :type retries: dict
    :param retries: A dictionary for configuration related to retry behavior.
        Valid keys are:

        * ``total_max_attempts`` -- An integer representing the maximum number of
          total attempts that will be made on a single request.  This includes
          the initial request, so a value of 1 indicates that no requests
          will be retried.  If ``total_max_attempts`` and ``max_attempts``
          are both provided, ``total_max_attempts`` takes precedence.
          ``total_max_attempts`` is preferred over ``max_attempts`` because
          it maps to the ``AWS_MAX_ATTEMPTS`` environment variable and
          the ``max_attempts`` config file value.
        * ``max_attempts`` -- An integer representing the maximum number of
          retry attempts that will be made on a single request. For
          example, setting this value to 2 will result in the request
          being retried at most two times after the initial request. Setting
          this value to 0 will result in no retries ever being attempted after
          the initial request. If not provided, the number of retries will
          default to the value specified in the service model, which is
          typically four retries.
        * ``mode`` -- A string representing the type of retry mode botocore
          should use.  Valid values are:

          * ``legacy`` - The pre-existing retry behavior.

          * ``standard`` - The standardized set of retry rules. This will also
            default to 3 max attempts unless overridden.

          * ``adaptive`` - Retries with additional client side throttling.

    :type client_cert: str, (str, str)
    :param client_cert: The path to a certificate for TLS client authentication.

        When a string is provided it is treated as a path to a client
        certificate to be used when creating a TLS connection.

        If a client key is to be provided alongside the client certificate the
        client_cert should be set to a tuple of length two where the first
        element is the path to the client certificate and the second element is
        the path to the certificate key.

    :type inject_host_prefix: bool
    :param inject_host_prefix: Whether host prefix injection should occur.

        Defaults to True.

        Setting this to False disables the injection of operation parameters
        into the prefix of the hostname. This is useful for clients providing
        custom endpoints that should not have their host prefix modified.

    :type use_dualstack_endpoint: bool
    :param use_dualstack_endpoint: Setting to True enables dualstack
        endpoint resolution.

        Defaults to None.

    :type use_fips_endpoint: bool
    :param use_fips_endpoint: Setting to True enables fips
        endpoint resolution.

        Defaults to None.

    :type ignore_configured_endpoint_urls: bool
    :param ignore_configured_endpoint_urls: Setting to True disables use
        of endpoint URLs provided via environment variables and
        the shared configuration file.

        Defaults to None.

    :type tcp_keepalive: bool
    :param tcp_keepalive: Enables the TCP Keep-Alive socket option used when
        creating new connections if set to True.

        Defaults to False.

    :type request_min_compression_size_bytes: int
    :param request_min_compression_size_bytes: The minimum size in bytes that a
        request body should be to trigger compression. All requests with
        streaming input that don't contain the ``requiresLength`` trait will be
        compressed regardless of this setting.

        Defaults to None.

    :type disable_request_compression: bool
    :param disable_request_compression: Disables request body compression if
        set to True.

        Defaults to None.

    :type client_context_params: dict
    :param client_context_params: A dictionary of parameters specific to
        individual services. If available, valid parameters can be found in
        the ``Client Context Parameters`` section of the service client's
        documentation. Invalid parameters or ones that are not used by the
        specified service will be ignored.

        Defaults to None.
    """

    OPTION_DEFAULTS = OrderedDict(
        [
            ('region_name', None),
            ('signature_version', None),
            ('user_agent', None),
            ('user_agent_extra', None),
            ('user_agent_appid', None),
            ('connect_timeout', DEFAULT_TIMEOUT),
            ('read_timeout', DEFAULT_TIMEOUT),
            ('parameter_validation', True),
            ('max_pool_connections', MAX_POOL_CONNECTIONS),
            ('proxies', None),
            ('proxies_config', None),
            ('s3', None),
            ('retries', None),
            ('client_cert', None),
            ('inject_host_prefix', True),
            ('endpoint_discovery_enabled', None),
            ('use_dualstack_endpoint', None),
            ('use_fips_endpoint', None),
            ('ignore_configured_endpoint_urls', None),
            ('defaults_mode', None),
            ('tcp_keepalive', None),
            ('request_min_compression_size_bytes', None),
            ('disable_request_compression', None),
            ('client_context_params', None),
        ]
    )

    NON_LEGACY_OPTION_DEFAULTS = {
        'connect_timeout': None,
    }

    def __init__(self, *args, **kwargs):
        self._user_provided_options = self._record_user_provided_options(
            args, kwargs
        )

        # Merge the user_provided options onto the default options
        config_vars = copy.copy(self.OPTION_DEFAULTS)
        defaults_mode = self._user_provided_options.get(
            'defaults_mode', 'legacy'
        )
        if defaults_mode != 'legacy':
            config_vars.update(self.NON_LEGACY_OPTION_DEFAULTS)
        config_vars.update(self._user_provided_options)

        # Set the attributes based on the config_vars
        for key, value in config_vars.items():
            setattr(self, key, value)

        # Validate the s3 options
        self._validate_s3_configuration(self.s3)

        self._validate_retry_configuration(self.retries)

    def _record_user_provided_options(self, args, kwargs):
        option_order = list(self.OPTION_DEFAULTS)
        user_provided_options = {}

        # Iterate through the kwargs passed through to the constructor and
        # map valid keys to the dictionary
        for key, value in kwargs.items():
            if key in self.OPTION_DEFAULTS:
                user_provided_options[key] = value
            # The key must exist in the available options
            else:
                raise TypeError(f"Got unexpected keyword argument '{key}'")

        # The number of args should not be longer than the allowed
        # options
        if len(args) > len(option_order):
            raise TypeError(
                f"Takes at most {len(option_order)} arguments ({len(args)} given)"
            )

        # Iterate through the args passed through to the constructor and map
        # them to appropriate keys.
        for i, arg in enumerate(args):
            # If a kwarg was specified for the arg, then error out
            if option_order[i] in user_provided_options:
                raise TypeError(
                    f"Got multiple values for keyword argument '{option_order[i]}'"
                )
            user_provided_options[option_order[i]] = arg

        return user_provided_options

    def _validate_s3_configuration(self, s3):
        if s3 is not None:
            addressing_style = s3.get('addressing_style')
            if addressing_style not in ['virtual', 'auto', 'path', None]:
                raise InvalidS3AddressingStyleError(
                    s3_addressing_style=addressing_style
                )

    def _validate_retry_configuration(self, retries):
        valid_options = ('max_attempts', 'mode', 'total_max_attempts')
        valid_modes = ('legacy', 'standard', 'adaptive')
        if retries is not None:
            for key, value in retries.items():
                if key not in valid_options:
                    raise InvalidRetryConfigurationError(
                        retry_config_option=key,
                        valid_options=valid_options,
                    )
                if key == 'max_attempts' and value < 0:
                    raise InvalidMaxRetryAttemptsError(
                        provided_max_attempts=value,
                        min_value=0,
                    )
                if key == 'total_max_attempts' and value < 1:
                    raise InvalidMaxRetryAttemptsError(
                        provided_max_attempts=value,
                        min_value=1,
                    )
                if key == 'mode' and value not in valid_modes:
                    raise InvalidRetryModeError(
                        provided_retry_mode=value,
                        valid_modes=valid_modes,
                    )

    def merge(self, other_config):
        """Merges the config object with another config object

        This will merge in all non-default values from the provided config
        and return a new config object

        :type other_config: botocore.config.Config
        :param other config: Another config object to merge with. The values
            in the provided config object will take precedence in the merging

        :returns: A config object built from the merged values of both
            config objects.
        """
        # Make a copy of the current attributes in the config object.
        config_options = copy.copy(self._user_provided_options)

        # Merge in the user provided options from the other config
        config_options.update(other_config._user_provided_options)

        # Return a new config object with the merged properties.
        return Config(**config_options)
