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
import base64
import binascii
import datetime
import email.message
import functools
import hashlib
import io
import logging
import os
import random
import re
import socket
import time
import warnings
import weakref
from datetime import datetime as _DatetimeClass
from ipaddress import ip_address
from pathlib import Path
from urllib.request import getproxies, proxy_bypass

import dateutil.parser
from dateutil.tz import tzutc
from urllib3.exceptions import LocationParseError

import botocore
import botocore.awsrequest
import botocore.httpsession

# IP Regexes retained for backwards compatibility
from botocore.compat import HEX_PAT  # noqa: F401
from botocore.compat import IPV4_PAT  # noqa: F401
from botocore.compat import IPV6_ADDRZ_PAT  # noqa: F401
from botocore.compat import IPV6_PAT  # noqa: F401
from botocore.compat import LS32_PAT  # noqa: F401
from botocore.compat import UNRESERVED_PAT  # noqa: F401
from botocore.compat import ZONE_ID_PAT  # noqa: F401
from botocore.compat import (
    HAS_CRT,
    IPV4_RE,
    IPV6_ADDRZ_RE,
    MD5_AVAILABLE,
    UNSAFE_URL_CHARS,
    OrderedDict,
    get_md5,
    get_tzinfo_options,
    json,
    quote,
    urlparse,
    urlsplit,
    urlunsplit,
    zip_longest,
)
from botocore.exceptions import (
    ClientError,
    ConfigNotFound,
    ConnectionClosedError,
    ConnectTimeoutError,
    EndpointConnectionError,
    HTTPClientError,
    InvalidDNSNameError,
    InvalidEndpointConfigurationError,
    InvalidExpressionError,
    InvalidHostLabelError,
    InvalidIMDSEndpointError,
    InvalidIMDSEndpointModeError,
    InvalidRegionError,
    MetadataRetrievalError,
    MissingDependencyException,
    ReadTimeoutError,
    SSOTokenLoadError,
    UnsupportedOutpostResourceError,
    UnsupportedS3AccesspointConfigurationError,
    UnsupportedS3ArnError,
    UnsupportedS3ConfigurationError,
    UnsupportedS3ControlArnError,
    UnsupportedS3ControlConfigurationError,
)

logger = logging.getLogger(__name__)
DEFAULT_METADATA_SERVICE_TIMEOUT = 1
METADATA_BASE_URL = 'http://169.254.169.254/'
METADATA_BASE_URL_IPv6 = 'http://[fd00:ec2::254]/'
METADATA_ENDPOINT_MODES = ('ipv4', 'ipv6')

# These are chars that do not need to be urlencoded.
# Based on rfc2986, section 2.3
SAFE_CHARS = '-._~'
LABEL_RE = re.compile(r'[a-z0-9][a-z0-9\-]*[a-z0-9]')
RETRYABLE_HTTP_ERRORS = (
    ReadTimeoutError,
    EndpointConnectionError,
    ConnectionClosedError,
    ConnectTimeoutError,
)
S3_ACCELERATE_WHITELIST = ['dualstack']
# In switching events from using service name / endpoint prefix to service
# id, we have to preserve compatibility. This maps the instances where either
# is different than the transformed service id.
EVENT_ALIASES = {
    "api.mediatailor": "mediatailor",
    "api.pricing": "pricing",
    "api.sagemaker": "sagemaker",
    "apigateway": "api-gateway",
    "application-autoscaling": "application-auto-scaling",
    "appstream2": "appstream",
    "autoscaling": "auto-scaling",
    "autoscaling-plans": "auto-scaling-plans",
    "ce": "cost-explorer",
    "cloudhsmv2": "cloudhsm-v2",
    "cloudsearchdomain": "cloudsearch-domain",
    "cognito-idp": "cognito-identity-provider",
    "config": "config-service",
    "cur": "cost-and-usage-report-service",
    "data.iot": "iot-data-plane",
    "data.jobs.iot": "iot-jobs-data-plane",
    "data.mediastore": "mediastore-data",
    "datapipeline": "data-pipeline",
    "devicefarm": "device-farm",
    "devices.iot1click": "iot-1click-devices-service",
    "directconnect": "direct-connect",
    "discovery": "application-discovery-service",
    "dms": "database-migration-service",
    "ds": "directory-service",
    "dynamodbstreams": "dynamodb-streams",
    "elasticbeanstalk": "elastic-beanstalk",
    "elasticfilesystem": "efs",
    "elasticloadbalancing": "elastic-load-balancing",
    "elasticmapreduce": "emr",
    "elastictranscoder": "elastic-transcoder",
    "elb": "elastic-load-balancing",
    "elbv2": "elastic-load-balancing-v2",
    "email": "ses",
    "entitlement.marketplace": "marketplace-entitlement-service",
    "es": "elasticsearch-service",
    "events": "eventbridge",
    "cloudwatch-events": "eventbridge",
    "iot-data": "iot-data-plane",
    "iot-jobs-data": "iot-jobs-data-plane",
    "iot1click-devices": "iot-1click-devices-service",
    "iot1click-projects": "iot-1click-projects",
    "kinesisanalytics": "kinesis-analytics",
    "kinesisvideo": "kinesis-video",
    "lex-models": "lex-model-building-service",
    "lex-runtime": "lex-runtime-service",
    "logs": "cloudwatch-logs",
    "machinelearning": "machine-learning",
    "marketplace-entitlement": "marketplace-entitlement-service",
    "marketplacecommerceanalytics": "marketplace-commerce-analytics",
    "metering.marketplace": "marketplace-metering",
    "meteringmarketplace": "marketplace-metering",
    "mgh": "migration-hub",
    "models.lex": "lex-model-building-service",
    "monitoring": "cloudwatch",
    "mturk-requester": "mturk",
    "opsworks-cm": "opsworkscm",
    "projects.iot1click": "iot-1click-projects",
    "resourcegroupstaggingapi": "resource-groups-tagging-api",
    "route53": "route-53",
    "route53domains": "route-53-domains",
    "runtime.lex": "lex-runtime-service",
    "runtime.sagemaker": "sagemaker-runtime",
    "sdb": "simpledb",
    "secretsmanager": "secrets-manager",
    "serverlessrepo": "serverlessapplicationrepository",
    "servicecatalog": "service-catalog",
    "states": "sfn",
    "stepfunctions": "sfn",
    "storagegateway": "storage-gateway",
    "streams.dynamodb": "dynamodb-streams",
    "tagging": "resource-groups-tagging-api",
}


# This pattern can be used to detect if a header is a flexible checksum header
CHECKSUM_HEADER_PATTERN = re.compile(
    r'^X-Amz-Checksum-([a-z0-9]*)$',
    flags=re.IGNORECASE,
)


def ensure_boolean(val):
    """Ensures a boolean value if a string or boolean is provided

    For strings, the value for True/False is case insensitive
    """
    if isinstance(val, bool):
        return val
    elif isinstance(val, str):
        return val.lower() == 'true'
    else:
        return False


def resolve_imds_endpoint_mode(session):
    """Resolving IMDS endpoint mode to either IPv6 or IPv4.

    ec2_metadata_service_endpoint_mode takes precedence over imds_use_ipv6.
    """
    endpoint_mode = session.get_config_variable(
        'ec2_metadata_service_endpoint_mode'
    )
    if endpoint_mode is not None:
        lendpoint_mode = endpoint_mode.lower()
        if lendpoint_mode not in METADATA_ENDPOINT_MODES:
            error_msg_kwargs = {
                'mode': endpoint_mode,
                'valid_modes': METADATA_ENDPOINT_MODES,
            }
            raise InvalidIMDSEndpointModeError(**error_msg_kwargs)
        return lendpoint_mode
    elif session.get_config_variable('imds_use_ipv6'):
        return 'ipv6'
    return 'ipv4'


def is_json_value_header(shape):
    """Determines if the provided shape is the special header type jsonvalue.

    :type shape: botocore.shape
    :param shape: Shape to be inspected for the jsonvalue trait.

    :return: True if this type is a jsonvalue, False otherwise
    :rtype: Bool
    """
    return (
        hasattr(shape, 'serialization')
        and shape.serialization.get('jsonvalue', False)
        and shape.serialization.get('location') == 'header'
        and shape.type_name == 'string'
    )


def has_header(header_name, headers):
    """Case-insensitive check for header key."""
    if header_name is None:
        return False
    elif isinstance(headers, botocore.awsrequest.HeadersDict):
        return header_name in headers
    else:
        return header_name.lower() in [key.lower() for key in headers.keys()]


def get_service_module_name(service_model):
    """Returns the module name for a service

    This is the value used in both the documentation and client class name
    """
    name = service_model.metadata.get(
        'serviceAbbreviation',
        service_model.metadata.get(
            'serviceFullName', service_model.service_name
        ),
    )
    name = name.replace('Amazon', '')
    name = name.replace('AWS', '')
    name = re.sub(r'\W+', '', name)
    return name


def normalize_url_path(path):
    if not path:
        return '/'
    return remove_dot_segments(path)


def normalize_boolean(val):
    """Returns None if val is None, otherwise ensure value
    converted to boolean"""
    if val is None:
        return val
    else:
        return ensure_boolean(val)


def remove_dot_segments(url):
    # RFC 3986, section 5.2.4 "Remove Dot Segments"
    # Also, AWS services require consecutive slashes to be removed,
    # so that's done here as well
    if not url:
        return ''
    input_url = url.split('/')
    output_list = []
    for x in input_url:
        if x and x != '.':
            if x == '..':
                if output_list:
                    output_list.pop()
            else:
                output_list.append(x)

    if url[0] == '/':
        first = '/'
    else:
        first = ''
    if url[-1] == '/' and output_list:
        last = '/'
    else:
        last = ''
    return first + '/'.join(output_list) + last


def validate_jmespath_for_set(expression):
    # Validates a limited jmespath expression to determine if we can set a
    # value based on it. Only works with dotted paths.
    if not expression or expression == '.':
        raise InvalidExpressionError(expression=expression)

    for invalid in ['[', ']', '*']:
        if invalid in expression:
            raise InvalidExpressionError(expression=expression)


def set_value_from_jmespath(source, expression, value, is_first=True):
    # This takes a (limited) jmespath-like expression & can set a value based
    # on it.
    # Limitations:
    # * Only handles dotted lookups
    # * No offsets/wildcards/slices/etc.
    if is_first:
        validate_jmespath_for_set(expression)

    bits = expression.split('.', 1)
    current_key, remainder = bits[0], bits[1] if len(bits) > 1 else ''

    if not current_key:
        raise InvalidExpressionError(expression=expression)

    if remainder:
        if current_key not in source:
            # We've got something in the expression that's not present in the
            # source (new key). If there's any more bits, we'll set the key
            # with an empty dictionary.
            source[current_key] = {}

        return set_value_from_jmespath(
            source[current_key], remainder, value, is_first=False
        )

    # If we're down to a single key, set it.
    source[current_key] = value


def is_global_accesspoint(context):
    """Determine if request is intended for an MRAP accesspoint."""
    s3_accesspoint = context.get('s3_accesspoint', {})
    is_global = s3_accesspoint.get('region') == ''
    return is_global


class _RetriesExceededError(Exception):
    """Internal exception used when the number of retries are exceeded."""

    pass


class BadIMDSRequestError(Exception):
    def __init__(self, request):
        self.request = request


class IMDSFetcher:
    _RETRIES_EXCEEDED_ERROR_CLS = _RetriesExceededError
    _TOKEN_PATH = 'latest/api/token'
    _TOKEN_TTL = '21600'

    def __init__(
        self,
        timeout=DEFAULT_METADATA_SERVICE_TIMEOUT,
        num_attempts=1,
        base_url=METADATA_BASE_URL,
        env=None,
        user_agent=None,
        config=None,
    ):
        self._timeout = timeout
        self._num_attempts = num_attempts
        if config is None:
            config = {}
        self._base_url = self._select_base_url(base_url, config)
        self._config = config

        if env is None:
            env = os.environ.copy()
        self._disabled = (
            env.get('AWS_EC2_METADATA_DISABLED', 'false').lower() == 'true'
        )
        self._imds_v1_disabled = config.get('ec2_metadata_v1_disabled')
        self._user_agent = user_agent
        self._session = botocore.httpsession.URLLib3Session(
            timeout=self._timeout,
            proxies=get_environ_proxies(self._base_url),
        )

    def get_base_url(self):
        return self._base_url

    def _select_base_url(self, base_url, config):
        if config is None:
            config = {}

        requires_ipv6 = (
            config.get('ec2_metadata_service_endpoint_mode') == 'ipv6'
        )
        custom_metadata_endpoint = config.get('ec2_metadata_service_endpoint')

        if requires_ipv6 and custom_metadata_endpoint:
            logger.warning(
                "Custom endpoint and IMDS_USE_IPV6 are both set. Using custom endpoint."
            )

        chosen_base_url = None

        if base_url != METADATA_BASE_URL:
            chosen_base_url = base_url
        elif custom_metadata_endpoint:
            chosen_base_url = custom_metadata_endpoint
        elif requires_ipv6:
            chosen_base_url = METADATA_BASE_URL_IPv6
        else:
            chosen_base_url = METADATA_BASE_URL

        logger.debug(f"IMDS ENDPOINT: {chosen_base_url}")
        if not is_valid_uri(chosen_base_url):
            raise InvalidIMDSEndpointError(endpoint=chosen_base_url)

        return chosen_base_url

    def _construct_url(self, path):
        sep = ''
        if self._base_url and not self._base_url.endswith('/'):
            sep = '/'
        return f'{self._base_url}{sep}{path}'

    def _fetch_metadata_token(self):
        self._assert_enabled()
        url = self._construct_url(self._TOKEN_PATH)
        headers = {
            'x-aws-ec2-metadata-token-ttl-seconds': self._TOKEN_TTL,
        }
        self._add_user_agent(headers)
        request = botocore.awsrequest.AWSRequest(
            method='PUT', url=url, headers=headers
        )
        for i in range(self._num_attempts):
            try:
                response = self._session.send(request.prepare())
                if response.status_code == 200:
                    return response.text
                elif response.status_code in (404, 403, 405):
                    return None
                elif response.status_code in (400,):
                    raise BadIMDSRequestError(request)
            except ReadTimeoutError:
                return None
            except RETRYABLE_HTTP_ERRORS as e:
                logger.debug(
                    "Caught retryable HTTP exception while making metadata "
                    "service request to %s: %s",
                    url,
                    e,
                    exc_info=True,
                )
            except HTTPClientError as e:
                if isinstance(e.kwargs.get('error'), LocationParseError):
                    raise InvalidIMDSEndpointError(endpoint=url, error=e)
                else:
                    raise
        return None

    def _get_request(self, url_path, retry_func, token=None):
        """Make a get request to the Instance Metadata Service.

        :type url_path: str
        :param url_path: The path component of the URL to make a get request.
            This arg is appended to the base_url that was provided in the
            initializer.

        :type retry_func: callable
        :param retry_func: A function that takes the response as an argument
             and determines if it needs to retry. By default empty and non
             200 OK responses are retried.

        :type token: str
        :param token: Metadata token to send along with GET requests to IMDS.
        """
        self._assert_enabled()
        if not token:
            self._assert_v1_enabled()
        if retry_func is None:
            retry_func = self._default_retry
        url = self._construct_url(url_path)
        headers = {}
        if token is not None:
            headers['x-aws-ec2-metadata-token'] = token
        self._add_user_agent(headers)
        for i in range(self._num_attempts):
            try:
                request = botocore.awsrequest.AWSRequest(
                    method='GET', url=url, headers=headers
                )
                response = self._session.send(request.prepare())
                if not retry_func(response):
                    return response
            except RETRYABLE_HTTP_ERRORS as e:
                logger.debug(
                    "Caught retryable HTTP exception while making metadata "
                    "service request to %s: %s",
                    url,
                    e,
                    exc_info=True,
                )
        raise self._RETRIES_EXCEEDED_ERROR_CLS()

    def _add_user_agent(self, headers):
        if self._user_agent is not None:
            headers['User-Agent'] = self._user_agent

    def _assert_enabled(self):
        if self._disabled:
            logger.debug("Access to EC2 metadata has been disabled.")
            raise self._RETRIES_EXCEEDED_ERROR_CLS()

    def _assert_v1_enabled(self):
        if self._imds_v1_disabled:
            raise MetadataRetrievalError(
                error_msg="Unable to retrieve token for use in IMDSv2 call and IMDSv1 has been disabled"
            )

    def _default_retry(self, response):
        return self._is_non_ok_response(response) or self._is_empty(response)

    def _is_non_ok_response(self, response):
        if response.status_code != 200:
            self._log_imds_response(response, 'non-200', log_body=True)
            return True
        return False

    def _is_empty(self, response):
        if not response.content:
            self._log_imds_response(response, 'no body', log_body=True)
            return True
        return False

    def _log_imds_response(self, response, reason_to_log, log_body=False):
        statement = (
            "Metadata service returned %s response "
            "with status code of %s for url: %s"
        )
        logger_args = [reason_to_log, response.status_code, response.url]
        if log_body:
            statement += ", content body: %s"
            logger_args.append(response.content)
        logger.debug(statement, *logger_args)


