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
import logging

from botocore import waiter, xform_name
from botocore.args import ClientArgsCreator
from botocore.auth import AUTH_TYPE_MAPS
from botocore.awsrequest import prepare_request_dict
from botocore.compress import maybe_compress_request
from botocore.config import Config
from botocore.credentials import RefreshableCredentials
from botocore.discovery import (
    EndpointDiscoveryHandler,
    EndpointDiscoveryManager,
    block_endpoint_discovery_required_operations,
)
from botocore.docs.docstring import ClientMethodDocstring, PaginatorDocstring
from botocore.exceptions import (
    DataNotFoundError,
    InvalidEndpointDiscoveryConfigurationError,
    OperationNotPageableError,
    UnknownServiceError,
    UnknownSignatureVersionError,
)
from botocore.history import get_global_history_recorder
from botocore.hooks import first_non_none_response
from botocore.httpchecksum import (
    apply_request_checksum,
    resolve_checksum_context,
)
from botocore.model import ServiceModel
from botocore.paginate import Paginator
from botocore.retries import adaptive, standard
from botocore.useragent import UserAgentString
from botocore.utils import (
    CachedProperty,
    EventbridgeSignerSetter,
    S3ControlArnParamHandlerv2,
    S3ExpressIdentityResolver,
    S3RegionRedirectorv2,
    ensure_boolean,
    get_service_module_name,
)

# Keep these imported.  There's pre-existing code that uses:
# "from botocore.client import UNSIGNED"
# "from botocore.client import ClientError"
# etc.
from botocore.exceptions import ClientError  # noqa
from botocore.utils import S3ArnParamHandler  # noqa
from botocore.utils import S3ControlArnParamHandler  # noqa
from botocore.utils import S3ControlEndpointSetter  # noqa
from botocore.utils import S3EndpointSetter  # noqa
from botocore.utils import S3RegionRedirector  # noqa
from botocore import UNSIGNED  # noqa


_LEGACY_SIGNATURE_VERSIONS = frozenset(
    (
        'v2',
        'v3',
        'v3https',
        'v4',
        's3',
        's3v4',
    )
)


logger = logging.getLogger(__name__)
history_recorder = get_global_history_recorder()


