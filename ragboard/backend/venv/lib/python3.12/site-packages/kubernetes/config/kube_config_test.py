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

import base64
import datetime
import io
import json
import os
from pprint import pprint
import shutil
import tempfile
import unittest
from collections import namedtuple

from unittest import mock
import yaml
from six import PY3, next

from kubernetes.client import Configuration

from .config_exception import ConfigException
from .dateutil import UTC, format_rfc3339, parse_rfc3339
from .kube_config import (ENV_KUBECONFIG_PATH_SEPARATOR, CommandTokenSource,
                          ConfigNode, FileOrData, KubeConfigLoader,
                          KubeConfigMerger, _cleanup_temp_files,
                          _create_temp_file_with_content,
                          _get_kube_config_loader,
                          _get_kube_config_loader_for_yaml_file,
                          list_kube_config_contexts, load_kube_config,
                          load_kube_config_from_dict, new_client_from_config, new_client_from_config_dict)

BEARER_TOKEN_FORMAT = "Bearer %s"

EXPIRY_DATETIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
# should be less than kube_config.EXPIRY_SKEW_PREVENTION_DELAY
PAST_EXPIRY_TIMEDELTA = 2
# should be more than kube_config.EXPIRY_SKEW_PREVENTION_DELAY
FUTURE_EXPIRY_TIMEDELTA = 60

NON_EXISTING_FILE = "zz_non_existing_file_472398324"


def _base64(string):
    return base64.standard_b64encode(string.encode()).decode()


def _urlsafe_unpadded_b64encode(string):
    return base64.urlsafe_b64encode(string.encode()).decode().rstrip('=')


def _format_expiry_datetime(dt):
    return dt.strftime(EXPIRY_DATETIME_FORMAT)


def _get_expiry(loader, active_context):
    expired_gcp_conf = (item for item in loader._config.value.get("users")
                        if item.get("name") == active_context)
    return next(expired_gcp_conf).get("user").get("auth-provider") \
        .get("config").get("expiry")


def _raise_exception(st):
    raise Exception(st)


TEST_FILE_KEY = "file"
TEST_DATA_KEY = "data"
TEST_FILENAME = "test-filename"

TEST_DATA = "test-data"
TEST_DATA_BASE64 = _base64(TEST_DATA)

TEST_ANOTHER_DATA = "another-test-data"
TEST_ANOTHER_DATA_BASE64 = _base64(TEST_ANOTHER_DATA)

TEST_HOST = "test-host"
TEST_USERNAME = "me"
TEST_PASSWORD = "pass"
# token for me:pass
TEST_BASIC_TOKEN = "Basic bWU6cGFzcw=="
DATETIME_EXPIRY_PAST = datetime.datetime.now(tz=UTC
                                             ).replace(tzinfo=None) - datetime.timedelta(minutes=PAST_EXPIRY_TIMEDELTA)
DATETIME_EXPIRY_FUTURE = datetime.datetime.now(tz=UTC
                                               ).replace(tzinfo=None) + datetime.timedelta(minutes=FUTURE_EXPIRY_TIMEDELTA)
TEST_TOKEN_EXPIRY_PAST = _format_expiry_datetime(DATETIME_EXPIRY_PAST)

TEST_SSL_HOST = "https://test-host"
TEST_CERTIFICATE_AUTH = "cert-auth"
TEST_CERTIFICATE_AUTH_BASE64 = _base64(TEST_CERTIFICATE_AUTH)
TEST_CLIENT_KEY = "client-key"
TEST_CLIENT_KEY_BASE64 = _base64(TEST_CLIENT_KEY)
TEST_CLIENT_CERT = "client-cert"
TEST_CLIENT_CERT_BASE64 = _base64(TEST_CLIENT_CERT)
TEST_TLS_SERVER_NAME = "kubernetes.io"

TEST_OIDC_TOKEN = "test-oidc-token"
TEST_OIDC_INFO = "{\"name\": \"test\"}"
TEST_OIDC_BASE = ".".join([
    _urlsafe_unpadded_b64encode(TEST_OIDC_TOKEN),
    _urlsafe_unpadded_b64encode(TEST_OIDC_INFO)
])
TEST_OIDC_LOGIN = ".".join([
    TEST_OIDC_BASE,
    _urlsafe_unpadded_b64encode(TEST_CLIENT_CERT_BASE64)
])
TEST_OIDC_TOKEN = "Bearer %s" % TEST_OIDC_LOGIN
TEST_OIDC_EXP = "{\"name\": \"test\",\"exp\": 536457600}"
TEST_OIDC_EXP_BASE = _urlsafe_unpadded_b64encode(
    TEST_OIDC_TOKEN) + "." + _urlsafe_unpadded_b64encode(TEST_OIDC_EXP)
TEST_OIDC_EXPIRED_LOGIN = ".".join([
    TEST_OIDC_EXP_BASE,
    _urlsafe_unpadded_b64encode(TEST_CLIENT_CERT)
])
TEST_OIDC_CONTAINS_RESERVED_CHARACTERS = ".".join([
    _urlsafe_unpadded_b64encode(TEST_OIDC_TOKEN),
    _urlsafe_unpadded_b64encode(TEST_OIDC_INFO).replace("a", "+"),
    _urlsafe_unpadded_b64encode(TEST_CLIENT_CERT)
])
TEST_OIDC_INVALID_PADDING_LENGTH = ".".join([
    _urlsafe_unpadded_b64encode(TEST_OIDC_TOKEN),
    "aaaaa",
    _urlsafe_unpadded_b64encode(TEST_CLIENT_CERT)
])

TEST_OIDC_CA = _base64(TEST_CERTIFICATE_AUTH)

TEST_AZURE_LOGIN = TEST_OIDC_LOGIN
TEST_AZURE_TOKEN = "test-azure-token"
TEST_AZURE_TOKEN_FULL = "Bearer " + TEST_AZURE_TOKEN


class BaseTestCase(unittest.TestCase):

    def setUp(self):
        self._temp_files = []

    def tearDown(self):
        for f in self._temp_files:
            os.remove(f)

    def _create_temp_file(self, content=""):
        handler, name = tempfile.mkstemp()
        self._temp_files.append(name)
        os.write(handler, str.encode(content))
        os.close(handler)
        return name

    def expect_exception(self, func, message_part, *args, **kwargs):
        with self.assertRaises(ConfigException) as context:
            func(*args, **kwargs)
        self.assertIn(message_part, str(context.exception))


