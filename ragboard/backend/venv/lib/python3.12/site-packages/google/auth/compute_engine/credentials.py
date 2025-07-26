# Copyright 2016 Google LLC
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

"""Google Compute Engine credentials.

This module provides authentication for an application running on Google
Compute Engine using the Compute Engine metadata server.

"""

import datetime

from google.auth import _helpers
from google.auth import credentials
from google.auth import exceptions
from google.auth import iam
from google.auth import jwt
from google.auth import metrics
from google.auth.compute_engine import _metadata
from google.oauth2 import _client


class Credentials(
    credentials.Scoped,
    credentials.CredentialsWithQuotaProject,
    credentials.CredentialsWithUniverseDomain,
):
    """Compute Engine Credentials.

    These credentials use the Google Compute Engine metadata server to obtain
    OAuth 2.0 access tokens associated with the instance's service account,
    and are also used for Cloud Run, Flex and App Engine (except for the Python
    2.7 runtime, which is supported only on older versions of this library).

    For more information about Compute Engine authentication, including how
    to configure scopes, see the `Compute Engine authentication
    documentation`_.

    .. note:: On Compute Engine the metadata server ignores requested scopes.
        On Cloud Run, Flex and App Engine the server honours requested scopes.

    .. _Compute Engine authentication documentation:
        https://cloud.google.com/compute/docs/authentication#using
    """

    def __init__(
        self,
        service_account_email="default",
        quota_project_id=None,
        scopes=None,
        default_scopes=None,
        universe_domain=None,
    ):
        """
        Args:
            service_account_email (str): The service account email to use, or
                'default'. A Compute Engine instance may have multiple service
                accounts.
            quota_project_id (Optional[str]): The project ID used for quota and
                billing.
            scopes (Optional[Sequence[str]]): The list of scopes for the credentials.
            default_scopes (Optional[Sequence[str]]): Default scopes passed by a
                Google client library. Use 'scopes' for user-defined scopes.
            universe_domain (Optional[str]): The universe domain. If not
                provided or None, credential will attempt to fetch the value
                from metadata server. If metadata server doesn't have universe
                domain endpoint, then the default googleapis.com will be used.
        """
        super(Credentials, self).__init__()
        self._service_account_email = service_account_email
        self._quota_project_id = quota_project_id
        self._scopes = scopes
        self._default_scopes = default_scopes
        self._universe_domain_cached = False
        if universe_domain:
            self._universe_domain = universe_domain
            self._universe_domain_cached = True

    def _retrieve_info(self, request):
        """Retrieve information about the service account.

        Updates the scopes and retrieves the full service account email.

        Args:
            request (google.auth.transport.Request): The object used to make
                HTTP requests.
        """
        info = _metadata.get_service_account_info(
            request, service_account=self._service_account_email
        )

        self._service_account_email = info["email"]

        # Don't override scopes requested by the user.
        if self._scopes is None:
            self._scopes = info["scopes"]

    def _metric_header_for_usage(self):
        return metrics.CRED_TYPE_SA_MDS

    def refresh(self, request):
        """Refresh the access token and scopes.

        Args:
            request (google.auth.transport.Request): The object used to make
                HTTP requests.

        Raises:
            google.auth.exceptions.RefreshError: If the Compute Engine metadata
                service can't be reached if if the instance has not
                credentials.
        """
        scopes = self._scopes if self._scopes is not None else self._default_scopes
        try:
            self._retrieve_info(request)
            # Always fetch token with default service account email.
            self.token, self.expiry = _metadata.get_service_account_token(
                request, service_account="default", scopes=scopes
            )
        except exceptions.TransportError as caught_exc:
            new_exc = exceptions.RefreshError(caught_exc)
            raise new_exc from caught_exc

    @property
    def service_account_email(self):
        """The service account email.

        .. note:: This is not guaranteed to be set until :meth:`refresh` has been
            called.
        """
        return self._service_account_email

    @property
    def requires_scopes(self):
        return not self._scopes

    @property
    def universe_domain(self):
        if self._universe_domain_cached:
            return self._universe_domain

        from google.auth.transport import requests as google_auth_requests

        self._universe_domain = _metadata.get_universe_domain(
            google_auth_requests.Request()
        )
        self._universe_domain_cached = True
        return self._universe_domain

    @_helpers.copy_docstring(credentials.Credentials)
    def get_cred_info(self):
        return {
            "credential_source": "metadata server",
            "credential_type": "VM credentials",
            "principal": self.service_account_email,
        }

    @_helpers.copy_docstring(credentials.CredentialsWithQuotaProject)
    def with_quota_project(self, quota_project_id):
        creds = self.__class__(
            service_account_email=self._service_account_email,
            quota_project_id=quota_project_id,
            scopes=self._scopes,
            default_scopes=self._default_scopes,
        )
        creds._universe_domain = self._universe_domain
        creds._universe_domain_cached = self._universe_domain_cached
        return creds

    @_helpers.copy_docstring(credentials.Scoped)
    def with_scopes(self, scopes, default_scopes=None):
        # Compute Engine credentials can not be scoped (the metadata service
        # ignores the scopes parameter). App Engine, Cloud Run and Flex support
        # requesting scopes.
        creds = self.__class__(
            scopes=scopes,
            default_scopes=default_scopes,
            service_account_email=self._service_account_email,
            quota_project_id=self._quota_project_id,
        )
        creds._universe_domain = self._universe_domain
        creds._universe_domain_cached = self._universe_domain_cached
        return creds

    @_helpers.copy_docstring(credentials.CredentialsWithUniverseDomain)
    def with_universe_domain(self, universe_domain):
        return self.__class__(
            scopes=self._scopes,
            default_scopes=self._default_scopes,
            service_account_email=self._service_account_email,
            quota_project_id=self._quota_project_id,
            universe_domain=universe_domain,
        )