class ClientCreator:
    """Creates client objects for a service."""

    def __init__(
        self,
        loader,
        endpoint_resolver,
        user_agent,
        event_emitter,
        retry_handler_factory,
        retry_config_translator,
        response_parser_factory=None,
        exceptions_factory=None,
        config_store=None,
        user_agent_creator=None,
    ):
        self._loader = loader
        self._endpoint_resolver = endpoint_resolver
        self._user_agent = user_agent
        self._event_emitter = event_emitter
        self._retry_handler_factory = retry_handler_factory
        self._retry_config_translator = retry_config_translator
        self._response_parser_factory = response_parser_factory
        self._exceptions_factory = exceptions_factory
        # TODO: Migrate things away from scoped_config in favor of the
        # config_store.  The config store can pull things from both the scoped
        # config and environment variables (and potentially more in the
        # future).
        self._config_store = config_store
        self._user_agent_creator = user_agent_creator

    def create_client(
        self,
        service_name,
        region_name,
        is_secure=True,
        endpoint_url=None,
        verify=None,
        credentials=None,
        scoped_config=None,
        api_version=None,
        client_config=None,
        auth_token=None,
    ):
        responses = self._event_emitter.emit(
            'choose-service-name', service_name=service_name
        )
        service_name = first_non_none_response(responses, default=service_name)
        service_model = self._load_service_model(service_name, api_version)
        try:
            endpoints_ruleset_data = self._load_service_endpoints_ruleset(
                service_name, api_version
            )
            partition_data = self._loader.load_data('partitions')
        except UnknownServiceError:
            endpoints_ruleset_data = None
            partition_data = None
            logger.info(
                'No endpoints ruleset found for service %s, falling back to '
                'legacy endpoint routing.',
                service_name,
            )

        cls = self._create_client_class(service_name, service_model)
        region_name, client_config = self._normalize_fips_region(
            region_name, client_config
        )
        endpoint_bridge = ClientEndpointBridge(
            self._endpoint_resolver,
            scoped_config,
            client_config,
            service_signing_name=service_model.metadata.get('signingName'),
            config_store=self._config_store,
            service_signature_version=service_model.metadata.get(
                'signatureVersion'
            ),
        )
        client_args = self._get_client_args(
            service_model,
            region_name,
            is_secure,
            endpoint_url,
            verify,
            credentials,
            scoped_config,
            client_config,
            endpoint_bridge,
            auth_token,
            endpoints_ruleset_data,
            partition_data,
        )
        service_client = cls(**client_args)
        self._register_retries(service_client)
        self._register_s3_events(
            client=service_client,
            endpoint_bridge=None,
            endpoint_url=None,
            client_config=client_config,
            scoped_config=scoped_config,
        )
        self._register_s3express_events(client=service_client)
        self._register_s3_control_events(client=service_client)
        self._register_endpoint_discovery(
            service_client, endpoint_url, client_config
        )
        return service_client

    def create_client_class(self, service_name, api_version=None):
        service_model = self._load_service_model(service_name, api_version)
        return self._create_client_class(service_name, service_model)

    def _create_client_class(self, service_name, service_model):
        class_attributes = self._create_methods(service_model)
        py_name_to_operation_name = self._create_name_mapping(service_model)
        class_attributes['_PY_TO_OP_NAME'] = py_name_to_operation_name
        bases = [BaseClient]
        service_id = service_model.service_id.hyphenize()
        self._event_emitter.emit(
            f'creating-client-class.{service_id}',
            class_attributes=class_attributes,
            base_classes=bases,
        )
        class_name = get_service_module_name(service_model)
        cls = type(str(class_name), tuple(bases), class_attributes)
        return cls

    def _normalize_fips_region(self, region_name, client_config):
        if region_name is not None:
            normalized_region_name = region_name.replace('fips-', '').replace(
                '-fips', ''
            )
            # If region has been transformed then set flag
            if normalized_region_name != region_name:
                config_use_fips_endpoint = Config(use_fips_endpoint=True)
                if client_config:
                    # Keeping endpoint setting client specific
                    client_config = client_config.merge(
                        config_use_fips_endpoint
                    )
                else:
                    client_config = config_use_fips_endpoint
                logger.warning(
                    f'transforming region from {region_name} to '
                    f'{normalized_region_name} and setting '
                    'use_fips_endpoint to true. client should not '
                    'be configured with a fips psuedo region.'
                )
                region_name = normalized_region_name
        return region_name, client_config

    def _load_service_model(self, service_name, api_version=None):
        json_model = self._loader.load_service_model(
            service_name, 'service-2', api_version=api_version
        )
        service_model = ServiceModel(json_model, service_name=service_name)
        return service_model

    def _load_service_endpoints_ruleset(self, service_name, api_version=None):
        return self._loader.load_service_model(
            service_name, 'endpoint-rule-set-1', api_version=api_version
        )

    def _register_retries(self, client):
        retry_mode = client.meta.config.retries['mode']
        if retry_mode == 'standard':
            self._register_v2_standard_retries(client)
        elif retry_mode == 'adaptive':
            self._register_v2_standard_retries(client)
            self._register_v2_adaptive_retries(client)
        elif retry_mode == 'legacy':
            self._register_legacy_retries(client)

    def _register_v2_standard_retries(self, client):
        max_attempts = client.meta.config.retries.get('total_max_attempts')
        kwargs = {'client': client}
        if max_attempts is not None:
            kwargs['max_attempts'] = max_attempts
        standard.register_retry_handler(**kwargs)

    def _register_v2_adaptive_retries(self, client):
        adaptive.register_retry_handler(client)

    def _register_legacy_retries(self, client):
        endpoint_prefix = client.meta.service_model.endpoint_prefix
        service_id = client.meta.service_model.service_id
        service_event_name = service_id.hyphenize()

        # First, we load the entire retry config for all services,
        # then pull out just the information we need.
        original_config = self._loader.load_data('_retry')
        if not original_config:
            return

        retries = self._transform_legacy_retries(client.meta.config.retries)
        retry_config = self._retry_config_translator.build_retry_config(
            endpoint_prefix,
            original_config.get('retry', {}),
            original_config.get('definitions', {}),
            retries,
        )

        logger.debug(
            "Registering retry handlers for service: %s",
            client.meta.service_model.service_name,
        )
        handler = self._retry_handler_factory.create_retry_handler(
            retry_config, endpoint_prefix
        )
        unique_id = f'retry-config-{service_event_name}'
        client.meta.events.register(
            f"needs-retry.{service_event_name}", handler, unique_id=unique_id
        )

    def _transform_legacy_retries(self, retries):
        if retries is None:
            return
        copied_args = retries.copy()
        if 'total_max_attempts' in retries:
            copied_args = retries.copy()
            copied_args['max_attempts'] = (
                copied_args.pop('total_max_attempts') - 1
            )
        return copied_args

    def _get_retry_mode(self, client, config_store):
        client_retries = client.meta.config.retries
        if (
            client_retries is not None
            and client_retries.get('mode') is not None
        ):
            return client_retries['mode']
        return config_store.get_config_variable('retry_mode') or 'legacy'

    def _register_endpoint_discovery(self, client, endpoint_url, config):
        if endpoint_url is not None:
            # Don't register any handlers in the case of a custom endpoint url
            return
        # Only attach handlers if the service supports discovery
        if client.meta.service_model.endpoint_discovery_operation is None:
            return
        events = client.meta.events
        service_id = client.meta.service_model.service_id.hyphenize()
        enabled = False
        if config and config.endpoint_discovery_enabled is not None:
            enabled = config.endpoint_discovery_enabled
        elif self._config_store:
            enabled = self._config_store.get_config_variable(
                'endpoint_discovery_enabled'
            )

        enabled = self._normalize_endpoint_discovery_config(enabled)
        if enabled and self._requires_endpoint_discovery(client, enabled):
            discover = enabled is True
            manager = EndpointDiscoveryManager(
                client, always_discover=discover
            )
            handler = EndpointDiscoveryHandler(manager)
            handler.register(events, service_id)
        else:
            events.register(
                'before-parameter-build',
                block_endpoint_discovery_required_operations,
            )

    def _normalize_endpoint_discovery_config(self, enabled):
        """Config must either be a boolean-string or string-literal 'auto'"""
        if isinstance(enabled, str):
            enabled = enabled.lower().strip()
            if enabled == 'auto':
                return enabled
            elif enabled in ('true', 'false'):
                return ensure_boolean(enabled)
        elif isinstance(enabled, bool):
            return enabled

        raise InvalidEndpointDiscoveryConfigurationError(config_value=enabled)

    def _requires_endpoint_discovery(self, client, enabled):
        if enabled == "auto":
            return client.meta.service_model.endpoint_discovery_required
        return enabled

    def _register_eventbridge_events(
        self, client, endpoint_bridge, endpoint_url
    ):
        if client.meta.service_model.service_name != 'events':
            return
        EventbridgeSignerSetter(
            endpoint_resolver=self._endpoint_resolver,
            region=client.meta.region_name,
            endpoint_url=endpoint_url,
        ).register(client.meta.events)

    def _register_s3express_events(
        self,
        client,
        endpoint_bridge=None,
        endpoint_url=None,
        client_config=None,
        scoped_config=None,
    ):
        if client.meta.service_model.service_name != 's3':
            return
        S3ExpressIdentityResolver(client, RefreshableCredentials).register()

    def _register_s3_events(
        self,
        client,
        endpoint_bridge,
        endpoint_url,
        client_config,
        scoped_config,
    ):
        if client.meta.service_model.service_name != 's3':
            return
        S3RegionRedirectorv2(None, client).register()
        self._set_s3_presign_signature_version(
            client.meta, client_config, scoped_config
        )
        client.meta.events.register(
            'before-parameter-build.s3', self._inject_s3_input_parameters
        )

    def _register_s3_control_events(
        self,
        client,
        endpoint_bridge=None,
        endpoint_url=None,
        client_config=None,
        scoped_config=None,
    ):
        if client.meta.service_model.service_name != 's3control':
            return
        S3ControlArnParamHandlerv2().register(client.meta.events)

    def _set_s3_presign_signature_version(
        self, client_meta, client_config, scoped_config
    ):
        # This will return the manually configured signature version, or None
        # if none was manually set. If a customer manually sets the signature
        # version, we always want to use what they set.
        provided_signature_version = _get_configured_signature_version(
            's3', client_config, scoped_config
        )
        if provided_signature_version is not None:
            return

        # Check to see if the region is a region that we know about. If we
        # don't know about a region, then we can safely assume it's a new
        # region that is sigv4 only, since all new S3 regions only allow sigv4.
        # The only exception is aws-global. This is a pseudo-region for the
        # global endpoint, we should respect the signature versions it
        # supports, which includes v2.
        regions = self._endpoint_resolver.get_available_endpoints(
            's3', client_meta.partition
        )
        if (
            client_meta.region_name != 'aws-global'
            and client_meta.region_name not in regions
        ):
            return

        # If it is a region we know about, we want to default to sigv2, so here
        # we check to see if it is available.
        endpoint = self._endpoint_resolver.construct_endpoint(
            's3', client_meta.region_name
        )
        signature_versions = endpoint['signatureVersions']
        if 's3' not in signature_versions:
            return

        # We now know that we're in a known region that supports sigv2 and
        # the customer hasn't set a signature version so we default the
        # signature version to sigv2.
        client_meta.events.register(
            'choose-signer.s3', self._default_s3_presign_to_sigv2
        )

    def _inject_s3_input_parameters(self, params, context, **kwargs):
        context['input_params'] = {}
        inject_parameters = ('Bucket', 'Delete', 'Key', 'Prefix')
        for inject_parameter in inject_parameters:
            if inject_parameter in params:
                context['input_params'][inject_parameter] = params[
                    inject_parameter
                ]

    def _default_s3_presign_to_sigv2(self, signature_version, **kwargs):
        """
        Returns the 's3' (sigv2) signer if presigning an s3 request. This is
        intended to be used to set the default signature version for the signer
        to sigv2. Situations where an asymmetric signature is required are the
        exception, for example MRAP needs v4a.

        :type signature_version: str
        :param signature_version: The current client signature version.

        :type signing_name: str
        :param signing_name: The signing name of the service.

        :return: 's3' if the request is an s3 presign request, None otherwise
        """
        if signature_version.startswith('v4a'):
            return

        if signature_version.startswith('v4-s3express'):
            return f'{signature_version}'

        for suffix in ['-query', '-presign-post']:
            if signature_version.endswith(suffix):
                return f's3{suffix}'

    def _get_client_args(
        self,
        service_model,
        region_name,
        is_secure,
        endpoint_url,
        verify,
        credentials,
        scoped_config,
        client_config,
        endpoint_bridge,
        auth_token,
        endpoints_ruleset_data,
        partition_data,
    ):
        args_creator = ClientArgsCreator(
            self._event_emitter,
            self._user_agent,
            self._response_parser_factory,
            self._loader,
            self._exceptions_factory,
            config_store=self._config_store,
            user_agent_creator=self._user_agent_creator,
        )
        return args_creator.get_client_args(
            service_model,
            region_name,
            is_secure,
            endpoint_url,
            verify,
            credentials,
            scoped_config,
            client_config,
            endpoint_bridge,
            auth_token,
            endpoints_ruleset_data,
            partition_data,
        )

    def _create_methods(self, service_model):
        op_dict = {}
        for operation_name in service_model.operation_names:
            py_operation_name = xform_name(operation_name)
            op_dict[py_operation_name] = self._create_api_method(
                py_operation_name, operation_name, service_model
            )
        return op_dict

    def _create_name_mapping(self, service_model):
        # py_name -> OperationName, for every operation available
        # for a service.
        mapping = {}
        for operation_name in service_model.operation_names:
            py_operation_name = xform_name(operation_name)
            mapping[py_operation_name] = operation_name
        return mapping

    def _create_api_method(
        self, py_operation_name, operation_name, service_model
    ):
        def _api_call(self, *args, **kwargs):
            # We're accepting *args so that we can give a more helpful
            # error message than TypeError: _api_call takes exactly
            # 1 argument.
            if args:
                raise TypeError(
                    f"{py_operation_name}() only accepts keyword arguments."
                )
            # The "self" in this scope is referring to the BaseClient.
            return self._make_api_call(operation_name, kwargs)

        _api_call.__name__ = str(py_operation_name)

        # Add the docstring to the client method
        operation_model = service_model.operation_model(operation_name)
        docstring = ClientMethodDocstring(
            operation_model=operation_model,
            method_name=operation_name,
            event_emitter=self._event_emitter,
            method_description=operation_model.documentation,
            example_prefix=f'response = client.{py_operation_name}',
            include_signature=False,
        )
        _api_call.__doc__ = docstring
        return _api_call