class InstanceMetadataFetcher(IMDSFetcher):
    _URL_PATH = 'latest/meta-data/iam/security-credentials/'
    _REQUIRED_CREDENTIAL_FIELDS = [
        'AccessKeyId',
        'SecretAccessKey',
        'Token',
        'Expiration',
    ]

    def retrieve_iam_role_credentials(self):
        try:
            token = self._fetch_metadata_token()
            role_name = self._get_iam_role(token)
            credentials = self._get_credentials(role_name, token)
            if self._contains_all_credential_fields(credentials):
                credentials = {
                    'role_name': role_name,
                    'access_key': credentials['AccessKeyId'],
                    'secret_key': credentials['SecretAccessKey'],
                    'token': credentials['Token'],
                    'expiry_time': credentials['Expiration'],
                }
                self._evaluate_expiration(credentials)
                return credentials
            else:
                # IMDS can return a 200 response that has a JSON formatted
                # error message (i.e. if ec2 is not trusted entity for the
                # attached role). We do not necessarily want to retry for
                # these and we also do not necessarily want to raise a key
                # error. So at least log the problematic response and return
                # an empty dictionary to signal that it was not able to
                # retrieve credentials. These error will contain both a
                # Code and Message key.
                if 'Code' in credentials and 'Message' in credentials:
                    logger.debug(
                        'Error response received when retrieving'
                        'credentials: %s.',
                        credentials,
                    )
                return {}
        except self._RETRIES_EXCEEDED_ERROR_CLS:
            logger.debug(
                "Max number of attempts exceeded (%s) when "
                "attempting to retrieve data from metadata service.",
                self._num_attempts,
            )
        except BadIMDSRequestError as e:
            logger.debug("Bad IMDS request: %s", e.request)
        return {}

    def _get_iam_role(self, token=None):
        return self._get_request(
            url_path=self._URL_PATH,
            retry_func=self._needs_retry_for_role_name,
            token=token,
        ).text

    def _get_credentials(self, role_name, token=None):
        r = self._get_request(
            url_path=self._URL_PATH + role_name,
            retry_func=self._needs_retry_for_credentials,
            token=token,
        )
        return json.loads(r.text)

    def _is_invalid_json(self, response):
        try:
            json.loads(response.text)
            return False
        except ValueError:
            self._log_imds_response(response, 'invalid json')
            return True

    def _needs_retry_for_role_name(self, response):
        return self._is_non_ok_response(response) or self._is_empty(response)

    def _needs_retry_for_credentials(self, response):
        return (
            self._is_non_ok_response(response)
            or self._is_empty(response)
            or self._is_invalid_json(response)
        )

    def _contains_all_credential_fields(self, credentials):
        for field in self._REQUIRED_CREDENTIAL_FIELDS:
            if field not in credentials:
                logger.debug(
                    'Retrieved credentials is missing required field: %s',
                    field,
                )
                return False
        return True

    def _evaluate_expiration(self, credentials):
        expiration = credentials.get("expiry_time")
        if expiration is None:
            return
        try:
            expiration = datetime.datetime.strptime(
                expiration, "%Y-%m-%dT%H:%M:%SZ"
            )
            refresh_interval = self._config.get(
                "ec2_credential_refresh_window", 60 * 10
            )
            jitter = random.randint(120, 600)  # Between 2 to 10 minutes
            refresh_interval_with_jitter = refresh_interval + jitter
            current_time = datetime.datetime.utcnow()
            refresh_offset = datetime.timedelta(
                seconds=refresh_interval_with_jitter
            )
            extension_time = expiration - refresh_offset
            if current_time >= extension_time:
                new_time = current_time + refresh_offset
                credentials["expiry_time"] = new_time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
                logger.info(
                    f"Attempting credential expiration extension due to a "
                    f"credential service availability issue. A refresh of "
                    f"these credentials will be attempted again within "
                    f"the next {refresh_interval_with_jitter/60:.0f} minutes."
                )
        except ValueError:
            logger.debug(
                f"Unable to parse expiry_time in {credentials['expiry_time']}"
            )


class IMDSRegionProvider:
    def __init__(self, session, environ=None, fetcher=None):
        """Initialize IMDSRegionProvider.
        :type session: :class:`botocore.session.Session`
        :param session: The session is needed to look up configuration for
            how to contact the instance metadata service. Specifically the
            whether or not it should use the IMDS region at all, and if so how
            to configure the timeout and number of attempts to reach the
            service.
        :type environ: None or dict
        :param environ: A dictionary of environment variables to use. If
            ``None`` is the argument then ``os.environ`` will be used by
            default.
        :type fecther: :class:`botocore.utils.InstanceMetadataRegionFetcher`
        :param fetcher: The class to actually handle the fetching of the region
            from the IMDS. If not provided a default one will be created.
        """
        self._session = session
        if environ is None:
            environ = os.environ
        self._environ = environ
        self._fetcher = fetcher

    def provide(self):
        """Provide the region value from IMDS."""
        instance_region = self._get_instance_metadata_region()
        return instance_region

    def _get_instance_metadata_region(self):
        fetcher = self._get_fetcher()
        region = fetcher.retrieve_region()
        return region

    def _get_fetcher(self):
        if self._fetcher is None:
            self._fetcher = self._create_fetcher()
        return self._fetcher

    def _create_fetcher(self):
        metadata_timeout = self._session.get_config_variable(
            'metadata_service_timeout'
        )
        metadata_num_attempts = self._session.get_config_variable(
            'metadata_service_num_attempts'
        )
        imds_config = {
            'ec2_metadata_service_endpoint': self._session.get_config_variable(
                'ec2_metadata_service_endpoint'
            ),
            'ec2_metadata_service_endpoint_mode': resolve_imds_endpoint_mode(
                self._session
            ),
            'ec2_metadata_v1_disabled': self._session.get_config_variable(
                'ec2_metadata_v1_disabled'
            ),
        }
        fetcher = InstanceMetadataRegionFetcher(
            timeout=metadata_timeout,
            num_attempts=metadata_num_attempts,
            env=self._environ,
            user_agent=self._session.user_agent(),
            config=imds_config,
        )
        return fetcher


class InstanceMetadataRegionFetcher(IMDSFetcher):
    _URL_PATH = 'latest/meta-data/placement/availability-zone/'

    def retrieve_region(self):
        """Get the current region from the instance metadata service.
        :rvalue: str
        :returns: The region the current instance is running in or None
            if the instance metadata service cannot be contacted or does not
            give a valid response.
        :rtype: None or str
        :returns: Returns the region as a string if it is configured to use
            IMDS as a region source. Otherwise returns ``None``. It will also
            return ``None`` if it fails to get the region from IMDS due to
            exhausting its retries or not being able to connect.
        """
        try:
            region = self._get_region()
            return region
        except self._RETRIES_EXCEEDED_ERROR_CLS:
            logger.debug(
                "Max number of attempts exceeded (%s) when "
                "attempting to retrieve data from metadata service.",
                self._num_attempts,
            )
        return None

    def _get_region(self):
        token = self._fetch_metadata_token()
        response = self._get_request(
            url_path=self._URL_PATH,
            retry_func=self._default_retry,
            token=token,
        )
        availability_zone = response.text
        region = availability_zone[:-1]
        return region


def merge_dicts(dict1, dict2, append_lists=False):
    """Given two dict, merge the second dict into the first.

    The dicts can have arbitrary nesting.

    :param append_lists: If true, instead of clobbering a list with the new
        value, append all of the new values onto the original list.
    """
    for key in dict2:
        if isinstance(dict2[key], dict):
            if key in dict1 and key in dict2:
                merge_dicts(dict1[key], dict2[key])
            else:
                dict1[key] = dict2[key]
        # If the value is a list and the ``append_lists`` flag is set,
        # append the new values onto the original list
        elif isinstance(dict2[key], list) and append_lists:
            # The value in dict1 must be a list in order to append new
            # values onto it.
            if key in dict1 and isinstance(dict1[key], list):
                dict1[key].extend(dict2[key])
            else:
                dict1[key] = dict2[key]
        else:
            # At scalar types, we iterate and merge the
            # current dict that we're on.
            dict1[key] = dict2[key]


def lowercase_dict(original):
    """Copies the given dictionary ensuring all keys are lowercase strings."""
    copy = {}
    for key in original:
        copy[key.lower()] = original[key]
    return copy


def parse_key_val_file(filename, _open=open):
    try:
        with _open(filename) as f:
            contents = f.read()
            return parse_key_val_file_contents(contents)
    except OSError:
        raise ConfigNotFound(path=filename)


def parse_key_val_file_contents(contents):
    # This was originally extracted from the EC2 credential provider, which was
    # fairly lenient in its parsing.  We only try to parse key/val pairs if
    # there's a '=' in the line.
    final = {}
    for line in contents.splitlines():
        if '=' not in line:
            continue
        key, val = line.split('=', 1)
        key = key.strip()
        val = val.strip()
        final[key] = val
    return final


def percent_encode_sequence(mapping, safe=SAFE_CHARS):
    """Urlencode a dict or list into a string.

    This is similar to urllib.urlencode except that:

    * It uses quote, and not quote_plus
    * It has a default list of safe chars that don't need
      to be encoded, which matches what AWS services expect.

    If any value in the input ``mapping`` is a list type,
    then each list element wil be serialized.  This is the equivalent
    to ``urlencode``'s ``doseq=True`` argument.

    This function should be preferred over the stdlib
    ``urlencode()`` function.

    :param mapping: Either a dict to urlencode or a list of
        ``(key, value)`` pairs.

    """
    encoded_pairs = []
    if hasattr(mapping, 'items'):
        pairs = mapping.items()
    else:
        pairs = mapping
    for key, value in pairs:
        if isinstance(value, list):
            for element in value:
                encoded_pairs.append(
                    f'{percent_encode(key)}={percent_encode(element)}'
                )
        else:
            encoded_pairs.append(
                f'{percent_encode(key)}={percent_encode(value)}'
            )
    return '&'.join(encoded_pairs)


def percent_encode(input_str, safe=SAFE_CHARS):
    """Urlencodes a string.

    Whereas percent_encode_sequence handles taking a dict/sequence and
    producing a percent encoded string, this function deals only with
    taking a string (not a dict/sequence) and percent encoding it.

    If given the binary type, will simply URL encode it. If given the
    text type, will produce the binary type by UTF-8 encoding the
    text. If given something else, will convert it to the text type
    first.
    """
    # If its not a binary or text string, make it a text string.
    if not isinstance(input_str, (bytes, str)):
        input_str = str(input_str)
    # If it's not bytes, make it bytes by UTF-8 encoding it.
    if not isinstance(input_str, bytes):
        input_str = input_str.encode('utf-8')
    return quote(input_str, safe=safe)


def _epoch_seconds_to_datetime(value, tzinfo):
    """Parse numerical epoch timestamps (seconds since 1970) into a
    ``datetime.datetime`` in UTC using ``datetime.timedelta``. This is intended
    as fallback when ``fromtimestamp`` raises ``OverflowError`` or ``OSError``.

    :type value: float or int
    :param value: The Unix timestamps as number.

    :type tzinfo: callable
    :param tzinfo: A ``datetime.tzinfo`` class or compatible callable.
    """
    epoch_zero = datetime.datetime(1970, 1, 1, 0, 0, 0, tzinfo=tzutc())
    epoch_zero_localized = epoch_zero.astimezone(tzinfo())
    return epoch_zero_localized + datetime.timedelta(seconds=value)


