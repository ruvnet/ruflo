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
import tempfile
import time
import unittest

from kubernetes.client import Configuration

from .config_exception import ConfigException
from .incluster_config import (SERVICE_HOST_ENV_NAME, SERVICE_PORT_ENV_NAME,
                               InClusterConfigLoader, _join_host_port)

_TEST_TOKEN = "temp_token"
_TEST_NEW_TOKEN = "temp_new_token"
_TEST_CERT = "temp_cert"
_TEST_HOST = "127.0.0.1"
_TEST_PORT = "80"
_TEST_HOST_PORT = "127.0.0.1:80"
_TEST_IPV6_HOST = "::1"
_TEST_IPV6_HOST_PORT = "[::1]:80"

_TEST_ENVIRON = {
    SERVICE_HOST_ENV_NAME: _TEST_HOST,
    SERVICE_PORT_ENV_NAME: _TEST_PORT
}
_TEST_IPV6_ENVIRON = {
    SERVICE_HOST_ENV_NAME: _TEST_IPV6_HOST,
    SERVICE_PORT_ENV_NAME: _TEST_PORT
}


class InClusterConfigTest(unittest.TestCase):
    def setUp(self):
        self._temp_files = []

    def tearDown(self):
        for f in self._temp_files:
            os.remove(f)

    def _create_file_with_temp_content(self, content=""):
        handler, name = tempfile.mkstemp()
        self._temp_files.append(name)
        os.write(handler, str.encode(content))
        os.close(handler)
        return name

    def get_test_loader(self,
                        token_filename=None,
                        cert_filename=None,
                        environ=_TEST_ENVIRON):
        if not token_filename:
            token_filename = self._create_file_with_temp_content(_TEST_TOKEN)
        if not cert_filename:
            cert_filename = self._create_file_with_temp_content(_TEST_CERT)
        return InClusterConfigLoader(token_filename=token_filename,
                                     cert_filename=cert_filename,
                                     try_refresh_token=True,
                                     environ=environ)

    def test_join_host_port(self):
        self.assertEqual(_TEST_HOST_PORT,
                         _join_host_port(_TEST_HOST, _TEST_PORT))
        self.assertEqual(_TEST_IPV6_HOST_PORT,
                         _join_host_port(_TEST_IPV6_HOST, _TEST_PORT))

    def test_load_config(self):
        cert_filename = self._create_file_with_temp_content(_TEST_CERT)
        loader = self.get_test_loader(cert_filename=cert_filename)
        loader._load_config()
        self.assertEqual("https://" + _TEST_HOST_PORT, loader.host)
        self.assertEqual(cert_filename, loader.ssl_ca_cert)
        self.assertEqual('bearer ' + _TEST_TOKEN, loader.token)

    def test_refresh_token(self):
        loader = self.get_test_loader()
        config = Configuration()
        loader.load_and_set(config)

        self.assertEqual('bearer ' + _TEST_TOKEN,
                         config.get_api_key_with_prefix('authorization'))
        self.assertEqual('bearer ' + _TEST_TOKEN, loader.token)
        self.assertIsNotNone(loader.token_expires_at)

        old_token = loader.token
        old_token_expires_at = loader.token_expires_at
        loader._token_filename = self._create_file_with_temp_content(
            _TEST_NEW_TOKEN)
        self.assertEqual('bearer ' + _TEST_TOKEN,
                         config.get_api_key_with_prefix('authorization'))

        loader.token_expires_at = datetime.datetime.now()
        self.assertEqual('bearer ' + _TEST_NEW_TOKEN,
                         config.get_api_key_with_prefix('authorization'))
        self.assertEqual('bearer ' + _TEST_NEW_TOKEN, loader.token)
        self.assertGreater(loader.token_expires_at, old_token_expires_at)

    def _should_fail_load(self, config_loader, reason):
        try:
            config_loader.load_and_set()
            self.fail("Should fail because %s" % reason)
        except ConfigException:
            # expected
            pass

    def test_no_port(self):
        loader = self.get_test_loader(
            environ={SERVICE_HOST_ENV_NAME: _TEST_HOST})
        self._should_fail_load(loader, "no port specified")

    def test_empty_port(self):
        loader = self.get_test_loader(environ={
            SERVICE_HOST_ENV_NAME: _TEST_HOST,
            SERVICE_PORT_ENV_NAME: ""
        })
        self._should_fail_load(loader, "empty port specified")

    def test_no_host(self):
        loader = self.get_test_loader(
            environ={SERVICE_PORT_ENV_NAME: _TEST_PORT})
        self._should_fail_load(loader, "no host specified")

    def test_empty_host(self):
        loader = self.get_test_loader(environ={
            SERVICE_HOST_ENV_NAME: "",
            SERVICE_PORT_ENV_NAME: _TEST_PORT
        })
        self._should_fail_load(loader, "empty host specified")

    def test_no_cert_file(self):
        loader = self.get_test_loader(cert_filename="not_exists_file_1123")
        self._should_fail_load(loader, "cert file does not exist")

    def test_empty_cert_file(self):
        loader = self.get_test_loader(
            cert_filename=self._create_file_with_temp_content())
        self._should_fail_load(loader, "empty cert file provided")

    def test_no_token_file(self):
        loader = self.get_test_loader(token_filename="not_exists_file_1123")
        self._should_fail_load(loader, "token file does not exist")

    def test_empty_token_file(self):
        loader = self.get_test_loader(
            token_filename=self._create_file_with_temp_content())
        self._should_fail_load(loader, "empty token file provided")


if __name__ == '__main__':
    unittest.main()
