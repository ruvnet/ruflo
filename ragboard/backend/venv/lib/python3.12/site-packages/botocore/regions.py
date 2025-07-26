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
"""Resolves regions and endpoints.

This module implements endpoint resolution, including resolving endpoints for a
given service and region and resolving the available endpoints for a service
in a specific AWS partition.
"""

import copy
import logging
import re
from enum import Enum

from botocore import UNSIGNED, xform_name
from botocore.auth import AUTH_TYPE_MAPS, HAS_CRT
from botocore.crt import CRT_SUPPORTED_AUTH_TYPES
from botocore.endpoint_provider import EndpointProvider
from botocore.exceptions import (
    EndpointProviderError,
    EndpointVariantError,
    InvalidEndpointConfigurationError,
    InvalidHostLabelError,
    MissingDependencyException,
    NoRegionError,
    ParamValidationError,
    UnknownEndpointResolutionBuiltInName,
    UnknownRegionError,
    UnknownSignatureVersionError,
    UnsupportedS3AccesspointConfigurationError,
    UnsupportedS3ConfigurationError,
    UnsupportedS3ControlArnError,
    UnsupportedS3ControlConfigurationError,
)
from botocore.utils import ensure_boolean, instance_cache

LOG = logging.getLogger(__name__)
DEFAULT_URI_TEMPLATE = '{service}.{region}.{dnsSuffix}'  # noqa
DEFAULT_SERVICE_DATA = {'endpoints': {}}


