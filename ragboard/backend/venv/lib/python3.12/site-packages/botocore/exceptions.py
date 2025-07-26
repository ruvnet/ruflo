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

from botocore.vendored import requests
from botocore.vendored.requests.packages import urllib3


def _exception_from_packed_args(exception_cls, args=None, kwargs=None):
    # This is helpful for reducing Exceptions that only accept kwargs as
    # only positional arguments can be provided for __reduce__
    # Ideally, this would also be a class method on the BotoCoreError
    # but instance methods cannot be pickled.
    if args is None:
        args = ()
    if kwargs is None:
        kwargs = {}
    return exception_cls(*args, **kwargs)


class BotoCoreError(Exception):
    """
    The base exception class for BotoCore exceptions.

    :ivar msg: The descriptive message associated with the error.
    """

    fmt = 'An unspecified error occurred'

    def __init__(self, **kwargs):
        msg = self.fmt.format(**kwargs)
        Exception.__init__(self, msg)
        self.kwargs = kwargs

    def __reduce__(self):
        return _exception_from_packed_args, (self.__class__, None, self.kwargs)


class DataNotFoundError(BotoCoreError):
    """
    The data associated with a particular path could not be loaded.

    :ivar data_path: The data path that the user attempted to load.
    """

    fmt = 'Unable to load data for: {data_path}'


class UnknownServiceError(DataNotFoundError):
    """Raised when trying to load data for an unknown service.

    :ivar service_name: The name of the unknown service.

    """

    fmt = (
        "Unknown service: '{service_name}'. Valid service names are: "
        "{known_service_names}"
    )


class UnknownRegionError(BotoCoreError):
    """Raised when trying to load data for an unknown region.

    :ivar region_name: The name of the unknown region.

    """

    fmt = "Unknown region: '{region_name}'. {error_msg}"


class ApiVersionNotFoundError(BotoCoreError):
    """
    The data associated with either the API version or a compatible one
    could not be loaded.

    :ivar data_path: The data path that the user attempted to load.
    :ivar api_version: The API version that the user attempted to load.
    """

    fmt = 'Unable to load data {data_path} for: {api_version}'


class HTTPClientError(BotoCoreError):
    fmt = 'An HTTP Client raised an unhandled exception: {error}'

    def __init__(self, request=None, response=None, **kwargs):
        self.request = request
        self.response = response
        super().__init__(**kwargs)

    def __reduce__(self):
        return _exception_from_packed_args, (
            self.__class__,
            (self.request, self.response),
            self.kwargs,
        )


class ConnectionError(BotoCoreError):
    fmt = 'An HTTP Client failed to establish a connection: {error}'


class InvalidIMDSEndpointError(BotoCoreError):
    fmt = 'Invalid endpoint EC2 Instance Metadata endpoint: {endpoint}'


class InvalidIMDSEndpointModeError(BotoCoreError):
    fmt = (
        'Invalid EC2 Instance Metadata endpoint mode: {mode}'
        ' Valid endpoint modes (case-insensitive): {valid_modes}.'
    )


class EndpointConnectionError(ConnectionError):
    fmt = 'Could not connect to the endpoint URL: "{endpoint_url}"'


class SSLError(ConnectionError, requests.exceptions.SSLError):
    fmt = 'SSL validation failed for {endpoint_url} {error}'


class ConnectionClosedError(HTTPClientError):
    fmt = (
        'Connection was closed before we received a valid response '
        'from endpoint URL: "{endpoint_url}".'
    )


class ReadTimeoutError(
    HTTPClientError,
    requests.exceptions.ReadTimeout,
    urllib3.exceptions.ReadTimeoutError,
):
    fmt = 'Read timeout on endpoint URL: "{endpoint_url}"'


class ConnectTimeoutError(ConnectionError, requests.exceptions.ConnectTimeout):
    fmt = 'Connect timeout on endpoint URL: "{endpoint_url}"'


class ProxyConnectionError(ConnectionError, requests.exceptions.ProxyError):
    fmt = 'Failed to connect to proxy URL: "{proxy_url}"'


class ResponseStreamingError(HTTPClientError):
    fmt = 'An error occurred while reading from response stream: {error}'


class NoCredentialsError(BotoCoreError):
    """
    No credentials could be found.
    """

    fmt = 'Unable to locate credentials'


