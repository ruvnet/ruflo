# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""External Account Credentials.

This module provides credentials that exchange workload identity pool external
credentials for Google access tokens. This facilitates accessing Google Cloud
Platform resources from on-prem and non-Google Cloud platforms (e.g. AWS,
Microsoft Azure, OIDC identity providers), using native credentials retrieved
from the current environment without the need to copy, save and manage
long-lived service account credentials.

Specifically, this is intended to use access tokens acquired using the GCP STS
token exchange endpoint following the `OAuth 2.0 Token Exchange`_ spec.

.. _OAuth 2.0 Token Exchange: https://tools.ietf.org/html/rfc8693
"""

import abc
import copy
from dataclasses import dataclass
import datetime
import functools
import io
import json
import re

from google.auth import _helpers
from google.auth import credentials
from google.auth import exceptions
from google.auth import impersonated_credentials
from google.auth import metrics
from google.oauth2 import sts
from google.oauth2 import utils

# External account JSON type identifier.
_EXTERNAL_ACCOUNT_JSON_TYPE = "external_account"
# The token exchange grant_type used for exchanging credentials.
_STS_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange"
# The token exchange requested_token_type. This is always an access_token.
_STS_REQUESTED_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"
# Cloud resource manager URL used to retrieve project information.
_CLOUD_RESOURCE_MANAGER = "https://cloudresourcemanager.googleapis.com/v1/projects/"
# Default Google sts token url.
_DEFAULT_TOKEN_URL = "https://sts.{universe_domain}/v1/token"


@dataclass
class SupplierContext:
    """A context class that contains information about the requested third party credential that is passed
        to AWS security credential and subject token suppliers.

        Attributes:
            subject_token_type (str): The requested subject token type based on the Oauth2.0 token exchange spec.
                Expected values include::

                    “urn:ietf:params:oauth:token-type:jwt”
                    “urn:ietf:params:oauth:token-type:id-token”
                    “urn:ietf:params:oauth:token-type:saml2”
                    “urn:ietf:params:aws:token-type:aws4_request”

            audience (str): The requested audience for the subject token.
    """

    subject_token_type: str
    audience: str


class Credentials(
    credentials.Scoped,
    credentials.CredentialsWithQuotaProject,
    credentials.CredentialsWithTokenUri,
    metaclass=abc.ABCMeta,
):
    """Base class for all external account credentials.

    This is used to instantiate Credentials for exchanging external account
    credentials for Google access token and authorizing requests to Google APIs.
    The base class implements the common logic for exchanging external account
    credentials for Google access tokens.
    """

    def __init__(
        self,
        audience,
        subject_token_type,
        token_url,
        credential_source,
        service_account_impersonation_url=None,
        service_account_impersonation_options=None,
        client_id=None,
        client_secret=None,
        token_info_url=None,
        quota_project_id=None,
        scopes=None,
        default_scopes=None,
        workforce_pool_user_project=None,
        universe_domain=credentials.DEFAULT_UNIVERSE_DOMAIN,
        trust_boundary=None,
    ):
        """Instantiates an external account credentials object.

        Args:
            audience (str): The STS audience field.
            subject_token_type (str): The subject token type based on the Oauth2.0 token exchange spec.
                Expected values include::

                    “urn:ietf:params:oauth:token-type:jwt”
                    “urn:ietf:params:oauth:token-type:id-token”
                    “urn:ietf:params:oauth:token-type:saml2”
                    “urn:ietf:params:aws:token-type:aws4_request”

            token_url (str): The STS endpoint URL.
            credential_source (Mapping): The credential source dictionary.
            service_account_impersonation_url (Optional[str]): The optional service account
                impersonation generateAccessToken URL.
            client_id (Optional[str]): The optional client ID.
            client_secret (Optional[str]): The optional client secret.
            token_info_url (str): The optional STS endpoint URL for token introspection.
            quota_project_id (Optional[str]): The optional quota project ID.
            scopes (Optional[Sequence[str]]): Optional scopes to request during the
                authorization grant.
            default_scopes (Optional[Sequence[str]]): Default scopes passed by a
                Google client library. Use 'scopes' for user-defined scopes.
            workforce_pool_user_project (Optona[str]): The optional workforce pool user
                project number when the credential corresponds to a workforce pool and not
                a workload identity pool. The underlying principal must still have
                serviceusage.services.use IAM permission to use the project for
                billing/quota.
            universe_domain (str): The universe domain. The default universe
                domain is googleapis.com.
            trust_boundary (str): String representation of trust boundary meta.
        Raises:
            google.auth.exceptions.RefreshError: If the generateAccessToken
                endpoint returned an error.
        """
        super(Credentials, self).__init__()
        self._audience = audience
        self._subject_token_type = subject_token_type
        self._universe_domain = universe_domain
        self._token_url = token_url
        if self._token_url == _DEFAULT_TOKEN_URL:
            self._token_url = self._token_url.replace(
                "{universe_domain}", self._universe_domain
            )
        self._token_info_url = token_info_url
        self._credential_source = credential_source
        self._service_account_impersonation_url = service_account_impersonation_url
        self._service_account_impersonation_options = (
            service_account_impersonation_options or {}
        )
        self._client_id = client_id
        self._client_secret = client_secret
        self._quota_project_id = quota_project_id
        self._scopes = scopes
        self._default_scopes = default_scopes
        self._workforce_pool_user_project = workforce_pool_user_project
        self._trust_boundary = {
            "locations": [],
            "encoded_locations": "0x0",
        }  # expose a placeholder trust boundary value.

        if self._client_id:
            self._client_auth = utils.ClientAuthentication(
                utils.ClientAuthType.basic, self._client_id, self._client_secret
            )
        else:
            self._client_auth = None
        self._sts_client = sts.Client(self._token_url, self._client_auth)

        self._metrics_options = self._create_default_metrics_options()

        self._impersonated_credentials = None
        self._project_id = None
        self._supplier_context = SupplierContext(
            self._subject_token_type, self._audience
        )
        self._cred_file_path = None

        if not self.is_workforce_pool and self._workforce_pool_user_project:
            # Workload identity pools do not support workforce pool user projects.
            raise exceptions.InvalidValue(
                "workforce_pool_user_project should not be set for non-workforce pool "
                "credentials"
            )

    @property
    def info(self):
        """Generates the dictionary representation of the current credentials.

        Returns:
            Mapping: The dictionary representation of the credentials. This is the
                reverse of "from_info" defined on the subclasses of this class. It is
                useful for serializing the current credentials so it can deserialized
                later.
        """
        config_info = self._constructor_args()
        config_info.update(
            type=_EXTERNAL_ACCOUNT_JSON_TYPE,
            service_account_impersonation=config_info.pop(
                "service_account_impersonation_options", None
            ),
        )
        config_info.pop("scopes", None)
        config_info.pop("default_scopes", None)
        return {key: value for key, value in config_info.items() if value is not None}

    def _constructor_args(self):
        args = {
            "audience": self._audience,
            "subject_token_type": self._subject_token_type,
            "token_url": self._token_url,
            "token_info_url": self._token_info_url,
            "service_account_impersonation_url": self._service_account_impersonation_url,
            "service_account_impersonation_options": copy.deepcopy(
                self._service_account_impersonation_options
            )
            or None,
            "credential_source": copy.deepcopy(self._credential_source),
            "quota_project_id": self._quota_project_id,
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "workforce_pool_user_project": self._workforce_pool_user_project,
            "scopes": self._scopes,
            "default_scopes": self._default_scopes,
            "universe_domain": self._universe_domain,
        }
        if not self.is_workforce_pool:
            args.pop("workforce_pool_user_project")
        return args

    @property
    def service_account_email(self):
        """Returns the service account email if service account impersonation is used.

        Returns:
            Optional[str]: The service account email if impersonation is used. Otherwise
                None is returned.
        """
        if self._service_account_impersonation_url:
            # Parse email from URL. The formal looks as follows:
            # https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/name@project-id.iam.gserviceaccount.com:generateAccessToken
            url = self._service_account_impersonation_url
            start_index = url.rfind("/")
            end_index = url.find(":generateAccessToken")
            if start_index != -1 and end_index != -1 and start_index < end_index:
                start_index = start_index + 1
                return url[start_index:end_index]
        return None

    @property
    def is_user(self):
        """Returns whether the credentials represent a user (True) or workload (False).
        Workloads behave similarly to service accounts. Currently workloads will use
        service account impersonation but will eventually not require impersonation.
        As a result, this property is more reliable than the service account email
        property in determining if the credentials represent a user or workload.

        Returns:
            bool: True if the credentials represent a user. False if they represent a
                workload.
        """
        # If service account impersonation is used, the credentials will always represent a
        # service account.
        if self._service_account_impersonation_url:
            return False
        return self.is_workforce_pool

    @property
    def is_workforce_pool(self):
        """Returns whether the credentials represent a workforce pool (True) or
        workload (False) based on the credentials' audience.

        This will also return True for impersonated workforce pool credentials.

        Returns:
            bool: True if the credentials represent a workforce pool. False if they
                represent a workload.
        """
        # Workforce pools representing users have the following audience format:
        # //iam.googleapis.com/locations/$location/workforcePools/$poolId/providers/$providerId
        p = re.compile(r"//iam\.googleapis\.com/locations/[^/]+/workforcePools/")
        return p.match(self._audience or "") is not None

    @property
    def requires_scopes(self):
        """Checks if the credentials requires scopes.

        Returns:
            bool: True if there are no scopes set otherwise False.
        """
        return not self._scopes and not self._default_scopes

    @property
    def project_number(self):
        """Optional[str]: The project number corresponding to the workload identity pool."""

        # STS audience pattern:
        # //iam.googleapis.com/projects/$PROJECT_NUMBER/locations/...
        components = self._audience.split("/")
        try:
            project_index = components.index("projects")
            if project_index + 1 < len(components):
                return components[project_index + 1] or None
        except ValueError:
            return None

    @property
    def token_info_url(self):
        """Optional[str]: The STS token introspection endpoint."""

        return self._token_info_url

    @_helpers.copy_docstring(credentials.Credentials)
    def get_cred_info(self):
        if self._cred_file_path:
            cred_info_json = {
                "credential_source": self._cred_file_path,
                "credential_type": "external account credentials",
            }
            if self.service_account_email:
                cred_info_json["principal"] = self.service_account_email
            return cred_info_json
        return None

    @_helpers.copy_docstring(credentials.Scoped)
    def with_scopes(self, scopes, default_scopes=None):
        kwargs = self._constructor_args()
        kwargs.update(scopes=scopes, default_scopes=default_scopes)
        scoped = self.__class__(**kwargs)
        scoped._cred_file_path = self._cred_file_path
        scoped._metrics_options = self._metrics_options
        return scoped

    @abc.abstractmethod
    def retrieve_subject_token(self, request):
        """Retrieves the subject token using the credential_source object.

        Args:
            request (google.auth.transport.Request): A callable used to make
                HTTP requests.
        Returns:
            str: The retrieved subject token.
        """
        # pylint: disable=missing-raises-doc
        # (pylint doesn't recognize that this is abstract)
        raise NotImplementedError("retrieve_subject_token must be implemented")

    def get_project_id(self, request):
        """Retrieves the project ID corresponding to the workload identity or workforce pool.
        For workforce pool credentials, it returns the project ID corresponding to
        the workforce_pool_user_project.

        When not determinable, None is returned.

        This is introduced to support the current pattern of using the Auth library:

            credentials, project_id = google.auth.default()

        The resource may not have permission (resourcemanager.projects.get) to
        call this API or the required scopes may not be selected:
        https://cloud.google.com/resource-manager/reference/rest/v1/projects/get#authorization-scopes

        Args:
            request (google.auth.transport.Request): A callable used to make
                HTTP requests.
        Returns:
            Optional[str]: The project ID corresponding to the workload identity pool
                or workforce pool if determinable.
        """
        if self._project_id:
            # If already retrieved, return the cached project ID value.
            return self._project_id
        scopes = self._scopes if self._scopes is not None else self._default_scopes
        # Scopes are required in order to retrieve a valid access token.
        project_number = self.project_number or self._workforce_pool_user_project
        if project_number and scopes:
            headers = {}
            url = _CLOUD_RESOURCE_MANAGER + project_number
            self.before_request(request, "GET", url, headers)
            response = request(url=url, method="GET", headers=headers)

            response_body = (
                response.data.decode("utf-8")
                if hasattr(response.data, "decode")
                else response.data
            )
            response_data = json.loads(response_body)

            if response.status == 200:
                # Cache result as this field is immutable.
                self._project_id = response_data.get("projectId")
                return self._project_id

        return None

    @_helpers.copy_docstring(credentials.Credentials)
    def refresh(self, request):
        scopes = self._scopes if self._scopes is not None else self._default_scopes

        # Inject client certificate into request.
        if self._mtls_required():
            request = functools.partial(
                request, cert=self._get_mtls_cert_and_key_paths()
            )

        if self._should_initialize_impersonated_credentials():
            self._impersonated_credentials = self._initialize_impersonated_credentials()

        if self._impersonated_credentials:
            self._impersonated_credentials.refresh(request)
            self.token = self._impersonated_credentials.token
            self.expiry = self._impersonated_credentials.expiry
        else:
            now = _helpers.utcnow()
            additional_options = None
            # Do not pass workforce_pool_user_project when client authentication
            # is used. The client ID is sufficient for determining the user project.
            if self._workforce_pool_user_project and not self._client_id:
                additional_options = {"userProject": self._workforce_pool_user_project}
            additional_headers = {
                metrics.API_CLIENT_HEADER: metrics.byoid_metrics_header(
                    self._metrics_options
                )
            }
            response_data = self._sts_client.exchange_token(
                request=request,
                grant_type=_STS_GRANT_TYPE,
                subject_token=self.retrieve_subject_token(request),
                subject_token_type=self._subject_token_type,
                audience=self._audience,
                scopes=scopes,
                requested_token_type=_STS_REQUESTED_TOKEN_TYPE,
                additional_options=additional_options,
                additional_headers=additional_headers,
            )
            self.token = response_data.get("access_token")
            expires_in = response_data.get("expires_in")
            # Some services do not respect the OAUTH2.0 RFC and send expires_in as a
            # JSON String.
            if isinstance(expires_in, str):
                expires_in = int(expires_in)

            lifetime = datetime.timedelta(seconds=expires_in)

            self.expiry = now + lifetime

    def _make_copy(self):
        kwargs = self._constructor_args()
        new_cred = self.__class__(**kwargs)
        new_cred._cred_file_path = self._cred_file_path
        new_cred._metrics_options = self._metrics_options
        return new_cred

    @_helpers.copy_docstring(credentials.CredentialsWithQuotaProject)
    def with_quota_project(self, quota_project_id):
        # Return copy of instance with the provided quota project ID.
        cred = self._make_copy()
        cred._quota_project_id = quota_project_id
        return cred

    @_helpers.copy_docstring(credentials.CredentialsWithTokenUri)
    def with_token_uri(self, token_uri):
        cred = self._make_copy()
        cred._token_url = token_uri
        return cred

    @_helpers.copy_docstring(credentials.CredentialsWithUniverseDomain)
    def with_universe_domain(self, universe_domain):
        cred = self._make_copy()
        cred._universe_domain = universe_domain
        return cred

    def _should_initialize_impersonated_credentials(self):
        return (
            self._service_account_impersonation_url is not None
            and self._impersonated_credentials is None
        )

    def _initialize_impersonated_credentials(self):
        """Generates an impersonated credentials.

        For more details, see `projects.serviceAccounts.generateAccessToken`_.

        .. _projects.serviceAccounts.generateAccessToken: https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken

        Returns:
            impersonated_credentials.Credential: The impersonated credentials
                object.

        Raises:
            google.auth.exceptions.RefreshError: If the generateAccessToken
                endpoint returned an error.
        """
        # Return copy of instance with no service account impersonation.
        kwargs = self._constructor_args()
        kwargs.update(
            service_account_impersonation_url=None,
            service_account_impersonation_options={},
        )
        source_credentials = self.__class__(**kwargs)
        source_credentials._metrics_options = self._metrics_options

        # Determine target_principal.
        target_principal = self.service_account_email
        if not target_principal:
            raise exceptions.RefreshError(
                "Unable to determine target principal from service account impersonation URL."
            )

        scopes = self._scopes if self._scopes is not None else self._default_scopes
        # Initialize and return impersonated credentials.
        return impersonated_credentials.Credentials(
            source_credentials=source_credentials,
            target_principal=target_principal,
            target_scopes=scopes,
            quota_project_id=self._quota_project_id,
            iam_endpoint_override=self._service_account_impersonation_url,
            lifetime=self._service_account_impersonation_options.get(
                "token_lifetime_seconds"
            ),
        )

    def _create_default_metrics_options(self):
        metrics_options = {}
        if self._service_account_impersonation_url:
            metrics_options["sa-impersonation"] = "true"
        else:
            metrics_options["sa-impersonation"] = "false"
        if self._service_account_impersonation_options.get("token_lifetime_seconds"):
            metrics_options["config-lifetime"] = "true"
        else:
            metrics_options["config-lifetime"] = "false"

        return metrics_options

    def _mtls_required(self):
        """Returns a boolean representing whether the current credential is configured
        for mTLS and should add a certificate to the outgoing calls to the sts and service
        account impersonation endpoint.

        Returns:
            bool: True if the credential is configured for mTLS, False if it is not.
        """
        return False

    def _get_mtls_cert_and_key_paths(self):
        """Gets the file locations for a certificate and private key file
        to be used for configuring mTLS for the sts and service account
        impersonation calls. Currently only expected to return a value when using
        X509 workload identity federation.

        Returns:
            Tuple[str, str]: The cert and key file locations as strings in a tuple.

        Raises:
            NotImplementedError: When the current credential is not configured for
                mTLS.
        """
        raise NotImplementedError(
            "_get_mtls_cert_and_key_location must be implemented."
        )

    @classmethod
    def from_info(cls, info, **kwargs):
        """Creates a Credentials instance from parsed external account info.

        Args:
            info (Mapping[str, str]): The external account info in Google
                format.
            kwargs: Additional arguments to pass to the constructor.

        Returns:
            google.auth.identity_pool.Credentials: The constructed
                credentials.

        Raises:
            InvalidValue: For invalid parameters.
        """
        return cls(
            audience=info.get("audience"),
            subject_token_type=info.get("subject_token_type"),
            token_url=info.get("token_url"),
            token_info_url=info.get("token_info_url"),
            service_account_impersonation_url=info.get(
                "service_account_impersonation_url"
            ),
            service_account_impersonation_options=info.get(
                "service_account_impersonation"
            )
            or {},
            client_id=info.get("client_id"),
            client_secret=info.get("client_secret"),
            credential_source=info.get("credential_source"),
            quota_project_id=info.get("quota_project_id"),
            workforce_pool_user_project=info.get("workforce_pool_user_project"),
            universe_domain=info.get(
                "universe_domain", credentials.DEFAULT_UNIVERSE_DOMAIN
            ),
            **kwargs
        )

    @classmethod
    def from_file(cls, filename, **kwargs):
        """Creates a Credentials instance from an external account json file.

        Args:
            filename (str): The path to the external account json file.
            kwargs: Additional arguments to pass to the constructor.

        Returns:
            google.auth.identity_pool.Credentials: The constructed
                credentials.
        """
        with io.open(filename, "r", encoding="utf-8") as json_file:
            data = json.load(json_file)
            return cls.from_info(data, **kwargs)
