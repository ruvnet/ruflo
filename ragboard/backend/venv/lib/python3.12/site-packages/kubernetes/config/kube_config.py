# Copyright 2018 The Kubernetes Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import atexit
import base64
import copy
import datetime
import json
import logging
import os
import platform
import subprocess
import tempfile
import time
from collections import namedtuple

import google.auth
import google.auth.transport.requests
import oauthlib.oauth2
import urllib3
import yaml
from requests_oauthlib import OAuth2Session
from six import PY3

from kubernetes.client import ApiClient, Configuration
from kubernetes.config.exec_provider import ExecProvider

from .config_exception import ConfigException
from .dateutil import UTC, format_rfc3339, parse_rfc3339

try:
    import adal
except ImportError:
    pass

EXPIRY_SKEW_PREVENTION_DELAY = datetime.timedelta(minutes=5)
KUBE_CONFIG_DEFAULT_LOCATION = os.environ.get('KUBECONFIG', '~/.kube/config')
ENV_KUBECONFIG_PATH_SEPARATOR = ';' if platform.system() == 'Windows' else ':'
_temp_files = {}


def _cleanup_temp_files():
    global _temp_files
    for temp_file in _temp_files.values():
        try:
            os.remove(temp_file)
        except OSError:
            pass
    _temp_files = {}


def _create_temp_file_with_content(content, temp_file_path=None):
    if len(_temp_files) == 0:
        atexit.register(_cleanup_temp_files)
    # Because we may change context several times, try to remember files we
    # created and reuse them at a small memory cost.
    content_key = str(content)
    if content_key in _temp_files:
        return _temp_files[content_key]
    if temp_file_path and not os.path.isdir(temp_file_path):
        os.makedirs(name=temp_file_path)
    fd, name = tempfile.mkstemp(dir=temp_file_path)
    os.close(fd)
    _temp_files[content_key] = name
    with open(name, 'wb') as fd:
        fd.write(content.encode() if isinstance(content, str) else content)
    return name


def _is_expired(expiry):
    return ((parse_rfc3339(expiry) - EXPIRY_SKEW_PREVENTION_DELAY) <=
            datetime.datetime.now(tz=UTC))


class FileOrData(object):
    """Utility class to read content of obj[%data_key_name] or file's
     content of obj[%file_key_name] and represent it as file or data.
     Note that the data is preferred. The obj[%file_key_name] will be used iff
     obj['%data_key_name'] is not set or empty. Assumption is file content is
     raw data and data field is base64 string. The assumption can be changed
     with base64_file_content flag. If set to False, the content of the file
     will assumed to be base64 and read as is. The default True value will
     result in base64 encode of the file content after read."""

    def __init__(self, obj, file_key_name, data_key_name=None,
                 file_base_path="", base64_file_content=True,
                 temp_file_path=None):
        if not data_key_name:
            data_key_name = file_key_name + "-data"
        self._file = None
        self._data = None
        self._base64_file_content = base64_file_content
        self._temp_file_path = temp_file_path
        if not obj:
            return
        if data_key_name in obj:
            self._data = obj[data_key_name]
        elif file_key_name in obj:
            self._file = os.path.normpath(
                os.path.join(file_base_path, obj[file_key_name]))

    def as_file(self):
        """If obj[%data_key_name] exists, return name of a file with base64
        decoded obj[%data_key_name] content otherwise obj[%file_key_name]."""
        use_data_if_no_file = not self._file and self._data
        if use_data_if_no_file:
            if self._base64_file_content:
                if isinstance(self._data, str):
                    content = self._data.encode()
                else:
                    content = self._data
                self._file = _create_temp_file_with_content(
                    base64.standard_b64decode(content), self._temp_file_path)
            else:
                self._file = _create_temp_file_with_content(
                    self._data, self._temp_file_path)
        if self._file and not os.path.isfile(self._file):
            raise ConfigException("File does not exist: %s" % self._file)
        return self._file

    def as_data(self):
        """If obj[%data_key_name] exists, Return obj[%data_key_name] otherwise
        base64 encoded string of obj[%file_key_name] file content."""
        use_file_if_no_data = not self._data and self._file
        if use_file_if_no_data:
            with open(self._file) as f:
                if self._base64_file_content:
                    self._data = bytes.decode(
                        base64.standard_b64encode(str.encode(f.read())))
                else:
                    self._data = f.read()
        return self._data