def _parse_timestamp_with_tzinfo(value, tzinfo):
    """Parse timestamp with pluggable tzinfo options."""
    if isinstance(value, (int, float)):
        # Possibly an epoch time.
        return datetime.datetime.fromtimestamp(value, tzinfo())
    else:
        try:
            return datetime.datetime.fromtimestamp(float(value), tzinfo())
        except (TypeError, ValueError):
            pass
    try:
        # In certain cases, a timestamp marked with GMT can be parsed into a
        # different time zone, so here we provide a context which will
        # enforce that GMT == UTC.
        return dateutil.parser.parse(value, tzinfos={'GMT': tzutc()})
    except (TypeError, ValueError) as e:
        raise ValueError(f'Invalid timestamp "{value}": {e}')


def parse_timestamp(value):
    """Parse a timestamp into a datetime object.

    Supported formats:

        * iso8601
        * rfc822
        * epoch (value is an integer)

    This will return a ``datetime.datetime`` object.

    """
    tzinfo_options = get_tzinfo_options()
    for tzinfo in tzinfo_options:
        try:
            return _parse_timestamp_with_tzinfo(value, tzinfo)
        except (OSError, OverflowError) as e:
            logger.debug(
                'Unable to parse timestamp with "%s" timezone info.',
                tzinfo.__name__,
                exc_info=e,
            )
    # For numeric values attempt fallback to using fromtimestamp-free method.
    # From Python's ``datetime.datetime.fromtimestamp`` documentation: "This
    # may raise ``OverflowError``, if the timestamp is out of the range of
    # values supported by the platform C localtime() function, and ``OSError``
    # on localtime() failure. It's common for this to be restricted to years
    # from 1970 through 2038."
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        pass
    else:
        try:
            for tzinfo in tzinfo_options:
                return _epoch_seconds_to_datetime(numeric_value, tzinfo=tzinfo)
        except (OSError, OverflowError) as e:
            logger.debug(
                'Unable to parse timestamp using fallback method with "%s" '
                'timezone info.',
                tzinfo.__name__,
                exc_info=e,
            )
    raise RuntimeError(
        f'Unable to calculate correct timezone offset for "{value}"'
    )


def parse_to_aware_datetime(value):
    """Converted the passed in value to a datetime object with tzinfo.

    This function can be used to normalize all timestamp inputs.  This
    function accepts a number of different types of inputs, but
    will always return a datetime.datetime object with time zone
    information.

    The input param ``value`` can be one of several types:

        * A datetime object (both naive and aware)
        * An integer representing the epoch time (can also be a string
          of the integer, i.e '0', instead of 0).  The epoch time is
          considered to be UTC.
        * An iso8601 formatted timestamp.  This does not need to be
          a complete timestamp, it can contain just the date portion
          without the time component.

    The returned value will be a datetime object that will have tzinfo.
    If no timezone info was provided in the input value, then UTC is
    assumed, not local time.

    """
    # This is a general purpose method that handles several cases of
    # converting the provided value to a string timestamp suitable to be
    # serialized to an http request. It can handle:
    # 1) A datetime.datetime object.
    if isinstance(value, _DatetimeClass):
        datetime_obj = value
    else:
        # 2) A string object that's formatted as a timestamp.
        #    We document this as being an iso8601 timestamp, although
        #    parse_timestamp is a bit more flexible.
        datetime_obj = parse_timestamp(value)
    if datetime_obj.tzinfo is None:
        # I think a case would be made that if no time zone is provided,
        # we should use the local time.  However, to restore backwards
        # compat, the previous behavior was to assume UTC, which is
        # what we're going to do here.
        datetime_obj = datetime_obj.replace(tzinfo=tzutc())
    else:
        datetime_obj = datetime_obj.astimezone(tzutc())
    return datetime_obj


def datetime2timestamp(dt, default_timezone=None):
    """Calculate the timestamp based on the given datetime instance.

    :type dt: datetime
    :param dt: A datetime object to be converted into timestamp
    :type default_timezone: tzinfo
    :param default_timezone: If it is provided as None, we treat it as tzutc().
                             But it is only used when dt is a naive datetime.
    :returns: The timestamp
    """
    epoch = datetime.datetime(1970, 1, 1)
    if dt.tzinfo is None:
        if default_timezone is None:
            default_timezone = tzutc()
        dt = dt.replace(tzinfo=default_timezone)
    d = dt.replace(tzinfo=None) - dt.utcoffset() - epoch
    return d.total_seconds()


def calculate_sha256(body, as_hex=False):
    """Calculate a sha256 checksum.

    This method will calculate the sha256 checksum of a file like
    object.  Note that this method will iterate through the entire
    file contents.  The caller is responsible for ensuring the proper
    starting position of the file and ``seek()``'ing the file back
    to its starting location if other consumers need to read from
    the file like object.

    :param body: Any file like object.  The file must be opened
        in binary mode such that a ``.read()`` call returns bytes.
    :param as_hex: If True, then the hex digest is returned.
        If False, then the digest (as binary bytes) is returned.

    :returns: The sha256 checksum

    """
    checksum = hashlib.sha256()
    for chunk in iter(lambda: body.read(1024 * 1024), b''):
        checksum.update(chunk)
    if as_hex:
        return checksum.hexdigest()
    else:
        return checksum.digest()


def calculate_tree_hash(body):
    """Calculate a tree hash checksum.

    For more information see:

    http://docs.aws.amazon.com/amazonglacier/latest/dev/checksum-calculations.html

    :param body: Any file like object.  This has the same constraints as
        the ``body`` param in calculate_sha256

    :rtype: str
    :returns: The hex version of the calculated tree hash

    """
    chunks = []
    required_chunk_size = 1024 * 1024
    sha256 = hashlib.sha256
    for chunk in iter(lambda: body.read(required_chunk_size), b''):
        chunks.append(sha256(chunk).digest())
    if not chunks:
        return sha256(b'').hexdigest()
    while len(chunks) > 1:
        new_chunks = []
        for first, second in _in_pairs(chunks):
            if second is not None:
                new_chunks.append(sha256(first + second).digest())
            else:
                # We're at the end of the list and there's no pair left.
                new_chunks.append(first)
        chunks = new_chunks
    return binascii.hexlify(chunks[0]).decode('ascii')


def _in_pairs(iterable):
    # Creates iterator that iterates over the list in pairs:
    # for a, b in _in_pairs([0, 1, 2, 3, 4]):
    #     print(a, b)
    #
    # will print:
    # 0, 1
    # 2, 3
    # 4, None
    shared_iter = iter(iterable)
    # Note that zip_longest is a compat import that uses
    # the itertools izip_longest.  This creates an iterator,
    # this call below does _not_ immediately create the list
    # of pairs.
    return zip_longest(shared_iter, shared_iter)


class CachedProperty:
    """A read only property that caches the initially computed value.

    This descriptor will only call the provided ``fget`` function once.
    Subsequent access to this property will return the cached value.

    """

    def __init__(self, fget):
        self._fget = fget

    def __get__(self, obj, cls):
        if obj is None:
            return self
        else:
            computed_value = self._fget(obj)
            obj.__dict__[self._fget.__name__] = computed_value
            return computed_value


class ArgumentGenerator:
    """Generate sample input based on a shape model.

    This class contains a ``generate_skeleton`` method that will take
    an input/output shape (created from ``botocore.model``) and generate
    a sample dictionary corresponding to the input/output shape.

    The specific values used are place holder values. For strings either an
    empty string or the member name can be used, for numbers 0 or 0.0 is used.
    The intended usage of this class is to generate the *shape* of the input
    structure.

    This can be useful for operations that have complex input shapes.
    This allows a user to just fill in the necessary data instead of
    worrying about the specific structure of the input arguments.

    Example usage::

        s = botocore.session.get_session()
        ddb = s.get_service_model('dynamodb')
        arg_gen = ArgumentGenerator()
        sample_input = arg_gen.generate_skeleton(
            ddb.operation_model('CreateTable').input_shape)
        print("Sample input for dynamodb.CreateTable: %s" % sample_input)

    """

    def __init__(self, use_member_names=False):
        self._use_member_names = use_member_names

    def generate_skeleton(self, shape):
        """Generate a sample input.

        :type shape: ``botocore.model.Shape``
        :param shape: The input shape.

        :return: The generated skeleton input corresponding to the
            provided input shape.

        """
        stack = []
        return self._generate_skeleton(shape, stack)

    def _generate_skeleton(self, shape, stack, name=''):
        stack.append(shape.name)
        try:
            if shape.type_name == 'structure':
                return self._generate_type_structure(shape, stack)
            elif shape.type_name == 'list':
                return self._generate_type_list(shape, stack)
            elif shape.type_name == 'map':
                return self._generate_type_map(shape, stack)
            elif shape.type_name == 'string':
                if self._use_member_names:
                    return name
                if shape.enum:
                    return random.choice(shape.enum)
                return ''
            elif shape.type_name in ['integer', 'long']:
                return 0
            elif shape.type_name in ['float', 'double']:
                return 0.0
            elif shape.type_name == 'boolean':
                return True
            elif shape.type_name == 'timestamp':
                return datetime.datetime(1970, 1, 1, 0, 0, 0)
        finally:
            stack.pop()

    def _generate_type_structure(self, shape, stack):
        if stack.count(shape.name) > 1:
            return {}
        skeleton = OrderedDict()
        for member_name, member_shape in shape.members.items():
            skeleton[member_name] = self._generate_skeleton(
                member_shape, stack, name=member_name
            )
        return skeleton

    def _generate_type_list(self, shape, stack):
        # For list elements we've arbitrarily decided to
        # return two elements for the skeleton list.
        name = ''
        if self._use_member_names:
            name = shape.member.name
        return [
            self._generate_skeleton(shape.member, stack, name),
        ]

    def _generate_type_map(self, shape, stack):
        key_shape = shape.key
        value_shape = shape.value
        assert key_shape.type_name == 'string'
        return OrderedDict(
            [
                ('KeyName', self._generate_skeleton(value_shape, stack)),
            ]
        )


def is_valid_ipv6_endpoint_url(endpoint_url):
    if UNSAFE_URL_CHARS.intersection(endpoint_url):
        return False
    hostname = f'[{urlparse(endpoint_url).hostname}]'
    return IPV6_ADDRZ_RE.match(hostname) is not None


def is_valid_ipv4_endpoint_url(endpoint_url):
    hostname = urlparse(endpoint_url).hostname
    return IPV4_RE.match(hostname) is not None


def is_valid_endpoint_url(endpoint_url):
    """Verify the endpoint_url is valid.

    :type endpoint_url: string
    :param endpoint_url: An endpoint_url.  Must have at least a scheme
        and a hostname.

    :return: True if the endpoint url is valid. False otherwise.

    """
    # post-bpo-43882 urlsplit() strips unsafe characters from URL, causing
    # it to pass hostname validation below.  Detect them early to fix that.
    if UNSAFE_URL_CHARS.intersection(endpoint_url):
        return False
    parts = urlsplit(endpoint_url)
    hostname = parts.hostname
    if hostname is None:
        return False
    if len(hostname) > 255:
        return False
    if hostname[-1] == ".":
        hostname = hostname[:-1]
    allowed = re.compile(
        r"^((?!-)[A-Z\d-]{1,63}(?<!-)\.)*((?!-)[A-Z\d-]{1,63}(?<!-))$",
        re.IGNORECASE,
    )
    return allowed.match(hostname)


def is_valid_uri(endpoint_url):
    return is_valid_endpoint_url(endpoint_url) or is_valid_ipv6_endpoint_url(
        endpoint_url
    )


def validate_region_name(region_name):
    """Provided region_name must be a valid host label."""
    if region_name is None:
        return
    valid_host_label = re.compile(r'^(?![0-9]+$)(?!-)[a-zA-Z0-9-]{,63}(?<!-)$')
    valid = valid_host_label.match(region_name)
    if not valid:
        raise InvalidRegionError(region_name=region_name)


def check_dns_name(bucket_name):
    """
    Check to see if the ``bucket_name`` complies with the
    restricted DNS naming conventions necessary to allow
    access via virtual-hosting style.

    Even though "." characters are perfectly valid in this DNS
    naming scheme, we are going to punt on any name containing a
    "." character because these will cause SSL cert validation
    problems if we try to use virtual-hosting style addressing.
    """
    if '.' in bucket_name:
        return False
    n = len(bucket_name)
    if n < 3 or n > 63:
        # Wrong length
        return False
    match = LABEL_RE.match(bucket_name)
    if match is None or match.end() != len(bucket_name):
        return False
    return True


def fix_s3_host(
    request,
    signature_version,
    region_name,
    default_endpoint_url=None,
    **kwargs,
):
    """
    This handler looks at S3 requests just before they are signed.
    If there is a bucket name on the path (true for everything except
    ListAllBuckets) it checks to see if that bucket name conforms to
    the DNS naming conventions.  If it does, it alters the request to
    use ``virtual hosting`` style addressing rather than ``path-style``
    addressing.

    """
    if request.context.get('use_global_endpoint', False):
        default_endpoint_url = 's3.amazonaws.com'
    try:
        switch_to_virtual_host_style(
            request, signature_version, default_endpoint_url
        )
    except InvalidDNSNameError as e:
        bucket_name = e.kwargs['bucket_name']
        logger.debug(
            'Not changing URI, bucket is not DNS compatible: %s', bucket_name
        )


def switch_to_virtual_host_style(
    request, signature_version, default_endpoint_url=None, **kwargs
):
    """
    This is a handler to force virtual host style s3 addressing no matter
    the signature version (which is taken in consideration for the default
    case). If the bucket is not DNS compatible an InvalidDNSName is thrown.

    :param request: A AWSRequest object that is about to be sent.
    :param signature_version: The signature version to sign with
    :param default_endpoint_url: The endpoint to use when switching to a
        virtual style. If None is supplied, the virtual host will be
        constructed from the url of the request.
    """
    if request.auth_path is not None:
        # The auth_path has already been applied (this may be a
        # retried request).  We don't need to perform this
        # customization again.
        return
    elif _is_get_bucket_location_request(request):
        # For the GetBucketLocation response, we should not be using
        # the virtual host style addressing so we can avoid any sigv4
        # issues.
        logger.debug(
            "Request is GetBucketLocation operation, not checking "
            "for DNS compatibility."
        )
        return
    parts = urlsplit(request.url)
    request.auth_path = parts.path
    path_parts = parts.path.split('/')

    # Retrieve what the endpoint we will be prepending the bucket name to.
    if default_endpoint_url is None:
        default_endpoint_url = parts.netloc

    if len(path_parts) > 1:
        bucket_name = path_parts[1]
        if not bucket_name:
            # If the bucket name is empty we should not be checking for
            # dns compatibility.
            return
        logger.debug('Checking for DNS compatible bucket for: %s', request.url)
        if check_dns_name(bucket_name):
            # If the operation is on a bucket, the auth_path must be
            # terminated with a '/' character.
            if len(path_parts) == 2:
                if request.auth_path[-1] != '/':
                    request.auth_path += '/'
            path_parts.remove(bucket_name)
            # At the very least the path must be a '/', such as with the
            # CreateBucket operation when DNS style is being used. If this
            # is not used you will get an empty path which is incorrect.
            path = '/'.join(path_parts) or '/'
            global_endpoint = default_endpoint_url
            host = bucket_name + '.' + global_endpoint
            new_tuple = (parts.scheme, host, path, parts.query, '')
            new_uri = urlunsplit(new_tuple)
            request.url = new_uri
            logger.debug('URI updated to: %s', new_uri)
        else:
            raise InvalidDNSNameError(bucket_name=bucket_name)