class TestFileOrData(BaseTestCase):

    @staticmethod
    def get_file_content(filename):
        with open(filename) as f:
            return f.read()

    def test_file_given_file(self):
        temp_filename = _create_temp_file_with_content(TEST_DATA)
        obj = {TEST_FILE_KEY: temp_filename}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY)
        self.assertEqual(TEST_DATA, self.get_file_content(t.as_file()))

    def test_file_given_non_existing_file(self):
        temp_filename = NON_EXISTING_FILE
        obj = {TEST_FILE_KEY: temp_filename}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY)
        self.expect_exception(t.as_file, "does not exist")

    def test_file_given_data(self):
        obj = {TEST_DATA_KEY: TEST_DATA_BASE64}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY)
        self.assertEqual(TEST_DATA, self.get_file_content(t.as_file()))

    def test_file_given_data_no_base64(self):
        obj = {TEST_DATA_KEY: TEST_DATA}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY, base64_file_content=False)
        self.assertEqual(TEST_DATA, self.get_file_content(t.as_file()))

    def test_data_given_data(self):
        obj = {TEST_DATA_KEY: TEST_DATA_BASE64}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY)
        self.assertEqual(TEST_DATA_BASE64, t.as_data())

    def test_data_given_file(self):
        obj = {
            TEST_FILE_KEY: self._create_temp_file(content=TEST_DATA)}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY)
        self.assertEqual(TEST_DATA_BASE64, t.as_data())

    def test_data_given_file_no_base64(self):
        obj = {
            TEST_FILE_KEY: self._create_temp_file(content=TEST_DATA)}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       base64_file_content=False)
        self.assertEqual(TEST_DATA, t.as_data())

    def test_data_given_file_and_data(self):
        obj = {
            TEST_DATA_KEY: TEST_DATA_BASE64,
            TEST_FILE_KEY: self._create_temp_file(
                content=TEST_ANOTHER_DATA)}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY)
        self.assertEqual(TEST_DATA_BASE64, t.as_data())

    def test_file_given_file_and_data(self):
        obj = {
            TEST_DATA_KEY: TEST_DATA_BASE64,
            TEST_FILE_KEY: self._create_temp_file(
                content=TEST_ANOTHER_DATA)}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY)
        self.assertEqual(TEST_DATA, self.get_file_content(t.as_file()))

    def test_file_with_custom_dirname(self):
        tempfile = self._create_temp_file(content=TEST_DATA)
        tempfile_dir = os.path.dirname(tempfile)
        tempfile_basename = os.path.basename(tempfile)
        obj = {TEST_FILE_KEY: tempfile_basename}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       file_base_path=tempfile_dir)
        self.assertEqual(TEST_DATA, self.get_file_content(t.as_file()))

    def test_create_temp_file_with_content(self):
        self.assertEqual(TEST_DATA,
                         self.get_file_content(
                             _create_temp_file_with_content(TEST_DATA)))
        _cleanup_temp_files()

    def test_file_given_data_bytes(self):
        obj = {TEST_DATA_KEY: TEST_DATA_BASE64.encode()}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY)
        self.assertEqual(TEST_DATA, self.get_file_content(t.as_file()))

    def test_file_given_data_bytes_no_base64(self):
        obj = {TEST_DATA_KEY: TEST_DATA.encode()}
        t = FileOrData(obj=obj, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY, base64_file_content=False)
        self.assertEqual(TEST_DATA, self.get_file_content(t.as_file()))

    def test_file_given_no_object(self):
        t = FileOrData(obj=None, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY)
        self.assertEqual(t.as_file(), None)

    def test_file_given_no_object_data(self):
        t = FileOrData(obj=None, file_key_name=TEST_FILE_KEY,
                       data_key_name=TEST_DATA_KEY)
        self.assertEqual(t.as_data(), None)


class TestConfigNode(BaseTestCase):

    test_obj = {"key1": "test", "key2": ["a", "b", "c"],
                "key3": {"inner_key": "inner_value"},
                "with_names": [{"name": "test_name", "value": "test_value"},
                               {"name": "test_name2",
                                "value": {"key1", "test"}},
                               {"name": "test_name3", "value": [1, 2, 3]}],
                "with_names_dup": [
                    {"name": "test_name", "value": "test_value"},
                    {"name": "test_name",
                     "value": {"key1", "test"}},
                    {"name": "test_name3", "value": [1, 2, 3]}
    ]}

    def setUp(self):
        super(TestConfigNode, self).setUp()
        self.node = ConfigNode("test_obj", self.test_obj)

    def test_normal_map_array_operations(self):
        self.assertEqual("test", self.node['key1'])
        self.assertEqual(5, len(self.node))

        self.assertEqual("test_obj/key2", self.node['key2'].name)
        self.assertEqual(["a", "b", "c"], self.node['key2'].value)
        self.assertEqual("b", self.node['key2'][1])
        self.assertEqual(3, len(self.node['key2']))

        self.assertEqual("test_obj/key3", self.node['key3'].name)
        self.assertEqual({"inner_key": "inner_value"},
                         self.node['key3'].value)
        self.assertEqual("inner_value", self.node['key3']["inner_key"])
        self.assertEqual(1, len(self.node['key3']))

    def test_get_with_name(self):
        node = self.node["with_names"]
        self.assertEqual(
            "test_value",
            node.get_with_name("test_name")["value"])
        self.assertTrue(
            isinstance(node.get_with_name("test_name2"), ConfigNode))
        self.assertTrue(
            isinstance(node.get_with_name("test_name3"), ConfigNode))
        self.assertEqual("test_obj/with_names[name=test_name2]",
                         node.get_with_name("test_name2").name)
        self.assertEqual("test_obj/with_names[name=test_name3]",
                         node.get_with_name("test_name3").name)

    def test_key_does_not_exists(self):
        self.expect_exception(lambda: self.node['not-exists-key'],
                              "Expected key not-exists-key in test_obj")
        self.expect_exception(lambda: self.node['key3']['not-exists-key'],
                              "Expected key not-exists-key in test_obj/key3")

    def test_get_with_name_on_invalid_object(self):
        self.expect_exception(
            lambda: self.node['key2'].get_with_name('no-name'),
            "Expected all values in test_obj/key2 list to have \'name\' key")

    def test_get_with_name_on_non_list_object(self):
        self.expect_exception(
            lambda: self.node['key3'].get_with_name('no-name'),
            "Expected test_obj/key3 to be a list")

    def test_get_with_name_on_name_does_not_exists(self):
        self.expect_exception(
            lambda: self.node['with_names'].get_with_name('no-name'),
            "Expected object with name no-name in test_obj/with_names list")

    def test_get_with_name_on_duplicate_name(self):
        self.expect_exception(
            lambda: self.node['with_names_dup'].get_with_name('test_name'),
            "Expected only one object with name test_name in "
            "test_obj/with_names_dup list")


class FakeConfig:

    FILE_KEYS = ["ssl_ca_cert", "key_file", "cert_file"]
    IGNORE_KEYS = ["refresh_api_key_hook"]

    def __init__(self, token=None, **kwargs):
        self.api_key = {}
        # Provided by the OpenAPI-generated Configuration class
        self.refresh_api_key_hook = None
        if token:
            self.api_key['authorization'] = token

        self.__dict__.update(kwargs)

    def __eq__(self, other):
        if len(self.__dict__) != len(other.__dict__):
            return
        for k, v in self.__dict__.items():
            if k in self.IGNORE_KEYS:
                continue
            if k not in other.__dict__:
                return
            if k in self.FILE_KEYS:
                if v and other.__dict__[k]:
                    try:
                        with open(v) as f1, open(other.__dict__[k]) as f2:
                            if f1.read() != f2.read():
                                return
                    except OSError:
                        # fall back to only compare filenames in case we are
                        # testing the passing of filenames to the config
                        if other.__dict__[k] != v:
                            return
                else:
                    if other.__dict__[k] != v:
                        return
            else:
                if other.__dict__[k] != v:
                    return
        return True

    def __repr__(self):
        rep = "\n"
        for k, v in self.__dict__.items():
            val = v
            if k in self.FILE_KEYS:
                try:
                    with open(v) as f:
                        val = "FILE: %s" % str.decode(f.read())
                except OSError as e:
                    val = "ERROR: %s" % str(e)
            rep += "\t%s: %s\n" % (k, val)
        return "Config(%s\n)" % rep


