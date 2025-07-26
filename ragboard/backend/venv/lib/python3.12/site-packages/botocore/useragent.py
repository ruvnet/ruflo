# Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
"""
NOTE: All classes and functions in this module are considered private and are
subject to abrupt breaking changes. Please do not use them directly.

To modify the User-Agent header sent by botocore, use one of these
configuration options:
* The ``AWS_SDK_UA_APP_ID`` environment variable.
* The ``sdk_ua_app_id`` setting in the shared AWS config file.
* The ``user_agent_appid`` field in the :py:class:`botocore.config.Config`.
* The ``user_agent_extra`` field in the :py:class:`botocore.config.Config`.

"""

import os
import platform
from copy import copy
from string import ascii_letters, digits
from typing import NamedTuple, Optional

from botocore import __version__ as botocore_version
from botocore.compat import HAS_CRT

_USERAGENT_ALLOWED_CHARACTERS = ascii_letters + digits + "!$%&'*+-.^_`|~"
_USERAGENT_ALLOWED_OS_NAMES = (
    'windows',
    'linux',
    'macos',
    'android',
    'ios',
    'watchos',
    'tvos',
    'other',
)
_USERAGENT_PLATFORM_NAME_MAPPINGS = {'darwin': 'macos'}
# The name by which botocore is identified in the User-Agent header. While most
# AWS SDKs follow a naming pattern of "aws-sdk-*", botocore and boto3 continue
# using their existing values. Uses uppercase "B" with all other characters
# lowercase.
_USERAGENT_SDK_NAME = 'Botocore'


def sanitize_user_agent_string_component(raw_str, allow_hash):
    """Replaces all not allowed characters in the string with a dash ("-").

    Allowed characters are ASCII alphanumerics and ``!$%&'*+-.^_`|~``. If
    ``allow_hash`` is ``True``, "#"``" is also allowed.

    :type raw_str: str
    :param raw_str: The input string to be sanitized.

    :type allow_hash: bool
    :param allow_hash: Whether "#" is considered an allowed character.
    """
    return ''.join(
        c
        if c in _USERAGENT_ALLOWED_CHARACTERS or (allow_hash and c == '#')
        else '-'
        for c in raw_str
    )


class UserAgentComponent(NamedTuple):
    """
    Component of a Botocore User-Agent header string in the standard format.

    Each component consists of a prefix, a name, and a value. In the string
    representation these are combined in the format ``prefix/name#value``.

    This class is considered private and is subject to abrupt breaking changes.
    """

    prefix: str
    name: str
    value: Optional[str] = None

    def to_string(self):
        """Create string like 'prefix/name#value' from a UserAgentComponent."""
        clean_prefix = sanitize_user_agent_string_component(
            self.prefix, allow_hash=True
        )
        clean_name = sanitize_user_agent_string_component(
            self.name, allow_hash=False
        )
        if self.value is None or self.value == '':
            return f'{clean_prefix}/{clean_name}'
        clean_value = sanitize_user_agent_string_component(
            self.value, allow_hash=True
        )
        return f'{clean_prefix}/{clean_name}#{clean_value}'


class RawStringUserAgentComponent:
    """
    UserAgentComponent interface wrapper around ``str``.

    Use for User-Agent header components that are not constructed from
    prefix+name+value but instead are provided as strings. No sanitization is
    performed.
    """

    def __init__(self, value):
        self._value = value

    def to_string(self):
        return self._value


# This is not a public interface and is subject to abrupt breaking changes.
# Any usage is not advised or supported in external code bases.
try:
    from botocore.customizations.useragent import modify_components
except ImportError:
    # Default implementation that returns unmodified User-Agent components.
    def modify_components(components):
        return components