class CommandTokenSource(object):
    def __init__(self, cmd, args, tokenKey, expiryKey):
        self._cmd = cmd
        self._args = args
        if not tokenKey:
            self._tokenKey = '{.access_token}'
        else:
            self._tokenKey = tokenKey
        if not expiryKey:
            self._expiryKey = '{.token_expiry}'
        else:
            self._expiryKey = expiryKey

    def token(self):
        fullCmd = self._cmd + (" ") + " ".join(self._args)
        process = subprocess.Popen(
            [self._cmd] + self._args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True)
        (stdout, stderr) = process.communicate()
        exit_code = process.wait()
        if exit_code != 0:
            msg = 'cmd-path: process returned %d' % exit_code
            msg += "\nCmd: %s" % fullCmd
            stderr = stderr.strip()
            if stderr:
                msg += '\nStderr: %s' % stderr
            raise ConfigException(msg)
        try:
            data = json.loads(stdout)
        except ValueError as de:
            raise ConfigException(
                'exec: failed to decode process output: %s' % de)
        A = namedtuple('A', ['token', 'expiry'])
        return A(
            token=data['credential']['access_token'],
            expiry=parse_rfc3339(data['credential']['token_expiry']))


class KubeConfigLoader(object):

    def __init__(self, config_dict, active_context=None,
                 get_google_credentials=None,
                 config_base_path="",
                 config_persister=None,
                 temp_file_path=None):

        if config_dict is None:
            raise ConfigException(
                'Invalid kube-config. '
                'Expected config_dict to not be None.')
        elif isinstance(config_dict, ConfigNode):
            self._config = config_dict
        else:
            self._config = ConfigNode('kube-config', config_dict)

        self._current_context = None
        self._user = None
        self._cluster = None
        self.set_active_context(active_context)
        self._config_base_path = config_base_path
        self._config_persister = config_persister
        self._temp_file_path = temp_file_path

        def _refresh_credentials_with_cmd_path():
            config = self._user['auth-provider']['config']
            cmd = config['cmd-path']
            if len(cmd) == 0:
                raise ConfigException(
                    'missing access token cmd '
                    '(cmd-path is an empty string in your kubeconfig file)')
            if 'scopes' in config and config['scopes'] != "":
                raise ConfigException(
                    'scopes can only be used '
                    'when kubectl is using a gcp service account key')
            args = []
            if 'cmd-args' in config:
                args = config['cmd-args'].split()
            else:
                fields = config['cmd-path'].split()
                cmd = fields[0]
                args = fields[1:]

            commandTokenSource = CommandTokenSource(
                cmd, args,
                config.safe_get('token-key'),
                config.safe_get('expiry-key'))
            return commandTokenSource.token()

        def _refresh_credentials():
            # Refresh credentials using cmd-path
            if ('auth-provider' in self._user and
                'config' in self._user['auth-provider'] and
                    'cmd-path' in self._user['auth-provider']['config']):
                return _refresh_credentials_with_cmd_path()

            credentials, project_id = google.auth.default(scopes=[
                'https://www.googleapis.com/auth/cloud-platform',
                'https://www.googleapis.com/auth/userinfo.email'
            ])
            request = google.auth.transport.requests.Request()
            credentials.refresh(request)
            return credentials

        if get_google_credentials:
            self._get_google_credentials = get_google_credentials
        else:
            self._get_google_credentials = _refresh_credentials

    def set_active_context(self, context_name=None):
        if context_name is None:
            context_name = self._config['current-context']
        self._current_context = self._config['contexts'].get_with_name(
            context_name)
        if (self._current_context['context'].safe_get('user') and
                self._config.safe_get('users')):
            user = self._config['users'].get_with_name(
                self._current_context['context']['user'], safe=True)
            if user:
                self._user = user['user']
            else:
                self._user = None
        else:
            self._user = None
        self._cluster = self._config['clusters'].get_with_name(
            self._current_context['context']['cluster'])['cluster']

    def _load_authentication(self):
        """Read authentication from kube-config user section if exists.

        This function goes through various authentication methods in user
        section of kube-config and stops if it finds a valid authentication
        method. The order of authentication methods is:

            1. auth-provider (gcp, azure, oidc)
            2. token field (point to a token file)
            3. exec provided plugin
            4. username/password
        """
        if not self._user:
            return
        if self._load_auth_provider_token():
            return
        if self._load_user_token():
            return
        if self._load_from_exec_plugin():
            return
        self._load_user_pass_token()

    def _load_auth_provider_token(self):
        if 'auth-provider' not in self._user:
            return
        provider = self._user['auth-provider']
        if 'name' not in provider:
            return
        if provider['name'] == 'gcp':
            return self._load_gcp_token(provider)
        if provider['name'] == 'azure':
            return self._load_azure_token(provider)
        if provider['name'] == 'oidc':
            return self._load_oid_token(provider)

    def _azure_is_expired(self, provider):
        expires_on = provider['config']['expires-on']
        if expires_on.isdigit():
            return int(expires_on) < time.time()
        else:
            exp_time = time.strptime(expires_on, '%Y-%m-%d %H:%M:%S.%f')
            return exp_time < time.gmtime()

    def _load_azure_token(self, provider):
        if 'config' not in provider:
            return
        if 'access-token' not in provider['config']:
            return
        if 'expires-on' in provider['config']:
            if self._azure_is_expired(provider):
                self._refresh_azure_token(provider['config'])
        self.token = 'Bearer %s' % provider['config']['access-token']
        return self.token

    def _refresh_azure_token(self, config):
        if 'adal' not in globals():
            raise ImportError('refresh token error, adal library not imported')

        tenant = config['tenant-id']
        authority = 'https://login.microsoftonline.com/{}'.format(tenant)
        context = adal.AuthenticationContext(
            authority, validate_authority=True, api_version='1.0'
        )
        refresh_token = config['refresh-token']
        client_id = config['client-id']
        apiserver_id = '00000002-0000-0000-c000-000000000000'
        try:
            apiserver_id = config['apiserver-id']
        except ConfigException:
            # We've already set a default above
            pass
        token_response = context.acquire_token_with_refresh_token(
            refresh_token, client_id, apiserver_id)

        provider = self._user['auth-provider']['config']
        provider.value['access-token'] = token_response['accessToken']
        provider.value['expires-on'] = token_response['expiresOn']
        if self._config_persister:
            self._config_persister()

    def _load_gcp_token(self, provider):
        if (('config' not in provider) or
                ('access-token' not in provider['config']) or
                ('expiry' in provider['config'] and
                 _is_expired(provider['config']['expiry']))):
            # token is not available or expired, refresh it
            self._refresh_gcp_token()

        self.token = "Bearer %s" % provider['config']['access-token']
        if 'expiry' in provider['config']:
            self.expiry = parse_rfc3339(provider['config']['expiry'])
        return self.token

    def _refresh_gcp_token(self):
        if 'config' not in self._user['auth-provider']:
            self._user['auth-provider'].value['config'] = {}
        provider = self._user['auth-provider']['config']
        credentials = self._get_google_credentials()
        provider.value['access-token'] = credentials.token
        provider.value['expiry'] = format_rfc3339(credentials.expiry)
        if self._config_persister:
            self._config_persister()

    def _load_oid_token(self, provider):
        if 'config' not in provider:
            return

        reserved_characters = frozenset(["=", "+", "/"])
        token = provider['config']['id-token']

        if any(char in token for char in reserved_characters):
            # Invalid jwt, as it contains url-unsafe chars
            return

        parts = token.split('.')
        if len(parts) != 3:  # Not a valid JWT
            return

        padding = (4 - len(parts[1]) % 4) * '='
        if len(padding) == 3:
            # According to spec, 3 padding characters cannot occur
            # in a valid jwt
            # https://tools.ietf.org/html/rfc7515#appendix-C
            return

        if PY3:
            jwt_attributes = json.loads(
                base64.urlsafe_b64decode(parts[1] + padding).decode('utf-8')
            )
        else:
            jwt_attributes = json.loads(
                base64.b64decode(parts[1] + padding)
            )

        expire = jwt_attributes.get('exp')

        if ((expire is not None) and
            (_is_expired(datetime.datetime.fromtimestamp(expire,
                                                         tz=UTC)))):
            self._refresh_oidc(provider)

            if self._config_persister:
                self._config_persister()

        self.token = "Bearer %s" % provider['config']['id-token']

        return self.token

    def _refresh_oidc(self, provider):
        config = Configuration()

        if 'idp-certificate-authority-data' in provider['config']:
            ca_cert = tempfile.NamedTemporaryFile(delete=True)

            if PY3:
                cert = base64.b64decode(
                    provider['config']['idp-certificate-authority-data']
                ).decode('utf-8')
            else:
                cert = base64.b64decode(
                    provider['config']['idp-certificate-authority-data'] + "=="
                )

            with open(ca_cert.name, 'w') as fh:
                fh.write(cert)

            config.ssl_ca_cert = ca_cert.name

        elif 'idp-certificate-authority' in provider['config']:
            config.ssl_ca_cert = provider['config']['idp-certificate-authority']

        else:
            config.verify_ssl = False

        client = ApiClient(configuration=config)

        response = client.request(
            method="GET",
            url="%s/.well-known/openid-configuration"
            % provider['config']['idp-issuer-url']
        )

        if response.status != 200:
            return

        response = json.loads(response.data)

        request = OAuth2Session(
            client_id=provider['config']['client-id'],
            token=provider['config']['refresh-token'],
            auto_refresh_kwargs={
                'client_id': provider['config']['client-id'],
                'client_secret': provider['config']['client-secret']
            },
            auto_refresh_url=response['token_endpoint']
        )

        try:
            refresh = request.refresh_token(
                token_url=response['token_endpoint'],
                refresh_token=provider['config']['refresh-token'],
                auth=(provider['config']['client-id'],
                      provider['config']['client-secret']),
                verify=config.ssl_ca_cert if config.verify_ssl else None
            )
        except oauthlib.oauth2.rfc6749.errors.InvalidClientIdError:
            return

        provider['config'].value['id-token'] = refresh['id_token']
        provider['config'].value['refresh-token'] = refresh['refresh_token']

    def _load_from_exec_plugin(self):
        if 'exec' not in self._user:
            return
        try:
            base_path = self._get_base_path(self._cluster.path)
            status = ExecProvider(self._user['exec'], base_path, self._cluster).run()
            if 'token' in status:
                self.token = "Bearer %s" % status['token']
            elif 'clientCertificateData' in status:
                # https://kubernetes.io/docs/reference/access-authn-authz/authentication/#input-and-output-formats
                # Plugin has provided certificates instead of a token.
                if 'clientKeyData' not in status:
                    logging.error('exec: missing clientKeyData field in '
                                  'plugin output')
                    return None
                self.cert_file = FileOrData(
                    status, None,
                    data_key_name='clientCertificateData',
                    file_base_path=base_path,
                    base64_file_content=False,
                    temp_file_path=self._temp_file_path).as_file()
                self.key_file = FileOrData(
                    status, None,
                    data_key_name='clientKeyData',
                    file_base_path=base_path,
                    base64_file_content=False,
                    temp_file_path=self._temp_file_path).as_file()
            else:
                logging.error('exec: missing token or clientCertificateData '
                              'field in plugin output')
                return None
            if 'expirationTimestamp' in status:
                self.expiry = parse_rfc3339(status['expirationTimestamp'])
            return True
        except Exception as e:
            logging.error(str(e))

    def _load_user_token(self):
        base_path = self._get_base_path(self._user.path)
        token = FileOrData(
            self._user, 'tokenFile', 'token',
            file_base_path=base_path,
            base64_file_content=False,
            temp_file_path=self._temp_file_path).as_data()
        if token:
            self.token = "Bearer %s" % token
            return True

    def _load_user_pass_token(self):
        if 'username' in self._user and 'password' in self._user:
            self.token = urllib3.util.make_headers(
                basic_auth=(self._user['username'] + ':' +
                            self._user['password'])).get('authorization')
            return True

    def _get_base_path(self, config_path):
        if self._config_base_path is not None:
            return self._config_base_path
        if config_path is not None:
            return os.path.abspath(os.path.dirname(config_path))
        return ""

    def _load_cluster_info(self):
        if 'server' in self._cluster:
            self.host = self._cluster['server'].rstrip('/')
            if self.host.startswith("https"):
                base_path = self._get_base_path(self._cluster.path)
                self.ssl_ca_cert = FileOrData(
                    self._cluster, 'certificate-authority',
                    file_base_path=base_path,
                    temp_file_path=self._temp_file_path).as_file()
                if 'cert_file' not in self.__dict__:
                    # cert_file could have been provided by
                    # _load_from_exec_plugin; only load from the _user
                    # section if we need it.
                    self.cert_file = FileOrData(
                        self._user, 'client-certificate',
                        file_base_path=base_path,
                        temp_file_path=self._temp_file_path).as_file()
                    self.key_file = FileOrData(
                        self._user, 'client-key',
                        file_base_path=base_path,
                        temp_file_path=self._temp_file_path).as_file()
        if 'insecure-skip-tls-verify' in self._cluster:
            self.verify_ssl = not self._cluster['insecure-skip-tls-verify']
        if 'tls-server-name' in self._cluster:
            self.tls_server_name = self._cluster['tls-server-name']

    def _set_config(self, client_configuration):
        if 'token' in self.__dict__:
            client_configuration.api_key['authorization'] = self.token

            def _refresh_api_key(client_configuration):
                if ('expiry' in self.__dict__ and _is_expired(self.expiry)):
                    self._load_authentication()
                self._set_config(client_configuration)
            client_configuration.refresh_api_key_hook = _refresh_api_key
        # copy these keys directly from self to configuration object
        keys = ['host', 'ssl_ca_cert', 'cert_file', 'key_file', 'verify_ssl','tls_server_name']
        for key in keys:
            if key in self.__dict__:
                setattr(client_configuration, key, getattr(self, key))

    def load_and_set(self, client_configuration):
        self._load_authentication()
        self._load_cluster_info()
        self._set_config(client_configuration)

    def list_contexts(self):
        return [context.value for context in self._config['contexts']]

    @property
    def current_context(self):
        return self._current_context.value