class BaseEndpointResolver:
    """Resolves regions and endpoints. Must be subclassed."""

    def construct_endpoint(self, service_name, region_name=None):
        """Resolves an endpoint for a service and region combination.

        :type service_name: string
        :param service_name: Name of the service to resolve an endpoint for
            (e.g., s3)

        :type region_name: string
        :param region_name: Region/endpoint name to resolve (e.g., us-east-1)
            if no region is provided, the first found partition-wide endpoint
            will be used if available.

        :rtype: dict
        :return: Returns a dict containing the following keys:
            - partition: (string, required) Resolved partition name
            - endpointName: (string, required) Resolved endpoint name
            - hostname: (string, required) Hostname to use for this endpoint
            - sslCommonName: (string) sslCommonName to use for this endpoint.
            - credentialScope: (dict) Signature version 4 credential scope
              - region: (string) region name override when signing.
              - service: (string) service name override when signing.
            - signatureVersions: (list<string>) A list of possible signature
              versions, including s3, v4, v2, and s3v4
            - protocols: (list<string>) A list of supported protocols
              (e.g., http, https)
            - ...: Other keys may be included as well based on the metadata
        """
        raise NotImplementedError

    def get_available_partitions(self):
        """Lists the partitions available to the endpoint resolver.

        :return: Returns a list of partition names (e.g., ["aws", "aws-cn"]).
        """
        raise NotImplementedError

    def get_available_endpoints(
        self, service_name, partition_name='aws', allow_non_regional=False
    ):
        """Lists the endpoint names of a particular partition.

        :type service_name: string
        :param service_name: Name of a service to list endpoint for (e.g., s3)

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
        raise NotImplementedError


class EndpointResolver(BaseEndpointResolver):
    """Resolves endpoints based on partition endpoint metadata"""

    _UNSUPPORTED_DUALSTACK_PARTITIONS = ['aws-iso', 'aws-iso-b']

    def __init__(self, endpoint_data, uses_builtin_data=False):
        """
        :type endpoint_data: dict
        :param endpoint_data: A dict of partition data.

        :type uses_builtin_data: boolean
        :param uses_builtin_data: Whether the endpoint data originates in the
            package's data directory.
        """
        if 'partitions' not in endpoint_data:
            raise ValueError('Missing "partitions" in endpoint data')
        self._endpoint_data = endpoint_data
        self.uses_builtin_data = uses_builtin_data

    def get_service_endpoints_data(self, service_name, partition_name='aws'):
        for partition in self._endpoint_data['partitions']:
            if partition['partition'] != partition_name:
                continue
            services = partition['services']
            if service_name not in services:
                continue
            return services[service_name]['endpoints']

    def get_available_partitions(self):
        result = []
        for partition in self._endpoint_data['partitions']:
            result.append(partition['partition'])
        return result

    def get_available_endpoints(
        self,
        service_name,
        partition_name='aws',
        allow_non_regional=False,
        endpoint_variant_tags=None,
    ):
        result = []
        for partition in self._endpoint_data['partitions']:
            if partition['partition'] != partition_name:
                continue
            services = partition['services']
            if service_name not in services:
                continue
            service_endpoints = services[service_name]['endpoints']
            for endpoint_name in service_endpoints:
                is_regional_endpoint = endpoint_name in partition['regions']
                # Only regional endpoints can be modeled with variants
                if endpoint_variant_tags and is_regional_endpoint:
                    variant_data = self._retrieve_variant_data(
                        service_endpoints[endpoint_name], endpoint_variant_tags
                    )
                    if variant_data:
                        result.append(endpoint_name)
                elif allow_non_regional or is_regional_endpoint:
                    result.append(endpoint_name)
        return result

    def get_partition_dns_suffix(
        self, partition_name, endpoint_variant_tags=None
    ):
        for partition in self._endpoint_data['partitions']:
            if partition['partition'] == partition_name:
                if endpoint_variant_tags:
                    variant = self._retrieve_variant_data(
                        partition.get('defaults'), endpoint_variant_tags
                    )
                    if variant and 'dnsSuffix' in variant:
                        return variant['dnsSuffix']
                else:
                    return partition['dnsSuffix']
        return None

    def construct_endpoint(
        self,
        service_name,
        region_name=None,
        partition_name=None,
        use_dualstack_endpoint=False,
        use_fips_endpoint=False,
    ):
        if (
            service_name == 's3'
            and use_dualstack_endpoint
            and region_name is None
        ):
            region_name = 'us-east-1'

        if partition_name is not None:
            valid_partition = None
            for partition in self._endpoint_data['partitions']:
                if partition['partition'] == partition_name:
                    valid_partition = partition

            if valid_partition is not None:
                result = self._endpoint_for_partition(
                    valid_partition,
                    service_name,
                    region_name,
                    use_dualstack_endpoint,
                    use_fips_endpoint,
                    True,
                )
                return result
            return None

        # Iterate over each partition until a match is found.
        for partition in self._endpoint_data['partitions']:
            if use_dualstack_endpoint and (
                partition['partition']
                in self._UNSUPPORTED_DUALSTACK_PARTITIONS
            ):
                continue
            result = self._endpoint_for_partition(
                partition,
                service_name,
                region_name,
                use_dualstack_endpoint,
                use_fips_endpoint,
            )
            if result:
                return result

    def get_partition_for_region(self, region_name):
        for partition in self._endpoint_data['partitions']:
            if self._region_match(partition, region_name):
                return partition['partition']
        raise UnknownRegionError(
            region_name=region_name,
            error_msg='No partition found for provided region_name.',
        )

    def _endpoint_for_partition(
        self,
        partition,
        service_name,
        region_name,
        use_dualstack_endpoint,
        use_fips_endpoint,
        force_partition=False,
    ):
        partition_name = partition["partition"]
        if (
            use_dualstack_endpoint
            and partition_name in self._UNSUPPORTED_DUALSTACK_PARTITIONS
        ):
            error_msg = (
                "Dualstack endpoints are currently not supported"
                f" for {partition_name} partition"
            )
            raise EndpointVariantError(tags=['dualstack'], error_msg=error_msg)

        # Get the service from the partition, or an empty template.
        service_data = partition['services'].get(
            service_name, DEFAULT_SERVICE_DATA
        )
        # Use the partition endpoint if no region is supplied.
        if region_name is None:
            if 'partitionEndpoint' in service_data:
                region_name = service_data['partitionEndpoint']
            else:
                raise NoRegionError()

        resolve_kwargs = {
            'partition': partition,
            'service_name': service_name,
            'service_data': service_data,
            'endpoint_name': region_name,
            'use_dualstack_endpoint': use_dualstack_endpoint,
            'use_fips_endpoint': use_fips_endpoint,
        }

        # Attempt to resolve the exact region for this partition.
        if region_name in service_data['endpoints']:
            return self._resolve(**resolve_kwargs)

        # Check to see if the endpoint provided is valid for the partition.
        if self._region_match(partition, region_name) or force_partition:
            # Use the partition endpoint if set and not regionalized.
            partition_endpoint = service_data.get('partitionEndpoint')
            is_regionalized = service_data.get('isRegionalized', True)
            if partition_endpoint and not is_regionalized:
                LOG.debug(
                    'Using partition endpoint for %s, %s: %s',
                    service_name,
                    region_name,
                    partition_endpoint,
                )
                resolve_kwargs['endpoint_name'] = partition_endpoint
                return self._resolve(**resolve_kwargs)
            LOG.debug(
                'Creating a regex based endpoint for %s, %s',
                service_name,
                region_name,
            )
            return self._resolve(**resolve_kwargs)

    def _region_match(self, partition, region_name):
        if region_name in partition['regions']:
            return True
        if 'regionRegex' in partition:
            return re.compile(partition['regionRegex']).match(region_name)
        return False

    def _retrieve_variant_data(self, endpoint_data, tags):
        variants = endpoint_data.get('variants', [])
        for variant in variants:
            if set(variant['tags']) == set(tags):
                result = variant.copy()
                return result

    def _create_tag_list(self, use_dualstack_endpoint, use_fips_endpoint):
        tags = []
        if use_dualstack_endpoint:
            tags.append('dualstack')
        if use_fips_endpoint:
            tags.append('fips')
        return tags

    def _resolve_variant(
        self, tags, endpoint_data, service_defaults, partition_defaults
    ):
        result = {}
        for variants in [endpoint_data, service_defaults, partition_defaults]:
            variant = self._retrieve_variant_data(variants, tags)
            if variant:
                self._merge_keys(variant, result)
        return result

    def _resolve(
        self,
        partition,
        service_name,
        service_data,
        endpoint_name,
        use_dualstack_endpoint,
        use_fips_endpoint,
    ):
        endpoint_data = service_data.get('endpoints', {}).get(
            endpoint_name, {}
        )

        if endpoint_data.get('deprecated'):
            LOG.warning(
                f'Client is configured with the deprecated endpoint: {endpoint_name}'
            )

        service_defaults = service_data.get('defaults', {})
        partition_defaults = partition.get('defaults', {})
        tags = self._create_tag_list(use_dualstack_endpoint, use_fips_endpoint)

        if tags:
            result = self._resolve_variant(
                tags, endpoint_data, service_defaults, partition_defaults
            )
            if result == {}:
                error_msg = (
                    f"Endpoint does not exist for {service_name} "
                    f"in region {endpoint_name}"
                )
                raise EndpointVariantError(tags=tags, error_msg=error_msg)
            self._merge_keys(endpoint_data, result)
        else:
            result = endpoint_data

        # If dnsSuffix has not already been consumed from a variant definition
        if 'dnsSuffix' not in result:
            result['dnsSuffix'] = partition['dnsSuffix']

        result['partition'] = partition['partition']
        result['endpointName'] = endpoint_name

        # Merge in the service defaults then the partition defaults.
        self._merge_keys(service_defaults, result)
        self._merge_keys(partition_defaults, result)

        result['hostname'] = self._expand_template(
            partition,
            result['hostname'],
            service_name,
            endpoint_name,
            result['dnsSuffix'],
        )
        if 'sslCommonName' in result:
            result['sslCommonName'] = self._expand_template(
                partition,
                result['sslCommonName'],
                service_name,
                endpoint_name,
                result['dnsSuffix'],
            )

        return result

    def _merge_keys(self, from_data, result):
        for key in from_data:
            if key not in result:
                result[key] = from_data[key]

    def _expand_template(
        self, partition, template, service_name, endpoint_name, dnsSuffix
    ):
        return template.format(
            service=service_name, region=endpoint_name, dnsSuffix=dnsSuffix
        )


class EndpointResolverBuiltins(str, Enum):
    # The AWS Region configured for the SDK client (str)
    AWS_REGION = "AWS::Region"
    # Whether the UseFIPSEndpoint configuration option has been enabled for
    # the SDK client (bool)
    AWS_USE_FIPS = "AWS::UseFIPS"
    # Whether the UseDualStackEndpoint configuration option has been enabled
    # for the SDK client (bool)
    AWS_USE_DUALSTACK = "AWS::UseDualStack"
    # Whether the global endpoint should be used with STS, rather the the
    # regional endpoint for us-east-1 (bool)
    AWS_STS_USE_GLOBAL_ENDPOINT = "AWS::STS::UseGlobalEndpoint"
    # Whether the global endpoint should be used with S3, rather then the
    # regional endpoint for us-east-1 (bool)
    AWS_S3_USE_GLOBAL_ENDPOINT = "AWS::S3::UseGlobalEndpoint"
    # Whether S3 Transfer Acceleration has been requested (bool)
    AWS_S3_ACCELERATE = "AWS::S3::Accelerate"
    # Whether S3 Force Path Style has been enabled (bool)
    AWS_S3_FORCE_PATH_STYLE = "AWS::S3::ForcePathStyle"
    # Whether to use the ARN region or raise an error when ARN and client
    # region differ (for s3 service only, bool)
    AWS_S3_USE_ARN_REGION = "AWS::S3::UseArnRegion"
    # Whether to use the ARN region or raise an error when ARN and client
    # region differ (for s3-control service only, bool)
    AWS_S3CONTROL_USE_ARN_REGION = 'AWS::S3Control::UseArnRegion'
    # Whether multi-region access points (MRAP) should be disabled (bool)
    AWS_S3_DISABLE_MRAP = "AWS::S3::DisableMultiRegionAccessPoints"
    # Whether a custom endpoint has been configured (str)
    SDK_ENDPOINT = "SDK::Endpoint"


class EndpointRulesetResolver:
    """Resolves endpoints using a service's endpoint ruleset"""

    def __init__(
        self,
        endpoint_ruleset_data,
        partition_data,
        service_model,
        builtins,
        client_context,
        event_emitter,
        use_ssl=True,
        requested_auth_scheme=None,
    ):
        self._provider = EndpointProvider(
            ruleset_data=endpoint_ruleset_data,
            partition_data=partition_data,
        )
        self._param_definitions = self._provider.ruleset.parameters
        self._service_model = service_model
        self._builtins = builtins
        self._client_context = client_context
        self._event_emitter = event_emitter
        self._use_ssl = use_ssl
        self._requested_auth_scheme = requested_auth_scheme
        self._instance_cache = {}

    def construct_endpoint(
        self,
        operation_model,
        call_args,
        request_context,
    ):
        """Invokes the provider with params defined in the service's ruleset"""
        if call_args is None:
            call_args = {}

        if request_context is None:
            request_context = {}

        provider_params = self._get_provider_params(
            operation_model, call_args, request_context
        )
        LOG.debug(
            f'Calling endpoint provider with parameters: {provider_params}'
        )
        try:
            provider_result = self._provider.resolve_endpoint(
                **provider_params
            )
        except EndpointProviderError as ex:
            botocore_exception = self.ruleset_error_to_botocore_exception(
                ex, provider_params
            )
            if botocore_exception is None:
                raise
            else:
                raise botocore_exception from ex
        LOG.debug(f'Endpoint provider result: {provider_result.url}')

        # The endpoint provider does not support non-secure transport.
        if not self._use_ssl and provider_result.url.startswith('https://'):
            provider_result = provider_result._replace(
                url=f'http://{provider_result.url[8:]}'
            )

        # Multi-valued headers are not supported in botocore. Replace the list
        # of values returned for each header with just its first entry,
        # dropping any additionally entries.
        provider_result = provider_result._replace(
            headers={
                key: val[0] for key, val in provider_result.headers.items()
            }
        )

        return provider_result

    def _get_provider_params(
        self, operation_model, call_args, request_context
    ):
        """Resolve a value for each parameter defined in the service's ruleset

        The resolution order for parameter values is:
        1. Operation-specific static context values from the service definition
        2. Operation-specific dynamic context values from API parameters
        3. Client-specific context parameters
        4. Built-in values such as region, FIPS usage, ...
        """
        provider_params = {}
        # Builtin values can be customized for each operation by hooks
        # subscribing to the ``before-endpoint-resolution.*`` event.
        customized_builtins = self._get_customized_builtins(
            operation_model, call_args, request_context
        )
        for param_name, param_def in self._param_definitions.items():
            param_val = self._resolve_param_from_context(
                param_name=param_name,
                operation_model=operation_model,
                call_args=call_args,
            )
            if param_val is None and param_def.builtin is not None:
                param_val = self._resolve_param_as_builtin(
                    builtin_name=param_def.builtin,
                    builtins=customized_builtins,
                )
            if param_val is not None:
                provider_params[param_name] = param_val

        return provider_params

    def _resolve_param_from_context(
        self, param_name, operation_model, call_args
    ):
        static = self._resolve_param_as_static_context_param(
            param_name, operation_model
        )
        if static is not None:
            return static
        dynamic = self._resolve_param_as_dynamic_context_param(
            param_name, operation_model, call_args
        )
        if dynamic is not None:
            return dynamic
        return self._resolve_param_as_client_context_param(param_name)

    def _resolve_param_as_static_context_param(
        self, param_name, operation_model
    ):
        static_ctx_params = self._get_static_context_params(operation_model)
        return static_ctx_params.get(param_name)

    def _resolve_param_as_dynamic_context_param(
        self, param_name, operation_model, call_args
    ):
        dynamic_ctx_params = self._get_dynamic_context_params(operation_model)
        if param_name in dynamic_ctx_params:
            member_name = dynamic_ctx_params[param_name]
            return call_args.get(member_name)

    def _resolve_param_as_client_context_param(self, param_name):
        client_ctx_params = self._get_client_context_params()
        if param_name in client_ctx_params:
            client_ctx_varname = client_ctx_params[param_name]
            return self._client_context.get(client_ctx_varname)

    def _resolve_param_as_builtin(self, builtin_name, builtins):
        if builtin_name not in EndpointResolverBuiltins.__members__.values():
            raise UnknownEndpointResolutionBuiltInName(name=builtin_name)
        return builtins.get(builtin_name)

    @instance_cache
    def _get_static_context_params(self, operation_model):
        """Mapping of param names to static param value for an operation"""
        return {
            param.name: param.value
            for param in operation_model.static_context_parameters
        }

    @instance_cache
    def _get_dynamic_context_params(self, operation_model):
        """Mapping of param names to member names for an operation"""
        return {
            param.name: param.member_name
            for param in operation_model.context_parameters
        }

    @instance_cache
    def _get_client_context_params(self):
        """Mapping of param names to client configuration variable"""
        return {
            param.name: xform_name(param.name)
            for param in self._service_model.client_context_parameters
        }

    def _get_customized_builtins(
        self, operation_model, call_args, request_context
    ):
        service_id = self._service_model.service_id.hyphenize()
        customized_builtins = copy.copy(self._builtins)
        # Handlers are expected to modify the builtins dict in place.
        self._event_emitter.emit(
            f'before-endpoint-resolution.{service_id}',
            builtins=customized_builtins,
            model=operation_model,
            params=call_args,
            context=request_context,
        )
        return customized_builtins

    def auth_schemes_to_signing_ctx(self, auth_schemes):
        """Convert an Endpoint's authSchemes property to a signing_context dict

        :type auth_schemes: list
        :param auth_schemes: A list of dictionaries taken from the
            ``authSchemes`` property of an Endpoint object returned by
            ``EndpointProvider``.

        :rtype: str, dict
        :return: Tuple of auth type string (to be used in
            ``request_context['auth_type']``) and signing context dict (for use
            in ``request_context['signing']``).
        """
        if not isinstance(auth_schemes, list) or len(auth_schemes) == 0:
            raise TypeError("auth_schemes must be a non-empty list.")

        LOG.debug(
            'Selecting from endpoint provider\'s list of auth schemes: %s. '
            'User selected auth scheme is: "%s"',
            ', '.join([f'"{s.get("name")}"' for s in auth_schemes]),
            self._requested_auth_scheme,
        )

        if self._requested_auth_scheme == UNSIGNED:
            return 'none', {}

        auth_schemes = [
            {**scheme, 'name': self._strip_sig_prefix(scheme['name'])}
            for scheme in auth_schemes
        ]
        if self._requested_auth_scheme is not None:
            try:
                # Use the first scheme that matches the requested scheme,
                # after accounting for naming differences between botocore and
                # endpoint rulesets. Keep the requested name.
                name, scheme = next(
                    (self._requested_auth_scheme, s)
                    for s in auth_schemes
                    if self._does_botocore_authname_match_ruleset_authname(
                        self._requested_auth_scheme, s['name']
                    )
                )
            except StopIteration:
                # For legacy signers, no match will be found. Do not raise an
                # exception, instead default to the logic in botocore
                # customizations.
                return None, {}
        else:
            try:
                name, scheme = next(
                    (s['name'], s)
                    for s in auth_schemes
                    if s['name'] in AUTH_TYPE_MAPS
                )
            except StopIteration:
                # If no auth scheme was specifically requested and an
                # authSchemes list is present in the Endpoint object but none
                # of the entries are supported, raise an exception.
                fixable_with_crt = False
                auth_type_options = [s['name'] for s in auth_schemes]
                if not HAS_CRT:
                    fixable_with_crt = any(
                        scheme in CRT_SUPPORTED_AUTH_TYPES
                        for scheme in auth_type_options
                    )

                if fixable_with_crt:
                    raise MissingDependencyException(
                        msg='This operation requires an additional dependency.'
                        ' Use pip install botocore[crt] before proceeding.'
                    )
                else:
                    raise UnknownSignatureVersionError(
                        signature_version=', '.join(auth_type_options)
                    )

        signing_context = {}
        if 'signingRegion' in scheme:
            signing_context['region'] = scheme['signingRegion']
        elif 'signingRegionSet' in scheme:
            if len(scheme['signingRegionSet']) > 0:
                signing_context['region'] = scheme['signingRegionSet'][0]
        if 'signingName' in scheme:
            signing_context.update(signing_name=scheme['signingName'])
        if 'disableDoubleEncoding' in scheme:
            signing_context['disableDoubleEncoding'] = ensure_boolean(
                scheme['disableDoubleEncoding']
            )

        LOG.debug(
            'Selected auth type "%s" as "%s" with signing context params: %s',
            scheme['name'],  # original name without "sig"
            name,  # chosen name can differ when `signature_version` is set
            signing_context,
        )
        return name, signing_context

    def _strip_sig_prefix(self, auth_name):
        """Normalize auth type names by removing any "sig" prefix"""
        return auth_name[3:] if auth_name.startswith('sig') else auth_name

    def _does_botocore_authname_match_ruleset_authname(self, botoname, rsname):
        """
        Whether a valid string provided as signature_version parameter for
        client construction refers to the same auth methods as a string
        returned by the endpoint ruleset provider. This accounts for:

        * The ruleset prefixes auth names with "sig"
        * The s3 and s3control rulesets don't distinguish between v4[a] and
          s3v4[a] signers
        * The v2, v3, and HMAC v1 based signers (s3, s3-*) are botocore legacy
          features and do not exist in the rulesets
        * Only characters up to the first dash are considered

        Example matches:
        * v4, sigv4
        * v4, v4
        * s3v4, sigv4
        * s3v7, sigv7 (hypothetical example)
        * s3v4a, sigv4a
        * s3v4-query, sigv4

        Example mismatches:
        * v4a, sigv4
        * s3, sigv4
        * s3-presign-post, sigv4
        """
        rsname = self._strip_sig_prefix(rsname)
        botoname = botoname.split('-')[0]
        if botoname != 's3' and botoname.startswith('s3'):
            botoname = botoname[2:]
        return rsname == botoname

    def ruleset_error_to_botocore_exception(self, ruleset_exception, params):
        """Attempts to translate ruleset errors to pre-existing botocore
        exception types by string matching exception strings.
        """
        msg = ruleset_exception.kwargs.get('msg')
        if msg is None:
            return

        if msg.startswith('Invalid region in ARN: '):
            # Example message:
            # "Invalid region in ARN: `us-we$t-2` (invalid DNS name)"
            try:
                label = msg.split('`')[1]
            except IndexError:
                label = msg
            return InvalidHostLabelError(label=label)

        service_name = self._service_model.service_name
        if service_name == 's3':
            if (
                msg == 'S3 Object Lambda does not support S3 Accelerate'
                or msg == 'Accelerate cannot be used with FIPS'
            ):
                return UnsupportedS3ConfigurationError(msg=msg)
            if (
                msg.startswith('S3 Outposts does not support')
                or msg.startswith('S3 MRAP does not support')
                or msg.startswith('S3 Object Lambda does not support')
                or msg.startswith('Access Points do not support')
                or msg.startswith('Invalid configuration:')
                or msg.startswith('Client was configured for partition')
            ):
                return UnsupportedS3AccesspointConfigurationError(msg=msg)
            if msg.lower().startswith('invalid arn:'):
                return ParamValidationError(report=msg)
        if service_name == 's3control':
            if msg.startswith('Invalid ARN:'):
                arn = params.get('Bucket')
                return UnsupportedS3ControlArnError(arn=arn, msg=msg)
            if msg.startswith('Invalid configuration:') or msg.startswith(
                'Client was configured for partition'
            ):
                return UnsupportedS3ControlConfigurationError(msg=msg)
            if msg == "AccountId is required but not set":
                return ParamValidationError(report=msg)
        if service_name == 'events':
            if msg.startswith(
                'Invalid Configuration: FIPS is not supported with '
                'EventBridge multi-region endpoints.'
            ):
                return InvalidEndpointConfigurationError(msg=msg)
            if msg == 'EndpointId must be a valid host label.':
                return InvalidEndpointConfigurationError(msg=msg)
        return None
