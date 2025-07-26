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

import json
import os
import unittest

from unittest import mock

from .config_exception import ConfigException
from .exec_provider import ExecProvider
from .kube_config import ConfigNode


class ExecProviderTest(unittest.TestCase):

    def setUp(self):
        self.input_ok = ConfigNode('test', {
            'command': 'aws-iam-authenticator',
            'args': ['token', '-i', 'dummy'],
            'apiVersion': 'client.authentication.k8s.io/v1beta1',
            'env': None
        })
        self.input_with_cluster = ConfigNode('test', {
            'command': 'aws-iam-authenticator',
            'args': ['token', '-i', 'dummy'],
            'apiVersion': 'client.authentication.k8s.io/v1beta1',
            'provideClusterInfo': True,
            'env': None
        })
        self.output_ok = """
        {
            "apiVersion": "client.authentication.k8s.io/v1beta1",
            "kind": "ExecCredential",
            "status": {
                "token": "dummy"
            }
        }
        """

    def test_missing_input_keys(self):
        exec_configs = [ConfigNode('test1', {}),
                        ConfigNode('test2', {'command': ''}),
                        ConfigNode('test3', {'apiVersion': ''})]
        for exec_config in exec_configs:
            with self.assertRaises(ConfigException) as context:
                ExecProvider(exec_config, None)
            self.assertIn('exec: malformed request. missing key',
                          context.exception.args[0])

    @mock.patch('subprocess.Popen')
    def test_error_code_returned(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 1
        instance.communicate.return_value = ('', '')
        with self.assertRaises(ConfigException) as context:
            ep = ExecProvider(self.input_ok, None)
            ep.run()
        self.assertIn('exec: process returned %d' %
                      instance.wait.return_value, context.exception.args[0])

    @mock.patch('subprocess.Popen')
    def test_nonjson_output_returned(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 0
        instance.communicate.return_value = ('', '')
        with self.assertRaises(ConfigException) as context:
            ep = ExecProvider(self.input_ok, None)
            ep.run()
        self.assertIn('exec: failed to decode process output',
                      context.exception.args[0])

    @mock.patch('subprocess.Popen')
    def test_missing_output_keys(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 0
        outputs = [
            """
            {
                "kind": "ExecCredential",
                "status": {
                    "token": "dummy"
                }
            }
            """, """
            {
                "apiVersion": "client.authentication.k8s.io/v1beta1",
                "status": {
                    "token": "dummy"
                }
            }
            """, """
            {
                "apiVersion": "client.authentication.k8s.io/v1beta1",
                "kind": "ExecCredential"
            }
            """
        ]
        for output in outputs:
            instance.communicate.return_value = (output, '')
            with self.assertRaises(ConfigException) as context:
                ep = ExecProvider(self.input_ok, None)
                ep.run()
            self.assertIn('exec: malformed response. missing key',
                          context.exception.args[0])

    @mock.patch('subprocess.Popen')
    def test_mismatched_api_version(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 0
        wrong_api_version = 'client.authentication.k8s.io/v1'
        output = """
        {
            "apiVersion": "%s",
            "kind": "ExecCredential",
            "status": {
                "token": "dummy"
            }
        }
        """ % wrong_api_version
        instance.communicate.return_value = (output, '')
        with self.assertRaises(ConfigException) as context:
            ep = ExecProvider(self.input_ok, None)
            ep.run()
        self.assertIn(
            'exec: plugin api version %s does not match' %
            wrong_api_version,
            context.exception.args[0])

    @mock.patch('subprocess.Popen')
    def test_ok_01(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 0
        instance.communicate.return_value = (self.output_ok, '')
        ep = ExecProvider(self.input_ok, None)
        result = ep.run()
        self.assertTrue(isinstance(result, dict))
        self.assertTrue('token' in result)

    @mock.patch('subprocess.Popen')
    def test_run_in_dir(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 0
        instance.communicate.return_value = (self.output_ok, '')
        ep = ExecProvider(self.input_ok, '/some/directory')
        ep.run()
        self.assertEqual(mock.call_args[1]['cwd'], '/some/directory')

    @mock.patch('subprocess.Popen')
    def test_ok_no_console_attached(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 0
        instance.communicate.return_value = (self.output_ok, '')
        mock_stdout = unittest.mock.patch(
            'sys.stdout', new=None)  # Simulate detached console
        with mock_stdout:
            ep = ExecProvider(self.input_ok, None)
            result = ep.run()
            self.assertTrue(isinstance(result, dict))
            self.assertTrue('token' in result)

    @mock.patch('subprocess.Popen')
    def test_with_cluster_info(self, mock):
        instance = mock.return_value
        instance.wait.return_value = 0
        instance.communicate.return_value = (self.output_ok, '')
        ep = ExecProvider(self.input_with_cluster, None, ConfigNode("cluster", {'server': 'name.company.com'}))
        result = ep.run()
        self.assertTrue(isinstance(result, dict))
        self.assertTrue('token' in result)

        obj = json.loads(mock.call_args.kwargs['env']['KUBERNETES_EXEC_INFO'])
        self.assertEqual(obj['spec']['cluster']['server'], 'name.company.com')


if __name__ == '__main__':
    unittest.main()
