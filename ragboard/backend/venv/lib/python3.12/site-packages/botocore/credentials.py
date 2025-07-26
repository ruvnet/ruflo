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
import datetime
import getpass
import json
import logging
import os
import subprocess
import threading
import time
from collections import namedtuple
from copy import deepcopy
from hashlib import sha1

from dateutil.parser import parse
from dateutil.tz import tzlocal, tzutc

import botocore.compat
import botocore.configloader
from botocore import UNSIGNED
from botocore.compat import compat_shell_split, total_seconds
from botocore.config import Config
from botocore.exceptions import (
    ConfigNotFound,
    CredentialRetrievalError,
    InfiniteLoopConfigError,
    InvalidConfigError,
    MetadataRetrievalError,
    PartialCredentialsError,
    RefreshWithMFAUnsupportedError,
    UnauthorizedSSOTokenError,
    UnknownCredentialError,
)
from botocore.tokens import SSOTokenProvider
from botocore.utils import (
    ContainerMetadataFetcher,
    FileWebIdentityTokenLoader,
    InstanceMetadataFetcher,
    JSONFileCache,
    SSOTokenLoader,
    parse_key_val_file,
    resolve_imds_endpoint_mode,
)

logger = logging.getLogger(__name__)
ReadOnlyCredentials = namedtuple(
    'ReadOnlyCredentials', ['access_key', 'secret_key', 'token']
)

_DEFAULT_MANDATORY_REFRESH_TIMEOUT = 10 * 60  # 10 min
_DEFAULT_ADVISORY_REFRESH_TIMEOUT = 15 * 60  # 15 min


def create_credential_resolver(session, cache=None, region_name=None):
    """Create a default credential resolver.

    This creates a pre-configured credential resolver
    that includes the default lookup chain for
    credentials.

    """
    profile_name = session.get_config_variable('profile') or 'default'
    metadata_timeout = session.get_config_variable('metadata_service_timeout')
    num_attempts = session.get_config_variable('metadata_service_num_attempts')
    disable_env_vars = session.instance_variables().get('profile') is not None

    imds_config = {
        'ec2_metadata_service_endpoint': session.get_config_variable(
            'ec2_metadata_service_endpoint'
        ),
        'ec2_metadata_service_endpoint_mode': resolve_imds_endpoint_mode(
            session
        ),
        'ec2_credential_refresh_window': _DEFAULT_ADVISORY_REFRESH_TIMEOUT,
        'ec2_metadata_v1_disabled': session.get_config_variable(
            'ec2_metadata_v1_disabled'
        ),
    }

    if cache is None:
        cache = {}

    env_provider = EnvProvider()
    container_provider = ContainerProvider()
    instance_metadata_provider = InstanceMetadataProvider(
        iam_role_fetcher=InstanceMetadataFetcher(
            timeout=metadata_timeout,
            num_attempts=num_attempts,
            user_agent=session.user_agent(),
            config=imds_config,
        )
    )

    profile_provider_builder = ProfileProviderBuilder(
        session, cache=cache, region_name=region_name
    )
    assume_role_provider = AssumeRoleProvider(
        load_config=lambda: session.full_config,
        client_creator=_get_client_creator(session, region_name),
        cache=cache,
        profile_name=profile_name,
        credential_sourcer=CanonicalNameCredentialSourcer(
            [env_provider, container_provider, instance_metadata_provider]
        ),
        profile_provider_builder=profile_provider_builder,
    )

    pre_profile = [
        env_provider,
        assume_role_provider,
    ]
    profile_providers = profile_provider_builder.providers(
        profile_name=profile_name,
        disable_env_vars=disable_env_vars,
    )
    post_profile = [
        OriginalEC2Provider(),
        BotoProvider(),
        container_provider,
        instance_metadata_provider,
    ]
    providers = pre_profile + profile_providers + post_profile

    if disable_env_vars:
        # An explicitly provided profile will negate an EnvProvider.
        # We will defer to providers that understand the "profile"
        # concept to retrieve credentials.
        # The one edge case if is all three values are provided via
        # env vars:
        # export AWS_ACCESS_KEY_ID=foo
        # export AWS_SECRET_ACCESS_KEY=bar
        # export AWS_PROFILE=baz
        # Then, just like our client() calls, the explicit credentials
        # will take precedence.
        #
        # This precedence is enforced by leaving the EnvProvider in the chain.
        # This means that the only way a "profile" would win is if the
        # EnvProvider does not return credentials, which is what we want
        # in this scenario.
        providers.remove(env_provider)
        logger.debug(
            'Skipping environment variable credential check'
            ' because profile name was explicitly set.'
        )

    resolver = CredentialResolver(providers=providers)
    return resolver


class ProfileProviderBuilder:
    """This class handles the creation of profile based providers.

    NOTE: This class is only intended for internal use.

    This class handles the creation and ordering of the various credential
    providers that primarly source their configuration from the shared config.
    This is needed to enable sharing between the default credential chain and
    the source profile chain created by the assume role provider.
    """

    def __init__(
        self, session, cache=None, region_name=None, sso_token_cache=None
    ):
        self._session = session
        self._cache = cache
        self._region_name = region_name
        self._sso_token_cache = sso_token_cache

    def providers(self, profile_name, disable_env_vars=False):
        return [
            self._create_web_identity_provider(
                profile_name,
                disable_env_vars,
            ),
            self._create_sso_provider(profile_name),
            self._create_shared_credential_provider(profile_name),
            self._create_process_provider(profile_name),
            self._create_config_provider(profile_name),
        ]

    def _create_process_provider(self, profile_name):
        return ProcessProvider(
            profile_name=profile_name,
            load_config=lambda: self._session.full_config,
        )

    def _create_shared_credential_provider(self, profile_name):
        credential_file = self._session.get_config_variable('credentials_file')
        return SharedCredentialProvider(
            profile_name=profile_name,
            creds_filename=credential_file,
        )

    def _create_config_provider(self, profile_name):
        config_file = self._session.get_config_variable('config_file')
        return ConfigProvider(
            profile_name=profile_name,
            config_filename=config_file,
        )

    def _create_web_identity_provider(self, profile_name, disable_env_vars):
        return AssumeRoleWithWebIdentityProvider(
            load_config=lambda: self._session.full_config,
            client_creator=_get_client_creator(
                self._session, self._region_name
            ),
            cache=self._cache,
            profile_name=profile_name,
            disable_env_vars=disable_env_vars,
        )

    def _create_sso_provider(self, profile_name):
        return SSOProvider(
            load_config=lambda: self._session.full_config,
            client_creator=self._session.create_client,
            profile_name=profile_name,
            cache=self._cache,
            token_cache=self._sso_token_cache,
            token_provider=SSOTokenProvider(
                self._session,
                cache=self._sso_token_cache,
                profile_name=profile_name,
            ),
        )


def get_credentials(session):
    resolver = create_credential_resolver(session)
    return resolver.load_credentials()


def _local_now():
    return datetime.datetime.now(tzlocal())


def _parse_if_needed(value):
    if isinstance(value, datetime.datetime):
        return value
    return parse(value)


def _serialize_if_needed(value, iso=False):
    if isinstance(value, datetime.datetime):
        if iso:
            return value.isoformat()
        return value.strftime('%Y-%m-%dT%H:%M:%S%Z')
    return value


def _get_client_creator(session, region_name):
    def client_creator(service_name, **kwargs):
        create_client_kwargs = {'region_name': region_name}
        create_client_kwargs.update(**kwargs)
        return session.create_client(service_name, **create_client_kwargs)

    return client_creator


def create_assume_role_refresher(client, params):
    def refresh():
        response = client.assume_role(**params)
        credentials = response['Credentials']
        # We need to normalize the credential names to
        # the values expected by the refresh creds.
        return {
            'access_key': credentials['AccessKeyId'],
            'secret_key': credentials['SecretAccessKey'],
            'token': credentials['SessionToken'],
            'expiry_time': _serialize_if_needed(credentials['Expiration']),
        }

    return refresh


def create_mfa_serial_refresher(actual_refresh):
    class _Refresher:
        def __init__(self, refresh):
            self._refresh = refresh
            self._has_been_called = False

        def __call__(self):
            if self._has_been_called:
                # We can explore an option in the future to support
                # reprompting for MFA, but for now we just error out
                # when the temp creds expire.
                raise RefreshWithMFAUnsupportedError()
            self._has_been_called = True
            return self._refresh()

    return _Refresher(actual_refresh)