_DEFAULT_TOKEN_LIFETIME_SECS = 3600  # 1 hour in seconds
_DEFAULT_TOKEN_URI = "https://www.googleapis.com/oauth2/v4/token"


class IDTokenCredentials(
    credentials.CredentialsWithQuotaProject,
    credentials.Signing,
    credentials.CredentialsWithTokenUri,
):
    """Open ID Connect ID Token-based service account credentials.

    These credentials relies on the default service account of a GCE instance.

    ID token can be requested from `GCE metadata server identity endpoint`_, IAM
    token endpoint or other token endpoints you specify. If metadata server
    identity endpoint is not used, the GCE instance must have been started with
    a service account that has access to the IAM Cloud API.

    .. _GCE metadata server identity endpoint:
        https://cloud.google.com/compute/docs/instances/verifying-instance-identity
    """

    def __init__(
        self,
        request,
        target_audience,
        token_uri=None,
        additional_claims=None,
        service_account_email=None,
        signer=None,
        use_metadata_identity_endpoint=False,
        quota_project_id=None,
    ):
        """
        Args:
            request (google.auth.transport.Request): The object used to make
                HTTP requests.
            target_audience (str): The intended audience for these credentials,
                used when requesting the ID Token. The ID Token's ``aud`` claim
                will be set to this string.
            token_uri (str): The OAuth 2.0 Token URI.
            additional_claims (Mapping[str, str]): Any additional claims for
                the JWT assertion used in the authorization grant.
            service_account_email (str): Optional explicit service account to
                use to sign JWT tokens.
                By default, this is the default GCE service account.
            signer (google.auth.crypt.Signer): The signer used to sign JWTs.
                In case the signer is specified, the request argument will be
                ignored.
            use_metadata_identity_endpoint (bool): Whether to use GCE metadata
                identity endpoint. For backward compatibility the default value
                is False. If set to True, ``token_uri``, ``additional_claims``,
                ``service_account_email``, ``signer`` argument should not be set;
                otherwise ValueError will be raised.
            quota_project_id (Optional[str]): The project ID used for quota and
                billing.

        Raises:
            ValueError:
                If ``use_metadata_identity_endpoint`` is set to True, and one of
                ``token_uri``, ``additional_claims``, ``service_account_email``,
                 ``signer`` arguments is set.
        """
        super(IDTokenCredentials, self).__init__()

        self._quota_project_id = quota_project_id
        self._use_metadata_identity_endpoint = use_metadata_identity_endpoint
        self._target_audience = target_audience

        if use_metadata_identity_endpoint:
            if token_uri or additional_claims or service_account_email or signer:
                raise exceptions.MalformedError(
                    "If use_metadata_identity_endpoint is set, token_uri, "
                    "additional_claims, service_account_email, signer arguments"
                    " must not be set"
                )
            self._token_uri = None
            self._additional_claims = None
            self._signer = None

        if service_account_email is None:
            sa_info = _metadata.get_service_account_info(request)
            self._service_account_email = sa_info["email"]
        else:
            self._service_account_email = service_account_email

        if not use_metadata_identity_endpoint:
            if signer is None:
                signer = iam.Signer(
                    request=request,
                    credentials=Credentials(),
                    service_account_email=self._service_account_email,
                )
            self._signer = signer
            self._token_uri = token_uri or _DEFAULT_TOKEN_URI

            if additional_claims is not None:
                self._additional_claims = additional_claims
            else:
                self._additional_claims = {}

    def with_target_audience(self, target_audience):
        """Create a copy of these credentials with the specified target
        audience.
        Args:
            target_audience (str): The intended audience for these credentials,
            used when requesting the ID Token.
        Returns:
            google.auth.service_account.IDTokenCredentials: A new credentials
                instance.
        """
        # since the signer is already instantiated,
        # the request is not needed
        if self._use_metadata_identity_endpoint:
            return self.__class__(
                None,
                target_audience=target_audience,
                use_metadata_identity_endpoint=True,
                quota_project_id=self._quota_project_id,
            )
        else:
            return self.__class__(
                None,
                service_account_email=self._service_account_email,
                token_uri=self._token_uri,
                target_audience=target_audience,
                additional_claims=self._additional_claims.copy(),
                signer=self.signer,
                use_metadata_identity_endpoint=False,
                quota_project_id=self._quota_project_id,
            )

    @_helpers.copy_docstring(credentials.CredentialsWithQuotaProject)
    def with_quota_project(self, quota_project_id):

        # since the signer is already instantiated,
        # the request is not needed
        if self._use_metadata_identity_endpoint:
            return self.__class__(
                None,
                target_audience=self._target_audience,
                use_metadata_identity_endpoint=True,
                quota_project_id=quota_project_id,
            )
        else:
            return self.__class__(
                None,
                service_account_email=self._service_account_email,
                token_uri=self._token_uri,
                target_audience=self._target_audience,
                additional_claims=self._additional_claims.copy(),
                signer=self.signer,
                use_metadata_identity_endpoint=False,
                quota_project_id=quota_project_id,
            )

    @_helpers.copy_docstring(credentials.CredentialsWithTokenUri)
    def with_token_uri(self, token_uri):

        # since the signer is already instantiated,
        # the request is not needed
        if self._use_metadata_identity_endpoint:
            raise exceptions.MalformedError(
                "If use_metadata_identity_endpoint is set, token_uri" " must not be set"
            )
        else:
            return self.__class__(
                None,
                service_account_email=self._service_account_email,
                token_uri=token_uri,
                target_audience=self._target_audience,
                additional_claims=self._additional_claims.copy(),
                signer=self.signer,
                use_metadata_identity_endpoint=False,
                quota_project_id=self.quota_project_id,
            )

    def _make_authorization_grant_assertion(self):
        """Create the OAuth 2.0 assertion.
        This assertion is used during the OAuth 2.0 grant to acquire an
        ID token.
        Returns:
            bytes: The authorization grant assertion.
        """
        now = _helpers.utcnow()
        lifetime = datetime.timedelta(seconds=_DEFAULT_TOKEN_LIFETIME_SECS)
        expiry = now + lifetime

        payload = {
            "iat": _helpers.datetime_to_secs(now),
            "exp": _helpers.datetime_to_secs(expiry),
            # The issuer must be the service account email.
            "iss": self.service_account_email,
            # The audience must be the auth token endpoint's URI
            "aud": self._token_uri,
            # The target audience specifies which service the ID token is
            # intended for.
            "target_audience": self._target_audience,
        }

        payload.update(self._additional_claims)

        token = jwt.encode(self._signer, payload)

        return token

    def _call_metadata_identity_endpoint(self, request):
        """Request ID token from metadata identity endpoint.

        Args:
            request (google.auth.transport.Request): The object used to make
                HTTP requests.

        Returns:
            Tuple[str, datetime.datetime]: The ID token and the expiry of the ID token.

        Raises:
            google.auth.exceptions.RefreshError: If the Compute Engine metadata
                service can't be reached or if the instance has no credentials.
            ValueError: If extracting expiry from the obtained ID token fails.
        """
        try:
            path = "instance/service-accounts/default/identity"
            params = {"audience": self._target_audience, "format": "full"}
            metrics_header = {
                metrics.API_CLIENT_HEADER: metrics.token_request_id_token_mds()
            }
            id_token = _metadata.get(
                request, path, params=params, headers=metrics_header
            )
        except exceptions.TransportError as caught_exc:
            new_exc = exceptions.RefreshError(caught_exc)
            raise new_exc from caught_exc

        _, payload, _, _ = jwt._unverified_decode(id_token)
        return id_token, datetime.datetime.utcfromtimestamp(payload["exp"])

    def refresh(self, request):
        """Refreshes the ID token.

        Args:
            request (google.auth.transport.Request): The object used to make
                HTTP requests.

        Raises:
            google.auth.exceptions.RefreshError: If the credentials could
                not be refreshed.
            ValueError: If extracting expiry from the obtained ID token fails.
        """
        if self._use_metadata_identity_endpoint:
            self.token, self.expiry = self._call_metadata_identity_endpoint(request)
        else:
            assertion = self._make_authorization_grant_assertion()
            access_token, expiry, _ = _client.id_token_jwt_grant(
                request, self._token_uri, assertion
            )
            self.token = access_token
            self.expiry = expiry

    @property  # type: ignore
    @_helpers.copy_docstring(credentials.Signing)
    def signer(self):
        return self._signer

    def sign_bytes(self, message):
        """Signs the given message.

        Args:
            message (bytes): The message to sign.

        Returns:
            bytes: The message's cryptographic signature.

        Raises:
            ValueError:
                Signer is not available if metadata identity endpoint is used.
        """
        if self._use_metadata_identity_endpoint:
            raise exceptions.InvalidOperation(
                "Signer is not available if metadata identity endpoint is used"
            )
        return self._signer.sign(message)

    @property
    def service_account_email(self):
        """The service account email."""
        return self._service_account_email

    @property
    def signer_email(self):
        return self._service_account_email