class NoAuthTokenError(BotoCoreError):
    """
    No authorization token could be found.
    """

    fmt = 'Unable to locate authorization token'


class TokenRetrievalError(BotoCoreError):
    """
    Error attempting to retrieve a token from a remote source.

    :ivar provider: The name of the token provider.
    :ivar error_msg: The msg explaining why the token could not be retrieved.

    """

    fmt = 'Error when retrieving token from {provider}: {error_msg}'


class PartialCredentialsError(BotoCoreError):
    """
    Only partial credentials were found.

    :ivar cred_var: The missing credential variable name.

    """

    fmt = 'Partial credentials found in {provider}, missing: {cred_var}'


class CredentialRetrievalError(BotoCoreError):
    """
    Error attempting to retrieve credentials from a remote source.

    :ivar provider: The name of the credential provider.
    :ivar error_msg: The msg explaining why credentials could not be
        retrieved.

    """

    fmt = 'Error when retrieving credentials from {provider}: {error_msg}'


class UnknownSignatureVersionError(BotoCoreError):
    """
    Requested Signature Version is not known.

    :ivar signature_version: The name of the requested signature version.
    """

    fmt = 'Unknown Signature Version: {signature_version}.'


class ServiceNotInRegionError(BotoCoreError):
    """
    The service is not available in requested region.

    :ivar service_name: The name of the service.
    :ivar region_name: The name of the region.
    """

    fmt = 'Service {service_name} not available in region {region_name}'


class BaseEndpointResolverError(BotoCoreError):
    """Base error for endpoint resolving errors.

    Should never be raised directly, but clients can catch
    this exception if they want to generically handle any errors
    during the endpoint resolution process.

    """


class NoRegionError(BaseEndpointResolverError):
    """No region was specified."""

    fmt = 'You must specify a region.'


class EndpointVariantError(BaseEndpointResolverError):
    """
    Could not construct modeled endpoint variant.

    :ivar error_msg: The message explaining why the modeled endpoint variant
        is unable to be constructed.

    """

    fmt = (
        'Unable to construct a modeled endpoint with the following '
        'variant(s) {tags}: '
    )


class UnknownEndpointError(BaseEndpointResolverError, ValueError):
    """
    Could not construct an endpoint.

    :ivar service_name: The name of the service.
    :ivar region_name: The name of the region.
    """

    fmt = (
        'Unable to construct an endpoint for '
        '{service_name} in region {region_name}'
    )


class UnknownFIPSEndpointError(BaseEndpointResolverError):
    """
    Could not construct a FIPS endpoint.

    :ivar service_name: The name of the service.
    :ivar region_name: The name of the region.
    """

    fmt = (
        'The provided FIPS pseudo-region "{region_name}" is not known for '
        'the service "{service_name}". A FIPS compliant endpoint cannot be '
        'constructed.'
    )


class ProfileNotFound(BotoCoreError):
    """
    The specified configuration profile was not found in the
    configuration file.

    :ivar profile: The name of the profile the user attempted to load.
    """

    fmt = 'The config profile ({profile}) could not be found'


class ConfigParseError(BotoCoreError):
    """
    The configuration file could not be parsed.

    :ivar path: The path to the configuration file.
    """

    fmt = 'Unable to parse config file: {path}'


class ConfigNotFound(BotoCoreError):
    """
    The specified configuration file could not be found.

    :ivar path: The path to the configuration file.
    """

    fmt = 'The specified config file ({path}) could not be found.'


class MissingParametersError(BotoCoreError):
    """
    One or more required parameters were not supplied.

    :ivar object: The object that has missing parameters.
        This can be an operation or a parameter (in the
        case of inner params).  The str() of this object
        will be used so it doesn't need to implement anything
        other than str().
    :ivar missing: The names of the missing parameters.
    """

    fmt = (
        'The following required parameters are missing for '
        '{object_name}: {missing}'
    )


class ValidationError(BotoCoreError):
    """
    An exception occurred validating parameters.

    Subclasses must accept a ``value`` and ``param``
    argument in their ``__init__``.

    :ivar value: The value that was being validated.
    :ivar param: The parameter that failed validation.
    :ivar type_name: The name of the underlying type.
    """

    fmt = "Invalid value ('{value}') for param {param} " "of type {type_name} "


