# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
import json
import logging
import os
import threading
from datetime import datetime, timedelta
from typing import NamedTuple, Optional

import dateutil.parser
from dateutil.tz import tzutc

from botocore import UNSIGNED
from botocore.compat import total_seconds
from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    InvalidConfigError,
    TokenRetrievalError,
)
from botocore.utils import CachedProperty, JSONFileCache, SSOTokenLoader

logger = logging.getLogger(__name__)


def _utc_now():
    return datetime.now(tzutc())


def create_token_resolver(session):
    providers = [
        SSOTokenProvider(session),
    ]
    return TokenProviderChain(providers=providers)


def _serialize_utc_timestamp(obj):
    if isinstance(obj, datetime):
        return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
    return obj


def _sso_json_dumps(obj):
    return json.dumps(obj, default=_serialize_utc_timestamp)


class FrozenAuthToken(NamedTuple):
    token: str
    expiration: Optional[datetime] = None


class DeferredRefreshableToken:
    # The time at which we'll attempt to refresh, but not block if someone else
    # is refreshing.
    _advisory_refresh_timeout = 15 * 60
    # The time at which all threads will block waiting for a refreshed token
    _mandatory_refresh_timeout = 10 * 60
    # Refresh at most once every minute to avoid blocking every request
    _attempt_timeout = 60

    def __init__(self, method, refresh_using, time_fetcher=_utc_now):
        self._time_fetcher = time_fetcher
        self._refresh_using = refresh_using
        self.method = method

        # The frozen token is protected by this lock
        self._refresh_lock = threading.Lock()
        self._frozen_token = None
        self._next_refresh = None

    def get_frozen_token(self):
        self._refresh()
        return self._frozen_token

    def _refresh(self):
        # If we don't need to refresh just return
        refresh_type = self._should_refresh()
        if not refresh_type:
            return None

        # Block for refresh if we're in the mandatory refresh window
        block_for_refresh = refresh_type == "mandatory"
        if self._refresh_lock.acquire(block_for_refresh):
            try:
                self._protected_refresh()
            finally:
                self._refresh_lock.release()

    def _protected_refresh(self):
        # This should only be called after acquiring the refresh lock
        # Another thread may have already refreshed, double check refresh
        refresh_type = self._should_refresh()
        if not refresh_type:
            return None

        try:
            now = self._time_fetcher()
            self._next_refresh = now + timedelta(seconds=self._attempt_timeout)
            self._frozen_token = self._refresh_using()
        except Exception:
            logger.warning(
                "Refreshing token failed during the %s refresh period.",
                refresh_type,
                exc_info=True,
            )
            if refresh_type == "mandatory":
                # This refresh was mandatory, error must be propagated back
                raise

        if self._is_expired():
            # Fresh credentials should never be expired
            raise TokenRetrievalError(
                provider=self.method,
                error_msg="Token has expired and refresh failed",
            )

    def _is_expired(self):
        if self._frozen_token is None:
            return False

        expiration = self._frozen_token.expiration
        remaining = total_seconds(expiration - self._time_fetcher())
        return remaining <= 0

    def _should_refresh(self):
        if self._frozen_token is None:
            # We don't have a token yet, mandatory refresh
            return "mandatory"

        expiration = self._frozen_token.expiration
        if expiration is None:
            # No expiration, so assume we don't need to refresh.
            return None

        now = self._time_fetcher()
        if now < self._next_refresh:
            return None

        remaining = total_seconds(expiration - now)

        if remaining < self._mandatory_refresh_timeout:
            return "mandatory"
        elif remaining < self._advisory_refresh_timeout:
            return "advisory"

        return None


class TokenProviderChain:
    def __init__(self, providers=None):
        if providers is None:
            providers = []
        self._providers = providers

    def load_token(self):
        for provider in self._providers:
            token = provider.load_token()
            if token is not None:
                return token
        return None


