# Copyright 2016 The Kubernetes Authors.
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

import datetime
import os

from kubernetes.client import Configuration

from .config_exception import ConfigException

SERVICE_HOST_ENV_NAME = "KUBERNETES_SERVICE_HOST"
SERVICE_PORT_ENV_NAME = "KUBERNETES_SERVICE_PORT"
SERVICE_TOKEN_FILENAME = "/var/run/secrets/kubernetes.io/serviceaccount/token"
SERVICE_CERT_FILENAME = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"


def _join_host_port(host, port):
    """Adapted golang's net.JoinHostPort"""
    template = "%s:%s"
    host_requires_bracketing = ':' in host or '%' in host
    if host_requires_bracketing:
        template = "[%s]:%s"
    return template % (host, port)


class InClusterConfigLoader(object):
    def __init__(self,
                 token_filename,
                 cert_filename,
                 try_refresh_token=True,
                 environ=os.environ):
        self._token_filename = token_filename
        self._cert_filename = cert_filename
        self._environ = environ
        self._try_refresh_token = try_refresh_token
        self._token_refresh_period = datetime.timedelta(minutes=1)

    def load_and_set(self, client_configuration=None):
        try_set_default = False
        if client_configuration is None:
            client_configuration = type.__call__(Configuration)
            try_set_default = True
        self._load_config()
        self._set_config(client_configuration)
        if try_set_default:
            Configuration.set_default(client_configuration)

    def _load_config(self):
        if (SERVICE_HOST_ENV_NAME not in self._environ
                or SERVICE_PORT_ENV_NAME not in self._environ):
            raise ConfigException("Service host/port is not set.")

        if (not self._environ[SERVICE_HOST_ENV_NAME]
                or not self._environ[SERVICE_PORT_ENV_NAME]):
            raise ConfigException("Service host/port is set but empty.")

        self.host = ("https://" +
                     _join_host_port(self._environ[SERVICE_HOST_ENV_NAME],
                                     self._environ[SERVICE_PORT_ENV_NAME]))

        if not os.path.isfile(self._token_filename):
            raise ConfigException("Service token file does not exist.")

        self._read_token_file()

        if not os.path.isfile(self._cert_filename):
            raise ConfigException(
                "Service certification file does not exist.")

        with open(self._cert_filename) as f:
            if not f.read():
                raise ConfigException("Cert file exists but empty.")

        self.ssl_ca_cert = self._cert_filename

    def _set_config(self, client_configuration):
        client_configuration.host = self.host
        client_configuration.ssl_ca_cert = self.ssl_ca_cert
        if self.token is not None:
            client_configuration.api_key['authorization'] = self.token
        if not self._try_refresh_token:
            return

        def _refresh_api_key(client_configuration):
            if self.token_expires_at <= datetime.datetime.now():
                self._read_token_file()
            self._set_config(client_configuration)

        client_configuration.refresh_api_key_hook = _refresh_api_key

    def _read_token_file(self):
        with open(self._token_filename) as f:
            content = f.read()
            if not content:
                raise ConfigException("Token file exists but empty.")
            self.token = "bearer " + content
            self.token_expires_at = datetime.datetime.now(
            ) + self._token_refresh_period


def load_incluster_config(client_configuration=None, try_refresh_token=True):
    """
    Use the service account kubernetes gives to pods to connect to kubernetes
    cluster. It's intended for clients that expect to be running inside a pod
    running on kubernetes. It will raise an exception if called from a process
    not running in a kubernetes environment."""
    InClusterConfigLoader(
        token_filename=SERVICE_TOKEN_FILENAME,
        cert_filename=SERVICE_CERT_FILENAME,
        try_refresh_token=try_refresh_token).load_and_set(client_configuration)