class Credentials:
    """
    Holds the credentials needed to authenticate requests.

    :param str access_key: The access key part of the credentials.
    :param str secret_key: The secret key part of the credentials.
    :param str token: The security token, valid only for session credentials.
    :param str method: A string which identifies where the credentials
        were found.
    """

    def __init__(self, access_key, secret_key, token=None, method=None):
        self.access_key = access_key
        self.secret_key = secret_key
        self.token = token

        if method is None:
            method = 'explicit'
        self.method = method

        self._normalize()

    def _normalize(self):
        # Keys would sometimes (accidentally) contain non-ascii characters.
        # It would cause a confusing UnicodeDecodeError in Python 2.
        # We explicitly convert them into unicode to avoid such error.
        #
        # Eventually the service will decide whether to accept the credential.
        # This also complies with the behavior in Python 3.
        self.access_key = botocore.compat.ensure_unicode(self.access_key)
        self.secret_key = botocore.compat.ensure_unicode(self.secret_key)

    def get_frozen_credentials(self):
        return ReadOnlyCredentials(
            self.access_key, self.secret_key, self.token
        )


class RefreshableCredentials(Credentials):
    """
    Holds the credentials needed to authenticate requests. In addition, it
    knows how to refresh itself.

    :param str access_key: The access key part of the credentials.
    :param str secret_key: The secret key part of the credentials.
    :param str token: The security token, valid only for session credentials.
    :param datetime expiry_time: The expiration time of the credentials.
    :param function refresh_using: Callback function to refresh the credentials.
    :param str method: A string which identifies where the credentials
        were found.
    :param function time_fetcher: Callback function to retrieve current time.
    """

    # The time at which we'll attempt to refresh, but not
    # block if someone else is refreshing.
    _advisory_refresh_timeout = _DEFAULT_ADVISORY_REFRESH_TIMEOUT
    # The time at which all threads will block waiting for
    # refreshed credentials.
    _mandatory_refresh_timeout = _DEFAULT_MANDATORY_REFRESH_TIMEOUT

    def __init__(
        self,
        access_key,
        secret_key,
        token,
        expiry_time,
        refresh_using,
        method,
        time_fetcher=_local_now,
        advisory_timeout=None,
        mandatory_timeout=None,
    ):
        self._refresh_using = refresh_using
        self._access_key = access_key
        self._secret_key = secret_key
        self._token = token
        self._expiry_time = expiry_time
        self._time_fetcher = time_fetcher
        self._refresh_lock = threading.Lock()
        self.method = method
        self._frozen_credentials = ReadOnlyCredentials(
            access_key, secret_key, token
        )
        self._normalize()
        if advisory_timeout is not None:
            self._advisory_refresh_timeout = advisory_timeout
        if mandatory_timeout is not None:
            self._mandatory_refresh_timeout = mandatory_timeout

    def _normalize(self):
        self._access_key = botocore.compat.ensure_unicode(self._access_key)
        self._secret_key = botocore.compat.ensure_unicode(self._secret_key)

    @classmethod
    def create_from_metadata(
        cls,
        metadata,
        refresh_using,
        method,
        advisory_timeout=None,
        mandatory_timeout=None,
    ):
        kwargs = {}
        if advisory_timeout is not None:
            kwargs['advisory_timeout'] = advisory_timeout
        if mandatory_timeout is not None:
            kwargs['mandatory_timeout'] = mandatory_timeout

        instance = cls(
            access_key=metadata['access_key'],
            secret_key=metadata['secret_key'],
            token=metadata['token'],
            expiry_time=cls._expiry_datetime(metadata['expiry_time']),
            method=method,
            refresh_using=refresh_using,
            **kwargs,
        )
        return instance

    @property
    def access_key(self):
        """Warning: Using this property can lead to race conditions if you
        access another property subsequently along the refresh boundary.
        Please use get_frozen_credentials instead.
        """
        self._refresh()
        return self._access_key

    @access_key.setter
    def access_key(self, value):
        self._access_key = value

    @property
    def secret_key(self):
        """Warning: Using this property can lead to race conditions if you
        access another property subsequently along the refresh boundary.
        Please use get_frozen_credentials instead.
        """
        self._refresh()
        return self._secret_key

    @secret_key.setter
    def secret_key(self, value):
        self._secret_key = value

    @property
    def token(self):
        """Warning: Using this property can lead to race conditions if you
        access another property subsequently along the refresh boundary.
        Please use get_frozen_credentials instead.
        """
        self._refresh()
        return self._token

    @token.setter
    def token(self, value):
        self._token = value

    def _seconds_remaining(self):
        delta = self._expiry_time - self._time_fetcher()
        return total_seconds(delta)

    def refresh_needed(self, refresh_in=None):
        """Check if a refresh is needed.

        A refresh is needed if the expiry time associated
        with the temporary credentials is less than the
        provided ``refresh_in``.  If ``time_delta`` is not
        provided, ``self.advisory_refresh_needed`` will be used.

        For example, if your temporary credentials expire
        in 10 minutes and the provided ``refresh_in`` is
        ``15 * 60``, then this function will return ``True``.

        :type refresh_in: int
        :param refresh_in: The number of seconds before the
            credentials expire in which refresh attempts should
            be made.

        :return: True if refresh needed, False otherwise.

        """
        if self._expiry_time is None:
            # No expiration, so assume we don't need to refresh.
            return False

        if refresh_in is None:
            refresh_in = self._advisory_refresh_timeout
        # The credentials should be refreshed if they're going to expire
        # in less than 5 minutes.
        if self._seconds_remaining() >= refresh_in:
            # There's enough time left. Don't refresh.
            return False
        logger.debug("Credentials need to be refreshed.")
        return True

    def _is_expired(self):
        # Checks if the current credentials are expired.
        return self.refresh_needed(refresh_in=0)

    def _refresh(self):
        # In the common case where we don't need a refresh, we
        # can immediately exit and not require acquiring the
        # refresh lock.
        if not self.refresh_needed(self._advisory_refresh_timeout):
            return

        # acquire() doesn't accept kwargs, but False is indicating
        # that we should not block if we can't acquire the lock.
        # If we aren't able to acquire the lock, we'll trigger
        # the else clause.
        if self._refresh_lock.acquire(False):
            try:
                if not self.refresh_needed(self._advisory_refresh_timeout):
                    return
                is_mandatory_refresh = self.refresh_needed(
                    self._mandatory_refresh_timeout
                )
                self._protected_refresh(is_mandatory=is_mandatory_refresh)
                return
            finally:
                self._refresh_lock.release()
        elif self.refresh_needed(self._mandatory_refresh_timeout):
            # If we're within the mandatory refresh window,
            # we must block until we get refreshed credentials.
            with self._refresh_lock:
                if not self.refresh_needed(self._mandatory_refresh_timeout):
                    return
                self._protected_refresh(is_mandatory=True)

    def _protected_refresh(self, is_mandatory):
        # precondition: this method should only be called if you've acquired
        # the self._refresh_lock.
        try:
            metadata = self._refresh_using()
        except Exception:
            period_name = 'mandatory' if is_mandatory else 'advisory'
            logger.warning(
                "Refreshing temporary credentials failed "
                "during %s refresh period.",
                period_name,
                exc_info=True,
            )
            if is_mandatory:
                # If this is a mandatory refresh, then
                # all errors that occur when we attempt to refresh
                # credentials are propagated back to the user.
                raise
            # Otherwise we'll just return.
            # The end result will be that we'll use the current
            # set of temporary credentials we have.
            return
        self._set_from_data(metadata)
        self._frozen_credentials = ReadOnlyCredentials(
            self._access_key, self._secret_key, self._token
        )
        if self._is_expired():
            # We successfully refreshed credentials but for whatever
            # reason, our refreshing function returned credentials
            # that are still expired.  In this scenario, the only
            # thing we can do is let the user know and raise
            # an exception.
            msg = (
                "Credentials were refreshed, but the "
                "refreshed credentials are still expired."
            )
            logger.warning(msg)
            raise RuntimeError(msg)

    @staticmethod
    def _expiry_datetime(time_str):
        return parse(time_str)

    def _set_from_data(self, data):
        expected_keys = ['access_key', 'secret_key', 'token', 'expiry_time']
        if not data:
            missing_keys = expected_keys
        else:
            missing_keys = [k for k in expected_keys if k not in data]

        if missing_keys:
            message = "Credential refresh failed, response did not contain: %s"
            raise CredentialRetrievalError(
                provider=self.method,
                error_msg=message % ', '.join(missing_keys),
            )

        self.access_key = data['access_key']
        self.secret_key = data['secret_key']
        self.token = data['token']
        self._expiry_time = parse(data['expiry_time'])
        logger.debug(
            "Retrieved credentials will expire at: %s", self._expiry_time
        )
        self._normalize()

    def get_frozen_credentials(self):
        """Return immutable credentials.

        The ``access_key``, ``secret_key``, and ``token`` properties
        on this class will always check and refresh credentials if
        needed before returning the particular credentials.

        This has an edge case where you can get inconsistent
        credentials.  Imagine this:

            # Current creds are "t1"
            tmp.access_key  ---> expired? no, so return t1.access_key
            # ---- time is now expired, creds need refreshing to "t2" ----
            tmp.secret_key  ---> expired? yes, refresh and return t2.secret_key

        This means we're using the access key from t1 with the secret key
        from t2.  To fix this issue, you can request a frozen credential object
        which is guaranteed not to change.

        The frozen credentials returned from this method should be used
        immediately and then discarded.  The typical usage pattern would
        be::

            creds = RefreshableCredentials(...)
            some_code = SomeSignerObject()
            # I'm about to sign the request.
            # The frozen credentials are only used for the
            # duration of generate_presigned_url and will be
            # immediately thrown away.
            request = some_code.sign_some_request(
                with_credentials=creds.get_frozen_credentials())
            print("Signed request:", request)

        """
        self._refresh()
        return self._frozen_credentials