def _is_get_bucket_location_request(request):
    return request.url.endswith('?location')


def instance_cache(func):
    """Method decorator for caching method calls to a single instance.

    **This is not a general purpose caching decorator.**

    In order to use this, you *must* provide an ``_instance_cache``
    attribute on the instance.

    This decorator is used to cache method calls.  The cache is only
    scoped to a single instance though such that multiple instances
    will maintain their own cache.  In order to keep things simple,
    this decorator requires that you provide an ``_instance_cache``
    attribute on your instance.

    """
    func_name = func.__name__

    @functools.wraps(func)
    def _cache_guard(self, *args, **kwargs):
        cache_key = (func_name, args)
        if kwargs:
            kwarg_items = tuple(sorted(kwargs.items()))
            cache_key = (func_name, args, kwarg_items)
        result = self._instance_cache.get(cache_key)
        if result is not None:
            return result
        result = func(self, *args, **kwargs)
        self._instance_cache[cache_key] = result
        return result

    return _cache_guard


def lru_cache_weakref(*cache_args, **cache_kwargs):
    """
    Version of functools.lru_cache that stores a weak reference to ``self``.

    Serves the same purpose as :py:func:`instance_cache` but uses Python's
    functools implementation which offers ``max_size`` and ``typed`` properties.

    lru_cache is a global cache even when used on a method. The cache's
    reference to ``self`` will prevent garbace collection of the object. This
    wrapper around functools.lru_cache replaces the reference to ``self`` with
    a weak reference to not interfere with garbage collection.
    """

    def wrapper(func):
        @functools.lru_cache(*cache_args, **cache_kwargs)
        def func_with_weakref(weakref_to_self, *args, **kwargs):
            return func(weakref_to_self(), *args, **kwargs)

        @functools.wraps(func)
        def inner(self, *args, **kwargs):
            return func_with_weakref(weakref.ref(self), *args, **kwargs)

        inner.cache_info = func_with_weakref.cache_info
        return inner

    return wrapper


def switch_host_s3_accelerate(request, operation_name, **kwargs):
    """Switches the current s3 endpoint with an S3 Accelerate endpoint"""

    # Note that when registered the switching of the s3 host happens
    # before it gets changed to virtual. So we are not concerned with ensuring
    # that the bucket name is translated to the virtual style here and we
    # can hard code the Accelerate endpoint.
    parts = urlsplit(request.url).netloc.split('.')
    parts = [p for p in parts if p in S3_ACCELERATE_WHITELIST]
    endpoint = 'https://s3-accelerate.'
    if len(parts) > 0:
        endpoint += '.'.join(parts) + '.'
    endpoint += 'amazonaws.com'

    if operation_name in ['ListBuckets', 'CreateBucket', 'DeleteBucket']:
        return
    _switch_hosts(request, endpoint, use_new_scheme=False)


def switch_host_with_param(request, param_name):
    """Switches the host using a parameter value from a JSON request body"""
    request_json = json.loads(request.data.decode('utf-8'))
    if request_json.get(param_name):
        new_endpoint = request_json[param_name]
        _switch_hosts(request, new_endpoint)


def _switch_hosts(request, new_endpoint, use_new_scheme=True):
    final_endpoint = _get_new_endpoint(
        request.url, new_endpoint, use_new_scheme
    )
    request.url = final_endpoint


def _get_new_endpoint(original_endpoint, new_endpoint, use_new_scheme=True):
    new_endpoint_components = urlsplit(new_endpoint)
    original_endpoint_components = urlsplit(original_endpoint)
    scheme = original_endpoint_components.scheme
    if use_new_scheme:
        scheme = new_endpoint_components.scheme
    final_endpoint_components = (
        scheme,
        new_endpoint_components.netloc,
        original_endpoint_components.path,
        original_endpoint_components.query,
        '',
    )
    final_endpoint = urlunsplit(final_endpoint_components)
    logger.debug(f'Updating URI from {original_endpoint} to {final_endpoint}')
    return final_endpoint


def deep_merge(base, extra):
    """Deeply two dictionaries, overriding existing keys in the base.

    :param base: The base dictionary which will be merged into.
    :param extra: The dictionary to merge into the base. Keys from this
        dictionary will take precedence.
    """
    for key in extra:
        # If the key represents a dict on both given dicts, merge the sub-dicts
        if (
            key in base
            and isinstance(base[key], dict)
            and isinstance(extra[key], dict)
        ):
            deep_merge(base[key], extra[key])
            continue

        # Otherwise, set the key on the base to be the value of the extra.
        base[key] = extra[key]


def hyphenize_service_id(service_id):
    """Translate the form used for event emitters.

    :param service_id: The service_id to convert.
    """
    return service_id.replace(' ', '-').lower()


class IdentityCache:
    """Base IdentityCache implementation for storing and retrieving
    highly accessed credentials.

    This class is not intended to be instantiated in user code.
    """

    METHOD = "base_identity_cache"

    def __init__(self, client, credential_cls):
        self._client = client
        self._credential_cls = credential_cls

    def get_credentials(self, **kwargs):
        callback = self.build_refresh_callback(**kwargs)
        metadata = callback()
        credential_entry = self._credential_cls.create_from_metadata(
            metadata=metadata,
            refresh_using=callback,
            method=self.METHOD,
            advisory_timeout=45,
            mandatory_timeout=10,
        )
        return credential_entry

    def build_refresh_callback(**kwargs):
        """Callback to be implemented by subclasses.

        Returns a set of metadata to be converted into a new
        credential instance.
        """
        raise NotImplementedError()


class S3ExpressIdentityCache(IdentityCache):
    """S3Express IdentityCache for retrieving and storing
    credentials from CreateSession calls.

    This class is not intended to be instantiated in user code.
    """

    METHOD = "s3express"

    def __init__(self, client, credential_cls):
        self._client = client
        self._credential_cls = credential_cls

    @functools.lru_cache(maxsize=100)
    def get_credentials(self, bucket):
        return super().get_credentials(bucket=bucket)

    def build_refresh_callback(self, bucket):
        def refresher():
            response = self._client.create_session(Bucket=bucket)
            creds = response['Credentials']
            expiration = self._serialize_if_needed(
                creds['Expiration'], iso=True
            )
            return {
                "access_key": creds['AccessKeyId'],
                "secret_key": creds['SecretAccessKey'],
                "token": creds['SessionToken'],
                "expiry_time": expiration,
            }

        return refresher

    def _serialize_if_needed(self, value, iso=False):
        if isinstance(value, _DatetimeClass):
            if iso:
                return value.isoformat()
            return value.strftime('%Y-%m-%dT%H:%M:%S%Z')
        return value


class S3ExpressIdentityResolver:
    def __init__(self, client, credential_cls, cache=None):
        self._client = weakref.proxy(client)

        if cache is None:
            cache = S3ExpressIdentityCache(self._client, credential_cls)
        self._cache = cache

    def register(self, event_emitter=None):
        logger.debug('Registering S3Express Identity Resolver')
        emitter = event_emitter or self._client.meta.events
        emitter.register('before-call.s3', self.apply_signing_cache_key)
        emitter.register('before-sign.s3', self.resolve_s3express_identity)

    def apply_signing_cache_key(self, params, context, **kwargs):
        endpoint_properties = context.get('endpoint_properties', {})
        backend = endpoint_properties.get('backend', None)

        # Add cache key if Bucket supplied for s3express request
        bucket_name = context.get('input_params', {}).get('Bucket')
        if backend == 'S3Express' and bucket_name is not None:
            context.setdefault('signing', {})
            context['signing']['cache_key'] = bucket_name

    def resolve_s3express_identity(
        self,
        request,
        signing_name,
        region_name,
        signature_version,
        request_signer,
        operation_name,
        **kwargs,
    ):
        signing_context = request.context.get('signing', {})
        signing_name = signing_context.get('signing_name')
        if signing_name == 's3express' and signature_version.startswith(
            'v4-s3express'
        ):
            signing_context['identity_cache'] = self._cache
            if 'cache_key' not in signing_context:
                signing_context['cache_key'] = (
                    request.context.get('s3_redirect', {})
                    .get('params', {})
                    .get('Bucket')
                )


class S3RegionRedirectorv2:
    """Updated version of S3RegionRedirector for use when
    EndpointRulesetResolver is in use for endpoint resolution.

    This class is considered private and subject to abrupt breaking changes or
    removal without prior announcement. Please do not use it directly.
    """

    def __init__(self, endpoint_bridge, client, cache=None):
        self._cache = cache or {}
        self._client = weakref.proxy(client)

    def register(self, event_emitter=None):
        logger.debug('Registering S3 region redirector handler')
        emitter = event_emitter or self._client.meta.events
        emitter.register('needs-retry.s3', self.redirect_from_error)
        emitter.register(
            'before-parameter-build.s3', self.annotate_request_context
        )
        emitter.register(
            'before-endpoint-resolution.s3', self.redirect_from_cache
        )

    def redirect_from_error(self, request_dict, response, operation, **kwargs):
        """
        An S3 request sent to the wrong region will return an error that
        contains the endpoint the request should be sent to. This handler
        will add the redirect information to the signing context and then
        redirect the request.
        """
        if response is None:
            # This could be none if there was a ConnectionError or other
            # transport error.
            return

        redirect_ctx = request_dict.get('context', {}).get('s3_redirect', {})
        if ArnParser.is_arn(redirect_ctx.get('bucket')):
            logger.debug(
                'S3 request was previously for an Accesspoint ARN, not '
                'redirecting.'
            )
            return

        if redirect_ctx.get('redirected'):
            logger.debug(
                'S3 request was previously redirected, not redirecting.'
            )
            return

        error = response[1].get('Error', {})
        error_code = error.get('Code')
        response_metadata = response[1].get('ResponseMetadata', {})

        # We have to account for 400 responses because
        # if we sign a Head* request with the wrong region,
        # we'll get a 400 Bad Request but we won't get a
        # body saying it's an "AuthorizationHeaderMalformed".
        is_special_head_object = (
            error_code in ('301', '400') and operation.name == 'HeadObject'
        )
        is_special_head_bucket = (
            error_code in ('301', '400')
            and operation.name == 'HeadBucket'
            and 'x-amz-bucket-region'
            in response_metadata.get('HTTPHeaders', {})
        )
        is_wrong_signing_region = (
            error_code == 'AuthorizationHeaderMalformed' and 'Region' in error
        )
        is_redirect_status = response[0] is not None and response[
            0
        ].status_code in (301, 302, 307)
        is_permanent_redirect = error_code == 'PermanentRedirect'
        if not any(
            [
                is_special_head_object,
                is_wrong_signing_region,
                is_permanent_redirect,
                is_special_head_bucket,
                is_redirect_status,
            ]
        ):
            return

        bucket = request_dict['context']['s3_redirect']['bucket']
        client_region = request_dict['context'].get('client_region')
        new_region = self.get_bucket_region(bucket, response)

        if new_region is None:
            logger.debug(
                f"S3 client configured for region {client_region} but the "
                f"bucket {bucket} is not in that region and the proper region "
                "could not be automatically determined."
            )
            return

        logger.debug(
            f"S3 client configured for region {client_region} but the bucket {bucket} "
            f"is in region {new_region}; Please configure the proper region to "
            f"avoid multiple unnecessary redirects and signing attempts."
        )
        # Adding the new region to _cache will make construct_endpoint() to
        # use the new region as value for the AWS::Region builtin parameter.
        self._cache[bucket] = new_region

        # Re-resolve endpoint with new region and modify request_dict with
        # the new URL, auth scheme, and signing context.
        ep_resolver = self._client._ruleset_resolver
        ep_info = ep_resolver.construct_endpoint(
            operation_model=operation,
            call_args=request_dict['context']['s3_redirect']['params'],
            request_context=request_dict['context'],
        )
        request_dict['url'] = self.set_request_url(
            request_dict['url'], ep_info.url
        )
        request_dict['context']['s3_redirect']['redirected'] = True
        auth_schemes = ep_info.properties.get('authSchemes')
        if auth_schemes is not None:
            auth_info = ep_resolver.auth_schemes_to_signing_ctx(auth_schemes)
            auth_type, signing_context = auth_info
            request_dict['context']['auth_type'] = auth_type
            request_dict['context']['signing'] = {
                **request_dict['context'].get('signing', {}),
                **signing_context,
            }

        # Return 0 so it doesn't wait to retry
        return 0

    def get_bucket_region(self, bucket, response):
        """
        There are multiple potential sources for the new region to redirect to,
        but they aren't all universally available for use. This will try to
        find region from response elements, but will fall back to calling
        HEAD on the bucket if all else fails.

        :param bucket: The bucket to find the region for. This is necessary if
            the region is not available in the error response.
        :param response: A response representing a service request that failed
            due to incorrect region configuration.
        """
        # First try to source the region from the headers.
        service_response = response[1]
        response_headers = service_response['ResponseMetadata']['HTTPHeaders']
        if 'x-amz-bucket-region' in response_headers:
            return response_headers['x-amz-bucket-region']

        # Next, check the error body
        region = service_response.get('Error', {}).get('Region', None)
        if region is not None:
            return region

        # Finally, HEAD the bucket. No other choice sadly.
        try:
            response = self._client.head_bucket(Bucket=bucket)
            headers = response['ResponseMetadata']['HTTPHeaders']
        except ClientError as e:
            headers = e.response['ResponseMetadata']['HTTPHeaders']

        region = headers.get('x-amz-bucket-region', None)
        return region

    def set_request_url(self, old_url, new_endpoint, **kwargs):
        """
        Splice a new endpoint into an existing URL. Note that some endpoints
        from the the endpoint provider have a path component which will be
        discarded by this function.
        """
        return _get_new_endpoint(old_url, new_endpoint, False)

    def redirect_from_cache(self, builtins, params, **kwargs):
        """
        If a bucket name has been redirected before, it is in the cache. This
        handler will update the AWS::Region endpoint resolver builtin param
        to use the region from cache instead of the client region to avoid the
        redirect.
        """
        bucket = params.get('Bucket')
        if bucket is not None and bucket in self._cache:
            new_region = self._cache.get(bucket)
            builtins['AWS::Region'] = new_region

    def annotate_request_context(self, params, context, **kwargs):
        """Store the bucket name in context for later use when redirecting.
        The bucket name may be an access point ARN or alias.
        """
        bucket = params.get('Bucket')
        context['s3_redirect'] = {
            'redirected': False,
            'bucket': bucket,
            'params': params,
        }