class UserAgentString:
    """
    Generator for AWS SDK User-Agent header strings.

    The User-Agent header format contains information from session, client, and
    request context. ``UserAgentString`` provides methods for collecting the
    information and ``to_string`` for assembling it into the standardized
    string format.

    Example usage:

        ua_session = UserAgentString.from_environment()
        ua_session.set_session_config(...)
        ua_client = ua_session.with_client_config(Config(...))
        ua_string = ua_request.to_string()

    For testing or when information from all sources is available at the same
    time, the methods can be chained:

        ua_string = (
            UserAgentString
            .from_environment()
            .set_session_config(...)
            .with_client_config(Config(...))
            .to_string()
        )

    """

    def __init__(
        self,
        platform_name,
        platform_version,
        platform_machine,
        python_version,
        python_implementation,
        execution_env,
        crt_version=None,
    ):
        """
        :type platform_name: str
        :param platform_name: Name of the operating system or equivalent
            platform name. Should be sourced from :py:meth:`platform.system`.
        :type platform_version: str
        :param platform_version: Version of the operating system or equivalent
            platform name. Should be sourced from :py:meth:`platform.version`.
        :type platform_machine: str
        :param platform_version: Processor architecture or machine type. For
        example "x86_64". Should be sourced from :py:meth:`platform.machine`.
        :type python_version: str
        :param python_version: Version of the python implementation as str.
            Should be sourced from :py:meth:`platform.python_version`.
        :type python_implementation: str
        :param python_implementation: Name of the python implementation.
            Should be sourced from :py:meth:`platform.python_implementation`.
        :type execution_env: str
        :param execution_env: The value of the AWS execution environment.
            Should be sourced from the ``AWS_EXECUTION_ENV` environment
            variable.
        :type crt_version: str
        :param crt_version: Version string of awscrt package, if installed.
        """
        self._platform_name = platform_name
        self._platform_version = platform_version
        self._platform_machine = platform_machine
        self._python_version = python_version
        self._python_implementation = python_implementation
        self._execution_env = execution_env
        self._crt_version = crt_version

        # Components that can be added with ``set_session_config()``
        self._session_user_agent_name = None
        self._session_user_agent_version = None
        self._session_user_agent_extra = None

        self._client_config = None
        self._uses_paginator = None
        self._uses_waiter = None
        self._uses_resource = None

    @classmethod
    def from_environment(cls):
        crt_version = None
        if HAS_CRT:
            crt_version = _get_crt_version() or 'Unknown'
        return cls(
            platform_name=platform.system(),
            platform_version=platform.release(),
            platform_machine=platform.machine(),
            python_version=platform.python_version(),
            python_implementation=platform.python_implementation(),
            execution_env=os.environ.get('AWS_EXECUTION_ENV'),
            crt_version=crt_version,
        )

    def set_session_config(
        self,
        session_user_agent_name,
        session_user_agent_version,
        session_user_agent_extra,
    ):
        """
        Set the user agent configuration values that apply at session level.

        :param user_agent_name: The user agent name configured in the
            :py:class:`botocore.session.Session` object. For backwards
            compatibility, this will always be at the beginning of the
            User-Agent string, together with ``user_agent_version``.
        :param user_agent_version: The user agent version configured in the
            :py:class:`botocore.session.Session` object.
        :param user_agent_extra: The user agent "extra" configured in the
            :py:class:`botocore.session.Session` object.
        """
        self._session_user_agent_name = session_user_agent_name
        self._session_user_agent_version = session_user_agent_version
        self._session_user_agent_extra = session_user_agent_extra
        return self

    def with_client_config(self, client_config):
        """
        Create a copy with all original values and client-specific values.

        :type client_config: botocore.config.Config
        :param client_config: The client configuration object.
        """
        cp = copy(self)
        cp._client_config = client_config
        return cp

    def to_string(self):
        """
        Build User-Agent header string from the object's properties.
        """
        config_ua_override = None
        if self._client_config:
            if hasattr(self._client_config, '_supplied_user_agent'):
                config_ua_override = self._client_config._supplied_user_agent
            else:
                config_ua_override = self._client_config.user_agent

        if config_ua_override is not None:
            return self._build_legacy_ua_string(config_ua_override)

        components = [
            *self._build_sdk_metadata(),
            RawStringUserAgentComponent('ua/2.0'),
            *self._build_os_metadata(),
            *self._build_architecture_metadata(),
            *self._build_language_metadata(),
            *self._build_execution_env_metadata(),
            *self._build_feature_metadata(),
            *self._build_config_metadata(),
            *self._build_app_id(),
            *self._build_extra(),
        ]

        components = modify_components(components)

        return ' '.join([comp.to_string() for comp in components])

    def _build_sdk_metadata(self):
        """
        Build the SDK name and version component of the User-Agent header.

        For backwards-compatibility both session-level and client-level config
        of custom tool names are honored. If this removes the Botocore
        information from the start of the string, Botocore's name and version
        are included as a separate field with "md" prefix.
        """
        sdk_md = []
        if (
            self._session_user_agent_name
            and self._session_user_agent_version
            and (
                self._session_user_agent_name != _USERAGENT_SDK_NAME
                or self._session_user_agent_version != botocore_version
            )
        ):
            sdk_md.extend(
                [
                    UserAgentComponent(
                        self._session_user_agent_name,
                        self._session_user_agent_version,
                    ),
                    UserAgentComponent(
                        'md', _USERAGENT_SDK_NAME, botocore_version
                    ),
                ]
            )
        else:
            sdk_md.append(
                UserAgentComponent(_USERAGENT_SDK_NAME, botocore_version)
            )

        if self._crt_version is not None:
            sdk_md.append(
                UserAgentComponent('md', 'awscrt', self._crt_version)
            )

        return sdk_md

    def _build_os_metadata(self):
        """
        Build the OS/platform components of the User-Agent header string.

        For recognized platform names that match or map to an entry in the list
        of standardized OS names, a single component with prefix "os" is
        returned. Otherwise, one component "os/other" is returned and a second
        with prefix "md" and the raw platform name.

        String representations of example return values:
         * ``os/macos#10.13.6``
         * ``os/linux``
         * ``os/other``
         * ``os/other md/foobar#1.2.3``
        """
        if self._platform_name is None:
            return [UserAgentComponent('os', 'other')]

        plt_name_lower = self._platform_name.lower()
        if plt_name_lower in _USERAGENT_ALLOWED_OS_NAMES:
            os_family = plt_name_lower
        elif plt_name_lower in _USERAGENT_PLATFORM_NAME_MAPPINGS:
            os_family = _USERAGENT_PLATFORM_NAME_MAPPINGS[plt_name_lower]
        else:
            os_family = None

        if os_family is not None:
            return [
                UserAgentComponent('os', os_family, self._platform_version)
            ]
        else:
            return [
                UserAgentComponent('os', 'other'),
                UserAgentComponent(
                    'md', self._platform_name, self._platform_version
                ),
            ]

    def _build_architecture_metadata(self):
        """
        Build architecture component of the User-Agent header string.

        Returns the machine type with prefix "md" and name "arch", if one is
        available. Common values include "x86_64", "arm64", "i386".
        """
        if self._platform_machine:
            return [
                UserAgentComponent(
                    'md', 'arch', self._platform_machine.lower()
                )
            ]
        return []

    def _build_language_metadata(self):
        """
        Build the language components of the User-Agent header string.

        Returns the Python version in a component with prefix "lang" and name
        "python". The Python implementation (e.g. CPython, PyPy) is returned as
        separate metadata component with prefix "md" and name "pyimpl".

        String representation of an example return value:
        ``lang/python#3.10.4 md/pyimpl#CPython``
        """
        lang_md = [
            UserAgentComponent('lang', 'python', self._python_version),
        ]
        if self._python_implementation:
            lang_md.append(
                UserAgentComponent('md', 'pyimpl', self._python_implementation)
            )
        return lang_md

    def _build_execution_env_metadata(self):
        """
        Build the execution environment component of the User-Agent header.

        Returns a single component prefixed with "exec-env", usually sourced
        from the environment variable AWS_EXECUTION_ENV.
        """
        if self._execution_env:
            return [UserAgentComponent('exec-env', self._execution_env)]
        else:
            return []

    def _build_feature_metadata(self):
        """
        Build the features components of the User-Agent header string.

        Botocore currently does not report any features. This may change in a
        future version.
        """
        return []

    def _build_config_metadata(self):
        """
        Build the configuration components of the User-Agent header string.

        Returns a list of components with prefix "cfg" followed by the config
        setting name and its value. Tracked configuration settings may be
        added or removed in future versions.
        """
        if not self._client_config or not self._client_config.retries:
            return []
        retry_mode = self._client_config.retries.get('mode')
        cfg_md = [UserAgentComponent('cfg', 'retry-mode', retry_mode)]
        if self._client_config.endpoint_discovery_enabled:
            cfg_md.append(UserAgentComponent('cfg', 'endpoint-discovery'))
        return cfg_md

    def _build_app_id(self):
        """
        Build app component of the User-Agent header string.

        Returns a single component with prefix "app" and value sourced from the
        ``user_agent_appid`` field in :py:class:`botocore.config.Config` or
        the ``sdk_ua_app_id`` setting in the shared configuration file, or the
        ``AWS_SDK_UA_APP_ID`` environment variable. These are the recommended
        ways for apps built with Botocore to insert their identifer into the
        User-Agent header.
        """
        if self._client_config and self._client_config.user_agent_appid:
            return [
                UserAgentComponent('app', self._client_config.user_agent_appid)
            ]
        else:
            return []

    def _build_extra(self):
        """User agent string components based on legacy "extra" settings.

        Creates components from the session-level and client-level
        ``user_agent_extra`` setting, if present. Both are passed through
        verbatim and should be appended at the end of the string.

        Preferred ways to inject application-specific information into
        botocore's User-Agent header string are the ``user_agent_appid` field
        in :py:class:`botocore.config.Config`. The ``AWS_SDK_UA_APP_ID``
        environment variable and the ``sdk_ua_app_id`` configuration file
        setting are alternative ways to set the ``user_agent_appid`` config.
        """
        extra = []
        if self._session_user_agent_extra:
            extra.append(
                RawStringUserAgentComponent(self._session_user_agent_extra)
            )
        if self._client_config and self._client_config.user_agent_extra:
            extra.append(
                RawStringUserAgentComponent(
                    self._client_config.user_agent_extra
                )
            )
        return extra

    def _build_legacy_ua_string(self, config_ua_override):
        components = [config_ua_override]
        if self._session_user_agent_extra:
            components.append(self._session_user_agent_extra)
        if self._client_config.user_agent_extra:
            components.append(self._client_config.user_agent_extra)
        return ' '.join(components)


def _get_crt_version():
    """
    This function is considered private and is subject to abrupt breaking
    changes.
    """
    try:
        import awscrt

        return awscrt.__version__
    except AttributeError:
        return None