class TestKubeConfigLoader(BaseTestCase):
    TEST_KUBE_CONFIG = {
        "current-context": "no_user",
        "contexts": [
            {
                "name": "no_user",
                "context": {
                    "cluster": "default"
                }
            },
            {
                "name": "simple_token",
                "context": {
                    "cluster": "default",
                    "user": "simple_token"
                }
            },
            {
                "name": "gcp",
                "context": {
                    "cluster": "default",
                    "user": "gcp"
                }
            },
            {
                "name": "expired_gcp",
                "context": {
                    "cluster": "default",
                    "user": "expired_gcp"
                }
            },
            {
                "name": "expired_gcp_refresh",
                "context": {
                    "cluster": "default",
                    "user": "expired_gcp_refresh"
                }
            },
            {
                "name": "oidc",
                "context": {
                    "cluster": "default",
                    "user": "oidc"
                }
            },
            {
                "name": "azure",
                "context": {
                    "cluster": "default",
                    "user": "azure"
                }
            },
            {
                "name": "azure_num",
                "context": {
                    "cluster": "default",
                    "user": "azure_num"
                }
            },
            {
                "name": "azure_str",
                "context": {
                    "cluster": "default",
                    "user": "azure_str"
                }
            },
            {
                "name": "azure_num_error",
                "context": {
                    "cluster": "default",
                    "user": "azure_str_error"
                }
            },
            {
                "name": "azure_str_error",
                "context": {
                    "cluster": "default",
                    "user": "azure_str_error"
                }
            },
            {
                "name": "expired_oidc",
                "context": {
                    "cluster": "default",
                    "user": "expired_oidc"
                }
            },
            {
                "name": "expired_oidc_with_idp_ca_file",
                "context": {
                    "cluster": "default",
                    "user": "expired_oidc_with_idp_ca_file"
                }
            },
            {
                "name": "expired_oidc_nocert",
                "context": {
                    "cluster": "default",
                    "user": "expired_oidc_nocert"
                }
            },
            {
                "name": "oidc_contains_reserved_character",
                "context": {
                    "cluster": "default",
                    "user": "oidc_contains_reserved_character"

                }
            },
            {
                "name": "oidc_invalid_padding_length",
                "context": {
                    "cluster": "default",
                    "user": "oidc_invalid_padding_length"

                }
            },
            {
                "name": "user_pass",
                "context": {
                    "cluster": "default",
                    "user": "user_pass"
                }
            },
            {
                "name": "ssl",
                "context": {
                    "cluster": "ssl",
                    "user": "ssl"
                }
            },
            {
                "name": "no_ssl_verification",
                "context": {
                    "cluster": "no_ssl_verification",
                    "user": "ssl"
                }
            },
            {
                "name": "ssl-no_file",
                "context": {
                    "cluster": "ssl-no_file",
                    "user": "ssl-no_file"
                }
            },
            {
                "name": "ssl-local-file",
                "context": {
                    "cluster": "ssl-local-file",
                    "user": "ssl-local-file"
                }
            },
            {
                "name": "non_existing_user",
                "context": {
                    "cluster": "default",
                    "user": "non_existing_user"
                }
            },
            {
                "name": "exec_cred_user",
                "context": {
                    "cluster": "default",
                    "user": "exec_cred_user"
                }
            },
            {
                "name": "exec_cred_user_certificate",
                "context": {
                    "cluster": "ssl",
                    "user": "exec_cred_user_certificate"
                }
            },
            {
                "name": "contexttestcmdpath",
                "context": {
                    "cluster": "clustertestcmdpath",
                    "user": "usertestcmdpath"
                }
            },
            {
                "name": "contexttestcmdpathempty",
                "context": {
                    "cluster": "clustertestcmdpath",
                    "user": "usertestcmdpathempty"
                }
            },
            {
                "name": "contexttestcmdpathscope",
                "context": {
                    "cluster": "clustertestcmdpath",
                    "user": "usertestcmdpathscope"
                }
            },
            {
                "name": "tls-server-name",
                "context": {
                    "cluster": "tls-server-name",
                    "user": "ssl"
                }
            },
        ],
        "clusters": [
            {
                "name": "default",
                "cluster": {
                    "server": TEST_HOST
                }
            },
            {
                "name": "ssl-no_file",
                "cluster": {
                    "server": TEST_SSL_HOST,
                    "certificate-authority": TEST_CERTIFICATE_AUTH,
                }
            },
            {
                "name": "ssl-local-file",
                "cluster": {
                    "server": TEST_SSL_HOST,
                    "certificate-authority": "cert_test",
                }
            },
            {
                "name": "ssl",
                "cluster": {
                    "server": TEST_SSL_HOST,
                    "certificate-authority-data":
                        TEST_CERTIFICATE_AUTH_BASE64,
                    "insecure-skip-tls-verify": False,
                }
            },
            {
                "name": "no_ssl_verification",
                "cluster": {
                    "server": TEST_SSL_HOST,
                    "insecure-skip-tls-verify": True,
                }
            },
            {
                "name": "clustertestcmdpath",
                "cluster": {}
            },
            {
                "name": "tls-server-name",
                "cluster": {
                    "server": TEST_SSL_HOST,
                    "certificate-authority-data":
                        TEST_CERTIFICATE_AUTH_BASE64,
                    "insecure-skip-tls-verify": False,
                    "tls-server-name": TEST_TLS_SERVER_NAME,
                }
            },
        ],
        "users": [
            {
                "name": "simple_token",
                "user": {
                    "token": TEST_DATA_BASE64,
                    "username": TEST_USERNAME,  # should be ignored
                    "password": TEST_PASSWORD,  # should be ignored
                }
            },
            {
                "name": "gcp",
                "user": {
                    "auth-provider": {
                        "name": "gcp",
                        "config": {
                            "access-token": TEST_DATA_BASE64,
                        }
                    },
                    "token": TEST_DATA_BASE64,  # should be ignored
                    "username": TEST_USERNAME,  # should be ignored
                    "password": TEST_PASSWORD,  # should be ignored
                }
            },
            {
                "name": "expired_gcp",
                "user": {
                    "auth-provider": {
                        "name": "gcp",
                        "config": {
                            "access-token": TEST_DATA_BASE64,
                            "expiry": TEST_TOKEN_EXPIRY_PAST,  # always in past
                        }
                    },
                    "token": TEST_DATA_BASE64,  # should be ignored
                    "username": TEST_USERNAME,  # should be ignored
                    "password": TEST_PASSWORD,  # should be ignored
                }
            },
            # Duplicated from "expired_gcp" so test_load_gcp_token_with_refresh
            # is isolated from test_gcp_get_api_key_with_prefix.
            {
                "name": "expired_gcp_refresh",
                "user": {
                    "auth-provider": {
                        "name": "gcp",
                        "config": {
                            "access-token": TEST_DATA_BASE64,
                            "expiry": TEST_TOKEN_EXPIRY_PAST,  # always in past
                        }
                    },
                    "token": TEST_DATA_BASE64,  # should be ignored
                    "username": TEST_USERNAME,  # should be ignored
                    "password": TEST_PASSWORD,  # should be ignored
                }
            },
            {
                "name": "oidc",
                "user": {
                    "auth-provider": {
                        "name": "oidc",
                        "config": {
                            "id-token": TEST_OIDC_LOGIN
                        }
                    }
                }
            },
            {
                "name": "azure",
                "user": {
                    "auth-provider": {
                        "config": {
                            "access-token": TEST_AZURE_TOKEN,
                            "apiserver-id": "00000002-0000-0000-c000-"
                                            "000000000000",
                            "environment": "AzurePublicCloud",
                            "refresh-token": "refreshToken",
                            "tenant-id": "9d2ac018-e843-4e14-9e2b-4e0ddac75433"
                        },
                        "name": "azure"
                    }
                }
            },
            {
                "name": "azure_num",
                "user": {
                    "auth-provider": {
                        "config": {
                            "access-token": TEST_AZURE_TOKEN,
                            "apiserver-id": "00000002-0000-0000-c000-"
                                            "000000000000",
                            "environment": "AzurePublicCloud",
                            "expires-in": "0",
                            "expires-on": "156207275",
                            "refresh-token": "refreshToken",
                            "tenant-id": "9d2ac018-e843-4e14-9e2b-4e0ddac75433"
                        },
                        "name": "azure"
                    }
                }
            },
            {
                "name": "azure_str",
                "user": {
                    "auth-provider": {
                        "config": {
                            "access-token": TEST_AZURE_TOKEN,
                            "apiserver-id": "00000002-0000-0000-c000-"
                                            "000000000000",
                            "environment": "AzurePublicCloud",
                            "expires-in": "0",
                            "expires-on": "2018-10-18 00:52:29.044727",
                            "refresh-token": "refreshToken",
                            "tenant-id": "9d2ac018-e843-4e14-9e2b-4e0ddac75433"
                        },
                        "name": "azure"
                    }
                }
            },
            {
                "name": "azure_str_error",
                "user": {
                    "auth-provider": {
                        "config": {
                            "access-token": TEST_AZURE_TOKEN,
                            "apiserver-id": "00000002-0000-0000-c000-"
                                            "000000000000",
                            "environment": "AzurePublicCloud",
                            "expires-in": "0",
                            "expires-on": "2018-10-18 00:52",
                            "refresh-token": "refreshToken",
                            "tenant-id": "9d2ac018-e843-4e14-9e2b-4e0ddac75433"
                        },
                        "name": "azure"
                    }
                }
            },
            {
                "name": "azure_num_error",
                "user": {
                    "auth-provider": {
                        "config": {
                            "access-token": TEST_AZURE_TOKEN,
                            "apiserver-id": "00000002-0000-0000-c000-"
                                            "000000000000",
                            "environment": "AzurePublicCloud",
                            "expires-in": "0",
                            "expires-on": "-1",
                            "refresh-token": "refreshToken",
                            "tenant-id": "9d2ac018-e843-4e14-9e2b-4e0ddac75433"
                        },
                        "name": "azure"
                    }
                }
            },
            {
                "name": "expired_oidc",
                "user": {
                    "auth-provider": {
                        "name": "oidc",
                        "config": {
                            "client-id": "tectonic-kubectl",
                            "client-secret": "FAKE_SECRET",
                            "id-token": TEST_OIDC_EXPIRED_LOGIN,
                            "idp-certificate-authority-data": TEST_OIDC_CA,
                            "idp-issuer-url": "https://example.org/identity",
                            "refresh-token":
                                "lucWJjEhlxZW01cXI3YmVlcYnpxNGhzk"
                        }
                    }
                }
            },
            {
                "name": "expired_oidc_with_idp_ca_file",
                "user": {
                    "auth-provider": {
                        "name": "oidc",
                        "config": {
                            "client-id": "tectonic-kubectl",
                            "client-secret": "FAKE_SECRET",
                            "id-token": TEST_OIDC_EXPIRED_LOGIN,
                            "idp-certificate-authority": TEST_CERTIFICATE_AUTH,
                            "idp-issuer-url": "https://example.org/identity",
                            "refresh-token":
                                "lucWJjEhlxZW01cXI3YmVlcYnpxNGhzk"
                        }
                    }
                }
            },
            {
                "name": "expired_oidc_nocert",
                "user": {
                    "auth-provider": {
                        "name": "oidc",
                        "config": {
                            "client-id": "tectonic-kubectl",
                            "client-secret": "FAKE_SECRET",
                            "id-token": TEST_OIDC_EXPIRED_LOGIN,
                            "idp-issuer-url": "https://example.org/identity",
                            "refresh-token":
                                "lucWJjEhlxZW01cXI3YmVlcYnpxNGhzk"
                        }
                    }
                }
            },
            {
                "name": "oidc_contains_reserved_character",
                "user": {
                    "auth-provider": {
                        "name": "oidc",
                        "config": {
                            "client-id": "tectonic-kubectl",
                            "client-secret": "FAKE_SECRET",
                            "id-token": TEST_OIDC_CONTAINS_RESERVED_CHARACTERS,
                            "idp-issuer-url": "https://example.org/identity",
                            "refresh-token":
                                "lucWJjEhlxZW01cXI3YmVlcYnpxNGhzk"
                        }
                    }
                }
            },
            {
                "name": "oidc_invalid_padding_length",
                "user": {
                    "auth-provider": {
                        "name": "oidc",
                        "config": {
                            "client-id": "tectonic-kubectl",
                            "client-secret": "FAKE_SECRET",
                            "id-token": TEST_OIDC_INVALID_PADDING_LENGTH,
                            "idp-issuer-url": "https://example.org/identity",
                            "refresh-token":
                                "lucWJjEhlxZW01cXI3YmVlcYnpxNGhzk"
                        }
                    }
                }
            },
            {
                "name": "user_pass",
                "user": {
                    "username": TEST_USERNAME,  # should be ignored
                    "password": TEST_PASSWORD,  # should be ignored
                }
            },
            {
                "name": "ssl-no_file",
                "user": {
                    "token": TEST_DATA_BASE64,
                    "client-certificate": TEST_CLIENT_CERT,
                    "client-key": TEST_CLIENT_KEY,
                }
            },
            {
                "name": "ssl-local-file",
                "user": {
                    "tokenFile": "token_file",
                    "client-certificate": "client_cert",
                    "client-key": "client_key",
                }
            },
            {
                "name": "ssl",
                "user": {
                    "token": TEST_DATA_BASE64,
                    "client-certificate-data": TEST_CLIENT_CERT_BASE64,
                    "client-key-data": TEST_CLIENT_KEY_BASE64,
                }
            },
            {
                "name": "exec_cred_user",
                "user": {
                    "exec": {
                        "apiVersion": "client.authentication.k8s.io/v1beta1",
                        "command": "aws-iam-authenticator",
                        "args": ["token", "-i", "dummy-cluster"]
                    }
                }
            },
            {
                "name": "exec_cred_user_certificate",
                "user": {
                    "exec": {
                        "apiVersion": "client.authentication.k8s.io/v1beta1",
                        "command": "custom-certificate-authenticator",
                        "args": []
                    }
                }
            },
            {
                "name": "usertestcmdpath",
                "user": {
                    "auth-provider": {
                        "name": "gcp",
                        "config": {
                            "cmd-path": "cmdtorun"
                        }
                    }
                }
            },
            {
                "name": "usertestcmdpathempty",
                "user": {
                    "auth-provider": {
                        "name": "gcp",
                        "config": {
                            "cmd-path": ""
                        }
                    }
                }
            },
            {
                "name": "usertestcmdpathscope",
                "user": {
                    "auth-provider": {
                        "name": "gcp",
                        "config": {
                            "cmd-path": "cmd",
                            "scopes": "scope"
                        }
                    }
                }
            }
        ]
    }

    def test_no_user_context(self):
        expected = FakeConfig(host=TEST_HOST)
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="no_user").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_simple_token(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="simple_token").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_load_user_token(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="simple_token")
        self.assertTrue(loader._load_user_token())
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_DATA_BASE64, loader.token)

    def test_gcp_no_refresh(self):
        fake_config = FakeConfig()
        self.assertIsNone(fake_config.refresh_api_key_hook)
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="gcp",
            get_google_credentials=lambda: _raise_exception(
                "SHOULD NOT BE CALLED")).load_and_set(fake_config)
        # Should now be populated with a gcp token fetcher.
        self.assertIsNotNone(fake_config.refresh_api_key_hook)
        self.assertEqual(TEST_HOST, fake_config.host)
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
                         fake_config.api_key['authorization'])

    def test_load_gcp_token_no_refresh(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="gcp",
            get_google_credentials=lambda: _raise_exception(
                "SHOULD NOT BE CALLED"))
        self.assertTrue(loader._load_auth_provider_token())
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
                         loader.token)

    def test_load_gcp_token_with_refresh(self):
        def cred(): return None
        cred.token = TEST_ANOTHER_DATA_BASE64
        cred.expiry = datetime.datetime.now(tz=UTC).replace(tzinfo=None)

        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="expired_gcp",
            get_google_credentials=lambda: cred)
        original_expiry = _get_expiry(loader, "expired_gcp")
        self.assertTrue(loader._load_auth_provider_token())
        new_expiry = _get_expiry(loader, "expired_gcp")
        # assert that the configs expiry actually updates
        self.assertTrue(new_expiry > original_expiry)
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_ANOTHER_DATA_BASE64,
                         loader.token)

    def test_gcp_refresh_api_key_hook(self):
        class cred_old:
            token = TEST_DATA_BASE64
            expiry = DATETIME_EXPIRY_PAST

        class cred_new:
            token = TEST_ANOTHER_DATA_BASE64
            expiry = DATETIME_EXPIRY_FUTURE
        fake_config = FakeConfig()
        _get_google_credentials = mock.Mock()
        _get_google_credentials.side_effect = [cred_old, cred_new]

        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="expired_gcp_refresh",
            get_google_credentials=_get_google_credentials)
        loader.load_and_set(fake_config)
        original_expiry = _get_expiry(loader, "expired_gcp_refresh")
        # Refresh the GCP token.
        fake_config.refresh_api_key_hook(fake_config)
        new_expiry = _get_expiry(loader, "expired_gcp_refresh")

        self.assertTrue(new_expiry > original_expiry)
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_ANOTHER_DATA_BASE64,
                         loader.token)

    def test_oidc_no_refresh(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="oidc",
        )
        self.assertTrue(loader._load_auth_provider_token())
        self.assertEqual(TEST_OIDC_TOKEN, loader.token)

    @mock.patch('kubernetes.config.kube_config.OAuth2Session.refresh_token')
    @mock.patch('kubernetes.config.kube_config.ApiClient.request')
    def test_oidc_with_refresh(self, mock_ApiClient, mock_OAuth2Session):
        mock_response = mock.MagicMock()
        type(mock_response).status = mock.PropertyMock(
            return_value=200
        )
        type(mock_response).data = mock.PropertyMock(
            return_value=json.dumps({
                "token_endpoint": "https://example.org/identity/token"
            })
        )

        mock_ApiClient.return_value = mock_response

        mock_OAuth2Session.return_value = {"id_token": "abc123",
                                           "refresh_token": "newtoken123"}

        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="expired_oidc",
        )
        self.assertTrue(loader._load_auth_provider_token())
        self.assertEqual("Bearer abc123", loader.token)

    @mock.patch('kubernetes.config.kube_config.OAuth2Session.refresh_token')
    @mock.patch('kubernetes.config.kube_config.ApiClient.request')
    def test_oidc_with_idp_ca_file_refresh(self, mock_ApiClient, mock_OAuth2Session):
        mock_response = mock.MagicMock()
        type(mock_response).status = mock.PropertyMock(
            return_value=200
        )
        type(mock_response).data = mock.PropertyMock(
            return_value=json.dumps({
                "token_endpoint": "https://example.org/identity/token"
            })
        )

        mock_ApiClient.return_value = mock_response

        mock_OAuth2Session.return_value = {"id_token": "abc123",
                                           "refresh_token": "newtoken123"}

        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="expired_oidc_with_idp_ca_file",
        )

        self.assertTrue(loader._load_auth_provider_token())
        self.assertEqual("Bearer abc123", loader.token)

    @mock.patch('kubernetes.config.kube_config.OAuth2Session.refresh_token')
    @mock.patch('kubernetes.config.kube_config.ApiClient.request')
    def test_oidc_with_refresh_nocert(
            self, mock_ApiClient, mock_OAuth2Session):
        mock_response = mock.MagicMock()
        type(mock_response).status = mock.PropertyMock(
            return_value=200
        )
        type(mock_response).data = mock.PropertyMock(
            return_value=json.dumps({
                "token_endpoint": "https://example.org/identity/token"
            })
        )

        mock_ApiClient.return_value = mock_response

        mock_OAuth2Session.return_value = {"id_token": "abc123",
                                           "refresh_token": "newtoken123"}

        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="expired_oidc_nocert",
        )
        self.assertTrue(loader._load_auth_provider_token())
        self.assertEqual("Bearer abc123", loader.token)

    def test_oidc_fails_if_contains_reserved_chars(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="oidc_contains_reserved_character",
        )
        self.assertEqual(
            loader._load_oid_token("oidc_contains_reserved_character"),
            None,
        )

    def test_oidc_fails_if_invalid_padding_length(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="oidc_invalid_padding_length",
        )
        self.assertEqual(
            loader._load_oid_token("oidc_invalid_padding_length"),
            None,
        )

    def test_azure_no_refresh(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="azure",
        )
        self.assertTrue(loader._load_auth_provider_token())
        self.assertEqual(TEST_AZURE_TOKEN_FULL, loader.token)

    def test_azure_with_expired_num(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="azure_num",
        )
        provider = loader._user['auth-provider']
        self.assertTrue(loader._azure_is_expired(provider))

    def test_azure_with_expired_str(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="azure_str",
        )
        provider = loader._user['auth-provider']
        self.assertTrue(loader._azure_is_expired(provider))

    def test_azure_with_expired_str_error(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="azure_str_error",
        )
        provider = loader._user['auth-provider']
        self.assertRaises(ValueError, loader._azure_is_expired, provider)

    def test_azure_with_expired_int_error(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="azure_num_error",
        )
        provider = loader._user['auth-provider']
        self.assertRaises(ValueError, loader._azure_is_expired, provider)

    def test_user_pass(self):
        expected = FakeConfig(host=TEST_HOST, token=TEST_BASIC_TOKEN)
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="user_pass").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_load_user_pass_token(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="user_pass")
        self.assertTrue(loader._load_user_pass_token())
        self.assertEqual(TEST_BASIC_TOKEN, loader.token)

    def test_ssl_no_cert_files(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="ssl-no_file")
        self.expect_exception(
            loader.load_and_set,
            "does not exist",
            FakeConfig())

    def test_ssl(self):
        expected = FakeConfig(
            host=TEST_SSL_HOST,
            token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
            cert_file=self._create_temp_file(TEST_CLIENT_CERT),
            key_file=self._create_temp_file(TEST_CLIENT_KEY),
            ssl_ca_cert=self._create_temp_file(TEST_CERTIFICATE_AUTH),
            verify_ssl=True
        )
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="ssl").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_ssl_no_verification(self):
        expected = FakeConfig(
            host=TEST_SSL_HOST,
            token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
            cert_file=self._create_temp_file(TEST_CLIENT_CERT),
            key_file=self._create_temp_file(TEST_CLIENT_KEY),
            verify_ssl=False,
            ssl_ca_cert=None,
        )
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="no_ssl_verification").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_tls_server_name(self):
        expected = FakeConfig(
            host=TEST_SSL_HOST,
            token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
            cert_file=self._create_temp_file(TEST_CLIENT_CERT),
            key_file=self._create_temp_file(TEST_CLIENT_KEY),
            ssl_ca_cert=self._create_temp_file(TEST_CERTIFICATE_AUTH),
            verify_ssl=True,
            tls_server_name=TEST_TLS_SERVER_NAME
        )
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="tls-server-name").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_list_contexts(self):
        loader = KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="no_user")
        actual_contexts = loader.list_contexts()
        expected_contexts = ConfigNode("", self.TEST_KUBE_CONFIG)['contexts']
        for actual in actual_contexts:
            expected = expected_contexts.get_with_name(actual['name'])
            self.assertEqual(expected.value, actual)

    def test_current_context(self):
        loader = KubeConfigLoader(config_dict=self.TEST_KUBE_CONFIG)
        expected_contexts = ConfigNode("", self.TEST_KUBE_CONFIG)['contexts']
        self.assertEqual(expected_contexts.get_with_name("no_user").value,
                         loader.current_context)

    def test_set_active_context(self):
        loader = KubeConfigLoader(config_dict=self.TEST_KUBE_CONFIG)
        loader.set_active_context("ssl")
        expected_contexts = ConfigNode("", self.TEST_KUBE_CONFIG)['contexts']
        self.assertEqual(expected_contexts.get_with_name("ssl").value,
                         loader.current_context)

    def test_ssl_with_relative_ssl_files(self):
        expected = FakeConfig(
            host=TEST_SSL_HOST,
            token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
            cert_file=self._create_temp_file(TEST_CLIENT_CERT),
            key_file=self._create_temp_file(TEST_CLIENT_KEY),
            ssl_ca_cert=self._create_temp_file(TEST_CERTIFICATE_AUTH)
        )
        try:
            temp_dir = tempfile.mkdtemp()
            actual = FakeConfig()
            with open(os.path.join(temp_dir, "cert_test"), "wb") as fd:
                fd.write(TEST_CERTIFICATE_AUTH.encode())
            with open(os.path.join(temp_dir, "client_cert"), "wb") as fd:
                fd.write(TEST_CLIENT_CERT.encode())
            with open(os.path.join(temp_dir, "client_key"), "wb") as fd:
                fd.write(TEST_CLIENT_KEY.encode())
            with open(os.path.join(temp_dir, "token_file"), "wb") as fd:
                fd.write(TEST_DATA_BASE64.encode())
            KubeConfigLoader(
                config_dict=self.TEST_KUBE_CONFIG,
                active_context="ssl-local-file",
                config_base_path=temp_dir).load_and_set(actual)
            self.assertEqual(expected, actual)
        finally:
            shutil.rmtree(temp_dir)

    def test_load_kube_config_from_file_path(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        config_file = self._create_temp_file(
            yaml.safe_dump(self.TEST_KUBE_CONFIG))
        actual = FakeConfig()
        load_kube_config(config_file=config_file, context="simple_token",
                         client_configuration=actual)
        self.assertEqual(expected, actual)

    def test_load_kube_config_from_file_like_object(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        config_file_like_object = io.StringIO()
        # py3 (won't have unicode) vs py2 (requires it)
        try:
            unicode('')
            config_file_like_object.write(
                unicode(
                    yaml.safe_dump(
                        self.TEST_KUBE_CONFIG),
                    errors='replace'))
        except NameError:
            config_file_like_object.write(
                yaml.safe_dump(
                    self.TEST_KUBE_CONFIG))
        actual = FakeConfig()
        load_kube_config(
            config_file=config_file_like_object,
            context="simple_token",
            client_configuration=actual)
        self.assertEqual(expected, actual)

    def test_load_kube_config_from_dict(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        actual = FakeConfig()
        load_kube_config_from_dict(config_dict=self.TEST_KUBE_CONFIG,
                                   context="simple_token",
                                   client_configuration=actual)
        self.assertEqual(expected, actual)

    def test_load_kube_config_from_dict_with_temp_file_path(self):
        expected = FakeConfig(
            host=TEST_SSL_HOST,
            token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
            cert_file=self._create_temp_file(TEST_CLIENT_CERT),
            key_file=self._create_temp_file(TEST_CLIENT_KEY),
            ssl_ca_cert=self._create_temp_file(TEST_CERTIFICATE_AUTH),
            verify_ssl=True
        )
        actual = FakeConfig()
        tmp_path = os.path.join(
            os.path.dirname(
                os.path.dirname(
                    os.path.abspath(__file__))),
            'tmp_file_path_test')
        load_kube_config_from_dict(config_dict=self.TEST_KUBE_CONFIG,
                                   context="ssl",
                                   client_configuration=actual,
                                   temp_file_path=tmp_path)
        self.assertFalse(True if not os.listdir(tmp_path) else False)
        self.assertEqual(expected, actual)
        _cleanup_temp_files()

    def test_load_kube_config_from_empty_file_like_object(self):
        config_file_like_object = io.StringIO()
        self.assertRaises(
            ConfigException,
            load_kube_config,
            config_file_like_object)

    def test_load_kube_config_from_empty_file(self):
        config_file = self._create_temp_file(
            yaml.safe_dump(None))
        self.assertRaises(
            ConfigException,
            load_kube_config,
            config_file)

    def test_list_kube_config_contexts(self):
        config_file = self._create_temp_file(
            yaml.safe_dump(self.TEST_KUBE_CONFIG))
        contexts, active_context = list_kube_config_contexts(
            config_file=config_file)
        self.assertDictEqual(self.TEST_KUBE_CONFIG['contexts'][0],
                             active_context)
        if PY3:
            self.assertCountEqual(self.TEST_KUBE_CONFIG['contexts'],
                                  contexts)
        else:
            self.assertItemsEqual(self.TEST_KUBE_CONFIG['contexts'],
                                  contexts)

    def test_new_client_from_config(self):
        config_file = self._create_temp_file(
            yaml.safe_dump(self.TEST_KUBE_CONFIG))
        client = new_client_from_config(
            config_file=config_file, context="simple_token")
        self.assertEqual(TEST_HOST, client.configuration.host)
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
                         client.configuration.api_key['authorization'])

    def test_new_client_from_config_dict(self):
        client = new_client_from_config_dict(
            config_dict=self.TEST_KUBE_CONFIG, context="simple_token")
        self.assertEqual(TEST_HOST, client.configuration.host)
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
                         client.configuration.api_key['authorization'])

    def test_no_users_section(self):
        expected = FakeConfig(host=TEST_HOST)
        actual = FakeConfig()
        test_kube_config = self.TEST_KUBE_CONFIG.copy()
        del test_kube_config['users']
        KubeConfigLoader(
            config_dict=test_kube_config,
            active_context="gcp").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_non_existing_user(self):
        expected = FakeConfig(host=TEST_HOST)
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="non_existing_user").load_and_set(actual)
        self.assertEqual(expected, actual)

    @mock.patch('kubernetes.config.kube_config.ExecProvider.run')
    def test_user_exec_auth(self, mock):
        token = "dummy"
        mock.return_value = {
            "token": token
        }
        expected = FakeConfig(host=TEST_HOST, api_key={
                              "authorization": BEARER_TOKEN_FORMAT % token})
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="exec_cred_user").load_and_set(actual)
        self.assertEqual(expected, actual)

    @mock.patch('kubernetes.config.kube_config.ExecProvider.run')
    def test_user_exec_auth_with_expiry(self, mock):
        expired_token = "expired"
        current_token = "current"
        mock.side_effect = [
            {
                "token": expired_token,
                "expirationTimestamp": format_rfc3339(DATETIME_EXPIRY_PAST)
            },
            {
                "token": current_token,
                "expirationTimestamp": format_rfc3339(DATETIME_EXPIRY_FUTURE)
            }
        ]

        fake_config = FakeConfig()
        self.assertIsNone(fake_config.refresh_api_key_hook)

        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="exec_cred_user").load_and_set(fake_config)
        # The kube config should use the first token returned from the
        # exec provider.
        self.assertEqual(fake_config.api_key["authorization"],
                         BEARER_TOKEN_FORMAT % expired_token)
        # Should now be populated with a method to refresh expired tokens.
        self.assertIsNotNone(fake_config.refresh_api_key_hook)
        # Refresh the token; the kube config should be updated.
        fake_config.refresh_api_key_hook(fake_config)
        self.assertEqual(fake_config.api_key["authorization"],
                         BEARER_TOKEN_FORMAT % current_token)

    @mock.patch('kubernetes.config.kube_config.ExecProvider.run')
    def test_user_exec_auth_certificates(self, mock):
        mock.return_value = {
            "clientCertificateData": TEST_CLIENT_CERT,
            "clientKeyData": TEST_CLIENT_KEY,
        }
        expected = FakeConfig(
            host=TEST_SSL_HOST,
            cert_file=self._create_temp_file(TEST_CLIENT_CERT),
            key_file=self._create_temp_file(TEST_CLIENT_KEY),
            ssl_ca_cert=self._create_temp_file(TEST_CERTIFICATE_AUTH),
            verify_ssl=True)
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="exec_cred_user_certificate").load_and_set(actual)
        self.assertEqual(expected, actual)

    @mock.patch('kubernetes.config.kube_config.ExecProvider.run', autospec=True)
    def test_user_exec_cwd(self, mock):
        capture = {}

        def capture_cwd(exec_provider):
            capture['cwd'] = exec_provider.cwd
        mock.side_effect = capture_cwd

        expected = "/some/random/path"
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="exec_cred_user",
            config_base_path=expected).load_and_set(FakeConfig())
        self.assertEqual(expected, capture['cwd'])

    def test_user_cmd_path(self):
        A = namedtuple('A', ['token', 'expiry'])
        token = "dummy"
        return_value = A(token, parse_rfc3339(datetime.datetime.now()))
        CommandTokenSource.token = mock.Mock(return_value=return_value)
        expected = FakeConfig(api_key={
                              "authorization": BEARER_TOKEN_FORMAT % token})
        actual = FakeConfig()
        KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="contexttestcmdpath").load_and_set(actual)
        self.assertEqual(expected, actual)

    def test_user_cmd_path_empty(self):
        A = namedtuple('A', ['token', 'expiry'])
        token = "dummy"
        return_value = A(token, parse_rfc3339(datetime.datetime.now()))
        CommandTokenSource.token = mock.Mock(return_value=return_value)
        expected = FakeConfig(api_key={
                              "authorization": BEARER_TOKEN_FORMAT % token})
        actual = FakeConfig()
        self.expect_exception(lambda: KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="contexttestcmdpathempty").load_and_set(actual),
            "missing access token cmd "
            "(cmd-path is an empty string in your kubeconfig file)")

    def test_user_cmd_path_with_scope(self):
        A = namedtuple('A', ['token', 'expiry'])
        token = "dummy"
        return_value = A(token, parse_rfc3339(datetime.datetime.now()))
        CommandTokenSource.token = mock.Mock(return_value=return_value)
        expected = FakeConfig(api_key={
                              "authorization": BEARER_TOKEN_FORMAT % token})
        actual = FakeConfig()
        self.expect_exception(lambda: KubeConfigLoader(
            config_dict=self.TEST_KUBE_CONFIG,
            active_context="contexttestcmdpathscope").load_and_set(actual),
            "scopes can only be used when kubectl is using "
            "a gcp service account key")

    def test__get_kube_config_loader_for_yaml_file_no_persist(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        config_file = self._create_temp_file(
            yaml.safe_dump(self.TEST_KUBE_CONFIG))
        actual = _get_kube_config_loader_for_yaml_file(config_file)
        self.assertIsNone(actual._config_persister)

    def test__get_kube_config_loader_for_yaml_file_persist(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        config_file = self._create_temp_file(
            yaml.safe_dump(self.TEST_KUBE_CONFIG))
        actual = _get_kube_config_loader_for_yaml_file(config_file,
                                                       persist_config=True)
        self.assertTrue(callable(actual._config_persister))
        self.assertEqual(actual._config_persister.__name__, "save_changes")

    def test__get_kube_config_loader_file_no_persist(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        config_file = self._create_temp_file(
            yaml.safe_dump(self.TEST_KUBE_CONFIG))
        actual = _get_kube_config_loader(filename=config_file)
        self.assertIsNone(actual._config_persister)

    def test__get_kube_config_loader_file_persist(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        config_file = self._create_temp_file(
            yaml.safe_dump(self.TEST_KUBE_CONFIG))
        actual = _get_kube_config_loader(filename=config_file,
                                         persist_config=True)
        self.assertTrue(callable(actual._config_persister))
        self.assertEqual(actual._config_persister.__name__, "save_changes")

    def test__get_kube_config_loader_dict_no_persist(self):
        expected = FakeConfig(host=TEST_HOST,
                              token=BEARER_TOKEN_FORMAT % TEST_DATA_BASE64)
        actual = _get_kube_config_loader(
            config_dict=self.TEST_KUBE_CONFIG)
        self.assertIsNone(actual._config_persister)


class TestKubernetesClientConfiguration(BaseTestCase):
    # Verifies properties of kubernetes.client.Configuration.
    # These tests guard against changes to the upstream configuration class,
    # since GCP and Exec authorization use refresh_api_key_hook to refresh
    # their tokens regularly.

    def test_refresh_api_key_hook_exists(self):
        self.assertTrue(hasattr(Configuration(), 'refresh_api_key_hook'))

    def test_get_api_key_calls_refresh_api_key_hook(self):
        identifier = 'authorization'
        expected_token = 'expected_token'
        old_token = 'old_token'
        config = Configuration(
            api_key={identifier: old_token},
            api_key_prefix={identifier: 'Bearer'}
        )

        def refresh_api_key_hook(client_config):
            self.assertEqual(client_config, config)
            client_config.api_key[identifier] = expected_token
        config.refresh_api_key_hook = refresh_api_key_hook

        self.assertEqual('Bearer ' + expected_token,
                         config.get_api_key_with_prefix(identifier))


class TestKubeConfigMerger(BaseTestCase):
    TEST_KUBE_CONFIG_SET1 = [{
        "current-context": "no_user",
        "contexts": [
            {
                "name": "no_user",
                "context": {
                    "cluster": "default"
                }
            },
        ],
        "clusters": [
            {
                "name": "default",
                "cluster": {
                    "server": TEST_HOST
                }
            },
        ],
        "users": []
    }, {
        "current-context": "",
        "contexts": [
            {
                "name": "ssl",
                "context": {
                    "cluster": "ssl",
                    "user": "ssl"
                }
            },
            {
                "name": "simple_token",
                "context": {
                    "cluster": "default",
                    "user": "simple_token"
                }
            },
        ],
        "clusters": [
            {
                "name": "ssl",
                "cluster": {
                    "server": TEST_SSL_HOST,
                    "certificate-authority-data":
                        TEST_CERTIFICATE_AUTH_BASE64,
                }
            },
        ],
        "users": [
            {
                "name": "ssl",
                "user": {
                    "token": TEST_DATA_BASE64,
                    "client-certificate-data": TEST_CLIENT_CERT_BASE64,
                    "client-key-data": TEST_CLIENT_KEY_BASE64,
                }
            },
        ]
    }, {
        "current-context": "no_user",
        "contexts": [
            {
                "name": "expired_oidc",
                "context": {
                    "cluster": "default",
                    "user": "expired_oidc"
                }
            },
            {
                "name": "ssl",
                "context": {
                    "cluster": "skipped-part2-defined-this-context",
                    "user": "skipped"
                }
            },
        ],
        "clusters": [
        ],
        "users": [
            {
                "name": "expired_oidc",
                "user": {
                    "auth-provider": {
                        "name": "oidc",
                        "config": {
                            "client-id": "tectonic-kubectl",
                            "client-secret": "FAKE_SECRET",
                            "id-token": TEST_OIDC_EXPIRED_LOGIN,
                            "idp-certificate-authority-data": TEST_OIDC_CA,
                            "idp-issuer-url": "https://example.org/identity",
                            "refresh-token":
                                "lucWJjEhlxZW01cXI3YmVlcYnpxNGhzk"
                        }
                    }
                }
            },
            {
                "name": "simple_token",
                "user": {
                    "token": TEST_DATA_BASE64,
                    "username": TEST_USERNAME,  # should be ignored
                    "password": TEST_PASSWORD,  # should be ignored
                }
            },
        ]
    }, {
        "current-context": "no_user",
    }, {
        # Config with user having cmd-path
        "contexts": [
            {
                "name": "contexttestcmdpath",
                "context": {
                    "cluster": "clustertestcmdpath",
                    "user": "usertestcmdpath"
                }
            }
        ],
        "clusters": [
            {
                "name": "clustertestcmdpath",
                "cluster": {}
            }
        ],
        "users": [
            {
                "name": "usertestcmdpath",
                "user": {
                    "auth-provider": {
                        "name": "gcp",
                        "config": {
                            "cmd-path": "cmdtorun"
                        }
                    }
                }
            }
        ]
    }, {
        "current-context": "no_user",
        "contexts": [
            {
                "name": "no_user",
                "context": {
                    "cluster": "default"
                }
            },
        ],
        "clusters": [
            {
                "name": "default",
                "cluster": {
                    "server": TEST_HOST
                }
            },
        ],
        "users": None
    }]
    # 3 parts with different keys/data to merge
    TEST_KUBE_CONFIG_SET2 = [{
        "clusters": [
            {
                "name": "default",
                "cluster": {
                    "server": TEST_HOST
                }
            },
        ],
    }, {
        "current-context": "simple_token",
        "contexts": [
            {
                "name": "simple_token",
                "context": {
                    "cluster": "default",
                    "user": "simple_token"
                }
            },
        ],
    }, {
        "users": [
            {
                "name": "simple_token",
                "user": {
                    "token": TEST_DATA_BASE64,
                    "username": TEST_USERNAME,
                    "password": TEST_PASSWORD,
                }
            },
        ]
    }]

    def _create_multi_config(self, parts):
        files = []
        for part in parts:
            files.append(self._create_temp_file(yaml.safe_dump(part)))
        return ENV_KUBECONFIG_PATH_SEPARATOR.join(files)

    def test_list_kube_config_contexts(self):
        kubeconfigs = self._create_multi_config(self.TEST_KUBE_CONFIG_SET1)
        expected_contexts = [
            {'context': {'cluster': 'default'}, 'name': 'no_user'},
            {'context': {'cluster': 'ssl', 'user': 'ssl'}, 'name': 'ssl'},
            {'context': {'cluster': 'default', 'user': 'simple_token'},
             'name': 'simple_token'},
            {'context': {'cluster': 'default', 'user': 'expired_oidc'},
             'name': 'expired_oidc'},
            {'context': {'cluster': 'clustertestcmdpath',
                         'user': 'usertestcmdpath'},
             'name': 'contexttestcmdpath'}]

        contexts, active_context = list_kube_config_contexts(
            config_file=kubeconfigs)

        self.assertEqual(contexts, expected_contexts)
        self.assertEqual(active_context, expected_contexts[0])

    def test_new_client_from_config(self):
        kubeconfigs = self._create_multi_config(self.TEST_KUBE_CONFIG_SET1)
        client = new_client_from_config(
            config_file=kubeconfigs, context="simple_token")
        self.assertEqual(TEST_HOST, client.configuration.host)
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
                         client.configuration.api_key['authorization'])

    def test_merge_with_context_in_different_file(self):
        kubeconfigs = self._create_multi_config(self.TEST_KUBE_CONFIG_SET2)
        client = new_client_from_config(config_file=kubeconfigs)

        expected_contexts = [
            {'context': {'cluster': 'default', 'user': 'simple_token'},
             'name': 'simple_token'}
        ]
        contexts, active_context = list_kube_config_contexts(
            config_file=kubeconfigs)
        self.assertEqual(contexts, expected_contexts)
        self.assertEqual(active_context, expected_contexts[0])
        self.assertEqual(TEST_HOST, client.configuration.host)
        self.assertEqual(BEARER_TOKEN_FORMAT % TEST_DATA_BASE64,
                         client.configuration.api_key['authorization'])

    def test_save_changes(self):
        kubeconfigs = self._create_multi_config(self.TEST_KUBE_CONFIG_SET1)

        # load configuration, update token, save config
        kconf = KubeConfigMerger(kubeconfigs)
        user = kconf.config['users'].get_with_name('expired_oidc')['user']
        provider = user['auth-provider']['config']
        provider.value['id-token'] = "token-changed"
        kconf.save_changes()

        # re-read configuration
        kconf = KubeConfigMerger(kubeconfigs)
        user = kconf.config['users'].get_with_name('expired_oidc')['user']
        provider = user['auth-provider']['config']

        # new token
        self.assertEqual(provider.value['id-token'], "token-changed")


if __name__ == '__main__':
    unittest.main()