class ClientEndpointBridge:
    """Bridges endpoint data and client creation

    This class handles taking out the relevant arguments from the endpoint
    resolver and determining which values to use, taking into account any
    client configuration options and scope configuration options.

    This class also handles determining what, if any, region to use if no
    explicit region setting is provided. For example, Amazon S3 client will
    utilize "us-east-1" by default if no region can be resolved."""

    DEFAULT_ENDPOINT = '{service}.{region}.amazonaws.com'
    _DUALSTACK_CUSTOMIZED_SERVICES = ['s3', 's3-control']

    def __init__(
        self,
        endpoint_resolver,
        scoped_config=None,
        client_config=None,
        default_endpoint=None,
        service_signing_name=None,
        config_store=None,
        service_signature_version=None,
    ):
        self.service_signing_name = service_signing_name
        self.endpoint_resolver = endpoint_resolver
        self.scoped_config = scoped_config
        self.client_config = client_config
        self.default_endpoint = default_endpoint or self.DEFAULT_ENDPOINT
        self.config_store = config_store
        self.service_signature_version = service_signature_version

    def resolve(
        self, service_name, region_name=None, endpoint_url=None, is_secure=True
    ):
        region_name = self._check_default_region(service_name, region_name)
        use_dualstack_endpoint = self._resolve_use_dualstack_endpoint(
            service_name
        )
        use_fips_endpoint = self._resolve_endpoint_variant_config_var(
            'use_fips_endpoint'
        )
        resolved = self.endpoint_resolver.construct_endpoint(
            service_name,
            region_name,
            use_dualstack_endpoint=use_dualstack_endpoint,
            use_fips_endpoint=use_fips_endpoint,
        )

        # If we can't resolve the region, we'll attempt to get a global
        # endpoint for non-regionalized services (iam, route53, etc)
        if not resolved:
            # TODO: fallback partition_name should be configurable in the
            # future for users to define as needed.
            resolved = self.endpoint_resolver.construct_endpoint(
                service_name,
                region_name,
                partition_name='aws',
                use_dualstack_endpoint=use_dualstack_endpoint,
                use_fips_endpoint=use_fips_endpoint,
            )

        if resolved:
            return self._create_endpoint(
                resolved, service_name, region_name, endpoint_url, is_secure
            )
        else:
            return self._assume_endpoint(
                service_name, region_name, endpoint_url, is_secure
            )

    def resolver_uses_builtin_data(self):
        return self.endpoint_resolver.uses_builtin_data

    def _check_default_region(self, service_name, region_name):
        if region_name is not None:
            return region_name
        # Use the client_config region if no explicit region was provided.
        if self.client_config and self.client_config.region_name is not None:
            return self.client_config.region_name

    def _create_endpoint(
        self, resolved, service_name, region_name, endpoint_url, is_secure
    ):
        region_name, signing_region = self._pick_region_values(
            resolved, region_name, endpoint_url
        )
        if endpoint_url is None:
            endpoint_url = self._make_url(
                resolved.get('hostname'),
                is_secure,
                resolved.get('protocols', []),
            )
        signature_version = self._resolve_signature_version(
            service_name, resolved
        )
        signing_name = self._resolve_signing_name(service_name, resolved)
        return self._create_result(
            service_name=service_name,
            region_name=region_name,
            signing_region=signing_region,
            signing_name=signing_name,
            endpoint_url=endpoint_url,
            metadata=resolved,
            signature_version=signature_version,
        )

    def _resolve_endpoint_variant_config_var(self, config_var):
        client_config = self.client_config
        config_val = False

        # Client configuration arg has precedence
        if client_config and getattr(client_config, config_var) is not None:
            return getattr(client_config, config_var)
        elif self.config_store is not None:
            # Check config store
            config_val = self.config_store.get_config_variable(config_var)
        return config_val

    def _resolve_use_dualstack_endpoint(self, service_name):
        s3_dualstack_mode = self._is_s3_dualstack_mode(service_name)
        if s3_dualstack_mode is not None:
            return s3_dualstack_mode
        return self._resolve_endpoint_variant_config_var(
            'use_dualstack_endpoint'
        )

    def _is_s3_dualstack_mode(self, service_name):
        if service_name not in self._DUALSTACK_CUSTOMIZED_SERVICES:
            return None
        # TODO: This normalization logic is duplicated from the
        # ClientArgsCreator class.  Consolidate everything to
        # ClientArgsCreator.  _resolve_signature_version also has similarly
        # duplicated logic.
        client_config = self.client_config
        if (
            client_config is not None
            and client_config.s3 is not None
            and 'use_dualstack_endpoint' in client_config.s3
        ):
            # Client config trumps scoped config.
            return client_config.s3['use_dualstack_endpoint']
        if self.scoped_config is not None:
            enabled = self.scoped_config.get('s3', {}).get(
                'use_dualstack_endpoint'
            )
            if enabled in [True, 'True', 'true']:
                return True

    def _assume_endpoint(
        self, service_name, region_name, endpoint_url, is_secure
    ):
        if endpoint_url is None:
            # Expand the default hostname URI template.
            hostname = self.default_endpoint.format(
                service=service_name, region=region_name
            )
            endpoint_url = self._make_url(
                hostname, is_secure, ['http', 'https']
            )
        logger.debug(
            f'Assuming an endpoint for {service_name}, {region_name}: {endpoint_url}'
        )
        # We still want to allow the user to provide an explicit version.
        signature_version = self._resolve_signature_version(
            service_name, {'signatureVersions': ['v4']}
        )
        signing_name = self._resolve_signing_name(service_name, resolved={})
        return self._create_result(
            service_name=service_name,
            region_name=region_name,
            signing_region=region_name,
            signing_name=signing_name,
            signature_version=signature_version,
            endpoint_url=endpoint_url,
            metadata={},
        )

    def _create_result(
        self,
        service_name,
        region_name,
        signing_region,
        signing_name,
        endpoint_url,
        signature_version,
        metadata,
    ):
        return {
            'service_name': service_name,
            'region_name': region_name,
            'signing_region': signing_region,
            'signing_name': signing_name,
            'endpoint_url': endpoint_url,
            'signature_version': signature_version,
            'metadata': metadata,
        }

    def _make_url(self, hostname, is_secure, supported_protocols):
        if is_secure and 'https' in supported_protocols:
            scheme = 'https'
        else:
            scheme = 'http'
        return f'{scheme}://{hostname}'

    def _resolve_signing_name(self, service_name, resolved):
        # CredentialScope overrides everything else.
        if (
            'credentialScope' in resolved
            and 'service' in resolved['credentialScope']
        ):
            return resolved['credentialScope']['service']
        # Use the signingName from the model if present.
        if self.service_signing_name:
            return self.service_signing_name
        # Just assume is the same as the service name.
        return service_name

    def _pick_region_values(self, resolved, region_name, endpoint_url):
        signing_region = region_name
        if endpoint_url is None:
            # Do not use the region name or signing name from the resolved
            # endpoint if the user explicitly provides an endpoint_url. This
            # would happen if we resolve to an endpoint where the service has
            # a "defaults" section that overrides all endpoint with a single
            # hostname and credentialScope. This has been the case historically
            # for how STS has worked. The only way to resolve an STS endpoint
            # was to provide a region_name and an endpoint_url. In that case,
            # we would still resolve an endpoint, but we would not use the
            # resolved endpointName or signingRegion because we want to allow
            # custom endpoints.
            region_name = resolved['endpointName']
            signing_region = region_name
            if (
                'credentialScope' in resolved
                and 'region' in resolved['credentialScope']
            ):
                signing_region = resolved['credentialScope']['region']
        return region_name, signing_region

    def _resolve_signature_version(self, service_name, resolved):
        configured_version = _get_configured_signature_version(
            service_name, self.client_config, self.scoped_config
        )
        if configured_version is not None:
            return configured_version

        potential_versions = resolved.get('signatureVersions', [])
        if (
            self.service_signature_version is not None
            and self.service_signature_version
            not in _LEGACY_SIGNATURE_VERSIONS
        ):
            # Prefer the service model as most specific
            # source of truth for new signature versions.
            potential_versions = [self.service_signature_version]

        # Pick a signature version from the endpoint metadata if present.
        if 'signatureVersions' in resolved:
            if service_name == 's3':
                return 's3v4'
            if 'v4' in potential_versions:
                return 'v4'
            # Now just iterate over the signature versions in order until we
            # find the first one that is known to Botocore.
            for known in potential_versions:
                if known in AUTH_TYPE_MAPS:
                    return known
        raise UnknownSignatureVersionError(
            signature_version=potential_versions
        )