class S3RegionRedirector:
    """This handler has been replaced by S3RegionRedirectorv2. The original
    version remains in place for any third-party libraries that import it.
    """

    def __init__(self, endpoint_bridge, client, cache=None):
        self._endpoint_resolver = endpoint_bridge
        self._cache = cache
        if self._cache is None:
            self._cache = {}

        # This needs to be a weak ref in order to prevent memory leaks on
        # python 2.6
        self._client = weakref.proxy(client)

        warnings.warn(
            'The S3RegionRedirector class has been deprecated for a new '
            'internal replacement. A future version of botocore may remove '
            'this class.',
            category=FutureWarning,
        )

    def register(self, event_emitter=None):
        emitter = event_emitter or self._client.meta.events
        emitter.register('needs-retry.s3', self.redirect_from_error)
        emitter.register('before-call.s3', self.set_request_url)
        emitter.register('before-parameter-build.s3', self.redirect_from_cache)

    def redirect_from_error(self, request_dict, response, operation, **kwargs):
        """
        An S3 request sent to the wrong region will return an error that
        contains the endpoint the request should be sent to. This handler
        will add the redirect information to the signing context and then
        redirect the request.
        """
        if response is None:
            # This could be none if there was a ConnectionError or other
            # transport error.
            return

        if self._is_s3_accesspoint(request_dict.get('context', {})):
            logger.debug(
                'S3 request was previously to an accesspoint, not redirecting.'
            )
            return

        if request_dict.get('context', {}).get('s3_redirected'):
            logger.debug(
                'S3 request was previously redirected, not redirecting.'
            )
            return

        error = response[1].get('Error', {})
        error_code = error.get('Code')
        response_metadata = response[1].get('ResponseMetadata', {})

        # We have to account for 400 responses because
        # if we sign a Head* request with the wrong region,
        # we'll get a 400 Bad Request but we won't get a
        # body saying it's an "AuthorizationHeaderMalformed".
        is_special_head_object = (
            error_code in ('301', '400') and operation.name == 'HeadObject'
        )
        is_special_head_bucket = (
            error_code in ('301', '400')
            and operation.name == 'HeadBucket'
            and 'x-amz-bucket-region'
            in response_metadata.get('HTTPHeaders', {})
        )
        is_wrong_signing_region = (
            error_code == 'AuthorizationHeaderMalformed' and 'Region' in error
        )
        is_redirect_status = response[0] is not None and response[
            0
        ].status_code in (301, 302, 307)
        is_permanent_redirect = error_code == 'PermanentRedirect'
        if not any(
            [
                is_special_head_object,
                is_wrong_signing_region,
                is_permanent_redirect,
                is_special_head_bucket,
                is_redirect_status,
            ]
        ):
            return

        bucket = request_dict['context']['signing']['bucket']
        client_region = request_dict['context'].get('client_region')
        new_region = self.get_bucket_region(bucket, response)

        if new_region is None:
            logger.debug(
                f"S3 client configured for region {client_region} but the bucket {bucket} is not "
                "in that region and the proper region could not be "
                "automatically determined."
            )
            return

        logger.debug(
            f"S3 client configured for region {client_region} but the bucket {bucket} is in region"
            f" {new_region}; Please configure the proper region to avoid multiple "
            "unnecessary redirects and signing attempts."
        )
        endpoint = self._endpoint_resolver.resolve('s3', new_region)
        endpoint = endpoint['endpoint_url']

        signing_context = {
            'region': new_region,
            'bucket': bucket,
            'endpoint': endpoint,
        }
        request_dict['context']['signing'] = signing_context

        self._cache[bucket] = signing_context
        self.set_request_url(request_dict, request_dict['context'])

        request_dict['context']['s3_redirected'] = True

        # Return 0 so it doesn't wait to retry
        return 0

    def get_bucket_region(self, bucket, response):
        """
        There are multiple potential sources for the new region to redirect to,
        but they aren't all universally available for use. This will try to
        find region from response elements, but will fall back to calling
        HEAD on the bucket if all else fails.

        :param bucket: The bucket to find the region for. This is necessary if
            the region is not available in the error response.
        :param response: A response representing a service request that failed
            due to incorrect region configuration.
        """
        # First try to source the region from the headers.
        service_response = response[1]
        response_headers = service_response['ResponseMetadata']['HTTPHeaders']
        if 'x-amz-bucket-region' in response_headers:
            return response_headers['x-amz-bucket-region']

        # Next, check the error body
        region = service_response.get('Error', {}).get('Region', None)
        if region is not None:
            return region

        # Finally, HEAD the bucket. No other choice sadly.
        try:
            response = self._client.head_bucket(Bucket=bucket)
            headers = response['ResponseMetadata']['HTTPHeaders']
        except ClientError as e:
            headers = e.response['ResponseMetadata']['HTTPHeaders']

        region = headers.get('x-amz-bucket-region', None)
        return region

    def set_request_url(self, params, context, **kwargs):
        endpoint = context.get('signing', {}).get('endpoint', None)
        if endpoint is not None:
            params['url'] = _get_new_endpoint(params['url'], endpoint, False)

    def redirect_from_cache(self, params, context, **kwargs):
        """
        This handler retrieves a given bucket's signing context from the cache
        and adds it into the request context.
        """
        if self._is_s3_accesspoint(context):
            return
        bucket = params.get('Bucket')
        signing_context = self._cache.get(bucket)
        if signing_context is not None:
            context['signing'] = signing_context
        else:
            context['signing'] = {'bucket': bucket}

    def _is_s3_accesspoint(self, context):
        return 's3_accesspoint' in context


class InvalidArnException(ValueError):
    pass


class ArnParser:
    def parse_arn(self, arn):
        arn_parts = arn.split(':', 5)
        if len(arn_parts) < 6:
            raise InvalidArnException(
                f'Provided ARN: {arn} must be of the format: '
                'arn:partition:service:region:account:resource'
            )
        return {
            'partition': arn_parts[1],
            'service': arn_parts[2],
            'region': arn_parts[3],
            'account': arn_parts[4],
            'resource': arn_parts[5],
        }

    @staticmethod
    def is_arn(value):
        if not isinstance(value, str) or not value.startswith('arn:'):
            return False
        arn_parser = ArnParser()
        try:
            arn_parser.parse_arn(value)
            return True
        except InvalidArnException:
            return False


class S3ArnParamHandler:
    _RESOURCE_REGEX = re.compile(
        r'^(?P<resource_type>accesspoint|outpost)[/:](?P<resource_name>.+)$'
    )
    _OUTPOST_RESOURCE_REGEX = re.compile(
        r'^(?P<outpost_name>[a-zA-Z0-9\-]{1,63})[/:]accesspoint[/:]'
        r'(?P<accesspoint_name>[a-zA-Z0-9\-]{1,63}$)'
    )
    _BLACKLISTED_OPERATIONS = ['CreateBucket']

    def __init__(self, arn_parser=None):
        self._arn_parser = arn_parser
        if arn_parser is None:
            self._arn_parser = ArnParser()

    def register(self, event_emitter):
        event_emitter.register('before-parameter-build.s3', self.handle_arn)

    def handle_arn(self, params, model, context, **kwargs):
        if model.name in self._BLACKLISTED_OPERATIONS:
            return
        arn_details = self._get_arn_details_from_bucket_param(params)
        if arn_details is None:
            return
        if arn_details['resource_type'] == 'accesspoint':
            self._store_accesspoint(params, context, arn_details)
        elif arn_details['resource_type'] == 'outpost':
            self._store_outpost(params, context, arn_details)

    def _get_arn_details_from_bucket_param(self, params):
        if 'Bucket' in params:
            try:
                arn = params['Bucket']
                arn_details = self._arn_parser.parse_arn(arn)
                self._add_resource_type_and_name(arn, arn_details)
                return arn_details
            except InvalidArnException:
                pass
        return None

    def _add_resource_type_and_name(self, arn, arn_details):
        match = self._RESOURCE_REGEX.match(arn_details['resource'])
        if match:
            arn_details['resource_type'] = match.group('resource_type')
            arn_details['resource_name'] = match.group('resource_name')
        else:
            raise UnsupportedS3ArnError(arn=arn)

    def _store_accesspoint(self, params, context, arn_details):
        # Ideally the access-point would be stored as a parameter in the
        # request where the serializer would then know how to serialize it,
        # but access-points are not modeled in S3 operations so it would fail
        # validation. Instead, we set the access-point to the bucket parameter
        # to have some value set when serializing the request and additional
        # information on the context from the arn to use in forming the
        # access-point endpoint.
        params['Bucket'] = arn_details['resource_name']
        context['s3_accesspoint'] = {
            'name': arn_details['resource_name'],
            'account': arn_details['account'],
            'partition': arn_details['partition'],
            'region': arn_details['region'],
            'service': arn_details['service'],
        }

    def _store_outpost(self, params, context, arn_details):
        resource_name = arn_details['resource_name']
        match = self._OUTPOST_RESOURCE_REGEX.match(resource_name)
        if not match:
            raise UnsupportedOutpostResourceError(resource_name=resource_name)
        # Because we need to set the bucket name to something to pass
        # validation we're going to use the access point name to be consistent
        # with normal access point arns.
        accesspoint_name = match.group('accesspoint_name')
        params['Bucket'] = accesspoint_name
        context['s3_accesspoint'] = {
            'outpost_name': match.group('outpost_name'),
            'name': accesspoint_name,
            'account': arn_details['account'],
            'partition': arn_details['partition'],
            'region': arn_details['region'],
            'service': arn_details['service'],
        }