class ConfigNode(object):
    """Remembers each config key's path and construct a relevant exception
    message in case of missing keys. The assumption is all access keys are
    present in a well-formed kube-config."""

    def __init__(self, name, value, path=None):
        self.name = name
        self.value = value
        self.path = path

    def __contains__(self, key):
        return key in self.value

    def __len__(self):
        return len(self.value)

    def safe_get(self, key):
        if (isinstance(self.value, list) and isinstance(key, int) or
                key in self.value):
            return self.value[key]

    def __getitem__(self, key):
        v = self.safe_get(key)
        if v is None:
            raise ConfigException(
                'Invalid kube-config file. Expected key %s in %s'
                % (key, self.name))
        if isinstance(v, dict) or isinstance(v, list):
            return ConfigNode('%s/%s' % (self.name, key), v, self.path)
        else:
            return v

    def get_with_name(self, name, safe=False):
        if not isinstance(self.value, list):
            raise ConfigException(
                'Invalid kube-config file. Expected %s to be a list'
                % self.name)
        result = None
        for v in self.value:
            if 'name' not in v:
                raise ConfigException(
                    'Invalid kube-config file. '
                    'Expected all values in %s list to have \'name\' key'
                    % self.name)
            if v['name'] == name:
                if result is None:
                    result = v
                else:
                    raise ConfigException(
                        'Invalid kube-config file. '
                        'Expected only one object with name %s in %s list'
                        % (name, self.name))
        if result is not None:
            if isinstance(result, ConfigNode):
                return result
            else:
                return ConfigNode(
                    '%s[name=%s]' %
                    (self.name, name), result, self.path)
        if safe:
            return None
        raise ConfigException(
            'Invalid kube-config file. '
            'Expected object with name %s in %s list' % (name, self.name))