class ParamValidationError(BotoCoreError):
    fmt = 'Parameter validation failed:\n{report}'


# These exceptions subclass from ValidationError so that code
# can just 'except ValidationError' to catch any possibly validation
# error.
class UnknownKeyError(ValidationError):
    """
    Unknown key in a struct parameter.

    :ivar value: The value that was being checked.
    :ivar param: The name of the parameter.
    :ivar choices: The valid choices the value can be.
    """

    fmt = (
        "Unknown key '{value}' for param '{param}'.  Must be one "
        "of: {choices}"
    )


class RangeError(ValidationError):
    """
    A parameter value was out of the valid range.

    :ivar value: The value that was being checked.
    :ivar param: The parameter that failed validation.
    :ivar min_value: The specified minimum value.
    :ivar max_value: The specified maximum value.
    """

    fmt = (
        'Value out of range for param {param}: '
        '{min_value} <= {value} <= {max_value}'
    )


class UnknownParameterError(ValidationError):
    """
    Unknown top level parameter.

    :ivar name: The name of the unknown parameter.
    :ivar operation: The name of the operation.
    :ivar choices: The valid choices the parameter name can be.
    """

    fmt = (
        "Unknown parameter '{name}' for operation {operation}.  Must be one "
        "of: {choices}"
    )


class InvalidRegionError(ValidationError, ValueError):
    """
    Invalid region_name provided to client or resource.

    :ivar region_name: region_name that was being validated.
    """

    fmt = "Provided region_name '{region_name}' doesn't match a supported format."


class AliasConflictParameterError(ValidationError):
    """
    Error when an alias is provided for a parameter as well as the original.

    :ivar original: The name of the original parameter.
    :ivar alias: The name of the alias
    :ivar operation: The name of the operation.
    """

    fmt = (
        "Parameter '{original}' and its alias '{alias}' were provided "
        "for operation {operation}.  Only one of them may be used."
    )


class UnknownServiceStyle(BotoCoreError):
    """
    Unknown style of service invocation.

    :ivar service_style: The style requested.
    """

    fmt = 'The service style ({service_style}) is not understood.'


class PaginationError(BotoCoreError):
    fmt = 'Error during pagination: {message}'


class OperationNotPageableError(BotoCoreError):
    fmt = 'Operation cannot be paginated: {operation_name}'


class ChecksumError(BotoCoreError):
    """The expected checksum did not match the calculated checksum."""

    fmt = (
        'Checksum {checksum_type} failed, expected checksum '
        '{expected_checksum} did not match calculated checksum '
        '{actual_checksum}.'
    )


class UnseekableStreamError(BotoCoreError):
    """Need to seek a stream, but stream does not support seeking."""

    fmt = (
        'Need to rewind the stream {stream_object}, but stream '
        'is not seekable.'
    )


class WaiterError(BotoCoreError):
    """Waiter failed to reach desired state."""

    fmt = 'Waiter {name} failed: {reason}'

    def __init__(self, name, reason, last_response):
        super().__init__(name=name, reason=reason)
        self.last_response = last_response


class IncompleteReadError(BotoCoreError):
    """HTTP response did not return expected number of bytes."""

    fmt = (
        '{actual_bytes} read, but total bytes ' 'expected is {expected_bytes}.'
    )


class InvalidExpressionError(BotoCoreError):
    """Expression is either invalid or too complex."""

    fmt = 'Invalid expression {expression}: Only dotted lookups are supported.'


class UnknownCredentialError(BotoCoreError):
    """Tried to insert before/after an unregistered credential type."""

    fmt = 'Credential named {name} not found.'


class WaiterConfigError(BotoCoreError):
    """Error when processing waiter configuration."""

    fmt = 'Error processing waiter config: {error_msg}'


class UnknownClientMethodError(BotoCoreError):
    """Error when trying to access a method on a client that does not exist."""

    fmt = 'Client does not have method: {method_name}'


class UnsupportedSignatureVersionError(BotoCoreError):
    """Error when trying to use an unsupported Signature Version."""

    fmt = 'Signature version is not supported: {signature_version}'