class DeferredRefreshableCredentials(RefreshableCredentials):
    """Refreshable credentials that don't require initial credentials.

    refresh_using will be called upon first access.
    """

    def __init__(self, refresh_using, method, time_fetcher=_local_now):
        self._refresh_using = refresh_using
        self._access_key = None
        self._secret_key = None
        self._token = None
        self._expiry_time = None
        self._time_fetcher = time_fetcher
        self._refresh_lock = threading.Lock()
        self.method = method
        self._frozen_credentials = None

    def refresh_needed(self, refresh_in=None):
        if self._frozen_credentials is None:
            return True
        return super().refresh_needed(refresh_in)


class CachedCredentialFetcher:
    DEFAULT_EXPIRY_WINDOW_SECONDS = 60 * 15

    def __init__(self, cache=None, expiry_window_seconds=None):
        if cache is None:
            cache = {}
        self._cache = cache
        self._cache_key = self._create_cache_key()
        if expiry_window_seconds is None:
            expiry_window_seconds = self.DEFAULT_EXPIRY_WINDOW_SECONDS
        self._expiry_window_seconds = expiry_window_seconds

    def _create_cache_key(self):
        raise NotImplementedError('_create_cache_key()')

    def _make_file_safe(self, filename):
        # Replace :, path sep, and / to make it the string filename safe.
        filename = filename.replace(':', '_').replace(os.sep, '_')
        return filename.replace('/', '_')

    def _get_credentials(self):
        raise NotImplementedError('_get_credentials()')

    def fetch_credentials(self):
        return self._get_cached_credentials()

    def _get_cached_credentials(self):
        """Get up-to-date credentials.

        This will check the cache for up-to-date credentials, calling assume
        role if none are available.
        """
        response = self._load_from_cache()
        if response is None:
            response = self._get_credentials()
            self._write_to_cache(response)
        else:
            logger.debug("Credentials for role retrieved from cache.")

        creds = response['Credentials']
        expiration = _serialize_if_needed(creds['Expiration'], iso=True)
        return {
            'access_key': creds['AccessKeyId'],
            'secret_key': creds['SecretAccessKey'],
            'token': creds['SessionToken'],
            'expiry_time': expiration,
        }

    def _load_from_cache(self):
        if self._cache_key in self._cache:
            creds = deepcopy(self._cache[self._cache_key])
            if not self._is_expired(creds):
                return creds
            else:
                logger.debug(
                    "Credentials were found in cache, but they are expired."
                )
        return None

    def _write_to_cache(self, response):
        self._cache[self._cache_key] = deepcopy(response)

    def _is_expired(self, credentials):
        """Check if credentials are expired."""
        end_time = _parse_if_needed(credentials['Credentials']['Expiration'])
        seconds = total_seconds(end_time - _local_now())
        return seconds < self._expiry_window_seconds


class BaseAssumeRoleCredentialFetcher(CachedCredentialFetcher):
    def __init__(
        self,
        client_creator,
        role_arn,
        extra_args=None,
        cache=None,
        expiry_window_seconds=None,
    ):
        self._client_creator = client_creator
        self._role_arn = role_arn

        if extra_args is None:
            self._assume_kwargs = {}
        else:
            self._assume_kwargs = deepcopy(extra_args)
        self._assume_kwargs['RoleArn'] = self._role_arn

        self._role_session_name = self._assume_kwargs.get('RoleSessionName')
        self._using_default_session_name = False
        if not self._role_session_name:
            self._generate_assume_role_name()

        super().__init__(cache, expiry_window_seconds)

    def _generate_assume_role_name(self):
        self._role_session_name = f'botocore-session-{int(time.time())}'
        self._assume_kwargs['RoleSessionName'] = self._role_session_name
        self._using_default_session_name = True

    def _create_cache_key(self):
        """Create a predictable cache key for the current configuration.

        The cache key is intended to be compatible with file names.
        """
        args = deepcopy(self._assume_kwargs)

        # The role session name gets randomly generated, so we don't want it
        # in the hash.
        if self._using_default_session_name:
            del args['RoleSessionName']

        if 'Policy' in args:
            # To have a predictable hash, the keys of the policy must be
            # sorted, so we have to load it here to make sure it gets sorted
            # later on.
            args['Policy'] = json.loads(args['Policy'])

        args = json.dumps(args, sort_keys=True)
        argument_hash = sha1(args.encode('utf-8')).hexdigest()
        return self._make_file_safe(argument_hash)


class AssumeRoleCredentialFetcher(BaseAssumeRoleCredentialFetcher):
    def __init__(
        self,
        client_creator,
        source_credentials,
        role_arn,
        extra_args=None,
        mfa_prompter=None,
        cache=None,
        expiry_window_seconds=None,
    ):
        """
        :type client_creator: callable
        :param client_creator: A callable that creates a client taking
            arguments like ``Session.create_client``.

        :type source_credentials: Credentials
        :param source_credentials: The credentials to use to create the
            client for the call to AssumeRole.

        :type role_arn: str
        :param role_arn: The ARN of the role to be assumed.

        :type extra_args: dict
        :param extra_args: Any additional arguments to add to the assume
            role request using the format of the botocore operation.
            Possible keys include, but may not be limited to,
            DurationSeconds, Policy, SerialNumber, ExternalId and
            RoleSessionName.

        :type mfa_prompter: callable
        :param mfa_prompter: A callable that returns input provided by the
            user (i.e raw_input, getpass.getpass, etc.).

        :type cache: dict
        :param cache: An object that supports ``__getitem__``,
            ``__setitem__``, and ``__contains__``.  An example of this is
            the ``JSONFileCache`` class in aws-cli.

        :type expiry_window_seconds: int
        :param expiry_window_seconds: The amount of time, in seconds,
        """
        self._source_credentials = source_credentials
        self._mfa_prompter = mfa_prompter
        if self._mfa_prompter is None:
            self._mfa_prompter = getpass.getpass

        super().__init__(
            client_creator,
            role_arn,
            extra_args=extra_args,
            cache=cache,
            expiry_window_seconds=expiry_window_seconds,
        )

    def _get_credentials(self):
        """Get credentials by calling assume role."""
        kwargs = self._assume_role_kwargs()
        client = self._create_client()
        return client.assume_role(**kwargs)

    def _assume_role_kwargs(self):
        """Get the arguments for assume role based on current configuration."""
        assume_role_kwargs = deepcopy(self._assume_kwargs)

        mfa_serial = assume_role_kwargs.get('SerialNumber')

        if mfa_serial is not None:
            prompt = f'Enter MFA code for {mfa_serial}: '
            token_code = self._mfa_prompter(prompt)
            assume_role_kwargs['TokenCode'] = token_code

        duration_seconds = assume_role_kwargs.get('DurationSeconds')

        if duration_seconds is not None:
            assume_role_kwargs['DurationSeconds'] = duration_seconds

        return assume_role_kwargs

    def _create_client(self):
        """Create an STS client using the source credentials."""
        frozen_credentials = self._source_credentials.get_frozen_credentials()
        return self._client_creator(
            'sts',
            aws_access_key_id=frozen_credentials.access_key,
            aws_secret_access_key=frozen_credentials.secret_key,
            aws_session_token=frozen_credentials.token,
        )