class KubeConfigMerger:

    """Reads and merges configuration from one or more kube-config's.
    The property `config` can be passed to the KubeConfigLoader as config_dict.

    It uses a path attribute from ConfigNode to store the path to kubeconfig.
    This path is required to load certs from relative paths.

    A method `save_changes` updates changed kubeconfig's (it compares current
    state of dicts with).
    """

    def __init__(self, paths):
        self.paths = []
        self.config_files = {}
        self.config_merged = None
        if hasattr(paths, 'read'):
            self._load_config_from_file_like_object(paths)
        else:
            self._load_config_from_file_path(paths)

    @property
    def config(self):
        return self.config_merged

    def _load_config_from_file_like_object(self, string):
        if hasattr(string, 'getvalue'):
            config = yaml.safe_load(string.getvalue())
        else:
            config = yaml.safe_load(string.read())

        if config is None:
            raise ConfigException(
                'Invalid kube-config.')
        if self.config_merged is None:
            self.config_merged = copy.deepcopy(config)
        # doesn't need to do any further merging

    def _load_config_from_file_path(self, string):
        for path in string.split(ENV_KUBECONFIG_PATH_SEPARATOR):
            if path:
                path = os.path.expanduser(path)
                if os.path.exists(path):
                    self.paths.append(path)
                    self.load_config(path)
        self.config_saved = copy.deepcopy(self.config_files)

    def load_config(self, path):
        with open(path) as f:
            config = yaml.safe_load(f)

        if config is None:
            raise ConfigException(
                'Invalid kube-config. '
                '%s file is empty' % path)

        if self.config_merged is None:
            config_merged = copy.deepcopy(config)
            for item in ('clusters', 'contexts', 'users'):
                config_merged[item] = []
            self.config_merged = ConfigNode(path, config_merged, path)
        for item in ('clusters', 'contexts', 'users'):
            self._merge(item, config.get(item, []) or [], path)

        if 'current-context' in config:
            self.config_merged.value['current-context'] = config['current-context']

        self.config_files[path] = config

    def _merge(self, item, add_cfg, path):
        for new_item in add_cfg:
            for exists in self.config_merged.value[item]:
                if exists['name'] == new_item['name']:
                    break
            else:
                self.config_merged.value[item].append(ConfigNode(
                    '{}/{}'.format(path, new_item), new_item, path))

    def save_changes(self):
        for path in self.paths:
            if self.config_saved[path] != self.config_files[path]:
                self.save_config(path)
        self.config_saved = copy.deepcopy(self.config_files)

    def save_config(self, path):
        with open(path, 'w') as f:
            yaml.safe_dump(self.config_files[path], f,
                           default_flow_style=False)