class BaseClient:
    # This is actually reassigned with the py->op_name mapping
    # when the client creator creates the subclass.  This value is used
    # because calls such as client.get_paginator('list_objects') use the
    # snake_case name, but we need to know the ListObjects form.
    # xform_name() does the ListObjects->list_objects conversion, but
    # we need the reverse mapping here.
    _PY_TO_OP_NAME = {}

    def __init__(
        self,
        serializer,
        endpoint,
        response_parser,
        event_emitter,
        request_signer,
        service_model,
        loader,
        client_config,
        partition,
        exceptions_factory,
        endpoint_ruleset_resolver=None,
        user_agent_creator=None,
    ):
        self._serializer = serializer
        self._endpoint = endpoint
        self._ruleset_resolver = endpoint_ruleset_resolver
        self._response_parser = response_parser
        self._request_signer = request_signer
        self._cache = {}
        self._loader = loader
        self._client_config = client_config
        self.meta = ClientMeta(
            event_emitter,
            self._client_config,
            endpoint.host,
            service_model,
            self._PY_TO_OP_NAME,
            partition,
        )
        self._exceptions_factory = exceptions_factory
        self._exceptions = None
        self._user_agent_creator = user_agent_creator
        if self._user_agent_creator is None:
            self._user_agent_creator = (
                UserAgentString.from_environment().with_client_config(
                    self._client_config
                )
            )
        self._register_handlers()

    def __getattr__(self, item):
        service_id = self._service_model.service_id.hyphenize()
        event_name = f'getattr.{service_id}.{item}'

        handler, event_response = self.meta.events.emit_until_response(
            event_name, client=self
        )

        if event_response is not None:
            return event_response

        raise AttributeError(
            f"'{self.__class__.__name__}' object has no attribute '{item}'"
        )

    def close(self):
        """Closes underlying endpoint connections."""
        self._endpoint.close()

    def _register_handlers(self):
        # Register the handler required to sign requests.
        service_id = self.meta.service_model.service_id.hyphenize()
        self.meta.events.register(
            f"request-created.{service_id}", self._request_signer.handler
        )

    @property
    def _service_model(self):
        return self.meta.service_model

    def _make_api_call(self, operation_name, api_params):
        operation_model = self._service_model.operation_model(operation_name)
        service_name = self._service_model.service_name
        history_recorder.record(
            'API_CALL',
            {
                'service': service_name,
                'operation': operation_name,
                'params': api_params,
            },
        )
        if operation_model.deprecated:
            logger.debug(
                'Warning: %s.%s() is deprecated', service_name, operation_name
            )
        request_context = {
            'client_region': self.meta.region_name,
            'client_config': self.meta.config,
            'has_streaming_input': operation_model.has_streaming_input,
            'auth_type': operation_model.auth_type,
        }
        api_params = self._emit_api_params(
            api_params=api_params,
            operation_model=operation_model,
            context=request_context,
        )
        (
            endpoint_url,
            additional_headers,
            properties,
        ) = self._resolve_endpoint_ruleset(
            operation_model, api_params, request_context
        )
        if properties:
            # Pass arbitrary endpoint info with the Request
            # for use during construction.
            request_context['endpoint_properties'] = properties
        request_dict = self._convert_to_request_dict(
            api_params=api_params,
            operation_model=operation_model,
            endpoint_url=endpoint_url,
            context=request_context,
            headers=additional_headers,
        )
        resolve_checksum_context(request_dict, operation_model, api_params)

        service_id = self._service_model.service_id.hyphenize()
        handler, event_response = self.meta.events.emit_until_response(
            f'before-call.{service_id}.{operation_name}',
            model=operation_model,
            params=request_dict,
            request_signer=self._request_signer,
            context=request_context,
        )

        if event_response is not None:
            http, parsed_response = event_response
        else:
            maybe_compress_request(
                self.meta.config, request_dict, operation_model
            )
            apply_request_checksum(request_dict)
            http, parsed_response = self._make_request(
                operation_model, request_dict, request_context
            )

        self.meta.events.emit(
            f'after-call.{service_id}.{operation_name}',
            http_response=http,
            parsed=parsed_response,
            model=operation_model,
            context=request_context,
        )

        if http.status_code >= 300:
            error_info = parsed_response.get("Error", {})
            error_code = error_info.get("QueryErrorCode") or error_info.get(
                "Code"
            )
            error_class = self.exceptions.from_code(error_code)
            raise error_class(parsed_response, operation_name)
        else:
            return parsed_response

    def _make_request(self, operation_model, request_dict, request_context):
        try:
            return self._endpoint.make_request(operation_model, request_dict)
        except Exception as e:
            self.meta.events.emit(
                f'after-call-error.{self._service_model.service_id.hyphenize()}.{operation_model.name}',
                exception=e,
                context=request_context,
            )
            raise

    def _convert_to_request_dict(
        self,
        api_params,
        operation_model,
        endpoint_url,
        context=None,
        headers=None,
        set_user_agent_header=True,
    ):
        request_dict = self._serializer.serialize_to_request(
            api_params, operation_model
        )
        if not self._client_config.inject_host_prefix:
            request_dict.pop('host_prefix', None)
        if headers is not None:
            request_dict['headers'].update(headers)
        if set_user_agent_header:
            user_agent = self._user_agent_creator.to_string()
        else:
            user_agent = None
        prepare_request_dict(
            request_dict,
            endpoint_url=endpoint_url,
            user_agent=user_agent,
            context=context,
        )
        return request_dict

    def _emit_api_params(self, api_params, operation_model, context):
        # Given the API params provided by the user and the operation_model
        # we can serialize the request to a request_dict.
        operation_name = operation_model.name

        # Emit an event that allows users to modify the parameters at the
        # beginning of the method. It allows handlers to modify existing
        # parameters or return a new set of parameters to use.
        service_id = self._service_model.service_id.hyphenize()
        responses = self.meta.events.emit(
            f'provide-client-params.{service_id}.{operation_name}',
            params=api_params,
            model=operation_model,
            context=context,
        )
        api_params = first_non_none_response(responses, default=api_params)

        self.meta.events.emit(
            f'before-parameter-build.{service_id}.{operation_name}',
            params=api_params,
            model=operation_model,
            context=context,
        )
        return api_params

    def _resolve_endpoint_ruleset(
        self,
        operation_model,
        params,
        request_context,
        ignore_signing_region=False,
    ):
        """Returns endpoint URL and list of additional headers returned from
        EndpointRulesetResolver for the given operation and params. If the
        ruleset resolver is not available, for example because the service has
        no endpoints ruleset file, the legacy endpoint resolver's value is
        returned.

        Use ignore_signing_region for generating presigned URLs or any other
        situation where the signing region information from the ruleset
        resolver should be ignored.

        Returns tuple of URL and headers dictionary. Additionally, the
        request_context dict is modified in place with any signing information
        returned from the ruleset resolver.
        """
        if self._ruleset_resolver is None:
            endpoint_url = self.meta.endpoint_url
            additional_headers = {}
            endpoint_properties = {}
        else:
            endpoint_info = self._ruleset_resolver.construct_endpoint(
                operation_model=operation_model,
                call_args=params,
                request_context=request_context,
            )
            endpoint_url = endpoint_info.url
            additional_headers = endpoint_info.headers
            endpoint_properties = endpoint_info.properties
            # If authSchemes is present, overwrite default auth type and
            # signing context derived from service model.
            auth_schemes = endpoint_info.properties.get('authSchemes')
            if auth_schemes is not None:
                auth_info = self._ruleset_resolver.auth_schemes_to_signing_ctx(
                    auth_schemes
                )
                auth_type, signing_context = auth_info
                request_context['auth_type'] = auth_type
                if 'region' in signing_context and ignore_signing_region:
                    del signing_context['region']
                if 'signing' in request_context:
                    request_context['signing'].update(signing_context)
                else:
                    request_context['signing'] = signing_context

        return endpoint_url, additional_headers, endpoint_properties

    def get_paginator(self, operation_name):
        """Create a paginator for an operation.

        :type operation_name: string
        :param operation_name: The operation name.  This is the same name
            as the method name on the client.  For example, if the
            method name is ``create_foo``, and you'd normally invoke the
            operation as ``client.create_foo(**kwargs)``, if the
            ``create_foo`` operation can be paginated, you can use the
            call ``client.get_paginator("create_foo")``.

        :raise OperationNotPageableError: Raised if the operation is not
            pageable.  You can use the ``client.can_paginate`` method to
            check if an operation is pageable.

        :rtype: ``botocore.paginate.Paginator``
        :return: A paginator object.

        """
        if not self.can_paginate(operation_name):
            raise OperationNotPageableError(operation_name=operation_name)
        else:
            actual_operation_name = self._PY_TO_OP_NAME[operation_name]

            # Create a new paginate method that will serve as a proxy to
            # the underlying Paginator.paginate method. This is needed to
            # attach a docstring to the method.
            def paginate(self, **kwargs):
                return Paginator.paginate(self, **kwargs)

            paginator_config = self._cache['page_config'][
                actual_operation_name
            ]
            # Add the docstring for the paginate method.
            paginate.__doc__ = PaginatorDocstring(
                paginator_name=actual_operation_name,
                event_emitter=self.meta.events,
                service_model=self.meta.service_model,
                paginator_config=paginator_config,
                include_signature=False,
            )

            # Rename the paginator class based on the type of paginator.
            service_module_name = get_service_module_name(
                self.meta.service_model
            )
            paginator_class_name = (
                f"{service_module_name}.Paginator.{actual_operation_name}"
            )

            # Create the new paginator class
            documented_paginator_cls = type(
                paginator_class_name, (Paginator,), {'paginate': paginate}
            )

            operation_model = self._service_model.operation_model(
                actual_operation_name
            )
            paginator = documented_paginator_cls(
                getattr(self, operation_name),
                paginator_config,
                operation_model,
            )
            return paginator

    def can_paginate(self, operation_name):
        """Check if an operation can be paginated.

        :type operation_name: string
        :param operation_name: The operation name.  This is the same name
            as the method name on the client.  For example, if the
            method name is ``create_foo``, and you'd normally invoke the
            operation as ``client.create_foo(**kwargs)``, if the
            ``create_foo`` operation can be paginated, you can use the
            call ``client.get_paginator("create_foo")``.

        :return: ``True`` if the operation can be paginated,
            ``False`` otherwise.

        """
        if 'page_config' not in self._cache:
            try:
                page_config = self._loader.load_service_model(
                    self._service_model.service_name,
                    'paginators-1',
                    self._service_model.api_version,
                )['pagination']
                self._cache['page_config'] = page_config
            except DataNotFoundError:
                self._cache['page_config'] = {}
        actual_operation_name = self._PY_TO_OP_NAME[operation_name]
        return actual_operation_name in self._cache['page_config']

    def _get_waiter_config(self):
        if 'waiter_config' not in self._cache:
            try:
                waiter_config = self._loader.load_service_model(
                    self._service_model.service_name,
                    'waiters-2',
                    self._service_model.api_version,
                )
                self._cache['waiter_config'] = waiter_config
            except DataNotFoundError:
                self._cache['waiter_config'] = {}
        return self._cache['waiter_config']

    def get_waiter(self, waiter_name):
        """Returns an object that can wait for some condition.

        :type waiter_name: str
        :param waiter_name: The name of the waiter to get. See the waiters
            section of the service docs for a list of available waiters.

        :returns: The specified waiter object.
        :rtype: ``botocore.waiter.Waiter``
        """
        config = self._get_waiter_config()
        if not config:
            raise ValueError(f"Waiter does not exist: {waiter_name}")
        model = waiter.WaiterModel(config)
        mapping = {}
        for name in model.waiter_names:
            mapping[xform_name(name)] = name
        if waiter_name not in mapping:
            raise ValueError(f"Waiter does not exist: {waiter_name}")

        return waiter.create_waiter_with_client(
            mapping[waiter_name], model, self
        )

    @CachedProperty
    def waiter_names(self):
        """Returns a list of all available waiters."""
        config = self._get_waiter_config()
        if not config:
            return []
        model = waiter.WaiterModel(config)
        # Waiter configs is a dict, we just want the waiter names
        # which are the keys in the dict.
        return [xform_name(name) for name in model.waiter_names]

    @property
    def exceptions(self):
        if self._exceptions is None:
            self._exceptions = self._load_exceptions()
        return self._exceptions

    def _load_exceptions(self):
        return self._exceptions_factory.create_client_exceptions(
            self._service_model
        )

    def _get_credentials(self):
        """
        This private interface is subject to abrupt breaking changes, including
        removal, in any botocore release.
        """
        return self._request_signer._credentials