class AssumeRoleWithWebIdentityCredentialFetcher(
    BaseAssumeRoleCredentialFetcher
):
    def __init__(
        self,
        client_creator,
        web_identity_token_loader,
        role_arn,
        extra_args=None,
        cache=None,
        expiry_window_seconds=None,
    ):
        """
        :type client_creator: callable
        :param client_creator: A callable that creates a client taking
            arguments like ``Session.create_client``.

        :type web_identity_token_loader: callable
        :param web_identity_token_loader: A callable that takes no arguments
        and returns a web identity token str.

        :type role_arn: str
        :param role_arn: The ARN of the role to be assumed.

        :type extra_args: dict
        :param extra_args: Any additional arguments to add to the assume
            role request using the format of the botocore operation.
            Possible keys include, but may not be limited to,
            DurationSeconds, Policy, SerialNumber, ExternalId and
            RoleSessionName.

        :type cache: dict
        :param cache: An object that supports ``__getitem__``,
            ``__setitem__``, and ``__contains__``.  An example of this is
            the ``JSONFileCache`` class in aws-cli.

        :type expiry_window_seconds: int
        :param expiry_window_seconds: The amount of time, in seconds,
        """
        self._web_identity_token_loader = web_identity_token_loader

        super().__init__(
            client_creator,
            role_arn,
            extra_args=extra_args,
            cache=cache,
            expiry_window_seconds=expiry_window_seconds,
        )

    def _get_credentials(self):
        """Get credentials by calling assume role."""
        kwargs = self._assume_role_kwargs()
        # Assume role with web identity does not require credentials other than
        # the token, explicitly configure the client to not sign requests.
        config = Config(signature_version=UNSIGNED)
        client = self._client_creator('sts', config=config)
        return client.assume_role_with_web_identity(**kwargs)

    def _assume_role_kwargs(self):
        """Get the arguments for assume role based on current configuration."""
        assume_role_kwargs = deepcopy(self._assume_kwargs)
        identity_token = self._web_identity_token_loader()
        assume_role_kwargs['WebIdentityToken'] = identity_token

        return assume_role_kwargs


class CredentialProvider:
    # A short name to identify the provider within botocore.
    METHOD = None

    # A name to identify the provider for use in cross-sdk features like
    # assume role's `credential_source` configuration option. These names
    # are to be treated in a case-insensitive way. NOTE: any providers not
    # implemented in botocore MUST prefix their canonical names with
    # 'custom' or we DO NOT guarantee that it will work with any features
    # that this provides.
    CANONICAL_NAME = None

    def __init__(self, session=None):
        self.session = session

    def load(self):
        """
        Loads the credentials from their source & sets them on the object.

        Subclasses should implement this method (by reading from disk, the
        environment, the network or wherever), returning ``True`` if they were
        found & loaded.

        If not found, this method should return ``False``, indictating that the
        ``CredentialResolver`` should fall back to the next available method.

        The default implementation does nothing, assuming the user has set the
        ``access_key/secret_key/token`` themselves.

        :returns: Whether credentials were found & set
        :rtype: Credentials
        """
        return True

    def _extract_creds_from_mapping(self, mapping, *key_names):
        found = []
        for key_name in key_names:
            try:
                found.append(mapping[key_name])
            except KeyError:
                raise PartialCredentialsError(
                    provider=self.METHOD, cred_var=key_name
                )
        return found