def _get_kube_config_loader_for_yaml_file(
        filename, persist_config=False, **kwargs):
    return _get_kube_config_loader(
        filename=filename,
        persist_config=persist_config,
        **kwargs)


def _get_kube_config_loader(
        filename=None,
        config_dict=None,
        persist_config=False,
        **kwargs):
    if config_dict is None:
        kcfg = KubeConfigMerger(filename)
        if persist_config and 'config_persister' not in kwargs:
            kwargs['config_persister'] = kcfg.save_changes

        if kcfg.config is None:
            raise ConfigException(
                'Invalid kube-config file. '
                'No configuration found.')
        return KubeConfigLoader(
            config_dict=kcfg.config,
            config_base_path=None,
            **kwargs)
    else:
        return KubeConfigLoader(
            config_dict=config_dict,
            config_base_path=None,
            **kwargs)


def list_kube_config_contexts(config_file=None):

    if config_file is None:
        config_file = KUBE_CONFIG_DEFAULT_LOCATION

    loader = _get_kube_config_loader(filename=config_file)
    return loader.list_contexts(), loader.current_context


def load_kube_config(config_file=None, context=None,
                     client_configuration=None,
                     persist_config=True,
                     temp_file_path=None):
    """Loads authentication and cluster information from kube-config file
    and stores them in kubernetes.client.configuration.

    :param config_file: Name of the kube-config file.
    :param context: set the active context. If is set to None, current_context
        from config file will be used.
    :param client_configuration: The kubernetes.client.Configuration to
        set configs to.
    :param persist_config: If True, config file will be updated when changed
        (e.g GCP token refresh).
    :param temp_file_path: store temp files path.
    """

    if config_file is None:
        config_file = KUBE_CONFIG_DEFAULT_LOCATION

    loader = _get_kube_config_loader(
        filename=config_file, active_context=context,
        persist_config=persist_config,
        temp_file_path=temp_file_path)

    if client_configuration is None:
        config = type.__call__(Configuration)
        loader.load_and_set(config)
        Configuration.set_default(config)
    else:
        loader.load_and_set(client_configuration)