class ClientMeta:
    """Holds additional client methods.

    This class holds additional information for clients.  It exists for
    two reasons:

        * To give advanced functionality to clients
        * To namespace additional client attributes from the operation
          names which are mapped to methods at runtime.  This avoids
          ever running into collisions with operation names.

    """

    def __init__(
        self,
        events,
        client_config,
        endpoint_url,
        service_model,
        method_to_api_mapping,
        partition,
    ):
        self.events = events
        self._client_config = client_config
        self._endpoint_url = endpoint_url
        self._service_model = service_model
        self._method_to_api_mapping = method_to_api_mapping
        self._partition = partition

    @property
    def service_model(self):
        return self._service_model

    @property
    def region_name(self):
        return self._client_config.region_name

    @property
    def endpoint_url(self):
        return self._endpoint_url

    @property
    def config(self):
        return self._client_config

    @property
    def method_to_api_mapping(self):
        return self._method_to_api_mapping

    @property
    def partition(self):
        return self._partition


def _get_configured_signature_version(
    service_name, client_config, scoped_config
):
    """
    Gets the manually configured signature version.

    :returns: the customer configured signature version, or None if no
        signature version was configured.
    """
    # Client config overrides everything.
    if client_config and client_config.signature_version is not None:
        return client_config.signature_version

    # Scoped config overrides picking from the endpoint metadata.
    if scoped_config is not None:
        # A given service may have service specific configuration in the
        # config file, so we need to check there as well.
        service_config = scoped_config.get(service_name)
        if service_config is not None and isinstance(service_config, dict):
            version = service_config.get('signature_version')
            if version:
                logger.debug(
                    "Switching signature version for service %s "
                    "to version %s based on config file override.",
                    service_name,
                    version,
                )
                return version
    return None