class ProcessProvider(CredentialProvider):
    METHOD = 'custom-process'

    def __init__(self, profile_name, load_config, popen=subprocess.Popen):
        self._profile_name = profile_name
        self._load_config = load_config
        self._loaded_config = None
        self._popen = popen

    def load(self):
        credential_process = self._credential_process
        if credential_process is None:
            return

        creds_dict = self._retrieve_credentials_using(credential_process)
        if creds_dict.get('expiry_time') is not None:
            return RefreshableCredentials.create_from_metadata(
                creds_dict,
                lambda: self._retrieve_credentials_using(credential_process),
                self.METHOD,
            )

        return Credentials(
            access_key=creds_dict['access_key'],
            secret_key=creds_dict['secret_key'],
            token=creds_dict.get('token'),
            method=self.METHOD,
        )

    def _retrieve_credentials_using(self, credential_process):
        # We're not using shell=True, so we need to pass the
        # command and all arguments as a list.
        process_list = compat_shell_split(credential_process)
        p = self._popen(
            process_list, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        stdout, stderr = p.communicate()
        if p.returncode != 0:
            raise CredentialRetrievalError(
                provider=self.METHOD, error_msg=stderr.decode('utf-8')
            )
        parsed = botocore.compat.json.loads(stdout.decode('utf-8'))
        version = parsed.get('Version', '<Version key not provided>')
        if version != 1:
            raise CredentialRetrievalError(
                provider=self.METHOD,
                error_msg=(
                    f"Unsupported version '{version}' for credential process "
                    f"provider, supported versions: 1"
                ),
            )
        try:
            return {
                'access_key': parsed['AccessKeyId'],
                'secret_key': parsed['SecretAccessKey'],
                'token': parsed.get('SessionToken'),
                'expiry_time': parsed.get('Expiration'),
            }
        except KeyError as e:
            raise CredentialRetrievalError(
                provider=self.METHOD,
                error_msg=f"Missing required key in response: {e}",
            )

    @property
    def _credential_process(self):
        if self._loaded_config is None:
            self._loaded_config = self._load_config()
        profile_config = self._loaded_config.get('profiles', {}).get(
            self._profile_name, {}
        )
        return profile_config.get('credential_process')


class InstanceMetadataProvider(CredentialProvider):
    METHOD = 'iam-role'
    CANONICAL_NAME = 'Ec2InstanceMetadata'

    def __init__(self, iam_role_fetcher):
        self._role_fetcher = iam_role_fetcher

    def load(self):
        fetcher = self._role_fetcher
        # We do the first request, to see if we get useful data back.
        # If not, we'll pass & move on to whatever's next in the credential
        # chain.
        metadata = fetcher.retrieve_iam_role_credentials()
        if not metadata:
            return None
        logger.info(
            'Found credentials from IAM Role: %s', metadata['role_name']
        )
        # We manually set the data here, since we already made the request &
        # have it. When the expiry is hit, the credentials will auto-refresh
        # themselves.
        creds = RefreshableCredentials.create_from_metadata(
            metadata,
            method=self.METHOD,
            refresh_using=fetcher.retrieve_iam_role_credentials,
        )
        return creds


class EnvProvider(CredentialProvider):
    METHOD = 'env'
    CANONICAL_NAME = 'Environment'
    ACCESS_KEY = 'AWS_ACCESS_KEY_ID'
    SECRET_KEY = 'AWS_SECRET_ACCESS_KEY'
    # The token can come from either of these env var.
    # AWS_SESSION_TOKEN is what other AWS SDKs have standardized on.
    TOKENS = ['AWS_SECURITY_TOKEN', 'AWS_SESSION_TOKEN']
    EXPIRY_TIME = 'AWS_CREDENTIAL_EXPIRATION'

    def __init__(self, environ=None, mapping=None):
        """

        :param environ: The environment variables (defaults to
            ``os.environ`` if no value is provided).
        :param mapping: An optional mapping of variable names to
            environment variable names.  Use this if you want to
            change the mapping of access_key->AWS_ACCESS_KEY_ID, etc.
            The dict can have up to 3 keys: ``access_key``, ``secret_key``,
            ``session_token``.
        """
        if environ is None:
            environ = os.environ
        self.environ = environ
        self._mapping = self._build_mapping(mapping)

    def _build_mapping(self, mapping):
        # Mapping of variable name to env var name.
        var_mapping = {}
        if mapping is None:
            # Use the class var default.
            var_mapping['access_key'] = self.ACCESS_KEY
            var_mapping['secret_key'] = self.SECRET_KEY
            var_mapping['token'] = self.TOKENS
            var_mapping['expiry_time'] = self.EXPIRY_TIME
        else:
            var_mapping['access_key'] = mapping.get(
                'access_key', self.ACCESS_KEY
            )
            var_mapping['secret_key'] = mapping.get(
                'secret_key', self.SECRET_KEY
            )
            var_mapping['token'] = mapping.get('token', self.TOKENS)
            if not isinstance(var_mapping['token'], list):
                var_mapping['token'] = [var_mapping['token']]
            var_mapping['expiry_time'] = mapping.get(
                'expiry_time', self.EXPIRY_TIME
            )
        return var_mapping

    def load(self):
        """
        Search for credentials in explicit environment variables.
        """

        access_key = self.environ.get(self._mapping['access_key'], '')

        if access_key:
            logger.info('Found credentials in environment variables.')
            fetcher = self._create_credentials_fetcher()
            credentials = fetcher(require_expiry=False)

            expiry_time = credentials['expiry_time']
            if expiry_time is not None:
                expiry_time = parse(expiry_time)
                return RefreshableCredentials(
                    credentials['access_key'],
                    credentials['secret_key'],
                    credentials['token'],
                    expiry_time,
                    refresh_using=fetcher,
                    method=self.METHOD,
                )

            return Credentials(
                credentials['access_key'],
                credentials['secret_key'],
                credentials['token'],
                method=self.METHOD,
            )
        else:
            return None

    def _create_credentials_fetcher(self):
        mapping = self._mapping
        method = self.METHOD
        environ = self.environ

        def fetch_credentials(require_expiry=True):
            credentials = {}

            access_key = environ.get(mapping['access_key'], '')
            if not access_key:
                raise PartialCredentialsError(
                    provider=method, cred_var=mapping['access_key']
                )
            credentials['access_key'] = access_key

            secret_key = environ.get(mapping['secret_key'], '')
            if not secret_key:
                raise PartialCredentialsError(
                    provider=method, cred_var=mapping['secret_key']
                )
            credentials['secret_key'] = secret_key

            credentials['token'] = None
            for token_env_var in mapping['token']:
                token = environ.get(token_env_var, '')
                if token:
                    credentials['token'] = token
                    break

            credentials['expiry_time'] = None
            expiry_time = environ.get(mapping['expiry_time'], '')
            if expiry_time:
                credentials['expiry_time'] = expiry_time
            if require_expiry and not expiry_time:
                raise PartialCredentialsError(
                    provider=method, cred_var=mapping['expiry_time']
                )

            return credentials

        return fetch_credentials


class OriginalEC2Provider(CredentialProvider):
    METHOD = 'ec2-credentials-file'
    CANONICAL_NAME = 'Ec2Config'

    CRED_FILE_ENV = 'AWS_CREDENTIAL_FILE'
    ACCESS_KEY = 'AWSAccessKeyId'
    SECRET_KEY = 'AWSSecretKey'

    def __init__(self, environ=None, parser=None):
        if environ is None:
            environ = os.environ
        if parser is None:
            parser = parse_key_val_file
        self._environ = environ
        self._parser = parser

    def load(self):
        """
        Search for a credential file used by original EC2 CLI tools.
        """
        if 'AWS_CREDENTIAL_FILE' in self._environ:
            full_path = os.path.expanduser(
                self._environ['AWS_CREDENTIAL_FILE']
            )
            creds = self._parser(full_path)
            if self.ACCESS_KEY in creds:
                logger.info('Found credentials in AWS_CREDENTIAL_FILE.')
                access_key = creds[self.ACCESS_KEY]
                secret_key = creds[self.SECRET_KEY]
                # EC2 creds file doesn't support session tokens.
                return Credentials(access_key, secret_key, method=self.METHOD)
        else:
            return None


class SharedCredentialProvider(CredentialProvider):
    METHOD = 'shared-credentials-file'
    CANONICAL_NAME = 'SharedCredentials'

    ACCESS_KEY = 'aws_access_key_id'
    SECRET_KEY = 'aws_secret_access_key'
    # Same deal as the EnvProvider above.  Botocore originally supported
    # aws_security_token, but the SDKs are standardizing on aws_session_token
    # so we support both.
    TOKENS = ['aws_security_token', 'aws_session_token']

    def __init__(self, creds_filename, profile_name=None, ini_parser=None):
        self._creds_filename = creds_filename
        if profile_name is None:
            profile_name = 'default'
        self._profile_name = profile_name
        if ini_parser is None:
            ini_parser = botocore.configloader.raw_config_parse
        self._ini_parser = ini_parser

    def load(self):
        try:
            available_creds = self._ini_parser(self._creds_filename)
        except ConfigNotFound:
            return None
        if self._profile_name in available_creds:
            config = available_creds[self._profile_name]
            if self.ACCESS_KEY in config:
                logger.info(
                    "Found credentials in shared credentials file: %s",
                    self._creds_filename,
                )
                access_key, secret_key = self._extract_creds_from_mapping(
                    config, self.ACCESS_KEY, self.SECRET_KEY
                )
                token = self._get_session_token(config)
                return Credentials(
                    access_key, secret_key, token, method=self.METHOD
                )

    def _get_session_token(self, config):
        for token_envvar in self.TOKENS:
            if token_envvar in config:
                return config[token_envvar]


class ConfigProvider(CredentialProvider):
    """INI based config provider with profile sections."""

    METHOD = 'config-file'
    CANONICAL_NAME = 'SharedConfig'

    ACCESS_KEY = 'aws_access_key_id'
    SECRET_KEY = 'aws_secret_access_key'
    # Same deal as the EnvProvider above.  Botocore originally supported
    # aws_security_token, but the SDKs are standardizing on aws_session_token
    # so we support both.
    TOKENS = ['aws_security_token', 'aws_session_token']

    def __init__(self, config_filename, profile_name, config_parser=None):
        """

        :param config_filename: The session configuration scoped to the current
            profile.  This is available via ``session.config``.
        :param profile_name: The name of the current profile.
        :param config_parser: A config parser callable.

        """
        self._config_filename = config_filename
        self._profile_name = profile_name
        if config_parser is None:
            config_parser = botocore.configloader.load_config
        self._config_parser = config_parser

    def load(self):
        """
        If there is are credentials in the configuration associated with
        the session, use those.
        """
        try:
            full_config = self._config_parser(self._config_filename)
        except ConfigNotFound:
            return None
        if self._profile_name in full_config['profiles']:
            profile_config = full_config['profiles'][self._profile_name]
            if self.ACCESS_KEY in profile_config:
                logger.info(
                    "Credentials found in config file: %s",
                    self._config_filename,
                )
                access_key, secret_key = self._extract_creds_from_mapping(
                    profile_config, self.ACCESS_KEY, self.SECRET_KEY
                )
                token = self._get_session_token(profile_config)
                return Credentials(
                    access_key, secret_key, token, method=self.METHOD
                )
        else:
            return None

    def _get_session_token(self, profile_config):
        for token_name in self.TOKENS:
            if token_name in profile_config:
                return profile_config[token_name]


class BotoProvider(CredentialProvider):
    METHOD = 'boto-config'
    CANONICAL_NAME = 'Boto2Config'

    BOTO_CONFIG_ENV = 'BOTO_CONFIG'
    DEFAULT_CONFIG_FILENAMES = ['/etc/boto.cfg', '~/.boto']
    ACCESS_KEY = 'aws_access_key_id'
    SECRET_KEY = 'aws_secret_access_key'

    def __init__(self, environ=None, ini_parser=None):
        if environ is None:
            environ = os.environ
        if ini_parser is None:
            ini_parser = botocore.configloader.raw_config_parse
        self._environ = environ
        self._ini_parser = ini_parser

    def load(self):
        """
        Look for credentials in boto config file.
        """
        if self.BOTO_CONFIG_ENV in self._environ:
            potential_locations = [self._environ[self.BOTO_CONFIG_ENV]]
        else:
            potential_locations = self.DEFAULT_CONFIG_FILENAMES
        for filename in potential_locations:
            try:
                config = self._ini_parser(filename)
            except ConfigNotFound:
                # Move on to the next potential config file name.
                continue
            if 'Credentials' in config:
                credentials = config['Credentials']
                if self.ACCESS_KEY in credentials:
                    logger.info(
                        "Found credentials in boto config file: %s", filename
                    )
                    access_key, secret_key = self._extract_creds_from_mapping(
                        credentials, self.ACCESS_KEY, self.SECRET_KEY
                    )
                    return Credentials(
                        access_key, secret_key, method=self.METHOD
                    )


class AssumeRoleProvider(CredentialProvider):
    METHOD = 'assume-role'
    # The AssumeRole provider is logically part of the SharedConfig and
    # SharedCredentials providers. Since the purpose of the canonical name
    # is to provide cross-sdk compatibility, calling code will need to be
    # aware that either of those providers should be tied to the AssumeRole
    # provider as much as possible.
    CANONICAL_NAME = None
    ROLE_CONFIG_VAR = 'role_arn'
    WEB_IDENTITY_TOKE_FILE_VAR = 'web_identity_token_file'
    # Credentials are considered expired (and will be refreshed) once the total
    # remaining time left until the credentials expires is less than the
    # EXPIRY_WINDOW.
    EXPIRY_WINDOW_SECONDS = 60 * 15

    def __init__(
        self,
        load_config,
        client_creator,
        cache,
        profile_name,
        prompter=getpass.getpass,
        credential_sourcer=None,
        profile_provider_builder=None,
    ):
        """
        :type load_config: callable
        :param load_config: A function that accepts no arguments, and
            when called, will return the full configuration dictionary
            for the session (``session.full_config``).

        :type client_creator: callable
        :param client_creator: A factory function that will create
            a client when called.  Has the same interface as
            ``botocore.session.Session.create_client``.

        :type cache: dict
        :param cache: An object that supports ``__getitem__``,
            ``__setitem__``, and ``__contains__``.  An example
            of this is the ``JSONFileCache`` class in the CLI.

        :type profile_name: str
        :param profile_name: The name of the profile.

        :type prompter: callable
        :param prompter: A callable that returns input provided
            by the user (i.e raw_input, getpass.getpass, etc.).

        :type credential_sourcer: CanonicalNameCredentialSourcer
        :param credential_sourcer: A credential provider that takes a
            configuration, which is used to provide the source credentials
            for the STS call.
        """
        #: The cache used to first check for assumed credentials.
        #: This is checked before making the AssumeRole API
        #: calls and can be useful if you have short lived
        #: scripts and you'd like to avoid calling AssumeRole
        #: until the credentials are expired.
        self.cache = cache
        self._load_config = load_config
        # client_creator is a callable that creates function.
        # It's basically session.create_client
        self._client_creator = client_creator
        self._profile_name = profile_name
        self._prompter = prompter
        # The _loaded_config attribute will be populated from the
        # load_config() function once the configuration is actually
        # loaded.  The reason we go through all this instead of just
        # requiring that the loaded_config be passed to us is to that
        # we can defer configuration loaded until we actually try
        # to load credentials (as opposed to when the object is
        # instantiated).
        self._loaded_config = {}
        self._credential_sourcer = credential_sourcer
        self._profile_provider_builder = profile_provider_builder
        self._visited_profiles = [self._profile_name]

    def load(self):
        self._loaded_config = self._load_config()
        profiles = self._loaded_config.get('profiles', {})
        profile = profiles.get(self._profile_name, {})
        if self._has_assume_role_config_vars(profile):
            return self._load_creds_via_assume_role(self._profile_name)

    def _has_assume_role_config_vars(self, profile):
        return (
            self.ROLE_CONFIG_VAR in profile
            and
            # We need to ensure this provider doesn't look at a profile when
            # the profile has configuration for web identity. Simply relying on
            # the order in the credential chain is insufficient as it doesn't
            # prevent the case when we're doing an assume role chain.
            self.WEB_IDENTITY_TOKE_FILE_VAR not in profile
        )

    def _load_creds_via_assume_role(self, profile_name):
        role_config = self._get_role_config(profile_name)
        source_credentials = self._resolve_source_credentials(
            role_config, profile_name
        )

        extra_args = {}
        role_session_name = role_config.get('role_session_name')
        if role_session_name is not None:
            extra_args['RoleSessionName'] = role_session_name

        external_id = role_config.get('external_id')
        if external_id is not None:
            extra_args['ExternalId'] = external_id

        mfa_serial = role_config.get('mfa_serial')
        if mfa_serial is not None:
            extra_args['SerialNumber'] = mfa_serial

        duration_seconds = role_config.get('duration_seconds')
        if duration_seconds is not None:
            extra_args['DurationSeconds'] = duration_seconds

        fetcher = AssumeRoleCredentialFetcher(
            client_creator=self._client_creator,
            source_credentials=source_credentials,
            role_arn=role_config['role_arn'],
            extra_args=extra_args,
            mfa_prompter=self._prompter,
            cache=self.cache,
        )
        refresher = fetcher.fetch_credentials
        if mfa_serial is not None:
            refresher = create_mfa_serial_refresher(refresher)

        # The initial credentials are empty and the expiration time is set
        # to now so that we can delay the call to assume role until it is
        # strictly needed.
        return DeferredRefreshableCredentials(
            method=self.METHOD,
            refresh_using=refresher,
            time_fetcher=_local_now,
        )

    def _get_role_config(self, profile_name):
        """Retrieves and validates the role configuration for the profile."""
        profiles = self._loaded_config.get('profiles', {})

        profile = profiles[profile_name]
        source_profile = profile.get('source_profile')
        role_arn = profile['role_arn']
        credential_source = profile.get('credential_source')
        mfa_serial = profile.get('mfa_serial')
        external_id = profile.get('external_id')
        role_session_name = profile.get('role_session_name')
        duration_seconds = profile.get('duration_seconds')

        role_config = {
            'role_arn': role_arn,
            'external_id': external_id,
            'mfa_serial': mfa_serial,
            'role_session_name': role_session_name,
            'source_profile': source_profile,
            'credential_source': credential_source,
        }

        if duration_seconds is not None:
            try:
                role_config['duration_seconds'] = int(duration_seconds)
            except ValueError:
                pass

        # Either the credential source or the source profile must be
        # specified, but not both.
        if credential_source is not None and source_profile is not None:
            raise InvalidConfigError(
                error_msg=(
                    f'The profile "{profile_name}" contains both '
                    'source_profile and credential_source.'
                )
            )
        elif credential_source is None and source_profile is None:
            raise PartialCredentialsError(
                provider=self.METHOD,
                cred_var='source_profile or credential_source',
            )
        elif credential_source is not None:
            self._validate_credential_source(profile_name, credential_source)
        else:
            self._validate_source_profile(profile_name, source_profile)

        return role_config

    def _validate_credential_source(self, parent_profile, credential_source):
        if self._credential_sourcer is None:
            raise InvalidConfigError(
                error_msg=(
                    f"The credential_source \"{credential_source}\" is specified "
                    f"in profile \"{parent_profile}\", "
                    f"but no source provider was configured."
                )
            )
        if not self._credential_sourcer.is_supported(credential_source):
            raise InvalidConfigError(
                error_msg=(
                    f"The credential source \"{credential_source}\" referenced "
                    f"in profile \"{parent_profile}\" is not valid."
                )
            )

    def _source_profile_has_credentials(self, profile):
        return any(
            [
                self._has_static_credentials(profile),
                self._has_assume_role_config_vars(profile),
            ]
        )

    def _validate_source_profile(
        self, parent_profile_name, source_profile_name
    ):
        profiles = self._loaded_config.get('profiles', {})
        if source_profile_name not in profiles:
            raise InvalidConfigError(
                error_msg=(
                    f"The source_profile \"{source_profile_name}\" referenced in "
                    f"the profile \"{parent_profile_name}\" does not exist."
                )
            )

        source_profile = profiles[source_profile_name]

        # Make sure we aren't going into an infinite loop. If we haven't
        # visited the profile yet, we're good.
        if source_profile_name not in self._visited_profiles:
            return

        # If we have visited the profile and the profile isn't simply
        # referencing itself, that's an infinite loop.
        if source_profile_name != parent_profile_name:
            raise InfiniteLoopConfigError(
                source_profile=source_profile_name,
                visited_profiles=self._visited_profiles,
            )

        # A profile is allowed to reference itself so that it can source
        # static credentials and have configuration all in the same
        # profile. This will only ever work for the top level assume
        # role because the static credentials will otherwise take
        # precedence.
        if not self._has_static_credentials(source_profile):
            raise InfiniteLoopConfigError(
                source_profile=source_profile_name,
                visited_profiles=self._visited_profiles,
            )

    def _has_static_credentials(self, profile):
        static_keys = ['aws_secret_access_key', 'aws_access_key_id']
        return any(static_key in profile for static_key in static_keys)

    def _resolve_source_credentials(self, role_config, profile_name):
        credential_source = role_config.get('credential_source')
        if credential_source is not None:
            return self._resolve_credentials_from_source(
                credential_source, profile_name
            )

        source_profile = role_config['source_profile']
        self._visited_profiles.append(source_profile)
        return self._resolve_credentials_from_profile(source_profile)

    def _resolve_credentials_from_profile(self, profile_name):
        profiles = self._loaded_config.get('profiles', {})
        profile = profiles[profile_name]

        if (
            self._has_static_credentials(profile)
            and not self._profile_provider_builder
        ):
            # This is only here for backwards compatibility. If this provider
            # isn't given a profile provider builder we still want to be able
            # handle the basic static credential case as we would before the
            # provile provider builder parameter was added.
            return self._resolve_static_credentials_from_profile(profile)
        elif self._has_static_credentials(
            profile
        ) or not self._has_assume_role_config_vars(profile):
            profile_providers = self._profile_provider_builder.providers(
                profile_name=profile_name,
                disable_env_vars=True,
            )
            profile_chain = CredentialResolver(profile_providers)
            credentials = profile_chain.load_credentials()
            if credentials is None:
                error_message = (
                    'The source profile "%s" must have credentials.'
                )
                raise InvalidConfigError(
                    error_msg=error_message % profile_name,
                )
            return credentials

        return self._load_creds_via_assume_role(profile_name)

    def _resolve_static_credentials_from_profile(self, profile):
        try:
            return Credentials(
                access_key=profile['aws_access_key_id'],
                secret_key=profile['aws_secret_access_key'],
                token=profile.get('aws_session_token'),
            )
        except KeyError as e:
            raise PartialCredentialsError(
                provider=self.METHOD, cred_var=str(e)
            )

    def _resolve_credentials_from_source(
        self, credential_source, profile_name
    ):
        credentials = self._credential_sourcer.source_credentials(
            credential_source
        )
        if credentials is None:
            raise CredentialRetrievalError(
                provider=credential_source,
                error_msg=(
                    'No credentials found in credential_source referenced '
                    f'in profile {profile_name}'
                ),
            )
        return credentials


class AssumeRoleWithWebIdentityProvider(CredentialProvider):
    METHOD = 'assume-role-with-web-identity'
    CANONICAL_NAME = None
    _CONFIG_TO_ENV_VAR = {
        'web_identity_token_file': 'AWS_WEB_IDENTITY_TOKEN_FILE',
        'role_session_name': 'AWS_ROLE_SESSION_NAME',
        'role_arn': 'AWS_ROLE_ARN',
    }

    def __init__(
        self,
        load_config,
        client_creator,
        profile_name,
        cache=None,
        disable_env_vars=False,
        token_loader_cls=None,
    ):
        self.cache = cache
        self._load_config = load_config
        self._client_creator = client_creator
        self._profile_name = profile_name
        self._profile_config = None
        self._disable_env_vars = disable_env_vars
        if token_loader_cls is None:
            token_loader_cls = FileWebIdentityTokenLoader
        self._token_loader_cls = token_loader_cls

    def load(self):
        return self._assume_role_with_web_identity()

    def _get_profile_config(self, key):
        if self._profile_config is None:
            loaded_config = self._load_config()
            profiles = loaded_config.get('profiles', {})
            self._profile_config = profiles.get(self._profile_name, {})
        return self._profile_config.get(key)

    def _get_env_config(self, key):
        if self._disable_env_vars:
            return None
        env_key = self._CONFIG_TO_ENV_VAR.get(key)
        if env_key and env_key in os.environ:
            return os.environ[env_key]
        return None

    def _get_config(self, key):
        env_value = self._get_env_config(key)
        if env_value is not None:
            return env_value
        return self._get_profile_config(key)

    def _assume_role_with_web_identity(self):
        token_path = self._get_config('web_identity_token_file')
        if not token_path:
            return None
        token_loader = self._token_loader_cls(token_path)

        role_arn = self._get_config('role_arn')
        if not role_arn:
            error_msg = (
                'The provided profile or the current environment is '
                'configured to assume role with web identity but has no '
                'role ARN configured. Ensure that the profile has the role_arn'
                'configuration set or the AWS_ROLE_ARN env var is set.'
            )
            raise InvalidConfigError(error_msg=error_msg)

        extra_args = {}
        role_session_name = self._get_config('role_session_name')
        if role_session_name is not None:
            extra_args['RoleSessionName'] = role_session_name

        fetcher = AssumeRoleWithWebIdentityCredentialFetcher(
            client_creator=self._client_creator,
            web_identity_token_loader=token_loader,
            role_arn=role_arn,
            extra_args=extra_args,
            cache=self.cache,
        )
        # The initial credentials are empty and the expiration time is set
        # to now so that we can delay the call to assume role until it is
        # strictly needed.
        return DeferredRefreshableCredentials(
            method=self.METHOD,
            refresh_using=fetcher.fetch_credentials,
        )


class CanonicalNameCredentialSourcer:
    def __init__(self, providers):
        self._providers = providers

    def is_supported(self, source_name):
        """Validates a given source name.

        :type source_name: str
        :param source_name: The value of credential_source in the config
            file. This is the canonical name of the credential provider.

        :rtype: bool
        :returns: True if the credential provider is supported,
            False otherwise.
        """
        return source_name in [p.CANONICAL_NAME for p in self._providers]

    def source_credentials(self, source_name):
        """Loads source credentials based on the provided configuration.

        :type source_name: str
        :param source_name: The value of credential_source in the config
            file. This is the canonical name of the credential provider.

        :rtype: Credentials
        """
        source = self._get_provider(source_name)
        if isinstance(source, CredentialResolver):
            return source.load_credentials()
        return source.load()

    def _get_provider(self, canonical_name):
        """Return a credential provider by its canonical name.

        :type canonical_name: str
        :param canonical_name: The canonical name of the provider.

        :raises UnknownCredentialError: Raised if no
            credential provider by the provided name
            is found.
        """
        provider = self._get_provider_by_canonical_name(canonical_name)

        # The AssumeRole provider should really be part of the SharedConfig
        # provider rather than being its own thing, but it is not. It is
        # effectively part of both the SharedConfig provider and the
        # SharedCredentials provider now due to the way it behaves.
        # Therefore if we want either of those providers we should return
        # the AssumeRole provider with it.
        if canonical_name.lower() in ['sharedconfig', 'sharedcredentials']:
            assume_role_provider = self._get_provider_by_method('assume-role')
            if assume_role_provider is not None:
                # The SharedConfig or SharedCredentials provider may not be
                # present if it was removed for some reason, but the
                # AssumeRole provider could still be present. In that case,
                # return the assume role provider by itself.
                if provider is None:
                    return assume_role_provider

                # If both are present, return them both as a
                # CredentialResolver so that calling code can treat them as
                # a single entity.
                return CredentialResolver([assume_role_provider, provider])

        if provider is None:
            raise UnknownCredentialError(name=canonical_name)

        return provider

    def _get_provider_by_canonical_name(self, canonical_name):
        """Return a credential provider by its canonical name.

        This function is strict, it does not attempt to address
        compatibility issues.
        """
        for provider in self._providers:
            name = provider.CANONICAL_NAME
            # Canonical names are case-insensitive
            if name and name.lower() == canonical_name.lower():
                return provider

    def _get_provider_by_method(self, method):
        """Return a credential provider by its METHOD name."""
        for provider in self._providers:
            if provider.METHOD == method:
                return provider


class ContainerProvider(CredentialProvider):
    METHOD = 'container-role'
    CANONICAL_NAME = 'EcsContainer'
    ENV_VAR = 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'
    ENV_VAR_FULL = 'AWS_CONTAINER_CREDENTIALS_FULL_URI'
    ENV_VAR_AUTH_TOKEN = 'AWS_CONTAINER_AUTHORIZATION_TOKEN'
    ENV_VAR_AUTH_TOKEN_FILE = 'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE'

    def __init__(self, environ=None, fetcher=None):
        if environ is None:
            environ = os.environ
        if fetcher is None:
            fetcher = ContainerMetadataFetcher()
        self._environ = environ
        self._fetcher = fetcher

    def load(self):
        # This cred provider is only triggered if the self.ENV_VAR is set,
        # which only happens if you opt into this feature.
        if self.ENV_VAR in self._environ or self.ENV_VAR_FULL in self._environ:
            return self._retrieve_or_fail()

    def _retrieve_or_fail(self):
        if self._provided_relative_uri():
            full_uri = self._fetcher.full_url(self._environ[self.ENV_VAR])
        else:
            full_uri = self._environ[self.ENV_VAR_FULL]
        fetcher = self._create_fetcher(full_uri)
        creds = fetcher()
        return RefreshableCredentials(
            access_key=creds['access_key'],
            secret_key=creds['secret_key'],
            token=creds['token'],
            method=self.METHOD,
            expiry_time=_parse_if_needed(creds['expiry_time']),
            refresh_using=fetcher,
        )

    def _build_headers(self):
        auth_token = None
        if self.ENV_VAR_AUTH_TOKEN_FILE in self._environ:
            auth_token_file_path = self._environ[self.ENV_VAR_AUTH_TOKEN_FILE]
            with open(auth_token_file_path) as token_file:
                auth_token = token_file.read()
        elif self.ENV_VAR_AUTH_TOKEN in self._environ:
            auth_token = self._environ[self.ENV_VAR_AUTH_TOKEN]
        if auth_token is not None:
            self._validate_auth_token(auth_token)
            return {'Authorization': auth_token}

    def _validate_auth_token(self, auth_token):
        if "\r" in auth_token or "\n" in auth_token:
            raise ValueError("Auth token value is not a legal header value")

    def _create_fetcher(self, full_uri, *args, **kwargs):
        def fetch_creds():
            try:
                headers = self._build_headers()
                response = self._fetcher.retrieve_full_uri(
                    full_uri, headers=headers
                )
            except MetadataRetrievalError as e:
                logger.debug(
                    "Error retrieving container metadata: %s", e, exc_info=True
                )
                raise CredentialRetrievalError(
                    provider=self.METHOD, error_msg=str(e)
                )
            return {
                'access_key': response['AccessKeyId'],
                'secret_key': response['SecretAccessKey'],
                'token': response['Token'],
                'expiry_time': response['Expiration'],
            }

        return fetch_creds

    def _provided_relative_uri(self):
        return self.ENV_VAR in self._environ


class CredentialResolver:
    def __init__(self, providers):
        """

        :param providers: A list of ``CredentialProvider`` instances.

        """
        self.providers = providers

    def insert_before(self, name, credential_provider):
        """
        Inserts a new instance of ``CredentialProvider`` into the chain that
        will be tried before an existing one.

        :param name: The short name of the credentials you'd like to insert the
            new credentials before. (ex. ``env`` or ``config``). Existing names
            & ordering can be discovered via ``self.available_methods``.
        :type name: string

        :param cred_instance: An instance of the new ``Credentials`` object
            you'd like to add to the chain.
        :type cred_instance: A subclass of ``Credentials``
        """
        try:
            offset = [p.METHOD for p in self.providers].index(name)
        except ValueError:
            raise UnknownCredentialError(name=name)
        self.providers.insert(offset, credential_provider)

    def insert_after(self, name, credential_provider):
        """
        Inserts a new type of ``Credentials`` instance into the chain that will
        be tried after an existing one.

        :param name: The short name of the credentials you'd like to insert the
            new credentials after. (ex. ``env`` or ``config``). Existing names
            & ordering can be discovered via ``self.available_methods``.
        :type name: string

        :param cred_instance: An instance of the new ``Credentials`` object
            you'd like to add to the chain.
        :type cred_instance: A subclass of ``Credentials``
        """
        offset = self._get_provider_offset(name)
        self.providers.insert(offset + 1, credential_provider)

    def remove(self, name):
        """
        Removes a given ``Credentials`` instance from the chain.

        :param name: The short name of the credentials instance to remove.
        :type name: string
        """
        available_methods = [p.METHOD for p in self.providers]
        if name not in available_methods:
            # It's not present. Fail silently.
            return

        offset = available_methods.index(name)
        self.providers.pop(offset)

    def get_provider(self, name):
        """Return a credential provider by name.

        :type name: str
        :param name: The name of the provider.

        :raises UnknownCredentialError: Raised if no
            credential provider by the provided name
            is found.
        """
        return self.providers[self._get_provider_offset(name)]

    def _get_provider_offset(self, name):
        try:
            return [p.METHOD for p in self.providers].index(name)
        except ValueError:
            raise UnknownCredentialError(name=name)

    def load_credentials(self):
        """
        Goes through the credentials chain, returning the first ``Credentials``
        that could be loaded.
        """
        # First provider to return a non-None response wins.
        for provider in self.providers:
            logger.debug("Looking for credentials via: %s", provider.METHOD)
            creds = provider.load()
            if creds is not None:
                return creds

        # If we got here, no credentials could be found.
        # This feels like it should be an exception, but historically, ``None``
        # is returned.
        #
        # +1
        # -js
        return None


class SSOCredentialFetcher(CachedCredentialFetcher):
    _UTC_DATE_FORMAT = '%Y-%m-%dT%H:%M:%SZ'

    def __init__(
        self,
        start_url,
        sso_region,
        role_name,
        account_id,
        client_creator,
        token_loader=None,
        cache=None,
        expiry_window_seconds=None,
        token_provider=None,
        sso_session_name=None,
    ):
        self._client_creator = client_creator
        self._sso_region = sso_region
        self._role_name = role_name
        self._account_id = account_id
        self._start_url = start_url
        self._token_loader = token_loader
        self._token_provider = token_provider
        self._sso_session_name = sso_session_name
        super().__init__(cache, expiry_window_seconds)

    def _create_cache_key(self):
        """Create a predictable cache key for the current configuration.

        The cache key is intended to be compatible with file names.
        """
        args = {
            'roleName': self._role_name,
            'accountId': self._account_id,
        }
        if self._sso_session_name:
            args['sessionName'] = self._sso_session_name
        else:
            args['startUrl'] = self._start_url
        # NOTE: It would be good to hoist this cache key construction logic
        # into the CachedCredentialFetcher class as we should be consistent.
        # Unfortunately, the current assume role fetchers that sub class don't
        # pass separators resulting in non-minified JSON. In the long term,
        # all fetchers should use the below caching scheme.
        args = json.dumps(args, sort_keys=True, separators=(',', ':'))
        argument_hash = sha1(args.encode('utf-8')).hexdigest()
        return self._make_file_safe(argument_hash)

    def _parse_timestamp(self, timestamp_ms):
        # fromtimestamp expects seconds so: milliseconds / 1000 = seconds
        timestamp_seconds = timestamp_ms / 1000.0
        timestamp = datetime.datetime.fromtimestamp(timestamp_seconds, tzutc())
        return timestamp.strftime(self._UTC_DATE_FORMAT)

    def _get_credentials(self):
        """Get credentials by calling SSO get role credentials."""
        config = Config(
            signature_version=UNSIGNED,
            region_name=self._sso_region,
        )
        client = self._client_creator('sso', config=config)
        if self._token_provider:
            initial_token_data = self._token_provider.load_token()
            token = initial_token_data.get_frozen_token().token
        else:
            token = self._token_loader(self._start_url)['accessToken']

        kwargs = {
            'roleName': self._role_name,
            'accountId': self._account_id,
            'accessToken': token,
        }
        try:
            response = client.get_role_credentials(**kwargs)
        except client.exceptions.UnauthorizedException:
            raise UnauthorizedSSOTokenError()
        credentials = response['roleCredentials']

        credentials = {
            'ProviderType': 'sso',
            'Credentials': {
                'AccessKeyId': credentials['accessKeyId'],
                'SecretAccessKey': credentials['secretAccessKey'],
                'SessionToken': credentials['sessionToken'],
                'Expiration': self._parse_timestamp(credentials['expiration']),
            },
        }
        return credentials


class SSOProvider(CredentialProvider):
    METHOD = 'sso'

    _SSO_TOKEN_CACHE_DIR = os.path.expanduser(
        os.path.join('~', '.aws', 'sso', 'cache')
    )
    _PROFILE_REQUIRED_CONFIG_VARS = (
        'sso_role_name',
        'sso_account_id',
    )
    _SSO_REQUIRED_CONFIG_VARS = (
        'sso_start_url',
        'sso_region',
    )
    _ALL_REQUIRED_CONFIG_VARS = (
        _PROFILE_REQUIRED_CONFIG_VARS + _SSO_REQUIRED_CONFIG_VARS
    )

    def __init__(
        self,
        load_config,
        client_creator,
        profile_name,
        cache=None,
        token_cache=None,
        token_provider=None,
    ):
        if token_cache is None:
            token_cache = JSONFileCache(self._SSO_TOKEN_CACHE_DIR)
        self._token_cache = token_cache
        self._token_provider = token_provider
        if cache is None:
            cache = {}
        self.cache = cache
        self._load_config = load_config
        self._client_creator = client_creator
        self._profile_name = profile_name

    def _load_sso_config(self):
        loaded_config = self._load_config()
        profiles = loaded_config.get('profiles', {})
        profile_name = self._profile_name
        profile_config = profiles.get(self._profile_name, {})
        sso_sessions = loaded_config.get('sso_sessions', {})

        # Role name & Account ID indicate the cred provider should be used
        if all(
            c not in profile_config for c in self._PROFILE_REQUIRED_CONFIG_VARS
        ):
            return None

        resolved_config, extra_reqs = self._resolve_sso_session_reference(
            profile_config, sso_sessions
        )

        config = {}
        missing_config_vars = []
        all_required_configs = self._ALL_REQUIRED_CONFIG_VARS + extra_reqs
        for config_var in all_required_configs:
            if config_var in resolved_config:
                config[config_var] = resolved_config[config_var]
            else:
                missing_config_vars.append(config_var)

        if missing_config_vars:
            missing = ', '.join(missing_config_vars)
            raise InvalidConfigError(
                error_msg=(
                    f'The profile "{profile_name}" is configured to use SSO '
                    f'but is missing required configuration: {missing}'
                )
            )
        return config

    def _resolve_sso_session_reference(self, profile_config, sso_sessions):
        sso_session_name = profile_config.get('sso_session')
        if sso_session_name is None:
            # No reference to resolve, proceed with legacy flow
            return profile_config, ()

        if sso_session_name not in sso_sessions:
            error_msg = f'The specified sso-session does not exist: "{sso_session_name}"'
            raise InvalidConfigError(error_msg=error_msg)

        config = profile_config.copy()
        session = sso_sessions[sso_session_name]
        for config_var, val in session.items():
            # Validate any keys referenced in both profile and sso_session match
            if config.get(config_var, val) != val:
                error_msg = (
                    f"The value for {config_var} is inconsistent between "
                    f"profile ({config[config_var]}) and sso-session ({val})."
                )
                raise InvalidConfigError(error_msg=error_msg)
            config[config_var] = val
        return config, ('sso_session',)

    def load(self):
        sso_config = self._load_sso_config()
        if not sso_config:
            return None

        fetcher_kwargs = {
            'start_url': sso_config['sso_start_url'],
            'sso_region': sso_config['sso_region'],
            'role_name': sso_config['sso_role_name'],
            'account_id': sso_config['sso_account_id'],
            'client_creator': self._client_creator,
            'token_loader': SSOTokenLoader(cache=self._token_cache),
            'cache': self.cache,
        }
        if 'sso_session' in sso_config:
            fetcher_kwargs['sso_session_name'] = sso_config['sso_session']
            fetcher_kwargs['token_provider'] = self._token_provider

        sso_fetcher = SSOCredentialFetcher(**fetcher_kwargs)

        return DeferredRefreshableCredentials(
            method=self.METHOD,
            refresh_using=sso_fetcher.fetch_credentials,
        )