class S3EndpointSetter:
    _DEFAULT_PARTITION = 'aws'
    _DEFAULT_DNS_SUFFIX = 'amazonaws.com'

    def __init__(
        self,
        endpoint_resolver,
        region=None,
        s3_config=None,
        endpoint_url=None,
        partition=None,
        use_fips_endpoint=False,
    ):
        # This is calling the endpoint_resolver in regions.py
        self._endpoint_resolver = endpoint_resolver
        self._region = region
        self._s3_config = s3_config
        self._use_fips_endpoint = use_fips_endpoint
        if s3_config is None:
            self._s3_config = {}
        self._endpoint_url = endpoint_url
        self._partition = partition
        if partition is None:
            self._partition = self._DEFAULT_PARTITION

    def register(self, event_emitter):
        event_emitter.register('before-sign.s3', self.set_endpoint)
        event_emitter.register('choose-signer.s3', self.set_signer)
        event_emitter.register(
            'before-call.s3.WriteGetObjectResponse',
            self.update_endpoint_to_s3_object_lambda,
        )

    def update_endpoint_to_s3_object_lambda(self, params, context, **kwargs):
        if self._use_accelerate_endpoint:
            raise UnsupportedS3ConfigurationError(
                msg='S3 client does not support accelerate endpoints for S3 Object Lambda operations',
            )

        self._override_signing_name(context, 's3-object-lambda')
        if self._endpoint_url:
            # Only update the url if an explicit url was not provided
            return

        resolver = self._endpoint_resolver
        # Constructing endpoints as s3-object-lambda as region
        resolved = resolver.construct_endpoint(
            's3-object-lambda', self._region
        )

        # Ideally we would be able to replace the endpoint before
        # serialization but there's no event to do that currently
        # host_prefix is all the arn/bucket specs
        new_endpoint = 'https://{host_prefix}{hostname}'.format(
            host_prefix=params['host_prefix'],
            hostname=resolved['hostname'],
        )

        params['url'] = _get_new_endpoint(params['url'], new_endpoint, False)

    def set_endpoint(self, request, **kwargs):
        if self._use_accesspoint_endpoint(request):
            self._validate_accesspoint_supported(request)
            self._validate_fips_supported(request)
            self._validate_global_regions(request)
            region_name = self._resolve_region_for_accesspoint_endpoint(
                request
            )
            self._resolve_signing_name_for_accesspoint_endpoint(request)
            self._switch_to_accesspoint_endpoint(request, region_name)
            return
        if self._use_accelerate_endpoint:
            if self._use_fips_endpoint:
                raise UnsupportedS3ConfigurationError(
                    msg=(
                        'Client is configured to use the FIPS psuedo region '
                        f'for "{self._region}", but S3 Accelerate does not have any FIPS '
                        'compatible endpoints.'
                    )
                )
            switch_host_s3_accelerate(request=request, **kwargs)
        if self._s3_addressing_handler:
            self._s3_addressing_handler(request=request, **kwargs)

    def _use_accesspoint_endpoint(self, request):
        return 's3_accesspoint' in request.context

    def _validate_fips_supported(self, request):
        if not self._use_fips_endpoint:
            return
        if 'fips' in request.context['s3_accesspoint']['region']:
            raise UnsupportedS3AccesspointConfigurationError(
                msg={'Invalid ARN, FIPS region not allowed in ARN.'}
            )
        if 'outpost_name' in request.context['s3_accesspoint']:
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    f'Client is configured to use the FIPS psuedo-region "{self._region}", '
                    'but outpost ARNs do not support FIPS endpoints.'
                )
            )
        # Transforming psuedo region to actual region
        accesspoint_region = request.context['s3_accesspoint']['region']
        if accesspoint_region != self._region:
            if not self._s3_config.get('use_arn_region', True):
                # TODO: Update message to reflect use_arn_region
                # is not set
                raise UnsupportedS3AccesspointConfigurationError(
                    msg=(
                        'Client is configured to use the FIPS psuedo-region '
                        f'for "{self._region}", but the access-point ARN provided is for '
                        f'the "{accesspoint_region}" region. For clients using a FIPS '
                        'psuedo-region calls to access-point ARNs in another '
                        'region are not allowed.'
                    )
                )

    def _validate_global_regions(self, request):
        if self._s3_config.get('use_arn_region', True):
            return
        if self._region in ['aws-global', 's3-external-1']:
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    'Client is configured to use the global psuedo-region '
                    f'"{self._region}". When providing access-point ARNs a regional '
                    'endpoint must be specified.'
                )
            )

    def _validate_accesspoint_supported(self, request):
        if self._use_accelerate_endpoint:
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    'Client does not support s3 accelerate configuration '
                    'when an access-point ARN is specified.'
                )
            )
        request_partition = request.context['s3_accesspoint']['partition']
        if request_partition != self._partition:
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    f'Client is configured for "{self._partition}" partition, but access-point'
                    f' ARN provided is for "{request_partition}" partition. The client and '
                    ' access-point partition must be the same.'
                )
            )
        s3_service = request.context['s3_accesspoint'].get('service')
        if s3_service == 's3-object-lambda' and self._s3_config.get(
            'use_dualstack_endpoint'
        ):
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    'Client does not support s3 dualstack configuration '
                    'when an S3 Object Lambda access point ARN is specified.'
                )
            )
        outpost_name = request.context['s3_accesspoint'].get('outpost_name')
        if outpost_name and self._s3_config.get('use_dualstack_endpoint'):
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    'Client does not support s3 dualstack configuration '
                    'when an outpost ARN is specified.'
                )
            )
        self._validate_mrap_s3_config(request)

    def _validate_mrap_s3_config(self, request):
        if not is_global_accesspoint(request.context):
            return
        if self._s3_config.get('s3_disable_multiregion_access_points'):
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    'Invalid configuration, Multi-Region Access Point '
                    'ARNs are disabled.'
                )
            )
        elif self._s3_config.get('use_dualstack_endpoint'):
            raise UnsupportedS3AccesspointConfigurationError(
                msg=(
                    'Client does not support s3 dualstack configuration '
                    'when a Multi-Region Access Point ARN is specified.'
                )
            )

    def _resolve_region_for_accesspoint_endpoint(self, request):
        if is_global_accesspoint(request.context):
            # Requests going to MRAP endpoints MUST be set to any (*) region.
            self._override_signing_region(request, '*')
        elif self._s3_config.get('use_arn_region', True):
            accesspoint_region = request.context['s3_accesspoint']['region']
            # If we are using the region from the access point,
            # we will also want to make sure that we set it as the
            # signing region as well
            self._override_signing_region(request, accesspoint_region)
            return accesspoint_region
        return self._region

    def set_signer(self, context, **kwargs):
        if is_global_accesspoint(context):
            if HAS_CRT:
                return 's3v4a'
            else:
                raise MissingDependencyException(
                    msg="Using S3 with an MRAP arn requires an additional "
                    "dependency. You will need to pip install "
                    "botocore[crt] before proceeding."
                )

    def _resolve_signing_name_for_accesspoint_endpoint(self, request):
        accesspoint_service = request.context['s3_accesspoint']['service']
        self._override_signing_name(request.context, accesspoint_service)

    def _switch_to_accesspoint_endpoint(self, request, region_name):
        original_components = urlsplit(request.url)
        accesspoint_endpoint = urlunsplit(
            (
                original_components.scheme,
                self._get_netloc(request.context, region_name),
                self._get_accesspoint_path(
                    original_components.path, request.context
                ),
                original_components.query,
                '',
            )
        )
        logger.debug(
            f'Updating URI from {request.url} to {accesspoint_endpoint}'
        )
        request.url = accesspoint_endpoint

    def _get_netloc(self, request_context, region_name):
        if is_global_accesspoint(request_context):
            return self._get_mrap_netloc(request_context)
        else:
            return self._get_accesspoint_netloc(request_context, region_name)

    def _get_mrap_netloc(self, request_context):
        s3_accesspoint = request_context['s3_accesspoint']
        region_name = 's3-global'
        mrap_netloc_components = [s3_accesspoint['name']]
        if self._endpoint_url:
            endpoint_url_netloc = urlsplit(self._endpoint_url).netloc
            mrap_netloc_components.append(endpoint_url_netloc)
        else:
            partition = s3_accesspoint['partition']
            mrap_netloc_components.extend(
                [
                    'accesspoint',
                    region_name,
                    self._get_partition_dns_suffix(partition),
                ]
            )
        return '.'.join(mrap_netloc_components)

    def _get_accesspoint_netloc(self, request_context, region_name):
        s3_accesspoint = request_context['s3_accesspoint']
        accesspoint_netloc_components = [
            '{}-{}'.format(s3_accesspoint['name'], s3_accesspoint['account']),
        ]
        outpost_name = s3_accesspoint.get('outpost_name')
        if self._endpoint_url:
            if outpost_name:
                accesspoint_netloc_components.append(outpost_name)
            endpoint_url_netloc = urlsplit(self._endpoint_url).netloc
            accesspoint_netloc_components.append(endpoint_url_netloc)
        else:
            if outpost_name:
                outpost_host = [outpost_name, 's3-outposts']
                accesspoint_netloc_components.extend(outpost_host)
            elif s3_accesspoint['service'] == 's3-object-lambda':
                component = self._inject_fips_if_needed(
                    's3-object-lambda', request_context
                )
                accesspoint_netloc_components.append(component)
            else:
                component = self._inject_fips_if_needed(
                    's3-accesspoint', request_context
                )
                accesspoint_netloc_components.append(component)
            if self._s3_config.get('use_dualstack_endpoint'):
                accesspoint_netloc_components.append('dualstack')
            accesspoint_netloc_components.extend(
                [region_name, self._get_dns_suffix(region_name)]
            )
        return '.'.join(accesspoint_netloc_components)

    def _inject_fips_if_needed(self, component, request_context):
        if self._use_fips_endpoint:
            return f'{component}-fips'
        return component

    def _get_accesspoint_path(self, original_path, request_context):
        # The Bucket parameter was substituted with the access-point name as
        # some value was required in serializing the bucket name. Now that
        # we are making the request directly to the access point, we will
        # want to remove that access-point name from the path.
        name = request_context['s3_accesspoint']['name']
        # All S3 operations require at least a / in their path.
        return original_path.replace('/' + name, '', 1) or '/'

    def _get_partition_dns_suffix(self, partition_name):
        dns_suffix = self._endpoint_resolver.get_partition_dns_suffix(
            partition_name
        )
        if dns_suffix is None:
            dns_suffix = self._DEFAULT_DNS_SUFFIX
        return dns_suffix

    def _get_dns_suffix(self, region_name):
        resolved = self._endpoint_resolver.construct_endpoint(
            's3', region_name
        )
        dns_suffix = self._DEFAULT_DNS_SUFFIX
        if resolved and 'dnsSuffix' in resolved:
            dns_suffix = resolved['dnsSuffix']
        return dns_suffix

    def _override_signing_region(self, request, region_name):
        signing_context = request.context.get('signing', {})
        # S3SigV4Auth will use the context['signing']['region'] value to
        # sign with if present. This is used by the Bucket redirector
        # as well but we should be fine because the redirector is never
        # used in combination with the accesspoint setting logic.
        signing_context['region'] = region_name
        request.context['signing'] = signing_context

    def _override_signing_name(self, context, signing_name):
        signing_context = context.get('signing', {})
        # S3SigV4Auth will use the context['signing']['signing_name'] value to
        # sign with if present. This is used by the Bucket redirector
        # as well but we should be fine because the redirector is never
        # used in combination with the accesspoint setting logic.
        signing_context['signing_name'] = signing_name
        context['signing'] = signing_context

    @CachedProperty
    def _use_accelerate_endpoint(self):
        # Enable accelerate if the configuration is set to to true or the
        # endpoint being used matches one of the accelerate endpoints.

        # Accelerate has been explicitly configured.
        if self._s3_config.get('use_accelerate_endpoint'):
            return True

        # Accelerate mode is turned on automatically if an endpoint url is
        # provided that matches the accelerate scheme.
        if self._endpoint_url is None:
            return False

        # Accelerate is only valid for Amazon endpoints.
        netloc = urlsplit(self._endpoint_url).netloc
        if not netloc.endswith('amazonaws.com'):
            return False

        # The first part of the url should always be s3-accelerate.
        parts = netloc.split('.')
        if parts[0] != 's3-accelerate':
            return False

        # Url parts between 's3-accelerate' and 'amazonaws.com' which
        # represent different url features.
        feature_parts = parts[1:-2]

        # There should be no duplicate url parts.
        if len(feature_parts) != len(set(feature_parts)):
            return False

        # Remaining parts must all be in the whitelist.
        return all(p in S3_ACCELERATE_WHITELIST for p in feature_parts)

    @CachedProperty
    def _addressing_style(self):
        # Use virtual host style addressing if accelerate is enabled or if
        # the given endpoint url is an accelerate endpoint.
        if self._use_accelerate_endpoint:
            return 'virtual'

        # If a particular addressing style is configured, use it.
        configured_addressing_style = self._s3_config.get('addressing_style')
        if configured_addressing_style:
            return configured_addressing_style

    @CachedProperty
    def _s3_addressing_handler(self):
        # If virtual host style was configured, use it regardless of whether
        # or not the bucket looks dns compatible.
        if self._addressing_style == 'virtual':
            logger.debug("Using S3 virtual host style addressing.")
            return switch_to_virtual_host_style

        # If path style is configured, no additional steps are needed. If
        # endpoint_url was specified, don't default to virtual. We could
        # potentially default provided endpoint urls to virtual hosted
        # style, but for now it is avoided.
        if self._addressing_style == 'path' or self._endpoint_url is not None:
            logger.debug("Using S3 path style addressing.")
            return None

        logger.debug(
            "Defaulting to S3 virtual host style addressing with "
            "path style addressing fallback."
        )

        # By default, try to use virtual style with path fallback.
        return fix_s3_host


class S3ControlEndpointSetter:
    _DEFAULT_PARTITION = 'aws'
    _DEFAULT_DNS_SUFFIX = 'amazonaws.com'
    _HOST_LABEL_REGEX = re.compile(r'^[a-zA-Z0-9\-]{1,63}$')

    def __init__(
        self,
        endpoint_resolver,
        region=None,
        s3_config=None,
        endpoint_url=None,
        partition=None,
        use_fips_endpoint=False,
    ):
        self._endpoint_resolver = endpoint_resolver
        self._region = region
        self._s3_config = s3_config
        self._use_fips_endpoint = use_fips_endpoint
        if s3_config is None:
            self._s3_config = {}
        self._endpoint_url = endpoint_url
        self._partition = partition
        if partition is None:
            self._partition = self._DEFAULT_PARTITION

    def register(self, event_emitter):
        event_emitter.register('before-sign.s3-control', self.set_endpoint)

    def set_endpoint(self, request, **kwargs):
        if self._use_endpoint_from_arn_details(request):
            self._validate_endpoint_from_arn_details_supported(request)
            region_name = self._resolve_region_from_arn_details(request)
            self._resolve_signing_name_from_arn_details(request)
            self._resolve_endpoint_from_arn_details(request, region_name)
            self._add_headers_from_arn_details(request)
        elif self._use_endpoint_from_outpost_id(request):
            self._validate_outpost_redirection_valid(request)
            self._override_signing_name(request, 's3-outposts')
            new_netloc = self._construct_outpost_endpoint(self._region)
            self._update_request_netloc(request, new_netloc)

    def _use_endpoint_from_arn_details(self, request):
        return 'arn_details' in request.context

    def _use_endpoint_from_outpost_id(self, request):
        return 'outpost_id' in request.context

    def _validate_endpoint_from_arn_details_supported(self, request):
        if 'fips' in request.context['arn_details']['region']:
            raise UnsupportedS3ControlArnError(
                arn=request.context['arn_details']['original'],
                msg='Invalid ARN, FIPS region not allowed in ARN.',
            )
        if not self._s3_config.get('use_arn_region', False):
            arn_region = request.context['arn_details']['region']
            if arn_region != self._region:
                error_msg = (
                    'The use_arn_region configuration is disabled but '
                    f'received arn for "{arn_region}" when the client is configured '
                    f'to use "{self._region}"'
                )
                raise UnsupportedS3ControlConfigurationError(msg=error_msg)
        request_partion = request.context['arn_details']['partition']
        if request_partion != self._partition:
            raise UnsupportedS3ControlConfigurationError(
                msg=(
                    f'Client is configured for "{self._partition}" partition, but arn '
                    f'provided is for "{request_partion}" partition. The client and '
                    'arn partition must be the same.'
                )
            )
        if self._s3_config.get('use_accelerate_endpoint'):
            raise UnsupportedS3ControlConfigurationError(
                msg='S3 control client does not support accelerate endpoints',
            )
        if 'outpost_name' in request.context['arn_details']:
            self._validate_outpost_redirection_valid(request)

    def _validate_outpost_redirection_valid(self, request):
        if self._s3_config.get('use_dualstack_endpoint'):
            raise UnsupportedS3ControlConfigurationError(
                msg=(
                    'Client does not support s3 dualstack configuration '
                    'when an outpost is specified.'
                )
            )

    def _resolve_region_from_arn_details(self, request):
        if self._s3_config.get('use_arn_region', False):
            arn_region = request.context['arn_details']['region']
            # If we are using the region from the expanded arn, we will also
            # want to make sure that we set it as the signing region as well
            self._override_signing_region(request, arn_region)
            return arn_region
        return self._region

    def _resolve_signing_name_from_arn_details(self, request):
        arn_service = request.context['arn_details']['service']
        self._override_signing_name(request, arn_service)
        return arn_service

    def _resolve_endpoint_from_arn_details(self, request, region_name):
        new_netloc = self._resolve_netloc_from_arn_details(
            request, region_name
        )
        self._update_request_netloc(request, new_netloc)

    def _update_request_netloc(self, request, new_netloc):
        original_components = urlsplit(request.url)
        arn_details_endpoint = urlunsplit(
            (
                original_components.scheme,
                new_netloc,
                original_components.path,
                original_components.query,
                '',
            )
        )
        logger.debug(
            f'Updating URI from {request.url} to {arn_details_endpoint}'
        )
        request.url = arn_details_endpoint

    def _resolve_netloc_from_arn_details(self, request, region_name):
        arn_details = request.context['arn_details']
        if 'outpost_name' in arn_details:
            return self._construct_outpost_endpoint(region_name)
        account = arn_details['account']
        return self._construct_s3_control_endpoint(region_name, account)

    def _is_valid_host_label(self, label):
        return self._HOST_LABEL_REGEX.match(label)

    def _validate_host_labels(self, *labels):
        for label in labels:
            if not self._is_valid_host_label(label):
                raise InvalidHostLabelError(label=label)

    def _construct_s3_control_endpoint(self, region_name, account):
        self._validate_host_labels(region_name, account)
        if self._endpoint_url:
            endpoint_url_netloc = urlsplit(self._endpoint_url).netloc
            netloc = [account, endpoint_url_netloc]
        else:
            netloc = [
                account,
                's3-control',
            ]
            self._add_dualstack(netloc)
            dns_suffix = self._get_dns_suffix(region_name)
            netloc.extend([region_name, dns_suffix])
        return self._construct_netloc(netloc)

    def _construct_outpost_endpoint(self, region_name):
        self._validate_host_labels(region_name)
        if self._endpoint_url:
            return urlsplit(self._endpoint_url).netloc
        else:
            netloc = [
                's3-outposts',
                region_name,
                self._get_dns_suffix(region_name),
            ]
            self._add_fips(netloc)
        return self._construct_netloc(netloc)

    def _construct_netloc(self, netloc):
        return '.'.join(netloc)

    def _add_fips(self, netloc):
        if self._use_fips_endpoint:
            netloc[0] = netloc[0] + '-fips'

    def _add_dualstack(self, netloc):
        if self._s3_config.get('use_dualstack_endpoint'):
            netloc.append('dualstack')

    def _get_dns_suffix(self, region_name):
        resolved = self._endpoint_resolver.construct_endpoint(
            's3', region_name
        )
        dns_suffix = self._DEFAULT_DNS_SUFFIX
        if resolved and 'dnsSuffix' in resolved:
            dns_suffix = resolved['dnsSuffix']
        return dns_suffix

    def _override_signing_region(self, request, region_name):
        signing_context = request.context.get('signing', {})
        # S3SigV4Auth will use the context['signing']['region'] value to
        # sign with if present. This is used by the Bucket redirector
        # as well but we should be fine because the redirector is never
        # used in combination with the accesspoint setting logic.
        signing_context['region'] = region_name
        request.context['signing'] = signing_context

    def _override_signing_name(self, request, signing_name):
        signing_context = request.context.get('signing', {})
        # S3SigV4Auth will use the context['signing']['signing_name'] value to
        # sign with if present. This is used by the Bucket redirector
        # as well but we should be fine because the redirector is never
        # used in combination with the accesspoint setting logic.
        signing_context['signing_name'] = signing_name
        request.context['signing'] = signing_context

    def _add_headers_from_arn_details(self, request):
        arn_details = request.context['arn_details']
        outpost_name = arn_details.get('outpost_name')
        if outpost_name:
            self._add_outpost_id_header(request, outpost_name)

    def _add_outpost_id_header(self, request, outpost_name):
        request.headers['x-amz-outpost-id'] = outpost_name