class SSOTokenProvider:
    METHOD = "sso"
    _REFRESH_WINDOW = 15 * 60
    _SSO_TOKEN_CACHE_DIR = os.path.expanduser(
        os.path.join("~", ".aws", "sso", "cache")
    )
    _SSO_CONFIG_VARS = [
        "sso_start_url",
        "sso_region",
    ]
    _GRANT_TYPE = "refresh_token"
    DEFAULT_CACHE_CLS = JSONFileCache

    def __init__(
        self, session, cache=None, time_fetcher=_utc_now, profile_name=None
    ):
        self._session = session
        if cache is None:
            cache = self.DEFAULT_CACHE_CLS(
                self._SSO_TOKEN_CACHE_DIR,
                dumps_func=_sso_json_dumps,
            )
        self._now = time_fetcher
        self._cache = cache
        self._token_loader = SSOTokenLoader(cache=self._cache)
        self._profile_name = (
            profile_name
            or self._session.get_config_variable("profile")
            or 'default'
        )

    def _load_sso_config(self):
        loaded_config = self._session.full_config
        profiles = loaded_config.get("profiles", {})
        sso_sessions = loaded_config.get("sso_sessions", {})
        profile_config = profiles.get(self._profile_name, {})

        if "sso_session" not in profile_config:
            return

        sso_session_name = profile_config["sso_session"]
        sso_config = sso_sessions.get(sso_session_name, None)

        if not sso_config:
            error_msg = (
                f'The profile "{self._profile_name}" is configured to use the SSO '
                f'token provider but the "{sso_session_name}" sso_session '
                f"configuration does not exist."
            )
            raise InvalidConfigError(error_msg=error_msg)

        missing_configs = []
        for var in self._SSO_CONFIG_VARS:
            if var not in sso_config:
                missing_configs.append(var)

        if missing_configs:
            error_msg = (
                f'The profile "{self._profile_name}" is configured to use the SSO '
                f"token provider but is missing the following configuration: "
                f"{missing_configs}."
            )
            raise InvalidConfigError(error_msg=error_msg)

        return {
            "session_name": sso_session_name,
            "sso_region": sso_config["sso_region"],
            "sso_start_url": sso_config["sso_start_url"],
        }

    @CachedProperty
    def _sso_config(self):
        return self._load_sso_config()

    @CachedProperty
    def _client(self):
        config = Config(
            region_name=self._sso_config["sso_region"],
            signature_version=UNSIGNED,
        )
        return self._session.create_client("sso-oidc", config=config)

    def _attempt_create_token(self, token):
        response = self._client.create_token(
            grantType=self._GRANT_TYPE,
            clientId=token["clientId"],
            clientSecret=token["clientSecret"],
            refreshToken=token["refreshToken"],
        )
        expires_in = timedelta(seconds=response["expiresIn"])
        new_token = {
            "startUrl": self._sso_config["sso_start_url"],
            "region": self._sso_config["sso_region"],
            "accessToken": response["accessToken"],
            "expiresAt": self._now() + expires_in,
            # Cache the registration alongside the token
            "clientId": token["clientId"],
            "clientSecret": token["clientSecret"],
            "registrationExpiresAt": token["registrationExpiresAt"],
        }
        if "refreshToken" in response:
            new_token["refreshToken"] = response["refreshToken"]
        logger.info("SSO Token refresh succeeded")
        return new_token

    def _refresh_access_token(self, token):
        keys = (
            "refreshToken",
            "clientId",
            "clientSecret",
            "registrationExpiresAt",
        )
        missing_keys = [k for k in keys if k not in token]
        if missing_keys:
            msg = f"Unable to refresh SSO token: missing keys: {missing_keys}"
            logger.info(msg)
            return None

        expiry = dateutil.parser.parse(token["registrationExpiresAt"])
        if total_seconds(expiry - self._now()) <= 0:
            logger.info(f"SSO token registration expired at {expiry}")
            return None

        try:
            return self._attempt_create_token(token)
        except ClientError:
            logger.warning("SSO token refresh attempt failed", exc_info=True)
            return None

    def _refresher(self):
        start_url = self._sso_config["sso_start_url"]
        session_name = self._sso_config["session_name"]
        logger.info(f"Loading cached SSO token for {session_name}")
        token_dict = self._token_loader(start_url, session_name=session_name)
        expiration = dateutil.parser.parse(token_dict["expiresAt"])
        logger.debug(f"Cached SSO token expires at {expiration}")

        remaining = total_seconds(expiration - self._now())
        if remaining < self._REFRESH_WINDOW:
            new_token_dict = self._refresh_access_token(token_dict)
            if new_token_dict is not None:
                token_dict = new_token_dict
                expiration = token_dict["expiresAt"]
                self._token_loader.save_token(
                    start_url, token_dict, session_name=session_name
                )

        return FrozenAuthToken(
            token_dict["accessToken"], expiration=expiration
        )

    def load_token(self):
        if self._sso_config is None:
            return None

        return DeferredRefreshableToken(
            self.METHOD, self._refresher, time_fetcher=self._now
        )