class ClientError(Exception):
    MSG_TEMPLATE = (
        'An error occurred ({error_code}) when calling the {operation_name} '
        'operation{retry_info}: {error_message}'
    )

    def __init__(self, error_response, operation_name):
        retry_info = self._get_retry_info(error_response)
        error = error_response.get('Error', {})
        msg = self.MSG_TEMPLATE.format(
            error_code=error.get('Code', 'Unknown'),
            error_message=error.get('Message', 'Unknown'),
            operation_name=operation_name,
            retry_info=retry_info,
        )
        super().__init__(msg)
        self.response = error_response
        self.operation_name = operation_name

    def _get_retry_info(self, response):
        retry_info = ''
        if 'ResponseMetadata' in response:
            metadata = response['ResponseMetadata']
            if metadata.get('MaxAttemptsReached', False):
                if 'RetryAttempts' in metadata:
                    retry_info = (
                        f" (reached max retries: {metadata['RetryAttempts']})"
                    )
        return retry_info

    def __reduce__(self):
        # Subclasses of ClientError's are dynamically generated and
        # cannot be pickled unless they are attributes of a
        # module. So at the very least return a ClientError back.
        return ClientError, (self.response, self.operation_name)


class EventStreamError(ClientError):
    pass


class UnsupportedTLSVersionWarning(Warning):
    """Warn when an openssl version that uses TLS 1.2 is required"""

    pass


class ImminentRemovalWarning(Warning):
    pass


class InvalidDNSNameError(BotoCoreError):
    """Error when virtual host path is forced on a non-DNS compatible bucket"""

    fmt = (
        'Bucket named {bucket_name} is not DNS compatible. Virtual '
        'hosted-style addressing cannot be used. The addressing style '
        'can be configured by removing the addressing_style value '
        'or setting that value to \'path\' or \'auto\' in the AWS Config '
        'file or in the botocore.client.Config object.'
    )


class InvalidS3AddressingStyleError(BotoCoreError):
    """Error when an invalid path style is specified"""

    fmt = (
        'S3 addressing style {s3_addressing_style} is invalid. Valid options '
        'are: \'auto\', \'virtual\', and \'path\''
    )


class UnsupportedS3ArnError(BotoCoreError):
    """Error when S3 ARN provided to Bucket parameter is not supported"""

    fmt = (
        'S3 ARN {arn} provided to "Bucket" parameter is invalid. Only '
        'ARNs for S3 access-points are supported.'
    )


class UnsupportedS3ControlArnError(BotoCoreError):
    """Error when S3 ARN provided to S3 control parameter is not supported"""

    fmt = 'S3 ARN "{arn}" provided is invalid for this operation. {msg}'


class InvalidHostLabelError(BotoCoreError):
    """Error when an invalid host label would be bound to an endpoint"""

    fmt = (
        'Invalid host label to be bound to the hostname of the endpoint: '
        '"{label}".'
    )


class UnsupportedOutpostResourceError(BotoCoreError):
    """Error when S3 Outpost ARN provided to Bucket parameter is incomplete"""

    fmt = (
        'S3 Outpost ARN resource "{resource_name}" provided to "Bucket" '
        'parameter is invalid. Only ARNs for S3 Outpost arns with an '
        'access-point sub-resource are supported.'
    )


class UnsupportedS3ConfigurationError(BotoCoreError):
    """Error when an unsupported configuration is used with access-points"""

    fmt = 'Unsupported configuration when using S3: {msg}'


class UnsupportedS3AccesspointConfigurationError(BotoCoreError):
    """Error when an unsupported configuration is used with access-points"""

    fmt = 'Unsupported configuration when using S3 access-points: {msg}'


class InvalidEndpointDiscoveryConfigurationError(BotoCoreError):
    """Error when invalid value supplied for endpoint_discovery_enabled"""

    fmt = (
        'Unsupported configuration value for endpoint_discovery_enabled. '
        'Expected one of ("true", "false", "auto") but got {config_value}.'
    )


class UnsupportedS3ControlConfigurationError(BotoCoreError):
    """Error when an unsupported configuration is used with S3 Control"""

    fmt = 'Unsupported configuration when using S3 Control: {msg}'


class InvalidRetryConfigurationError(BotoCoreError):
    """Error when invalid retry configuration is specified"""

    fmt = (
        'Cannot provide retry configuration for "{retry_config_option}". '
        'Valid retry configuration options are: {valid_options}'
    )