def load_kube_config_from_dict(config_dict, context=None,
                               client_configuration=None,
                               persist_config=True,
                               temp_file_path=None):
    """Loads authentication and cluster information from config_dict file
    and stores them in kubernetes.client.configuration.

    :param config_dict: Takes the config file as a dict.
    :param context: set the active context. If is set to None, current_context
        from config file will be used.
    :param client_configuration: The kubernetes.client.Configuration to
        set configs to.
    :param persist_config: If True, config file will be updated when changed
        (e.g GCP token refresh).
    :param temp_file_path: store temp files path.
    """
    if config_dict is None:
        raise ConfigException(
            'Invalid kube-config dict. '
            'No configuration found.')

    loader = _get_kube_config_loader(
        config_dict=config_dict, active_context=context,
        persist_config=persist_config,
        temp_file_path=temp_file_path)

    if client_configuration is None:
        config = type.__call__(Configuration)
        loader.load_and_set(config)
        Configuration.set_default(config)
    else:
        loader.load_and_set(client_configuration)


def new_client_from_config(
        config_file=None,
        context=None,
        persist_config=True,
        client_configuration=None):
    """
    Loads configuration the same as load_kube_config but returns an ApiClient
    to be used with any API object. This will allow the caller to concurrently
    talk with multiple clusters.
    """
    if client_configuration is None:
        client_configuration = type.__call__(Configuration)
    load_kube_config(config_file=config_file, context=context,
                     client_configuration=client_configuration,
                     persist_config=persist_config)
    return ApiClient(configuration=client_configuration)


def new_client_from_config_dict(
        config_dict=None,
        context=None,
        persist_config=True,
        temp_file_path=None,
        client_configuration=None):
    """
    Loads configuration the same as load_kube_config_from_dict but returns an ApiClient
    to be used with any API object. This will allow the caller to concurrently
    talk with multiple clusters.
    """
    if client_configuration is None:
        client_configuration = type.__call__(Configuration)
    load_kube_config_from_dict(config_dict=config_dict, context=context,
                               client_configuration=client_configuration,
                               persist_config=persist_config,
                               temp_file_path=temp_file_path)
    return ApiClient(configuration=client_configuration)