class S3ControlArnParamHandler:
    """This handler has been replaced by S3ControlArnParamHandlerv2. The
    original version remains in place for any third-party importers.
    """

    _RESOURCE_SPLIT_REGEX = re.compile(r'[/:]')

    def __init__(self, arn_parser=None):
        self._arn_parser = arn_parser
        if arn_parser is None:
            self._arn_parser = ArnParser()
        warnings.warn(
            'The S3ControlArnParamHandler class has been deprecated for a new '
            'internal replacement. A future version of botocore may remove '
            'this class.',
            category=FutureWarning,
        )

    def register(self, event_emitter):
        event_emitter.register(
            'before-parameter-build.s3-control',
            self.handle_arn,
        )

    def handle_arn(self, params, model, context, **kwargs):
        if model.name in ('CreateBucket', 'ListRegionalBuckets'):
            # CreateBucket and ListRegionalBuckets are special cases that do
            # not obey ARN based redirection but will redirect based off of the
            # presence of the OutpostId parameter
            self._handle_outpost_id_param(params, model, context)
        else:
            self._handle_name_param(params, model, context)
            self._handle_bucket_param(params, model, context)

    def _get_arn_details_from_param(self, params, param_name):
        if param_name not in params:
            return None
        try:
            arn = params[param_name]
            arn_details = self._arn_parser.parse_arn(arn)
            arn_details['original'] = arn
            arn_details['resources'] = self._split_resource(arn_details)
            return arn_details
        except InvalidArnException:
            return None

    def _split_resource(self, arn_details):
        return self._RESOURCE_SPLIT_REGEX.split(arn_details['resource'])

    def _override_account_id_param(self, params, arn_details):
        account_id = arn_details['account']
        if 'AccountId' in params and params['AccountId'] != account_id:
            error_msg = (
                'Account ID in arn does not match the AccountId parameter '
                'provided: "{}"'
            ).format(params['AccountId'])
            raise UnsupportedS3ControlArnError(
                arn=arn_details['original'],
                msg=error_msg,
            )
        params['AccountId'] = account_id

    def _handle_outpost_id_param(self, params, model, context):
        if 'OutpostId' not in params:
            return
        context['outpost_id'] = params['OutpostId']

    def _handle_name_param(self, params, model, context):
        # CreateAccessPoint is a special case that does not expand Name
        if model.name == 'CreateAccessPoint':
            return
        arn_details = self._get_arn_details_from_param(params, 'Name')
        if arn_details is None:
            return
        if self._is_outpost_accesspoint(arn_details):
            self._store_outpost_accesspoint(params, context, arn_details)
        else:
            error_msg = 'The Name parameter does not support the provided ARN'
            raise UnsupportedS3ControlArnError(
                arn=arn_details['original'],
                msg=error_msg,
            )

    def _is_outpost_accesspoint(self, arn_details):
        if arn_details['service'] != 's3-outposts':
            return False
        resources = arn_details['resources']
        if len(resources) != 4:
            return False
        # Resource must be of the form outpost/op-123/accesspoint/name
        return resources[0] == 'outpost' and resources[2] == 'accesspoint'

    def _store_outpost_accesspoint(self, params, context, arn_details):
        self._override_account_id_param(params, arn_details)
        accesspoint_name = arn_details['resources'][3]
        params['Name'] = accesspoint_name
        arn_details['accesspoint_name'] = accesspoint_name
        arn_details['outpost_name'] = arn_details['resources'][1]
        context['arn_details'] = arn_details

    def _handle_bucket_param(self, params, model, context):
        arn_details = self._get_arn_details_from_param(params, 'Bucket')
        if arn_details is None:
            return
        if self._is_outpost_bucket(arn_details):
            self._store_outpost_bucket(params, context, arn_details)
        else:
            error_msg = (
                'The Bucket parameter does not support the provided ARN'
            )
            raise UnsupportedS3ControlArnError(
                arn=arn_details['original'],
                msg=error_msg,
            )

    def _is_outpost_bucket(self, arn_details):
        if arn_details['service'] != 's3-outposts':
            return False
        resources = arn_details['resources']
        if len(resources) != 4:
            return False
        # Resource must be of the form outpost/op-123/bucket/name
        return resources[0] == 'outpost' and resources[2] == 'bucket'

    def _store_outpost_bucket(self, params, context, arn_details):
        self._override_account_id_param(params, arn_details)
        bucket_name = arn_details['resources'][3]
        params['Bucket'] = bucket_name
        arn_details['bucket_name'] = bucket_name
        arn_details['outpost_name'] = arn_details['resources'][1]
        context['arn_details'] = arn_details


class S3ControlArnParamHandlerv2(S3ControlArnParamHandler):
    """Updated version of S3ControlArnParamHandler for use when
    EndpointRulesetResolver is in use for endpoint resolution.

    This class is considered private and subject to abrupt breaking changes or
    removal without prior announcement. Please do not use it directly.
    """

    def __init__(self, arn_parser=None):
        self._arn_parser = arn_parser
        if arn_parser is None:
            self._arn_parser = ArnParser()

    def register(self, event_emitter):
        event_emitter.register(
            'before-endpoint-resolution.s3-control',
            self.handle_arn,
        )

    def _handle_name_param(self, params, model, context):
        # CreateAccessPoint is a special case that does not expand Name
        if model.name == 'CreateAccessPoint':
            return
        arn_details = self._get_arn_details_from_param(params, 'Name')
        if arn_details is None:
            return
        self._raise_for_fips_pseudo_region(arn_details)
        self._raise_for_accelerate_endpoint(context)
        if self._is_outpost_accesspoint(arn_details):
            self._store_outpost_accesspoint(params, context, arn_details)
        else:
            error_msg = 'The Name parameter does not support the provided ARN'
            raise UnsupportedS3ControlArnError(
                arn=arn_details['original'],
                msg=error_msg,
            )

    def _store_outpost_accesspoint(self, params, context, arn_details):
        self._override_account_id_param(params, arn_details)

    def _handle_bucket_param(self, params, model, context):
        arn_details = self._get_arn_details_from_param(params, 'Bucket')
        if arn_details is None:
            return
        self._raise_for_fips_pseudo_region(arn_details)
        self._raise_for_accelerate_endpoint(context)
        if self._is_outpost_bucket(arn_details):
            self._store_outpost_bucket(params, context, arn_details)
        else:
            error_msg = (
                'The Bucket parameter does not support the provided ARN'
            )
            raise UnsupportedS3ControlArnError(
                arn=arn_details['original'],
                msg=error_msg,
            )

    def _store_outpost_bucket(self, params, context, arn_details):
        self._override_account_id_param(params, arn_details)

    def _raise_for_fips_pseudo_region(self, arn_details):
        # FIPS pseudo region names cannot be used in ARNs
        arn_region = arn_details['region']
        if arn_region.startswith('fips-') or arn_region.endswith('fips-'):
            raise UnsupportedS3ControlArnError(
                arn=arn_details['original'],
                msg='Invalid ARN, FIPS region not allowed in ARN.',
            )

    def _raise_for_accelerate_endpoint(self, context):
        s3_config = context['client_config'].s3 or {}
        if s3_config.get('use_accelerate_endpoint'):
            raise UnsupportedS3ControlConfigurationError(
                msg='S3 control client does not support accelerate endpoints',
            )


class ContainerMetadataFetcher:
    TIMEOUT_SECONDS = 2
    RETRY_ATTEMPTS = 3
    SLEEP_TIME = 1
    IP_ADDRESS = '169.254.170.2'
    _ALLOWED_HOSTS = [
        IP_ADDRESS,
        '169.254.170.23',
        'fd00:ec2::23',
        'localhost',
    ]

    def __init__(self, session=None, sleep=time.sleep):
        if session is None:
            session = botocore.httpsession.URLLib3Session(
                timeout=self.TIMEOUT_SECONDS
            )
        self._session = session
        self._sleep = sleep

    def retrieve_full_uri(self, full_url, headers=None):
        """Retrieve JSON metadata from container metadata.

        :type full_url: str
        :param full_url: The full URL of the metadata service.
            This should include the scheme as well, e.g
            "http://localhost:123/foo"

        """
        self._validate_allowed_url(full_url)
        return self._retrieve_credentials(full_url, headers)

    def _validate_allowed_url(self, full_url):
        parsed = botocore.compat.urlparse(full_url)
        if self._is_loopback_address(parsed.hostname):
            return
        is_whitelisted_host = self._check_if_whitelisted_host(parsed.hostname)
        if not is_whitelisted_host:
            raise ValueError(
                f"Unsupported host '{parsed.hostname}'.  Can only retrieve metadata "
                f"from a loopback address or one of these hosts: {', '.join(self._ALLOWED_HOSTS)}"
            )

    def _is_loopback_address(self, hostname):
        try:
            ip = ip_address(hostname)
            return ip.is_loopback
        except ValueError:
            return False

    def _check_if_whitelisted_host(self, host):
        if host in self._ALLOWED_HOSTS:
            return True
        return False

    def retrieve_uri(self, relative_uri):
        """Retrieve JSON metadata from container metadata.

        :type relative_uri: str
        :param relative_uri: A relative URI, e.g "/foo/bar?id=123"

        :return: The parsed JSON response.

        """
        full_url = self.full_url(relative_uri)
        return self._retrieve_credentials(full_url)

    def _retrieve_credentials(self, full_url, extra_headers=None):
        headers = {'Accept': 'application/json'}
        if extra_headers is not None:
            headers.update(extra_headers)
        attempts = 0
        while True:
            try:
                return self._get_response(
                    full_url, headers, self.TIMEOUT_SECONDS
                )
            except MetadataRetrievalError as e:
                logger.debug(
                    "Received error when attempting to retrieve "
                    "container metadata: %s",
                    e,
                    exc_info=True,
                )
                self._sleep(self.SLEEP_TIME)
                attempts += 1
                if attempts >= self.RETRY_ATTEMPTS:
                    raise

    def _get_response(self, full_url, headers, timeout):
        try:
            AWSRequest = botocore.awsrequest.AWSRequest
            request = AWSRequest(method='GET', url=full_url, headers=headers)
            response = self._session.send(request.prepare())
            response_text = response.content.decode('utf-8')
            if response.status_code != 200:
                raise MetadataRetrievalError(
                    error_msg=(
                        f"Received non 200 response {response.status_code} "
                        f"from container metadata: {response_text}"
                    )
                )
            try:
                return json.loads(response_text)
            except ValueError:
                error_msg = "Unable to parse JSON returned from container metadata services"
                logger.debug('%s:%s', error_msg, response_text)
                raise MetadataRetrievalError(error_msg=error_msg)
        except RETRYABLE_HTTP_ERRORS as e:
            error_msg = (
                "Received error when attempting to retrieve "
                f"container metadata: {e}"
            )
            raise MetadataRetrievalError(error_msg=error_msg)

    def full_url(self, relative_uri):
        return f'http://{self.IP_ADDRESS}{relative_uri}'


def get_environ_proxies(url):
    if should_bypass_proxies(url):
        return {}
    else:
        return getproxies()


def should_bypass_proxies(url):
    """
    Returns whether we should bypass proxies or not.
    """
    # NOTE: requests allowed for ip/cidr entries in no_proxy env that we don't
    # support current as urllib only checks DNS suffix
    # If the system proxy settings indicate that this URL should be bypassed,
    # don't proxy.
    # The proxy_bypass function is incredibly buggy on OS X in early versions
    # of Python 2.6, so allow this call to fail. Only catch the specific
    # exceptions we've seen, though: this call failing in other ways can reveal
    # legitimate problems.
    try:
        if proxy_bypass(urlparse(url).netloc):
            return True
    except (TypeError, socket.gaierror):
        pass

    return False


