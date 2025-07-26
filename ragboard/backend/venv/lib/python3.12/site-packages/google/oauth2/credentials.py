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

"""OAuth 2.0 Credentials.

This module provides credentials based on OAuth 2.0 access and refresh tokens.
These credentials usually access resources on behalf of a user (resource
owner).

Specifically, this is intended to use access tokens acquired using the
`Authorization Code grant`_ and can refresh those tokens using a
optional `refresh token`_.

Obtaining the initial access and refresh token is outside of the scope of this
module. Consult `rfc6749 section 4.1`_ for complete details on the
Authorization Code grant flow.

.. _Authorization Code grant: https://tools.ietf.org/html/rfc6749#section-1.3.1
.. _refresh token: https://tools.ietf.org/html/rfc6749#section-6
.. _rfc6749 section 4.1: https://tools.ietf.org/html/rfc6749#section-4.1
"""

from datetime import datetime
import io
import json
import logging
import warnings

from google.auth import _cloud_sdk
from google.auth import _helpers
from google.auth import credentials
from google.auth import exceptions
from google.auth import metrics
from google.oauth2 import reauth

_LOGGER = logging.getLogger(__name__)


# The Google OAuth 2.0 token endpoint. Used for authorized user credentials.
_GOOGLE_OAUTH2_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"

# The Google OAuth 2.0 token info endpoint. Used for getting token info JSON from access tokens.
_GOOGLE_OAUTH2_TOKEN_INFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo"