class InvalidMaxRetryAttemptsError(InvalidRetryConfigurationError):
    """Error when invalid retry configuration is specified"""

    fmt = (
        'Value provided to "max_attempts": {provided_max_attempts} must '
        'be an integer greater than or equal to {min_value}.'
    )


class InvalidRetryModeError(InvalidRetryConfigurationError):
    """Error when invalid retry mode configuration is specified"""

    fmt = (
        'Invalid value provided to "mode": "{provided_retry_mode}" must '
        'be one of: {valid_modes}'
    )


class InvalidS3UsEast1RegionalEndpointConfigError(BotoCoreError):
    """Error for invalid s3 us-east-1 regional endpoints configuration"""

    fmt = (
        'S3 us-east-1 regional endpoint option '
        '{s3_us_east_1_regional_endpoint_config} is '
        'invalid. Valid options are: "legacy", "regional"'
    )


class InvalidSTSRegionalEndpointsConfigError(BotoCoreError):
    """Error when invalid sts regional endpoints configuration is specified"""

    fmt = (
        'STS regional endpoints option {sts_regional_endpoints_config} is '
        'invalid. Valid options are: "legacy", "regional"'
    )


class StubResponseError(BotoCoreError):
    fmt = (
        'Error getting response stub for operation {operation_name}: {reason}'
    )


class StubAssertionError(StubResponseError, AssertionError):
    pass


class UnStubbedResponseError(StubResponseError):
    pass


class InvalidConfigError(BotoCoreError):
    fmt = '{error_msg}'


class InfiniteLoopConfigError(InvalidConfigError):
    fmt = (
        'Infinite loop in credential configuration detected. Attempting to '
        'load from profile {source_profile} which has already been visited. '
        'Visited profiles: {visited_profiles}'
    )


class RefreshWithMFAUnsupportedError(BotoCoreError):
    fmt = 'Cannot refresh credentials: MFA token required.'


class MD5UnavailableError(BotoCoreError):
    fmt = "This system does not support MD5 generation."


class MissingDependencyException(BotoCoreError):
    fmt = "Missing Dependency: {msg}"


class MetadataRetrievalError(BotoCoreError):
    fmt = "Error retrieving metadata: {error_msg}"


class UndefinedModelAttributeError(Exception):
    pass


class MissingServiceIdError(UndefinedModelAttributeError):
    fmt = (
        "The model being used for the service {service_name} is missing the "
        "serviceId metadata property, which is required."
    )

    def __init__(self, **kwargs):
        msg = self.fmt.format(**kwargs)
        Exception.__init__(self, msg)
        self.kwargs = kwargs


class SSOError(BotoCoreError):
    fmt = (
        "An unspecified error happened when resolving AWS credentials or an "
        "access token from SSO."
    )


class SSOTokenLoadError(SSOError):
    fmt = "Error loading SSO Token: {error_msg}"


class UnauthorizedSSOTokenError(SSOError):
    fmt = (
        "The SSO session associated with this profile has expired or is "
        "otherwise invalid. To refresh this SSO session run aws sso login "
        "with the corresponding profile."
    )


class CapacityNotAvailableError(BotoCoreError):
    fmt = 'Insufficient request capacity available.'


class InvalidProxiesConfigError(BotoCoreError):
    fmt = 'Invalid configuration value(s) provided for proxies_config.'


class InvalidDefaultsMode(BotoCoreError):
    fmt = (
        'Client configured with invalid defaults mode: {mode}. '
        'Valid defaults modes include: {valid_modes}.'
    )


class AwsChunkedWrapperError(BotoCoreError):
    fmt = '{error_msg}'


class FlexibleChecksumError(BotoCoreError):
    fmt = '{error_msg}'


class InvalidEndpointConfigurationError(BotoCoreError):
    fmt = 'Invalid endpoint configuration: {msg}'


class EndpointProviderError(BotoCoreError):
    """Base error for the EndpointProvider class"""

    fmt = '{msg}'


class EndpointResolutionError(EndpointProviderError):
    """Error when input parameters resolve to an error rule"""

    fmt = '{msg}'


class UnknownEndpointResolutionBuiltInName(EndpointProviderError):
    fmt = 'Unknown builtin variable name: {name}'