def determine_content_length(body):
    # No body, content length of 0
    if not body:
        return 0

    # Try asking the body for it's length
    try:
        return len(body)
    except (AttributeError, TypeError):
        pass

    # Try getting the length from a seekable stream
    if hasattr(body, 'seek') and hasattr(body, 'tell'):
        try:
            orig_pos = body.tell()
            body.seek(0, 2)
            end_file_pos = body.tell()
            body.seek(orig_pos)
            return end_file_pos - orig_pos
        except io.UnsupportedOperation:
            # in case when body is, for example, io.BufferedIOBase object
            # it has "seek" method which throws "UnsupportedOperation"
            # exception in such case we want to fall back to "chunked"
            # encoding
            pass
    # Failed to determine the length
    return None


def get_encoding_from_headers(headers, default='ISO-8859-1'):
    """Returns encodings from given HTTP Header Dict.

    :param headers: dictionary to extract encoding from.
    :param default: default encoding if the content-type is text
    """

    content_type = headers.get('content-type')

    if not content_type:
        return None

    message = email.message.Message()
    message['content-type'] = content_type
    charset = message.get_param("charset")

    if charset is not None:
        return charset

    if 'text' in content_type:
        return default


def calculate_md5(body, **kwargs):
    if isinstance(body, (bytes, bytearray)):
        binary_md5 = _calculate_md5_from_bytes(body)
    else:
        binary_md5 = _calculate_md5_from_file(body)
    return base64.b64encode(binary_md5).decode('ascii')


def _calculate_md5_from_bytes(body_bytes):
    md5 = get_md5(body_bytes)
    return md5.digest()


def _calculate_md5_from_file(fileobj):
    start_position = fileobj.tell()
    md5 = get_md5()
    for chunk in iter(lambda: fileobj.read(1024 * 1024), b''):
        md5.update(chunk)
    fileobj.seek(start_position)
    return md5.digest()


def _is_s3express_request(params):
    endpoint_properties = params.get('context', {}).get(
        'endpoint_properties', {}
    )
    return endpoint_properties.get('backend') == 'S3Express'


def _has_checksum_header(params):
    headers = params['headers']
    # If a user provided Content-MD5 is present,
    # don't try to compute a new one.
    if 'Content-MD5' in headers:
        return True

    # If a header matching the x-amz-checksum-* pattern is present, we
    # assume a checksum has already been provided and an md5 is not needed
    for header in headers:
        if CHECKSUM_HEADER_PATTERN.match(header):
            return True

    return False


def conditionally_calculate_checksum(params, **kwargs):
    if not _has_checksum_header(params):
        conditionally_calculate_md5(params, **kwargs)
        conditionally_enable_crc32(params, **kwargs)


def conditionally_enable_crc32(params, **kwargs):
    checksum_context = params.get('context', {}).get('checksum', {})
    checksum_algorithm = checksum_context.get('request_algorithm')
    if (
        _is_s3express_request(params)
        and params['body'] is not None
        and checksum_algorithm in (None, "conditional-md5")
    ):
        params['context']['checksum'] = {
            'request_algorithm': {
                'algorithm': 'crc32',
                'in': 'header',
                'name': 'x-amz-checksum-crc32',
            }
        }


def conditionally_calculate_md5(params, **kwargs):
    """Only add a Content-MD5 if the system supports it."""
    body = params['body']
    checksum_context = params.get('context', {}).get('checksum', {})
    checksum_algorithm = checksum_context.get('request_algorithm')
    if checksum_algorithm and checksum_algorithm != 'conditional-md5':
        # Skip for requests that will have a flexible checksum applied
        return

    if _has_checksum_header(params):
        # Don't add a new header if one is already available.
        return

    if _is_s3express_request(params):
        # S3Express doesn't support MD5
        return

    if MD5_AVAILABLE and body is not None:
        md5_digest = calculate_md5(body, **kwargs)
        params['headers']['Content-MD5'] = md5_digest


class FileWebIdentityTokenLoader:
    def __init__(self, web_identity_token_path, _open=open):
        self._web_identity_token_path = web_identity_token_path
        self._open = _open

    def __call__(self):
        with self._open(self._web_identity_token_path) as token_file:
            return token_file.read()


class SSOTokenLoader:
    def __init__(self, cache=None):
        if cache is None:
            cache = {}
        self._cache = cache

    def _generate_cache_key(self, start_url, session_name):
        input_str = start_url
        if session_name is not None:
            input_str = session_name
        return hashlib.sha1(input_str.encode('utf-8')).hexdigest()

    def save_token(self, start_url, token, session_name=None):
        cache_key = self._generate_cache_key(start_url, session_name)
        self._cache[cache_key] = token

    def __call__(self, start_url, session_name=None):
        cache_key = self._generate_cache_key(start_url, session_name)
        logger.debug(f'Checking for cached token at: {cache_key}')
        if cache_key not in self._cache:
            name = start_url
            if session_name is not None:
                name = session_name
            error_msg = f'Token for {name} does not exist'
            raise SSOTokenLoadError(error_msg=error_msg)

        token = self._cache[cache_key]
        if 'accessToken' not in token or 'expiresAt' not in token:
            error_msg = f'Token for {start_url} is invalid'
            raise SSOTokenLoadError(error_msg=error_msg)
        return token


class EventbridgeSignerSetter:
    _DEFAULT_PARTITION = 'aws'
    _DEFAULT_DNS_SUFFIX = 'amazonaws.com'

    def __init__(self, endpoint_resolver, region=None, endpoint_url=None):
        self._endpoint_resolver = endpoint_resolver
        self._region = region
        self._endpoint_url = endpoint_url

    def register(self, event_emitter):
        event_emitter.register(
            'before-parameter-build.events.PutEvents',
            self.check_for_global_endpoint,
        )
        event_emitter.register(
            'before-call.events.PutEvents', self.set_endpoint_url
        )

    def set_endpoint_url(self, params, context, **kwargs):
        if 'eventbridge_endpoint' in context:
            endpoint = context['eventbridge_endpoint']
            logger.debug(f"Rewriting URL from {params['url']} to {endpoint}")
            params['url'] = endpoint

    def check_for_global_endpoint(self, params, context, **kwargs):
        endpoint = params.get('EndpointId')
        if endpoint is None:
            return

        if len(endpoint) == 0:
            raise InvalidEndpointConfigurationError(
                msg='EndpointId must not be a zero length string'
            )

        if not HAS_CRT:
            raise MissingDependencyException(
                msg="Using EndpointId requires an additional "
                "dependency. You will need to pip install "
                "botocore[crt] before proceeding."
            )

        config = context.get('client_config')
        endpoint_variant_tags = None
        if config is not None:
            if config.use_fips_endpoint:
                raise InvalidEndpointConfigurationError(
                    msg="FIPS is not supported with EventBridge "
                    "multi-region endpoints."
                )
            if config.use_dualstack_endpoint:
                endpoint_variant_tags = ['dualstack']

        if self._endpoint_url is None:
            # Validate endpoint is a valid hostname component
            parts = urlparse(f'https://{endpoint}')
            if parts.hostname != endpoint:
                raise InvalidEndpointConfigurationError(
                    msg='EndpointId is not a valid hostname component.'
                )
            resolved_endpoint = self._get_global_endpoint(
                endpoint, endpoint_variant_tags=endpoint_variant_tags
            )
        else:
            resolved_endpoint = self._endpoint_url

        context['eventbridge_endpoint'] = resolved_endpoint
        context['auth_type'] = 'v4a'

    def _get_global_endpoint(self, endpoint, endpoint_variant_tags=None):
        resolver = self._endpoint_resolver

        partition = resolver.get_partition_for_region(self._region)
        if partition is None:
            partition = self._DEFAULT_PARTITION
        dns_suffix = resolver.get_partition_dns_suffix(
            partition, endpoint_variant_tags=endpoint_variant_tags
        )
        if dns_suffix is None:
            dns_suffix = self._DEFAULT_DNS_SUFFIX

        return f"https://{endpoint}.endpoint.events.{dns_suffix}/"


def is_s3_accelerate_url(url):
    """Does the URL match the S3 Accelerate endpoint scheme?

    Virtual host naming style with bucket names in the netloc part of the URL
    are not allowed by this function.
    """
    if url is None:
        return False

    # Accelerate is only valid for Amazon endpoints.
    url_parts = urlsplit(url)
    if not url_parts.netloc.endswith(
        'amazonaws.com'
    ) or url_parts.scheme not in ['https', 'http']:
        return False

    # The first part of the URL must be s3-accelerate.
    parts = url_parts.netloc.split('.')
    if parts[0] != 's3-accelerate':
        return False

    # Url parts between 's3-accelerate' and 'amazonaws.com' which
    # represent different url features.
    feature_parts = parts[1:-2]

    # There should be no duplicate URL parts.
    if len(feature_parts) != len(set(feature_parts)):
        return False

    # Remaining parts must all be in the whitelist.
    return all(p in S3_ACCELERATE_WHITELIST for p in feature_parts)


class JSONFileCache:
    """JSON file cache.
    This provides a dict like interface that stores JSON serializable
    objects.
    The objects are serialized to JSON and stored in a file.  These
    values can be retrieved at a later time.
    """

    CACHE_DIR = os.path.expanduser(os.path.join('~', '.aws', 'boto', 'cache'))

    def __init__(self, working_dir=CACHE_DIR, dumps_func=None):
        self._working_dir = working_dir
        if dumps_func is None:
            dumps_func = self._default_dumps
        self._dumps = dumps_func

    def _default_dumps(self, obj):
        return json.dumps(obj, default=self._serialize_if_needed)

    def __contains__(self, cache_key):
        actual_key = self._convert_cache_key(cache_key)
        return os.path.isfile(actual_key)

    def __getitem__(self, cache_key):
        """Retrieve value from a cache key."""
        actual_key = self._convert_cache_key(cache_key)
        try:
            with open(actual_key) as f:
                return json.load(f)
        except (OSError, ValueError):
            raise KeyError(cache_key)

    def __delitem__(self, cache_key):
        actual_key = self._convert_cache_key(cache_key)
        try:
            key_path = Path(actual_key)
            key_path.unlink()
        except FileNotFoundError:
            raise KeyError(cache_key)

    def __setitem__(self, cache_key, value):
        full_key = self._convert_cache_key(cache_key)
        try:
            file_content = self._dumps(value)
        except (TypeError, ValueError):
            raise ValueError(
                f"Value cannot be cached, must be "
                f"JSON serializable: {value}"
            )
        if not os.path.isdir(self._working_dir):
            os.makedirs(self._working_dir)
        with os.fdopen(
            os.open(full_key, os.O_WRONLY | os.O_CREAT, 0o600), 'w'
        ) as f:
            f.truncate()
            f.write(file_content)

    def _convert_cache_key(self, cache_key):
        full_path = os.path.join(self._working_dir, cache_key + '.json')
        return full_path

    def _serialize_if_needed(self, value, iso=False):
        if isinstance(value, _DatetimeClass):
            if iso:
                return value.isoformat()
            return value.strftime('%Y-%m-%dT%H:%M:%S%Z')
        return value


def is_s3express_bucket(bucket):
    if bucket is None:
        return False
    return bucket.endswith('--x-s3')


# This parameter is not part of the public interface and is subject to abrupt
# breaking changes or removal without prior announcement.
# Mapping of services that have been renamed for backwards compatibility reasons.
# Keys are the previous name that should be allowed, values are the documented
# and preferred client name.
SERVICE_NAME_ALIASES = {'runtime.sagemaker': 'sagemaker-runtime'}


# This parameter is not part of the public interface and is subject to abrupt
# breaking changes or removal without prior announcement.
# Mapping to determine the service ID for services that do not use it as the
# model data directory name. The keys are the data directory name and the
# values are the transformed service IDs (lower case and hyphenated).
CLIENT_NAME_TO_HYPHENIZED_SERVICE_ID_OVERRIDES = {
    # Actual service name we use -> Allowed computed service name.
    'apigateway': 'api-gateway',
    'application-autoscaling': 'application-auto-scaling',
    'appmesh': 'app-mesh',
    'autoscaling': 'auto-scaling',
    'autoscaling-plans': 'auto-scaling-plans',
    'ce': 'cost-explorer',
    'cloudhsmv2': 'cloudhsm-v2',
    'cloudsearchdomain': 'cloudsearch-domain',
    'cognito-idp': 'cognito-identity-provider',
    'config': 'config-service',
    'cur': 'cost-and-usage-report-service',
    'datapipeline': 'data-pipeline',
    'directconnect': 'direct-connect',
    'devicefarm': 'device-farm',
    'discovery': 'application-discovery-service',
    'dms': 'database-migration-service',
    'ds': 'directory-service',
    'dynamodbstreams': 'dynamodb-streams',
    'elasticbeanstalk': 'elastic-beanstalk',
    'elastictranscoder': 'elastic-transcoder',
    'elb': 'elastic-load-balancing',
    'elbv2': 'elastic-load-balancing-v2',
    'es': 'elasticsearch-service',
    'events': 'eventbridge',
    'globalaccelerator': 'global-accelerator',
    'iot-data': 'iot-data-plane',
    'iot-jobs-data': 'iot-jobs-data-plane',
    'iot1click-devices': 'iot-1click-devices-service',
    'iot1click-projects': 'iot-1click-projects',
    'iotevents-data': 'iot-events-data',
    'iotevents': 'iot-events',
    'iotwireless': 'iot-wireless',
    'kinesisanalytics': 'kinesis-analytics',
    'kinesisanalyticsv2': 'kinesis-analytics-v2',
    'kinesisvideo': 'kinesis-video',
    'lex-models': 'lex-model-building-service',
    'lexv2-models': 'lex-models-v2',
    'lex-runtime': 'lex-runtime-service',
    'lexv2-runtime': 'lex-runtime-v2',
    'logs': 'cloudwatch-logs',
    'machinelearning': 'machine-learning',
    'marketplacecommerceanalytics': 'marketplace-commerce-analytics',
    'marketplace-entitlement': 'marketplace-entitlement-service',
    'meteringmarketplace': 'marketplace-metering',
    'mgh': 'migration-hub',
    'sms-voice': 'pinpoint-sms-voice',
    'resourcegroupstaggingapi': 'resource-groups-tagging-api',
    'route53': 'route-53',
    'route53domains': 'route-53-domains',
    's3control': 's3-control',
    'sdb': 'simpledb',
    'secretsmanager': 'secrets-manager',
    'serverlessrepo': 'serverlessapplicationrepository',
    'servicecatalog': 'service-catalog',
    'servicecatalog-appregistry': 'service-catalog-appregistry',
    'stepfunctions': 'sfn',
    'storagegateway': 'storage-gateway',
}