class Credentials(credentials.ReadOnlyScoped, credentials.CredentialsWithQuotaProject):
    """Credentials using OAuth 2.0 access and refresh tokens.

    The credentials are considered immutable except the tokens and the token
    expiry, which are updated after refresh. If you want to modify the quota
    project, use :meth:`with_quota_project` or ::

        credentials = credentials.with_quota_project('myproject-123')

    Reauth is disabled by default. To enable reauth, set the
    `enable_reauth_refresh` parameter to True in the constructor. Note that
    reauth feature is intended for gcloud to use only.
    If reauth is enabled, `pyu2f` dependency has to be installed in order to use security
    key reauth feature. Dependency can be installed via `pip install pyu2f` or `pip install
    google-auth[reauth]`.
    """

    def __init__(
        self,
        token,
        refresh_token=None,
        id_token=None,
        token_uri=None,
        client_id=None,
        client_secret=None,
        scopes=None,
        default_scopes=None,
        quota_project_id=None,
        expiry=None,
        rapt_token=None,
        refresh_handler=None,
        enable_reauth_refresh=False,
        granted_scopes=None,
        trust_boundary=None,
        universe_domain=credentials.DEFAULT_UNIVERSE_DOMAIN,
        account=None,
    ):
        """
        Args:
            token (Optional(str)): The OAuth 2.0 access token. Can be None
                if refresh information is provided.
            refresh_token (str): The OAuth 2.0 refresh token. If specified,
                credentials can be refreshed.
            id_token (str): The Open ID Connect ID Token.
            token_uri (str): The OAuth 2.0 authorization server's token
                endpoint URI. Must be specified for refresh, can be left as
                None if the token can not be refreshed.
            client_id (str): The OAuth 2.0 client ID. Must be specified for
                refresh, can be left as None if the token can not be refreshed.
            client_secret(str): The OAuth 2.0 client secret. Must be specified
                for refresh, can be left as None if the token can not be
                refreshed.
            scopes (Sequence[str]): The scopes used to obtain authorization.
                This parameter is used by :meth:`has_scopes`. OAuth 2.0
                credentials can not request additional scopes after
                authorization. The scopes must be derivable from the refresh
                token if refresh information is provided (e.g. The refresh
                token scopes are a superset of this or contain a wild card
                scope like 'https://www.googleapis.com/auth/any-api').
            default_scopes (Sequence[str]): Default scopes passed by a
                Google client library. Use 'scopes' for user-defined scopes.
            quota_project_id (Optional[str]): The project ID used for quota and billing.
                This project may be different from the project used to
                create the credentials.
            rapt_token (Optional[str]): The reauth Proof Token.
            refresh_handler (Optional[Callable[[google.auth.transport.Request, Sequence[str]], [str, datetime]]]):
                A callable which takes in the HTTP request callable and the list of
                OAuth scopes and when called returns an access token string for the
                requested scopes and its expiry datetime. This is useful when no
                refresh tokens are provided and tokens are obtained by calling
                some external process on demand. It is particularly useful for
                retrieving downscoped tokens from a token broker.
            enable_reauth_refresh (Optional[bool]): Whether reauth refresh flow
                should be used. This flag is for gcloud to use only.
            granted_scopes (Optional[Sequence[str]]): The scopes that were consented/granted by the user.
                This could be different from the requested scopes and it could be empty if granted
                and requested scopes were same.
            trust_boundary (str): String representation of trust boundary meta.
            universe_domain (Optional[str]): The universe domain. The default
                universe domain is googleapis.com.
            account (Optional[str]): The account associated with the credential.
        """
        super(Credentials, self).__init__()
        self.token = token
        self.expiry = expiry
        self._refresh_token = refresh_token
        self._id_token = id_token
        self._scopes = scopes
        self._default_scopes = default_scopes
        self._granted_scopes = granted_scopes
        self._token_uri = token_uri
        self._client_id = client_id
        self._client_secret = client_secret
        self._quota_project_id = quota_project_id
        self._rapt_token = rapt_token
        self.refresh_handler = refresh_handler
        self._enable_reauth_refresh = enable_reauth_refresh
        self._trust_boundary = trust_boundary
        self._universe_domain = universe_domain or credentials.DEFAULT_UNIVERSE_DOMAIN
        self._account = account or ""
        self._cred_file_path = None

    def __getstate__(self):
        """A __getstate__ method must exist for the __setstate__ to be called
        This is identical to the default implementation.
        See https://docs.python.org/3.7/library/pickle.html#object.__setstate__
        """
        state_dict = self.__dict__.copy()
        # Remove _refresh_handler function as there are limitations pickling and
        # unpickling certain callables (lambda, functools.partial instances)
        # because they need to be importable.
        # Instead, the refresh_handler setter should be used to repopulate this.
        if "_refresh_handler" in state_dict:
            del state_dict["_refresh_handler"]

        if "_refresh_worker" in state_dict:
            del state_dict["_refresh_worker"]
        return state_dict

    def __setstate__(self, d):
        """Credentials pickled with older versions of the class do not have
        all the attributes."""
        self.token = d.get("token")
        self.expiry = d.get("expiry")
        self._refresh_token = d.get("_refresh_token")
        self._id_token = d.get("_id_token")
        self._scopes = d.get("_scopes")
        self._default_scopes = d.get("_default_scopes")
        self._granted_scopes = d.get("_granted_scopes")
        self._token_uri = d.get("_token_uri")
        self._client_id = d.get("_client_id")
        self._client_secret = d.get("_client_secret")
        self._quota_project_id = d.get("_quota_project_id")
        self._rapt_token = d.get("_rapt_token")
        self._enable_reauth_refresh = d.get("_enable_reauth_refresh")
        self._trust_boundary = d.get("_trust_boundary")
        self._universe_domain = (
            d.get("_universe_domain") or credentials.DEFAULT_UNIVERSE_DOMAIN
        )
        self._cred_file_path = d.get("_cred_file_path")
        # The refresh_handler setter should be used to repopulate this.
        self._refresh_handler = None
        self._refresh_worker = None
        self._use_non_blocking_refresh = d.get("_use_non_blocking_refresh", False)
        self._account = d.get("_account", "")

    @property
    def refresh_token(self):
        """Optional[str]: The OAuth 2.0 refresh token."""
        return self._refresh_token

    @property
    def scopes(self):
        """Optional[str]: The OAuth 2.0 permission scopes."""
        return self._scopes

    @property
    def granted_scopes(self):
        """Optional[Sequence[str]]: The OAuth 2.0 permission scopes that were granted by the user."""
        return self._granted_scopes

    @property
    def token_uri(self):
        """Optional[str]: The OAuth 2.0 authorization server's token endpoint
        URI."""
        return self._token_uri

    @property
    def id_token(self):
        """Optional[str]: The Open ID Connect ID Token.

        Depending on the authorization server and the scopes requested, this
        may be populated when credentials are obtained and updated when
        :meth:`refresh` is called. This token is a JWT. It can be verified
        and decoded using :func:`google.oauth2.id_token.verify_oauth2_token`.
        """
        return self._id_token

    @property
    def client_id(self):
        """Optional[str]: The OAuth 2.0 client ID."""
        return self._client_id

    @property
    def client_secret(self):
        """Optional[str]: The OAuth 2.0 client secret."""
        return self._client_secret

    @property
    def requires_scopes(self):
        """False: OAuth 2.0 credentials have their scopes set when
        the initial token is requested and can not be changed."""
        return False

    @property
    def rapt_token(self):
        """Optional[str]: The reauth Proof Token."""
        return self._rapt_token

    @property
    def refresh_handler(self):
        """Returns the refresh handler if available.

        Returns:
           Optional[Callable[[google.auth.transport.Request, Sequence[str]], [str, datetime]]]:
               The current refresh handler.
        """
        return self._refresh_handler

    @refresh_handler.setter
    def refresh_handler(self, value):
        """Updates the current refresh handler.

        Args:
            value (Optional[Callable[[google.auth.transport.Request, Sequence[str]], [str, datetime]]]):
                The updated value of the refresh handler.

        Raises:
            TypeError: If the value is not a callable or None.
        """
        if not callable(value) and value is not None:
            raise TypeError("The provided refresh_handler is not a callable or None.")
        self._refresh_handler = value

    @property
    def account(self):
        """str: The user account associated with the credential. If the account is unknown an empty string is returned."""
        return self._account

    def _make_copy(self):
        cred = self.__class__(
            self.token,
            refresh_token=self.refresh_token,
            id_token=self.id_token,
            token_uri=self.token_uri,
            client_id=self.client_id,
            client_secret=self.client_secret,
            scopes=self.scopes,
            default_scopes=self.default_scopes,
            granted_scopes=self.granted_scopes,
            quota_project_id=self.quota_project_id,
            rapt_token=self.rapt_token,
            enable_reauth_refresh=self._enable_reauth_refresh,
            trust_boundary=self._trust_boundary,
            universe_domain=self._universe_domain,
            account=self._account,
        )
        cred._cred_file_path = self._cred_file_path
        return cred

    @_helpers.copy_docstring(credentials.Credentials)
    def get_cred_info(self):
        if self._cred_file_path:
            cred_info = {
                "credential_source": self._cred_file_path,
                "credential_type": "user credentials",
            }
            if self.account:
                cred_info["principal"] = self.account
            return cred_info
        return None

    @_helpers.copy_docstring(credentials.CredentialsWithQuotaProject)
    def with_quota_project(self, quota_project_id):
        cred = self._make_copy()
        cred._quota_project_id = quota_project_id
        return cred

    @_helpers.copy_docstring(credentials.CredentialsWithTokenUri)
    def with_token_uri(self, token_uri):
        cred = self._make_copy()
        cred._token_uri = token_uri
        return cred

    def with_account(self, account):
        """Returns a copy of these credentials with a modified account.

        Args:
            account (str): The account to set

        Returns:
            google.oauth2.credentials.Credentials: A new credentials instance.
        """
        cred = self._make_copy()
        cred._account = account
        return cred

    @_helpers.copy_docstring(credentials.CredentialsWithUniverseDomain)
    def with_universe_domain(self, universe_domain):
        cred = self._make_copy()
        cred._universe_domain = universe_domain
        return cred

    def _metric_header_for_usage(self):
        return metrics.CRED_TYPE_USER

    @_helpers.copy_docstring(credentials.Credentials)
    def refresh(self, request):
        if self._universe_domain != credentials.DEFAULT_UNIVERSE_DOMAIN:
            raise exceptions.RefreshError(
                "User credential refresh is only supported in the default "
                "googleapis.com universe domain, but the current universe "
                "domain is {}. If you created the credential with an access "
                "token, it's likely that the provided token is expired now, "
                "please update your code with a valid token.".format(
                    self._universe_domain
                )
            )

        scopes = self._scopes if self._scopes is not None else self._default_scopes
        # Use refresh handler if available and no refresh token is
        # available. This is useful in general when tokens are obtained by calling
        # some external process on demand. It is particularly useful for retrieving
        # downscoped tokens from a token broker.
        if self._refresh_token is None and self.refresh_handler:
            token, expiry = self.refresh_handler(request, scopes=scopes)
            # Validate returned data.
            if not isinstance(token, str):
                raise exceptions.RefreshError(
                    "The refresh_handler returned token is not a string."
                )
            if not isinstance(expiry, datetime):
                raise exceptions.RefreshError(
                    "The refresh_handler returned expiry is not a datetime object."
                )
            if _helpers.utcnow() >= expiry - _helpers.REFRESH_THRESHOLD:
                raise exceptions.RefreshError(
                    "The credentials returned by the refresh_handler are "
                    "already expired."
                )
            self.token = token
            self.expiry = expiry
            return

        if (
            self._refresh_token is None
            or self._token_uri is None
            or self._client_id is None
            or self._client_secret is None
        ):
            raise exceptions.RefreshError(
                "The credentials do not contain the necessary fields need to "
                "refresh the access token. You must specify refresh_token, "
                "token_uri, client_id, and client_secret."
            )

        (
            access_token,
            refresh_token,
            expiry,
            grant_response,
            rapt_token,
        ) = reauth.refresh_grant(
            request,
            self._token_uri,
            self._refresh_token,
            self._client_id,
            self._client_secret,
            scopes=scopes,
            rapt_token=self._rapt_token,
            enable_reauth_refresh=self._enable_reauth_refresh,
        )

        self.token = access_token
        self.expiry = expiry
        self._refresh_token = refresh_token
        self._id_token = grant_response.get("id_token")
        self._rapt_token = rapt_token

        if scopes and "scope" in grant_response:
            requested_scopes = frozenset(scopes)
            self._granted_scopes = grant_response["scope"].split()
            granted_scopes = frozenset(self._granted_scopes)
            scopes_requested_but_not_granted = requested_scopes - granted_scopes
            if scopes_requested_but_not_granted:
                # User might be presented with unbundled scopes at the time of
                # consent. So it is a valid scenario to not have all the requested
                # scopes as part of granted scopes but log a warning in case the
                # developer wants to debug the scenario.
                _LOGGER.warning(
                    "Not all requested scopes were granted by the "
                    "authorization server, missing scopes {}.".format(
                        ", ".join(scopes_requested_but_not_granted)
                    )
                )

    @classmethod
    def from_authorized_user_info(cls, info, scopes=None):
        """Creates a Credentials instance from parsed authorized user info.

        Args:
            info (Mapping[str, str]): The authorized user info in Google
                format.
            scopes (Sequence[str]): Optional list of scopes to include in the
                credentials.

        Returns:
            google.oauth2.credentials.Credentials: The constructed
                credentials.

        Raises:
            ValueError: If the info is not in the expected format.
        """
        keys_needed = set(("refresh_token", "client_id", "client_secret"))
        missing = keys_needed.difference(info.keys())

        if missing:
            raise ValueError(
                "Authorized user info was not in the expected format, missing "
                "fields {}.".format(", ".join(missing))
            )

        # access token expiry (datetime obj); auto-expire if not saved
        expiry = info.get("expiry")
        if expiry:
            expiry = datetime.strptime(
                expiry.rstrip("Z").split(".")[0], "%Y-%m-%dT%H:%M:%S"
            )
        else:
            expiry = _helpers.utcnow() - _helpers.REFRESH_THRESHOLD

        # process scopes, which needs to be a seq
        if scopes is None and "scopes" in info:
            scopes = info.get("scopes")
            if isinstance(scopes, str):
                scopes = scopes.split(" ")

        return cls(
            token=info.get("token"),
            refresh_token=info.get("refresh_token"),
            token_uri=_GOOGLE_OAUTH2_TOKEN_ENDPOINT,  # always overrides
            scopes=scopes,
            client_id=info.get("client_id"),
            client_secret=info.get("client_secret"),
            quota_project_id=info.get("quota_project_id"),  # may not exist
            expiry=expiry,
            rapt_token=info.get("rapt_token"),  # may not exist
            trust_boundary=info.get("trust_boundary"),  # may not exist
            universe_domain=info.get("universe_domain"),  # may not exist
            account=info.get("account", ""),  # may not exist
        )

    @classmethod
    def from_authorized_user_file(cls, filename, scopes=None):
        """Creates a Credentials instance from an authorized user json file.

        Args:
            filename (str): The path to the authorized user json file.
            scopes (Sequence[str]): Optional list of scopes to include in the
                credentials.

        Returns:
            google.oauth2.credentials.Credentials: The constructed
                credentials.

        Raises:
            ValueError: If the file is not in the expected format.
        """
        with io.open(filename, "r", encoding="utf-8") as json_file:
            data = json.load(json_file)
            return cls.from_authorized_user_info(data, scopes)

    def to_json(self, strip=None):
        """Utility function that creates a JSON representation of a Credentials
        object.

        Args:
            strip (Sequence[str]): Optional list of members to exclude from the
                                   generated JSON.

        Returns:
            str: A JSON representation of this instance. When converted into
            a dictionary, it can be passed to from_authorized_user_info()
            to create a new credential instance.
        """
        prep = {
            "token": self.token,
            "refresh_token": self.refresh_token,
            "token_uri": self.token_uri,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scopes": self.scopes,
            "rapt_token": self.rapt_token,
            "universe_domain": self._universe_domain,
            "account": self._account,
        }
        if self.expiry:  # flatten expiry timestamp
            prep["expiry"] = self.expiry.isoformat() + "Z"

        # Remove empty entries (those which are None)
        prep = {k: v for k, v in prep.items() if v is not None}

        # Remove entries that explicitely need to be removed
        if strip is not None:
            prep = {k: v for k, v in prep.items() if k not in strip}

        return json.dumps(prep)


class UserAccessTokenCredentials(credentials.CredentialsWithQuotaProject):
    """Access token credentials for user account.

    Obtain the access token for a given user account or the current active
    user account with the ``gcloud auth print-access-token`` command.

    Args:
        account (Optional[str]): Account to get the access token for. If not
            specified, the current active account will be used.
        quota_project_id (Optional[str]): The project ID used for quota
            and billing.
    """

    def __init__(self, account=None, quota_project_id=None):
        warnings.warn(
            "UserAccessTokenCredentials is deprecated, please use "
            "google.oauth2.credentials.Credentials instead. To use "
            "that credential type, simply run "
            "`gcloud auth application-default login` and let the "
            "client libraries pick up the application default credentials."
        )
        super(UserAccessTokenCredentials, self).__init__()
        self._account = account
        self._quota_project_id = quota_project_id

    def with_account(self, account):
        """Create a new instance with the given account.

        Args:
            account (str): Account to get the access token for.

        Returns:
            google.oauth2.credentials.UserAccessTokenCredentials: The created
                credentials with the given account.
        """
        return self.__class__(account=account, quota_project_id=self._quota_project_id)

    @_helpers.copy_docstring(credentials.CredentialsWithQuotaProject)
    def with_quota_project(self, quota_project_id):
        return self.__class__(account=self._account, quota_project_id=quota_project_id)

    def refresh(self, request):
        """Refreshes the access token.

        Args:
            request (google.auth.transport.Request): This argument is required
                by the base class interface but not used in this implementation,
                so just set it to `None`.

        Raises:
            google.auth.exceptions.UserAccessTokenError: If the access token
                refresh failed.
        """
        self.token = _cloud_sdk.get_auth_access_token(self._account)

    @_helpers.copy_docstring(credentials.Credentials)
    def before_request(self, request, method, url, headers):
        self.refresh(request)
        self.apply(headers)
